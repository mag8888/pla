import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Context } from '../bot/context.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ensureUser } from '../services/user-history.js';
import { getActiveCategories, getCategoryById, getProductById, getProductsByCategory } from '../services/shop-service.js';
import { addProductToCart, getCartItems, cartItemsToText, calculatePriceWithDiscount } from '../services/cart-service.js';
import { checkPartnerActivation } from '../services/partner-service.js';
import { createOrderRequest } from '../services/order-service.js';
import { getActiveReviews } from '../services/review-service.js';
import { getOrCreatePartnerProfile, getPartnerDashboard } from '../services/partner-service.js';
import { PartnerProgramType } from '../models/PartnerProfile.js';
import { env } from '../config/env.js';

const router = express.Router();

// Serve static files
router.use('/static', express.static(path.join(__dirname, '../../webapp')));

// Main webapp route
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../webapp/index.html'));
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

type WebappUser = {
  id: string;
  telegramId: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  phone?: string | null;
  deliveryAddress?: string | null;
  balance: number;
  selectedRegion: string;
};

/** Find or create user. Tries Prisma first; on P2031 (replica set) falls back to Mongoose. */
async function getOrCreateWebappUser(telegramUser: { id: number; first_name?: string; last_name?: string; username?: string }): Promise<WebappUser | null> {
  const telegramId = telegramUser.id.toString();
  try {
    const { prisma } = await import('../lib/prisma.js');
    let user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        }
      });
    }
    return {
      id: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phone: user.phone,
      deliveryAddress: user.deliveryAddress,
      balance: (user as any).balance ?? 0,
      selectedRegion: (user as any).selectedRegion ?? 'RUSSIA',
    };
  } catch (prismaError: any) {
    const isReplicaError = prismaError?.code === 'P2031' || prismaError?.message?.includes?.('replica set');
    if (!isReplicaError) {
      throw prismaError;
    }
    try {
      const { User } = await import('../models/index.js');
      const doc = await User.findOneAndUpdate(
        { telegramId },
        {
          $set: {
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            username: telegramUser.username,
          },
        },
        { upsert: true, new: true }
      );
      if (!doc) return null;
      const u = doc.toObject ? doc.toObject() : doc;
      return {
        id: (u as any)._id?.toString() ?? (u as any).id,
        telegramId: (u as any).telegramId,
        firstName: (u as any).firstName,
        lastName: (u as any).lastName,
        username: (u as any).username,
        phone: (u as any).phone,
        deliveryAddress: (u as any).deliveryAddress,
        balance: (u as any).balance ?? 0,
        selectedRegion: (u as any).selectedRegion ?? 'RUSSIA',
      };
    } catch (mongooseError) {
      console.error('Mongoose fallback for user failed:', mongooseError);
      throw prismaError;
    }
  }
}

// API Routes

