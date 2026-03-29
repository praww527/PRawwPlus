import mongoose, { Schema, Document, Model } from "mongoose";

export type BillingLedgerType = "debit" | "credit";

export interface IBillingLedger extends Document<string> {
  _id: string;
  userId: string;
  callId?: string;
  type: BillingLedgerType;
  coins: number;
  reason: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const BillingLedgerSchema = new Schema<IBillingLedger>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    callId: { type: String, index: true, sparse: true },
    type: { type: String, enum: ["debit", "credit"], required: true },
    coins: { type: Number, required: true },
    reason: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, _id: false },
);

// Prevent double-charging a call: at most one ledger row per user+callId
BillingLedgerSchema.index({ userId: 1, callId: 1 }, { unique: true, sparse: true });

export const BillingLedgerModel: Model<IBillingLedger> =
  mongoose.models.BillingLedger ||
  mongoose.model<IBillingLedger>("BillingLedger", BillingLedgerSchema);
