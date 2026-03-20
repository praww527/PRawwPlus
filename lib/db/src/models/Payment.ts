import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPayment extends Document {
  _id: string;
  userId: string;
  amount: number;
  creditAdded: number;
  status: string;
  paymentType: string;
  payfastPaymentId?: string;
  createdAt: Date;
  completedAt?: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    creditAdded: { type: Number, default: 0 },
    status: { type: String, default: "pending" },
    paymentType: { type: String, default: "subscription" },
    payfastPaymentId: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true, _id: false }
);

export const PaymentModel: Model<IPayment> =
  mongoose.models.Payment || mongoose.model<IPayment>("Payment", PaymentSchema);
