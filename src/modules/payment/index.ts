import { Context } from '../../bot/context.js';
import { Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { ensureUser } from '../../services/user-history.js';

export async function showPaymentMethods(ctx: Context) {
  const user = await ensureUser(ctx);
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
  await ctx.reply('⚠️ Платежи временно недоступны. Пожалуйста, попробуйте позже.');
}

export async function createBalanceTopUp(ctx: Context, amount: number) {
  await ctx.reply('⚠️ Пополнение баланса временно недоступно. Пожалуйста, попробуйте позже.');
}

export async function checkPaymentStatus(ctx: Context, paymentId: string) {
  await ctx.answerCbQuery('⚠️ Проверка платежей временно недоступна');
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

    if (payment.status === 'PAID') {
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
