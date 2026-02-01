import mongoose, { Schema } from 'mongoose';
export var TransactionType;
(function (TransactionType) {
    TransactionType["CREDIT"] = "CREDIT";
    TransactionType["DEBIT"] = "DEBIT";
})(TransactionType || (TransactionType = {}));
// Re-export for convenience
export { TransactionType as PartnerTransactionType };
const PartnerTransactionSchema = new Schema({
    profileId: {
        type: Schema.Types.ObjectId,
        ref: 'PartnerProfile',
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    type: {
        type: String,
        enum: Object.values(TransactionType),
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'partnerTransactions',
});
PartnerTransactionSchema.index({ profileId: 1, createdAt: -1 });
export const PartnerTransaction = mongoose.model('PartnerTransaction', PartnerTransactionSchema);
