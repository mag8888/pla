import { PartnerProgramType, TransactionType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

function generateReferralCode() {
  return `PW${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function ensureReferralCode(): Promise<string> {
  // ensure uniqueness
  while (true) {
    const code = generateReferralCode();
    const exists = await prisma.partnerProfile.findFirst({ where: { referralCode: code } });
    if (!exists) {
      return code;
    }
  }
}

export async function getOrCreatePartnerProfile(userId: string, programType: PartnerProgramType = 'DIRECT') {
  const existing = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (existing) {
    return existing;
  }

  const referralCode = await ensureReferralCode();
  return prisma.partnerProfile.create({
    data: {
      userId,
      programType,
      referralCode,
      isActive: false, // По умолчанию неактивен
    },
  });
}

export async function activatePartnerProfile(userId: string, activationType: 'PURCHASE' | 'ADMIN', months: number = 1, reason?: string, adminId?: string) {
  const profile = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error('Partner profile not found');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000); // Добавляем месяцы

  // Log activation history
  await prisma.partnerActivationHistory.create({
    data: {
      profileId: profile.id,
      action: 'ACTIVATED',
      activationType,
      reason: reason || (activationType === 'PURCHASE' ? 'Покупка на 120 PZ' : 'Активация администратором'),
      expiresAt,
      adminId,
    },
  });

  return prisma.partnerProfile.update({
    where: { userId },
    data: {
      isActive: true,
      activatedAt: now,
      expiresAt,
      activationType,
    },
  });
}

export async function deactivatePartnerProfile(userId: string, reason?: string, adminId?: string) {
  const profile = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error('Partner profile not found');
  }

  // Log deactivation history
  await prisma.partnerActivationHistory.create({
    data: {
      profileId: profile.id,
      action: 'DEACTIVATED',
      activationType: profile.activationType || null,
      reason: reason || 'Деактивация',
      expiresAt: profile.expiresAt,
      adminId,
    },
  });

  return prisma.partnerProfile.update({
    where: { userId },
    data: {
      isActive: false,
    },
  });
}

export async function getPartnerActivationHistory(profileId: string) {
  return prisma.partnerActivationHistory.findMany({
    where: { profileId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function checkPartnerActivation(userId: string): Promise<boolean> {
  const profile = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (!profile) return false;

  // Проверяем, активен ли профиль и не истек ли срок
  if (!profile.isActive) return false;
  
  // Проверяем срок, но НЕ деактивируем автоматически
  // Деактивация должна происходить явно в других местах (например, при открытии дашборда партнера)
  if (profile.expiresAt && new Date() > profile.expiresAt) {
    return false; // Срок истек, но не деактивируем здесь
  }

  return true;
}

/**
 * Проверяет и автоматически деактивирует истекшие профили
 * Используется только в местах, где это уместно (например, при открытии дашборда партнера)
 */
export async function checkAndDeactivateExpiredProfiles(userId: string): Promise<boolean> {
  const profile = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (!profile) return false;

  if (!profile.isActive) return false;
  
  if (profile.expiresAt && new Date() > profile.expiresAt) {
    // Автоматически деактивируем истекший профиль
    await deactivatePartnerProfile(userId, 'Истек срок активации');
    return false;
  }

  return true;
}

export function buildReferralLink(code: string, programType: 'DIRECT' | 'MULTI_LEVEL') {
  // Create Telegram bot link with referral parameter based on program type
  const prefix = programType === 'DIRECT' ? 'ref_direct' : 'ref_multi';
  return `https://t.me/iplazmabot?start=${prefix}_${code}`;
}

export async function getPartnerDashboard(userId: string) {
  const profile = await prisma.partnerProfile.findUnique({
    where: { userId },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      referrals: true,
    },
  });

  if (!profile) return null;

  const partners = await prisma.partnerReferral.count({ where: { profileId: profile.id } });

  return {
    profile,
    stats: {
      partners,
      directPartners: await prisma.partnerReferral.count({ where: { profileId: profile.id, level: 1 } }),
      multiPartners: await prisma.partnerReferral.count({ where: { profileId: profile.id, level: 2 } }),
    },
  };
}

