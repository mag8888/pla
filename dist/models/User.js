import mongoose, { Schema } from 'mongoose';
export var Region;
(function (Region) {
    Region["RUSSIA"] = "RUSSIA";
    Region["BALI"] = "BALI";
    Region["DUBAI"] = "DUBAI";
    Region["KAZAKHSTAN"] = "KAZAKHSTAN";
    Region["BELARUS"] = "BELARUS";
    Region["OTHER"] = "OTHER";
})(Region || (Region = {}));
const UserSchema = new Schema({
    telegramId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    firstName: String,
    lastName: String,
    username: String,
    languageCode: String,
    phone: String,
    selectedRegion: {
        type: String,
        enum: Object.values(Region),
        default: Region.RUSSIA,
    },
    deliveryAddress: String,
    balance: {
        type: Number,
        default: 0,
    },
}, {
    timestamps: true,
    collection: 'users',
    toJSON: {
        virtuals: true,
        transform: function (doc, ret) {
            ret.id = ret._id;
            delete ret._id;
            delete ret.__v;
            return ret;
        }
    },
    toObject: {
        virtuals: true,
        transform: function (doc, ret) {
            ret.id = ret._id;
            delete ret._id;
            delete ret.__v;
            return ret;
        }
    }
});
// Virtual for id
UserSchema.virtual('id').get(function () {
    return this._id.toHexString();
});
export const User = mongoose.model('User', UserSchema);
