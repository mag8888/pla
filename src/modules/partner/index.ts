import { Markup, Telegraf } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { ensureUser, logUserAction } from '../../services/user-history.js';
import { buildReferralLink, getOrCreatePartnerProfile, getPartnerDashboard, getPartnerList } from '../../services/partner-service.js';
import { getBotContent } from '../../services/bot-content-service.js';
import { prisma } from '../../lib/prisma.js';
import { PartnerProgramType } from '@prisma/client';
import { generateAndUploadQRCode } from '../../services/qr-service.js';

// Тип для партнерского реферала с включенными данными
type PartnerReferralWithUser = {
  id: string;
  profileId: string;
  referredId: string | null;
  contact: string | null;
  level: number;
  referralType: any;
  createdAt: Date;
  profile: {
    id: string;
    userId: string;
    user: {
      username: string | null;
      firstName: string | null;
      telegramId: string;
    };
  };
};

const DASHBOARD_ACTION = 'partner:dashboard';
const DIRECT_PLAN_ACTION = 'partner:plan:direct';
const MULTI_PLAN_ACTION = 'partner:plan:multi';
const PARTNERS_ACTION = 'partner:list';
const INVITE_ACTION = 'partner:invite';
const INVITE_DIRECT_ACTION = 'partner:invite:direct';
const INVITE_MULTI_ACTION = 'partner:invite:multi';
const PARTNERS_LEVEL_1_ACTION = 'partner:level:1';
const PARTNERS_LEVEL_2_ACTION = 'partner:level:2';
const PARTNERS_LEVEL_3_ACTION = 'partner:level:3';

// Fallback тексты, если контент не найден в БД
const fallbackProgramIntro = `👋 Станьте партнёром Plazma Water!

Вы можете рекомендовать друзьям здоровье и получать пассивный доход.

💸 15% от каждой покупки по вашей ссылке.

+5% от покупок второй и 5% третьей линии

🔗 Достаточно поделиться своей персональной ссылкой.`;

const cardTemplate = (params: {
  balance: string;
  partners: number;
  direct: number;
  bonus: string;
  referral?: string;
  transactions: string[];
  isActive?: boolean;
  expiresAt?: Date;
  activationStatus?: string;
}) => `🧾 Карточка клиента (личный кабинет)
	•	💰 Баланс: [${params.balance} PZ]
	•	👥 Партнёры: [${params.partners}]
	•	🎁 Всего бонусов: [${params.bonus} PZ]
${params.transactions.length > 0 ? `	•	📊 История начислений:\n${params.transactions.join('\n')}` : '	•	📊 История начислений: [список транзакций]'}
${params.activationStatus || ''}`;

const fallbackDirectPlanText = `Прямая комиссия — 25%
Делитесь ссылкой → получаете 25% от всех покупок друзей.

💡 Условия бонуса:
• Ваш бонус 10%
• Бонус 25% начнет действовать при Вашей активности 120PZ в месяц

📲 Выбирайте удобный формат и начинайте зарабатывать уже сегодня!`;

const fallbackMultiPlanText = `Многоуровневая система — 15% + 5% + 5%
	•	15% с покупок ваших друзей (1-й уровень)
	•	5% с покупок их друзей (2-й уровень)
	•	5% с покупок следующего уровня (3-й уровень)

💡 Условия бонуса:
• Ваш бонус 10%
• Бонус 15%+5%+5% начнет действовать при Вашей активности 120PZ в месяц

📲 Выбирайте удобный формат и начинайте зарабатывать уже сегодня!`;

function planKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Карточка клиента', DASHBOARD_ACTION)],
    [Markup.button.callback('📈 15% + 5% + 5%', MULTI_PLAN_ACTION)],
    [Markup.button.callback('📋 Подробнее', 'partner:details')],
  ]);
}

function partnerActionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 Мои партнёры', PARTNERS_ACTION), Markup.button.callback('📤 Пригласить друга', INVITE_MULTI_ACTION)],
  ]);
}

function partnerLevelsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👤 Партнёры: 1-й', PARTNERS_LEVEL_1_ACTION)],
    [Markup.button.callback('👥 Партнёры: 2-й', PARTNERS_LEVEL_2_ACTION)],
    [Markup.button.callback('👨‍👩‍👧‍👦 Партнёры: 3-й', PARTNERS_LEVEL_3_ACTION)],
  ]);
}

