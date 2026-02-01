import mongoose, { Document } from 'mongoose';
export interface IUserHistory extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    action: string;
    payload?: any;
    createdAt: Date;
}
export declare const UserHistory: mongoose.Model<IUserHistory, {}, {}, {}, mongoose.Document<unknown, {}, IUserHistory, {}, {}> & IUserHistory & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