// User profile
router.get('/api/user/profile', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error getting user profile:', error);
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

// Products by category
router.get('/api/categories/:categoryId/products', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const region = req.query.region as string || 'RUSSIA';
    
    const products = await getProductsByCategory(categoryId);
    
    // Filter by region
    let filteredProducts = products;
    if (region === 'RUSSIA') {
      filteredProducts = products.filter((product: any) => product.availableInRussia);
    } else if (region === 'BALI') {
      filteredProducts = products.filter((product: any) => product.availableInBali);
    }
    
    res.json(filteredProducts);
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
    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }
    console.log('✅ User found for cart items:', user.id);

    const cartItems = await getCartItems(user.id);
    console.log('✅ Cart items retrieved:', cartItems.length);
    
    // Check if user has active partner program and apply discount
    const hasPartnerDiscount = await checkPartnerActivation(user.id);
    
    // Add discounted prices to cart items
    const cartItemsWithDiscount = await Promise.all(cartItems.map(async (item: any) => {
      const priceInfo = await calculatePriceWithDiscount(user.id, item.product.price);
      return {
        ...item,
        product: {
          ...item.product,
          originalPrice: priceInfo.originalPrice,
          discountedPrice: priceInfo.discountedPrice,
          hasDiscount: priceInfo.hasDiscount,
          discount: priceInfo.discount,
        }
      };
    }));
    
    res.json(cartItemsWithDiscount);
  } catch (error) {
    console.error('❌ Error getting cart items:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }

    console.log('✅ User found for cart:', user.id);

    for (let i = 0; i < quantity; i++) {
      await addProductToCart(user.id, productId);
    }

    console.log('✅ Cart item added successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error adding to cart:', error);
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

    const { items, message = '' } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.log('❌ Invalid items:', items);
      return res.status(400).json({ error: 'Items are required' });
    }

    console.log('✅ Items validated:', items);

    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }
    console.log('✅ User found:', user.id);

    // Check if user has active partner program
    const hasPartnerDiscount = await checkPartnerActivation(user.id);
    
    // Process items and apply discount
    const { getProductById } = await import('../services/shop-service.js');
    const itemsWithDiscount = await Promise.all(items.map(async (item: any) => {
      // Get product to get original price
      const product = await getProductById(item.productId);
      if (!product) {
        return item; // Return original item if product not found
      }
      
      const priceInfo = await calculatePriceWithDiscount(user.id, product.price);
      
      return {
        productId: item.productId,
        title: product.title,
        price: priceInfo.discountedPrice, // Final price after discount
        originalPrice: priceInfo.originalPrice, // Original price before discount
        quantity: item.quantity || 1,
        hasDiscount: priceInfo.hasDiscount,
        discount: priceInfo.discount,
      };
    }));

    let orderMessage = message || 'Заказ через веб-приложение';
    if (hasPartnerDiscount) {
      orderMessage += '\n🎁 Применена скидка партнера 10%';
    }

    // Create order using order service
    const order = await createOrderRequest({
      userId: user.id,
      message: orderMessage,
      items: itemsWithDiscount,
      contact: `@${telegramUser.username || 'user'}` || `ID: ${telegramUser.id}`
    });

    console.log('✅ Order created successfully:', order.id);
    res.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('❌ Error creating order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Partner operations (use getOrCreateWebappUser + getPartnerDashboard to avoid Prisma P2031)
router.get('/api/partner/dashboard', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }
    const dashboard = await getPartnerDashboard(user.id);
    if (!dashboard?.profile) {
      return res.json({
        isActive: false,
        message: 'Партнерская программа не активирована'
      });
    }
    const p = dashboard.profile as any;
    res.json({
      isActive: p.isActive,
      balance: p.balance ?? 0,
      bonus: p.bonus ?? 0,
      referralCode: p.referralCode,
      totalPartners: dashboard.stats?.partners ?? 0,
      directPartners: dashboard.stats?.directPartners ?? 0
    });
  } catch (error) {
    console.error('Error getting partner dashboard:', error);
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

    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }
    console.log('✅ User found for partner activation:', user.id);

    const dashboard = await getPartnerDashboard(user.id);
    if (dashboard?.profile) {
      console.log('✅ User already has partner profile');
      return res.json({
        success: true,
        message: 'Партнёрская программа уже активирована',
        isActive: dashboard.profile.isActive,
        referralCode: dashboard.profile.referralCode
      });
    }

    // Create partner profile (Mongoose)
    console.log('✅ Creating partner profile...');
    const partnerProfile = await getOrCreatePartnerProfile(user.id, type === 'MULTI_LEVEL' ? PartnerProgramType.MULTI_LEVEL : PartnerProgramType.DIRECT);
    
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

// Get product by ID endpoint
router.get('/api/products/:id', async (req, res) => {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const productId = req.params.id;
    
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
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Total products count endpoint
router.get('/api/products/count', async (req, res) => {
  try {
    const { prisma } = await import('../lib/prisma.js');
    const count = await prisma.product.count({
      where: { isActive: true }
    });
    res.json({ totalProducts: count });
  } catch (error) {
    console.error('Error fetching total product count:', error);
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
    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }
    try {
      const { prisma } = await import('../lib/prisma.js');
      await prisma.user.update({ where: { id: user.id }, data: { phone } });
    } catch (prismaErr: any) {
      if (prismaErr?.code === 'P2031' || prismaErr?.message?.includes?.('replica set')) {
        const { User } = await import('../models/index.js');
        await User.findOneAndUpdate(
          { telegramId: telegramUser.id.toString() },
          { $set: { phone } }
        );
      } else {
        throw prismaErr;
      }
    }
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
    const user = await getOrCreateWebappUser(telegramUser);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }
    try {
      const { prisma } = await import('../lib/prisma.js');
      await prisma.user.update({ where: { id: user.id }, data: { deliveryAddress: address } });
    } catch (prismaErr: any) {
      if (prismaErr?.code === 'P2031' || prismaErr?.message?.includes?.('replica set')) {
        const { User } = await import('../models/index.js');
        await User.findOneAndUpdate(
          { telegramId: telegramUser.id.toString() },
          { $set: { deliveryAddress: address } }
        );
      } else {
        throw prismaErr;
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving address:', error);
    res.status(500).json({ error: 'Internal server error' });
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

export { router as webappRouter };