async function showDashboard(ctx: Context) {
  const user = await ensureUser(ctx);
  if (!user) {
    await ctx.reply('Не удалось загрузить кабинет. Попробуйте позже.');
    return;
  }

  const dashboard = await getPartnerDashboard(user.id);
  if (!dashboard) {
    await ctx.reply('Вы ещё не активировали партнёрскую программу. Выберите формат участия.');
    return;
  }

  const { profile, stats } = dashboard;

  // Берем только последние 3 транзакции и улучшаем их отображение
  const recentTransactions = profile.transactions.slice(0, 3);

  // Собираем все ID пользователей из транзакций для запроса в БД
  const userIds = new Set<string>();
  recentTransactions.forEach(tx => {
    if (tx.description.includes('приглашение друга') && tx.description.includes('(')) {
      const userIdMatch = tx.description.match(/\(([^)]+)\)/);
      if (userIdMatch) {
        userIds.add(userIdMatch[1]);
      }
    }
  });

  // Получаем информацию о пользователях
  const users = userIds.size > 0 ? await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, username: true, firstName: true }
  }) : [];

  // Создаем мапу для быстрого поиска пользователей
  const userMap = new Map(users.map(user => [user.id, user]));

  const transactions = recentTransactions.map((tx) => {
    const sign = tx.type === 'CREDIT' ? '+' : '-';
    const amount = Number(tx.amount).toFixed(2);

    // Улучшаем описание транзакции
    let description = tx.description;

    // Если это бонус за приглашение друга, пытаемся получить имя пользователя
    if (tx.description.includes('приглашение друга') && tx.description.includes('(')) {
      const userIdMatch = tx.description.match(/\(([^)]+)\)/);
      if (userIdMatch) {
        const userId = userIdMatch[1];
        const user = userMap.get(userId);
        if (user) {
          const displayName = user.username ? `@${user.username}` : (user.firstName || `ID:${userId.slice(-5)}`);
          description = `Бонус за приглашение ${displayName}`;
        }
      }
    }

    return `${sign}${amount} PZ — ${description}`;
  });

  // Проверяем статус активации партнерки
  console.log('🔍 Partner: Profile activation status:', {
    isActive: (profile as any).isActive,
    expiresAt: (profile as any).expiresAt,
    activationType: (profile as any).activationType
  });

  let activationStatus = '';
  if ((profile as any).isActive) {
    const expiresAt = (profile as any).expiresAt;
    if (expiresAt) {
      const now = new Date();
      const expiration = new Date(expiresAt);
      const daysLeft = Math.ceil((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysLeft > 0) {
        activationStatus = `\n✅ Активация партнерки 25% до ${expiration.toLocaleDateString('ru-RU')} (осталось ${daysLeft} дней)`;
      } else {
        activationStatus = '\n❌ Активация партнерки истекла';
      }
    } else {
      activationStatus = '\n✅ Активация партнерки активна';
    }
  } else {
    // Вычисляем сколько нужно до активации (120 PZ товарооборот)
    const currentTurnover = Number(profile.balance); // Используем баланс как показатель активности
    const neededTurnover = 120;
    const remainingTurnover = Math.max(0, neededTurnover - currentTurnover);

    if (remainingTurnover > 0) {
      activationStatus = `\n⏳ До активации партнерки осталось ${remainingTurnover} PZ товарооборота (нужно 120 PZ в месяц)`;
    } else {
      activationStatus = '\n🎯 Достаточно активности для активации партнерки!';
    }
  }

  // Use profile.balance (synced with user.balance in recalculatePartnerBonuses)
  const message = cardTemplate({
    balance: Number(profile.balance).toFixed(2),
    partners: stats.partners,
    direct: stats.directPartners,
    bonus: Number(profile.bonus).toFixed(2),
    referral: buildReferralLink(profile.referralCode, profile.programType as PartnerProgramType, user.username || undefined).main,
    transactions,
    isActive: (profile as any).isActive,
    expiresAt: (profile as any).expiresAt,
    activationStatus,
  });

  console.log('🔍 Partner: Final activation status:', activationStatus);
  console.log('🔍 Partner: Final message preview:', message.substring(0, 200) + '...');

  await ctx.reply(message, partnerActionsKeyboard());
}

