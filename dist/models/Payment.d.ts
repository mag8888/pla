import mongoose, { Document } from 'mongoose';
export declare enum PaymentStatus {
    PENDING = "PENDING",
    PAID = "PAID",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
}
export interface IPayment extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    orderId: string;
    invoiceId: string;
    amount: number;
    currency: string;
    status: PaymentStatus;
    paymentUrl?: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare const Payment: mongoose.Model<IPayment, {}, {}, {}, mongoose.Document<unknown, {}, IPayment, {}, {}> & IPayment & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
