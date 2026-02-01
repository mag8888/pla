import mongoose, { Document } from 'mongoose';
export declare enum Region {
    RUSSIA = "RUSSIA",
    BALI = "BALI",
    DUBAI = "DUBAI",
    KAZAKHSTAN = "KAZAKHSTAN",
    BELARUS = "BELARUS",
    OTHER = "OTHER"
}
export interface IUser extends Document {
    _id: string;
    id?: string;
    telegramId: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    languageCode?: string;
    phone?: string;
    selectedRegion?: Region;
    deliveryAddress?: string;
    balance: number;
    createdAt: Date;
    updatedAt: Date;
}
export declare const User: mongoose.Model<IUser, {}, {}, {}, mongoose.Document<unknown, {}, IUser, {}, {}> & IUser & Required<{
    _id: string;
}> & {
    __v: number;
}, any>;