async function handlePlanSelection(
  ctx: Context,
  programType: PartnerProgramType,
  message: string
): Promise<boolean> {
  console.log('💰 Partner: handlePlanSelection called with type:', programType);

  try {
    const user = await ensureUser(ctx);
    if (!user) {
      console.log('💰 Partner: Failed to ensure user');
      await ctx.reply('Не удалось активировать программу. Попробуйте позже.');
      return false;
    }

    console.log('💰 Partner: User ensured, creating profile');
    const profile = await getOrCreatePartnerProfile(user.id, programType);
    console.log('💰 Partner: Profile created:', profile.referralCode);

    await logUserAction(ctx, 'partner:select-program', { programType });

    const referralLink = buildReferralLink(profile.referralCode, programType, user.username || undefined);
    console.log('💰 Partner: Generated referral link:', referralLink);

    await ctx.reply(
      `${message}\n\nВаша ссылка: ${referralLink}`,
      partnerActionsKeyboard()
    );
    return true;
  } catch (error) {
    console.error('💰 Partner: Failed to handle plan selection', error);
    await ctx.reply('❌ Не удалось обработать запрос. Попробуйте позже.');
    return false;
  }
}

async function showPartners(ctx: Context) {
  const user = await ensureUser(ctx);
  if (!user) {
    await ctx.reply('Не удалось загрузить список партнёров.');
    return;
  }

  const dashboard = await getPartnerDashboard(user.id);
  if (!dashboard) {
    await ctx.reply('Вы ещё не активировали программу.');
    return;
  }

  const { stats } = dashboard;
  const partnerList = await getPartnerList(user.id);

  await ctx.answerCbQuery();

  let message = `👥 Мои партнёры\n\n📊 Статистика:\nВсего: ${stats.partners}\nПрямых: ${stats.directPartners}\n\n`;

  if (partnerList) {
    // Show direct partners
    if (partnerList.directPartners.length > 0) {
      message += `🎯 Прямые партнёры (1-й уровень):\n`;
      partnerList.directPartners.forEach((partner, index) => {
        const displayName = partner.username ? `@${partner.username}` : partner.firstName || `ID:${partner.telegramId}`;
        message += `${index + 1}. ${displayName}\n`;
      });
      message += '\n';
    }

    // Show multi-level partners
    if (partnerList.multiPartners.length > 0) {
      message += `🌳 Многоуровневые партнёры:\n`;
      partnerList.multiPartners.forEach((partner, index) => {
        const displayName = partner.username ? `@${partner.username}` : partner.firstName || `ID:${partner.telegramId}`;
        message += `${index + 1}. ${displayName} (${partner.level}-й уровень)\n`;
      });
    }

    if (partnerList.directPartners.length === 0 && partnerList.multiPartners.length === 0) {
      message += `📭 Пока нет партнёров.\nПриглашайте друзей по вашей реферальной ссылке!`;
    }
  }

  await ctx.reply(message);
}

