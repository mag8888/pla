import mongoose, { Document } from 'mongoose';
export interface IOrderRequest extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    userId?: mongoose.Types.ObjectId;
    contact?: string;
    message: string;
    itemsJson: any;
    status: string;
    createdAt: Date;
}
export declare const OrderRequest: mongoose.Model<IOrderRequest, {}, {}, {}, mongoose.Document<unknown, {}, IOrderRequest, {}, {}> & IOrderRequest & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
