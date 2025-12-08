import { prisma } from '../lib/prisma.js';
export async function getActiveCategories() {
    return prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
    });
}
export async function getCategoryById(id) {
    return prisma.category.findUnique({
        where: { id },
    });
}
export async function getProductsByCategory(categoryId) {
    return prisma.product.findMany({
        where: { categoryId, isActive: true },
        orderBy: { title: 'asc' },
    });
}
export async function getProductById(productId) {
    return prisma.product.findUnique({
        where: { id: productId },
    });
}
