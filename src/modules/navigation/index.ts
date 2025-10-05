import { Telegraf, Markup } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { logUserAction, ensureUser } from '../../services/user-history.js';
import { upsertPartnerReferral, recordPartnerTransaction } from '../../services/partner-service.js';
import { prisma } from '../../lib/prisma.js';

const greeting = `👋 Добро пожаловать!
Plazma Water — жидкие витамины и минералы в наноформе.
💧 Усвоение — до 99,9% (в отличие от таблеток 1–10%).
⚡ Быстро, легко и без нагрузки на печень и почки — питание прямо в клетки.

Хотите узнать больше? 👇`;

const introDetails = `💧 Что такое Plazma Water?
Жидкие витамины и минералы в плазменной наноформе ⚡️

✨ Plazma Water — это революционная форма витаминов и микроэлементов, заключённых в чистую воду.
В отличие от таблеток, которые усваиваются всего на 1–10%, плазменная наноформа проникает напрямую в клетки 🧬 и усваивается на 99.9%!

🚀 Частицы настолько малы, что проходят даже через гематоэнцефалический барьер — питая клетки быстро, легко и без нагрузки на печень, почки и другие органы.

💎 Преимущества Plazma Water:
• Без лишних добавок и побочных эффектов
• Усвоение почти 100%
• Поддержка иммунитета и восстановление клеток
• Подходит даже для людей на реабилитации

🛡️ Как это работает:
Наночастицы Plazma Water притягивают вирусы и бактерии ⚔️
Они не убивают их (что часто создаёт токсины), а усыпляют — блокируя размножение и миграцию.
Организм затем мягко выводит всё естественным образом 💨

💠 Результат:
Чистая кровь, лёгкость, энергия и глубокое восстановление 🌿`;

type MenuStats = Partial<Record<'shop' | 'cart' | 'reviews', string>>;

type UiMode = 'classic' | 'app';

type NavigationItem = {
  id: string;
  title: string;
  emoji: string;
  description: string;
  badgeKey?: keyof MenuStats;
  defaultBadge?: string;
  handler: (ctx: Context) => Promise<void>;
};

const NAVIGATION_ACTION_PREFIX = 'nav:menu:';
const SWITCH_TO_CLASSIC_ACTION = 'nav:mode:classic';
const DEFAULT_UI_MODE: UiMode = 'classic';
const WELCOME_VIDEO_URL = 'https://res.cloudinary.com/dt4r1tigf/video/upload/v1759337188/%D0%9F%D0%9E%D0%A7%D0%95%D0%9C%D0%A3_%D0%91%D0%90%D0%94%D0%AB_%D0%BD%D0%B5_%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%B0%D1%8E%D1%82_%D0%95%D1%81%D1%82%D1%8C_%D1%80%D0%B5%D1%88%D0%B5%D0%BD%D0%B8%D0%B5_gz54oh.mp4';

async function showSupport(ctx: Context) {
  await ctx.reply(
    '💬 Служба поддержки\n\nНапишите свой вопрос прямо в этот чат — команда Plazma Water ответит как можно быстрее.\n\nЕсли нужен срочный контакт, оставьте номер телефона, и мы перезвоним.'
  );
}

async function showGiftMessage(ctx: Context) {
  const giftMessage = `🔥 Для Вас уникальный материал.

Аудиофайлы записанные методом Гаряева были списаны с реакторов конкретной плазмы.

Слушая файлы вы можете получить весь спектр воздействия. 👇🏼`;

  await ctx.reply(giftMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🎵 Слушать звуковые матрицы',
            callback_data: 'nav:audio:gift',
          },
        ],
        [
          {
            text: '📖 ГИД по плазменному здоровью',
            url: 'https://t.me/iplasmanano/509',
          },
        ],
      ],
    },
  });
}

