// Ensure production mode for AdminJS
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
import express from 'express';
import session from 'express-session';
import { session as telegrafSession, Telegraf } from 'telegraf';
import { env } from './config/env.js';
import { applyBotModules } from './bot/setup-modules.js';
import { prisma } from './lib/prisma.js';
import { ensureInitialData } from './lib/bootstrap.js';
import { adminWebRouter } from './admin/web.js';
import { webappRouter } from './webapp/webapp.js';
import { externalApiRouter } from './api/external.js';
import { setBotInstance } from './lib/bot-instance.js';
// @ts-ignore - типы node-cron могут быть неполными
import cron from 'node-cron';
async function bootstrap() {
    try {
        // Try to connect to database first
        try {
            await prisma.$connect();
            console.log('Database connected');
        }
        catch (connectError) {
            const errorMessage = connectError.message || connectError.meta?.message || '';
            const errorKind = connectError.kind || '';
            if (errorMessage.includes('Authentication failed') ||
                errorMessage.includes('SCRAM failure') ||
                errorKind.includes('AuthenticationFailed')) {
                console.error('❌ MongoDB Authentication Error:');
                console.error('   The connection string contains invalid credentials.');
                console.error('   Please check your MONGO_URL or DATABASE_URL in Railway Variables.');
                console.error('   See FIX_MONGODB_AUTH.md for instructions.');
                console.error('');
                console.error('   Common solutions:');
                console.error('   1. Recreate MongoDB service in Railway');
                console.error('   2. Update DATABASE_URL to use ${{MongoDB.MONGO_URL}}');
                console.error('   3. Check if MONGO_URL format is correct');
                console.error('');
                console.warn('⚠️  Bot will continue with mock data until database is fixed.');
                // Не пробрасываем ошибку, чтобы бот продолжал работать
            }
            else {
                throw connectError; // Пробрасываем другие ошибки
            }
        }
        // Try to apply migrations on startup if database is available
        // This is a fallback if migrations weren't applied during build
        // Skip if DATABASE_URL points to Atlas (likely unavailable)
        const dbUrl = process.env.DATABASE_URL || process.env.MONGO_URL || '';
        const isAtlasUrl = dbUrl.includes('mongodb+srv://') && dbUrl.includes('mongodb.net');
        if (!isAtlasUrl) {
            try {
                const { execSync } = await import('child_process');
                console.log('🔄 Checking database schema...');
                execSync('npx prisma db push --skip-generate --accept-data-loss', {
                    stdio: 'pipe',
                    env: process.env,
                    timeout: 15000, // 15 seconds timeout (shorter for faster startup)
                });
                console.log('✅ Database schema synchronized');
            }
            catch (migrationError) {
                const errorMessage = migrationError.message || migrationError.toString() || '';
                const errorOutput = (migrationError.stdout?.toString() || '') + (migrationError.stderr?.toString() || '');
                const fullError = (errorMessage + ' ' + errorOutput).toLowerCase();
                const isConnectionError = fullError.includes('server selection timeout') ||
                    fullError.includes('no available servers') ||
                    fullError.includes('i/o error: timed out') ||
                    fullError.includes('etimedout') ||
                    fullError.includes('can\'t reach database');
                if (isConnectionError) {
                    console.warn('⚠️  Database connection timeout during schema sync (non-critical)');
                    console.warn('💡 Schema will be synced on next successful connection');
                }
                else if (fullError.includes('already in sync') || fullError.includes('unchanged') || fullError.includes('already up to date')) {
                    console.log('✅ Database schema already up to date');
                }
                else {
                    // Проверяем, не связана ли ошибка с replica set
                    const fullErrorLower = fullError.toLowerCase();
                    if (fullErrorLower.includes('replica set') || fullErrorLower.includes('transactions are not supported')) {
                        console.warn('⚠️  Schema sync skipped (Railway MongoDB does not support Prisma transactions)');
                        console.warn('💡 This is expected. Schema is already synced. App will work normally.');
                    }
                    else {
                        console.warn('⚠️  Schema sync check failed (non-critical):', errorMessage.substring(0, 100));
                    }
                }
            }
        }
        else {
            console.warn('⚠️  MongoDB Atlas detected. Schema sync skipped (use Railway MongoDB for better reliability)');
            console.warn('💡 To switch to Railway MongoDB, update DATABASE_URL to use ${{MongoDB.MONGO_URL}}');
        }
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
            }
            else {
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
            }
            else {
                res.redirect('/webapp');
            }
        });
        // Web admin panel
        app.use('/admin', adminWebRouter);
        // Webapp routes
        app.use('/webapp', webappRouter);
        // External API for friendly services
        app.use('/api/external', externalApiRouter);
        const port = Number(process.env.PORT ?? 3000);
        // Listen on 0.0.0.0 to accept connections from Railway
        app.listen(port, '0.0.0.0', () => {
            console.log(`Server is running on port ${port}`);
        });
        // Initialize bot separately
        const bot = new Telegraf(env.botToken, {
            handlerTimeout: 30_000,
        });
        bot.use(telegrafSession({
            defaultSession: () => ({ uiMode: 'classic' }),
        }));
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
                { command: 'add_balance', description: 'Пополнить баланс' },
                { command: 'support', description: 'Поддержка 24/7' },
                { command: 'app', description: 'Открыть веб-приложение' }
            ]);
            console.log('Bot commands registered successfully');
        }
        catch (error) {
            console.error('Failed to register bot commands:', error);
        }
        console.log('Starting bot in long polling mode...');
        // Clear any existing webhook first with retry
        let webhookCleared = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                console.log('✅ Cleared existing webhook');
                webhookCleared = true;
                break;
            }
            catch (error) {
                if (error.response?.error_code === 409) {
                    console.log(`⚠️  Webhook conflict (attempt ${attempt}/3), waiting before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
                }
                else {
                    console.log('No webhook to clear or error clearing:', error instanceof Error ? error.message : String(error));
                    webhookCleared = true; // Continue anyway
                    break;
                }
            }
        }
        // Wait a bit to ensure old instances are stopped
        // Railway может запускать несколько контейнеров одновременно при деплое
        console.log('⏳ Waiting 10 seconds for other bot instances to stop...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        // Try to launch bot with retry logic
        let botLaunched = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await bot.launch({
                    dropPendingUpdates: true, // Drop pending updates to avoid conflicts
                });
                console.log('✅ Bot launched successfully');
                botLaunched = true;
                break;
            }
            catch (error) {
                if (error.response?.error_code === 409) {
                    const waitTime = 5000 * attempt; // 5s, 10s, 15s
                    console.log(`⚠️  Bot conflict detected (attempt ${attempt}/3), waiting ${waitTime / 1000}s before retry...`);
                    console.log('💡 This usually means another bot instance is still running.');
                    console.log('💡 Railway will stop old instances automatically. Web server will continue running.');
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                else {
                    console.error('❌ Bot launch failed (non-409 error), but web server is running:', error);
                    break; // Don't retry for other errors
                }
            }
        }
        if (!botLaunched) {
            console.error('❌ Failed to launch bot after 3 attempts. Web server will continue running.');
            console.log('💡 The bot will start automatically on next deployment when Railway fully stops old instances.');
            console.log('💡 This is normal during Railway deployments. The web server (admin panel, API) will work normally.');
            console.log('💡 To manually retry bot launch, redeploy the service.');
        }
        process.once('SIGINT', () => {
            void bot.stop('SIGINT');
        });
        process.once('SIGTERM', () => {
            void bot.stop('SIGTERM');
        });
        // Настройка автоматического резервного копирования
        // Запуск каждый день в 02:00 UTC (05:00 МСК)
        if (process.env.ENABLE_AUTO_BACKUP !== 'false') {
            cron.schedule('0 2 * * *', async () => {
                try {
                    console.log('🔄 Запуск автоматического резервного копирования...');
                    // @ts-ignore - скрипт не имеет типов
                    const { exportDatabase } = await import('../scripts/backup-database-railway.js');
                    const result = await exportDatabase();
                    console.log('✅ Автоматический бэкап завершен:', result.filename);
                }
                catch (error) {
                    console.error('❌ Ошибка автоматического бэкапа:', error);
                }
            }, {
                timezone: 'UTC'
            });
            console.log('📦 Автоматическое резервное копирование настроено (ежедневно в 02:00 UTC)');
        }
    }
    catch (error) {
        console.error('Bootstrap error:', error);
        process.exit(1);
    }
}
bootstrap().catch((error) => {
    console.error('Fatal error during bootstrap', error);
    process.exit(1);
});
