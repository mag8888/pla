import mongoose, { Document, Types } from 'mongoose';
export interface ICartItem extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    productId: mongoose.Types.ObjectId;
    quantity: number;
    createdAt: Date;
}
export declare const CartItem: mongoose.Model<ICartItem, {}, {}, {}, mongoose.Document<unknown, {}, ICartItem, {}, {}> & ICartItem & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
