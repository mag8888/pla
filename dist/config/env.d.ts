import 'dotenv/config';
export declare const env: {
    botToken: string;
    botWebhookUrl: string | undefined;
    botWebhookSecret: string | undefined;
    adminChatId: string | undefined;
    databaseUrl: string;
    adminEmail: string;
    adminPassword: string;
    publicBaseUrl: string;
    webappUrl: string;
    videoUrl: string;
};
export declare function getAdminChatIds(): string[];
export declare function sendToAllAdmins(bot: any, message: string): Promise<void>;
