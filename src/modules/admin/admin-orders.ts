import { Telegraf, Markup } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { prisma } from '../../lib/prisma.js';
import { getAdminChatIds } from '../../config/env.js';

interface ParsedOrderItem {
    quantity: number;
    productName: string;
    matchedProduct?: {
        id: string;
        title: string;
        price: number;
    };
}

interface ParsedOrder {
    orderNumber?: string;
    username?: string;
    items: ParsedOrderItem[];
    deliveryInfo?: string;
    rawText: string;
}

// Store pending orders for confirmation
const pendingOrders = new Map<number, { order: ParsedOrder; calculatedTotal: number }>();

// Store state for amount editing
const editingAmount = new Map<number, ParsedOrder>();

/**
 * Parse order text format:
 * @username (optional)
 * ✅ Заказ YYYY-NN
 * 
 * quantity - product_name
 * quantity - product_name
 * 
 * delivery/address info
 */
function parseOrderText(text: string): ParsedOrder | null {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    const order: ParsedOrder = {
        items: [],
        rawText: text
    };

    // Look for @username
    const usernameMatch = text.match(/@(\\w+)/);
    if (usernameMatch) {
        order.username = usernameMatch[1];
    }

    // Look for order number
    const orderNumMatch = text.match(/Заказ\\s+(\\d{4}-\\d+)/i);
    if (orderNumMatch) {
        order.orderNumber = orderNumMatch[1];
    }

    // Parse items (format: "quantity - product_name")
    const itemRegex = /^(\\d+)\\s*[-–—]\\s*(.+)$/;
    let deliveryStarted = false;

    for (const line of lines) {
        // Stop parsing items when we hit delivery/address info
        if (/^(московская|город|посёлок|адрес|доставк|\\+?\\d{10,}|\\d{3}-\\d{3}-\\d{2}-\\d{2})/i.test(line)) {
            deliveryStarted = true;
        }

        if (deliveryStarted) {
            if (!order.deliveryInfo) order.deliveryInfo = '';
            order.deliveryInfo += line + '\\n';
            continue;
        }

        const match = line.match(itemRegex);
        if (match) {
            const quantity = parseInt(match[1], 10);
            const productName = match[2].trim();
            order.items.push({ quantity, productName });
        }
    }

    return order.items.length > 0 ? order : null;
}

/**
 * Find matching product in database (fuzzy matching)
 */
async function findMatchingProduct(productName: string) {
    // Normalize search term
    const searchTerm = productName.toLowerCase()
        .replace(/[^а-яa-z0-9\\s]/g, '')
        .trim();

    // Try exact match first
    let product = await prisma.product.findFirst({
        where: {
            title: { contains: searchTerm, mode: 'insensitive' },
            isActive: true
        },
        select: { id: true, title: true, price: true }
    });

    if (product) return product;

    // Try partial match on words
    const words = searchTerm.split(/\\s+/);
    for (const word of words) {
        if (word.length < 3) continue;

        product = await prisma.product.findFirst({
            where: {
                title: { contains: word, mode: 'insensitive' },
                isActive: true
            },
            select: { id: true, title: true, price: true }
        });

        if (product) return product;
    }

    return null;
}

/**
 * Match all order items with products from database
 */
async function matchOrderProducts(order: ParsedOrder): Promise<ParsedOrder> {
    for (const item of order.items) {
        const product = await findMatchingProduct(item.productName);
        if (product) {
            item.matchedProduct = product;
        }
    }
    return order;
}

/**
 * Calculate order total from matched products
 */
function calculateOrderTotal(order: ParsedOrder): number {
    return order.items.reduce((sum, item) => {
        if (item.matchedProduct) {
            return sum + (item.quantity * item.matchedProduct.price);
        }
        return sum;
    }, 0);
}

/**
 * Format order summary for display
 */
function formatOrderSummary(order: ParsedOrder, total: number): string {
    let message = '';

    if (order.orderNumber) {
        message += `📦 <b>Заказ ${order.orderNumber}</b>\\n`;
    }

    if (order.username) {
        message += `👤 Покупатель: @${order.username}\\n`;
    }

    message += '\\n<b>Состав заказа:</b>\\n';

    for (const item of order.items) {
        if (item.matchedProduct) {
            const itemTotal = item.quantity * item.matchedProduct.price;
            message += `${item.quantity} × ${item.matchedProduct.title} = ${itemTotal.toLocaleString('ru-RU')} ₽\\n`;
        } else {
            message += `${item.quantity} × ${item.productName} ❌ <i>(не найден)</i>\\n`;
        }
    }

    message += `\\n💰 <b>Итого: ${total.toLocaleString('ru-RU')} ₽</b>`;

    return message;
}

/**
 * Show order confirmation with edit/confirm buttons
 */
async function showOrderConfirmation(ctx: Context, order: ParsedOrder, total: number) {
    const message = formatOrderSummary(order, total);

    await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Подтвердить заказ', callback_data: 'admin_order:confirm' },
                    { text: '✏️ Изменить сумму', callback_data: 'admin_order:edit_amount' }
                ],
                [{ text: '❌ Отменить', callback_data: 'admin_order:cancel' }]
            ]
        }
    });
}

/**
 * Process confirmed order
 */
