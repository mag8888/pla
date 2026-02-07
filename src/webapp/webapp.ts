import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Context } from '../bot/context.js';
import multer from 'multer';
import { uploadImage } from '../services/cloudinary-service.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ensureUser } from '../services/user-history.js';
import { getActiveCategories, getCategoryById, getProductById, getProductsByCategory, getAllActiveProducts } from '../services/shop-service.js';
import { CATALOG_STRUCTURE } from '../services/catalog-structure.js';
import { addProductToCart, getCartItems, cartItemsToText } from '../services/cart-service.js';
import { createOrderRequest } from '../services/order-service.js';
import { getActiveReviews } from '../services/review-service.js';
import { getOrCreatePartnerProfile, getPartnerDashboard } from '../services/partner-service.js';
import { env } from '../config/env.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

// Serve static files
// - `/webapp/<file>`  (common for SPA builds that reference `/assets/...`)
// - `/webapp/static/<file>` (backward-compatible with existing `index.html`)
const webappDir = path.join(__dirname, '../../webapp');
router.use(express.static(webappDir));
router.use('/static', express.static(webappDir));

// Main webapp route
router.get('/', (req, res) => {
  const indexPath = path.join(webappDir, 'index.html');
  console.log('📱 Serving webapp from:', indexPath);
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('❌ Error serving webapp:', err);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>WebApp Error</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
            .error { color: #e74c3c; margin: 20px 0; }
          </style>
        </head>
        <body>
          <h1>⚠️ WebApp Error</h1>
          <p class="error">Не удалось загрузить веб-приложение.</p>
          <p>Проверьте логи сервера для деталей.</p>
        </body>
        </html>
      `);
    }
  });
});

// Middleware to extract user info from Telegram WebApp
const extractTelegramUser = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    // Try multiple ways to get Telegram user data
    let telegramUser = null;

    // Method 1: From X-Telegram-User header (our custom header)
    const telegramUserHeader = req.headers['x-telegram-user'] as string;
    if (telegramUserHeader) {
      console.log('📱 Found X-Telegram-User header:', telegramUserHeader);
      try {
        telegramUser = JSON.parse(telegramUserHeader);
        console.log('✅ Telegram user from header:', telegramUser);
      } catch (e) {
        console.log('❌ Failed to parse X-Telegram-User:', e);
      }
    }

    // Method 2: From x-telegram-init-data header (original Telegram method)
    if (!telegramUser) {
      const initData = req.headers['x-telegram-init-data'] as string;
      if (initData) {
        console.log('📱 Found x-telegram-init-data:', initData);
        const urlParams = new URLSearchParams(initData);
        const userStr = urlParams.get('user');
        if (userStr) {
          telegramUser = JSON.parse(decodeURIComponent(userStr));
          console.log('✅ Telegram user from init-data:', telegramUser);
        }
      }
    }

    // Method 2: From query parameters (fallback)
    if (!telegramUser && req.query.user) {
      console.log('📱 Found user in query params:', req.query.user);
      try {
        telegramUser = JSON.parse(decodeURIComponent(req.query.user as string));
        console.log('✅ Telegram user from query:', telegramUser);
      } catch (e) {
        console.log('❌ Failed to parse user from query:', e);
      }
    }

    // Method 3: From body (for POST requests)
    if (!telegramUser && req.body && req.body.user) {
      console.log('📱 Found user in body:', req.body.user);
      telegramUser = req.body.user;
      console.log('✅ Telegram user from body:', telegramUser);
    }

    // Method 4: Mock user for development/testing
    if (!telegramUser) {
      console.log('⚠️ No Telegram user found, using mock user for development');
      telegramUser = {
        id: 123456789,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
        language_code: 'ru'
      };
    }

    (req as any).telegramUser = telegramUser;
    console.log('🔐 Final telegram user:', telegramUser);
    next();
  } catch (error) {
    console.error('❌ Error extracting Telegram user:', error);
    // Set mock user on error
    (req as any).telegramUser = {
      id: 123456789,
      first_name: 'Test',
      last_name: 'User',
      username: 'testuser',
      language_code: 'ru'
    };
    next();
  }
};

// Apply middleware to all API routes
router.use('/api', extractTelegramUser);

// Helper function to get telegram user
const getTelegramUser = (req: express.Request) => {
  return (req as any).telegramUser;
};

// API Routes

// User profile
router.get('/api/user/profile', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find or create user
    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      try {
        user = await prisma.user.create({
          data: {
            telegramId: telegramUser.id.toString(),
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            username: telegramUser.username,
          }
        });
      } catch (error: any) {
        if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
          console.warn('⚠️  MongoDB replica set not configured - user creation skipped');
          return res.status(503).json({
            error: 'Database temporarily unavailable. Please try again later.'
          });
        }
        throw error;
      }
    }

    res.json({
      id: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phone: user.phone,
      deliveryAddress: user.deliveryAddress,
      balance: (user as any).balance || 0
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile endpoint
router.put('/api/user/profile', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, deliveryAddress } = req.body;
    const { prisma } = await import('../lib/prisma.js');

    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateData: any = {};
    if (phone !== undefined) updateData.phone = phone;
    if (deliveryAddress !== undefined) updateData.deliveryAddress = deliveryAddress;

    user = await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    res.json({
      id: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phone: user.phone,
      deliveryAddress: user.deliveryAddress,
      balance: (user as any).balance || 0
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deduct balance endpoint
router.post('/api/user/deduct-balance', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const { prisma } = await import('../lib/prisma.js');
    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentBalance = (user as any).balance || 0;
    if (currentBalance < amount) {
      return res.status(400).json({
        error: 'Insufficient balance',
        currentBalance,
        required: amount
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        balance: {
          decrement: amount
        }
      },
      select: {
        id: true,
        balance: true
      }
    });

    console.log(`✅ Balance deducted: ${amount} PZ from user ${user.id}, new balance: ${updatedUser.balance}`);

    res.json({
      success: true,
      amountDeducted: amount,
      newBalance: updatedUser.balance
    });
  } catch (error) {
    console.error('Error deducting balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Categories
router.get('/api/categories', async (req, res) => {
  try {
    const categories = await getActiveCategories();
    res.json(categories);
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client catalog structure (categories -> subcategories -> SKU mapping)
router.get('/api/catalog-structure', async (_req, res) => {
  res.json({ success: true, structure: CATALOG_STRUCTURE });
});

// Total products count endpoint (must be before /api/products/:id)
router.get('/api/products/count', async (req, res) => {
  try {
    console.log('📊 Fetching product count...');
    const { prisma } = await import('../lib/prisma.js');
    const count = await prisma.product.count({
      where: { isActive: true }
    });
    console.log(`✅ Product count: ${count}`);
    res.json({ totalProducts: count });
  } catch (error: any) {
    console.error('❌ Error fetching total product count:', error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      console.warn('⚠️  MongoDB replica set not configured - returning 0');
      return res.json({ totalProducts: 0 });
    }
    res.status(500).json({
      error: 'Internal server error',
      message: error?.message || 'Unknown error'
    });
  }
});

// All products endpoint
router.get('/api/products', async (req, res) => {
  try {
    console.log('📦 Fetching all active products...');
    const products = await getAllActiveProducts();
    console.log(`✅ Found ${products?.length || 0} products`);
    res.json(products || []);
  } catch (error: any) {
    console.error('❌ Error getting all products:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    });
    res.status(500).json({
      error: 'Internal server error',
      message: error?.message || 'Unknown error',
      code: error?.code
    });
  }
});

// Products by category
router.get('/api/categories/:categoryId/products', async (req, res) => {
  try {
    const { categoryId } = req.params;

    // Получаем все активные товары без фильтрации по региону
    const products = await getProductsByCategory(categoryId);

    res.json(products);
  } catch (error) {
    console.error('Error getting products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cart operations
router.get('/api/cart/items', async (req, res) => {
  try {
    console.log('🛒 Cart items request:', req.headers);

    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      console.log('❌ No telegram user found for cart items');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ Telegram user found for cart items:', telegramUser.id);

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      console.log('❌ User not found for telegramId:', telegramUser.id, '- creating user');
      try {
        // Create user if not exists
        user = await prisma.user.create({
          data: {
            telegramId: telegramUser.id.toString(),
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            username: telegramUser.username,
          }
        });
        console.log('✅ User created:', user.id);
      } catch (error: any) {
        if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
          console.warn('⚠️  MongoDB replica set not configured - user creation failed');
          return res.status(503).json({
            error: 'Database temporarily unavailable. Please try again later.'
          });
        }
        throw error;
      }
    }

    console.log('✅ User found for cart items:', user.id);

    const cartItems = await getCartItems(user.id);
    console.log('✅ Cart items retrieved:', cartItems.length);

    // Форматируем данные для ответа, исключая null значения
    const validCartItems = cartItems
      .filter(item => item.product && item.product.isActive)
      .map(item => ({
        id: item.id,
        userId: item.userId,
        productId: item.productId,
        quantity: item.quantity,
        createdAt: item.createdAt,
        product: {
          id: item.product.id,
          title: item.product.title,
          price: item.product.price,
          imageUrl: item.product.imageUrl || null,
          summary: item.product.summary || null,
          description: item.product.description || null,
          isActive: item.product.isActive,
        }
      }));

    console.log('✅ Valid cart items:', validCartItems.length);
    res.json(validCartItems);
  } catch (error: any) {
    console.error('❌ Error getting cart items:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    });

    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      return res.status(503).json({
        error: 'База данных временно недоступна. Попробуйте позже.'
      });
    }

    res.status(500).json({
      error: 'Внутренняя ошибка сервера',
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
});

// Cart add endpoint
router.post('/api/cart/add', async (req, res) => {
  try {
    console.log('🛒 Cart add request:', {
      body: req.body,
      headers: req.headers
    });

    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      console.log('❌ No telegram user found for cart add');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ Telegram user found for cart:', telegramUser.id);

    const { productId, quantity = 1 } = req.body;
    if (!productId) {
      console.log('❌ No productId provided:', req.body);
      return res.status(400).json({ error: 'Product ID is required' });
    }

    console.log('✅ ProductId validated:', productId, 'Quantity:', quantity);

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      console.log('❌ User not found for telegramId:', telegramUser.id, '- creating user');
      try {
        // Create user if not exists
        user = await prisma.user.create({
          data: {
            telegramId: telegramUser.id.toString(),
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            username: telegramUser.username,
          }
        });
        console.log('✅ User created:', user.id);
      } catch (error: any) {
        if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
          console.warn('⚠️  MongoDB replica set not configured - user creation failed');
          return res.status(503).json({
            error: 'Database temporarily unavailable. Please try again later.'
          });
        }
        throw error;
      }
    }

    console.log('✅ User found for cart:', user.id);

    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true }
    });

    if (!product) {
      console.log('❌ Product not found:', productId);
      return res.status(404).json({ error: 'Товар не найден' });
    }

    if (!product.isActive) {
      console.log('❌ Product is not active:', productId);
      return res.status(400).json({ error: 'Товар недоступен для заказа' });
    }

    console.log('✅ Product found and active:', productId);

    // Check if item already exists in cart
    const existingItem = await prisma.cartItem.findFirst({
      where: { userId: user.id, productId }
    });

    if (existingItem) {
      console.log('✅ Updating existing cart item:', existingItem.id);
      // Update quantity
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity }
      });
    } else {
      console.log('✅ Creating new cart item');
      // Add new item
      await prisma.cartItem.create({
        data: {
          userId: user.id,
          productId,
          quantity
        }
      });
    }

    console.log('✅ Cart item added successfully');
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error adding to cart:', error);

    // Более детальная обработка ошибок
    if (error?.code === 'P2002') {
      // Unique constraint violation
      console.log('⚠️ Duplicate cart item, updating instead');
      try {
        const { prisma } = await import('../lib/prisma.js');
        const telegramUser = getTelegramUser(req);
        if (telegramUser) {
          const user = await prisma.user.findUnique({
            where: { telegramId: telegramUser.id.toString() }
          });
          if (user) {
            const existingItem = await prisma.cartItem.findFirst({
              where: { userId: user.id, productId: req.body.productId }
            });
            if (existingItem) {
              await prisma.cartItem.update({
                where: { id: existingItem.id },
                data: { quantity: existingItem.quantity + (req.body.quantity || 1) }
              });
              return res.json({ success: true });
            }
          }
        }
      } catch (retryError) {
        console.error('❌ Retry failed:', retryError);
      }
    }

    if (error?.code === 'P2003') {
      return res.status(400).json({ error: 'Товар не найден в базе данных' });
    }

    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      return res.status(503).json({
        error: 'База данных временно недоступна. Попробуйте позже.'
      });
    }

    res.status(500).json({
      error: error?.message || 'Внутренняя ошибка сервера',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

// Cart update endpoint
router.put('/api/cart/update/:cartItemId', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { cartItemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    const { prisma } = await import('../lib/prisma.js');

    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if cart item belongs to user
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: cartItemId }
    });

    if (!cartItem || cartItem.userId !== user.id) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    await prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error updating cart item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cart remove endpoint
router.delete('/api/cart/remove/:cartItemId', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { cartItemId } = req.params;
    const { prisma } = await import('../lib/prisma.js');

    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if cart item belongs to user
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: cartItemId }
    });

    if (!cartItem || cartItem.userId !== user.id) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    await prisma.cartItem.delete({
      where: { id: cartItemId }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error removing from cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Support chat (webapp) - store in UserHistory and forward to admins via bot
router.get('/api/support/messages', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { prisma } = await import('../lib/prisma.js');
    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() },
      select: { id: true }
    });

    if (!user) {
      return res.json([]);
    }

    const messages = await prisma.userHistory.findMany({
      where: { userId: user.id, action: 'support:webapp' },
      orderBy: { createdAt: 'asc' },
      take: 200
    });

    const result = messages.map((m: any) => {
      const payload = (m.payload || {}) as any;
      return {
        id: m.id,
        direction: payload.direction || 'user',
        text: payload.text || '',
        createdAt: m.createdAt
      };
    });

    res.json(result);
  } catch (error: any) {
    console.error('❌ Error fetching support messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/support/messages', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const textRaw = (req.body?.text ?? '').toString();
    const text = textRaw.trim();
    if (!text) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    if (text.length > 4000) {
      return res.status(400).json({ error: 'Message is too long' });
    }

    const { prisma } = await import('../lib/prisma.js');

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      try {
        user = await prisma.user.create({
          data: {
            telegramId: telegramUser.id.toString(),
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            username: telegramUser.username,
          }
        });
      } catch (error: any) {
        if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
          return res.status(503).json({ error: 'Database temporarily unavailable. Please try again later.' });
        }
        throw error;
      }
    }

    // Persist message
    await prisma.userHistory.create({
      data: {
        userId: user.id,
        action: 'support:webapp',
        payload: { direction: 'user', text }
      }
    });

    // Forward to admins
    try {
      const { getBotInstance } = await import('../lib/bot-instance.js');
      const { getAdminChatIds } = await import('../config/env.js');
      const bot = await getBotInstance();

      if (bot) {
        const adminIds = getAdminChatIds();
        const fromName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || 'Пользователь';
        const username = telegramUser.username ? `@${telegramUser.username}` : 'не указан';
        const adminMessage =
          '📨 <b>Сообщение в поддержку (WebApp)</b>\n\n' +
          `👤 <b>Пользователь:</b> ${fromName}\n` +
          `🆔 <b>Telegram ID:</b> <code>${telegramUser.id}</code>\n` +
          `📱 <b>Username:</b> ${username}\n\n` +
          `💬 <b>Сообщение:</b>\n${text}`;

        for (const adminId of adminIds) {
          try {
            await bot.telegram.sendMessage(adminId, adminMessage, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[{
                  text: '💬 Ответить пользователю',
                  callback_data: `admin_reply:${telegramUser.id}:${telegramUser.first_name || 'Пользователь'}`
                }]]
              }
            });
          } catch (e: any) {
            console.error(`❌ Failed to send support message to admin ${adminId}:`, e?.message || e);
          }
        }
      }
    } catch (notifyErr: any) {
      console.error('❌ Failed to notify admins about support message:', notifyErr?.message || notifyErr);
      // don't fail user request
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error sending support message:', error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      return res.status(503).json({ error: 'Database temporarily unavailable. Please try again later.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Favorites (webapp) - store in UserHistory and compute current set by folding toggles
async function getOrCreateWebappUser(req: express.Request) {
  const telegramUser = getTelegramUser(req);
  if (!telegramUser) return null;

  const { prisma } = await import('../lib/prisma.js');
  let user = await prisma.user.findUnique({
    where: { telegramId: telegramUser.id.toString() }
  });

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          telegramId: telegramUser.id.toString(),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        }
      });
    } catch (error: any) {
      if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
        return null;
      }
      throw error;
    }
  }

  return user;
}

async function getFavoritesSetForUserId(userId: string): Promise<Set<string>> {
  const { prisma } = await import('../lib/prisma.js');
  const events = await prisma.userHistory.findMany({
    where: { userId, action: 'favorites:toggle' },
    orderBy: { createdAt: 'asc' },
    take: 5000
  });

  const set = new Set<string>();
  for (const e of events as any[]) {
    const payload = (e.payload || {}) as any;
    const productId = (payload.productId || '').toString();
    const isFavorite = !!payload.isFavorite;
    if (!productId) continue;
    if (isFavorite) set.add(productId);
    else set.delete(productId);
  }
  return set;
}

router.get('/api/favorites', async (req, res) => {
  try {
    const user = await getOrCreateWebappUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const set = await getFavoritesSetForUserId(user.id);
    res.json({ productIds: Array.from(set) });
  } catch (error: any) {
    console.error('❌ Error fetching favorites:', error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      return res.status(503).json({ error: 'Database temporarily unavailable. Please try again later.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/favorites/products', async (req, res) => {
  try {
    const user = await getOrCreateWebappUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const set = await getFavoritesSetForUserId(user.id);
    const ids = Array.from(set).slice(0, 200);
    if (ids.length === 0) return res.json([]);

    const { prisma } = await import('../lib/prisma.js');
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      include: { category: true }
    });

    // Preserve user order
    const byId = new Map(products.map((p: any) => [p.id, p]));
    res.json(ids.map(id => byId.get(id)).filter(Boolean));
  } catch (error: any) {
    console.error('❌ Error fetching favorite products:', error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      return res.status(503).json({ error: 'Database temporarily unavailable. Please try again later.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/favorites/toggle', async (req, res) => {
  try {
    const user = await getOrCreateWebappUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const productId = (req.body?.productId || '').toString();
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Determine next state
    const currentSet = await getFavoritesSetForUserId(user.id);
    const next = !currentSet.has(productId);

    const { prisma } = await import('../lib/prisma.js');
    await prisma.userHistory.create({
      data: {
        userId: user.id,
        action: 'favorites:toggle',
        payload: JSON.stringify({ productId, isFavorite: next })
      }
    });

    res.json({ success: true, isFavorite: next });
  } catch (error: any) {
    console.error('❌ Error toggling favorite:', error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      return res.status(503).json({ error: 'Database temporarily unavailable. Please try again later.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Order create endpoint
router.post('/api/orders/create', async (req, res) => {
  try {
    console.log('📦 Order creation request:', {
      body: req.body,
      headers: req.headers
    });

    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      console.log('❌ No telegram user found');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ Telegram user found:', telegramUser.id);

    const { items, message = '', phone, deliveryAddress, certificateCode } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.log('❌ Invalid items:', items);
      return res.status(400).json({ error: 'Items are required' });
    }

    console.log('✅ Items validated:', items);

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      console.log('❌ User not found for telegramId:', telegramUser.id, '- creating user');
      try {
        // Create user if not exists
        user = await prisma.user.create({
          data: {
            telegramId: telegramUser.id.toString(),
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            username: telegramUser.username,
            phone: phone || null,
            deliveryAddress: deliveryAddress || null,
          }
        });
        console.log('✅ User created:', user.id);
      } catch (error: any) {
        if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
          console.warn('⚠️  MongoDB replica set not configured - user creation failed');
          return res.status(503).json({
            error: 'Database temporarily unavailable. Please try again later.'
          });
        }
        throw error;
      }
    } else {
      // Update user phone and address if provided
      if (phone || deliveryAddress) {
        const updateData: any = {};
        if (phone) updateData.phone = phone;
        if (deliveryAddress) updateData.deliveryAddress = deliveryAddress;

        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData
        });
        console.log('✅ User updated with contact info');
      }
    }

    console.log('✅ User found:', user.id);

    // Calculate order total in PZ (client prices are in PZ)
    const orderItemsForTotal = Array.isArray(items) ? items : [];
    const totalPz = orderItemsForTotal.reduce((sum: number, it: any) => {
      const price = Number(it?.price || 0);
      const qty = Number(it?.quantity || 1);
      return sum + (price * qty);
    }, 0);

    // Apply gift certificate (optional)
    let certAppliedPz = 0;
    let certRemainingPz: number | null = null;
    let certCodeUsed: string | null = null;
    if (certificateCode && String(certificateCode).trim()) {
      const code = String(certificateCode).trim().toUpperCase();
      const cert = await prisma.giftCertificate.findUnique({ where: { code } }).catch(() => null as any);
      if (!cert) {
        return res.status(400).json({ error: 'Сертификат не найден' });
      }
      if (cert.status !== 'ACTIVE' || Number(cert.remainingPz || 0) <= 0) {
        return res.status(400).json({ error: 'Сертификат недействителен или уже использован' });
      }
      if (cert.userId && String(cert.userId) !== String(user.id)) {
        return res.status(403).json({ error: 'Этот сертификат привязан к другому пользователю' });
      }

      const remaining = Number(cert.remainingPz || 0);
      const applied = Math.min(Math.max(0, totalPz), Math.max(0, remaining));
      const nextRemaining = Math.max(0, remaining - applied);

      const updated = await prisma.giftCertificate.update({
        where: { id: cert.id },
        data: {
          userId: cert.userId ? undefined : user.id, // bind on first use
          remainingPz: nextRemaining,
          status: nextRemaining <= 0 ? 'USED' : 'ACTIVE'
        }
      });

      certAppliedPz = applied;
      certRemainingPz = Number(updated.remainingPz || 0);
      certCodeUsed = code;
    }

    // Build contact string
    let contact = `@${telegramUser.username || 'user'}` || `ID: ${telegramUser.id}`;
    if (phone) {
      contact += `\n📞 Телефон: ${phone}`;
    }
    if (deliveryAddress) {
      contact += `\n📍 Адрес: ${deliveryAddress}`;
    }

    let fullMessage = message || '';
    if (certCodeUsed) {
      const due = Math.max(0, totalPz - certAppliedPz);
      const appliedRub = Math.round(certAppliedPz * 100);
      const dueRub = Math.round(due * 100);
      const remRub = certRemainingPz === null ? null : Math.round(Number(certRemainingPz) * 100);
      fullMessage += (fullMessage ? '\n\n' : '') +
        `🎟 Сертификат: ${certCodeUsed}\n` +
        `Списано: ${certAppliedPz.toFixed(2)} PZ (${appliedRub} ₽)\n` +
        (remRub !== null ? `Остаток: ${(Number(certRemainingPz) || 0).toFixed(2)} PZ (${remRub} ₽)\n` : '') +
        `К оплате: ${due.toFixed(2)} PZ (${dueRub} ₽)`;
    }

    // Create order
    const order = await prisma.orderRequest.create({
      data: {
        userId: user.id,
        message: fullMessage,
        itemsJson: JSON.stringify(items),
        status: 'NEW',
        contact: contact
      }
    });

    console.log('✅ Order created successfully:', order.id);

    // Send order notification to all admins
    try {
      const { getBotInstance } = await import('../lib/bot-instance.js');
      const { getAdminChatIds } = await import('../config/env.js');
      const bot = await getBotInstance();

      if (bot) {
        const adminIds = getAdminChatIds();

        // Format order items for notification
        let itemsText = '📦 Состав заказа:\n';
        try {
          const orderItems = Array.isArray(items) ? items : [];
          orderItems.forEach((item: any, index: number) => {
            const quantity = item.quantity || 1;
            const price = item.price || 0;
            const total = quantity * price;
            itemsText += `${index + 1}. ${item.title || 'Товар'} - ${quantity} шт. × ${price.toFixed(2)} PZ = ${total.toFixed(2)} PZ\n`;
          });
        } catch (error) {
          itemsText += 'Ошибка парсинга товаров\n';
        }

        // Get user contact info
        let contactInfo = '';
        if (user.phone) {
          contactInfo += `📱 Телефон: ${user.phone}\n`;
        }
        if (user.deliveryAddress) {
          contactInfo += `📍 Адрес доставки: ${user.deliveryAddress}\n`;
        }
        if (telegramUser.username) {
          contactInfo += `👤 Telegram: @${telegramUser.username}\n`;
        }
        contactInfo += `🆔 User ID: ${user.id}\n`;
        contactInfo += `🆔 Telegram ID: ${telegramUser.id}`;

        const orderMessage =
          '🛍️ <b>Новый заказ от пользователя</b>\n\n' +
          `👤 <b>Пользователь:</b> ${user.firstName || ''} ${user.lastName || ''}\n` +
          `${contactInfo}\n\n` +
          `${itemsText}\n` +
          (message ? `💬 <b>Сообщение:</b>\n${message}\n\n` : '') +
          `🆔 <b>ID заказа:</b> <code>${order.id}</code>\n` +
          `📅 <b>Дата:</b> ${new Date(order.createdAt).toLocaleString('ru-RU')}`;

        // Send to all admins
        for (const adminId of adminIds) {
          try {
            await bot.telegram.sendMessage(adminId, orderMessage, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '💬 Написать пользователю',
                      url: telegramUser.username
                        ? `https://t.me/${telegramUser.username}`
                        : `tg://user?id=${telegramUser.id}`
                    },
                    {
                      text: '🤖 Писать через бот',
                      callback_data: `admin_reply:${telegramUser.id}:${user.firstName || 'Пользователь'}`
                    }
                  ],
                  [
                    {
                      text: '📋 Просмотреть в админ-панели',
                      url: `${process.env.PUBLIC_BASE_URL || 'https://vital-production-82b0.up.railway.app'}/admin/resources/order-requests/${order.id}`
                    }
                  ]
                ]
              }
            });
            console.log(`✅ Order notification sent to admin: ${adminId}`);
          } catch (error: any) {
            console.error(`❌ Failed to send order notification to admin ${adminId}:`, error?.message || error);
          }
        }
      }
    } catch (error: any) {
      console.error('❌ Error sending order notification to admins:', error?.message || error);
      // Don't fail the order creation if notification fails
    }

    res.json({
      success: true,
      orderId: order.id,
      totalPz,
      certificateAppliedPz: certAppliedPz,
      certificateRemainingPz: certRemainingPz,
      payablePz: Math.max(0, totalPz - certAppliedPz)
    });
  } catch (error: any) {
    console.error('❌ Error creating order:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      name: error?.name
    });
    res.status(500).json({
      error: error?.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

// Gift certificates
router.get('/api/certificates/types', async (_req, res) => {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const types = await prisma.certificateType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }]
    });
    res.json({ success: true, types });
  } catch (error: any) {
    console.error('Certificates types error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка загрузки сертификатов' });
  }
});

