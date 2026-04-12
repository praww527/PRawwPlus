import mongoose, { Schema, Document, Model } from "mongoose";

export interface IEarning extends Document<string> {
  _id: string;
  resellerId: string;
  userId: string;
  amount: number;
  purchaseAmount: number;
  type: "subscription" | "topup" | "number_purchase";
  referenceId: string;
  status: "pending" | "paid";
  createdAt: Date;
  updatedAt: Date;
}

const EarningSchema = new Schema<IEarning>(
  {
    _id: { type: String, required: true },
    resellerId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    purchaseAmount: { type: Number, required: true },
    type: {
      type: String,
      enum: ["subscription", "topup", "number_purchase"],
      required: true,
    },
    referenceId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
  },
  { timestamps: true, _id: false }
);

export const EarningModel: Model<IEarning> =
  mongoose.models.Earning || mongoose.model<IEarning>("Earning", EarningSchema);
