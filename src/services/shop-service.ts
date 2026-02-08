import { prisma } from '../lib/prisma.js';

export async function getActiveCategories() {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return categories.filter((c: any) => c?.isVisibleInWebapp !== false && c?.name !== 'Отключенные');
  } catch (error: any) {
    console.error('❌ getActiveCategories error:', error?.message || error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) return [];
    throw error;
  }
}

export async function getCategoryById(id: string) {
  return prisma.category.findUnique({
    where: { id },
  });
}

export async function getProductsByCategory(categoryId: string) {
  const products = await prisma.product.findMany({
    where: {
      categoryId,
      isActive: true,
    },
    orderBy: { title: 'asc' },
  });
  return products;
}

export async function getProductById(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
  });
}

export async function getAllActiveProducts() {
  try {
    console.log('📦 getAllActiveProducts: Querying database...');
    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: true },
      orderBy: { title: 'asc' },
    });
    console.log(`✅ getAllActiveProducts: Found ${products.length} products`);
    return products;
  } catch (error: any) {
    console.error('❌ getAllActiveProducts error:', error);
    if (error?.code === 'P2031' || error?.message?.includes('replica set')) {
      console.warn('⚠️  MongoDB replica set not configured');
      // Return empty array instead of throwing
      return [];
    }
    throw error;
  }
}
