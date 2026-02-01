import mongoose, { Document } from 'mongoose';
export interface IBotContent extends Document {
    _id: string;
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
    _id: string;
}> & {
    __v: number;
}, any>;
