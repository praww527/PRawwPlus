import mongoose, { Schema, Document, Model } from "mongoose";

export type CommissionType = "referral_signup" | "call_revenue" | "subscription" | "top_up" | "bonus";
export type CommissionStatus = "pending" | "approved" | "paid" | "reversed";

export interface IResellerCommission extends Document<string> {
  _id:          string;
  resellerId:   string;
  userId:       string;
  type:         CommissionType;
  sourceRef?:   string;
  grossAmount:  number;
  ratePercent:  number;
  commissionAmount: number;
  currency:     string;
  status:       CommissionStatus;
  paidAt?:      Date;
  payoutId?:    string;
  notes?:       string;
  tenantId?:    string;
  createdAt:    Date;
  updatedAt:    Date;
}

const ResellerCommissionSchema = new Schema<IResellerCommission>(
  {
    _id:              { type: String, required: true },
    resellerId:       { type: String, required: true, index: true },
    userId:           { type: String, required: true, index: true },
    type:             { type: String, enum: ["referral_signup","call_revenue","subscription","top_up","bonus"], required: true },
    sourceRef:        { type: String },
    grossAmount:      { type: Number, required: true },
    ratePercent:      { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    currency:         { type: String, default: "ZAR" },
    status:           { type: String, enum: ["pending","approved","paid","reversed"], default: "pending" },
    paidAt:           { type: Date },
    payoutId:         { type: String },
    notes:            { type: String },
    tenantId:         { type: String, index: true },
  },
  { timestamps: true, _id: false },
);

ResellerCommissionSchema.index({ resellerId: 1, status: 1 });
ResellerCommissionSchema.index({ resellerId: 1, createdAt: -1 });

export const ResellerCommissionModel: Model<IResellerCommission> =
  mongoose.models.ResellerCommission || mongoose.model<IResellerCommission>("ResellerCommission", ResellerCommissionSchema);
