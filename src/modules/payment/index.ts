import { Context } from '../../bot/context.js';
import { Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { lavaService } from '../../services/lava-service.js';
import { ensureUser } from '../../services/user-history.js';
import { PaymentStatus, OrderStatus } from '@prisma/client';

export async function showPaymentMethods(ctx: Context) {
  const user = await ensureUser(ctx as any);
  if (!user) return;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💳 Оплатить картой', 'payment:card')],
    [Markup.button.callback('₿ Криптовалюта', 'payment:crypto')],
    [Markup.button.callback('📱 Мобильный платеж', 'payment:mobile')],
    [Markup.button.callback('🔙 Назад', 'back_to_cart')]
  ]);

  await ctx.reply(
    '💳 <b>Выберите способ оплаты</b>\n\n' +
    '• <b>Карта</b> - Visa, Mastercard, МИР\n' +
    '• <b>Криптовалюта</b> - Bitcoin, Ethereum, USDT\n' +
    '• <b>Мобильный</b> - СБП, QIWI, Яндекс.Деньги',
    { ...keyboard, parse_mode: 'HTML' }
  );
}

export async function createPayment(ctx: Context, amount: number, orderId: string) {
  const user = await ensureUser(ctx as any);
  if (!user) return;

  try {
    console.log(`💳 Creating payment: amount=${amount}, orderId=${orderId}, userId=${user.id}`);

    // Создаем запись о платеже в БД
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        orderId,
        amount,
        currency: 'RUB',
        status: 'PENDING',
        invoiceId: 'temp-' + Date.now() // Временный ID, будет обновлен после создания инвойса
      }
    });

    console.log(`📝 Payment record created: ${payment.id}`);

    // Создаем инвойс в Lava
    const userEmail = (user as any).phone
      ? `${user.telegramId}@vital.temp`
      : `user_${user.telegramId}@vital.temp`;

    const invoice = await lavaService.createInvoice({
      email: userEmail,
      sum: amount,
      orderId: payment.id,
      currency: 'RUB',
      buyerLanguage: 'RU',
      hookUrl: `${process.env.PUBLIC_BASE_URL}/webhook/lava`,
      successUrl: `${process.env.PUBLIC_BASE_URL}/payment/success`,
      failUrl: `${process.env.PUBLIC_BASE_URL}/payment/fail`,
      customFields: {
        userId: user.id,
        telegramId: user.telegramId.toString()
      },
      comment: `Оплата заказа #${orderId}`
    });

    console.log(`🔥 Lava invoice created: ${invoice.data.id}`);

    // Обновляем платеж с URL
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        invoiceId: invoice.data.id,
        paymentUrl: invoice.data.url
      }
    });

    // Отправляем ссылку на оплату
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Оплатить', invoice.data.url)],
      [Markup.button.callback('🔄 Проверить статус', `payment:check:${payment.id}`)],
      [Markup.button.callback('❌ Отменить', `payment:cancel:${payment.id}`)]
    ]);

    await ctx.reply(
      `💳 <b>Счет на оплату создан</b>\n\n` +
      `💰 Сумма: <b>${amount} ₽</b>\n` +
      `📋 Заказ: <b>#${orderId}</b>\n\n` +
      `Нажмите кнопку ниже для перехода к оплате:`,
      { ...keyboard, parse_mode: 'HTML' }
    );

  } catch (error) {
    console.error('❌ Payment creation error:', error);
    await ctx.reply('❌ Ошибка создания платежа. Попробуйте позже.');
  }
}

export async function createBalanceTopUp(ctx: Context, amount: number) {
  const user = await ensureUser(ctx as any);
  if (!user) return;

  const orderId = `BALANCE-${Date.now()}`;

  try {
    await createPayment(ctx, amount, orderId);
  } catch (error) {
    console.error('❌ Balance top-up error:', error);
    await ctx.reply('❌ Ошибка создания пополнения баланса.');
  }
}

