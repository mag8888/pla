import { Markup, Telegraf } from 'telegraf';
import { PartnerProgramType } from '@prisma/client';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { ensureUser, logUserAction } from '../../services/user-history.js';
import { buildReferralLink, getOrCreatePartnerProfile, getPartnerDashboard, getPartnerList } from '../../services/partner-service.js';
import { prisma } from '../../lib/prisma.js';

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

const programIntro = `✨ Описание партнёрской программы

👋 Станьте партнёром Plazma Water!
Вы можете рекомендовать друзьям здоровье и получать пассивный доход.

💸 25% от каждой покупки по вашей ссылке.
🔗 Достаточно поделиться своей персональной ссылкой.

⸻

📌 У нас есть 2 формата участия:`;

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

const directPlanText = `(на кнопку 25%) Прямая комиссия — 25%
Делитесь ссылкой → получаете 25% от всех покупок друзей.

💡 Условия бонуса:
• Ваш бонус 10%
• Бонус 25% начнет действовать при Вашей активности 200PZ в месяц

📲 Выбирайте удобный формат и начинайте зарабатывать уже сегодня!`;

const multiPlanText = `(на кнопку 15% + 5% + 5%) Многоуровневая система — 15% + 5% + 5%
	•	15% с покупок ваших друзей (1-й уровень)
	•	5% с покупок их друзей (2-й уровень)
	•	5% с покупок следующего уровня (3-й уровень)

💡 Условия бонуса:
• Ваш бонус 10%
• Бонус 15%+5%+5% начнет действовать при Вашей активности 200PZ в месяц

📲 Выбирайте удобный формат и начинайте зарабатывать уже сегодня!`;

function planKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Карточка клиента', DASHBOARD_ACTION)],
    [Markup.button.callback('💰 25%', DIRECT_PLAN_ACTION), Markup.button.callback('📈 15% + 5% + 5%', MULTI_PLAN_ACTION)],
  ]);
}

function partnerActionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 Мои партнёры', PARTNERS_ACTION), Markup.button.callback('📤 Пригласить друга', INVITE_ACTION)],
    [Markup.button.callback('🔗 Ссылка 25%', INVITE_DIRECT_ACTION)],
    [Markup.button.callback('🔗 Ссылка 15%+5%+5%', INVITE_MULTI_ACTION)],
  ]);
}

function partnerLevelsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👤 Партнёры: 1-й', PARTNERS_LEVEL_1_ACTION), Markup.button.callback('👥 Партнёры: 2-й', PARTNERS_LEVEL_2_ACTION), Markup.button.callback('👨‍👩‍👧‍👦 Партнёры: 3-й', PARTNERS_LEVEL_3_ACTION)],
    [Markup.button.callback('🔙 Назад к основному меню', DASHBOARD_ACTION)],
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
    // Вычисляем сколько нужно до активации (200 PZ товарооборот)
    const currentTurnover = Number(profile.balance); // Используем баланс как показатель активности
    const neededTurnover = 200;
    const remainingTurnover = Math.max(0, neededTurnover - currentTurnover);
    
    if (remainingTurnover > 0) {
      activationStatus = `\n⏳ До активации партнерки осталось ${remainingTurnover} PZ товарооборота (нужно 200 PZ в месяц)`;
    } else {
      activationStatus = '\n🎯 Достаточно активности для активации партнерки!';
    }
  }

  // Balance = total bonuses (they are the same now)
  const message = cardTemplate({
    balance: Number(profile.balance).toFixed(2),
    partners: stats.partners,
    direct: stats.directPartners,
    bonus: Number(profile.bonus).toFixed(2),
    referral: buildReferralLink(profile.referralCode, profile.programType),
    transactions,
    isActive: (profile as any).isActive,
    expiresAt: (profile as any).expiresAt,
    activationStatus,
  });

  console.log('🔍 Partner: Final activation status:', activationStatus);
  console.log('🔍 Partner: Final message preview:', message.substring(0, 200) + '...');

  await ctx.reply(message, partnerActionsKeyboard());
}