export async function getPartnerList(userId: string) {
  const profile = await prisma.partnerProfile.findUnique({
    where: { userId },
  });

  if (!profile) return null;

  // Get direct partners (level 1) - users who were referred by this partner
  const directReferrals = await prisma.partnerReferral.findMany({
    where: { 
      profileId: profile.id, 
      level: 1 
    },
    include: {
      profile: {
        include: {
          user: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Get multi-level partners (level 2 and 3) - users referred by direct partners
  const multiReferrals = await prisma.partnerReferral.findMany({
    where: { 
      profileId: profile.id, 
      level: { gt: 1 }
    },
    include: {
      profile: {
        include: {
          user: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Get actual users who were referred with their referral data
  const directPartnerData = directReferrals
    .filter(ref => ref.referredId)
    .map(ref => ({
      user: null as any, // Will be filled below
      level: ref.level,
      joinedAt: ref.createdAt
    }));

  const multiPartnerData = multiReferrals
    .filter(ref => ref.referredId)
    .map(ref => ({
      user: null as any, // Will be filled below
      level: ref.level,
      joinedAt: ref.createdAt
    }));

  // Get users for direct partners
  const directUserIds = directReferrals.map(ref => ref.referredId).filter(Boolean) as string[];
  const directUsers = await prisma.user.findMany({
    where: { id: { in: directUserIds } }
  });

  // Get users for multi-level partners
  const multiUserIds = multiReferrals.map(ref => ref.referredId).filter(Boolean) as string[];
  const multiUsers = await prisma.user.findMany({
    where: { id: { in: multiUserIds } }
  });

  // Combine user data with referral data, removing duplicates
  const directPartnersMap = new Map();
  directReferrals
    .filter(ref => ref.referredId)
    .forEach(ref => {
      const user = directUsers.find(u => u.id === ref.referredId);
      if (user && !directPartnersMap.has(user.id)) {
        directPartnersMap.set(user.id, {
          id: user.id,
          firstName: user.firstName || 'Пользователь',
          username: user.username,
          telegramId: user.telegramId,
          level: ref.level,
          joinedAt: ref.createdAt
        });
      }
    });

  const multiPartnersMap = new Map();
  multiReferrals
    .filter(ref => ref.referredId)
    .forEach(ref => {
      const user = multiUsers.find(u => u.id === ref.referredId);
      if (user && !multiPartnersMap.has(user.id)) {
        multiPartnersMap.set(user.id, {
          id: user.id,
          firstName: user.firstName || 'Пользователь',
          username: user.username,
          telegramId: user.telegramId,
          level: ref.level,
          joinedAt: ref.createdAt
        });
      }
    });

  const directPartners = Array.from(directPartnersMap.values());
  const multiPartners = Array.from(multiPartnersMap.values());

  return {
    directPartners,
    multiPartners
  };
}

export async function recordPartnerTransaction(profileId: string, amount: number, description: string, type: TransactionType = 'CREDIT') {
  // Create transaction
  const transaction = await prisma.partnerTransaction.create({
    data: {
      profileId,
      amount,
      description,
      type,
    },
  });

  // Recalculate total bonus and balance from all transactions
  await recalculatePartnerBonuses(profileId);

  return transaction;
}

export async function recalculatePartnerBonuses(profileId: string) {
  console.log(`🔄 Starting bonus recalculation for profile ${profileId}...`);
  
  const allTransactions = await prisma.partnerTransaction.findMany({
    where: { profileId }
  });
  
  console.log(`📊 Found ${allTransactions.length} transactions for profile ${profileId}`);
  
  const totalBonus = allTransactions.reduce((sum, tx) => {
    const amount = tx.type === 'CREDIT' ? tx.amount : -tx.amount;
    console.log(`  - Transaction: ${tx.type} ${tx.amount} PZ (${tx.description})`);
    return sum + amount;
  }, 0);

  console.log(`💰 Total calculated bonus: ${totalBonus} PZ`);

  // Update both balance and bonus fields in PartnerProfile
  const updatedProfile = await prisma.partnerProfile.update({
    where: { id: profileId },
    data: {
      balance: totalBonus,  // Balance = total bonuses
      bonus: totalBonus     // Bonus = total bonuses (for display)
    }
  });

  // Also update user balance in User table
  await prisma.user.update({
    where: { id: updatedProfile.userId },
    data: { balance: totalBonus }
  });

  console.log(`✅ Updated profile ${profileId}: balance = ${updatedProfile.balance} PZ, bonus = ${updatedProfile.bonus} PZ`);
  console.log(`✅ Updated user ${updatedProfile.userId}: balance = ${totalBonus} PZ`);
  return totalBonus;
}

// Функция для поиска всей цепочки партнеров
async function findAllPartnerChain(orderUserId: string) {
  const allReferrals = [];
  
  // Ищем прямых партнеров (уровень 1)
  const level1Referrals = await prisma.partnerReferral.findMany({
    where: { referredId: orderUserId },
    include: {
      profile: {
        include: { user: true }
      }
    }
  });
  
  for (const referral of level1Referrals) {
    allReferrals.push({
      ...referral,
      level: 1
    });
    
    // Ищем партнеров 2-го уровня (партнеры партнера)
    const level2Referrals = await prisma.partnerReferral.findMany({
      where: { referredId: referral.profile.userId },
      include: {
        profile: {
          include: { user: true }
        }
      }
    });
    
    for (const level2Referral of level2Referrals) {
      allReferrals.push({
        ...level2Referral,
        level: 2
      });
      
      // Ищем партнеров 3-го уровня (партнеры партнера партнера)
      const level3Referrals = await prisma.partnerReferral.findMany({
        where: { referredId: level2Referral.profile.userId },
        include: {
          profile: {
            include: { user: true }
          }
        }
      });
      
      for (const level3Referral of level3Referrals) {
        allReferrals.push({
          ...level3Referral,
          level: 3
        });
      }
    }
  }
  
  return allReferrals;
}

// Новая функция для расчета бонусов по двойной системе
export async function calculateDualSystemBonuses(orderUserId: string, orderAmount: number, orderId?: string) {
  console.log(`🎯 Calculating dual system bonuses for order ${orderAmount} PZ by user ${orderUserId}`);
  
  // Проверяем, не были ли уже начислены бонусы за этот заказ
  if (orderId) {
    // Ищем все записи о бонусах для этого пользователя
    const existingBonuses = await prisma.userHistory.findMany({
      where: {
        userId: orderUserId,
        action: 'REFERRAL_BONUS'
      }
    });
    
    // Проверяем, есть ли уже бонусы за этот заказ
    const hasExistingBonus = existingBonuses.some(bonus => {
      try {
        const payload = bonus.payload as any;
        return payload && payload.orderId === orderId;
      } catch (e) {
        return false;
      }
    });
    
    if (hasExistingBonus) {
      console.log(`⚠️ Bonuses already distributed for order ${orderId}, skipping...`);
      return [];
    }
  }
  
  // Находим всех партнеров в цепочке, которые могут получить бонусы
  const allPartnerReferrals = await findAllPartnerChain(orderUserId);
  
  if (allPartnerReferrals.length === 0) {
    console.log(`❌ No partner referrals found for user ${orderUserId}`);
    return;
  }
  
  console.log(`🔍 Found ${allPartnerReferrals.length} partners in chain for user ${orderUserId}`);

  const bonuses = [];

  for (const referral of allPartnerReferrals) {
    const partnerProfile = referral.profile;
    
    // Проверяем, активен ли партнерский профиль
    const isActive = await checkPartnerActivation(partnerProfile.userId);
    
    let bonusAmount = 0;
    let description = '';

    if (referral.level === 1) {
      // Прямой реферал: всегда 10% для неактивных, расширенные % для активных
      if (!isActive) {
        // Базовый бонус 10% для неактивных партнеров
        bonusAmount = orderAmount * 0.10;
        description = `Базовый бонус за заказ прямого реферала (${orderAmount} PZ) - 10%`;
      } else {
        // Расширенные бонусы для активных партнеров
        if (referral.referralType === 'DIRECT') {
          // Прямая система: 25%
          bonusAmount = orderAmount * 0.25;
          description = `Бонус за заказ прямого реферала (${orderAmount} PZ) - прямая система 25%`;
        } else {
          // Многоуровневая система: 15%
          bonusAmount = orderAmount * 0.15;
          description = `Бонус за заказ прямого реферала (${orderAmount} PZ) - многоуровневая система 15%`;
        }
      }
    } else if (referral.level === 2) {
      // Уровень 2: только для активных партнеров
      if (isActive) {
        bonusAmount = orderAmount * 0.05;
        description = `Бонус за заказ реферала 2-го уровня (${orderAmount} PZ)`;
      } else {
        console.log(`⚠️ Partner ${partnerProfile.userId} (level 2) is not active, skipping bonus`);
        continue;
      }
    } else if (referral.level === 3) {
      // Уровень 3: только для активных партнеров
      if (isActive) {
        bonusAmount = orderAmount * 0.05;
        description = `Бонус за заказ реферала 3-го уровня (${orderAmount} PZ)`;
      } else {
        console.log(`⚠️ Partner ${partnerProfile.userId} (level 3) is not active, skipping bonus`);
        continue;
      }
    }

    if (bonusAmount > 0) {
      // Добавляем бонус партнеру
      await recordPartnerTransaction(
        partnerProfile.id,
        bonusAmount,
        description,
        'CREDIT'
      );

      // Добавляем запись в историю пользователя
      await prisma.userHistory.create({
        data: {
          userId: partnerProfile.userId,
          action: 'REFERRAL_BONUS',
          payload: {
            amount: bonusAmount,
            orderAmount,
            level: referral.level,
            referredUserId: orderUserId,
            orderId: orderId || null,
            type: 'DUAL_SYSTEM'
          }
        }
      });

      bonuses.push({
        partnerId: partnerProfile.userId,
        partnerName: partnerProfile.user.firstName || 'Партнер',
        level: referral.level,
        amount: bonusAmount,
        description
      });

      console.log(`✅ Added ${bonusAmount} PZ bonus to partner ${partnerProfile.userId} (level ${referral.level})`);

      // Отправляем уведомление партнеру о пополнении баланса
      try {
        const { getBotInstance } = await import('../lib/bot-instance.js');
        const bot = await getBotInstance();
        
        // Проверяем, активна ли партнерка
        const isPartnerActive = await checkPartnerActivation(partnerProfile.userId);
        let notificationMessage = '';
        
        if (isPartnerActive) {
          // Если партнерка активна - показываем повышенный процент
          const percentage = referral.level === 1 ? 
            (referral.referralType === 'DIRECT' ? '25%' : '15%') : 
            '5%';
          notificationMessage = `🎉 Ваш счет пополнен на сумму ${bonusAmount.toFixed(2)} PZ (${percentage}) от покупки вашего реферала!`;
        } else {
          // Если партнерка не активна - показываем 10% и предлагаем активацию
          notificationMessage = `🎉 Ваш счет пополнен на сумму ${bonusAmount.toFixed(2)} PZ (10%) от покупки вашего реферала!\n\n💡 Если вы желаете получать повышенный % (25% или 15%+5%+5%), вам нужно активировать партнерку на 120 PZ товарооборота в месяц.`;
        }
        
        await bot.telegram.sendMessage(partnerProfile.user.telegramId, notificationMessage);
        console.log(`📱 Notification sent to partner ${partnerProfile.userId} about ${bonusAmount.toFixed(2)} PZ bonus`);
      } catch (error) {
        console.warn(`⚠️ Failed to send notification to partner ${partnerProfile.userId}:`, error);
      }
    }
  }

  console.log(`🎉 Total bonuses distributed: ${bonuses.length} partners, ${bonuses.reduce((sum, b) => sum + b.amount, 0)} PZ`);
  return bonuses;
}

export async function createPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType: 'DIRECT' | 'MULTI_LEVEL' = 'DIRECT') {
  return prisma.partnerReferral.create({
    data: {
      profileId,
      level,
      referredId,
      contact,
      referralType,
    },
  });
}

export async function upsertPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType: 'DIRECT' | 'MULTI_LEVEL' = 'DIRECT') {
  // Check if referral already exists
  const existingReferral = await prisma.partnerReferral.findFirst({
    where: {
      profileId,
      referredId,
      level
    }
  });

  if (existingReferral) {
    console.log(`🔄 Referral already exists for profileId: ${profileId}, referredId: ${referredId}, level: ${level}`);
    return existingReferral;
  }

  // Create new referral if it doesn't exist
  return prisma.partnerReferral.create({
    data: {
      profileId,
      level,
      referredId,
      contact,
      referralType,
    },
  });
}
