/**
 * CallerIdProfile
 *
 * Admin-approved outbound caller ID number override for a user.
 *
 * Users may request one or more additional verified business numbers
 * beyond their personal mobile; an admin must approve each profile
 * before it can be used on outbound PSTN calls.
 *
 * Anti-spoofing guarantee: the approval step is the server-side gate.
 * Only approved profiles are returned by selectCallerId().
 *
 * At most one profile per (userId, number) pair (unique index).
 * If isDefault=true on multiple records for the same user, the selector
 * picks the most recently updated one — callers should keep at most one
 * default per user.
 */
import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICallerIdProfile extends Document<string> {
  _id:       string;
  userId:    string;
  number:    string;
  name:      string;
  status:    "pending" | "approved" | "rejected";
  reason?:   string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CallerIdProfileSchema = new Schema<ICallerIdProfile>(
  {
    _id:       { type: String, required: true },
    userId:    { type: String, required: true, index: true },
    number:    { type: String, required: true },
    name:      { type: String, required: true },
    status:    { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reason:    { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, _id: false },
);

CallerIdProfileSchema.index({ userId: 1, number: 1 }, { unique: true });
CallerIdProfileSchema.index({ userId: 1, isDefault: 1 });

export const CallerIdProfileModel: Model<ICallerIdProfile> =
  mongoose.models.CallerIdProfile ||
  mongoose.model<ICallerIdProfile>("CallerIdProfile", CallerIdProfileSchema);
