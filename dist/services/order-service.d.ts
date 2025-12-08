interface OrderItemPayload {
    productId: string;
    title: string;
    price: number;
    quantity: number;
    originalPrice?: number;
    hasDiscount?: boolean;
    discount?: number;
}
export declare function createOrderRequest(params: {
    userId?: string;
    contact?: string;
    message: string;
    items: OrderItemPayload[];
}): Promise<{
    message: string;
    id: string;
    contact: string | null;
    createdAt: Date;
    userId: string | null;
    itemsJson: import("@prisma/client/runtime/library").JsonValue;
    status: string;
}>;
export {};