router.get('/api/certificates/my', async (req, res) => {
  try {
    const user = await getOrCreateWebappUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { prisma } = await import('../lib/prisma.js');
    const certs = await prisma.giftCertificate.findMany({
      where: { userId: user.id, status: 'ACTIVE', remainingPz: { gt: 0 } as any },
      orderBy: [{ createdAt: 'desc' }]
    });
    res.json({ success: true, certificates: certs });
  } catch (error: any) {
    console.error('My certificates error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка загрузки сертификатов' });
  }
});

function generateCertificateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `VTL-${part(4)}-${part(4)}`;
}

router.post('/api/certificates/buy', async (req, res) => {
  try {
    const user = await getOrCreateWebappUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { typeId, quantity = 1 } = req.body || {};
    const qty = Math.max(1, Math.min(20, Number(quantity) || 1));
    const id = String(typeId || '').trim();
    if (!id) return res.status(400).json({ error: 'typeId is required' });

    const { prisma } = await import('../lib/prisma.js');
    const type = await prisma.certificateType.findUnique({ where: { id } });
    if (!type || !type.isActive) return res.status(404).json({ error: 'Сертификат не найден' });

    const pricePz = (Number(type.priceRub || 0) || 0) / 100;
    const valuePz = (Number(type.valueRub || 0) || 0) / 100;
    if (pricePz <= 0 || valuePz <= 0) return res.status(400).json({ error: 'Некорректные параметры сертификата' });

    const totalCostPz = pricePz * qty;
    const currentBalance = Number((user as any).balance || 0) || 0;
    if (currentBalance < totalCostPz) {
      return res.status(400).json({
        error: 'Недостаточно средств на балансе',
        requiredPz: totalCostPz,
        currentBalance
      });
    }

    // Deduct balance and issue certificates
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { balance: { decrement: totalCostPz } },
      select: { id: true, balance: true }
    });

    const created = [];
    for (let i = 0; i < qty; i++) {
      // ensure uniqueness by retrying a few times
      let cert = null as any;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCertificateCode();
        try {
          cert = await prisma.giftCertificate.create({
            data: {
              code,
              typeId: type.id,
              userId: user.id,
              initialPz: valuePz,
              remainingPz: valuePz,
              status: 'ACTIVE'
            }
          });
          break;
        } catch (e: any) {
          if (e?.code === 'P2002') continue; // collision
          throw e;
        }
      }
      if (cert) created.push(cert);
    }

    res.json({
      success: true,
      deductedPz: totalCostPz,
      newBalance: Number(updatedUser.balance || 0),
      certificates: created.map((c: any) => ({ id: c.id, code: c.code, remainingPz: c.remainingPz }))
    });
  } catch (error: any) {
    console.error('Certificates buy error:', error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      return res.status(503).json({ error: 'Database temporarily unavailable. Please try again later.' });
    }
    res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

// (ЮKassa не используется — только доставка + заказ администратору)

// Specialists
router.get('/api/specialists', async (req, res) => {
  try {
    const specialtyId = String(req.query?.specialtyId || '').trim();
    const { prisma } = await import('../lib/prisma.js');

    const where: any = { isActive: true };
    if (specialtyId) where.specialtyId = specialtyId;

    const specialists = await prisma.specialist.findMany({
      where,
      include: {
        category: true,
        specialtyRef: true
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }]
    });

    const specialties = await prisma.specialistSpecialty.findMany({
      where: { isActive: true },
      include: { category: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    });

    res.json({
      success: true,
      specialties: specialties.map(s => ({ id: s.id, name: s.name, categoryName: s.category?.name || '' })),
      specialists
    });
  } catch (error: any) {
    console.error('Specialists list error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка загрузки специалистов' });
  }
});

