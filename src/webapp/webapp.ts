import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Context } from '../bot/context.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ensureUser } from '../services/user-history.js';
import { getActiveCategories, getCategoryById, getProductById, getProductsByCategory } from '../services/shop-service.js';
import { addProductToCart, getCartItems, cartItemsToText } from '../services/cart-service.js';
import { createOrderRequest } from '../services/order-service.js';
import { getActiveReviews } from '../services/review-service.js';
import { getOrCreatePartnerProfile, getPartnerDashboard } from '../services/partner-service.js';
import { PartnerProgramType } from '@prisma/client';
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
    const initData = req.headers['x-telegram-init-data'] as string;
    if (initData) {
      // Parse Telegram WebApp init data
      const urlParams = new URLSearchParams(initData);
      const userStr = urlParams.get('user');
      if (userStr) {
        (req as any).telegramUser = JSON.parse(decodeURIComponent(userStr));
      }
    }
    next();
  } catch (error) {
    console.error('Error extracting Telegram user:', error);
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
      user = await prisma.user.create({
        data: {
          telegramId: telegramUser.id.toString(),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        }
      });
    }

    res.json({
      id: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      balance: (user as any).balance || 0,
      selectedRegion: (user as any).selectedRegion || 'RUSSIA'
    });
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
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { prisma } = await import('../lib/prisma.js');
    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const cartItems = await getCartItems(user.id);
    res.json(cartItems);
  } catch (error) {
    console.error('Error getting cart items:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    const user = await prisma.user.findUnique({
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
      totalPartners: user.partner.totalPartners,
      directPartners: user.partner.directPartners
    });
  } catch (error) {
    console.error('Error getting partner dashboard:', error);
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

// Cart add endpoint
router.post('/api/cart/add', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { productId, quantity = 1 } = req.body;
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    const { prisma } = await import('../lib/prisma.js');
    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if item already exists in cart
    const existingItem = await prisma.cartItem.findFirst({
      where: { userId: user.id, productId }
    });

    if (existingItem) {
      // Update quantity
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity }
      });
    } else {
      // Add new item
      await prisma.cartItem.create({
        data: {
          userId: user.id,
          productId,
          quantity
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Order create endpoint
router.post('/api/orders/create', async (req, res) => {
  try {
    const telegramUser = getTelegramUser(req);
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { items, message = '' } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items are required' });
    }

    const { prisma } = await import('../lib/prisma.js');
    const user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create order
    const order = await prisma.orderRequest.create({
      data: {
        userId: user.id,
        message,
        itemsJson: items,
        status: 'NEW',
        contact: `@${telegramUser.username || 'user'}` || `ID: ${telegramUser.id}`
      }
    });

    res.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Error creating order:', error);
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

// Health check
router.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export { router as webappRouter };