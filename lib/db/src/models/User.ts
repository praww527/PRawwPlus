import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  _id: string;
  email?: string;
  username?: string;
  name?: string;
  profileImage?: string;
  creditBalance: number;
  subscriptionStatus: string;
  subscriptionPlan?: string;
  lastPaymentDate?: Date;
  nextPaymentDate?: Date;
  totalCallsUsed: number;
  totalCreditUsed: number;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, required: true },
    email: { type: String },
    username: { type: String },
    name: { type: String },
    profileImage: { type: String },
    creditBalance: { type: Number, default: 0 },
    subscriptionStatus: { type: String, default: "inactive" },
    subscriptionPlan: { type: String, default: "basic" },
    lastPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },
    totalCallsUsed: { type: Number, default: 0 },
    totalCreditUsed: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true, _id: false }
);

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
