import mongoose, { Document } from 'mongoose';
export declare enum TransactionType {
    CREDIT = "CREDIT",
    DEBIT = "DEBIT"
}
export { TransactionType as PartnerTransactionType };
export interface IPartnerTransaction extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    profileId: mongoose.Types.ObjectId;
    amount: number;
    type: TransactionType;
    description: string;
    createdAt: Date;
}
export declare const PartnerTransaction: mongoose.Model<IPartnerTransaction, {}, {}, {}, mongoose.Document<unknown, {}, IPartnerTransaction, {}, {}> & IPartnerTransaction & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
