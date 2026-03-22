import mongoose, { Schema, Document, Model } from "mongoose";

export interface IContact extends Document<string> {
  _id: string;
  userId: string;
  name: string;
  number: string;
  fromPhone: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    number: { type: String, required: true },
    fromPhone: { type: Boolean, default: false },
  },
  { timestamps: true, _id: false }
);

ContactSchema.index({ userId: 1, number: 1 }, { unique: true });

export const ContactModel: Model<IContact> =
  mongoose.models.Contact || mongoose.model<IContact>("Contact", ContactSchema);
