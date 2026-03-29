import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICdr extends Document<string> {
  _id: string;
  callId: string;
  userId: string;
  fsCallId?: string;
  otherLegId?: string;
  callerNumber?: string;
  recipientNumber?: string;
  direction?: "inbound" | "outbound";
  callType?: "internal" | "external";
  status: string;
  hangupCause?: string;
  billsec: number;
  coinsUsed: number;
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CdrSchema = new Schema<ICdr>(
  {
    _id: { type: String, required: true },
    callId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    fsCallId: { type: String, index: true, sparse: true },
    otherLegId: { type: String },
    callerNumber: { type: String },
    recipientNumber: { type: String },
    direction: { type: String, enum: ["inbound", "outbound"] },
    callType: { type: String, enum: ["internal", "external"] },
    status: { type: String, required: true },
    hangupCause: { type: String },
    billsec: { type: Number, default: 0 },
    coinsUsed: { type: Number, default: 0 },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true, _id: false },
);

CdrSchema.index({ userId: 1, endedAt: -1 });
CdrSchema.index({ callId: 1 }, { unique: true });

export const CdrModel: Model<ICdr> =
  mongoose.models.Cdr || mongoose.model<ICdr>("Cdr", CdrSchema);
