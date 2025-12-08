import { prisma } from '../lib/prisma.js';
export async function createOrderRequest(params) {
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
