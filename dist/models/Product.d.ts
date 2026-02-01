import mongoose, { Document } from 'mongoose';
export interface IProduct extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    id?: string;
    title: string;
    summary: string;
    description?: string;
    instruction?: string;
    imageUrl?: string;
    price: number;
    stock: number;
    isActive: boolean;
    availableInRussia: boolean;
    availableInBali: boolean;
    categoryId: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
export declare const Product: mongoose.Model<IProduct, {}, {}, {}, mongoose.Document<unknown, {}, IProduct, {}, {}> & IProduct & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
