import mongoose, { Document, Types } from 'mongoose';
export interface IBotContent extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    key: string;
    title: string;
    content: string;
    description?: string;
    category?: string;
    isActive: boolean;
    language: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare const BotContent: mongoose.Model<IBotContent, {}, {}, {}, mongoose.Document<unknown, {}, IBotContent, {}, {}> & IBotContent & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
