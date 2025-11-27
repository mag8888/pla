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
import lavaWebhook from './webhooks/lava.js';
import { setBotInstance } from './lib/bot-instance.js';

async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('Database connected');
    
    await ensureInitialData();
    console.log('Initial data ensured');

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
    app.use(session({
      secret: process.env.SESSION_SECRET || 'plazma-bot-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
    }));

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
    
    // Lava webhook routes
    app.use('/webhook', lavaWebhook);

    const port = Number(process.env.PORT ?? 3000);
    // Listen on 0.0.0.0 to accept connections from Railway
    app.listen(port, '0.0.0.0', () => {
      console.log(`Server is running on port ${port}`);
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
    } catch (error) {
      console.error('Failed to register bot commands:', error);
    }

    console.log('Starting bot in long polling mode...');
    
    // Clear any existing webhook first
    try {
      await bot.telegram.deleteWebhook();
      console.log('Cleared existing webhook');
    } catch (error) {
      console.log('No webhook to clear or error clearing:', error instanceof Error ? error.message : String(error));
    }
    
    // Try to launch bot with error handling
    try {
      await bot.launch();
      console.log('Bot launched successfully');
    } catch (error) {
      console.error('Bot launch failed, but web server is running:', error);
    }

    process.once('SIGINT', () => {
      void bot.stop('SIGINT');
    });

    process.once('SIGTERM', () => {
      void bot.stop('SIGTERM');
    });

  } catch (error) {
    console.error('Bootstrap error:', error);
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error('Fatal error during bootstrap', error);
  process.exit(1);
});