async function showPartnersByLevel(ctx: Context, level: number) {
  const user = await ensureUser(ctx);
  if (!user) {
    await ctx.reply('Не удалось загрузить список партнёров.');
    return;
  }

  const dashboard = await getPartnerDashboard(user.id);
  if (!dashboard) {
    await ctx.reply('Вы ещё не активировали программу.');
    return;
  }

  await ctx.answerCbQuery();

  console.log(`🔍 Partner: Looking for level ${level} partners for user ${user.id}, profile ${dashboard.profile.id}`);

  // Получаем список партнеров конкретного уровня
  let partnerReferrals: PartnerReferralWithUser[] = [];

  if (level === 1) {
    // Прямые партнеры - те, кто пришел по нашей ссылке
    partnerReferrals = await prisma.partnerReferral.findMany({
      where: {
        profileId: dashboard.profile.id,
        level: 1
      },
      include: {
        profile: {
          include: {
            user: {
              select: { username: true, firstName: true, telegramId: true }
            }
          }
        }
      }
    });

    console.log(`🔍 Partner: Found ${partnerReferrals.length} level 1 partners`);
    partnerReferrals.forEach((p, index) => {
      console.log(`🔍 Partner: Level 1 partner ${index + 1}:`, {
        referredId: p.referredId,
        username: p.profile.user.username,
        firstName: p.profile.user.firstName,
        profileId: p.profileId
      });
    });

    // Дополнительная проверка: кто пригласил каждого из прямых партнеров
    for (const partner of partnerReferrals) {
      if (partner.referredId) {
        const whoInvitedThisPartner = await prisma.partnerReferral.findMany({
          where: { referredId: partner.referredId },
          include: {
            profile: {
              include: {
                user: {
                  select: { username: true, firstName: true }
                }
              }
            }
          }
        });

        console.log(`🔍 Partner: Who invited ${partner.referredId}:`, whoInvitedThisPartner.map(p => ({
          inviterUsername: p.profile.user.username,
          inviterFirstName: p.profile.user.firstName,
          profileId: p.profileId
        })));
      }
    }
  } else if (level === 2) {
    // Партнеры 2-го уровня - партнеры наших партнеров
    // Сначала находим наших прямых партнеров
    const directPartners = await prisma.partnerReferral.findMany({
      where: {
        profileId: dashboard.profile.id,
        level: 1
      },
      select: { referredId: true }
    });

    console.log(`🔍 Partner: Found ${directPartners.length} direct partners:`, directPartners.map(p => p.referredId));

    if (directPartners.length > 0) {
      const directPartnerIds = directPartners.map(p => p.referredId).filter((id): id is string => Boolean(id));
      console.log(`🔍 Partner: Direct partner IDs for level 2 search:`, directPartnerIds);

      // Теперь находим партнеров наших прямых партнеров
      // Сначала нужно найти profileId наших прямых партнеров
      const directPartnerProfiles = await prisma.partnerProfile.findMany({
        where: { userId: { in: directPartnerIds } },
        select: { id: true, userId: true }
      });

      const directPartnerProfileIds = directPartnerProfiles.map(p => p.id);
      console.log(`🔍 Partner: Direct partner profile IDs for level 2 search:`, directPartnerProfileIds);

      // Теперь ищем партнеров наших прямых партнеров
      partnerReferrals = await prisma.partnerReferral.findMany({
        where: {
          profileId: { in: directPartnerProfileIds }
        },
        include: {
          profile: {
            include: {
              user: {
                select: { username: true, firstName: true, telegramId: true }
              }
            }
          }
        }
      });

      console.log(`🔍 Partner: Found ${partnerReferrals.length} second level partners`);
    }
  } else if (level === 3) {
    // Партнеры 3-го уровня - партнеры партнеров наших партнеров
    const directPartners = await prisma.partnerReferral.findMany({
      where: {
        profileId: dashboard.profile.id,
        level: 1
      },
      select: { referredId: true }
    });

    if (directPartners.length > 0) {
      const directPartnerIds = directPartners.map(p => p.referredId).filter((id): id is string => Boolean(id));

      // Находим profileId наших прямых партнеров
      const directPartnerProfiles = await prisma.partnerProfile.findMany({
        where: { userId: { in: directPartnerIds } },
        select: { id: true, userId: true }
      });

      const directPartnerProfileIds = directPartnerProfiles.map(p => p.id);
      console.log(`🔍 Partner: Direct partner profile IDs for level 3 search:`, directPartnerProfileIds);

      // Находим партнеров наших прямых партнеров (2-й уровень)
      const secondLevelPartners = await prisma.partnerReferral.findMany({
        where: {
          profileId: { in: directPartnerProfileIds }
        },
        select: { referredId: true }
      });

      if (secondLevelPartners.length > 0) {
        const secondLevelPartnerIds = secondLevelPartners.map(p => p.referredId).filter((id): id is string => Boolean(id));
        console.log(`🔍 Partner: Second level partner IDs for level 3 search:`, secondLevelPartnerIds);

        // Находим profileId партнеров 2-го уровня
        const secondLevelPartnerProfiles = await prisma.partnerProfile.findMany({
          where: { userId: { in: secondLevelPartnerIds } },
          select: { id: true, userId: true }
        });

        const secondLevelPartnerProfileIds = secondLevelPartnerProfiles.map(p => p.id);
        console.log(`🔍 Partner: Second level partner profile IDs for level 3 search:`, secondLevelPartnerProfileIds);

        // Находим партнеров партнеров наших партнеров (3-й уровень)
        partnerReferrals = await prisma.partnerReferral.findMany({
          where: {
            profileId: { in: secondLevelPartnerProfileIds }
          },
          include: {
            profile: {
              include: {
                user: {
                  select: { username: true, firstName: true, telegramId: true }
                }
              }
            }
          }
        });

        console.log(`🔍 Partner: Found ${partnerReferrals.length} third level partners`);
      }
    }
  }

  console.log(`🔍 Partner: Found ${partnerReferrals.length} partners for level ${level}`);

  let message = `👥 Партнёры ${level}-го уровня\n\n`;

  if (level === 1) {
    message += `Прямые партнёры (${partnerReferrals.length}):\n`;
    message += `Получаете 15% с их покупок\n\n`;
  } else if (level === 2) {
    message += `Партнёры 2-го уровня (${partnerReferrals.length}):\n`;
    message += `Получаете 5% с их покупок\n\n`;
  } else if (level === 3) {
    message += `Партнёры 3-го уровня (${partnerReferrals.length}):\n`;
    message += `Получаете 5% с их покупок\n\n`;
  }

  if (partnerReferrals.length === 0) {
    message += `📭 Пока нет партнёров ${level}-го уровня.\nПриглашайте друзей по вашей реферальной ссылке!`;
  } else {
    // Получаем информацию о приглашенных пользователях
    const referredUserIds = partnerReferrals.map(r => r.referredId).filter((id): id is string => Boolean(id));
    const referredUsers = referredUserIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: referredUserIds } },
      select: { id: true, username: true, firstName: true, telegramId: true }
    }) : [];

    const userMap = new Map(referredUsers.map(user => [user.id, user]));

    partnerReferrals.forEach((referral, index) => {
      if (referral.referredId) {
        const referredUser = userMap.get(referral.referredId);
        if (referredUser) {
          const displayName = referredUser.username ? `@${referredUser.username}` : (referredUser.firstName || `ID:${referredUser.telegramId}`);
          message += `${index + 1}. ${displayName}\n`;
        } else {
          message += `${index + 1}. ID:${referral.referredId.slice(-5)}\n`;
        }
      }
    });
  }

  await ctx.reply(message, partnerLevelsKeyboard());
}

