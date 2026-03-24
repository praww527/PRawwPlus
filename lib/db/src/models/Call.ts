import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICall extends Document<string> {
  _id: string;
  userId: string;
  callerNumber?: string;
  recipientNumber: string;
  callType: "internal" | "external";
  status: string;
  duration: number;
  cost: number;
  fsCallId?: string;
  notes?: string;
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CallSchema = new Schema<ICall>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    callerNumber: { type: String },
    recipientNumber: { type: String, required: true },
    callType: { type: String, enum: ["internal", "external"], default: "external" },
    status: { type: String, default: "initiated" },
    duration: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    fsCallId: { type: String },
    notes: { type: String },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true, _id: false }
);

export const CallModel: Model<ICall> =
  mongoose.models.Call || mongoose.model<ICall>("Call", CallSchema);
