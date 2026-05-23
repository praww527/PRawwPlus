import mongoose, { Schema, Document, Model } from "mongoose";

export interface IIceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface IBlockedIp {
  ip: string;
  reason: string;
  expiresAt?: number;
}

export interface ISystemConfig extends Document<string> {
  _id: string;
  iceServers: IIceServer[];
  blockedIps: IBlockedIp[];
  updatedAt: Date;
  updatedBy?: string;
}

const IceServerSchema = new Schema<IIceServer>(
  {
    urls:       { type: String, required: true },
    username:   { type: String },
    credential: { type: String },
  },
  { _id: false },
);

const BlockedIpSchema = new Schema<IBlockedIp>(
  {
    ip:        { type: String, required: true },
    reason:    { type: String, required: true },
    expiresAt: { type: Number },
  },
  { _id: false },
);

const SystemConfigSchema = new Schema<ISystemConfig>(
  {
    _id:        { type: String, default: "singleton" },
    iceServers: { type: [IceServerSchema], default: [] },
    blockedIps: { type: [BlockedIpSchema], default: [] },
    updatedAt:  { type: Date, default: () => new Date() },
    updatedBy:  { type: String },
  },
  { _id: false },
);

export const SystemConfigModel: Model<ISystemConfig> =
  mongoose.models["SystemConfig"] ??
  mongoose.model<ISystemConfig>("SystemConfig", SystemConfigSchema);
