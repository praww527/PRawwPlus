import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPayout extends Document<string> {
  _id: string;
  resellerId: string;
  amount: number;
  status: "pending" | "paid";
  notes?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PayoutSchema = new Schema<IPayout>(
  {
    _id: { type: String, required: true },
    resellerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
    notes: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true, _id: false }
);

export const PayoutModel: Model<IPayout> =
  mongoose.models.Payout || mongoose.model<IPayout>("Payout", PayoutSchema);
