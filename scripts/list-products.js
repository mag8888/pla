#!/usr/bin/env node

/**
 * Скрипт для просмотра всех товаров
 * 
 * Использование:
 * node scripts/list-products.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listProducts() {
  try {
    console.log('📦 Список всех товаров:\n');

    const products = await prisma.product.findMany({
      include: {
        category: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (products.length === 0) {
      console.log('ℹ️ Товары не найдены.');
      return;
    }

    products.forEach((product, index) => {
      console.log(`${index + 1}. ${product.title}`);
      console.log(`   💰 Цена: $${product.price}`);
      console.log(`   📂 Категория: ${product.category.name}`);
      console.log(`   ✅ Активен: ${product.isActive ? 'Да' : 'Нет'}`);
      console.log(`   📅 Создан: ${product.createdAt.toLocaleDateString('ru-RU')}`);
      console.log('');
    });

    console.log(`📊 Всего товаров: ${products.length}`);

  } catch (error) {
    console.error('❌ Ошибка при получении товаров:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Запускаем скрипт
listProducts();
