import mongoose, { Schema, Document, Model } from "mongoose";

export type IvrNodeType =
  | "greeting"
  | "menu"
  | "transfer"
  | "queue"
  | "voicemail"
  | "hangup"
  | "condition"
  | "playback"
  | "input";

export interface IvrNode {
  id:        string;
  type:      IvrNodeType;
  label?:    string;
  audioFile?: string;
  ttsText?:  string;
  digits?:   Record<string, string>;
  timeout?:  number;
  maxRetries?: number;
  target?:   string;
  condition?: string;
  posX?:     number;
  posY?:     number;
}

export interface IIvrFlow extends Document<string> {
  _id:       string;
  name:      string;
  extension: number;
  description?: string;
  nodes:     IvrNode[];
  startNode: string;
  tenantId?: string;
  active:    boolean;
  createdAt: Date;
  updatedAt: Date;
}

const IvrNodeSchema = new Schema<IvrNode>(
  {
    id:         { type: String, required: true },
    type:       { type: String, enum: ["greeting","menu","transfer","queue","voicemail","hangup","condition","playback","input"], required: true },
    label:      { type: String },
    audioFile:  { type: String },
    ttsText:    { type: String },
    digits:     { type: Schema.Types.Mixed },
    timeout:    { type: Number, default: 5 },
    maxRetries: { type: Number, default: 3 },
    target:     { type: String },
    condition:  { type: String },
    posX:       { type: Number },
    posY:       { type: Number },
  },
  { _id: false },
);

const IvrFlowSchema = new Schema<IIvrFlow>(
  {
    _id:       { type: String, required: true },
    name:      { type: String, required: true },
    extension: { type: Number, required: true, unique: true },
    description: { type: String },
    nodes:     { type: [IvrNodeSchema], default: [] },
    startNode: { type: String, required: true },
    tenantId:  { type: String, index: true },
    active:    { type: Boolean, default: true },
  },
  { timestamps: true, _id: false },
);

export const IvrFlowModel: Model<IIvrFlow> =
  mongoose.models.IvrFlow || mongoose.model<IIvrFlow>("IvrFlow", IvrFlowSchema);
