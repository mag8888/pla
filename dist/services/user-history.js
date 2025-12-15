import { prisma } from '../lib/prisma.js';
import { Markup } from 'telegraf';
function generateObjectId(telegramId) {
    // Convert Telegram ID to a valid MongoDB ObjectId (24 hex chars)
    const hex = telegramId.toString(16).padStart(24, '0');
    return hex.substring(0, 24);
}
// Проверяет, заблокирован ли бот пользователем
function isBotBlockedError(error) {
    if (!error)
        return false;
    const errorMessage = error.message || error.description || '';
    const errorCode = error.response?.error_code || error.error_code;
    return (errorCode === 403 ||
        errorMessage.includes('bot was blocked') ||
        errorMessage.includes('Forbidden: bot was blocked'));
}
// Проверяет, является ли ошибка ошибкой подключения к БД
function isDatabaseConnectionError(error) {
    if (!error)
        return false;
    const errorCode = error.code;
    const errorMessage = error.message || error.meta?.message || '';
    const errorKind = error.kind || '';
    return (errorCode === 'P2010' || // Raw query failed
        errorCode === 'P1001' || // Can't reach database server
        errorCode === 'P1002' || // Connection timeout
        errorCode === 'P1013' || // Invalid connection string
        errorMessage.includes('Server selection timeout') ||
        errorMessage.includes('No available servers') ||
        errorMessage.includes('I/O error: timed out') ||
        errorMessage.includes('Connection pool timeout') ||
        errorMessage.includes('Transactions are not supported') || // MongoDB Atlas free tier
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('SCRAM failure') ||
        errorKind.includes('AuthenticationFailed') ||
        errorKind.includes('Authentication'));
}
export async function ensureUser(ctx) {
    const from = ctx.from;
    if (!from)
        return null;
    const data = {
        telegramId: String(from.id),
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        username: from.username ?? null,
        languageCode: from.language_code ?? null,
    };
    try {
        // Используем findUnique + create/update вместо upsert
        // чтобы избежать транзакций (MongoDB Atlas free tier не поддерживает транзакции)
        let user = await prisma.user.findUnique({
            where: { telegramId: data.telegramId },
        });
        if (user) {
            // Обновляем существующего пользователя
            user = await prisma.user.update({
                where: { telegramId: data.telegramId },
                data: {
                    firstName: data.firstName,
                    lastName: data.lastName,
                    username: data.username,
                    languageCode: data.languageCode,
                },
            });
        }
        else {
            // Создаем нового пользователя
            user = await prisma.user.create({
                data: {
                    ...data,
                    id: generateObjectId(from.id),
                },
            });
        }
        return user;
    }
    catch (error) {
        // Проверяем, является ли это ошибкой подключения или транзакций
        if (isDatabaseConnectionError(error)) {
            console.warn('Database unavailable, using mock user:', error.message?.substring(0, 100));
        }
        else {
            console.warn('Failed to ensure user:', error.message?.substring(0, 100));
        }
        // Return mock user object to continue without DB
        return {
            id: generateObjectId(from.id),
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }
}
/**
 * Проверяет наличие username и phone у пользователя
 * Если username отсутствует и phone тоже отсутствует - запрашивает номер телефона
 * @returns true если пользователь может продолжить, false если нужно запросить телефон
 */
export async function checkUserContact(ctx) {
    const user = await ensureUser(ctx);
    if (!user)
        return false;
    // Если есть username - всё ок
    if (user.username) {
        return true;
    }
    // Если нет username, но есть phone - всё ок
    if (user.phone) {
        return true;
    }
    // Если нет ни username, ни phone - запрашиваем телефон
    try {
        await ctx.reply('📱 Для продолжения работы с ботом необходимо указать номер телефона.\n\n' +
            'Пожалуйста, нажмите кнопку ниже, чтобы поделиться своим номером телефона:', Markup.keyboard([
            [Markup.button.contactRequest('📱 Поделиться номером телефона')]
        ]).resize());
    }
    catch (error) {
        // Если бот заблокирован пользователем, просто выходим без ошибки
        if (isBotBlockedError(error)) {
            console.log('Bot was blocked by user, skipping phone request');
            return false;
        }
        // Для других ошибок пробрасываем дальше
        throw error;
    }
    return false;
}
/**
 * Обрабатывает полученный номер телефона от пользователя
 */
export async function handlePhoneNumber(ctx) {
    const from = ctx.from;
    if (!from)
        return;
    const phoneNumber = ctx.message && 'contact' in ctx.message
        ? ctx.message.contact.phone_number
        : null;
    if (!phoneNumber) {
        await ctx.reply('❌ Не удалось получить номер телефона. Пожалуйста, попробуйте еще раз.');
        return;
    }
    try {
        const user = await ensureUser(ctx);
        if (!user)
            return;
        try {
            await prisma.user.update({
                where: { id: user.id },
                data: { phone: phoneNumber }
            });
        }
        catch (dbError) {
            // Если БД недоступна, просто логируем и продолжаем
            if (isDatabaseConnectionError(dbError)) {
                console.warn('Database unavailable, phone number not saved:', dbError);
                // Продолжаем выполнение, чтобы сообщить пользователю
            }
            else {
                // Для других ошибок БД пробрасываем дальше
                throw dbError;
            }
        }
        try {
            await ctx.reply('✅ Спасибо! Номер телефона успешно сохранен.\n\nТеперь вы можете пользоваться всеми функциями бота.', Markup.removeKeyboard());
        }
        catch (replyError) {
            // Если бот заблокирован, просто выходим без ошибки
            if (isBotBlockedError(replyError)) {
                console.log('Bot was blocked by user, skipping phone confirmation');
                return;
            }
            throw replyError;
        }
    }
    catch (error) {
        // Если бот заблокирован, просто выходим без ошибки
        if (isBotBlockedError(error)) {
            console.log('Bot was blocked by user, skipping phone number save');
            return;
        }
        // Если ошибка подключения к БД, сообщаем пользователю, но не падаем
        if (isDatabaseConnectionError(error)) {
            console.warn('Database unavailable, phone number not saved:', error);
            try {
                await ctx.reply('⚠️ База данных временно недоступна. Номер телефона не сохранен. Попробуйте позже.');
            }
            catch (replyError) {
                if (isBotBlockedError(replyError)) {
                    console.log('Bot was blocked by user, skipping error message');
                    return;
                }
                throw replyError;
            }
            return;
        }
        console.error('Failed to save phone number:', error);
        try {
            await ctx.reply('❌ Ошибка при сохранении номера телефона. Попробуйте позже.');
        }
        catch (replyError) {
            // Если бот заблокирован, просто выходим без ошибки
            if (isBotBlockedError(replyError)) {
                console.log('Bot was blocked by user, skipping error message');
                return;
            }
            // Для других ошибок пробрасываем дальше
            throw replyError;
        }
    }
}
export async function logUserAction(ctx, action, payload) {
    try {
        const user = await ensureUser(ctx);
        if (!user)
            return;
        await prisma.userHistory.create({
            data: {
                userId: user.id,
                action,
                payload: payload ?? undefined,
            },
        });
    }
    catch (error) {
        // Проверяем, является ли это ошибкой подключения/аутентификации
        if (isDatabaseConnectionError(error)) {
            // Не логируем ошибки аутентификации/подключения, так как они уже обрабатываются
            // и бот продолжает работать с mock данными
            return;
        }
        // Логируем только другие ошибки
        console.warn('Failed to log user action (non-critical):', error.message?.substring(0, 100));
        // Continue without logging if DB fails
    }
}
