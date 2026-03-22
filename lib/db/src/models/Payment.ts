import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPayment extends Document<string> {
  _id: string;
  userId: string;
  amount: number;
  coinsAdded: number;
  status: string;
  paymentType: string;
  subscriptionPlan?: string;
  payfastPaymentId?: string;
  meta?: Record<string, string>;
  createdAt: Date;
  completedAt?: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    coinsAdded: { type: Number, default: 0 },
    status: { type: String, default: "pending" },
    paymentType: { type: String, default: "subscription" },
    subscriptionPlan: { type: String },
    payfastPaymentId: { type: String },
    meta: { type: Schema.Types.Mixed },
    completedAt: { type: Date },
  },
  { timestamps: true, _id: false }
);

export const PaymentModel: Model<IPayment> =
  mongoose.models.Payment || mongoose.model<IPayment>("Payment", PaymentSchema);
