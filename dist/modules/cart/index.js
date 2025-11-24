import { logUserAction, ensureUser } from '../../services/user-history.js';
import { getCartItems, cartItemsToText, clearCart, increaseProductQuantity, decreaseProductQuantity, removeProductFromCart } from '../../services/cart-service.js';
import { createOrderRequest } from '../../services/order-service.js';
import { getBotContent } from '../../services/bot-content-service.js';
import { prisma } from '../../lib/prisma.js';
export const cartModule = {
    async register(bot) {
        // Handle "Корзина" button
        bot.hears(['🛍️ Корзина'], async (ctx) => {
            await logUserAction(ctx, 'menu:cart');
            await showCart(ctx);
        });
        // Handle text messages for delivery address input
        bot.on('text', async (ctx, next) => {
            const user = await ensureUser(ctx);
            if (!user) {
                await next();
                return;
            }
            const text = ctx.message?.text;
            if (!text) {
                await next();
                return;
            }
            // Check if user is waiting for address input
            if (ctx.waitingForBaliAddress) {
                await handleDeliveryAddress(ctx, 'Бали', text);
                ctx.waitingForBaliAddress = false;
                return;
            }
            if (ctx.waitingForRussiaAddress) {
                await handleDeliveryAddress(ctx, 'Россия', text);
                ctx.waitingForRussiaAddress = false;
                return;
            }
            if (ctx.waitingForKazakhstanAddress) {
                await handleDeliveryAddress(ctx, 'Казахстан', text);
                ctx.waitingForKazakhstanAddress = false;
                return;
            }
            if (ctx.waitingForBelarusAddress) {
                await handleDeliveryAddress(ctx, 'Беларусь', text);
                ctx.waitingForBelarusAddress = false;
                return;
            }
            if (ctx.waitingForCustomAddress) {
                await handleDeliveryAddress(ctx, 'Произвольный', text);
                ctx.waitingForCustomAddress = false;
                return;
            }
            await next();
        });
    },
};
export async function showCart(ctx) {
    try {
        console.log('🛍️ Cart: Starting showCart function');
        // Get user from database to ensure we have the correct user ID format
        const user = await ensureUser(ctx);
        if (!user) {
            console.log('🛍️ Cart: Failed to ensure user');
            await ctx.reply('❌ Ошибка загрузки корзины. Попробуйте позже.');
            return;
        }
        const userId = user.id;
        console.log('🛍️ Cart: User ID:', userId);
        console.log('🛍️ Cart: Getting cart items for user:', userId);
        const cartItems = await getCartItems(userId);
        console.log('🛍️ Cart: Found cart items:', cartItems.length);
        if (cartItems.length === 0) {
            const emptyCartMessage = await getBotContent('cart_empty_message') || '🛍️ Ваша корзина пуста\n\nДобавьте товары из магазина!';
            await ctx.reply(emptyCartMessage, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '🛒 Перейти в магазин',
                                callback_data: 'cart:go_to_shop',
                            },
                        ],
                    ],
                },
            });
            return;
        }
        // Send each cart item separately with quantity controls
        for (const item of cartItems) {
            const rubPrice = (item.product.price * 100).toFixed(2);
            const pzPrice = item.product.price.toFixed(2);
            const itemTotalRub = (item.product.price * item.quantity * 100).toFixed(2);
            const itemTotalPz = (item.product.price * item.quantity).toFixed(2);
            const itemText = `🛍️ ${item.product.title}\n📦 Количество: ${item.quantity}\n💰 Цена: ${rubPrice} ₽ / ${pzPrice} PZ\n💵 Итого: ${itemTotalRub} ₽ / ${itemTotalPz} PZ`;
            await ctx.reply(itemText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '➖ Убрать 1',
                                callback_data: `cart:decrease:${item.productId}`,
                            },
                            {
                                text: '➕ Добавить 1',
                                callback_data: `cart:increase:${item.productId}`,
                            },
                        ],
                        [
                            {
                                text: '🗑️ Удалить товар',
                                callback_data: `cart:remove:${item.productId}`,
                            },
                        ],
                    ],
                },
            });
        }
        // Send total and action buttons
        const subtotal = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
        
        // Check if user has active partner program for 10% discount
        const partnerProfile = await prisma.partnerProfile.findUnique({
            where: { userId: userId },
            select: { isActive: true, expiresAt: true }
        });
        
        let discount = 0;
        let discountAmount = 0;
        let total = subtotal;
        let discountText = '';
        
        if (partnerProfile && partnerProfile.isActive) {
            // Check if partner program hasn't expired
            const isExpired = partnerProfile.expiresAt && new Date(partnerProfile.expiresAt) < new Date();
            if (!isExpired) {
                discount = 0.1; // 10% discount
                discountAmount = subtotal * discount;
                total = subtotal - discountAmount;
                const discountRub = (discountAmount * 100).toFixed(2);
                const discountPz = discountAmount.toFixed(2);
                discountText = `\n🎁 Скидка 10%: -${discountRub} ₽ / -${discountPz} PZ`;
            }
        }
        
        const subtotalRub = (subtotal * 100).toFixed(2);
        const subtotalPz = subtotal.toFixed(2);
        const totalRub = (total * 100).toFixed(2);
        const totalPz = total.toFixed(2);
        
        let totalMessage = `💰 Итого к оплате:\n`;
        if (discount > 0) {
            totalMessage += `💵 Сумма без скидки: ${subtotalRub} ₽ / ${subtotalPz} PZ${discountText}\n`;
        }
        totalMessage += `💳 К оплате: ${totalRub} ₽ / ${totalPz} PZ`;
        
        await ctx.reply(totalMessage, {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '💳 Оформить заказ',
                            callback_data: 'cart:checkout',
                        },
                    ],
                    [
                        {
                            text: '🗑️ Очистить корзину',
                            callback_data: 'cart:clear',
                        },
                    ],
                    [
                        {
                            text: '🛒 Продолжить покупки',
                            callback_data: 'cart:continue_shopping',
                        },
                    ],
                ],
            },
        });
    }
    catch (error) {
        console.error('🛍️ Cart: Error showing cart:', error);
        console.error('🛍️ Cart: Error details:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        await ctx.reply('❌ Ошибка загрузки корзины. Попробуйте позже.');
    }
}
// Handle cart actions
export function registerCartActions(bot) {
    // Go to shop
    bot.action('cart:go_to_shop', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:go_to_shop');
        const user = await ensureUser(ctx);
        if (user && user.selectedRegion) {
            // User has region selected, show categories directly
            const { showCategories } = await import('../shop/index.js');
            await showCategories(ctx, user.selectedRegion);
        }
        else {
            // User needs to select region first
            const { showRegionSelection } = await import('../shop/index.js');
            await showRegionSelection(ctx);
        }
    });
    // Continue shopping
    bot.action('cart:continue_shopping', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:continue_shopping');
        const user = await ensureUser(ctx);
        if (user && user.selectedRegion) {
            // User has region selected, show categories directly
            const { showCategories } = await import('../shop/index.js');
            await showCategories(ctx, user.selectedRegion);
        }
        else {
            // User needs to select region first
            const { showRegionSelection } = await import('../shop/index.js');
            await showRegionSelection(ctx);
        }
    });
    // Clear cart
    bot.action('cart:clear', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:clear');
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка загрузки корзины. Попробуйте позже.');
            return;
        }
        const userId = user.id;
        await clearCart(userId);
        await ctx.reply('🗑️ Корзина очищена');
    });
    // Force checkout (bypass minimum amount check)
    bot.action('cart:checkout:force', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:checkout:force');
        // Store flag to indicate this is a force checkout
        ctx.forceCheckout = true;
        // Call regular checkout handler
        await handleCheckout(ctx);
    });
    // Checkout
    bot.action('cart:checkout', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:checkout');
        await handleCheckout(ctx);
    });
    // Extract checkout logic to separate function
    async function handleCheckout(ctx) {
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка загрузки корзины. Попробуйте позже.');
            return;
        }
        const userId = user.id;
        const isForceCheckout = ctx.forceCheckout === true;
        try {
            console.log('🛒 CART CHECKOUT: Starting checkout for user:', userId, user.firstName, user.username);
            const cartItems = await getCartItems(userId);
            if (cartItems.length === 0) {
                const emptyCartMessage = await getBotContent('cart_empty_message') || '🛍️ Ваша корзина пуста';
                await ctx.reply(emptyCartMessage);
                return;
            }
            console.log('🛒 CART CHECKOUT: Found cart items:', cartItems.length);
            
            // Check if user has active partner program for 10% discount
            const partnerProfile = await prisma.partnerProfile.findUnique({
                where: { userId: userId },
                select: { isActive: true, expiresAt: true }
            });
            
            let discount = 0;
            if (partnerProfile && partnerProfile.isActive) {
                // Check if partner program hasn't expired
                const isExpired = partnerProfile.expiresAt && new Date(partnerProfile.expiresAt) < new Date();
                if (!isExpired) {
                    discount = 0.1; // 10% discount
                }
            }
            
            // Calculate total order amount in rubles (price * 100)
            const subtotal = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
            const discountAmount = discount > 0 ? subtotal * discount : 0;
            const total = subtotal - discountAmount;
            const totalInRubles = total * 100; // Convert PZ to rubles
            
            // Check if order amount is less than 12,000 rubles (skip check if force checkout)
            const MIN_ORDER_AMOUNT = 12000; // 12,000 rubles
            if (!isForceCheckout && totalInRubles < MIN_ORDER_AMOUNT) {
                const missingAmount = MIN_ORDER_AMOUNT - totalInRubles;
                const missingAmountPz = (missingAmount / 100).toFixed(2);
                const missingAmountRub = missingAmount.toFixed(2);
                
                await ctx.reply(
                    `💡 Для активации персональной скидки 10% и партнерской программы вы можете дополнить заказ.\n\n` +
                    `💰 Вам не хватает: ${missingAmountRub} ₽ / ${missingAmountPz} PZ\n\n` +
                    `🛒 Добавьте товары в корзину и оформите заказ снова.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '🛒 Перейти в магазин',
                                        callback_data: 'cart:go_to_shop',
                                    },
                                ],
                                [
                                    {
                                        text: '💳 Оформить заказ как есть',
                                        callback_data: 'cart:checkout:force',
                                    },
                                ],
                            ],
                        },
                    }
                );
                return;
            }
            
            // Create order in database with discounted prices
            const itemsPayload = cartItems.map((item) => {
                const originalPrice = Number(item.product.price);
                const discountedPrice = discount > 0 ? originalPrice * (1 - discount) : originalPrice;
                return {
                    productId: item.productId,
                    title: item.product.title,
                    price: discountedPrice,
                    quantity: item.quantity,
                };
            });
            
            // Check if this is a supplementary order (user had a previous order in last 24 hours)
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const previousOrder = await prisma.orderRequest.findFirst({
                where: {
                    userId: userId,
                    createdAt: {
                        gte: oneDayAgo
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });
            
            const isSupplementaryOrder = !!previousOrder;
            const orderMessage = isSupplementaryOrder 
                ? `ДОПОЛНЕННЫЙ ЗАКАЗ через корзину от ${user.firstName || 'Пользователь'}${discount > 0 ? ' (скидка 10% применена)' : ''}`
                : `Заказ через корзину от ${user.firstName || 'Пользователь'}${discount > 0 ? ' (скидка 10% применена)' : ''}`;
            
            console.log('🛒 CART CHECKOUT: Creating order request...', {
                discount: discount > 0 ? '10%' : 'none',
                itemsCount: itemsPayload.length,
                totalInRubles: totalInRubles.toFixed(2),
                isSupplementaryOrder: isSupplementaryOrder
            });
            await createOrderRequest({
                userId: userId,
                message: orderMessage,
                items: itemsPayload,
            });
            console.log('✅ CART CHECKOUT: Order request created successfully');
            
            // Create cart text with discount info
            const cartText = cartItemsToText(cartItems, discount);
            // Get user data for phone and address
            const userData = await prisma.user.findUnique({
                where: { id: userId }
            });
            let contactInfo = `📞 Свяжитесь с покупателем: @${ctx.from?.username || 'нет username'}`;
            if (userData?.phone) {
                contactInfo += `\n📱 Телефон: ${userData.phone}`;
            }
            if (userData?.deliveryAddress) {
                contactInfo += `\n📍 Адрес доставки: ${userData.deliveryAddress}`;
            }
            const orderHeader = isSupplementaryOrder 
                ? `🛍️ ДОПОЛНЕННЫЙ ЗАКАЗ от ${ctx.from?.first_name || 'Пользователь'}`
                : `🛍️ Новый заказ от ${ctx.from?.first_name || 'Пользователь'}`;
            const orderText = `${orderHeader}\n\n${cartText}\n\n${contactInfo}`;
            // Send order to specific admin with contact button
            const { getBotInstance } = await import('../../lib/bot-instance.js');
            const bot = await getBotInstance();
            if (bot) {
                const aureliaAdminId = '7077195545'; // @Aurelia_8888
                try {
                    await bot.telegram.sendMessage(aureliaAdminId, orderText, {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '💬 Написать пользователю',
                                        url: ctx.from?.username ? `https://t.me/${ctx.from.username}` : `tg://user?id=${ctx.from?.id}`
                                    },
                                    {
                                        text: '🤖 Писать через бот',
                                        callback_data: `admin_reply:${ctx.from?.id}:${ctx.from?.first_name || 'Пользователь'}`
                                    }
                                ]
                            ]
                        }
                    });
                }
                catch (error) {
                    console.error('Failed to send order notification to admin:', error);
                }
            }
            // Clear cart after successful order
            await clearCart(userId);
            const orderSuccessMessage = await getBotContent('order_success_message') || '✅ Заказ отправлен! Мы свяжемся с вами в ближайшее время.';
            await ctx.reply(orderSuccessMessage);
            // Check if user has phone and address
            if (userData?.phone && userData?.deliveryAddress) {
                // User has both phone and address - show confirmation
                await ctx.reply(`📍 Вам доставить на этот адрес?\n\n${userData.deliveryAddress}`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '✅ Да, доставить сюда',
                                    callback_data: 'delivery:confirm_existing',
                                },
                            ],
                            [
                                {
                                    text: '✏️ Изменить адрес',
                                    callback_data: 'delivery:change',
                                },
                            ],
                        ],
                    },
                });
            }
            else if (userData?.phone) {
                // User has phone but no address - ask for address
                await ctx.reply('📍 Теперь укажите адрес доставки:', {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '📍 Адрес доставки',
                                    callback_data: 'delivery:address',
                                },
                            ],
                        ],
                    },
                });
            }
            else {
                // User has no phone - ask for contact first
                await ctx.reply('📞 Для быстрой связи поделитесь своим номером телефона:', {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '📞 Поделиться контактом',
                                    callback_data: 'contact:share',
                                },
                            ],
                            [
                                {
                                    text: '⏭️ Пропустить',
                                    callback_data: 'contact:skip',
                                },
                            ],
                        ],
                    },
                });
            }
        }
        catch (error) {
            console.error('❌ CART CHECKOUT: Error processing checkout:', error);
            await ctx.reply('❌ Ошибка оформления заказа. Попробуйте позже.');
        }
    });
    // Handle increase quantity
    bot.action(/^cart:increase:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:increase');
        const match = ctx.match;
        const productId = match[1];
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка загрузки корзины. Попробуйте позже.');
            return;
        }
        const userId = user.id;
        try {
            await increaseProductQuantity(userId, productId);
            await ctx.reply('✅ Количество увеличено!');
            // Refresh cart display
            await showCart(ctx);
        }
        catch (error) {
            console.error('Error increasing quantity:', error);
            await ctx.reply('❌ Ошибка изменения количества. Попробуйте позже.');
        }
    });
    // Handle decrease quantity
    bot.action(/^cart:decrease:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:decrease');
        const match = ctx.match;
        const productId = match[1];
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка загрузки корзины. Попробуйте позже.');
            return;
        }
        const userId = user.id;
        try {
            await decreaseProductQuantity(userId, productId);
            await ctx.reply('✅ Количество уменьшено!');
            // Refresh cart display
            await showCart(ctx);
        }
        catch (error) {
            console.error('Error decreasing quantity:', error);
            await ctx.reply('❌ Ошибка изменения количества. Попробуйте позже.');
        }
    });
    // Handle remove product
    bot.action(/^cart:remove:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'cart:remove');
        const match = ctx.match;
        const productId = match[1];
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка загрузки корзины. Попробуйте позже.');
            return;
        }
        const userId = user.id;
        try {
            await removeProductFromCart(userId, productId);
            await ctx.reply('✅ Товар удален из корзины!');
            // Refresh cart display
            await showCart(ctx);
        }
        catch (error) {
            console.error('Error removing product:', error);
            await ctx.reply('❌ Ошибка удаления товара. Попробуйте позже.');
        }
    });
    // Delivery address handlers
    bot.action('delivery:address', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:address');
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка. Попробуйте позже.');
            return;
        }
        // Check if user already has a delivery address
        if (user.deliveryAddress) {
            const [addressType, ...addressParts] = user.deliveryAddress.split(': ');
            const address = addressParts.join(': ');
            await ctx.reply(`📍 Ваш текущий адрес доставки:\n\nТип: ${addressType}\nАдрес: ${address}`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '✏️ Изменить адрес',
                                callback_data: 'delivery:change',
                            },
                        ],
                        [
                            {
                                text: '✅ Использовать этот адрес',
                                callback_data: 'delivery:use_existing',
                            },
                        ],
                    ],
                },
            });
        }
        else {
            await ctx.reply('📍 Выберите тип адреса доставки:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '🇷🇺 РФ - город и адрес',
                                callback_data: 'delivery:russia',
                            },
                        ],
                        [
                            {
                                text: '🇰🇿 Казахстан - город и адрес',
                                callback_data: 'delivery:kazakhstan',
                            },
                        ],
                        [
                            {
                                text: '🇧🇾 Беларусь - город и адрес',
                                callback_data: 'delivery:belarus',
                            },
                        ],
                        [
                            {
                                text: '🇮🇩 Бали - район и вилла',
                                callback_data: 'delivery:bali',
                            },
                        ],
                        [
                            {
                                text: '✏️ Ввести свой вариант',
                                callback_data: 'delivery:custom',
                            },
                        ],
                    ],
                },
            });
        }
    });
    bot.action('delivery:bali', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:bali');
        await ctx.reply('🇮🇩 Укажите адрес для Бали:\n\n' +
            'Напишите район и название виллы (например: "Семиньяк, Villa Seminyak Resort")\n\n' +
            'Или пришлите ссылку на Google Maps с адресом.', {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🔙 Назад к выбору',
                            callback_data: 'delivery:address',
                        },
                    ],
                ],
            },
        });
        // Store state to wait for text input
        ctx.waitingForBaliAddress = true;
    });
    bot.action('delivery:russia', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:russia');
        await ctx.reply('🇷🇺 Укажите адрес для России:\n\n' +
            'Напишите ваш город и точный адрес (например: "Москва, ул. Тверская, д. 10, кв. 5")', {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🔙 Назад к выбору',
                            callback_data: 'delivery:address',
                        },
                    ],
                ],
            },
        });
        // Store state to wait for text input
        ctx.waitingForRussiaAddress = true;
    });
    bot.action('delivery:kazakhstan', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:kazakhstan');
        await ctx.reply('🇰🇿 Укажите адрес для Казахстана:\n\n' +
            'Напишите ваш город и точный адрес (например: "Алматы, пр. Абая, д. 150, кв. 25")', {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🔙 Назад к выбору',
                            callback_data: 'delivery:address',
                        },
                    ],
                ],
            },
        });
        // Store state to wait for text input
        ctx.waitingForKazakhstanAddress = true;
    });
    bot.action('delivery:belarus', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:belarus');
        await ctx.reply('🇧🇾 Укажите адрес для Беларуси:\n\n' +
            'Напишите ваш город и точный адрес (например: "Минск, ул. Независимости, д. 95, кв. 10")', {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🔙 Назад к выбору',
                            callback_data: 'delivery:address',
                        },
                    ],
                ],
            },
        });
        // Store state to wait for text input
        ctx.waitingForBelarusAddress = true;
    });
    bot.action('delivery:custom', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:custom');
        await ctx.reply('✏️ Введите свой вариант адреса:\n\n' +
            'Напишите полный адрес доставки в произвольной форме.', {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🔙 Назад к выбору',
                            callback_data: 'delivery:address',
                        },
                    ],
                ],
            },
        });
        // Store state to wait for text input
        ctx.waitingForCustomAddress = true;
    });
    bot.action('delivery:confirmed', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:confirmed');
        await ctx.reply('✅ Отлично! Ваш адрес доставки принят и сохранен.\n\n📦 Мы учтем его при отправке вашего заказа.\n\nСпасибо за предоставленную информацию!');
    });
    bot.action('delivery:change', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:change');
        await ctx.reply('📍 Выберите тип адреса доставки:', {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🇷🇺 РФ - город и адрес',
                            callback_data: 'delivery:russia',
                        },
                    ],
                    [
                        {
                            text: '🇰🇿 Казахстан - город и адрес',
                            callback_data: 'delivery:kazakhstan',
                        },
                    ],
                    [
                        {
                            text: '🇧🇾 Беларусь - город и адрес',
                            callback_data: 'delivery:belarus',
                        },
                    ],
                    [
                        {
                            text: '🇮🇩 Бали - район и вилла',
                            callback_data: 'delivery:bali',
                        },
                    ],
                    [
                        {
                            text: '✏️ Ввести свой вариант',
                            callback_data: 'delivery:custom',
                        },
                    ],
                ],
            },
        });
    });
    bot.action('delivery:use_existing', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:use_existing');
        await ctx.reply('✅ Отлично! Будем использовать ваш сохраненный адрес доставки.');
    });
    bot.action('delivery:confirm_existing', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'delivery:confirm_existing');
        await ctx.reply('✅ Отлично! Заказ будет доставлен по указанному адресу.');
    });
    // Contact sharing handlers
    bot.action('contact:share', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'contact:share');
        await ctx.reply('📞 Нажмите кнопку ниже, чтобы поделиться своим номером телефона:', {
            reply_markup: {
                keyboard: [
                    [
                        {
                            text: '📞 Поделиться номером телефона',
                            request_contact: true,
                        },
                    ],
                ],
                resize_keyboard: true,
                one_time_keyboard: true,
            },
        });
    });
    bot.action('contact:skip', async (ctx) => {
        await ctx.answerCbQuery();
        await logUserAction(ctx, 'contact:skip');
        await ctx.reply('✅ Хорошо, переходим к указанию адреса доставки.');
        // Ask for delivery address
        await ctx.reply('📍 Укажите адрес доставки:', {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '📍 Адрес доставки',
                            callback_data: 'delivery:address',
                        },
                    ],
                ],
            },
        });
    });
    // Handle contact sharing
    bot.on('contact', async (ctx) => {
        await logUserAction(ctx, 'contact:received');
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка обработки контакта. Попробуйте позже.');
            return;
        }
        const contact = ctx.message.contact;
        const phoneNumber = contact.phone_number;
        try {
            // Save phone number to user profile
            await prisma.user.update({
                where: { id: user.id },
                data: { phone: phoneNumber },
            });
            console.log(`📞 Contact received from user ${user.id}: ${phoneNumber}`);
            await ctx.reply('✅ Спасибо! Ваш номер телефона сохранен.');
            // Now ask for delivery address
            await ctx.reply('📍 Теперь укажите адрес доставки:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '📍 Адрес доставки',
                                callback_data: 'delivery:address',
                            },
                        ],
                    ],
                },
            });
        }
        catch (error) {
            console.error('❌ Error saving contact:', error);
            await ctx.reply('❌ Ошибка сохранения номера телефона. Попробуйте позже.');
        }
    });
}
// Handle delivery address input
async function handleDeliveryAddress(ctx, addressType, address) {
    try {
        const user = await ensureUser(ctx);
        if (!user) {
            await ctx.reply('❌ Ошибка. Попробуйте позже.');
            return;
        }
        // Save address to database
        const { prisma } = await import('../../lib/prisma.js');
        const fullAddress = `${addressType}: ${address}`;
        await prisma.user.update({
            where: { id: user.id },
            data: { deliveryAddress: fullAddress }
        });
        const addressText = `✅ Ваш адрес принят!\n\n📍 Адрес доставки:\nТип: ${addressType}\nАдрес: ${address}`;
        await ctx.reply(addressText, {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '✅ Адрес принят',
                            callback_data: 'delivery:confirmed',
                        },
                    ],
                    [
                        {
                            text: '✏️ Изменить адрес',
                            callback_data: 'delivery:address',
                        },
                    ],
                ],
            },
        });
        // Send address to admins
        const adminMessage = `📍 НОВЫЙ АДРЕС ДОСТАВКИ\n\n👤 Пользователь: ${user.firstName || 'Без имени'} ${user.lastName || ''} (@${user.username || 'нет username'})\n📱 Telegram ID: ${user.telegramId}\n\n📍 Адрес доставки:\nТип: ${addressType}\nАдрес: ${address}\n\n✅ Адрес принят и сохранен в системе`;
        const { sendToAllAdmins } = await import('../../config/env.js');
        await sendToAllAdmins(ctx, adminMessage);
        await logUserAction(ctx, `delivery:address_saved:${addressType}`);
    }
    catch (error) {
        console.error('❌ Error handling delivery address:', error);
        await ctx.reply('❌ Ошибка сохранения адреса. Попробуйте позже.');
    }
}
