import { Context } from '../bot/context.js';
export declare function ensureUser(ctx: Context): Promise<{
    id: string;
    telegramId: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    languageCode: string | null;
    phone: string | null;
    selectedRegion: import(".prisma/client").$Enums.Region | null;
    deliveryAddress: string | null;
    balance: number;
    uiMode: import(".prisma/client").$Enums.UiMode | null;
    createdAt: Date;
    updatedAt: Date;
} | {
    createdAt: Date;
    updatedAt: Date;
    telegramId: string;
    firstName: string;
    lastName: string | null;
    username: string | null;
    languageCode: string | null;
    id: string;
} | null>;
/**
 * Проверяет наличие username и phone у пользователя
 * Если username отсутствует и phone тоже отсутствует - запрашивает номер телефона
 * @returns true если пользователь может продолжить, false если нужно запросить телефон
 */
export declare function checkUserContact(ctx: Context): Promise<boolean>;
/**
 * Обрабатывает полученный номер телефона от пользователя
 */
export declare function handlePhoneNumber(ctx: Context): Promise<void>;
export declare function logUserAction(ctx: Context, action: string, payload?: any): Promise<void>;