async function handlePlanSelection(ctx: Context, programType: PartnerProgramType, message: string) {
  console.log('💰 Partner: handlePlanSelection called with type:', programType);
  
  const user = await ensureUser(ctx);
  if (!user) {
    console.log('💰 Partner: Failed to ensure user');
    await ctx.reply('Не удалось активировать программу. Попробуйте позже.');
    return;
  }

  console.log('💰 Partner: User ensured, creating profile');
  const profile = await getOrCreatePartnerProfile(user.id, programType);
  console.log('💰 Partner: Profile created:', profile.referralCode);
  
  await logUserAction(ctx, 'partner:select-program', { programType });
  await ctx.answerCbQuery('Программа активирована');
  
  const referralLink = buildReferralLink(profile.referralCode, programType);
  console.log('💰 Partner: Generated referral link:', referralLink);
  
  await ctx.reply(`${message}\n\nВаша ссылка: ${referralLink}`, partnerActionsKeyboard());
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
  let partnerReferrals = [];
  
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
    
    if (directPartners.length > 0) {
      const directPartnerIds = directPartners.map(p => p.referredId).filter(Boolean);
      
      // Теперь находим партнеров наших прямых партнеров
      partnerReferrals = await prisma.partnerReferral.findMany({
        where: { 
          profileId: { in: directPartnerIds },
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
      const directPartnerIds = directPartners.map(p => p.referredId).filter(Boolean);
      
      // Находим партнеров наших прямых партнеров (2-й уровень)
      const secondLevelPartners = await prisma.partnerReferral.findMany({
        where: { 
          profileId: { in: directPartnerIds },
          level: 1 
        },
        select: { referredId: true }
      });
      
      if (secondLevelPartners.length > 0) {
        const secondLevelPartnerIds = secondLevelPartners.map(p => p.referredId).filter(Boolean);
        
        // Находим партнеров партнеров наших партнеров (3-й уровень)
        partnerReferrals = await prisma.partnerReferral.findMany({
          where: { 
            profileId: { in: secondLevelPartnerIds },
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
    partnerReferrals.forEach((referral, index) => {
      const user = referral.profile.user;
      const displayName = user.username ? `@${user.username}` : (user.firstName || `ID:${user.telegramId}`);
      message += `${index + 1}. ${displayName}\n`;
    });
  }
  
  await ctx.reply(message, partnerLevelsKeyboard());
}

async function showInvite(ctx: Context) {
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

  await ctx.answerCbQuery('Выберите тип ссылки', { show_alert: false });
  await ctx.reply(`Ваши реферальные ссылки:\n\n🔗 Прямая ссылка (25% с покупок):\n${buildReferralLink(dashboard.profile.referralCode, 'DIRECT')}\n\n🔗 Многоуровневая ссылка (15% + 5% + 5%):\n${buildReferralLink(dashboard.profile.referralCode, 'MULTI_LEVEL')}`);
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
  await ctx.reply(`🔗 Прямая ссылка (25% с покупок):\n${buildReferralLink(dashboard.profile.referralCode, 'DIRECT')}`);
}

async function showMultiInvite(ctx: Context) {
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

  await ctx.answerCbQuery();
  await ctx.reply(`🔗 Многоуровневая ссылка (15% + 5% + 5%):\n${buildReferralLink(dashboard.profile.referralCode, 'MULTI_LEVEL')}\n\nВыберите уровень партнёров для просмотра:`, partnerLevelsKeyboard());
}

export const partnerModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    bot.hears(['Партнёрка', 'Партнерка', '💰 Партнёрка'], async (ctx) => {
      console.log('💰 Partner: Button pressed');
      await logUserAction(ctx, 'menu:partners');
      console.log('💰 Partner: Sending program intro');
      await showPartnerIntro(ctx);
    });

    bot.action(DASHBOARD_ACTION, async (ctx) => {
      console.log('💰 Partner: Dashboard button pressed');
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'partner:dashboard');
      await showDashboard(ctx);
    });

    bot.action(DIRECT_PLAN_ACTION, async (ctx) => {
      console.log('💰 Partner: Direct plan button pressed');
      await handlePlanSelection(ctx, PartnerProgramType.DIRECT, directPlanText);
    });

    bot.action(MULTI_PLAN_ACTION, async (ctx) => {
      console.log('💰 Partner: Multi-level plan button pressed');
      await handlePlanSelection(ctx, PartnerProgramType.MULTI_LEVEL, multiPlanText);
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
      await logUserAction(ctx, 'partner:invite:direct');
      await showDirectInvite(ctx);
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
  },
};

export async function showPartnerIntro(ctx: Context) {
  await ctx.reply(programIntro, planKeyboard());
}