async function showInvite(ctx: Context) {
  // Перенаправляем на многоуровневую ссылку
  await showMultiInvite(ctx);
}

async function showDirectInvite(ctx: Context) {
  const user = await ensureUser(ctx);
  if (!user) {
    await ctx.reply('Не удалось получить ссылку.');
    return;
  }

  const dashboard = await getPartnerDashboard(user.id);
  if (!dashboard) {
    await ctx.reply('Активируйте один из тарифов, чтобы получить ссылку.');
    return;
  }

  await ctx.answerCbQuery('Ссылка скопирована', { show_alert: false });

  const referralLink = buildReferralLink(dashboard.profile.referralCode, 'DIRECT', user.username || undefined).main;
  /* 
   * NOTE: We cast to any here because sometimes Prisma types lag behind 
   * after schema updates in the dev environment.
   */
  let qrUrl = (dashboard.profile as any).referralDirectQrUrl;

  // Generate QR if missing
  if (!qrUrl) {
    try {
      const generatingMsg = await ctx.reply('⏳ Генерирую QR-код...');
      qrUrl = await generateAndUploadQRCode(referralLink, 'vital/qr-codes', `qr_direct_${dashboard.profile.referralCode}`);

      // Save to profile
      await prisma.partnerProfile.update({
        where: { id: dashboard.profile.id },
        data: { referralDirectQrUrl: qrUrl } as any
      });

      await ctx.telegram.deleteMessage(ctx.chat?.id as any, generatingMsg.message_id);
    } catch (error) {
      console.error('Failed to generate QR:', error);
      // Continue without QR if failed
    }
  }

  if (qrUrl) {
    await ctx.replyWithPhoto(qrUrl, { caption: '📱 Ваш персональный QR-код' });
  }

  const shareGuide = `💫 Хочешь получать бонусы от рекомендаций?\nПросто перешли это сообщение выше друзьям или в свои чаты — прямо как оно есть.\n\n🔗 Бот автоматически закрепит всех, кто перейдёт по твоей ссылке, за тобой.\nТы будешь получать 25% с покупок твоих друзей.\n\n📩 Чтобы поделиться:\n1️⃣ Нажми и удерживай сообщение\n2️⃣ Выбери «Переслать»\n3️⃣ Отправь его своим друзьям или в чаты\n\nВот и всё — система сама всё посчитает 🔥`;

  await ctx.reply(`Дружище 🌟\nЯ желаю тебе энергии, здоровья и внутренней силы, поэтому делюсь с тобой этим ботом 💧\nПопробуй PLAZMA — структурированная вода для здоровья, которая реально меняет состояние ⚡️\n🔗 Твоя ссылка:\n${referralLink}`);
  await ctx.reply(shareGuide);
}

