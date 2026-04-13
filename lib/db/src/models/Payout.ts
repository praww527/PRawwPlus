import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPayout extends Document<string> {
  _id: string;
  resellerId: string;
  amount: number;
  status: "requested" | "pending" | "paid";
  notes?: string;
  requestedAt?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PayoutSchema = new Schema<IPayout>(
  {
    _id: { type: String, required: true },
    resellerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["requested", "pending", "paid"], default: "pending" },
    notes: { type: String },
    requestedAt: { type: Date },
    paidAt: { type: Date },
  },
  { timestamps: true, _id: false }
);

export const PayoutModel: Model<IPayout> =
  mongoose.models.Payout || mongoose.model<IPayout>("Payout", PayoutSchema);
