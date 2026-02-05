import { Markup } from 'telegraf';
import { logUserAction, ensureUser, checkUserContact } from '../../services/user-history.js';
import { upsertPartnerReferral, recordPartnerTransaction, getOrCreatePartnerProfile, buildReferralLink } from '../../services/partner-service.js';
import { env } from '../../config/env.js';
const greeting = `👋 Добро пожаловать!
PLAZMA — структурированная вода для здоровья и энергии.
💧 Вода — источник жизни. Мы доставляем воду с улучшенной структурой.
⚡ Поддержка иммунитета, тонус и естественная гармония организма.

Хотите узнать больше? 👇`;
/** Текст под фото приветствия (экран «эра будущего») */
const WELCOME_PHOTO_CAPTION = `🌀 Добро пожаловать в эру будущего!

Plazma Water - это движение энергичных и здоровых людей. Мы используем инновационные космические эко технологии для восстановления и очищения организма человека на всех уровнях и структур жизни.

Мы приглашаем тех, кто сам идёт своим путём, принимает ответственность за своё состояние и вдохновляет других.`;
const introDetails = `💧 Что такое PLAZMA?
Структурированная вода — источник жизни ⚡️

✨ PLAZMA — это вода, прошедшая специальную обработку для улучшения структуры.
Правильная структура воды способствует лучшему усвоению, энергии и восстановлению организма 🧬

🚀 Наша технология:
• Улучшение структуры молекул воды
• Повышение биологической активности
• Без химических добавок

💎 Преимущества:
• Экологически чистая технология
• Поддержка иммунитета и обмена веществ
• Антиоксидантные свойства
• Повышение энергии и жизненного тонуса

💠 Результат:
Лёгкость, энергия и естественное восстановление 🌿

⚠️ Не является лекарственным средством.`;
const NAVIGATION_ACTION_PREFIX = 'nav:menu:';
const SWITCH_TO_CLASSIC_ACTION = 'nav:mode:classic';
const DEFAULT_UI_MODE = 'app';
const WELCOME_VIDEO_URL = 'https://res.cloudinary.com/dt4r1tigf/video/upload/v1759337188/%D0%9F%D0%9E%D0%A7%D0%95%D0%9C%D0%A3_%D0%91%D0%90%D0%94%D0%AB_%D0%BD%D0%B5_%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%B0%D1%8E%D1%82_%D0%95%D1%81%D1%82%D1%8C_%D1%80%D0%B5%D1%88%D0%B5%D0%BD%D0%B8%D0%B5_gz54oh.mp4';
const DEFAULT_WEBAPP_SUFFIX = '/webapp';
function getWebappUrl() {
    const baseUrl = env.webappUrl || env.publicBaseUrl || 'https://vital-production-82b0.up.railway.app';
    if (baseUrl.includes(DEFAULT_WEBAPP_SUFFIX)) {
        return baseUrl;
    }
    return `${baseUrl.replace(/\/$/, '')}${DEFAULT_WEBAPP_SUFFIX}`;
}
function getWelcomePhotoUrl() {
    const base = (env.publicBaseUrl || env.webappUrl || 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/webapp/static/images/welcome-plazma.png`;
}
/** Приветствие с фото PLAZMA, подпись и кнопки: Подарок, Открыть каталог, Ваша реф ссылка */
async function sendWelcomeWithPhoto(ctx, options) {
    const caption = options?.referralInviterName
        ? `🎉 Вас пригласил ${options.referralInviterName}\n\n${WELCOME_PHOTO_CAPTION}`
        : WELCOME_PHOTO_CAPTION;
    const webappUrl = getWebappUrl();
    await ctx.replyWithPhoto({ url: getWelcomePhotoUrl() }, {
        caption,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎁 Подарок', callback_data: 'nav:gift' }],
                [Markup.button.webApp('🛒 Открыть каталог', webappUrl)],
                [{ text: '🔗 Ваша реф ссылка', callback_data: 'nav:my_ref_link' }],
            ],
        },
    });
}
async function showSupport(ctx) {
    await ctx.reply('💬 Служба поддержки\n\nНапишите свой вопрос прямо в этот чат — команда PLAZMA ответит как можно быстрее.\n\nЕсли нужен срочный контакт, оставьте номер телефона, и мы перезвоним.');
}
async function handleSupportMessage(ctx) {
    const user = await ensureUser(ctx);
    if (!user)
        return;
    const messageText = ctx.message?.text;
    if (!messageText)
        return;
    // Skip if it's a command
    if (messageText.startsWith('/'))
        return;
    // Skip if it's a button press (common button texts)
    const buttonTexts = ['🛒 Магазин', '💰 Партнёрка', '⭐ Отзывы', 'ℹ️ О нас', 'Меню', 'Главное меню', 'Назад'];
    if (buttonTexts.includes(messageText))
        return;
    // Log the support message
    await logUserAction(ctx, 'support:message_sent', { messageLength: messageText.length });
    // Send to specific admin @Aurelia_8888
    const { getBotInstance } = await import('../../lib/bot-instance.js');
    const bot = await getBotInstance();
    if (bot) {
        const adminMessage = `📨 <b>Сообщение в поддержку</b>\n\n` +
            `👤 <b>Пользователь:</b> ${user.firstName || 'Не указано'} ${user.lastName || ''}\n` +
            `🆔 <b>ID:</b> <code>${user.telegramId}</code>\n` +
            `📱 <b>Username:</b> @${user.username || 'не указан'}\n\n` +
            `💬 <b>Сообщение:</b>\n${messageText}\n\n` +
            `⏰ <b>Время:</b> ${new Date().toLocaleString('ru-RU')}`;
        try {
            // Send to specific admin with reply button
            const aureliaAdminId = '7077195545'; // @Aurelia_8888
            await bot.telegram.sendMessage(aureliaAdminId, adminMessage, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '💬 Ответить пользователю',
                                callback_data: `admin_reply:${user.telegramId}:${user.firstName || 'Пользователь'}`
                            }
                        ]
                    ]
                }
            });
            // Confirm to user
            await ctx.reply('✅ Ваше сообщение отправлено в службу поддержки. Мы ответим как можно скорее!');
        }
        catch (error) {
            console.error('Failed to send support message to admin:', error);
            await ctx.reply('❌ Произошла ошибка при отправке сообщения. Попробуйте позже.');
        }
    }
}
async function showGiftMessage(ctx) {
    const giftMessage = `🔥 Для Вас уникальный материал.

Аудиофайлы записанные методом Гаряева были списаны с реакторов конкретной плазмы.

Слушая файлы вы можете получить весь спектр воздействия. 👇🏼`;
    await ctx.reply(giftMessage, {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '📖 ГИД по плазменному здоровью',
                        url: 'https://t.me/plazma_bot',
                    },
                ],
            ],
        },
    });
}
const navigationItems = [
    {
        id: 'shop',
        title: 'Магазин',
        emoji: '🛒',
        description: 'Каталог продукции и сезонные наборы',
        badgeKey: 'shop',
        handler: async (ctx) => {
            // Сразу открываем webapp
            await ctx.answerCbQuery();
            const webappUrl = getWebappUrl();
            await ctx.reply('🛒 <b>Открываю магазин...</b>', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '🚀 Открыть магазин',
                                web_app: { url: webappUrl }
                            }
                        ]
                    ]
                }
            });
        },
    },
    {
        id: 'partner',
        title: 'Партнёрка',
        emoji: '🤝',
        description: 'Реферальные бонусы и личный кабинет',
        handler: async (ctx) => {
            const { showPartnerIntro } = await import('../partner/index.js');
            await showPartnerIntro(ctx);
        },
    },
    {
        id: 'reviews',
        title: 'Отзывы',
        emoji: '⭐',
        description: 'Истории сообщества и результаты клиентов',
        badgeKey: 'reviews',
        handler: async (ctx) => {
            const { showReviews } = await import('../reviews/index.js');
            await showReviews(ctx);
        },
    },
    {
        id: 'about',
        title: 'О нас',
        emoji: 'ℹ️',
        description: 'Информация о Vital и соцсети',
        handler: async (ctx) => {
            const { showAbout } = await import('../about/index.js');
            await showAbout(ctx);
        },
    },
    {
        id: 'support',
        title: 'Поддержка',
        emoji: '💬',
        description: 'Ответим на вопросы и поможем с заказом',
        defaultBadge: '24/7',
        handler: showSupport,
    },
];
function getUiMode(ctx) {
    const mode = ctx.session?.uiMode;
    if (mode === 'app' || mode === 'classic') {
        return mode;
    }
    ctx.session.uiMode = DEFAULT_UI_MODE;
    return DEFAULT_UI_MODE;
}
function setUiMode(ctx, mode) {
    ctx.session.uiMode = mode;
}
async function sendWelcomeVideo(ctx) {
    await ctx.reply('✨ PLAZMA — вода, источник жизни.', {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🎥 Смотреть видео',
                        url: WELCOME_VIDEO_URL,
                    },
                ],
                [
                    {
                        text: '📖 Подробнее',
                        callback_data: 'nav:more',
                    },
                ],
                [
                    {
                        text: '🎁 Подарок',
                        callback_data: 'nav:gift',
                    },
                ],
            ],
        },
    });
}
async function sendClassicHome(ctx) {
    await ctx.reply(greeting, Markup.removeKeyboard());
}
async function sendAppHome(ctx, options = {}) {
    const { introText, includeGreeting = true } = options;
    let text = greeting;
    if (introText)
        text = introText;
    else if (!includeGreeting)
        text = 'Каталог';
    await ctx.reply(text, Markup.removeKeyboard());
}
async function renderHome(ctx) {
    if (getUiMode(ctx) === 'app') {
        await sendAppHome(ctx);
    }
    else {
        await sendClassicHome(ctx);
    }
}
async function exitAppInterface(ctx) {
    setUiMode(ctx, 'classic');
    await sendClassicHome(ctx);
}
function chunkArray(items, size) {
    const result = [];
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size));
    }
    return result;
}
function getBadge(stats, item) {
    if (item.badgeKey) {
        const value = stats[item.badgeKey];
        if (value) {
            return value;
        }
    }
    return item.defaultBadge;
}
function buildNavigationKeyboard(stats) {
    const buttons = navigationItems.map((item) => {
        const badge = getBadge(stats, item);
        const label = `${item.emoji} ${item.title}${badge ? ` • ${badge}` : ''}`;
        return Markup.button.callback(label, `${NAVIGATION_ACTION_PREFIX}${item.id}`);
    });
    const rows = chunkArray(buttons, 2);
    rows.push([Markup.button.callback('⌨️ Классический режим', SWITCH_TO_CLASSIC_ACTION)]);
    return Markup.inlineKeyboard(rows);
}
function formatMenuMessage(stats) {
    const header = '🧭 <b>Навигация и сервисы</b>\n[ 🔍 Поиск по разделам ]';
    const body = navigationItems
        .map((item) => {
        const badge = getBadge(stats, item);
        const lines = [`• <b>${item.emoji} ${item.title}</b>${badge ? ` <code>${badge}</code>` : ''}`, `  ${item.description}`];
        return lines.join('\n');
    })
        .join('\n\n');
    const footer = '👇 Нажмите на карточку, чтобы перейти в нужный раздел.';
    return `${header}\n\n${body}\n\n${footer}`;
}
async function collectMenuStats(ctx) {
    const stats = {};
    try {
        const [{ getActiveCategories }, { getActiveReviews }] = await Promise.all([
            import('../../services/shop-service.js'),
            import('../../services/review-service.js'),
        ]);
        const [categories, reviews] = await Promise.all([
            getActiveCategories().catch(() => []),
            getActiveReviews().catch(() => []),
        ]);
        if (categories.length > 0) {
            stats.shop = String(categories.length);
        }
        if (reviews.length > 0) {
            stats.reviews = String(reviews.length);
        }
    }
    catch (error) {
        console.warn('🧭 Navigation: Failed to collect shared stats', error);
    }
    const userId = ctx.from?.id?.toString();
    if (userId) {
        try {
            const user = await ensureUser(ctx);
            if (user) {
                const { getCartItems } = await import('../../services/cart-service.js');
                const cartItems = await getCartItems(user.id);
                const totalQuantity = cartItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
                if (totalQuantity > 0) {
                    stats.cart = String(totalQuantity);
                }
            }
        }
        catch (error) {
            console.warn('🧭 Navigation: Failed to collect cart stats', error);
        }
    }
    return stats;
}
async function sendNavigationMenu(ctx) {
    const stats = await collectMenuStats(ctx);
    const message = formatMenuMessage(stats);
    const keyboard = buildNavigationKeyboard(stats);
    await ctx.reply(message, {
        parse_mode: 'HTML',
        ...keyboard,
    });
}
export function mainKeyboard(webappUrl) {
    return Markup.keyboard([
        [Markup.button.webApp('Каталог', webappUrl)],
    ]).resize();
}
export const navigationModule = {
    async register(bot) {
        // Handle help command
        bot.command('help', async (ctx) => {
            await logUserAction(ctx, 'command:help');
            await ctx.reply('🆘 <b>Справка по боту</b>\n\n' +
                'Доступные команды:\n' +
                '/start - Запустить бота и открыть главное меню\n' +
                '/help - Показать эту справку\n' +
                '/shop - Открыть магазин товаров\n' +
                '/partner - Партнерская программа\n' +
                '/reviews - Отзывы клиентов\n' +
                '/about - О нас\n' +
                '/add_balance - Пополнить баланс через Lava\n' +
                '/support - Поддержка 24/7\n' +
                '/app - Открыть веб-приложение\n\n' +
                'Или используйте кнопки меню для навигации!', { parse_mode: 'HTML' });
        });
        // Handle support command
        bot.command('support', async (ctx) => {
            await logUserAction(ctx, 'command:support');
            await showSupport(ctx);
        });
        // Handle app command - open webapp directly
        bot.command('app', async (ctx) => {
            await logUserAction(ctx, 'command:app');
            await ctx.reply('Каталог', Markup.removeKeyboard());
        });
        bot.start(async (ctx) => {
            await logUserAction(ctx, 'command:start');
            // Проверяем наличие username или phone
            const canContinue = await checkUserContact(ctx);
            if (!canContinue) {
                return; // Пользователь должен предоставить номер телефона
            }
            // Check if user came from referral link
            const startPayload = ctx.startPayload;
            console.log('🔗 Referral: startPayload =', startPayload);
            // Handle new format: username (simple referral link)
            if (startPayload && !startPayload.startsWith('ref_direct_') && !startPayload.startsWith('ref_multi_')) {
                // Try to find user by username
                try {
                    const { prisma } = await import('../../lib/prisma.js');
                    // Check if user already existed before ensuring
                    let existingUserBeforeEnsure = null;
                    if (ctx.from?.id) {
                        try {
                            existingUserBeforeEnsure = await prisma.user.findUnique({
                                where: { telegramId: ctx.from.id.toString() },
                                select: { id: true }
                            });
                        }
                        catch (error) {
                            // Silent fail for DB errors
                            if (error?.code === 'P1013' || error?.message?.includes('Authentication failed')) {
                                existingUserBeforeEnsure = null;
                            }
                        }
                    }
                    const referrerUser = await prisma.user.findFirst({
                        where: {
                            username: startPayload,
                        },
                        include: { partner: true }
                    });
                    if (referrerUser) {
                        console.log('🔗 Referral: Found user by username:', referrerUser.username);
                        // Ensure current user exists first
                        const user = await ensureUser(ctx);
                        if (!user) {
                            console.log('🔗 Referral: Failed to ensure user');
                            return;
                        }
                        const isNewUser = !existingUserBeforeEnsure;
                        console.log('🔗 Referral: Is new user:', isNewUser);
                        // Process referral - create partner profile if it doesn't exist
                        let partnerProfile = referrerUser.partner;
                        if (!partnerProfile) {
                            console.log('🔗 Referral: Partner profile not found, creating one for referrer');
                            const { getOrCreatePartnerProfile } = await import('../../services/partner-service.js');
                            partnerProfile = await getOrCreatePartnerProfile(referrerUser.id, 'DIRECT');
                            console.log('🔗 Referral: Partner profile created:', partnerProfile.id);
                        }
                        // Create referral record
                        if (partnerProfile) {
                            const referralLevel = 1;
                            const programType = partnerProfile.programType || 'DIRECT';
                            await upsertPartnerReferral(partnerProfile.id, referralLevel, user.id, undefined, programType);
                            console.log('🔗 Referral: Referral record created via username');
                        }
                        // Award 3 PZ bonus for new user registration via referral link
                        if (isNewUser) {
                            try {
                                // Check if bonus was already awarded for this referral (using partnerProfile from above)
                                let existingBonus = null;
                                if (partnerProfile) {
                                    existingBonus = await prisma.partnerTransaction.findFirst({
                                        where: {
                                            profileId: partnerProfile.id,
                                            OR: [
                                                { description: { contains: `Бонус 3PZ за приглашение нового пользователя (${user.id})` } },
                                                { description: { contains: `Бонус за приглашение друга (${user.id})` } }
                                            ]
                                        }
                                    });
                                }
                                if (!existingBonus) {
                                    // Award 3PZ bonus to inviter for new user registration
                                    console.log('🔗 Referral: Awarding 3PZ bonus to inviter for new user registration');
                                    let updatedReferrer;
                                    // Use partner profile (created above if didn't exist)
                                    if (partnerProfile) {
                                        await recordPartnerTransaction(partnerProfile.id, 3, `Бонус 3PZ за приглашение нового пользователя (${user.id})`, 'CREDIT');
                                        // Get updated balance after transaction
                                        updatedReferrer = await prisma.user.findUnique({
                                            where: { id: referrerUser.id },
                                            select: {
                                                balance: true,
                                                telegramId: true,
                                                firstName: true
                                            }
                                        });
                                    }
                                    else {
                                        // If no partner profile, update balance directly
                                        updatedReferrer = await prisma.user.update({
                                            where: { id: referrerUser.id },
                                            data: {
                                                balance: {
                                                    increment: 3
                                                }
                                            },
                                            select: {
                                                balance: true,
                                                telegramId: true,
                                                firstName: true
                                            }
                                        });
                                        console.log('🔗 Referral: Bonus 3PZ added directly to referrer balance (no partner profile)');
                                    }
                                    console.log('🔗 Referral: Bonus 3PZ processed, new balance:', updatedReferrer?.balance);
                                    // Send notification to inviter (always send if bonus was awarded)
                                    if (updatedReferrer) {
                                        try {
                                            const joinedLabel = user.username ? `@${user.username}` : (user.firstName || 'пользователь');
                                            const notificationText = '🎉 <b>Баланс пополнен!</b>\n\n' +
                                                `💰 Сумма: 3.00 PZ\n` +
                                                `💳 Текущий баланс: ${updatedReferrer.balance.toFixed(2)} PZ\n\n` +
                                                `✨ К вам присоединился ${joinedLabel} по вашей реферальной ссылке!\n\n` +
                                                `Приглашайте больше друзей и получайте бонусы!`;
                                            await ctx.telegram.sendMessage(referrerUser.telegramId, notificationText, { parse_mode: 'HTML' });
                                            console.log('🔗 Referral: Notification sent successfully to inviter:', referrerUser.telegramId);
                                        }
                                        catch (error) {
                                            console.error('🔗 Referral: Failed to send notification to inviter:', error?.message || error);
                                            // Log full error for debugging
                                            if (error?.response) {
                                                console.error('🔗 Referral: Telegram API error:', JSON.stringify(error.response, null, 2));
                                            }
                                        }
                                    }
                                    else {
                                        console.warn('🔗 Referral: updatedReferrer is null, cannot send notification');
                                    }
                                }
                                else {
                                    console.log('🔗 Referral: Bonus already awarded for this user, skipping');
                                }
                            }
                            catch (error) {
                                console.error('🔗 Referral: Error awarding bonus:', error?.message);
                            }
                        }
                        else {
                            console.log('🔗 Referral: User already exists, bonus not awarded');
                        }
                    }
                }
                catch (error) {
                    console.warn('🔗 Referral: Error processing username referral:', error?.message);
                }
            }
            // Handle old format: ref_direct_CODE or ref_multi_CODE
            if (startPayload && (startPayload.startsWith('ref_direct_') || startPayload.startsWith('ref_multi_'))) {
                const parts = startPayload.split('_');
                console.log('🔗 Referral: parts =', parts);
                const programType = parts[1] === 'direct' ? 'DIRECT' : 'MULTI_LEVEL';
                const referralCode = parts.slice(2).join('_'); // Join remaining parts in case code contains underscores
                console.log('🔗 Referral: programType =', programType, 'referralCode =', referralCode);
                try {
                    // Find partner profile by referral code
                    const { prisma } = await import('../../lib/prisma.js');
                    console.log('🔗 Referral: Searching for partner profile with code:', referralCode);
                    let partnerProfile;
                    try {
                        partnerProfile = await prisma.partnerProfile.findUnique({
                            where: { referralCode },
                            include: { user: true }
                        });
                    }
                    catch (error) {
                        // Silent fail for DB errors - continue without referral processing
                        if (error?.code === 'P1013' || error?.message?.includes('Authentication failed')) {
                            console.warn('🔗 Referral: Database auth error, skipping referral processing');
                            partnerProfile = null;
                        }
                        else {
                            throw error; // Re-throw non-auth errors
                        }
                    }
                    console.log('🔗 Referral: Found partner profile:', partnerProfile ? 'YES' : 'NO');
                    if (partnerProfile) {
                        // Check if user already existed before ensuring
                        let existingUserBeforeEnsure = null;
                        if (ctx.from?.id) {
                            try {
                                existingUserBeforeEnsure = await prisma.user.findUnique({
                                    where: { telegramId: ctx.from.id.toString() },
                                    select: { id: true }
                                });
                            }
                            catch (error) {
                                // Silent fail for DB errors
                                if (error?.code === 'P1013' || error?.message?.includes('Authentication failed')) {
                                    existingUserBeforeEnsure = null;
                                }
                                else {
                                    throw error;
                                }
                            }
                        }
                        // Ensure user exists first
                        const user = await ensureUser(ctx);
                        if (!user) {
                            console.log('🔗 Referral: Failed to ensure user');
                            await ctx.reply('❌ Ошибка при регистрации пользователя.');
                            return;
                        }
                        const isExistingUser = Boolean(existingUserBeforeEnsure);
                        console.log('🔗 Referral: User ensured, upserting referral record');
                        // Use upsert to create or get existing referral record
                        const referralLevel = programType === 'DIRECT' ? 1 : 1; // Both start at level 1
                        const referral = await upsertPartnerReferral(partnerProfile.id, referralLevel, user.id, undefined, programType);
                        // Award bonus only if this is a new user (not existing before)
                        if (!isExistingUser) {
                            // Check if bonus was already awarded for this user
                            const existingBonus = await prisma.partnerTransaction.findFirst({
                                where: {
                                    profileId: partnerProfile.id,
                                    OR: [
                                        { description: { contains: `Бонус за приглашение друга (${user.id})` } },
                                        { description: { contains: `Бонус 3PZ за приглашение нового пользователя (${user.id})` } }
                                    ]
                                }
                            });
                            if (!existingBonus) {
                                // Award 3PZ to the inviter only if not already awarded
                                console.log('🔗 Referral: Awarding 3PZ bonus to inviter for new user');
                                await recordPartnerTransaction(partnerProfile.id, 3, `Бонус 3PZ за приглашение нового пользователя (${user.id})`, 'CREDIT');
                                // Get updated user balance after transaction
                                const updatedReferrer = await prisma.user.findUnique({
                                    where: { id: partnerProfile.userId },
                                    select: {
                                        balance: true,
                                        telegramId: true,
                                        firstName: true
                                    }
                                });
                                console.log('🔗 Referral: Bonus awarded successfully, new balance:', updatedReferrer?.balance);
                                // Send notification to inviter (always send if bonus was awarded)
                                if (updatedReferrer) {
                                    try {
                                        console.log('🔗 Referral: Sending notification to inviter:', updatedReferrer.telegramId);
                                        const joinedLabel = user.username ? `@${user.username}` : (user.firstName || 'пользователь');
                                        const notificationText = '🎉 <b>Баланс пополнен!</b>\n\n' +
                                            `💰 Сумма: 3.00 PZ\n` +
                                            `💳 Текущий баланс: ${updatedReferrer.balance.toFixed(2)} PZ\n\n` +
                                            `✨ К вам присоединился ${joinedLabel} по вашей реферальной ссылке!\n\n` +
                                            `Приглашайте больше друзей и получайте бонусы!`;
                                        await ctx.telegram.sendMessage(updatedReferrer.telegramId, notificationText, { parse_mode: 'HTML' });
                                        console.log('🔗 Referral: Notification sent successfully to inviter');
                                    }
                                    catch (error) {
                                        console.error('🔗 Referral: Failed to send notification to inviter:', error?.message || error);
                                        // Log full error for debugging
                                        if (error?.response) {
                                            console.error('🔗 Referral: Telegram API error:', JSON.stringify(error.response, null, 2));
                                        }
                                    }
                                }
                                else {
                                    console.warn('🔗 Referral: updatedReferrer is null, cannot send notification');
                                }
                            }
                            else {
                                console.log('🔗 Referral: Bonus already awarded for this user, skipping');
                            }
                        }
                        else {
                            console.log('🔗 Referral: User already existed, bonus not awarded');
                        }
                        console.log('🔗 Referral: Sending welcome photo with buttons');
                        await sendWelcomeWithPhoto(ctx, { referralInviterName: partnerProfile.user.firstName || 'партнёр' });
                        console.log('🔗 Referral: Welcome message sent');
                        await logUserAction(ctx, 'partner:referral_joined', {
                            referralCode,
                            partnerId: partnerProfile.id,
                            programType
                        });
                        return; // Don't call renderHome to avoid duplicate greeting
                    }
                    else {
                        console.log('🔗 Referral: Partner profile not found for code:', referralCode);
                        await ctx.reply('❌ Реферальная ссылка недействительна. Партнёр не найден.');
                    }
                }
                catch (error) {
                    console.error('🔗 Referral: Error processing referral:', error);
                    await ctx.reply('❌ Ошибка при обработке реферальной ссылки. Попробуйте позже.');
                }
            }
            await sendWelcomeWithPhoto(ctx);
        });
        bot.hears(['Меню', 'Главное меню', 'Назад'], async (ctx) => {
            await logUserAction(ctx, 'menu:main');
            await renderHome(ctx);
        });
        // Обработчики для кнопок классического меню
        bot.hears('Каталог', async (ctx) => {
            await logUserAction(ctx, 'menu:catalog');
            await ctx.reply('Каталог', Markup.removeKeyboard());
        });
        bot.hears('🛒 Магазин', async (ctx) => {
            await logUserAction(ctx, 'menu:shop');
            const webappUrl = getWebappUrl();
            await ctx.reply('🛒 <b>Открываю магазин...</b>', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '🚀 Открыть магазин',
                                web_app: { url: webappUrl }
                            }
                        ]
                    ]
                }
            });
        });
        bot.hears('🤝 Партнёрка', async (ctx) => {
            await logUserAction(ctx, 'menu:partner');
            const { showPartnerIntro } = await import('../partner/index.js');
            await showPartnerIntro(ctx);
        });
        bot.hears('⭐ Отзывы', async (ctx) => {
            await logUserAction(ctx, 'menu:reviews');
            const { showReviews } = await import('../reviews/index.js');
            await showReviews(ctx);
        });
        bot.hears('ℹ️ О нас', async (ctx) => {
            await logUserAction(ctx, 'menu:about');
            const { showAbout } = await import('../about/index.js');
            await showAbout(ctx);
        });
        bot.action('nav:more', async (ctx) => {
            await ctx.answerCbQuery();
            await logUserAction(ctx, 'cta:detailed-intro');
            await ctx.reply(introDetails);
        });
        bot.action('nav:gift', async (ctx) => {
            await ctx.answerCbQuery();
            await logUserAction(ctx, 'cta:gift');
            await showGiftMessage(ctx);
        });
        bot.action('nav:my_ref_link', async (ctx) => {
            await ctx.answerCbQuery();
            await logUserAction(ctx, 'cta:my_ref_link');
            const user = await ensureUser(ctx);
            if (!user) {
                await ctx.reply('❌ Сначала нужно начать диалог с ботом (/start).');
                return;
            }
            const profile = await getOrCreatePartnerProfile(user.id, 'DIRECT');
            const link = buildReferralLink(profile.referralCode, profile.programType || 'DIRECT', user.username || undefined).main;
            await ctx.reply(`🔗 <b>Ваша реферальная ссылка:</b>\n\n${link}\n\nПоделитесь ссылкой с друзьями — вы получите бонусы с их покупок.`, { parse_mode: 'HTML' });
        });
        for (const item of navigationItems) {
            bot.action(`${NAVIGATION_ACTION_PREFIX}${item.id}`, async (ctx) => {
                await ctx.answerCbQuery();
                await logUserAction(ctx, `menu:${item.id}`, { source: 'navigation-card' });
                try {
                    await item.handler(ctx);
                }
                catch (error) {
                    console.error(`🧭 Navigation: Failed to open section ${item.id}`, error);
                    await ctx.reply('❌ Не удалось открыть раздел. Попробуйте позже.');
                }
            });
        }
        bot.action(SWITCH_TO_CLASSIC_ACTION, async (ctx) => {
            await ctx.answerCbQuery();
            await logUserAction(ctx, 'ui:mode_classic', { source: 'navigation-card' });
            await exitAppInterface(ctx);
        });
        // Handle app help
        bot.action('nav:app:help', async (ctx) => {
            await ctx.answerCbQuery();
            await logUserAction(ctx, 'app:help');
            await ctx.reply('📱 <b>Как пользоваться веб-приложением</b>\n\n' +
                '🌐 <b>Что такое веб-приложение?</b>\n' +
                'Это полнофункциональный интернет-магазин, который открывается прямо в Telegram.\n\n' +
                '✨ <b>Возможности:</b>\n' +
                '• Просмотр каталога товаров\n' +
                '• Добавление в корзину\n' +
                '• Оформление заказов\n' +
                '• Просмотр отзывов\n' +
                '• Партнерская программа\n\n' +
                '🚀 <b>Как открыть:</b>\n' +
                '1. Нажмите кнопку "🚀 Открыть приложение"\n' +
                '2. Приложение откроется в Telegram\n' +
                '3. Используйте как обычный сайт\n\n' +
                '💡 <b>Совет:</b> Веб-приложение работает быстрее и удобнее для покупок!', { parse_mode: 'HTML' });
        });
        // Handle admin reply to user support messages
        bot.action(/^admin_reply:(.+):(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const matches = ctx.match;
            const userTelegramId = matches[1];
            const userName = matches[2];
            // Store the reply context in session for the admin
            if (!ctx.session)
                ctx.session = {};
            ctx.session.replyingTo = {
                userTelegramId,
                userName
            };
            await ctx.reply(`📝 <b>Ответ пользователю ${userName}</b>\n\n` +
                `💭 Напишите ваш ответ следующим сообщением, и он будет отправлен пользователю.`, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '❌ Отменить ответ',
                                callback_data: 'cancel_admin_reply'
                            }
                        ]
                    ]
                }
            });
        });
        // Handle cancel admin reply
        bot.action('cancel_admin_reply', async (ctx) => {
            await ctx.answerCbQuery();
            if (ctx.session && ctx.session.replyingTo) {
                delete ctx.session.replyingTo;
                await ctx.reply('❌ Ответ отменен.');
            }
        });
        // Handle text messages for support
        bot.on('text', async (ctx, next) => {
            // Only process if user is in support mode or sent a support message
            const messageText = ctx.message?.text;
            if (!messageText) {
                await next();
                return;
            }
            // Skip commands and button texts
            if (messageText.startsWith('/')) {
                await next();
                return;
            }
            const buttonTexts = ['🛒 Магазин', '💰 Партнёрка', '⭐ Отзывы', 'ℹ️ О нас', 'Меню', 'Главное меню', 'Назад'];
            if (buttonTexts.includes(messageText)) {
                await next();
                return;
            }
            // Check if this is admin @Aurelia_8888 replying to a user
            const aureliaAdminId = '7077195545';
            if (ctx.from?.id?.toString() === aureliaAdminId && ctx.session?.replyingTo) {
                const { userTelegramId, userName } = ctx.session.replyingTo;
                try {
                    // Send admin's reply to the user
                    await ctx.telegram.sendMessage(userTelegramId, `💬 <b>Ответ службы поддержки:</b>\n\n${messageText}`, { parse_mode: 'HTML' });
                    // Also store reply in DB so WebApp chat can display it
                    try {
                        const { prisma } = await import('../../lib/prisma.js');
                        const user = await prisma.user.findUnique({
                            where: { telegramId: userTelegramId.toString() },
                            select: { id: true }
                        });
                        if (user) {
                            await prisma.userHistory.create({
                                data: {
                                    userId: user.id,
                                    action: 'support:webapp',
                                    payload: { direction: 'admin', text: messageText }
                                }
                            });
                        }
                    }
                    catch (dbErr) {
                        console.error('Failed to log support reply for webapp:', dbErr);
                    }
                    // Confirm to admin
                    await ctx.reply(`✅ <b>Ответ отправлен пользователю ${userName}</b>\n\n` +
                        `💬 Ваше сообщение: "${messageText}"`, { parse_mode: 'HTML' });
                    // Clear the reply context
                    delete ctx.session.replyingTo;
                }
                catch (error) {
                    console.error('Failed to send admin reply to user:', error);
                    await ctx.reply('❌ Не удалось отправить ответ пользователю. Возможно, пользователь заблокировал бота.');
                }
                return;
            }
            // Check if this looks like a support message (not a short response to bot)
            if (messageText.length > 3) {
                await handleSupportMessage(ctx);
                return;
            }
            await next();
        });
    },
};
