import mongoose, { Schema, Document, Model } from "mongoose";

export interface INotificationPrefs {
  incomingCalls: boolean;
  missedCalls: boolean;
  voicemail: boolean;
  lowBalance: boolean;
  sms: boolean;
  promotions: boolean;
  weeklyReport: boolean;
  sound: boolean;
  vibration: boolean;
  badge: boolean;
  pushEnabled: boolean;
}

export interface IUser extends Document<string> {
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
  phone?: string;
  phoneVerified: boolean;
  phoneOtp?: string;
  phoneOtpExpiry?: Date;
  coins: number;
  ratePlanId?: string;
  lowBalanceThresholdCoins?: number;
  subscriptionStatus: string;
  subscriptionPlan: "basic" | "pro";
  subscriptionExpiresAt?: Date;
  lastPaymentDate?: Date;
  nextPaymentDate?: Date;
  totalCallsUsed: number;
  totalCoinsUsed: number;
  isAdmin: boolean;
  extension?: number;
  fsPassword?: string;
  ringtone: string;
  ringtoneDuration: number;
  dnd: boolean;
  callForwardAlwaysEnabled?: boolean;
  callForwardAlwaysTo?: string;
  callForwardBusyEnabled?: boolean;
  callForwardBusyTo?: string;
  callForwardNoAnswerEnabled?: boolean;
  callForwardNoAnswerTo?: string;
  callForwardUnavailableEnabled?: boolean;
  callForwardUnavailableTo?: string;
  freeswitchHost?: string;
  freeswitchPort?: number;
  expoPushToken?: string;
  fcmToken?: string;
  notificationPrefs: INotificationPrefs;
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
    phone: { type: String, sparse: true, unique: true, index: true },
    phoneVerified: { type: Boolean, default: false },
    phoneOtp: { type: String },
    phoneOtpExpiry: { type: Date },
    coins: { type: Number, default: 0 },
    ratePlanId: { type: String, index: true },
    lowBalanceThresholdCoins: { type: Number },
    subscriptionStatus: { type: String, default: "inactive" },
    subscriptionPlan: { type: String, default: "basic" },
    subscriptionExpiresAt: { type: Date },
    lastPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },
    totalCallsUsed: { type: Number, default: 0 },
    totalCoinsUsed: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    extension: { type: Number, sparse: true, unique: true },
    fsPassword: { type: String },
    ringtone: { type: String, default: "default" },
    ringtoneDuration: { type: Number, default: 30 },
    dnd: { type: Boolean, default: false },
    callForwardAlwaysEnabled: { type: Boolean, default: false },
    callForwardAlwaysTo: { type: String },
    callForwardBusyEnabled: { type: Boolean, default: false },
    callForwardBusyTo: { type: String },
    callForwardNoAnswerEnabled: { type: Boolean, default: false },
    callForwardNoAnswerTo: { type: String },
    callForwardUnavailableEnabled: { type: Boolean, default: false },
    callForwardUnavailableTo: { type: String },
    freeswitchHost: { type: String },
    freeswitchPort: { type: Number },
    expoPushToken: { type: String },
    fcmToken: { type: String },
    notificationPrefs: {
      type: new Schema({
        incomingCalls: { type: Boolean, default: true },
        missedCalls:   { type: Boolean, default: true },
        voicemail:     { type: Boolean, default: true },
        lowBalance:    { type: Boolean, default: true },
        sms:           { type: Boolean, default: false },
        promotions:    { type: Boolean, default: false },
        weeklyReport:  { type: Boolean, default: false },
        sound:         { type: Boolean, default: true },
        vibration:     { type: Boolean, default: true },
        badge:         { type: Boolean, default: true },
        pushEnabled:   { type: Boolean, default: false },
      }, { _id: false }),
      default: () => ({}),
    },
  },
  { timestamps: true, _id: false }
);

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
