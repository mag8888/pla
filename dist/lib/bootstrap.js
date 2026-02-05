import { Review } from '../models/index.js';
import { initializeBotContent } from '../services/bot-content-service.js';
function isDatabaseError(error) {
    if (!error)
        return false;
    const errorMessage = error.message || '';
    const errorName = error.name || '';
    return (errorName === 'MongoServerError' ||
        errorName === 'MongoNetworkError' ||
        errorName === 'MongooseError' ||
        errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('SCRAM failure') ||
        errorMessage.includes('Server selection timeout') ||
        errorMessage.includes('No available servers'));
}
export async function ensureInitialData() {
    try {
        const reviewCount = await Review.countDocuments();
        if (reviewCount === 0) {
            await Review.create({
                name: 'Дмитрий',
                content: 'Будущее наступило ребята\nЭто действительно биохакинг нового поколения. Мне было трудно поверить в такую эффективность. Я забыл что такое усталость!',
                isActive: true,
                isPinned: true,
            });
        }
        // Инициализируем контент бота (Mongoose; при ошибке replica set и т.п. не падаем)
        try {
            await initializeBotContent();
        }
        catch (botContentError) {
            const msg = botContentError?.message || '';
            if (msg.includes('replica set') || botContentError?.code === 'P2031') {
                console.warn('⚠️  Bot content init skipped (MongoDB replica set required for Prisma; using Mongoose only).');
            }
            else {
                console.warn('⚠️  Bot content init failed (non-critical):', msg.substring(0, 120));
            }
        }
    }
    catch (error) {
        if (isDatabaseError(error)) {
            const errorMsg = error.message || error.toString() || '';
            console.warn('⚠️  Database unavailable during initialization (non-critical):', errorMsg.substring(0, 100));
            console.warn('💡 Initial data will be created when database becomes available');
        }
        else {
            console.warn('⚠️  Failed to initialize data (non-critical):', error.message?.substring(0, 100));
        }
        // Continue without initial data if DB connection fails
    }
}
