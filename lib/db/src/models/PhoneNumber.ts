import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPhoneNumber extends Document {
  _id: string;
  number: string;
  userId?: string | null;
  telnyxNumberId?: string;
  country?: string;
  region?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneNumberSchema = new Schema<IPhoneNumber>(
  {
    _id: { type: String, required: true },
    number: { type: String, required: true, unique: true, index: true },
    userId: { type: String, default: null, index: true },
    telnyxNumberId: { type: String },
    country: { type: String },
    region: { type: String },
  },
  { timestamps: true, _id: false }
);

export const PhoneNumberModel: Model<IPhoneNumber> =
  mongoose.models.PhoneNumber ||
  mongoose.model<IPhoneNumber>("PhoneNumber", PhoneNumberSchema);
