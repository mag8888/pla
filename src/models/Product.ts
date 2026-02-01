import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
  _id: string;
  id?: string; // Virtual field
  title: string;
  summary: string;
  description?: string;
  instruction?: string;
  imageUrl?: string;
  price: number;
  stock: number;
  isActive: boolean;
  availableInRussia: boolean;
  availableInBali: boolean;
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    title: {
      type: String,
      required: true,
    },
    summary: {
      type: String,
      required: true,
    },
    description: String,
    instruction: String,
    imageUrl: String,
    price: {
      type: Number,
      required: true,
    },
    stock: {
      type: Number,
      default: 999,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    availableInRussia: {
      type: Boolean,
      default: true,
    },
    availableInBali: {
      type: Boolean,
      default: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'products',
    toJSON: {
      virtuals: true,
      transform: function(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    },
    toObject: {
      virtuals: true,
      transform: function(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

ProductSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
