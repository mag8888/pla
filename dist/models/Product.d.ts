import mongoose, { Document } from 'mongoose';
export interface IProduct extends Document {
    _id: string;
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
    categoryId: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare const Product: mongoose.Model<IProduct, {}, {}, {}, mongoose.Document<unknown, {}, IProduct, {}, {}> & IProduct & Required<{
    _id: string;
}> & {
    __v: number;
}, any>;
