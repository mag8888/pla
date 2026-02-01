import mongoose, { Document } from 'mongoose';
export interface IOrderRequest extends Document {
    _id: string;
    userId?: string;
    contact?: string;
    message: string;
    itemsJson: any;
    status: string;
    createdAt: Date;
}
export declare const OrderRequest: mongoose.Model<IOrderRequest, {}, {}, {}, mongoose.Document<unknown, {}, IOrderRequest, {}, {}> & IOrderRequest & Required<{
    _id: string;
}> & {
    __v: number;
}, any>;
