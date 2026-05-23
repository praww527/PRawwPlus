/**
 * AlertEvent — a fired alert instance, stored for the admin feed.
 * TTL: 30 days.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAlertEvent extends Document<string> {
  _id: string;
  ruleId: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number;
  condition: string;
  message: string;
  channels: string[];
  deliveryErrors?: Record<string, string>;
  firedAt: Date;
  resolvedAt?: Date;
}

const AlertEventSchema = new Schema<IAlertEvent>(
  {
    _id:            { type: String, required: true },
    ruleId:         { type: String, required: true, index: true },
    ruleName:       { type: String, required: true },
    metric:         { type: String, required: true },
    value:          { type: Number, required: true },
    threshold:      { type: Number, required: true },
    condition:      { type: String, required: true },
    message:        { type: String, required: true },
    channels:       [{ type: String }],
    deliveryErrors: { type: mongoose.Schema.Types.Mixed },
    firedAt:        { type: Date, required: true, default: () => new Date() },
    resolvedAt:     { type: Date },
  },
  { _id: false, timestamps: false, collection: "alertevents" },
);

AlertEventSchema.index({ firedAt: -1 });
// TTL: 30 days
AlertEventSchema.index({ firedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const AlertEventModel: Model<IAlertEvent> =
  mongoose.models.AlertEvent ?? mongoose.model<IAlertEvent>("AlertEvent", AlertEventSchema);
