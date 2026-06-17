import mongoose, { Schema, Document, Model } from "mongoose";

export type OrgInviteRole = "member" | "admin";

export interface IOrgInvite extends Document<string> {
  _id: string;
  orgId: string;
  email: string;
  token: string;
  role: OrgInviteRole;
  createdBy: string;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OrgInviteSchema = new Schema<IOrgInvite>(
  {
    _id:        { type: String, required: true },
    orgId:      { type: String, required: true, index: true },
    email:      { type: String, required: true },
    token:      { type: String, required: true, unique: true, index: true },
    role:       { type: String, enum: ["member", "admin"], default: "member" },
    createdBy:  { type: String, required: true },
    expiresAt:  { type: Date, required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true, _id: false },
);

OrgInviteSchema.index({ orgId: 1, email: 1 });

export const OrgInviteModel: Model<IOrgInvite> =
  mongoose.models.OrgInvite || mongoose.model<IOrgInvite>("OrgInvite", OrgInviteSchema);
