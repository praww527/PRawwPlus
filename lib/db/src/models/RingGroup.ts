import mongoose, { Schema, Document, Model } from "mongoose";

export type RingGroupStrategy = "ring-all" | "round-robin";

export interface IRingGroup extends Document<string> {
  _id: string;
  name: string;
  strategy: RingGroupStrategy;
  members: string[];
  description?: string;
  tenantId?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RingGroupSchema = new Schema<IRingGroup>(
  {
    _id:         { type: String, required: true },
    name:        { type: String, required: true, trim: true },
    strategy:    { type: String, enum: ["ring-all", "round-robin"], default: "ring-all" },
    members:     { type: [String], default: [] },
    description: { type: String },
    tenantId:    { type: String, index: true },
    active:      { type: Boolean, default: true },
  },
  { timestamps: true, _id: false },
);

export const RingGroupModel: Model<IRingGroup> =
  mongoose.models.RingGroup || mongoose.model<IRingGroup>("RingGroup", RingGroupSchema);
