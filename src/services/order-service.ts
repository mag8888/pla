import { prisma } from '../lib/prisma.js';

interface OrderItemPayload {
  productId: string;
  title: string;
  price: number; // Final price after discount
  quantity: number;
  originalPrice?: number; // Original price before discount
  hasDiscount?: boolean; // Whether discount was applied
  discount?: number; // Discount amount
}

export async function createOrderRequest(params: {
  userId?: string;
  contact?: string;
  message: string;
  items: OrderItemPayload[];
}) {
  const itemsJson = params.items.map((item) => ({
    ...item,
    price: Number(item.price),
    originalPrice: item.originalPrice ? Number(item.originalPrice) : undefined,
    discount: item.discount ? Number(item.discount) : undefined,
    hasDiscount: item.hasDiscount || false,
  }));

  console.log('🛒 Creating order request:', {
    userId: params.userId,
    contact: params.contact,
    message: params.message,
    itemsCount: params.items.length,
    items: params.items
  });

  const order = await prisma.orderRequest.create({
    data: {
      userId: params.userId,
      contact: params.contact,
      message: params.message,
      itemsJson,
    },
  });

  console.log('✅ Order request created successfully:', {
    orderId: order.id,
    userId: order.userId,
    status: order.status,
    createdAt: order.createdAt
  });

  return order;
}
