import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  _id: string;
  email?: string;
  username?: string;
  name?: string;
  profileImage?: string;
  passwordHash?: string;
  emailVerified: boolean;
  verificationToken?: string;
  verificationTokenExpiry?: Date;
  resetPasswordToken?: string;
  resetPasswordTokenExpiry?: Date;
  coins: number;
  subscriptionStatus: string;
  subscriptionPlan: "basic" | "pro";
  subscriptionExpiresAt?: Date;
  lastPaymentDate?: Date;
  nextPaymentDate?: Date;
  totalCallsUsed: number;
  totalCoinsUsed: number;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, required: true },
    email: { type: String, index: true },
    username: { type: String },
    name: { type: String },
    profileImage: { type: String },
    passwordHash: { type: String },
    emailVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpiry: { type: Date },
    resetPasswordToken: { type: String },
    resetPasswordTokenExpiry: { type: Date },
    coins: { type: Number, default: 0 },
    subscriptionStatus: { type: String, default: "inactive" },
    subscriptionPlan: { type: String, default: "basic" },
    subscriptionExpiresAt: { type: Date },
    lastPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },
    totalCallsUsed: { type: Number, default: 0 },
    totalCoinsUsed: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true, _id: false }
);

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
