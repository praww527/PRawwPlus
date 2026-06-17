import mongoose, { Schema, Document, Model } from "mongoose";

export type PhoneNumberRouteType = "agent" | "ring_group" | "queue";

export interface IPhoneNumber extends Document<string> {
  _id: string;
  number: string;
  userId?: string | null;
  country?: string;
  region?: string;
  assignedAt?: Date | null;
  cnamName?: string;
  capabilities?: string[];
  forwardTo?: string;
  monthlyFeeCents?: number;
  billingRef?: string;
  portStatus?: "none" | "porting-in" | "porting-out" | "ported";
  portRequestId?: string;
  providerRef?: string;
  source?: string;
  routeType: PhoneNumberRouteType;
  routeTarget?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneNumberSchema = new Schema<IPhoneNumber>(
  {
    _id:             { type: String, required: true },
    number:          { type: String, required: true, unique: true },
    userId:          { type: String, default: null, index: true },
    country:         { type: String },
    region:          { type: String },
    assignedAt:      { type: Date, default: null },
    cnamName:        { type: String },
    capabilities:    { type: [String], default: ["voice"] },
    forwardTo:       { type: String },
    monthlyFeeCents: { type: Number, default: 0 },
    billingRef:      { type: String },
    portStatus:      { type: String, enum: ["none","porting-in","porting-out","ported"], default: "none" },
    portRequestId:   { type: String },
    providerRef:     { type: String },
    source:          { type: String },
    routeType:       { type: String, enum: ["agent","ring_group","queue"], default: "agent" },
    routeTarget:     { type: String },
  },
  { timestamps: true, _id: false }
);

export const PhoneNumberModel: Model<IPhoneNumber> =
  mongoose.models.PhoneNumber ||
  mongoose.model<IPhoneNumber>("PhoneNumber", PhoneNumberSchema);
