import mongoose, { Schema, Document, Model } from "mongoose";

export interface IRatePlanRate {
  prefix: string;
  coinsPerMinute: number;
  description?: string;
}

export interface IRatePlan extends Document<string> {
  _id: string;
  name: string;
  currency: string;
  defaultCoinsPerMinute: number;
  rates: IRatePlanRate[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RatePlanRateSchema = new Schema<IRatePlanRate>(
  {
    prefix: { type: String, required: true },
    coinsPerMinute: { type: Number, required: true },
    description: { type: String },
  },
  { _id: false },
);

const RatePlanSchema = new Schema<IRatePlan>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    currency: { type: String, default: "ZAR" },
    defaultCoinsPerMinute: { type: Number, default: 1 },
    rates: { type: [RatePlanRateSchema], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, _id: false },
);

RatePlanSchema.index({ isActive: 1, updatedAt: -1 });

export const RatePlanModel: Model<IRatePlan> =
  mongoose.models.RatePlan || mongoose.model<IRatePlan>("RatePlan", RatePlanSchema);
