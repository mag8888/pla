import mongoose, { Document } from 'mongoose';
export interface ICategory extends Document {
    _id: string;
    id?: string;
    name: string;
    slug: string;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export declare const Category: mongoose.Model<ICategory, {}, {}, {}, mongoose.Document<unknown, {}, ICategory, {}, {}> & ICategory & Required<{
    _id: string;
}> & {
    __v: number;
}, any>;