async function showMultiInvite(ctx: Context) {
  // Multi-level logic is now same as Direct (Single Level 25%)
  // Redirect to showDirectInvite to ensure consistency
  return showDirectInvite(ctx);
}

export const partnerModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    // Handle partner command
    bot.command('partner', async (ctx) => {
      try {
        await logUserAction(ctx, 'command:partner');
        await showPartnerIntro(ctx);
      } catch (error) {
        console.error('💰 Partner: Failed to process /partner command', error);
        await ctx.reply('❌ Не удалось открыть партнёрский раздел. Попробуйте позже.');
      }
    });

    bot.hears(['Партнёрка', 'Партнерка', '💰 Партнёрка'], async (ctx) => {
      try {
        console.log('💰 Partner: Button pressed');
        await logUserAction(ctx, 'menu:partners');
        console.log('💰 Partner: Sending program intro');
        await showPartnerIntro(ctx);
      } catch (error) {
        console.error('💰 Partner: Failed to process partner menu', error);
        await ctx.reply('❌ Не удалось открыть партнёрский раздел. Попробуйте позже.');
      }
    });

    bot.action(DASHBOARD_ACTION, async (ctx) => {
      console.log('💰 Partner: Dashboard button pressed');
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'partner:dashboard');
      await showDashboard(ctx);
    });

    bot.action(DIRECT_PLAN_ACTION, async (ctx) => {
      console.log('💰 Partner: Direct plan button pressed');
      const directPlanText = await getBotContent('direct_plan_text') || fallbackDirectPlanText;
      const success = await handlePlanSelection(ctx, 'DIRECT', directPlanText);
      await ctx.answerCbQuery(success ? 'Партнёрская программа (25%) активирована' : 'Не удалось активировать программу');
    });

    bot.action(MULTI_PLAN_ACTION, async (ctx) => {
      console.log('💰 Partner: Multi-level button pressed, redirecting to Direct');
      const directPlanText = await getBotContent('direct_plan_text') || fallbackDirectPlanText;
      const success = await handlePlanSelection(ctx, 'DIRECT', directPlanText);
      await ctx.answerCbQuery(success ? 'Партнёрская программа (25%) активирована' : 'Не удалось активировать программу');
    });

    bot.action(PARTNERS_ACTION, async (ctx) => {
      await logUserAction(ctx, 'partner:list');
      await showPartners(ctx);
    });

    bot.action(INVITE_ACTION, async (ctx) => {
      await logUserAction(ctx, 'partner:invite');
      await showInvite(ctx);
    });

    bot.action(INVITE_DIRECT_ACTION, async (ctx) => {
      // Перенаправляем на многоуровневую ссылку
      await logUserAction(ctx, 'partner:invite:multi');
      await showMultiInvite(ctx);
    });

    bot.action(INVITE_MULTI_ACTION, async (ctx) => {
      await logUserAction(ctx, 'partner:invite:multi');
      await showMultiInvite(ctx);
    });

    bot.action(PARTNERS_LEVEL_1_ACTION, async (ctx) => {
      await logUserAction(ctx, 'partner:level:1');
      await showPartnersByLevel(ctx, 1);
    });

    bot.action(PARTNERS_LEVEL_2_ACTION, async (ctx) => {
      await logUserAction(ctx, 'partner:level:2');
      await showPartnersByLevel(ctx, 2);
    });

    bot.action(PARTNERS_LEVEL_3_ACTION, async (ctx) => {
      await logUserAction(ctx, 'partner:level:3');
      await showPartnersByLevel(ctx, 3);
    });

    bot.action('partner:details', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'partner:details');
      await showPartnerDetails(ctx);
    });

    bot.action('partner:how_it_works', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'partner:how_it_works');
      await showHowItWorks(ctx);
    });

    bot.action('partner:more', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'partner:more');
      await showMoreDetails(ctx);
    });

    bot.action('partner:offer', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'partner:offer');
      await showPartnerOffer(ctx);
    });
  },
};

