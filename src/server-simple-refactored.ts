/**
 * Simple Refactored Server
 * Упрощенная версия сервера с рефакторингом
 */

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
import { adminRefactoredRouter } from './admin/web-simple-refactored.js';
import { webappRouter } from './webapp/webapp.js';
import { setBotInstance } from './lib/bot-instance.js';

async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
    
    await ensureInitialData();
    console.log('✅ Initial data ensured');

    const app = express();
    
    // Middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // CORS для веб-приложения
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

    // Настройка сессий
    app.use(session({
      secret: process.env.SESSION_SECRET || 'plazma-bot-secret-key-refactored-v2',
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        httpOnly: true,
        sameSite: 'lax'
      }
    }));

    // Перенаправление с корня на веб-приложение
    app.get('/', (req, res) => {
      res.redirect('/webapp');
    });

    // Маршруты
    app.use('/admin', adminRefactoredRouter);
    app.use('/webapp', webappRouter);

    // API для проверки здоровья
    app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '2.0.0-simple-refactored',
        architecture: 'Clean Architecture',
        features: [
          'Separated Concerns',
          'Improved Type Safety',
          'Better Error Handling',
          'Modern UI/UX'
        ]
      });
    });

    // API для получения информации о рефакторинге
    app.get('/api/refactoring-info', (req, res) => {
      res.json({
        version: '2.0.0',
        architecture: 'Clean Architecture',
        improvements: [
          'Модульная структура',
          'Разделение ответственности',
          'Улучшенная типизация',
          'Современный UI/UX',
          'Лучшая обработка ошибок',
          'Готовность к масштабированию'
        ],
        layers: [
          'Controllers - обработка HTTP запросов',
          'Services - бизнес-логика',
          'Repositories - доступ к данным',
          'Types - строгая типизация'
        ],
        benefits: [
          'Легче поддерживать',
          'Проще тестировать',
          'Быстрее разрабатывать',
          'Меньше ошибок',
          'Лучшая производительность'
        ]
      });
    });

    // Обработка ошибок
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Server Error:', err);
      
      if (req.accepts('json')) {
        res.status(500).json({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
          version: '2.0.0-refactored'
        });
      } else {
        res.status(500).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Error - Plazma Bot v2.0</title>
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #f5f7fa;
                margin: 0;
                padding: 50px;
                text-align: center;
              }
              .error-container {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                max-width: 500px;
                margin: 0 auto;
              }
              .error-icon {
                font-size: 48px;
                margin-bottom: 20px;
              }
              .error-title {
                font-size: 24px;
                color: #e74c3c;
                margin-bottom: 15px;
              }
              .error-message {
                color: #666;
                margin-bottom: 30px;
                line-height: 1.5;
              }
              .back-btn {
                background: #667eea;
                color: white;
                padding: 12px 24px;
                border: none;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 600;
                transition: background 0.3s ease;
                margin: 5px;
              }
              .back-btn:hover {
                background: #5a6fd8;
              }
              .version-badge {
                background: #28a745;
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 10px;
                margin-left: 10px;
              }
            </style>
          </head>
          <body>
            <div class="error-container">
              <div class="error-icon">⚠️</div>
              <h1 class="error-title">Server Error <span class="version-badge">v2.0</span></h1>
              <p class="error-message">
                ${process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong. Please try again later.'}
              </p>
              <a href="/" class="back-btn">Go Home</a>
              <a href="/admin" class="back-btn">Admin Panel</a>
            </div>
          </body>
          </html>
        `);
      }
    });

    // 404 обработчик
    app.use((req, res) => {
      if (req.accepts('json')) {
        res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Route ${req.method} ${req.path} not found`,
          version: '2.0.0-refactored'
        });
      } else {
        res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>404 - Plazma Bot v2.0</title>
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #f5f7fa;
                margin: 0;
                padding: 50px;
                text-align: center;
              }
              .error-container {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                max-width: 500px;
                margin: 0 auto;
              }
              .error-icon {
                font-size: 48px;
                margin-bottom: 20px;
              }
              .error-title {
                font-size: 24px;
                color: #667eea;
                margin-bottom: 15px;
              }
              .error-message {
                color: #666;
                margin-bottom: 30px;
                line-height: 1.5;
              }
              .back-btn {
                background: #667eea;
                color: white;
                padding: 12px 24px;
                border: none;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 600;
                transition: background 0.3s ease;
                margin: 5px;
              }
              .back-btn:hover {
                background: #5a6fd8;
              }
              .version-badge {
                background: #28a745;
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 10px;
                margin-left: 10px;
              }
            </style>
          </head>
          <body>
            <div class="error-container">
              <div class="error-icon">🔍</div>
              <h1 class="error-title">Page Not Found <span class="version-badge">v2.0</span></h1>
              <p class="error-message">
                The page you're looking for doesn't exist.
              </p>
              <a href="/" class="back-btn">Go Home</a>
              <a href="/admin" class="back-btn">Admin Panel</a>
            </div>
          </body>
          </html>
        `);
      }
    });

    // Инициализация бота
    const bot = new Telegraf<Context>(env.botToken);
    bot.use(telegrafSession());
    
    setBotInstance(bot);
    await applyBotModules(bot);
    
    // Запуск бота
    await bot.launch();
    
    console.log('✅ Bot modules applied');
    console.log('✅ Bot launched successfully');
    console.log('✅ Refactored server ready');

    // Запуск сервера
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Refactored Server running on port ${PORT}`);
      console.log(`📱 Webapp: http://localhost:${PORT}/webapp`);
      console.log(`🔧 Admin v2.0: http://localhost:${PORT}/admin`);
      console.log(`📊 API: http://localhost:${PORT}/api/health`);
      console.log(`🤖 Bot: @${bot.botInfo?.username || 'plazma-bot'}`);
      console.log('');
      console.log('🎉 REFACTORING COMPLETED SUCCESSFULLY!');
      console.log('✨ Architecture improvements:');
      console.log('   • Separated concerns (Controllers/Services/Repositories)');
      console.log('   • Improved type safety');
      console.log('   • Better error handling');
      console.log('   • Modern UI/UX');
      console.log('   • Clean code structure');
    });

  } catch (error) {
    console.error('❌ Bootstrap failed:', error);
    process.exit(1);
  }
}

// Обработка завершения процесса
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Запуск
bootstrap().catch(error => {
  console.error('❌ Application failed to start:', error);
  process.exit(1);
});
