import mongoose, { Schema, Document, Model } from "mongoose";

export type PortStatus =
  | "draft"
  | "submitted"
  | "in-progress"
  | "awaiting-loa"
  | "awaiting-carrier"
  | "completed"
  | "rejected"
  | "cancelled";

export interface IPortRequest extends Document<string> {
  _id:           string;
  userId:        string;
  tenantId?:     string;
  numbers:       string[];
  losingCarrier: string;
  contactName:   string;
  contactEmail:  string;
  contactPhone:  string;
  accountNumber: string;
  billingAddress?: string;
  loaUrl?:       string;
  status:        PortStatus;
  rejectionReason?: string;
  notes?:        string;
  submittedAt?:  Date;
  portDate?:     Date;
  completedAt?:  Date;
  adminNotes?:   string;
  createdAt:     Date;
  updatedAt:     Date;
}

const PortRequestSchema = new Schema<IPortRequest>(
  {
    _id:           { type: String, required: true },
    userId:        { type: String, required: true, index: true },
    tenantId:      { type: String, index: true },
    numbers:       { type: [String], required: true },
    losingCarrier: { type: String, required: true },
    contactName:   { type: String, required: true },
    contactEmail:  { type: String, required: true },
    contactPhone:  { type: String, required: true },
    accountNumber: { type: String, required: true },
    billingAddress:{ type: String },
    loaUrl:        { type: String },
    status:        { type: String, enum: ["draft","submitted","in-progress","awaiting-loa","awaiting-carrier","completed","rejected","cancelled"], default: "draft" },
    rejectionReason: { type: String },
    notes:         { type: String },
    submittedAt:   { type: Date },
    portDate:      { type: Date },
    completedAt:   { type: Date },
    adminNotes:    { type: String },
  },
  { timestamps: true, _id: false },
);

export const PortRequestModel: Model<IPortRequest> =
  mongoose.models.PortRequest || mongoose.model<IPortRequest>("PortRequest", PortRequestSchema);
