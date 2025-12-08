import crypto from 'crypto';
import axios from 'axios';
class LavaService {
    config;
    constructor() {
        this.config = {
            apiKey: process.env.LAVA_SECRET_KEY || process.env.LAVA_API_KEY || '',
            baseUrl: process.env.LAVA_BASE_URL || 'https://gate.lava.top'
        };
        // Проверка наличия обязательных переменных
        const missingVars = [];
        if (!this.config.apiKey)
            missingVars.push('LAVA_SECRET_KEY или LAVA_API_KEY');
        if (missingVars.length > 0) {
            console.error('❌ Lava Service: Missing required environment variables:', missingVars);
        }
        console.log('🔥 Lava Service Config:', {
            apiKeyLength: this.config.apiKey.length,
            baseUrl: this.config.baseUrl,
            hasApiKey: !!this.config.apiKey,
            webhookSecret: process.env.LAVA_WEBHOOK_SECRET ? 'SET' : 'MISSING',
            publicBaseUrl: process.env.PUBLIC_BASE_URL || 'NOT SET'
        });
    }
    /**
     * Создание инвойса
     * Использует правильный endpoint согласно документации: POST /api/v2/invoice
     * Документация: https://gate.lava.top/docs
     */
    async createInvoice(request) {
        // Убираем trailing slash из baseUrl
        let baseUrl = this.config.baseUrl.replace(/\/$/, '');
        // Правильный endpoint согласно документации Lava: /api/v2/invoice
        // Проверяем, не содержит ли baseUrl уже /api/v2
        let url;
        if (baseUrl.includes('/api/v2')) {
            // Если baseUrl уже содержит /api/v2, просто добавляем /invoice
            url = `${baseUrl}/invoice`;
        }
        else if (baseUrl.includes('/api')) {
            // Если baseUrl содержит /api, добавляем /v2/invoice
            url = `${baseUrl}/v2/invoice`;
        }
        else {
            // Если baseUrl чистый, добавляем полный путь
            url = `${baseUrl}/api/v2/invoice`;
        }
        // Согласно документации, используется X-Api-Key для авторизации
        const headers = {
            'accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Api-Key': this.config.apiKey
        };
        console.log('🔥 Lava API Request:', {
            url,
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Api-Key': this.config.apiKey.substring(0, 10) + '...'
            },
            body: request
        });
        try {
            const response = await axios.post(url, request, { headers });
            console.log('✅ Lava API Response:', {
                status: response.status,
                data: response.data
            });
            return response.data;
        }
        catch (error) {
            console.error('❌ Lava API Error Details:', {
                url,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                headers: error.response?.headers,
                request: {
                    method: error.config?.method,
                    url: error.config?.url,
                    headers: {
                        ...error.config?.headers,
                        'X-Api-Key': error.config?.headers?.['X-Api-Key']?.substring(0, 10) + '...'
                    }
                }
            });
            throw new Error(`Failed to create invoice: ${error.response?.data || error.message}`);
        }
    }
    /**
     * Получение статуса инвойса
     * Использует GET /api/v1/invoices для получения списка инвойсов
     */
    async getInvoiceStatus(invoiceId) {
        const baseUrl = this.config.baseUrl.replace(/\/$/, '');
        try {
            // Получаем список инвойсов и ищем нужный по orderId
            const response = await axios.get(`${baseUrl}/api/v1/invoices`, {
                params: {
                // Можно фильтровать по различным параметрам
                },
                headers: {
                    'accept': 'application/json',
                    'X-Api-Key': this.config.apiKey
                }
            });
            // Ищем нужный инвойс в списке
            const invoices = response.data?.data || response.data || [];
            const invoice = Array.isArray(invoices)
                ? invoices.find((inv) => inv.id === invoiceId || inv.orderId === invoiceId)
                : null;
            return invoice ? { data: invoice } : response.data;
        }
        catch (error) {
            console.error('❌ Lava API Error (getInvoiceStatus):', {
                status: error.response?.status,
                data: error.response?.data
            });
            throw new Error(`Failed to get invoice status: ${error.response?.data || error.message}`);
        }
    }
    /**
     * Проверка webhook подписи
     */
    verifyWebhookSignature(payload, signature) {
        const webhookSecret = process.env.LAVA_WEBHOOK_SECRET || this.config.apiKey;
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(payload)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
    }
}
export const lavaService = new LavaService();
