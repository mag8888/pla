export interface BotContentData {
    key: string;
    title: string;
    content: string;
    description?: string | null;
    category?: string | null;
    language?: string;
    isActive?: boolean;
    updatedAt?: Date;
    createdAt?: Date;
}
/**
 * Получить контент бота по ключу
 */
export declare function getBotContent(key: string, language?: string): Promise<string | null>;
/**
 * Получить все контенты бота
 */
export declare function getAllBotContents(): Promise<BotContentData[]>;
/**
 * Создать или обновить контент бота
 */
export declare function upsertBotContent(data: BotContentData): Promise<BotContentData | null>;
/**
 * Удалить контент бота
 */
export declare function deleteBotContent(key: string): Promise<boolean>;
/**
 * Инициализировать базовый контент бота
 */
export declare function initializeBotContent(): Promise<void>;