async function processOrder(order: ParsedOrder, finalAmount: number) {
    // Find user by username if provided
    let user = null;
    if (order.username) {
        user = await prisma.user.findFirst({
            where: { username: order.username },
            include: { partner: true }
        });
    }

    // Create order request
    const orderData = {
        userId: user?.id,
        contact: order.username ? `@${order.username}` : undefined,
        message: order.rawText,
        itemsJson: {
            items: order.items.map(item => ({
                quantity: item.quantity,
                productName: item.productName,
                productId: item.matchedProduct?.id,
                productTitle: item.matchedProduct?.title,
                price: item.matchedProduct?.price
            })),
            total: finalAmount,
            orderNumber: order.orderNumber
        }
    };

    const orderRequest = await prisma.orderRequest.create({
        data: orderData
    });

    // Process partner bonuses if user has referrer
    if (user) {
        await processPartnerBonuses(user.id, finalAmount);
    }

    return orderRequest;
}

/**
 * Process partner bonuses and subscription extension
 */
async function processPartnerBonuses(userId: string, orderAmount: number) {
    // Find user's referrer (who invited them)
    const referral = await prisma.partnerReferral.findFirst({
        where: { referredId: userId, level: 1 },
        include: { profile: { include: { user: true } } }
    });

    if (!referral) return;

    const referrerProfile = referral.profile;

    // Get buyer's username for transaction description
    const buyer = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true }
    });

    // Calculate bonus (10% of order amount)
    const bonusAmount = orderAmount * 0.1;

    // Credit bonus to referrer
    const { recordPartnerTransaction } = await import('../../services/partner-service.js');
    await recordPartnerTransaction(
        referrerProfile.id,
        bonusAmount,
        `Бонус с заказа ${orderAmount.toLocaleString('ru-RU')} ₽ от ${buyer?.username || 'пользователя'}`,
        'CREDIT'
    );

    // Extend subscription if order >= 12,000₽ and activation is from purchase
    if (orderAmount >= 12000 && referrerProfile.activationType === 'PURCHASE') {
        const newExpiresAt = referrerProfile.expiresAt && new Date() < referrerProfile.expiresAt
            ? new Date(referrerProfile.expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000) // Extend from current expiry
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Extend from now

        await prisma.partnerProfile.update({
            where: { id: referrerProfile.id },
            data: {
                expiresAt: newExpiresAt,
                isActive: true
            }
        });
    }
}

export const adminOrderModule: BotModule = {
    async register(bot: Telegraf<Context>) {
        const adminIds = getAdminChatIds();

        // Listen for text messages from admins
        bot.on('text', async (ctx) => {
            const userId = ctx.from?.id?.toString();
            if (!userId || !adminIds.includes(userId)) return;

            const text = ctx.message.text;

            // Check if in amount editing mode
            if (editingAmount.has(ctx.from.id)) {
                const order = editingAmount.get(ctx.from.id)!;
                const amount = parseFloat(text.replace(/[^0-9.]/g, ''));

                if (isNaN(amount) || amount <= 0) {
                    await ctx.reply('❌ Неверная сумма. Введите число (например: 15000)');
                    return;
                }

                editingAmount.delete(ctx.from.id);
                pendingOrders.set(ctx.from.id, { order, calculatedTotal: amount });

                await showOrderConfirmation(ctx, order, amount);
                return;
            }

            // Try to parse as order
            const parsed = parseOrderText(text);
            if (!parsed) return;

            // Check if it has order number or username (confirm it's an order)
            if (!parsed.orderNumber && !parsed.username && parsed.items.length < 2) {
                return; // Probably not an order
            }

            await ctx.reply('⏳ Обрабатываю заказ...');

            // Match products
            const order = await matchOrderProducts(parsed);
            const total = calculateOrderTotal(order);

            // Store pending order
            pendingOrders.set(ctx.from.id, { order, calculatedTotal: total });

            // Show confirmation
            await showOrderConfirmation(ctx, order, total);
        });

        // Handle confirmation button
        bot.action('admin_order:confirm', async (ctx) => {
            await ctx.answerCbQuery();

            const pending = pendingOrders.get(ctx.from.id);
            if (!pending) {
                await ctx.reply('❌ Заказ не найден');
                return;
            }

            await ctx.reply('⏳ Проводим заказ...');

            try {
                const orderRequest = await processOrder(pending.order, pending.calculatedTotal);

                pendingOrders.delete(ctx.from.id);

                await ctx.reply(
                    `✅ <b>Заказ успешно проведен!</b>\\n\\n` +
                    `Сумма: ${pending.calculatedTotal.toLocaleString('ru-RU')} ₽\\n` +
                    `ID заказа: <code>${orderRequest.id}</code>`,
                    { parse_mode: 'HTML' }
                );
            } catch (error: any) {
                console.error('Error processing order:', error);
                await ctx.reply(`❌ Ошибка при обработке заказа: ${error.message}`);
            }
        });

        // Handle edit amount button
        bot.action('admin_order:edit_amount', async (ctx) => {
            await ctx.answerCbQuery();

            const pending = pendingOrders.get(ctx.from.id);
            if (!pending) {
                await ctx.reply('❌ Заказ не найден');
                return;
            }

            editingAmount.set(ctx.from.id, pending.order);
            await ctx.reply('✏️ Введите итоговую сумму заказа (в рублях):');
        });

        // Handle cancel button
        bot.action('admin_order:cancel', async (ctx) => {
            await ctx.answerCbQuery('Заказ отменен');
            pendingOrders.delete(ctx.from.id);
            editingAmount.delete(ctx.from.id);
            await ctx.deleteMessage();
        });
    }
};
