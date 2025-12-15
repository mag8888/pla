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
    try {
        // Используем URL парсер для правильной обработки строки подключения
        let url = dbUrl.trim();
        // Исправляем регистр для retryWrites
        url = url.replace('retrywrites=true', 'retryWrites=true');
        // Для mongodb:// (не mongodb+srv://) проверяем и исправляем формат
        if (url.startsWith('mongodb://') && !url.includes('mongodb+srv://')) {
            try {
                // Парсим URL для проверки формата
                const urlObj = new URL(url);
                // Если нет pathname (имени базы данных), добавляем по умолчанию
                if (!urlObj.pathname || urlObj.pathname === '/') {
                    const defaultDb = process.env.MONGODB_DB_NAME || 'plazma_bot';
                    urlObj.pathname = `/${defaultDb}`;
                    url = urlObj.toString();
                    console.log(`Added default database name: ${defaultDb}`);
                }
                // Для Railway MongoDB: если есть пользователь и пароль, но они вызывают ошибки аутентификации,
                // можно попробовать подключиться без аутентификации (если Railway MongoDB это поддерживает)
                // Но сначала пробуем с исходными учетными данными
            }
            catch (urlError) {
                // Если URL парсер не смог распарсить (возможно, из-за специальных символов в пароле),
                // пробуем простую проверку и добавление имени БД
                if (!url.includes('/') || url.match(/^mongodb:\/\/[^/]+$/)) {
                    const defaultDb = process.env.MONGODB_DB_NAME || 'plazma_bot';
                    // Добавляем имя БД перед query параметрами или в конец
                    if (url.includes('?')) {
                        url = url.replace('?', `/${defaultDb}?`);
                    }
                    else {
                        url = `${url}/${defaultDb}`;
                    }
                    console.log(`Added default database name (fallback): ${defaultDb}`);
                }
            }
        }
        fixedDbUrl = url;
    }
    catch (error) {
        console.error('Error processing database URL:', error);
        // Используем исходную строку, если обработка не удалась
        fixedDbUrl = dbUrl;
    }
}
export const prisma = new PrismaClient({
    datasources: fixedDbUrl ? {
        db: {
            url: fixedDbUrl
        }
    } : undefined,
    log: ['query', 'info', 'warn', 'error'],
});
