import { Context } from '../bot/context.js';
import { prisma } from '../lib/prisma.js';
import { Markup } from 'telegraf';

function generateObjectId(telegramId: number): string {
  // Convert Telegram ID to a valid MongoDB ObjectId (24 hex chars)
  const hex = telegramId.toString(16).padStart(24, '0');
  return hex.substring(0, 24);
}

export async function ensureUser(ctx: Context) {
  const from = ctx.from;
  if (!from) return null;

  const data = {
    telegramId: String(from.id),
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
    username: from.username ?? null,
    languageCode: from.language_code ?? null,
  } as const;

  try {
    const user = await prisma.user.upsert({
      where: { telegramId: data.telegramId },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
        languageCode: data.languageCode,
      },
      create: {
        ...data,
        id: generateObjectId(from.id),
      },
    });

    return user;
  } catch (error) {
    console.warn('Failed to ensure user:', error);
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
export async function checkUserContact(ctx: Context): Promise<boolean> {
  const user = await ensureUser(ctx);
  if (!user) return false;

  // Если есть username - всё ок
  if (user.username) {
    return true;
  }

  // Если нет username, но есть phone - всё ок
  if ((user as any).phone) {
    return true;
  }

  // Если нет ни username, ни phone - запрашиваем телефон
  await ctx.reply(
    '📱 Для продолжения работы с ботом необходимо указать номер телефона.\n\n' +
    'Пожалуйста, нажмите кнопку ниже, чтобы поделиться своим номером телефона:',
    Markup.keyboard([
      [Markup.button.contactRequest('📱 Поделиться номером телефона')]
    ]).resize()
  );

  return false;
}

/**
 * Обрабатывает полученный номер телефона от пользователя
 */
export async function handlePhoneNumber(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const phoneNumber = ctx.message && 'contact' in ctx.message 
    ? ctx.message.contact.phone_number 
    : null;

  if (!phoneNumber) {
    await ctx.reply('❌ Не удалось получить номер телефона. Пожалуйста, попробуйте еще раз.');
    return;
  }

  try {
    const user = await ensureUser(ctx);
    if (!user) return;

    await prisma.user.update({
      where: { id: user.id },
      data: { phone: phoneNumber } as any
    });

    await ctx.reply(
      '✅ Спасибо! Номер телефона успешно сохранен.\n\nТеперь вы можете пользоваться всеми функциями бота.',
      Markup.removeKeyboard()
    );
  } catch (error) {
    console.error('Failed to save phone number:', error);
    await ctx.reply('❌ Ошибка при сохранении номера телефона. Попробуйте позже.');
  }
}

export async function logUserAction(ctx: Context, action: string, payload?: any) {
  try {
    const user = await ensureUser(ctx);
    if (!user) return;

    await prisma.userHistory.create({
      data: {
        userId: user.id,
        action,
        payload: payload ?? undefined,
      },
    });
  } catch (error) {
    console.warn('Failed to log user action:', error);
    // Continue without logging if DB fails
  }
}
