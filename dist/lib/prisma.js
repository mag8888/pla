import { PrismaClient } from '@prisma/client';
// Railway provides MONGO_URL for MongoDB plugin, but we also support DATABASE_URL
const dbUrl = process.env.DATABASE_URL || process.env.MONGO_URL;
if (dbUrl) {
    console.log('Database URL configured:', dbUrl.substring(0, 30) + '...');
}
else {
    console.error('DATABASE_URL or MONGO_URL not found in environment variables');
}
// Fix MongoDB connection string for Railway and Atlas compatibility
let fixedDbUrl = undefined;
if (dbUrl) {
    let url = dbUrl
        .replace('retrywrites=true', 'retryWrites=true'); // Fix case sensitivity
    // Проверяем, есть ли имя базы данных в строке подключения
    // Формат должен быть: mongodb://host:port/database или mongodb://user:pass@host:port/database
    // Если слэша нет после порта, добавляем имя базы данных
    if (url.startsWith('mongodb://') && !url.includes('mongodb+srv://')) {
        // Для обычного mongodb:// (не mongodb+srv://)
        const urlMatch = url.match(/^mongodb:\/\/([^/]+)(\/.*)?(\?.*)?$/);
        if (urlMatch) {
            const hostPart = urlMatch[1]; // user:pass@host:port или host:port
            const dbPart = urlMatch[2]; // /database или undefined
            const queryPart = urlMatch[3] || ''; // ?options или ''
            // Если нет имени базы данных, добавляем по умолчанию
            if (!dbPart || dbPart === '/') {
                const defaultDb = process.env.MONGODB_DB_NAME || 'plazma_bot';
                url = `mongodb://${hostPart}/${defaultDb}${queryPart}`;
                console.log(`Added default database name: ${defaultDb}`);
            }
        }
    }
    fixedDbUrl = url;
}
export const prisma = new PrismaClient({
    datasources: fixedDbUrl ? {
        db: {
            url: fixedDbUrl
        }
    } : undefined,
    log: ['query', 'info', 'warn', 'error'],
});
