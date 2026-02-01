import { ICartItem } from '../models/index.js';
import mongoose from 'mongoose';
export declare function getCartItems(userId: string): Promise<any[]>;
export declare function addProductToCart(userId: string, productId: string): Promise<mongoose.Document<unknown, {}, ICartItem, {}, {}> & ICartItem & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
export declare function clearCart(userId: string): Promise<void>;
export declare function increaseProductQuantity(userId: string, productId: string): Promise<mongoose.Document<unknown, {}, ICartItem, {}, {}> & ICartItem & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
export declare function decreaseProductQuantity(userId: string, productId: string): Promise<(mongoose.Document<unknown, {}, ICartItem, {}, {}> & ICartItem & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}) | null>;
export declare function removeProductFromCart(userId: string, productId: string): Promise<(mongoose.Document<unknown, {}, ICartItem, {}, {}> & ICartItem & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}) | null>;
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
