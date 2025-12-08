/**
 * External API Router
 * API для дружественных сервисов
 *
 * Аутентификация: X-API-Key header
 *
 * Эндпоинты:
 * - GET /api/external/catalog - Полный каталог (категории + товары)
 * - GET /api/external/categories - Список категорий
 * - GET /api/external/products - Список товаров (с фильтрацией)
 * - GET /api/external/products/:id - Конкретный товар
 * - POST /api/external/orders - Создать заказ
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { createOrderRequest } from '../services/order-service.js';
import { getActiveCategories, getProductById } from '../services/shop-service.js';
const router = Router();
// Middleware для проверки API ключа
function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.EXTERNAL_API_KEY;
    if (!validApiKey) {
        console.warn('⚠️ EXTERNAL_API_KEY не установлен в переменных окружения');
        return res.status(500).json({
            success: false,
            error: 'API не настроен на сервере'
        });
    }
    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({
            success: false,
            error: 'Неверный или отсутствующий API ключ'
        });
    }
    next();
}
// Применяем аутентификацию ко всем маршрутам
router.use(authenticateApiKey);
/**
 * GET /api/external/catalog
 * Получить полный каталог (категории с товарами)
 */
router.get('/catalog', async (req, res) => {
    try {
        const region = req.query.region?.toUpperCase() || 'RUSSIA';
        const isBali = region === 'BALI';
        // Получаем активные категории
        const categories = await getActiveCategories();
        // Для каждой категории получаем товары
        const catalog = await Promise.all(categories.map(async (category) => {
            const products = await prisma.product.findMany({
                where: {
                    categoryId: category.id,
                    isActive: true,
                    ...(isBali ? { availableInBali: true } : { availableInRussia: true })
                },
                orderBy: { title: 'asc' },
                select: {
                    id: true,
                    title: true,
                    summary: true,
                    description: true,
                    imageUrl: true,
                    price: true,
                    stock: true,
                    availableInRussia: true,
                    availableInBali: true,
                    createdAt: true,
                    updatedAt: true
                }
            });
            return {
                id: category.id,
                name: category.name,
                slug: category.slug,
                description: category.description,
                isActive: category.isActive,
                products: products.map(p => ({
                    id: p.id,
                    title: p.title,
                    summary: p.summary,
                    description: p.description,
                    imageUrl: p.imageUrl,
                    price: p.price,
                    priceRub: p.price * 100, // Конвертация PZ в RUB
                    stock: p.stock,
                    availableInRussia: p.availableInRussia,
                    availableInBali: p.availableInBali,
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt
                })),
                createdAt: category.createdAt,
                updatedAt: category.updatedAt
            };
        }));
        const response = {
            success: true,
            data: catalog
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching catalog:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении каталога'
        });
    }
});
/**
 * GET /api/external/categories
 * Получить список категорий
 */
router.get('/categories', async (req, res) => {
    try {
        const categories = await getActiveCategories();
        const response = {
            success: true,
            data: categories.map(cat => ({
                id: cat.id,
                name: cat.name,
                slug: cat.slug,
                description: cat.description,
                isActive: cat.isActive,
                createdAt: cat.createdAt,
                updatedAt: cat.updatedAt
            }))
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении категорий'
        });
    }
});
/**
 * GET /api/external/products
 * Получить список товаров с фильтрацией
 *
 * Query параметры:
 * - categoryId - фильтр по категории
 * - region - RUSSIA или BALI (по умолчанию RUSSIA)
 * - search - поиск по названию/описанию
 * - limit - лимит результатов (по умолчанию 100)
 * - offset - смещение для пагинации (по умолчанию 0)
 */
