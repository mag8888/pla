import { Markup, Telegraf } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { ensureUser, logUserAction } from '../../services/user-history.js';
import { getActiveCategories, getCategoryById, getProductById, getProductsByCategory } from '../../services/shop-service.js';
import { addProductToCart, cartItemsToText, getCartItems } from '../../services/cart-service.js';
import { createOrderRequest } from '../../services/order-service.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { checkPartnerActivation } from '../../services/partner-service.js';

const CATEGORY_ACTION_PREFIX = 'shop:cat:';
const PRODUCT_MORE_PREFIX = 'shop:prod:more:';
const PRODUCT_CART_PREFIX = 'shop:prod:cart:';
const PRODUCT_BUY_PREFIX = 'shop:prod:buy:';
const PRODUCT_INSTRUCTION_PREFIX = 'shop:prod:instruction:';
const REGION_SELECT_PREFIX = 'shop:region:';
const SHOP_PHOTO_URL = 'https://res.cloudinary.com/dt4r1tigf/image/upload/v1765250936/plazma-bot/photos/a1zkrn91ay1mm6r7vysh.jpg';

export async function showRegionSelection(ctx: Context) {
  await logUserAction(ctx, 'shop:region_selection');
  
  await ctx.reply(
    '🌍 Выберите ваш регион для просмотра доступных товаров:',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🇷🇺 Россия', `${REGION_SELECT_PREFIX}RUSSIA`),
        Markup.button.callback('🇮🇩 Бали', `${REGION_SELECT_PREFIX}BALI`)
      ],
      [
        Markup.button.callback('🇦🇪 Дубай', `${REGION_SELECT_PREFIX}DUBAI`),
        Markup.button.callback('🇰🇿 Казахстан', `${REGION_SELECT_PREFIX}KAZAKHSTAN`)
      ],
      [
        Markup.button.callback('🇧🇾 Беларусь', `${REGION_SELECT_PREFIX}BELARUS`),
        Markup.button.callback('🌐 Другое', `${REGION_SELECT_PREFIX}OTHER`)
      ]
    ])
  );
}

