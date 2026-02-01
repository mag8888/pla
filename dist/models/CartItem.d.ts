import mongoose, { Document } from 'mongoose';
export interface ICartItem extends Document {
    _id: string;
    userId: string;
    productId: string;
    quantity: number;
    createdAt: Date;
}
export declare const CartItem: mongoose.Model<ICartItem, {}, {}, {}, mongoose.Document<unknown, {}, ICartItem, {}, {}> & ICartItem & Required<{
    _id: string;
}> & {
    __v: number;
}, any>;