router.get('/api/specialists/:id', async (req, res) => {
  try {
    const id = String(req.params?.id || '').trim();
    const { prisma } = await import('../lib/prisma.js');
    const specialist = await prisma.specialist.findUnique({
      where: { id },
      include: {
        category: true,
        specialtyRef: true,
        services: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }
      }
    });
    if (!specialist || !specialist.isActive) {
      return res.status(404).json({ success: false, error: 'Специалист не найден' });
    }
    res.json({ success: true, specialist });
  } catch (error: any) {
    console.error('Specialist get error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка загрузки специалиста' });
  }
});

// Partner operations
router.get('/api/partner/dashboard', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() },
      include: { partner: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.partner) {
      return res.json({
        isActive: false,
        message: 'Партнерская программа не активирована'
      });
    }

    res.json({
      isActive: user.partner.isActive,
      balance: user.partner.balance,
      bonus: user.partner.bonus,
      referralCode: user.partner.referralCode,
      programType: user.partner.programType || 'DIRECT',
      totalPartners: user.partner.totalPartners,
      directPartners: user.partner.directPartners
    });
  } catch (error) {
    console.error('Error getting partner dashboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get partner referrals list
router.get('/api/partner/referrals', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { prisma } = await import('../lib/prisma.js');
    const { getPartnerList } = await import('../services/partner-service.js');

    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const partnerList = await getPartnerList(user.id);

    if (!partnerList) {
      return res.json({
        directPartners: [],
        multiPartners: []
      });
    }

    res.json(partnerList);
  } catch (error) {
    console.error('Error getting partner referrals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Activate partner program
router.post('/api/partner/activate', async (req, res) => {
  try {
    console.log('🤝 Partner activation request:', {
      body: req.body,
      headers: req.headers
    });

    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      console.log('❌ No telegram user found for partner activation');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ Telegram user found for partner activation:', telegramUser.id);

    const { type } = req.body;
    if (!type || !['DIRECT', 'MULTI_LEVEL'].includes(type)) {
      console.log('❌ Invalid partner program type:', type);
      return res.status(400).json({ error: 'Invalid program type' });
    }

    console.log('✅ Partner program type validated:', type);

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() },
      include: { partner: true }
    });

    if (!user) {
      console.log('❌ User not found for telegramId:', telegramUser.id, '- creating user');
      // Create user if not exists
      const newUser = await prisma.user.create({
        data: {
          telegramId: telegramUser.id.toString(),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        }
      });
      console.log('✅ User created:', newUser.id);

      // Fetch user with partner relation after creation
      user = await prisma.user.findUnique({
        where: { id: newUser.id },
        include: { partner: true }
      });
    }

    if (!user) {
      console.log('❌ Failed to create or find user');
      return res.status(500).json({ error: 'Failed to create user' });
    }

    console.log('✅ User found for partner activation:', user.id);

    // Check if user already has a partner profile
    if (user.partner) {
      console.log('✅ User already has partner profile:', user.partner.id);
      return res.json({
        success: true,
        message: 'Партнёрская программа уже активирована',
        isActive: user.partner.isActive,
        referralCode: user.partner.referralCode
      });
    }

    // Create partner profile
    console.log('✅ Creating partner profile...');
    const partnerProfile = await getOrCreatePartnerProfile(user.id, type);

    console.log('✅ Partner profile created successfully:', partnerProfile.id);
    res.json({
      success: true,
      message: 'Партнёрская программа активирована!',
      referralCode: partnerProfile.referralCode,
      programType: partnerProfile.programType
    });
  } catch (error) {
    console.error('❌ Error activating partner program:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get product by ID endpoint (must be after /api/products/count)
router.get('/api/products/:id', async (req, res) => {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const productId = req.params.id;

    // Validate that ID is a valid MongoDB ObjectID format
    if (!productId || productId.length !== 24 || !/^[0-9a-fA-F]{24}$/.test(productId)) {
      return res.status(400).json({ error: 'Invalid product ID format' });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: true
      }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error: any) {
    console.error('Error fetching product:', error);
    if (error?.code === 'P2023') {
      return res.status(400).json({ error: 'Invalid product ID format' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Total reviews count endpoint
router.get('/api/reviews/count', async (req, res) => {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const count = await prisma.review.count({
      where: { isActive: true }
    });
    res.json({ totalReviews: count });
  } catch (error) {
    console.error('Error fetching total reviews count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reviews
router.get('/api/reviews', async (req, res) => {
  try {
    const reviews = await getActiveReviews();
    res.json(reviews);
  } catch (error) {
    console.error('Error getting reviews:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Audio files (mock data for now)
router.get('/api/audio/files', async (req, res) => {
  try {
    const audioFiles = [
      {
        id: 'matrix1',
        title: 'Матрица 1 - Восстановление',
        description: 'Аудиофайл для восстановления энергетики',
        duration: '15:30',
        url: 'https://example.com/audio/matrix1.mp3'
      },
      {
        id: 'matrix2',
        title: 'Матрица 2 - Энергия',
        description: 'Аудиофайл для повышения энергии',
        duration: '12:45',
        url: 'https://example.com/audio/matrix2.mp3'
      },
      {
        id: 'matrix3',
        title: 'Матрица 3 - Гармония',
        description: 'Аудиофайл для гармонизации организма',
        duration: '18:20',
        url: 'https://example.com/audio/matrix3.mp3'
      },
      {
        id: 'matrix4',
        title: 'Матрица 4 - Исцеление',
        description: 'Аудиофайл для исцеления',
        duration: '14:10',
        url: 'https://example.com/audio/matrix4.mp3'
      },
      {
        id: 'matrix5',
        title: 'Матрица 5 - Трансформация',
        description: 'Аудиофайл для трансформации сознания',
        duration: '16:55',
        url: 'https://example.com/audio/matrix5.mp3'
      }
    ];

    res.json(audioFiles);
  } catch (error) {
    console.error('Error getting audio files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save phone number
router.post('/api/user/phone', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user phone
    await prisma.user.update({
      where: { id: user.id },
      data: { phone }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving phone:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save delivery address
router.post('/api/user/address', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user delivery address
    await prisma.user.update({
      where: { id: user.id },
      data: { deliveryAddress: address }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving address:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get balance top-up info text (admin-managed)
router.get('/api/balance/topup-info', async (_req, res) => {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const s = await prisma.settings.findUnique({ where: { key: 'balance_topup_text' } });
    res.json({ success: true, text: s?.value || '' });
  } catch (error) {
    console.error('Balance topup info error:', error);
    res.status(500).json({ success: false, error: 'Ошибка загрузки реквизитов' });
  }
});

// Submit balance top-up receipt (manual verification)
router.post('/api/balance/topup-receipt', upload.single('receipt'), async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const amountRub = Number(req.body?.amountRub || 0);
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      return res.status(400).json({ success: false, error: 'Некорректная сумма' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Чек не загружен' });
    }

    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: telegramUser.id.toString(),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        }
      });
    }

    const up = await uploadImage(req.file.buffer, { folder: 'balance-receipts' });
    const receiptUrl = up?.secureUrl || up?.url || '';
    if (!receiptUrl) {
      return res.status(500).json({ success: false, error: 'Не удалось сохранить чек' });
    }

    await (prisma as any).balanceTopUpRequest.create({
      data: {
        userId: user.id,
        amountRub: Math.round(amountRub),
        receiptUrl,
        status: 'PENDING'
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Balance receipt error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка отправки чека' });
  }
});

// Create Lava invoice for balance top-up (simple webapp flow)
router.post('/api/balance/topup', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const amountRub = Number(req.body?.amountRub || 0);
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      return res.status(400).json({ success: false, error: 'Некорректная сумма' });
    }
    const rounded = Math.round(amountRub);
    if (rounded < 10) {
      return res.status(400).json({ success: false, error: 'Минимум 10 ₽' });
    }

    const { prisma } = await import('../lib/prisma.js');
    const { lavaService } = await import('../services/lava-service.js');

    if (!lavaService.isEnabled()) {
      return res.status(503).json({ success: false, error: 'Сервис оплаты временно недоступен' });
    }

    // ensure user exists
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: telegramUser.id.toString(),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        }
      });
    }

    const balanceOrderId = `BALANCE-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        orderId: balanceOrderId,
        amount: rounded,
        currency: 'RUB',
        status: 'PENDING',
        invoiceId: 'temp-' + Date.now(),
      }
    });

    const base = process.env.PUBLIC_BASE_URL || '';
    const userEmail = (user as any).phone ? `${user.telegramId}@vital.temp` : `user_${user.telegramId}@vital.temp`;

    const invoice = await lavaService.createInvoice({
      email: userEmail,
      sum: rounded,
      orderId: payment.id,
      currency: 'RUB',
      buyerLanguage: 'RU',
      hookUrl: base ? `${base}/webhook/lava` : undefined,
      successUrl: base ? `${base}/payment/success` : undefined,
      failUrl: base ? `${base}/payment/fail` : undefined,
      customFields: {
        userId: user.id,
        telegramId: user.telegramId.toString(),
        purpose: 'balance_topup',
        balanceOrderId,
      },
      comment: `Пополнение баланса пользователя ${user.telegramId}`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        invoiceId: invoice.data.id,
        paymentUrl: invoice.data.url,
      }
    });

    res.json({ success: true, paymentId: payment.id, paymentUrl: invoice.data.url, amountRub: rounded });
  } catch (error: any) {
    console.error('Webapp topup error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка создания платежа' });
  }
});

// Get video URL
router.get('/api/video/url', async (req, res) => {
  try {
    const { env } = await import('../config/env.js');
    res.json({ videoUrl: env.videoUrl });
  } catch (error) {
    console.error('Error getting video URL:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
router.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Delivery methods
router.get('/api/delivery/methods', async (req, res) => {
  try {
    const cityRaw = String((req.query?.city as string) || '').trim();
    const city = cityRaw.replace(/\s+/g, ' ').trim();
    if (!city) return res.json({ success: true, methods: [] });
    if (city.length < 2) return res.json({ success: true, city, methods: [] });

    const { prisma } = await import('../lib/prisma.js');

    const getSetting = async (key: string, def: string) => {
      const s = await prisma.settings.findUnique({ where: { key } }).catch(() => null);
      return s?.value ?? def;
    };

    const pickupEnabled = (await getSetting('delivery_pickup_enabled', '1')) === '1';
    const courierEnabled = (await getSetting('delivery_courier_enabled', '1')) === '1';
    const pickupPriceRub = Number(await getSetting('delivery_pickup_price_rub', '620')) || 620;
    const courierPriceRub = Number(await getSetting('delivery_courier_price_rub', '875')) || 875;
    const provider = String(await getSetting('delivery_provider', 'stub')).trim();
    const cdekClientId = String(await getSetting('delivery_cdek_client_id', '')).trim();
    const cdekClientSecret = String(await getSetting('delivery_cdek_client_secret', '')).trim();
    const yandexToken = String(await getSetting('delivery_yandex_token', '')).trim();
    const originCity = String(await getSetting('delivery_origin_city', 'Москва')).trim() || 'Москва';
    const defaultWeightGrams = Number(await getSetting('delivery_default_weight_g', '500')) || 500;

    // CDEK тарификация (если включено и настроено)
    if (provider === 'cdek' && cdekClientId && cdekClientSecret) {
      try {
        const { getCdekQuote } = await import('../services/cdek-service.js');
        const methods: Array<{ id: string; title: string; priceRub: number }> = [];
        const warnings: string[] = [];

        if (pickupEnabled) {
          try {
            const q = await getCdekQuote({
              clientId: cdekClientId,
              clientSecret: cdekClientSecret,
              fromCity: originCity,
              toCity: city,
              method: 'pickup',
              weightGrams: defaultWeightGrams
            });
            methods.push({ id: 'pickup', title: 'До пункта выдачи', priceRub: q.priceRub });
          } catch (e: any) {
            warnings.push('CDEK(PВЗ): ' + (e?.message || 'ошибка тарифа'));
          }
        }

        if (courierEnabled) {
          try {
            const q = await getCdekQuote({
              clientId: cdekClientId,
              clientSecret: cdekClientSecret,
              fromCity: originCity,
              toCity: city,
              method: 'courier',
              weightGrams: defaultWeightGrams
            });
            methods.push({ id: 'courier', title: 'Курьером до двери', priceRub: q.priceRub });
          } catch (e: any) {
            warnings.push('CDEK(курьер): ' + (e?.message || 'ошибка тарифа'));
          }
        }

        if (methods.length) {
          return res.json({ success: true, city, provider, methods, warning: warnings.length ? warnings.join(' • ') : undefined });
        }

        // fall back to stub if CDEK failed to quote
        return res.json({
          success: true,
          city,
          provider,
          methods: [
            ...(pickupEnabled ? [{ id: 'pickup', title: 'До пункта выдачи', priceRub: pickupPriceRub }] : []),
            ...(courierEnabled ? [{ id: 'courier', title: 'Курьером до двери', priceRub: courierPriceRub }] : [])
          ],
          warning: warnings.length ? ('CDEK не смог рассчитать тарифы: ' + warnings.join(' • ') + ' — использую фиксированные тарифы') : 'CDEK не смог рассчитать тарифы — использую фиксированные тарифы'
        });
      } catch (error: any) {
        return res.json({
          success: true,
          city,
          provider,
          methods: [
            ...(pickupEnabled ? [{ id: 'pickup', title: 'До пункта выдачи', priceRub: pickupPriceRub }] : []),
            ...(courierEnabled ? [{ id: 'courier', title: 'Курьером до двери', priceRub: courierPriceRub }] : [])
          ],
          warning: 'CDEK ошибка интеграции — использую фиксированные тарифы'
        });
      }
    }

    // Stub тарифы (фиксированные)
    const methods: Array<{ id: string; title: string; priceRub: number }> = [];
    if (pickupEnabled) methods.push({ id: 'pickup', title: 'До пункта выдачи', priceRub: pickupPriceRub });
    if (courierEnabled) methods.push({ id: 'courier', title: 'Курьером до двери', priceRub: courierPriceRub });

    const warning =
      provider === 'cdek' && (!cdekClientId || !cdekClientSecret)
        ? 'CDEK не настроен (нужны client_id/client_secret) — использую фиксированные тарифы'
        : provider === 'yandex' && !yandexToken
          ? 'Yandex не настроен (нужен token) — использую фиксированные тарифы'
          : (provider !== 'stub' ? 'API-тарифы (Yandex) пока не включены: использую фиксированные тарифы' : '');

    res.json({ success: true, city, provider, methods, warning: warning || undefined });
  } catch (error: any) {
    console.error('Delivery methods error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка получения доставки' });
  }
});

// Delivery quote endpoint (future: CDEK / Yandex API calculation)
router.post('/api/delivery/quote', async (req, res) => {
  try {
    const cityRaw = String(req.body?.city || '').trim();
    const method = String(req.body?.method || '').trim(); // pickup | courier
    const city = cityRaw.replace(/\s+/g, ' ').trim();
    if (!city) return res.status(400).json({ success: false, error: 'city is required' });
    if (!method) return res.status(400).json({ success: false, error: 'method is required' });

    const { prisma } = await import('../lib/prisma.js');
    const getSetting = async (key: string, def: string) => {
      const s = await prisma.settings.findUnique({ where: { key } }).catch(() => null);
      return s?.value ?? def;
    };

    const provider = String(await getSetting('delivery_provider', 'stub')).trim();
    const pickupPriceRub = Number(await getSetting('delivery_pickup_price_rub', '620')) || 620;
    const courierPriceRub = Number(await getSetting('delivery_courier_price_rub', '875')) || 875;
    const cdekClientId = String(await getSetting('delivery_cdek_client_id', '')).trim();
    const cdekClientSecret = String(await getSetting('delivery_cdek_client_secret', '')).trim();
    const originCity = String(await getSetting('delivery_origin_city', 'Москва')).trim() || 'Москва';
    const defaultWeightGrams = Number(await getSetting('delivery_default_weight_g', '500')) || 500;

    if (provider === 'stub') {
      const priceRub = method === 'pickup' ? pickupPriceRub : courierPriceRub;
      return res.json({ success: true, city, method, provider, priceRub });
    }

    if (provider === 'cdek') {
      if (!cdekClientId || !cdekClientSecret) {
        return res.status(503).json({ success: false, provider, error: 'CDEK не настроен: заполните client_id/client_secret в админке' });
      }
      const { getCdekQuote } = await import('../services/cdek-service.js');
      const q = await getCdekQuote({
        clientId: cdekClientId,
        clientSecret: cdekClientSecret,
        fromCity: originCity,
        toCity: city,
        method: method === 'pickup' ? 'pickup' : 'courier',
        weightGrams: defaultWeightGrams
      });
      return res.json({ success: true, city, method, provider, priceRub: q.priceRub, periodMin: q.periodMin, periodMax: q.periodMax });
    }

    // Yandex provider placeholder
    return res.status(501).json({
      success: false,
      provider,
      error: 'Yandex тарифы пока не подключены. Используйте provider=stub или CDEK.'
    });
  } catch (error: any) {
    console.error('Delivery quote error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка расчёта доставки' });
  }
});

// Trigger product import (simple endpoint to fill catalog)
router.post('/api/import-products', async (req, res) => {
  try {
    console.log('🚀 Запрос на импорт продуктов через webapp API');

    const { prisma } = await import('../lib/prisma.js');
    const productCount = await prisma.product.count();

    if (productCount > 0) {
      return res.json({
        success: false,
        message: `Каталог уже содержит ${productCount} товаров. Импорт не требуется.`
      });
    }

    // Запускаем импорт в фоне
    import('../services/siam-import-service.js').then(async (module) => {
      try {
        const { importSiamProducts } = module;
        const result = await importSiamProducts();
        console.log(`✅ Импорт завершен через webapp API: ${result.success} успешно, ${result.errors} ошибок`);
      } catch (error: any) {
        console.error('❌ Ошибка импорта через webapp API:', error?.message || error);
      }
    }).catch((error) => {
      console.error('❌ Ошибка запуска импорта через webapp API:', error);
    });

    res.json({
      success: true,
      message: 'Импорт продуктов запущен в фоновом режиме. Проверьте каталог через несколько минут.'
    });
  } catch (error: any) {
    console.error('❌ Ошибка при запуске импорта:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    });
  }
});

// Plazma API endpoints
// Test endpoint to check API connection
router.get('/api/plazma/test', async (req, res) => {
  try {
    const { env } = await import('../config/env.js');

    return res.json({
      success: true,
      apiKeyConfigured: !!env.plazmaApiKey,
      apiUrl: env.plazmaApiUrl,
      apiKeyPreview: env.plazmaApiKey ? `${env.plazmaApiKey.substring(0, 10)}...` : 'NOT SET'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    });
  }
});

// Get products from Plazma API
router.get('/api/plazma/products', async (req, res) => {
  try {
    const { env } = await import('../config/env.js');

    if (!env.plazmaApiKey) {
      console.warn('⚠️ Plazma API key not configured');
      return res.status(503).json({
        error: 'Plazma API integration not configured',
        products: []
      });
    }

    const { region = 'RUSSIA', limit = 20 } = req.query;

    // Попробуем сначала /products, затем /catalog как fallback
    let url = `${env.plazmaApiUrl}/products?region=${region}&limit=${limit}`;
    let useCatalog = false;

    console.log('🔗 Fetching Plazma products from:', url);
    console.log('🔑 Using API key:', env.plazmaApiKey ? `${env.plazmaApiKey.substring(0, 10)}...` : 'NOT SET');

    let response = await fetch(url, {
      headers: {
        'X-API-Key': env.plazmaApiKey
      }
    });

    // Если /products не найден (404), пробуем /catalog
    if (response.status === 404) {
      console.log('⚠️ /products endpoint not found, trying /catalog...');
      url = `${env.plazmaApiUrl}/catalog?region=${region}`;
      useCatalog = true;

      response = await fetch(url, {
        headers: {
          'X-API-Key': env.plazmaApiKey
        }
      });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      console.error(`❌ Plazma API error: ${response.status} ${response.statusText}`);
      console.error(`❌ Error details:`, errorText);
      return res.status(response.status).json({
        error: `Failed to fetch products from Plazma API: ${response.status} ${response.statusText}`,
        products: []
      });
    }

    const data = await response.json() as any;
    console.log('📦 Plazma API response:', {
      endpoint: useCatalog ? '/catalog' : '/products',
      success: data.success,
      hasData: !!data.data,
      dataLength: Array.isArray(data.data) ? data.data.length : 'not array',
      dataType: typeof data.data,
      fullResponse: JSON.stringify(data).substring(0, 200) + '...'
    });

    // Обрабатываем разные форматы ответа
    let products = [];

    if (useCatalog) {
      // Если использовали /catalog, извлекаем товары из категорий
      if (data.success && Array.isArray(data.data)) {
        // data.data - это массив категорий
        data.data.forEach((category: any) => {
          if (category.products && Array.isArray(category.products)) {
            products.push(...category.products);
          }
        });
      }
    } else {
      // Если использовали /products
      if (data.success && Array.isArray(data.data)) {
        products = data.data;
      } else if (Array.isArray(data)) {
        // Если ответ - это массив напрямую
        products = data;
      } else if (data.products && Array.isArray(data.products)) {
        // Если товары в поле products
        products = data.products;
      }
    }

    console.log(`✅ Parsed ${products.length} products from Plazma API`);

    res.json({
      success: true,
      products: products.slice(0, parseInt(limit as string) || 20)
    });
  } catch (error: any) {
    console.error('❌ Error fetching Plazma products:', error);
    res.status(500).json({
      error: error?.message || 'Internal server error',
      products: []
    });
  }
});

// Get single product from Plazma API
router.get('/api/plazma/products/:id', async (req, res) => {
  try {
    const { env } = await import('../config/env.js');
    const { id } = req.params;

    if (!env.plazmaApiKey) {
      return res.status(503).json({
        error: 'Plazma API integration not configured'
      });
    }

    const url = `${env.plazmaApiUrl}/products/${id}`;
    const response = await fetch(url, {
      headers: {
        'X-API-Key': env.plazmaApiKey
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Product not found'
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('❌ Error fetching Plazma product:', error);
    res.status(500).json({
      error: error?.message || 'Internal server error'
    });
  }
});

// Create order via Plazma API
router.post('/api/plazma/orders', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { env } = await import('../config/env.js');
    const { productId, productTitle, price, quantity = 1 } = req.body;

    if (!env.plazmaApiKey) {
      return res.status(503).json({
        error: 'Plazma API integration not configured'
      });
    }

    // Get user contact info
    const { prisma } = await import('../lib/prisma.js');
    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    const contact = user?.phone || `@${telegramUser.username || 'user'}`;

    // Create order request via Plazma API
    const url = `${env.plazmaApiUrl}/orders`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': env.plazmaApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contact: contact,
        items: [{
          productId: productId,
          quantity: quantity,
          price: price
        }],
        message: `Заказ товара "${productTitle}" через Vital магазин`
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as any;
      return res.status(response.status).json({
        error: errorData.error || 'Failed to create order'
      });
    }

    const data = await response.json() as any;

    // Also create order request in our database for tracking
    let order = null;
    try {
      order = await createOrderRequest({
        userId: user?.id || '',
        contact: contact,
        items: [{
          productId: productId,
          title: productTitle,
          price: price,
          quantity: quantity
        }],
        message: `Заказ товара "${productTitle}" из Plazma через Vital магазин. Order ID: ${data.data?.orderId || 'N/A'}`
      });
      console.log('✅ Order saved to VITAL database:', order?.id);
    } catch (dbError) {
      console.warn('⚠️ Failed to save order to local database:', dbError);
      // Continue anyway - the order was created in Plazma
    }

    // Send notification to admin about Plazma order
    try {
      const { getBotInstance } = await import('../lib/bot-instance.js');
      const { getAdminChatIds } = await import('../config/env.js');
      const bot = await getBotInstance();

      if (bot && user) {
        const adminIds = getAdminChatIds();
        const totalPrice = price * quantity;
        const plazmaOrderId = data.data?.orderId || 'N/A';

        // Format order message
        let contactInfo = '';
        if (user.phone) {
          contactInfo += `📱 Телефон: ${user.phone}\n`;
        }
        if (user.deliveryAddress) {
          contactInfo += `📍 Адрес доставки: ${user.deliveryAddress}\n`;
        }
        if (telegramUser.username) {
          contactInfo += `👤 Telegram: @${telegramUser.username}\n`;
        }
        contactInfo += `🆔 User ID: ${user.id}\n`;
        contactInfo += `🆔 Telegram ID: ${telegramUser.id}`;

        const orderMessage =
          '🛍️ <b>Новый заказ Plazma от пользователя</b>\n\n' +
          `👤 <b>Пользователь:</b> ${user.firstName || ''} ${user.lastName || ''}\n` +
          `${contactInfo}\n\n` +
          `📦 <b>Товар:</b> ${productTitle}\n` +
          `📊 <b>Количество:</b> ${quantity} шт.\n` +
          `💰 <b>Цена:</b> ${price.toFixed(2)} PZ × ${quantity} = ${totalPrice.toFixed(2)} PZ\n\n` +
          `🔗 <b>Plazma Order ID:</b> <code>${plazmaOrderId}</code>\n` +
          (order ? `🆔 <b>VITAL Order ID:</b> <code>${order.id}</code>\n` : '') +
          `📅 <b>Дата:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
          `ℹ️ <i>Заказ отправлен в Plazma API и сохранен в базе VITAL</i>`;

        // Send to all admins
        for (const adminId of adminIds) {
          try {
            await bot.telegram.sendMessage(adminId, orderMessage, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '💬 Написать пользователю',
                      url: telegramUser.username
                        ? `https://t.me/${telegramUser.username}`
                        : `tg://user?id=${telegramUser.id}`
                    },
                    {
                      text: '🤖 Писать через бот',
                      callback_data: `admin_reply:${telegramUser.id}:${user.firstName || 'Пользователь'}`
                    }
                  ],
                  ...(order ? [[
                    {
                      text: '📋 Просмотреть в админ-панели VITAL',
                      url: `${env.webappUrl || 'https://vital-production-82b0.up.railway.app'}/admin/resources/order-requests/${order.id}`
                    }
                  ]] : [])
                ]
              }
            });
            console.log(`✅ Plazma order notification sent to admin: ${adminId}`);
          } catch (error: any) {
            console.error(`❌ Failed to send Plazma order notification to admin ${adminId}:`, error?.message || error);
          }
        }
      }
    } catch (notificationError) {
      console.error('❌ Error sending Plazma order notification to admins:', notificationError);
      // Don't fail the order creation if notification fails
    }

    res.json({
      success: true,
      orderId: data.data?.orderId,
      vitalOrderId: order?.id,
      message: 'Заказ успешно создан! Администратор свяжется с вами.'
    });
  } catch (error: any) {
    console.error('❌ Error creating Plazma order:', error);
    res.status(500).json({
      error: error?.message || 'Internal server error'
    });
  }
});

// SPA fallback: allow deep links like `/webapp/products/123` to load the app shell.
// Keep `/api/*` as real API endpoints (so unknown API routes become 404, not HTML).
router.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(webappDir, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) next(err);
  });
});

export { router as webappRouter };