export async function showPartnerIntro(ctx: Context) {
  try {
    const programIntro = (await getBotContent('partner_intro')) || fallbackProgramIntro;
    await ctx.reply(programIntro, planKeyboard());
  } catch (error) {
    console.error('💰 Partner: Failed to load intro content', error);
    await ctx.reply(fallbackProgramIntro, planKeyboard());
  }
}

async function showPartnerDetails(ctx: Context) {
  const text = `💠 Реферальная программа Plazma Water
Любой продукт нуждается в маркетинге —
и мы решили отдавать маркетинговый бюджет клиентам!
Теперь ты можешь зарабатывать 25%, просто рекомендуя Plazma Water = здоровье 💧`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🤔 Как работает?!', 'partner:how_it_works')]
  ]);

  await ctx.reply(text, keyboard);
}

async function showHowItWorks(ctx: Context) {
  const text = `Как это работает 👇
👥 Делись ссылкой с друзьями
💸 Получай 25% от их покупок
🌟 Хочешь больше?
Стань партнёром и получай 25% дохода + скидку 10%
(при покупке на 15 000 ₽)`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📈 Больше', 'partner:more')]
  ]);

  await ctx.reply(text, keyboard);
}

async function showMoreDetails(ctx: Context) {
  const text = `Хочешь получать высокий доход? 📈
Партнёрская программа даёт 25% с каждой покупки по твоей ссылке!

💵 Пример:
1️⃣ Пригласил друга, он купил на 15 000 ₽
2️⃣ Твой бонус: 3 750 ₽ (25%)
3️⃣ Пригласил 10 друзей = 37 500 ₽

⚡️ Рекомендуй Plazma Water — помогай друзьям, повышай вибрации и зарабатывай 💎`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Карточка клиента', DASHBOARD_ACTION)],
    [Markup.button.callback('💎 Стать партнером (25%)', DIRECT_PLAN_ACTION)],
    [Markup.button.callback('📋 Оферта', 'partner:offer')]
  ]);

  await ctx.reply(text, keyboard);
}

async function showPartnerOffer(ctx: Context) {
  const text = `💎 ПРАВИЛА ПАРТНЁРСКОЙ ПРОГРАММЫ Plazma Water

📖 ОБЩИЕ ПОЛОЖЕНИЯ:

Партнёрская программа создана для продвижения и продаж продукции Plazma Water 💧
Участвовать может каждый — регистрация бесплатна.

⸻

🧾 Регистрация

🪄 Регистрация проходит прямо в боте.
После входа ты получаешь:
• персональный реферальный код (ссылку) 🔗
• доступ в личный кабинет для отслеживания заказов и дохода.

⸻

💰 Вознаграждения

💎 Партнёр (доход 25%)
— соверши покупку на 15 000 ₽
— получай 25% дохода от всех заказов твоих рефералов
— моментальные начисления

🧍‍♂️ Клиенты закрепляются за тобой навсегда после первой покупки.

⸻

💼 Личный кабинет

В кабинете ты можешь:
📊 отслеживать статистику и баланс
🛒 пользоваться личным магазином
💸 выводить средства от 3 000 ₽

⸻

⚠️ Важно

🚫 Используй только свою реферальную ссылку, выданную в кабинете.
🚫 Запрещены:
• спам и вводящая в заблуждение реклама
• регистрация родственников или фейковых аккаунтов

🔒 За нарушения аккаунт может быть удалён без восстановления.

⸻

💳 Вывод средств

📆 Заявки принимаются до 1-го числа каждого месяца.
💰 Выплаты производятся с 1 по 5 число.
📨 Для вывода укажи реквизиты администратору в службе заботы.

⸻

⚖️ Ответственность и изменения

Компания может обновлять условия программы с уведомлением участников.
Партнёр несёт ответственность за корректность информации и рекламных материалов.

⸻

✅ Согласие

Регистрируясь, ты подтверждаешь, что прочитал и согласен с правилами программы.
Правила действуют с момента публикации в боте и на официальном сайте Plazma Water 💧`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Карточка клиента', DASHBOARD_ACTION)],
    [Markup.button.callback('💎 Стать партнером (25%)', DIRECT_PLAN_ACTION)]
  ]);

  await ctx.reply(text, keyboard);
}