export async function checkPaymentStatus(ctx: Context, paymentId: string) {
  try {
    console.log(`🔍 Checking payment status: ${paymentId}`);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      await ctx.answerCbQuery('Платеж не найден');
      return;
    }

    if (payment.status === PaymentStatus.PAID) {
      await ctx.answerCbQuery('✅ Платеж уже оплачен!');
      return;
    }

    // Проверяем статус в Lava
    const status = await lavaService.getInvoiceStatus(payment.invoiceId);
    const isBalanceTopUp = payment.orderId.startsWith('BALANCE-');

    if (status.data.status === 'success') {
      // Обновляем статус в БД
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.PAID }
      });

      if (isBalanceTopUp) {
        const updatedUser = await prisma.user.update({
          where: { id: payment.userId },
          data: {
            balance: {
              increment: payment.amount,
            },
          },
          select: {
            balance: true,
          },
        });

        await ctx.answerCbQuery('✅ Платеж подтвержден!');
        await ctx.reply(
          `🎉 <b>Баланс пополнен!</b>\n\n` +
          `💰 Сумма: <b>${payment.amount.toFixed(2)} ₽</b>\n` +
          `💳 Текущий баланс: <b>${updatedUser.balance.toFixed(2)} ₽</b>`,
          { parse_mode: 'HTML' }
        );
      } else {
        // Обновляем статус заказа
        await prisma.orderRequest.updateMany({
          where: { id: payment.orderId },
          data: { status: OrderStatus.COMPLETED }
        });

        await ctx.answerCbQuery('✅ Платеж подтвержден!');
        await ctx.reply('🎉 <b>Платеж успешно оплачен!</b>\n\nВаш заказ будет обработан в ближайшее время.', {
          parse_mode: 'HTML'
        });
      }

      // --- PARTNER PROGRAM HOOKS ---
      try {
        const { activatePartnerProfile, extendPartnerProfile, getOrCreatePartnerProfile } = await import('../../services/partner-service.js');

        if (payment.amount >= 12000) {
          // Logic for auto-activation or extending partner program
          console.log('💎 Payment >= 12000 RUB. Activating partner program for 40 days.');
          // Ensure profile exists first
          await getOrCreatePartnerProfile(payment.userId, 'DIRECT');
          // Using extendPartnerProfile with 40 days which handles both activation and extension
          await extendPartnerProfile(payment.userId, 40);

          await ctx.reply('💎 <b>Партнёрская программа активирована!</b>\n\nВам доступен заработок на рекомендациях в течение 40 дней.', { parse_mode: 'HTML' });

        } else if (payment.amount >= 6000) {
          // Extend for 30 days if already active
          console.log('💎 Payment >= 6000 RUB. Extending partner program for 30 days if active.');

          const existingProfile = await prisma.partnerProfile.findUnique({ where: { userId: payment.userId } });

          if (existingProfile && existingProfile.isActive) {
            await extendPartnerProfile(payment.userId, 30);
            await ctx.reply('💎 <b>Партнёрскaя программа продлена!</b>\n\nСрок действия продлен на 30 дней.', { parse_mode: 'HTML' });
          }
        }
      } catch (err) {
        console.error('❌ Error in partner program hook:', err);
        // Don't fail the whole payment flow
      }
      // -----------------------------

    } else {
      await ctx.answerCbQuery('⏳ Платеж еще не поступил');
    }

  } catch (error) {
    console.error('❌ Payment status check error:', error);
    await ctx.answerCbQuery('❌ Ошибка проверки статуса');
  }
}

export async function cancelPayment(ctx: Context, paymentId: string) {
  try {
    console.log(`🚫 Cancelling payment: ${paymentId}`);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      await ctx.answerCbQuery('Платеж не найден');
      return;
    }

    if (payment.status === PaymentStatus.PAID) {
      await ctx.answerCbQuery('❌ Нельзя отменить оплаченный платеж');
      return;
    }

    // Обновляем статус на CANCELLED
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'CANCELLED' }
    });

    await ctx.answerCbQuery('✅ Платеж отменен');
    await ctx.reply('❌ <b>Платеж отменен</b>\n\nВы можете создать новый заказ в любое время.', {
      parse_mode: 'HTML'
    });

  } catch (error) {
    console.error('❌ Payment cancellation error:', error);
    await ctx.answerCbQuery('❌ Ошибка отмены платежа');
  }
}