router.get('/products', async (req, res) => {
    try {
        const categoryId = req.query.categoryId;
        const region = req.query.region?.toUpperCase() || 'RUSSIA';
        const search = req.query.search;
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;
        const isBali = region === 'BALI';
        const where = {
            isActive: true,
            ...(isBali ? { availableInBali: true } : { availableInRussia: true })
        };
        if (categoryId) {
            where.categoryId = categoryId;
        }
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { summary: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } }
            ];
        }
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                orderBy: { title: 'asc' },
                skip: offset,
                take: limit,
                select: {
                    id: true,
                    title: true,
                    summary: true,
                    description: true,
                    imageUrl: true,
                    price: true,
                    stock: true,
                    availableInRussia: true,
                    availableInBali: true,
                    categoryId: true,
                    category: {
                        select: {
                            id: true,
                            name: true,
                            slug: true
                        }
                    },
                    createdAt: true,
                    updatedAt: true
                }
            }),
            prisma.product.count({ where })
        ]);
        const response = {
            success: true,
            data: products.map(p => ({
                id: p.id,
                title: p.title,
                description: p.description || null,
                price: p.price,
                priceRub: p.price * 100, // Конвертация PZ в RUB
                isActive: true,
                categoryId: p.categoryId,
                imageUrl: p.imageUrl,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
                category: p.category ? {
                    id: p.category.id,
                    name: p.category.name,
                    slug: p.category.slug,
                    description: null,
                    isActive: true,
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt
                } : undefined,
                // Дополнительные поля
                summary: p.summary,
                stock: p.stock,
                availableInRussia: p.availableInRussia,
                availableInBali: p.availableInBali
            }))
        };
        // Добавляем информацию о пагинации в заголовки
        res.setHeader('X-Total-Count', total.toString());
        res.setHeader('X-Limit', limit.toString());
        res.setHeader('X-Offset', offset.toString());
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении товаров'
        });
    }
});
/**
 * GET /api/external/products/:id
 * Получить конкретный товар по ID
 */
router.get('/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await getProductById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Товар не найден'
            });
        }
        if (!product.isActive) {
            return res.status(404).json({
                success: false,
                error: 'Товар неактивен'
            });
        }
        const category = product.categoryId ? await prisma.category.findUnique({
            where: { id: product.categoryId }
        }) : null;
        const response = {
            success: true,
            data: {
                id: product.id,
                title: product.title,
                description: product.description || null,
                price: product.price,
                priceRub: product.price * 100, // Конвертация PZ в RUB
                isActive: product.isActive,
                categoryId: product.categoryId,
                imageUrl: product.imageUrl,
                createdAt: product.createdAt,
                updatedAt: product.updatedAt,
                category: category ? {
                    id: category.id,
                    name: category.name,
                    slug: category.slug,
                    description: category.description,
                    isActive: category.isActive,
                    createdAt: category.createdAt,
                    updatedAt: category.updatedAt
                } : undefined,
                // Дополнительные поля
                summary: product.summary,
                stock: product.stock,
                availableInRussia: product.availableInRussia,
                availableInBali: product.availableInBali
            }
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении товара'
        });
    }
});
/**
 * POST /api/external/orders
 * Создать заказ
 *
 * Body:
 * {
 *   "contact": "телефон или другой контакт",
 *   "items": [
 *     {
 *       "productId": "string",
 *       "quantity": number,
 *       "price": number (опционально, если не указан - берется из БД)
 *     }
 *   ],
 *   "message": "дополнительная информация" (опционально)
 * }
 */
router.post('/orders', async (req, res) => {
    try {
        const { contact, items, message } = req.body;
        // Валидация
        if (!contact) {
            return res.status(400).json({
                success: false,
                error: 'Поле contact обязательно'
            });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Поле items должно быть непустым массивом'
            });
        }
        // Валидация и получение данных о товарах
        const orderItems = await Promise.all(items.map(async (item) => {
            if (!item.productId || !item.quantity) {
                throw new Error('Каждый товар должен содержать productId и quantity');
            }
            if (item.quantity <= 0) {
                throw new Error('Количество должно быть больше 0');
            }
            const product = await getProductById(item.productId);
            if (!product) {
                throw new Error(`Товар с ID ${item.productId} не найден`);
            }
            if (!product.isActive) {
                throw new Error(`Товар ${product.title} неактивен`);
            }
            // Используем переданную цену или цену из БД
            const price = item.price !== undefined ? Number(item.price) : product.price;
            return {
                productId: product.id,
                title: product.title,
                price: price,
                quantity: Number(item.quantity),
                originalPrice: product.price,
                discountApplied: item.price !== undefined && item.price < product.price
            };
        }));
        // Формируем сообщение для заказа
        const orderMessage = message || `Заказ через внешний API. Контакт: ${contact}`;
        // Создаем заказ
        const order = await createOrderRequest({
            contact,
            message: orderMessage,
            items: orderItems
        });
        const response = {
            success: true,
            data: {
                orderId: order.id,
                status: order.status,
                createdAt: order.createdAt,
                items: orderItems,
                total: orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
            }
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error creating order:', error);
        if (error instanceof Error && (error.message.includes('обязательно') || error.message.includes('должно быть'))) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }
        const errorMessage = error instanceof Error ? error.message : 'Ошибка при создании заказа';
        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
});
export { router as externalApiRouter };
