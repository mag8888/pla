import { PartnerProgramType } from '../models/PartnerProfile.js';
import { TransactionType } from '../models/PartnerTransaction.js';
import { PartnerProfile, PartnerReferral, PartnerTransaction, User, UserHistory } from '../models/index.js';
import { randomBytes } from 'crypto';
import { env } from '../config/env.js';
import mongoose from 'mongoose';

function generateReferralCode() {
  return `PW${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function ensureReferralCode(): Promise<string> {
  // ensure uniqueness
  while (true) {
    const code = generateReferralCode();
    const exists = await PartnerProfile.findOne({ referralCode: code });
    if (!exists) {
      return code;
    }
  }
}

export async function getOrCreatePartnerProfile(userId: string, programType: PartnerProgramType = PartnerProgramType.DIRECT) {
  const existing = await PartnerProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) });
  if (existing) {
    return existing;
  }

  const referralCode = await ensureReferralCode();
  return PartnerProfile.create({
    userId: new mongoose.Types.ObjectId(userId),
    programType,
    referralCode,
    isActive: false, // По умолчанию неактивен
  });
}

export async function activatePartnerProfile(userId: string, activationType: 'PURCHASE' | 'ADMIN', months: number = 1, reason?: string, adminId?: string) {
  const profile = await PartnerProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) });
  if (!profile) {
    throw new Error('Partner profile not found');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000); // Добавляем месяцы

  // Note: PartnerActivationHistory model not created yet, skipping for now
  // TODO: Create PartnerActivationHistory model if needed

  profile.isActive = true;
  profile.activatedAt = now;
  profile.expiresAt = expiresAt;
  profile.activationType = activationType;
  await profile.save();

  return profile;
}

export async function deactivatePartnerProfile(userId: string, reason?: string, adminId?: string) {
  const profile = await PartnerProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) });
  if (!profile) {
    throw new Error('Partner profile not found');
  }

  // Note: PartnerActivationHistory model not created yet, skipping for now
  // TODO: Create PartnerActivationHistory model if needed

  profile.isActive = false;
  await profile.save();

  return profile;
}

export async function getPartnerActivationHistory(profileId: string) {
  // TODO: Implement when PartnerActivationHistory model is created
  return [];
}

export async function checkPartnerActivation(userId: string): Promise<boolean> {
  try {
    const profile = await PartnerProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!profile) return false;

    // Проверяем, активен ли профиль и не истек ли срок
    if (!profile.isActive) return false;
    
    // Проверяем срок, но НЕ деактивируем автоматически
    // Деактивация должна происходить явно в других местах (например, при открытии дашборда партнера)
    if (profile.expiresAt && new Date() > profile.expiresAt) {
      return false; // Срок истек, но не деактивируем здесь
    }

    return true;
  } catch (error: any) {
    // Обрабатываем ошибки БД
    const errorMessage = error.message || '';
    const errorName = error.name || '';
    
    const isDbError = 
      errorName === 'MongoServerError' ||
      errorName === 'MongoNetworkError' ||
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('Authentication failed') ||
      errorMessage.includes('SCRAM failure');
    
    if (isDbError) {
      console.warn('Database unavailable for partner check (non-critical):', errorMessage.substring(0, 100));
      return false; // Возвращаем false при ошибке БД
    }
    
    // Для других ошибок пробрасываем дальше
    throw error;
  }
}

/**
 * Проверяет и автоматически деактивирует истекшие профили
 * Используется только в местах, где это уместно (например, при открытии дашборда партнера)
 */
export async function checkAndDeactivateExpiredProfiles(userId: string): Promise<boolean> {
  const profile = await PartnerProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) });
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
  const profile = await PartnerProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) })
    .populate('userId')
    .lean();

  if (!profile) return null;

  const transactions = await PartnerTransaction.find({ profileId: profile._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const partners = await PartnerReferral.countDocuments({ profileId: profile._id });

  return {
    profile,
    stats: {
      partners,
      directPartners: await PartnerReferral.countDocuments({ profileId: profile._id, level: 1 }),
      multiPartners: await PartnerReferral.countDocuments({ profileId: profile._id, level: { $gt: 1 } }),
    },
    transactions,
  };
}

export async function getPartnerList(userId: string) {
  const profile = await PartnerProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) });
  if (!profile) return null;

  // Get direct partners (level 1)
  const directReferrals = await PartnerReferral.find({ 
    profileId: profile._id, 
    level: 1 
  })
    .populate('referredId')
    .sort({ createdAt: -1 })
    .lean();

  // Get multi-level partners (level 2 and 3)
  const multiReferrals = await PartnerReferral.find({ 
    profileId: profile._id, 
    level: { $gt: 1 }
  })
    .populate('referredId')
    .sort({ createdAt: -1 })
    .lean();

  // Combine user data with referral data
  const directPartnersMap = new Map();
  directReferrals
    .filter((ref: any) => ref.referredId)
    .forEach((ref: any) => {
      const user = ref.referredId as any;
      if (user && !directPartnersMap.has(user._id.toString())) {
        directPartnersMap.set(user._id.toString(), {
          id: user._id.toString(),
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
    .filter((ref: any) => ref.referredId)
    .forEach((ref: any) => {
      const user = ref.referredId as any;
      if (user && !multiPartnersMap.has(user._id.toString())) {
        multiPartnersMap.set(user._id.toString(), {
          id: user._id.toString(),
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

export async function recordPartnerTransaction(profileId: string, amount: number, description: string, type: TransactionType = TransactionType.CREDIT) {
  // Create transaction
  const transaction = await PartnerTransaction.create({
    profileId: new mongoose.Types.ObjectId(profileId),
    amount,
    description,
    type,
  });

  // Recalculate total bonus and balance from all transactions
  await recalculatePartnerBonuses(profileId);

  return transaction;
}

export async function recalculatePartnerBonuses(profileId: string) {
  console.log(`🔄 Starting bonus recalculation for profile ${profileId}...`);
  
  const allTransactions = await PartnerTransaction.find({ 
    profileId: new mongoose.Types.ObjectId(profileId) 
  }).lean();
  
  console.log(`📊 Found ${allTransactions.length} transactions for profile ${profileId}`);
  
  const totalBonus = allTransactions.reduce((sum: number, tx: any) => {
    const amount = tx.type === TransactionType.CREDIT ? tx.amount : -tx.amount;
    console.log(`  - Transaction: ${tx.type} ${tx.amount} PZ (${tx.description})`);
    return sum + amount;
  }, 0);

  console.log(`💰 Total calculated bonus: ${totalBonus} PZ`);

  // Update both balance and bonus fields in PartnerProfile
  const updatedProfile = await PartnerProfile.findByIdAndUpdate(
    profileId,
    {
      $set: {
        balance: totalBonus,  // Balance = total bonuses
        bonus: totalBonus     // Bonus = total bonuses (for display)
      }
    },
    { new: true }
  );

  if (!updatedProfile) {
    throw new Error('Partner profile not found');
  }

  // Also update user balance in User table
  await User.findByIdAndUpdate(
    updatedProfile.userId,
    { $set: { balance: totalBonus } }
  );

  console.log(`✅ Updated profile ${profileId}: balance = ${updatedProfile.balance} PZ, bonus = ${updatedProfile.bonus} PZ`);
  console.log(`✅ Updated user ${updatedProfile.userId}: balance = ${totalBonus} PZ`);
  return totalBonus;
}

// Функция для поиска всей цепочки партнеров
async function findAllPartnerChain(orderUserId: string) {
  const allReferrals = [];
  const orderUserIdObj = new mongoose.Types.ObjectId(orderUserId);
  
  // Ищем прямых партнеров (уровень 1)
  const level1Referrals = await PartnerReferral.find({ referredId: orderUserIdObj })
    .populate('profileId')
    .lean();
  
  for (const referral of level1Referrals) {
    allReferrals.push({
      ...referral,
      level: 1
    });
    
    const profile = referral.profileId as any;
    if (!profile || !profile.userId) continue;
    
    // Ищем партнеров 2-го уровня (партнеры партнера)
    const level2Referrals = await PartnerReferral.find({ referredId: profile.userId })
      .populate('profileId')
      .lean();
    
    for (const level2Referral of level2Referrals) {
      allReferrals.push({
        ...level2Referral,
        level: 2
      });
      
      const level2Profile = level2Referral.profileId as any;
      if (!level2Profile || !level2Profile.userId) continue;
      
      // Ищем партнеров 3-го уровня (партнеры партнера партнера)
      const level3Referrals = await PartnerReferral.find({ referredId: level2Profile.userId })
        .populate('profileId')
        .lean();
      
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
    const existingBonuses = await UserHistory.find({
      userId: new mongoose.Types.ObjectId(orderUserId),
      action: 'REFERRAL_BONUS'
    }).lean();
    
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
    return [];
  }
  
  console.log(`🔍 Found ${allPartnerReferrals.length} partners in chain for user ${orderUserId}`);

  const bonuses: any[] = [];

  for (const referral of allPartnerReferrals) {
    const partnerProfile = referral.profileId as any;
    if (!partnerProfile) continue;
    
    // Проверяем, активен ли партнерский профиль
    const isActive = await checkPartnerActivation(partnerProfile.userId.toString());
    
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
        if (referral.referralType === PartnerProgramType.DIRECT) {
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
        partnerProfile._id.toString(),
        bonusAmount,
        description,
        TransactionType.CREDIT
      );

      // Добавляем запись в историю пользователя
      await UserHistory.create({
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
      });

      bonuses.push({
        partnerId: partnerProfile.userId.toString(),
        partnerName: 'Партнер', // Will be populated if needed
        level: referral.level,
        amount: bonusAmount,
        description
      });

      console.log(`✅ Added ${bonusAmount} PZ bonus to partner ${partnerProfile.userId} (level ${referral.level})`);

      // Отправляем уведомление партнеру о пополнении баланса
      try {
        const { getBotInstance } = await import('../lib/bot-instance.js');
        const bot = await getBotInstance();
        
        const user = await User.findById(partnerProfile.userId).lean();
        if (!user) continue;
        
        // Проверяем, активна ли партнерка
        const isPartnerActive = await checkPartnerActivation(partnerProfile.userId.toString());
        let notificationMessage = '';
        
        if (isPartnerActive) {
          // Если партнерка активна - показываем повышенный процент
          const percentage = referral.level === 1 ? 
            (referral.referralType === PartnerProgramType.DIRECT ? '25%' : '15%') : 
            '5%';
          notificationMessage = `🎉 Ваш счет пополнен на сумму ${bonusAmount.toFixed(2)} PZ (${percentage}) от покупки вашего реферала!`;
        } else {
          // Если партнерка не активна - показываем 10% и предлагаем активацию
          notificationMessage = `🎉 Ваш счет пополнен на сумму ${bonusAmount.toFixed(2)} PZ (10%) от покупки вашего реферала!\n\n💡 Если вы желаете получать повышенный % (25% или 15%+5%+5%), вам нужно активировать партнерку на 120 PZ товарооборота в месяц.`;
        }
        
        await bot.telegram.sendMessage(user.telegramId, notificationMessage);
        console.log(`📱 Notification sent to partner ${partnerProfile.userId} about ${bonusAmount.toFixed(2)} PZ bonus`);
      } catch (error) {
        console.warn(`⚠️ Failed to send notification to partner ${partnerProfile.userId}:`, error);
      }
    }
  }

  console.log(`🎉 Total bonuses distributed: ${bonuses.length} partners, ${bonuses.reduce((sum, b) => sum + b.amount, 0)} PZ`);
  return bonuses;
}

export async function createPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType: PartnerProgramType = PartnerProgramType.DIRECT) {
  return PartnerReferral.create({
    profileId: profileId,
    level,
    referredId: referredId || undefined,
    contact,
    referralType,
  });
}

export async function upsertPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType: PartnerProgramType = PartnerProgramType.DIRECT) {
  // Check if referral already exists
  const existingReferral = await PartnerReferral.findOne({
    profileId: profileId,
    referredId: referredId || undefined,
    level
  });

  if (existingReferral) {
    console.log(`🔄 Referral already exists for profileId: ${profileId}, referredId: ${referredId}, level: ${level}`);
    return existingReferral;
  }

  // Create new referral if it doesn't exist
  return PartnerReferral.create({
    profileId: profileId,
    level,
    referredId: referredId || undefined,
    contact,
    referralType,
  });
}
