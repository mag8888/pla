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
    fixedDbUrl = dbUrl
        .replace('retrywrites=true', 'retryWrites=true') // Fix case sensitivity
        .replace(/^mongodb:\/\/([^:]+):([^@]+)@/, 'mongodb://$1:$2@'); // Ensure proper format
}
export const prisma = new PrismaClient({
    datasources: fixedDbUrl ? {
        db: {
            url: fixedDbUrl
        }
    } : undefined,
    log: ['query', 'info', 'warn', 'error'],
});
