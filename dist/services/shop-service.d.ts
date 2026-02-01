import mongoose from 'mongoose';
export declare function getActiveCategories(): Promise<(mongoose.FlattenMaps<import("../models/Category.js").ICategory> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[]>;
export declare function getCategoryById(id: string): Promise<(mongoose.FlattenMaps<import("../models/Category.js").ICategory> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}) | null>;
export declare function getProductsByCategory(categoryId: string): Promise<(mongoose.FlattenMaps<import("../models/Product.js").IProduct> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[]>;
export declare function getProductById(productId: string): Promise<(mongoose.FlattenMaps<import("../models/Product.js").IProduct> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}) | null>;
