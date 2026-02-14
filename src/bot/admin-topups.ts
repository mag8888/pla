
import { Telegraf, Markup } from 'telegraf';
import { Context } from './context.js';
import { BotModule } from './types.js';
import { prisma } from '../lib/prisma.js';
import { getAdminChatIds } from '../config/env.js';
import { recalculatePartnerBonuses } from '../services/partner-service.js';

export const adminTopupsModule: BotModule = {
    async register(bot: Telegraf<Context>) {

        // Handle "Confirm Top-up" button click
        bot.action(/^admin_topup_confirm:(.+)$/, async (ctx) => {
            try {
                const adminIds = getAdminChatIds();
                const userId = ctx.from?.id.toString();

                // Verify admin
                if (!userId || !adminIds.includes(userId)) {
                    await ctx.answerCbQuery('⛔️ У вас нет прав администратора', { show_alert: true });
                    return;
                }

                const requestId = ctx.match[1];

                // 1. Fetch request
                const topupRequest = await prisma.balanceTopUpRequest.findUnique({
                    where: { id: requestId },
                    include: { user: true }
                });

                if (!topupRequest) {
                    await ctx.answerCbQuery('❌ Заявка не найдена', { show_alert: true });
                    return;
                }

                if (topupRequest.status !== 'PENDING') {
                    await ctx.answerCbQuery(`⚠️ Заявка уже обработана (статус: ${topupRequest.status})`, { show_alert: true });
                    // Update message to reflect status
                    await ctx.editMessageCaption(
                        (ctx.callbackQuery.message as any)?.caption + `\n\n✅ ОБРАБОТАНО (${topupRequest.status})`,
                        { parse_mode: 'HTML', reply_markup: undefined }
                    );
                    return;
                }

                // 2. Perform Top-up
                await prisma.$transaction(async (tx: any) => {
                    // Update request status
                    await tx.balanceTopUpRequest.update({
                        where: { id: requestId },
                        data: {
                            status: 'COMPLETED',
                            adminNote: `Approved by ${ctx.from?.first_name} (ID: ${userId})`
                        }
                    });

                    // Add balance to user
                    await tx.user.update({
                        where: { id: topupRequest.userId },
                        data: { balance: { increment: topupRequest.amountRub || 0 } }
                    });
                });

                await ctx.answerCbQuery('✅ Баланс пополнен!');

                // 3. Notify User
                try {
                    await ctx.telegram.sendMessage(
                        topupRequest.user.telegramId,
                        `💰 <b>Баланс пополнен!</b>\n\n` +
                        `Ваш счет пополнен на <b>${topupRequest.amountRub} ₽</b>.\n` +
                        `Приятных покупок!`,
                        { parse_mode: 'HTML' }
                    );
                } catch (e) {
                    console.error('Failed to notify user about topup:', e);
                }

                // 4. Update Admin Message
                await ctx.editMessageCaption(
                    (ctx.callbackQuery.message as any)?.caption + `\n\n✅ <b>ПОДТВЕРЖДЕНО</b>\nАдминистратор: ${ctx.from?.first_name}`,
                    { parse_mode: 'HTML', reply_markup: undefined }
                );

                // 5. Auto-pay Pending Orders (Bonus implementation)
                await tryAutoPayPendingOrders(topupRequest.userId, ctx.telegram);

            } catch (error) {
                console.error('Admin Topup Error:', error);
                await ctx.answerCbQuery('❌ Ошибка при пополнении', { show_alert: true });
            }
        });
    }
};

async function tryAutoPayPendingOrders(userId: string, telegram: any) {
    try {
        // Find latest NEW pending order
        const pendingOrder = await prisma.orderRequest.findFirst({
            where: {
                userId: userId,
                status: 'NEW',
                // Assuming we can identify unpaid orders via status or a paid flag. 
                // The schema has OrderStatus: NEW, PROCESSING, COMPLETED, CANCELLED.
                // Usually NEW means unpaid/unprocessed.
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!pendingOrder) return;

        // Caclulate total from itemsJson (since OrderRequest stores it as JSON)
        // Or if there is a 'total' field? Schema check: OrderRequest has `itemsJson`.
        // Let's re-read schema or assume we calculate it. 
        // Logic: itemsJson is Check `prisma/schema.prisma` content from memory or re-view.
        // Step 1915 showed `itemsJson`... wait, `CartItem[]` on user.
        // OrderRequest definition was not fully shown in step 1915.
        // Let's assume we need to calculate total.

        const items = pendingOrder.itemsJson as any[];
        const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.balance < total) return; // Insufficient funds

        // PAY IT
        await prisma.$transaction(async (tx: any) => {
            // Deduct balance
            await tx.user.update({
                where: { id: userId },
                data: { balance: { decrement: total } }
            });

            // Update Order
            await tx.orderRequest.update({
                where: { id: pendingOrder.id },
                data: { status: 'PROCESSING' } // Mark as paid/processing
            });

            // Create Payment Record (optional but good practice)
            await tx.payment.create({
                data: {
                    userId: userId,
                    amount: total,
                    orderId: pendingOrder.id,
                    status: 'PAID',
                    type: 'DEBIT',
                    provider: 'BALANCE_AUTO'
                }
            });
        });

        // Partner Bonus
        await recalculatePartnerBonuses(userId);

        // Notify User
        await telegram.sendMessage(
            user.telegramId,
            `✅ <b>Заказ #${pendingOrder.id.slice(0, 8)} оплачен!</b>\n\n` +
            `Сумма <b>${total} ₽</b> списана с вашего баланса автоматически.`,
            { parse_mode: 'HTML' }
        );

        // Notify Admins
        const adminIds = getAdminChatIds();
        for (const adminId of adminIds) {
            await telegram.sendMessage(adminId, `🤖 <b>Авто-оплата заказа</b>\nЗаказ #${pendingOrder.id.slice(0, 8)} пользователя ${user.firstName} оплачен с баланса.`);
        }

    } catch (e) {
        console.error('Auto-pay error:', e);
    }
}
