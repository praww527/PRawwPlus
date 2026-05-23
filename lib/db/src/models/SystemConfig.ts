import mongoose, { Schema, Document, Model } from "mongoose";

export interface IIceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface ISystemConfig extends Document<string> {
  _id: string;
  iceServers: IIceServer[];
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

const SystemConfigSchema = new Schema<ISystemConfig>(
  {
    _id:       { type: String, default: "singleton" },
    iceServers: { type: [IceServerSchema], default: [] },
    updatedAt:  { type: Date, default: () => new Date() },
    updatedBy:  { type: String },
  },
  { _id: false },
);

export const SystemConfigModel: Model<ISystemConfig> =
  mongoose.models["SystemConfig"] ??
  mongoose.model<ISystemConfig>("SystemConfig", SystemConfigSchema);
