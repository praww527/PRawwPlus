import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IBillingLedger extends Document {
  userId:    mongoose.Types.ObjectId;
  callId:    mongoose.Types.ObjectId | null;
  type:      "debit" | "credit";
  coins:     number;
  reason:    string;
  meta?:     Record<string, unknown>;
  createdAt: Date;
}

const BillingLedgerSchema = new Schema<IBillingLedger>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User",  required: true, index: true },
    callId: { type: Schema.Types.ObjectId, ref: "Call",  default: null  },
    type:   { type: String, enum: ["debit", "credit"],   required: true },
    coins:  { type: Number,                              required: true },
    reason: { type: String,                              required: true },
    meta:   { type: Schema.Types.Mixed,                  default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Prevent double-charging: only one debit ledger entry per (userId, callId) pair.
BillingLedgerSchema.index(
  { userId: 1, callId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { callId: { $ne: null } } },
);

export const BillingLedgerModel: Model<IBillingLedger> =
  mongoose.models.BillingLedger ??
  mongoose.model<IBillingLedger>("BillingLedger", BillingLedgerSchema);
