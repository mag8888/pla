import { prisma } from './prisma.js';
import { initializeBotContent } from '../services/bot-content-service.js';
function isDatabaseError(error) {
    if (!error)
        return false;
    const errorCode = error.code;
    const errorMessage = error.message || error.meta?.message || '';
    return (errorCode === 'P2010' || // Raw query failed
        errorCode === 'P1001' || // Can't reach database server
        errorCode === 'P1002' || // Connection timeout
        errorMessage.includes('Server selection timeout') ||
        errorMessage.includes('No available servers') ||
        errorMessage.includes('I/O error: timed out') ||
        errorMessage.includes('Connection pool timeout') ||
        errorMessage.includes('Transactions are not supported'));
}
export async function ensureInitialData() {
    try {
        const reviewCount = await prisma.review.count();
        if (reviewCount === 0) {
            await prisma.review.create({
                data: {
                    name: 'Дмитрий',
                    content: 'Будущее наступило ребята\nЭто действительно биохакинг нового поколения. Мне было трудно поверить в такую эффективность. Я забыл что такое усталость!',
                    isActive: true,
                    isPinned: true,
                },
            });
        }
        // Инициализируем контент бота
        await initializeBotContent();
    }
    catch (error) {
        if (isDatabaseError(error)) {
            console.warn('⚠️  Database unavailable during initialization (non-critical):', error.message?.substring(0, 100));
            console.warn('💡 Initial data will be created when database becomes available');
        }
        else {
            console.warn('⚠️  Failed to initialize data (non-critical):', error.message?.substring(0, 100));
        }
        // Continue without initial data if DB connection fails
    }
}
