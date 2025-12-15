import { PrismaClient } from '@prisma/client';

// Railway provides MONGO_URL for MongoDB plugin, but we also support DATABASE_URL
const dbUrl = process.env.DATABASE_URL || process.env.MONGO_URL;
if (dbUrl) {
  console.log('Database URL configured:', dbUrl.substring(0, 30) + '...');
} else {
  console.error('DATABASE_URL or MONGO_URL not found in environment variables');
}

// Fix MongoDB connection string for Railway and Atlas compatibility
let fixedDbUrl: string | undefined = undefined;
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
        // Если пароль содержит специальные символы, они должны быть URL-кодированы
        const urlObj = new URL(url);
        
        // Если есть username и password, убеждаемся, что они правильно закодированы
        if (urlObj.username && urlObj.password) {
          // Декодируем и перекодируем для правильного экранирования
          const username = decodeURIComponent(urlObj.username);
          const password = decodeURIComponent(urlObj.password);
          
          // Перекодируем специальные символы
          const encodedUsername = encodeURIComponent(username);
          const encodedPassword = encodeURIComponent(password);
          
          // Если были изменения, пересобираем URL
          if (username !== encodedUsername || password !== encodedPassword) {
            urlObj.username = encodedUsername;
            urlObj.password = encodedPassword;
            url = urlObj.toString();
            console.log('URL-encoded username/password in connection string');
          }
        }
        
        // Если нет pathname (имени базы данных), добавляем по умолчанию
        if (!urlObj.pathname || urlObj.pathname === '/') {
          const defaultDb = process.env.MONGODB_DB_NAME || 'plazma_bot';
          urlObj.pathname = `/${defaultDb}`;
          url = urlObj.toString();
          console.log(`Added default database name: ${defaultDb}`);
        }
        
      } catch (urlError) {
        // Если URL парсер не смог распарсить (возможно, из-за специальных символов в пароле),
        // пробуем простую проверку и добавление имени БД
        if (!url.includes('/') || url.match(/^mongodb:\/\/[^/]+$/)) {
          const defaultDb = process.env.MONGODB_DB_NAME || 'plazma_bot';
          // Добавляем имя БД перед query параметрами или в конец
          if (url.includes('?')) {
            url = url.replace('?', `/${defaultDb}?`);
          } else {
            url = `${url}/${defaultDb}`;
          }
          console.log(`Added default database name (fallback): ${defaultDb}`);
        }
      }
    }
    
    fixedDbUrl = url;
  } catch (error) {
    console.error('Error processing database URL:', error);
    // Используем исходную строку, если обработка не удалась
    fixedDbUrl = dbUrl;
  }
}

// Кастомный логгер для фильтрации ошибок аутентификации
const customLogger = {
  log: (level: string, message: string) => {
    // Фильтруем ошибки аутентификации из логов
    if (level === 'error' || level === 'warn') {
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('authentication failed') ||
          lowerMessage.includes('scram failure') ||
          lowerMessage.includes('authenticationfailed')) {
        // Не логируем ошибки аутентификации, так как они уже обрабатываются
        return;
      }
    }
    // Логируем остальные сообщения
    if (level === 'query') {
      // Логируем только важные запросы, не все
      return;
    }
    console.log(`[Prisma ${level}]`, message);
  },
  error: (message: string) => {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('authentication failed') ||
        lowerMessage.includes('scram failure') ||
        lowerMessage.includes('authenticationfailed')) {
      // Не логируем ошибки аутентификации
      return;
    }
    console.error('[Prisma error]', message);
  },
  warn: (message: string) => {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('authentication failed') ||
        lowerMessage.includes('scram failure') ||
        lowerMessage.includes('authenticationfailed')) {
      // Не логируем ошибки аутентификации
      return;
    }
    console.warn('[Prisma warn]', message);
  },
  info: (message: string) => {
    console.log('[Prisma info]', message);
  },
  debug: (message: string) => {
    // Не логируем debug сообщения
  },
};

export const prisma = new PrismaClient({
  datasources: fixedDbUrl ? {
    db: {
      url: fixedDbUrl
    }
  } : undefined,
  log: [
    { level: 'info', emit: 'event' },
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

// Обработка событий логирования Prisma
prisma.$on('info' as any, (e: any) => {
  customLogger.info(e.message);
});

prisma.$on('warn' as any, (e: any) => {
  customLogger.warn(e.message);
});

prisma.$on('error' as any, (e: any) => {
  customLogger.error(e.message);
});
