import mongoose, { Schema, Document, Model } from "mongoose";

export type QueueStrategy = "ring-all" | "round-robin" | "least-recent" | "fewest-calls" | "random";
export type QueueOverflowAction = "voicemail" | "hangup" | "transfer" | "ivr";

export interface IQueueAgent {
  userId:    string;
  extension: number;
  penalty:   number;
  paused:    boolean;
  pausedAt?: Date;
  pauseReason?: string;
}

export interface ICallQueue extends Document<string> {
  _id:             string;
  name:            string;
  extension:       number;
  description?:    string;
  strategy:        QueueStrategy;
  maxWaitSec:      number;
  maxQueueDepth:   number;
  announceFreqSec: number;
  musicOnHold?:    string;
  greetingFile?:   string;
  agents:          IQueueAgent[];
  overflowAction:  QueueOverflowAction;
  overflowTarget?: string;
  timeoutAction:   QueueOverflowAction;
  timeoutTarget?:  string;
  tenantId?:       string;
  active:          boolean;
  createdAt:       Date;
  updatedAt:       Date;
}

const QueueAgentSchema = new Schema<IQueueAgent>(
  {
    userId:      { type: String, required: true },
    extension:   { type: Number, required: true },
    penalty:     { type: Number, default: 0 },
    paused:      { type: Boolean, default: false },
    pausedAt:    { type: Date },
    pauseReason: { type: String },
  },
  { _id: false },
);

const CallQueueSchema = new Schema<ICallQueue>(
  {
    _id:             { type: String, required: true },
    name:            { type: String, required: true },
    extension:       { type: Number, required: true, unique: true },
    description:     { type: String },
    strategy:        { type: String, enum: ["ring-all","round-robin","least-recent","fewest-calls","random"], default: "round-robin" },
    maxWaitSec:      { type: Number, default: 120 },
    maxQueueDepth:   { type: Number, default: 20 },
    announceFreqSec: { type: Number, default: 30 },
    musicOnHold:     { type: String },
    greetingFile:    { type: String },
    agents:          { type: [QueueAgentSchema], default: [] },
    overflowAction:  { type: String, enum: ["voicemail","hangup","transfer","ivr"], default: "voicemail" },
    overflowTarget:  { type: String },
    timeoutAction:   { type: String, enum: ["voicemail","hangup","transfer","ivr"], default: "voicemail" },
    timeoutTarget:   { type: String },
    tenantId:        { type: String, index: true },
    active:          { type: Boolean, default: true },
  },
  { timestamps: true, _id: false },
);

export const CallQueueModel: Model<ICallQueue> =
  mongoose.models.CallQueue || mongoose.model<ICallQueue>("CallQueue", CallQueueSchema);
