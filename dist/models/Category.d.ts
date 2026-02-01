import mongoose, { Document } from 'mongoose';
export interface ICategory extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    id?: string;
    name: string;
    slug: string;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export declare const Category: mongoose.Model<ICategory, {}, {}, {}, mongoose.Document<unknown, {}, ICategory, {}, {}> & ICategory & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
