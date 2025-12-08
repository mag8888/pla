interface CreateInvoiceRequest {
    email: string;
    offerId?: string;
    sum?: number;
    orderId: string;
    periodicity?: string;
    currency: string;
    paymentMethod?: string;
    buyerLanguage?: string;
    hookUrl?: string;
    successUrl?: string;
    failUrl?: string;
    customFields?: Record<string, string>;
    comment?: string;
}
interface CreateInvoiceResponse {
    data: {
        id: string;
        url: string;
        shortUrl: string;
        sum: number;
        orderId: string;
        status: string;
    };
    status: string;
}
declare class LavaService {
    private config;
    constructor();
    /**
     * Создание инвойса
     * Использует правильный endpoint согласно документации: POST /api/v2/invoice
     * Документация: https://gate.lava.top/docs
     */
    createInvoice(request: CreateInvoiceRequest): Promise<CreateInvoiceResponse>;
    /**
     * Получение статуса инвойса
     * Использует GET /api/v1/invoices для получения списка инвойсов
     */
    getInvoiceStatus(invoiceId: string): Promise<any>;
    /**
     * Проверка webhook подписи
     */
    verifyWebhookSignature(payload: string, signature: string): boolean;
}
export declare const lavaService: LavaService;
export {};