const navigationItems: NavigationItem[] = [
  {
    id: 'shop',
    title: 'Магазин',
    emoji: '🛒',
    description: 'Каталог продукции и сезонные наборы',
    badgeKey: 'shop',
    handler: async (ctx) => {
      const { showRegionSelection, showCategories } = await import('../shop/index.js');
      const user = await ensureUser(ctx);
      
      if (user && (user as any).selectedRegion) {
        // User already has a region selected, show categories directly
        await showCategories(ctx, (user as any).selectedRegion);
      } else {
        // User needs to select region first
        await showRegionSelection(ctx);
      }
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
    id: 'sounds',
    title: 'Звуковые матрицы Гаряева',
    emoji: '🎵',
    description: 'Уникальные аудиофайлы для оздоровления',
    handler: async (ctx) => {
      const { showAudioFiles } = await import('../audio/index.js');
      await showAudioFiles(ctx, 'gift');
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
    title: 'О PLASMA',
    emoji: 'ℹ️',
    description: 'Информация о Plazma Water и соцсети',
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

function getUiMode(ctx: Context): UiMode {
  const mode = ctx.session?.uiMode;
  if (mode === 'app' || mode === 'classic') {
    return mode;
  }

  ctx.session.uiMode = DEFAULT_UI_MODE;
  return DEFAULT_UI_MODE;
}

function setUiMode(ctx: Context, mode: UiMode) {
  ctx.session.uiMode = mode;
}

async function sendWelcomeVideo(ctx: Context) {
  await ctx.reply('✨ Plazma Water — это источник энергии нового поколения.', {
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

async function sendClassicHome(ctx: Context) {
  await ctx.reply(greeting, mainKeyboard());
  await sendWelcomeVideo(ctx);
}

async function sendAppHome(
  ctx: Context,
  options: { introText?: string; includeGreeting?: boolean } = {}
) {
  const { introText, includeGreeting = true } = options;

  if (introText) {
    await ctx.reply(introText, Markup.removeKeyboard());
  } else if (includeGreeting) {
    await ctx.reply(greeting, Markup.removeKeyboard());
  }

  await sendNavigationMenu(ctx);
  await sendWelcomeVideo(ctx);
}

async function renderHome(ctx: Context) {
  if (getUiMode(ctx) === 'app') {
    await sendAppHome(ctx);
  } else {
    await sendClassicHome(ctx);
  }
}


async function exitAppInterface(ctx: Context) {
  setUiMode(ctx, 'classic');
  await sendClassicHome(ctx);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function getBadge(stats: MenuStats, item: NavigationItem) {
  if (item.badgeKey) {
    const value = stats[item.badgeKey];
    if (value) {
      return value;
    }
  }
  return item.defaultBadge;
}

function buildNavigationKeyboard(stats: MenuStats) {
  const buttons = navigationItems.map((item) => {
    const badge = getBadge(stats, item);
    const label = `${item.emoji} ${item.title}${badge ? ` • ${badge}` : ''}`;
    return Markup.button.callback(label, `${NAVIGATION_ACTION_PREFIX}${item.id}`);
  });

  const rows = chunkArray(buttons, 2);
  rows.push([Markup.button.callback('⌨️ Классический режим', SWITCH_TO_CLASSIC_ACTION)]);

  return Markup.inlineKeyboard(rows);
}

function formatMenuMessage(stats: MenuStats) {
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

async function collectMenuStats(ctx: Context): Promise<MenuStats> {
  const stats: MenuStats = {};

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
  } catch (error) {
    console.warn('🧭 Navigation: Failed to collect shared stats', error);
  }

  const userId = ctx.from?.id?.toString();
  if (userId) {
    try {
      const { getCartItems } = await import('../../services/cart-service.js');
      const cartItems = await getCartItems(userId);
      const totalQuantity = cartItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      if (totalQuantity > 0) {
        stats.cart = String(totalQuantity);
      }
    } catch (error) {
      console.warn('🧭 Navigation: Failed to collect cart stats', error);
    }
  }

  return stats;
}

async function sendNavigationMenu(ctx: Context) {
  const stats = await collectMenuStats(ctx);
  const message = formatMenuMessage(stats);
  const keyboard = buildNavigationKeyboard(stats);

  await ctx.reply(message, {
    parse_mode: 'HTML',
    ...keyboard,
  });
}

export function mainKeyboard() {
  return Markup.keyboard([
    ['🛒 Магазин', '🤝 Партнёрка'],
    ['🎵 Звуковые матрицы Гаряева'],
    ['⭐ Отзывы', 'ℹ️ О PLASMA'],
  ]).resize();
}

export const navigationModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    bot.start(async (ctx) => {
      await logUserAction(ctx, 'command:start');
      
      // Check if user came from referral link
      const startPayload = ctx.startPayload;
      console.log('🔗 Referral: startPayload =', startPayload);
      
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
          
          const partnerProfile = await prisma.partnerProfile.findUnique({
            where: { referralCode },
            include: { user: true }
          });
          
          console.log('🔗 Referral: Found partner profile:', partnerProfile ? 'YES' : 'NO');
          
          if (partnerProfile) {
            // Ensure user exists first
            const user = await ensureUser(ctx);
            if (!user) {
              console.log('🔗 Referral: Failed to ensure user');
              await ctx.reply('❌ Ошибка при регистрации пользователя.');
              return;
            }
            
            console.log('🔗 Referral: User ensured, upserting referral record');
            
            // Use upsert to create or get existing referral record
            const referralLevel = programType === 'DIRECT' ? 1 : 1; // Both start at level 1
            const referral = await upsertPartnerReferral(partnerProfile.id, referralLevel, user.id, undefined, programType);
            
            // Award bonus only if this is a new referral record (check by creation time)
            const isNewReferral = referral.createdAt.getTime() > Date.now() - 5000; // Created within last 5 seconds
            if (isNewReferral) {
              // Check if bonus was already awarded for this user
              const existingBonus = await prisma.partnerTransaction.findFirst({
                where: {
                  profileId: partnerProfile.id,
                  description: `Бонус за приглашение друга (${user.id})`
                }
              });
              
              if (!existingBonus) {
                // Award 3PZ to the inviter only if not already awarded
                console.log('🔗 Referral: Awarding 3PZ bonus to inviter for new user');
                await recordPartnerTransaction(
                  partnerProfile.id, 
                  3, 
                  `Бонус за приглашение друга (${user.id})`, 
                  'CREDIT'
                );
                console.log('🔗 Referral: Bonus awarded successfully');
              } else {
                console.log('🔗 Referral: Bonus already awarded for this user, skipping');
              }
            } else {
              console.log('🔗 Referral: Existing referral record, no bonus awarded');
            }
            
            // Send notification to inviter only for new referrals
            if (isNewReferral) {
              try {
                console.log('🔗 Referral: Sending notification to inviter:', partnerProfile.user.telegramId);
                await ctx.telegram.sendMessage(
                  partnerProfile.user.telegramId,
                  '🎉 Ваш счет пополнен на 3PZ, приглашайте больше друзей и получайте продукцию за бонусы!'
                );
                console.log('🔗 Referral: Notification sent successfully');
              } catch (error) {
                console.warn('🔗 Referral: Failed to send notification to inviter:', error);
              }
            } else {
              console.log('🔗 Referral: Existing referral, no notification sent');
            }
            
          console.log('🔗 Referral: Sending welcome message with bonus info');
          await ctx.reply(`👋 Добро пожаловать!

🎉 Вас пригласил ${partnerProfile.user.firstName || 'партнёр'}

✨ Plazma Water — жидкие витамины и минералы в наноформе.
💧 Усвоение — до 99,9% (в отличие от таблеток 1–10%).
⚡ Быстро, легко и без нагрузки на печень и почки — питание прямо в клетки.

Хотите узнать больше? 👇`);
          console.log('🔗 Referral: Welcome message sent');
          
          await logUserAction(ctx, 'partner:referral_joined', {
            referralCode,
            partnerId: partnerProfile.id,
            programType
          });
          console.log('🔗 Referral: User action logged');
          
          // For referral users, send navigation menu without greeting
          await sendNavigationMenu(ctx);
          await sendWelcomeVideo(ctx);
          return; // Don't call renderHome to avoid duplicate greeting
        } else {
          console.log('🔗 Referral: Partner profile not found for code:', referralCode);
          await ctx.reply('❌ Реферальная ссылка недействительна. Партнёр не найден.');
        }
      } catch (error) {
        console.error('🔗 Referral: Error processing referral:', error);
        await ctx.reply('❌ Ошибка при обработке реферальной ссылки. Попробуйте позже.');
      }
    }

    await renderHome(ctx);
    });


    bot.hears(['Меню', 'Главное меню', 'Назад'], async (ctx) => {
      await logUserAction(ctx, 'menu:main');
      await renderHome(ctx);
    });

    // Обработчики для кнопок классического меню
    bot.hears('🛒 Магазин', async (ctx) => {
      await logUserAction(ctx, 'menu:shop');
      const { showCategories } = await import('../shop/index.js');
      await showCategories(ctx);
    });

    bot.hears('🤝 Партнёрка', async (ctx) => {
      await logUserAction(ctx, 'menu:partner');
      const { showPartnerIntro } = await import('../partner/index.js');
      await showPartnerIntro(ctx);
    });

    bot.hears('🎵 Звуковые матрицы Гаряева', async (ctx) => {
      await logUserAction(ctx, 'menu:sounds');
      const { showAudioFiles } = await import('../audio/index.js');
      await showAudioFiles(ctx, 'gift');
    });

    bot.hears('⭐ Отзывы', async (ctx) => {
      await logUserAction(ctx, 'menu:reviews');
      const { showReviews } = await import('../reviews/index.js');
      await showReviews(ctx);
    });

    bot.hears('ℹ️ О PLASMA', async (ctx) => {
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

    bot.action('nav:audio:gift', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'cta:audio:gift');
      const { showAudioFiles } = await import('../audio/index.js');
      await showAudioFiles(ctx, 'gift');
    });

    for (const item of navigationItems) {
      bot.action(`${NAVIGATION_ACTION_PREFIX}${item.id}`, async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, `menu:${item.id}`, { source: 'navigation-card' });

        try {
          await item.handler(ctx);
        } catch (error) {
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



  },
};
