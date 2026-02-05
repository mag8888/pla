// Ensure production mode for AdminJS
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

import express from 'express';
import session from 'express-session';
import { session as telegrafSession, Telegraf } from 'telegraf';
import { env } from './config/env.js';
import { Context, SessionData } from './bot/context.js';
import { applyBotModules } from './bot/setup-modules.js';
import { prisma } from './lib/prisma.js';
import { ensureInitialData } from './lib/bootstrap.js';
import { adminWebRouter } from './admin/web.js';
import { webappRouter } from './webapp/webapp.js';
import { webappV2Router } from './webapp/webapp-v2.js';
import lavaWebhook from './webhooks/lava.js';
import { externalApiRouter } from './api/external.js';
// YooKassa intentionally not used (delivery flow работает без онлайн-оплаты)
import { setBotInstance } from './lib/bot-instance.js';

async function bootstrap() {
  try {
    // Try to connect to database with timeout
    let dbConnected = false;
    try {
      await Promise.race([
        prisma.$connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database connection timeout')), 15000)
        )
      ]);
      dbConnected = true;
      console.log('✅ Database connected successfully');
    } catch (dbError: any) {
      console.warn('⚠️  Database connection failed:', dbError?.message || 'Unknown error');
      
      // Check for specific error types
      if (dbError?.message?.includes('Server selection timeout')) {
        console.error('❌ MongoDB connection issue:');
        console.error('   1. Check DATABASE_URL in Railway variables (Railway MongoDB or external)');
        console.error('   2. Ensure host is reachable and port is correct');
      } else if (dbError?.message?.includes('Authentication failed')) {
        console.error('❌ MongoDB authentication failed:');
        console.error('   1. Check username and password in DATABASE_URL');
        console.error('   2. For Railway MongoDB add ?authSource=admin to the URL');
      } else if (dbError?.message?.includes('fatal alert')) {
        console.error('❌ SSL/TLS connection error: check DATABASE_URL and network');
      }
      
      console.warn('⚠️  Server will start, but database operations may fail');
      console.warn('⚠️  Connection will be retried on first database query');
    }
    
    // Run initial data setup in background (non-blocking)
    if (dbConnected) {
      ensureInitialData().catch((err: any) => {
        console.warn('⚠️  Failed to initialize data:', err?.message || err);
      });
    } else {
      console.warn('⚠️  Skipping initial data setup - database not connected');
    }

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    // CORS for webapp
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Telegram-Init-Data');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Configure session middleware
    // Suppress MemoryStore warning in production
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args[0]?.includes?.('MemoryStore') || args[0]?.includes?.('production environment')) {
        return; // Suppress MemoryStore warning
      }
      originalWarn.apply(console, args);
    };
    
    app.use(session({
      secret: process.env.SESSION_SECRET || 'plazma-bot-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
    }));
    console.warn = originalWarn;

    // Health check endpoints (must be before other routes for Railway)
    app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    app.get('/api/health', (_req, res) => {
      res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0-original',
        bot: 'active'
      });
    });

    // Root - health check for Railway (returns 200, not redirect)
    app.get('/', (req, res) => {
      // Railway healthcheck expects 200 OK, not redirect
      if (req.headers['user-agent']?.includes('Railway') || req.query.healthcheck) {
        res.status(200).json({ status: 'ok', service: 'plazma-bot' });
      } else {
        res.redirect('/webapp');
      }
    });

    // Web admin panel
    app.use('/admin', adminWebRouter);
    
    // Webapp routes
    app.use('/webapp', webappRouter);
    app.use('/webapp-v2', webappV2Router);
    app.use('/api/external', externalApiRouter);
    
    // Log route registration
    console.log('✅ Routes registered:');
    console.log('   - GET / → redirects to /webapp');
    console.log('   - GET /health → health check');
    console.log('   - GET /api/health → API health check');
    console.log('   - /admin → admin panel');
    console.log('   - /webapp → web application');
    
    // Lava webhook routes (only if Lava is enabled)
    const { lavaService } = await import('./services/lava-service.js');
    if (lavaService.isEnabled()) {
      app.use('/webhook', lavaWebhook);
      console.log('✅ Lava webhook routes enabled');
    } else {
      console.log('ℹ️  Lava webhook routes disabled (Lava service not configured)');
    }

    // 404 handler for unknown routes
    app.use((req, res) => {
      console.log(`⚠️  404: ${req.method} ${req.path}`);
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'Not found', path: req.path });
      } else {
        // For non-API routes, redirect to webapp
        res.redirect('/webapp');
      }
    });

    const port = Number(process.env.PORT ?? 3000);
    // Listen on 0.0.0.0 to accept connections from Railway
    app.listen(port, '0.0.0.0', () => {
      console.log(`🌐 Server is running on port ${port}`);
      console.log(`🔗 Webapp URL: ${env.webappUrl || `http://localhost:${port}/webapp`}`);
    });

    // Initialize bot separately
    const bot = new Telegraf<Context>(env.botToken, {
      handlerTimeout: 30_000,
    });

    bot.use(
      telegrafSession<SessionData, Context>({
        defaultSession: (): SessionData => ({ uiMode: 'classic' }),
      })
    );
    await applyBotModules(bot);
    
    // Register cart actions
    const { registerCartActions } = await import('./modules/cart/index.js');
    registerCartActions(bot);

    // Set global bot instance for admin panel
    setBotInstance(bot);

    // Register bot commands
    try {
      await bot.telegram.setMyCommands([
        { command: 'start', description: 'Запустить бота и открыть главное меню' },
        { command: 'help', description: 'Показать справку по использованию бота' },
        { command: 'shop', description: 'Открыть магазин товаров' },
        { command: 'partner', description: 'Партнерская программа' },
        { command: 'audio', description: 'Звуковые матрицы' },
        { command: 'reviews', description: 'Отзывы клиентов' },
        { command: 'about', description: 'О PLASMA Water' },
        { command: 'add_balance', description: 'Пополнить баланс через Lava' },
        { command: 'support', description: 'Поддержка 24/7' },
        { command: 'app', description: 'Открыть веб-приложение' }
      ]);
      console.log('Bot commands registered successfully');
    } catch (error: any) {
      // Telegram API timeout is common on Railway - continue anyway
      if (error.code === 'ETIMEDOUT' || error.errno === 'ETIMEDOUT') {
        console.warn('⚠️  Telegram API timeout when registering commands - continuing anyway');
      } else {
        console.error('Failed to register bot commands:', error.message || error);
      }
    }

    // Set single blue menu button to open WebApp
    try {
      const baseUrl = env.webappUrl || env.publicBaseUrl || 'https://vital-production-82b0.up.railway.app';
      const webappUrl = baseUrl.includes('/webapp') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/webapp`;
      await bot.telegram.setChatMenuButton({
        menuButton: {
          type: 'web_app',
          text: 'Каталог',
          web_app: { url: webappUrl }
        }
      });
      console.log('Bot menu button set to WebApp');
    } catch (error: any) {
      if (error.code === 'ETIMEDOUT' || error.errno === 'ETIMEDOUT') {
        console.warn('⚠️  Telegram API timeout when setting menu button');
      } else {
        console.warn('Failed to set menu button:', error?.message || error);
      }
    }

    console.log('Starting bot in long polling mode...');
    
    // Clear any existing webhook first
    try {
      await bot.telegram.deleteWebhook();
      console.log('Cleared existing webhook');
    } catch (error: any) {
      // Telegram API timeout is common on Railway - continue anyway
      if (error.code === 'ETIMEDOUT' || error.errno === 'ETIMEDOUT') {
        console.warn('⚠️  Telegram API timeout when clearing webhook - continuing anyway');
      } else {
        console.log('No webhook to clear or error clearing:', error instanceof Error ? error.message : String(error));
      }
    }
    
    // Try to launch bot with error handling - don't crash server if bot fails
    try {
      await bot.launch();
      console.log('✅ Bot launched successfully');
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const errorCode = error?.response?.error_code || error?.code;
      
      if (errorCode === 409 || errorMessage.includes('409') || errorMessage.includes('Conflict')) {
        console.warn('⚠️  Bot conflict detected (409). Another bot instance may be running.');
        console.warn('⚠️  Web server will continue running without bot.');
        console.warn('ℹ️  To fix: Stop other bot instances or wait for webhook to clear.');
      } else if (error.code === 'ETIMEDOUT' || error.errno === 'ETIMEDOUT') {
        console.warn('⚠️  Telegram API timeout when launching bot - web server continues');
      } else {
        console.error('❌ Bot launch failed, but web server is running:', errorMessage);
      }
      // Don't exit - web server should continue working
      console.log('✅ Web server continues to run despite bot error');
    }

    // Graceful shutdown handlers
    process.once('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      try {
        bot.stop('SIGINT');
      } catch (error) {
        console.warn('⚠️  Error stopping bot:', error);
      }
      process.exit(0);
    });

    process.once('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      try {
        bot.stop('SIGTERM');
      } catch (error) {
        console.warn('⚠️  Error stopping bot:', error);
      }
      process.exit(0);
    });

    // Handle unhandled errors - don't crash server
    process.on('unhandledRejection', (reason, promise) => {
      console.error('⚠️  Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't exit - log and continue (server should keep running)
    });

    process.on('uncaughtException', (error) => {
      console.error('⚠️  Uncaught Exception:', error);
      // Only exit on critical errors, not on bot errors
      if (error.message?.includes('Database') || error.message?.includes('Prisma')) {
        console.error('❌ Critical database error - exiting');
        process.exit(1);
      }
      // Don't exit for other errors - log and continue
    });

  } catch (error: any) {
    console.error('❌ Bootstrap error:', error?.message || error);
    // Only exit if it's a critical database connection error before server starts
    if (error instanceof Error && (error.message.includes('Database') || error.message.includes('connect'))) {
      console.error('❌ Critical database error during bootstrap - exiting');
      process.exit(1);
    }
    // For other errors (like bot conflicts), server might still be partially functional
    console.warn('⚠️  Server may be partially functional despite bootstrap errors');
    console.warn('⚠️  Web server and admin panel should still work');
  }
}

bootstrap().catch((error) => {
  console.error('Fatal error during bootstrap', error);
  process.exit(1);
});
