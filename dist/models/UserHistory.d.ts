import mongoose, { Document } from 'mongoose';
export interface IUserHistory extends Document {
    _id: string;
    userId: string;
    action: string;
    payload?: any;
    createdAt: Date;
}
export declare const UserHistory: mongoose.Model<IUserHistory, {}, {}, {}, mongoose.Document<unknown, {}, IUserHistory, {}, {}> & IUserHistory & Required<{
    _id: string;
}> & {
    __v: number;
}, any>;
