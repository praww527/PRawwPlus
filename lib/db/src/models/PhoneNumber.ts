import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPhoneNumber extends Document<string> {
  _id: string;
  number: string;
  userId?: string | null;
  country?: string;
  region?: string;
  assignedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneNumberSchema = new Schema<IPhoneNumber>(
  {
    _id: { type: String, required: true },
    number: { type: String, required: true, unique: true },
    userId: { type: String, default: null, index: true },
    country: { type: String },
    region: { type: String },
    assignedAt: { type: Date, default: null },
  },
  { timestamps: true, _id: false }
);

export const PhoneNumberModel: Model<IPhoneNumber> =
  mongoose.models.PhoneNumber ||
  mongoose.model<IPhoneNumber>("PhoneNumber", PhoneNumberSchema);
