import { Markup } from 'telegraf';
import { lavaService } from '../../services/lava-service.js';
import { prisma } from '../../lib/prisma.js';
import { ensureUser } from '../../services/user-history.js';
export async function showPaymentMethods(ctx) {
    const user = await ensureUser(ctx);
    if (!user)
        return;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💳 Оплатить картой', 'payment:card')],
        [Markup.button.callback('₿ Криптовалюта', 'payment:crypto')],
        [Markup.button.callback('📱 Мобильный платеж', 'payment:mobile')],
        [Markup.button.callback('🔙 Назад', 'back_to_cart')]
    ]);
    await ctx.reply('💳 <b>Выберите способ оплаты</b>\n\n' +
        '• <b>Карта</b> - Visa, Mastercard, МИР\n' +
        '• <b>Криптовалюта</b> - Bitcoin, Ethereum, USDT\n' +
        '• <b>Мобильный</b> - СБП, QIWI, Яндекс.Деньги', { ...keyboard, parse_mode: 'HTML' });
}
export async function createPayment(ctx, amount, orderId) {
    const user = await ensureUser(ctx);
    if (!user)
        return;
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
        // Согласно документации Lava API, нужны обязательные параметры
        const userEmail = user.phone
            ? `${user.telegramId}@plazma.temp`
            : `user_${user.telegramId}@plazma.temp`;
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
        await ctx.reply(`💳 <b>Счет на оплату создан</b>\n\n` +
            `💰 Сумма: <b>${amount} ₽</b>\n` +
            `📋 Заказ: <b>#${orderId}</b>\n\n` +
            `Нажмите кнопку ниже для перехода к оплате:`, { ...keyboard, parse_mode: 'HTML' });
    }
    catch (error) {
        console.error('❌ Payment creation error:', error);
        await ctx.reply('❌ Ошибка создания платежа. Попробуйте позже.');
    }
}
export async function createBalanceTopUp(ctx, amount) {
    const user = await ensureUser(ctx);
    if (!user)
        return;
    try {
        const orderId = `BALANCE-${Date.now()}`;
        console.log(`💳 Creating balance top-up: amount=${amount}, userId=${user.id}, orderId=${orderId}`);
        const payment = await prisma.payment.create({
            data: {
                userId: user.id,
                orderId,
                amount,
                currency: 'RUB',
                status: 'PENDING',
                invoiceId: 'temp-' + Date.now(),
            },
        });
        // Согласно документации Lava API, нужны обязательные параметры:
        // email, currency, orderId, sum (для одноразовых платежей)
        // Генерируем временный email, если у пользователя нет email
        const userEmail = user.phone
            ? `${user.telegramId}@plazma.temp`
            : `user_${user.telegramId}@plazma.temp`;
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
                telegramId: user.telegramId.toString(),
                purpose: 'balance_topup',
                balanceOrderId: orderId,
            },
            comment: `Пополнение баланса пользователя ${user.telegramId}`,
        });
        await prisma.payment.update({
            where: { id: payment.id },
            data: {
                invoiceId: invoice.data.id,
                paymentUrl: invoice.data.url,
            },
        });
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url('💳 Оплатить', invoice.data.url)],
            [Markup.button.callback('🔄 Проверить статус', `payment:check:${payment.id}`)],
            [Markup.button.callback('❌ Отменить', `payment:cancel:${payment.id}`)],
        ]);
        await ctx.reply(`💳 <b>Пополнение баланса</b>\n\n` +
            `💰 Сумма: <b>${amount.toFixed(2)} ₽</b>\n` +
            `🔖 Номер пополнения: <b>${orderId}</b>\n\n` +
            `Нажмите кнопку ниже, чтобы перейти к оплате:`, { ...keyboard, parse_mode: 'HTML' });
    }
    catch (error) {
        console.error('❌ Balance top-up creation error:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data,
            status: error.response?.status,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers
            }
        });
        // Более информативное сообщение об ошибке
        let errorMessage = '❌ Не удалось создать платеж на пополнение. Попробуйте позже.';
        if (error.response?.status === 404) {
            errorMessage += '\n\n⚠️ Проблема с API Lava. Проверьте настройки endpoint.';
        }
        else if (error.response?.status === 401) {
            errorMessage += '\n\n⚠️ Ошибка авторизации. Проверьте API ключи.';
        }
        await ctx.reply(errorMessage);
    }
}
export async function checkPaymentStatus(ctx, paymentId) {
    try {
        console.log(`🔍 Checking payment status: ${paymentId}`);
        const payment = await prisma.payment.findUnique({
            where: { id: paymentId }
        });
        if (!payment) {
            await ctx.answerCbQuery('Платеж не найден');
            return;
        }
        if (payment.status === 'PAID') {
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
                data: { status: 'PAID' }
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
                await ctx.reply(`🎉 <b>Баланс пополнен!</b>\n\n` +
                    `💰 Сумма: <b>${payment.amount.toFixed(2)} ₽</b>\n` +
                    `💳 Текущий баланс: <b>${updatedUser.balance.toFixed(2)} ₽</b>`, { parse_mode: 'HTML' });
            }
            else {
                // Обновляем статус заказа
                await prisma.orderRequest.updateMany({
                    where: { id: payment.orderId },
                    data: { status: 'COMPLETED' }
                });
                await ctx.answerCbQuery('✅ Платеж подтвержден!');
                await ctx.reply('🎉 <b>Платеж успешно оплачен!</b>\n\nВаш заказ будет обработан в ближайшее время.', {
                    parse_mode: 'HTML'
                });
            }
        }
        else {
            await ctx.answerCbQuery('⏳ Платеж еще не поступил');
        }
    }
    catch (error) {
        console.error('❌ Payment status check error:', error);
        await ctx.answerCbQuery('❌ Ошибка проверки статуса');
    }
}
export async function cancelPayment(ctx, paymentId) {
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
    }
    catch (error) {
        console.error('❌ Payment cancellation error:', error);
        await ctx.answerCbQuery('❌ Ошибка отмены платежа');
    }
}
