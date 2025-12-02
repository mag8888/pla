export declare function getCartItems(userId: string): Promise<({
    product: {
        id: string;
        title: string;
        description: string | null;
        createdAt: Date;
        updatedAt: Date;
        price: number;
        isActive: boolean;
        summary: string;
        instruction: string | null;
        imageUrl: string | null;
        stock: number;
        availableInRussia: boolean;
        availableInBali: boolean;
        categoryId: string;
    };
} & {
    id: string;
    createdAt: Date;
    userId: string;
    productId: string;
    quantity: number;
})[]>;
export declare function addProductToCart(userId: string, productId: string): Promise<{
    id: string;
    createdAt: Date;
    userId: string;
    productId: string;
    quantity: number;
}>;
export declare function clearCart(userId: string): Promise<void>;
export declare function increaseProductQuantity(userId: string, productId: string): Promise<{
    id: string;
    createdAt: Date;
    userId: string;
    productId: string;
    quantity: number;
}>;
export declare function decreaseProductQuantity(userId: string, productId: string): Promise<{
    id: string;
    createdAt: Date;
    userId: string;
    productId: string;
    quantity: number;
} | null>;
export declare function removeProductFromCart(userId: string, productId: string): Promise<{
    id: string;
    createdAt: Date;
    userId: string;
    productId: string;
    quantity: number;
}>;
/**
 * Calculate price with partner discount (10% if partner program is active)
 */
export declare function calculatePriceWithDiscount(userId: string, basePrice: number): Promise<{
    originalPrice: number;
    discountedPrice: number;
    discount: number;
    hasDiscount: boolean;
}>;
export declare function cartItemsToText(items: Array<{
    product: {
        title: string;
        price: number;
    };
    quantity: number;
}>, userId?: string): Promise<string>;
