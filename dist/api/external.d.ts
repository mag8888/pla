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
declare const router: import("express-serve-static-core").Router;
export { router as externalApiRouter };
