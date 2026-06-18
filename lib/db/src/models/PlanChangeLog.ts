import mongoose, { Schema, Document } from "mongoose";

export interface IPlanChangeLog extends Document<string> {
  _id: string;
  userId: string;
  adminId: string;
  adminName?: string;
  oldPlan: string;
  newPlan: string;
  oldMonthlyFee?: number;
  newMonthlyFee?: number;
  oldMinutes?: number;
  newMinutes?: number;
  oldRate?: number;
  newRate?: number;
  notes?: string;
  createdAt: Date;
}

const PlanChangeLogSchema = new Schema<IPlanChangeLog>(
  {
    _id:          { type: String, required: true },
    userId:       { type: String, required: true, index: true },
    adminId:      { type: String, required: true, index: true },
    adminName:    { type: String },
    oldPlan:      { type: String, required: true },
    newPlan:      { type: String, required: true },
    oldMonthlyFee: { type: Number },
    newMonthlyFee: { type: Number },
    oldMinutes:   { type: Number },
    newMinutes:   { type: Number },
    oldRate:      { type: Number },
    newRate:      { type: Number },
    notes:        { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const PlanChangeLogModel: mongoose.Model<IPlanChangeLog> =
  mongoose.models["PlanChangeLog"] ??
  mongoose.model<IPlanChangeLog>("PlanChangeLog", PlanChangeLogSchema);