export async function showCategories(ctx: Context, region?: string) {
  console.log('🛍️ showCategories called, region:', region);
  // If region not provided, try to get it from user
  if (!region) {
    const user = await ensureUser(ctx);
    region = (user as any)?.selectedRegion || 'RUSSIA';
    console.log('🛍️ Region from user:', region);
  }
  
  await logUserAction(ctx, 'shop:open', { region });
  
  try {
    console.log('🛍️ Loading categories for region:', region);
    const categories = await getActiveCategories();
    console.log('🛍️ Found active categories:', categories.length);
    
    // Debug: also check all categories
    const allCategories = await prisma.category.findMany();
    console.log('🛍️ Total categories in DB:', allCategories.length);
    allCategories.forEach(cat => {
      console.log(`  - ${cat.name} (ID: ${cat.id}, Active: ${cat.isActive})`);
    });
    
    if (categories.length === 0) {
      console.log('🛍️ No active categories found, showing empty message');
      // Получаем баланс пользователя
      const user = await ensureUser(ctx);
      if (!user) {
        await ctx.reply('❌ Ошибка загрузки данных пользователя.');
        return;
      }
      const userBalance = Number((user as any)?.balance || 0);
      
      // Check partner program status
      const hasPartnerDiscount = await checkPartnerActivation(user.id);
      let partnerInfo = '';
      if (hasPartnerDiscount) {
        partnerInfo = '\n\n🎁 Ваша скидка 10%\n✅ У вас активная партнерская программа';
      } else {
        partnerInfo = '\n\n❌ У вас не активна бонус программа, для активации нужно сделать покупку на 120PZ=12000р';
      }
      
      // Отправляем фото с описанием каталога в качестве caption
      const catalogText = `🛍️ Каталог товаров Plazma Water\n\n💰 Баланс: ${userBalance.toFixed(2)} PZ${partnerInfo}\n\nКаталог пока пуст. Добавьте категории и товары в админке.`;
      
      try {
        await ctx.replyWithPhoto(SHOP_PHOTO_URL, {
          caption: catalogText,
        });
      } catch (error) {
        console.error('Error sending shop photo:', error);
        // Fallback: отправляем без фото, если ошибка
        await ctx.reply(catalogText);
      }
      return;
    }

    // Show catalog with products grouped by categories
    const regionEmoji = region === 'RUSSIA' ? '🇷🇺' : region === 'BALI' ? '🇮🇩' : region === 'DUBAI' ? '🇦🇪' : region === 'KAZAKHSTAN' ? '🇰🇿' : region === 'BELARUS' ? '🇧🇾' : '🌐';
    const regionText = region === 'RUSSIA' ? 'Россия' : region === 'BALI' ? 'Бали' : region === 'DUBAI' ? 'Дубай' : region === 'KAZAKHSTAN' ? 'Казахстан' : region === 'BELARUS' ? 'Беларусь' : region === 'OTHER' ? 'Другое' : 'Все регионы';
    
    // Get cart items count
    const user = await ensureUser(ctx);
    let cartItemsCount = 0;
    if (user) {
      try {
        const cartItems = await getCartItems(user.id);
        cartItemsCount = cartItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      } catch (error) {
        console.warn('Failed to get cart items count:', error);
      }
    }

    const keyboard = [
      ...categories.map((category: any) => [
        {
          text: `📂 ${category.name}`,
          callback_data: `${CATEGORY_ACTION_PREFIX}${category.id}`,
        },
      ]),
      [
        {
          text: `🛒 Корзина${cartItemsCount > 0 ? ` (${cartItemsCount})` : ''}`,
          callback_data: 'shop:cart',
        },
      ],
      [
        {
          text: `🔄 Сменить регион (${regionEmoji} ${regionText})`,
          callback_data: `${REGION_SELECT_PREFIX}change`,
        },
      ]
    ];

    // Получаем баланс пользователя
    if (!user) {
      await ctx.reply('❌ Ошибка загрузки данных пользователя.');
      return;
    }
    const userBalance = Number((user as any)?.balance || 0);
    
    // Check partner program status
    const hasPartnerDiscount = await checkPartnerActivation(user.id);
    let partnerInfo = '';
    if (hasPartnerDiscount) {
      partnerInfo = '\n\n🎁 Ваша скидка 10%\n✅ У вас активная партнерская программа';
    } else {
      partnerInfo = '\n\n❌ У вас не активна бонус программа, для активации нужно сделать покупку на 120PZ=12000р';
    }
    
    // Отправляем фото с описанием каталога в качестве caption
    const catalogText = `🛍️ Каталог товаров Plazma Water\n\n💰 Баланс: ${userBalance.toFixed(2)} PZ\n📍 Регион: ${regionEmoji} ${regionText}${partnerInfo}\n\nВыберите категорию:`;
    
    console.log('🛍️ Sending shop photo with URL:', SHOP_PHOTO_URL);
    try {
      await ctx.replyWithPhoto(SHOP_PHOTO_URL, {
        caption: catalogText,
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
      console.log('✅ Shop photo sent successfully');
    } catch (error) {
      console.error('❌ Error sending shop photo:', error);
      // Fallback: отправляем без фото, если ошибка
      console.log('🔄 Falling back to text-only message');
      await ctx.reply(catalogText, {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
    }
  } catch (error) {
    console.error('Error loading categories:', error);
    // Получаем баланс пользователя
    const user = await ensureUser(ctx);
    if (!user) {
      await ctx.reply('❌ Ошибка загрузки данных пользователя.');
      return;
    }
    const userBalance = Number((user as any)?.balance || 0);
    
    // Check partner program status
    const hasPartnerDiscount = await checkPartnerActivation(user.id);
    let partnerInfo = '';
    if (hasPartnerDiscount) {
      partnerInfo = '\n\n🎁 Ваша скидка 10%\n✅ У вас активная партнерская программа';
    } else {
      partnerInfo = '\n\n❌ У вас не активна бонус программа, для активации нужно сделать покупку на 120PZ=12000р';
    }
    
    // Отправляем фото с описанием каталога в качестве caption
    const catalogText = `🛍️ Каталог товаров Plazma Water\n\n💰 Баланс: ${userBalance.toFixed(2)} PZ${partnerInfo}\n\n❌ Ошибка загрузки каталога. Попробуйте позже.`;
    
    try {
      await ctx.replyWithPhoto(SHOP_PHOTO_URL, {
        caption: catalogText,
      });
    } catch (error) {
      console.error('Error sending shop photo:', error);
      // Fallback: отправляем без фото, если ошибка
      await ctx.reply(catalogText);
    }
  }
}

function formatProductMessage(product: { title: string; summary: string; price: unknown }) {
  const pzPrice = Number(product.price);
  const rubPrice = (pzPrice * 100).toFixed(2);
  return `💧 ${product.title}\n${product.summary}\n\nЦена: ${rubPrice} ₽ / ${pzPrice} PZ`;
}

async function sendProductCards(ctx: Context, categoryId: string, region?: string) {
  try {
    const category = await getCategoryById(categoryId);
    if (!category) {
      await ctx.reply('❌ Категория не найдена.');
      return;
    }

    let products = await getProductsByCategory(categoryId);
    
    // Filter products by region
    if (region === 'RUSSIA') {
      products = products.filter((product: any) => product.availableInRussia);
    } else if (region === 'BALI') {
      products = products.filter((product: any) => product.availableInBali);
    } else if (region === 'DUBAI' || region === 'KAZAKHSTAN' || region === 'BELARUS' || region === 'OTHER') {
      // Для новых регионов показываем все товары (можно будет добавить отдельные флаги в БД позже)
      // products = products; // уже все товары
    }
    
    if (products.length === 0) {
      const regionText = region === 'RUSSIA' ? 'России' : region === 'BALI' ? 'Бали' : region === 'DUBAI' ? 'Дубая' : region === 'KAZAKHSTAN' ? 'Казахстана' : region === 'BELARUS' ? 'Беларуси' : region === 'OTHER' ? 'других регионов' : '';
      await ctx.reply(`📂 ${category.name}\n\nВ этой категории нет товаров для ${regionText}.`);
      return;
    }

    // Show category header
    await ctx.reply(`📂 ${category.name}\n\nТовары в категории:`);

    // Send products in a grid layout with delay between each product
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`🛍️ Product: ${product.title}, ImageUrl: ${product.imageUrl}`);
      
      const buttons = [];
      
      // Первая строка: Подробнее + Инструкция
      const firstRow = [];
      if (product.description) {
        firstRow.push(Markup.button.callback('📖 Подробнее', `${PRODUCT_MORE_PREFIX}${product.id}`));
      }
      if (product.instruction) {
        firstRow.push(Markup.button.callback('📋 Инструкция', `${PRODUCT_INSTRUCTION_PREFIX}${product.id}`));
      }
      if (firstRow.length > 0) {
        buttons.push(firstRow);
      }
      
      // Вторая строка: В корзину + Купить
      const secondRow = [];
      secondRow.push(Markup.button.callback('🛒 В корзину', `${PRODUCT_CART_PREFIX}${product.id}`));
      secondRow.push(Markup.button.callback('💳 Купить', `${PRODUCT_BUY_PREFIX}${product.id}`));
      buttons.push(secondRow);

      const message = formatProductMessage(product);
      
      if (product.imageUrl && product.imageUrl.trim() !== '') {
        console.log(`🛍️ Sending product with image: ${product.imageUrl}`);
        await ctx.replyWithPhoto(product.imageUrl, {
          caption: message,
          ...Markup.inlineKeyboard(buttons),
        });
      } else {
        console.log(`🛍️ Sending product without image (no imageUrl)`);
        await ctx.reply(message, Markup.inlineKeyboard(buttons));
      }
      
      // Add 1 second delay between products (except for the last one)
      if (i < products.length - 1) {
        console.log(`🛍️ Waiting 1 second before next product...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

  } catch (error) {
    console.error('Error loading products:', error);
    await ctx.reply('❌ Ошибка загрузки товаров. Попробуйте позже.');
  }
}

async function handleAddToCart(ctx: Context, productId: string) {
  const user = await ensureUser(ctx);
  if (!user) {
    await ctx.reply('Не удалось определить пользователя. Попробуйте позже.');
    return;
  }

  const product = await getProductById(productId);
  if (!product) {
    await ctx.reply('Товар не найден.');
    return;
  }

  await addProductToCart(user.id, product.id);
  await logUserAction(ctx, 'shop:add-to-cart', { productId: product.id });
  await ctx.answerCbQuery('Добавлено в корзину ✅');
  
  // Get updated cart info for button
  const cartItems = await getCartItems(user.id);
  const totalQuantity = cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalSum = cartItems.reduce((sum, item) => sum + ((item.product?.price || 0) * (item.quantity || 0)), 0);
  
  const cartButtonText = `🛒 Корзина (${totalQuantity} 💧, ${totalSum.toFixed(2)} PZ)`;
  
  await ctx.reply(`«${product.title}» добавлен(а) в корзину.`, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: cartButtonText,
            callback_data: 'shop:cart'
          }
        ]
      ]
    }
  });
}

async function handleProductMore(ctx: Context, productId: string) {
  const product = await getProductById(productId);
  if (!product || !product.description) {
    await ctx.answerCbQuery('Описание не найдено');
    return;
  }

  await logUserAction(ctx, 'shop:product-details', { productId });
  await ctx.answerCbQuery();
  
  // Создаем кнопки для действий с товаром
  const actionButtons = [
    [
      Markup.button.callback('🛒 В корзину', `${PRODUCT_CART_PREFIX}${product.id}`),
      Markup.button.callback('💳 Купить', `${PRODUCT_BUY_PREFIX}${product.id}`)
    ]
  ];
  
  await ctx.reply(`ℹ️ ${product.title}\n\n${product.description}`, Markup.inlineKeyboard(actionButtons));
}

async function handleProductInstruction(ctx: Context, productId: string) {
  const product = await getProductById(productId);
  if (!product || !product.instruction) {
    await ctx.answerCbQuery('Инструкция не найдена');
    return;
  }

  await logUserAction(ctx, 'shop:product-instruction', { productId });
  await ctx.answerCbQuery();
  
  // Создаем кнопки для действий с товаром
  const actionButtons = [
    [
      Markup.button.callback('🛒 В корзину', `${PRODUCT_CART_PREFIX}${product.id}`),
      Markup.button.callback('💳 Купить', `${PRODUCT_BUY_PREFIX}${product.id}`)
    ]
  ];
  
  await ctx.reply(`📋 Инструкция по применению\n\n${product.title}\n\n${product.instruction}`, Markup.inlineKeyboard(actionButtons));
}

async function handleBuy(ctx: Context, productId: string) {
  const user = await ensureUser(ctx);
  if (!user) {
    await ctx.reply('Не удалось определить пользователя. Попробуйте позже.');
    return;
  }

  const product = await getProductById(productId);
  if (!product) {
    await ctx.reply('Товар не найден.');
    return;
  }

  // Check if user has active partner program
  const { checkPartnerActivation } = await import('../../services/partner-service.js');
  const { calculatePriceWithDiscount } = await import('../../services/cart-service.js');
  const hasPartnerDiscount = await checkPartnerActivation(user.id);

  const cartItems = await getCartItems(user.id);
  
  // Create full items list including main product
  const allItems = [...cartItems];
  allItems.push({
    product: {
      title: product.title,
      price: Number(product.price)
    },
    quantity: 1
  } as any);
  
  const summaryText = await cartItemsToText(allItems, user.id);

  const lines = [
    '🛒 Запрос на покупку',
    `Пользователь: ${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    user.username ? `@${user.username}` : undefined,
    `Telegram ID: ${user.telegramId}`,
    `Основной товар: ${product.title}`,
    '',
    'Корзина:',
    summaryText
  ].filter(Boolean);

  const message = lines.join('\n');

  // Create items payload with discounted prices
  const itemsPayload = await Promise.all(cartItems.map(async (item: any) => {
    const priceInfo = await calculatePriceWithDiscount(user.id, item.product.price);
    return {
      productId: item.productId,
      title: item.product.title,
      price: priceInfo.discountedPrice, // Save discounted price
      originalPrice: priceInfo.originalPrice, // Save original price for reference
      quantity: item.quantity,
      hasDiscount: priceInfo.hasDiscount,
      discount: priceInfo.discount,
    };
  }));

  // Add main product with discount
  const productPriceInfo = await calculatePriceWithDiscount(user.id, Number(product.price));
  itemsPayload.push({
    productId: product.id,
    title: product.title,
    price: productPriceInfo.discountedPrice, // Save discounted price
    originalPrice: productPriceInfo.originalPrice, // Save original price for reference
    quantity: 1,
    hasDiscount: productPriceInfo.hasDiscount,
    discount: productPriceInfo.discount,
  });

  let orderMessage = `Покупка через бота. Основной товар: ${product.title}`;
  if (hasPartnerDiscount) {
    orderMessage += '\n🎁 Применена скидка партнера 10%';
  }

  console.log('🛒 SHOP: About to create order request for user:', user.id, user.firstName, user.username);
  
  await createOrderRequest({
    userId: user.id,
    message: orderMessage,
    items: itemsPayload,
  });
  
  console.log('✅ SHOP: Order request created successfully');

  await logUserAction(ctx, 'shop:buy', { productId });

  // Send order to specific admin with contact button
  const { getBotInstance } = await import('../../lib/bot-instance.js');
  const bot = await getBotInstance();
  
  if (bot) {
    const aureliaAdminId = '7077195545'; // @Aurelia_8888
    const fullMessage = `${message}\n\nЗдравствуйте, хочу приобрести товар…`;
    
    try {
      await bot.telegram.sendMessage(aureliaAdminId, fullMessage, {
        parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
                text: '💬 Написать пользователю',
                url: user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.telegramId}`
          },
          {
                text: '🤖 Писать через бот',
                callback_data: `admin_reply:${user.telegramId}:${user.firstName || 'Пользователь'}`
              }
            ]
          ]
        }
      });
    } catch (error) {
      console.error('Failed to send order notification to admin:', error);
    }
  }

  await ctx.answerCbQuery();

  let replyMessage = '📞 <b>В ближайшее время с вами свяжется менеджер.</b>\n\n';
  
  if (hasPartnerDiscount) {
    replyMessage += '🎁 <b>Применена скидка партнера 10%!</b>\n\n';
  }
  
  replyMessage += 'Вы можете написать менеджеру напрямую: @Aurelia_8888';

  await ctx.reply(replyMessage, {
    parse_mode: 'HTML'
  });
}

export const shopModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    console.log('🛍️ Registering shop module...');

    // Handle shop command
    bot.command('shop', async (ctx) => {
      await logUserAction(ctx, 'command:shop');
      await showRegionSelection(ctx);
    });

    bot.hears(['Магазин', 'Каталог', '🛒 Магазин'], async (ctx) => {
      console.log('🛍️ Shop button pressed by user:', ctx.from?.id);
      
      const user = await ensureUser(ctx);
      if (user && (user as any).selectedRegion) {
        // User already has a region selected, show categories directly
        console.log('🛍️ User has region selected:', (user as any).selectedRegion);
        await showCategories(ctx, (user as any).selectedRegion);
      } else {
        // User needs to select region first
        console.log('🛍️ User needs to select region first');
        await showRegionSelection(ctx);
      }
    });

    // Handle region selection
    bot.action(new RegExp(`^${REGION_SELECT_PREFIX}(.+)$`), async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const regionOrAction = match[1];
      await ctx.answerCbQuery();
      
      if (regionOrAction === 'change') {
        await showRegionSelection(ctx);
        return;
      }
      
      // Save region to user and show categories
      const user = await ensureUser(ctx);
      const validRegions: Array<'RUSSIA' | 'BALI' | 'DUBAI' | 'KAZAKHSTAN' | 'BELARUS' | 'OTHER'> = ['RUSSIA', 'BALI', 'DUBAI', 'KAZAKHSTAN', 'BELARUS', 'OTHER'];
      if (user && validRegions.includes(regionOrAction as any)) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { selectedRegion: regionOrAction as 'RUSSIA' | 'BALI' | 'DUBAI' | 'KAZAKHSTAN' | 'BELARUS' | 'OTHER' }
          });
        } catch (error: any) {
          // Если БД недоступна, продолжаем работу с выбранным регионом в памяти
          console.warn('Failed to save region to database (non-critical):', error.message?.substring(0, 100));
        }
        await logUserAction(ctx, 'shop:region_selected', { region: regionOrAction });
        await showCategories(ctx, regionOrAction);
      }
    });

    bot.action(new RegExp(`^${CATEGORY_ACTION_PREFIX}(.+)$`), async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const categoryId = match[1];
      await ctx.answerCbQuery();
      
      // Get user's selected region
      const user = await ensureUser(ctx);
      const region = (user as any)?.selectedRegion || 'RUSSIA';
      
      await logUserAction(ctx, 'shop:category', { categoryId, region });
      await sendProductCards(ctx, categoryId, region);
    });

    bot.action(new RegExp(`^${PRODUCT_MORE_PREFIX}(.+)$`), async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const productId = match[1];
      await handleProductMore(ctx, productId);
    });

    bot.action(new RegExp(`^${PRODUCT_INSTRUCTION_PREFIX}(.+)$`), async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const productId = match[1];
      await handleProductInstruction(ctx, productId);
    });

    bot.action(new RegExp(`^${PRODUCT_CART_PREFIX}(.+)$`), async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const productId = match[1];
      await handleAddToCart(ctx, productId);
    });

    bot.action(new RegExp(`^${PRODUCT_BUY_PREFIX}(.+)$`), async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const productId = match[1];
      await handleBuy(ctx, productId);
    });

    // Handle cart button from shop
    bot.action('shop:cart', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'shop:cart');
      const { showCart } = await import('../cart/index.js');
      await showCart(ctx);
    });

    // Handle payment methods
    bot.action('payment:card', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'payment:card');
      // TODO: Implement card payment
      await ctx.reply('💳 Оплата картой будет доступна в ближайшее время');
    });

    bot.action('payment:crypto', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'payment:crypto');
      // TODO: Implement crypto payment
      await ctx.reply('₿ Криптовалютная оплата будет доступна в ближайшее время');
    });

    bot.action('payment:mobile', async (ctx) => {
      await ctx.answerCbQuery();
      await logUserAction(ctx, 'payment:mobile');
      // TODO: Implement mobile payment
      await ctx.reply('📱 Мобильная оплата будет доступна в ближайшее время');
    });

    // Handle payment status checks
    bot.action(/^payment:check:(.+)$/, async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const paymentId = match[1];
      const { checkPaymentStatus } = await import('../payment/index.js');
      await checkPaymentStatus(ctx, paymentId);
    });

    // Handle payment cancellation
    bot.action(/^payment:cancel:(.+)$/, async (ctx) => {
      const match = ctx.match as RegExpExecArray;
      const paymentId = match[1];
      const { cancelPayment } = await import('../payment/index.js');
      await cancelPayment(ctx, paymentId);
    });

  },
};
