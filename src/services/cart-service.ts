import { prisma } from '../lib/prisma.js';

export async function getCartItems(userId: string) {
  return prisma.cartItem.findMany({
    where: { userId },
    include: {
      product: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function addProductToCart(userId: string, productId: string) {
  return prisma.cartItem.upsert({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    update: {
      quantity: { increment: 1 },
    },
    create: {
      userId,
      productId,
      quantity: 1,
    },
  });
}

export async function clearCart(userId: string) {
  await prisma.cartItem.deleteMany({ where: { userId } });
}

export async function increaseProductQuantity(userId: string, productId: string) {
  return prisma.cartItem.upsert({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    update: {
      quantity: {
        increment: 1,
      },
    },
    create: {
      userId,
      productId,
      quantity: 1,
    },
  });
}

export async function decreaseProductQuantity(userId: string, productId: string) {
  const item = await prisma.cartItem.findUnique({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
  });

  if (!item) {
    return null;
  }

  if (item.quantity <= 1) {
    // Remove item if quantity becomes 0 or less
    await prisma.cartItem.delete({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });
    return null;
  }

  return prisma.cartItem.update({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    data: {
      quantity: {
        decrement: 1,
      },
    },
  });
}

export async function removeProductFromCart(userId: string, productId: string) {
  return prisma.cartItem.delete({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
  });
}

export function cartItemsToText(items: Array<{ product: { title: string; price: number }; quantity: number }>) {
  if (items.length === 0) {
    return 'Корзина пуста.';
  }

  const lines = items.map((item) => {
    const pzPrice = Number(item.product.price);
    const rubPrice = (pzPrice * 100).toFixed(2);
    const totalRub = (pzPrice * item.quantity * 100).toFixed(2);
    const totalPz = (pzPrice * item.quantity).toFixed(2);
    return `• ${item.product.title} — ${item.quantity} шт. × ${rubPrice} ₽ = ${totalRub} ₽ / ${totalPz} PZ`;
  });

  // Calculate total sum
  let totalPzSum = 0;
  let totalRubSum = 0;
  
  items.forEach((item) => {
    const pzPrice = Number(item.product.price);
    totalPzSum += pzPrice * item.quantity;
    totalRubSum += pzPrice * item.quantity * 100;
  });

  // Add total sum line
  lines.push('');
  lines.push(`💰 Общая сумма: ${totalRubSum.toFixed(2)} ₽ / ${totalPzSum.toFixed(2)} PZ`);

  return lines.join('\n');
}
