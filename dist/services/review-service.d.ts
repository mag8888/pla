export declare function getActiveReviews(limit?: number): Promise<(import("mongoose").FlattenMaps<import("../models/Review.js").IReview> & Required<{
    _id: import("mongoose").Types.ObjectId;
}> & {
    __v: number;
})[]>;
