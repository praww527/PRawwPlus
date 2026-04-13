import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAbuseFlag extends Document<string> {
  _id: string;
  userId: string;
  reason: string;
  severity: "low" | "medium" | "high";
  notes?: string;
  flaggedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AbuseFlagSchema = new Schema<IAbuseFlag>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    reason: { type: String, required: true, maxlength: 500 },
    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    notes: { type: String, maxlength: 1000 },
    flaggedBy: { type: String },
    resolvedAt: { type: Date },
  },
  { timestamps: true, _id: false },
);

export const AbuseFlagModel: Model<IAbuseFlag> =
  mongoose.models.AbuseFlag ||
  mongoose.model<IAbuseFlag>("AbuseFlag", AbuseFlagSchema);
