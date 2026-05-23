/**
 * AlertRule — configurable threshold-based alert for platform health metrics.
 *
 * The alert worker evaluates each enabled rule every 60 seconds against
 * the in-memory MetricsStore and recent CallEvent data.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

export type AlertMetric =
  | "answer_rate"
  | "ice_failure_rate"
  | "ws_disconnect_rate"
  | "active_calls_drop"
  | "call_setup_latency_p95"
  | "registration_failure_rate"
  | "reconnect_failure_rate";

export type AlertCondition = "below" | "above";

export interface AlertChannel {
  slackWebhook?: string;
  webhookUrl?: string;
  emailTo?: string;
}

export interface IAlertRule extends Document<string> {
  _id: string;
  name: string;
  enabled: boolean;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  windowMinutes: number;
  channels: AlertChannel;
  cooldownMinutes: number;
  lastFiredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AlertRuleSchema = new Schema<IAlertRule>(
  {
    _id:            { type: String, required: true },
    name:           { type: String, required: true },
    enabled:        { type: Boolean, default: true },
    metric:         {
      type: String, required: true,
      enum: [
        "answer_rate", "ice_failure_rate", "ws_disconnect_rate",
        "active_calls_drop", "call_setup_latency_p95",
        "registration_failure_rate", "reconnect_failure_rate",
      ],
    },
    condition:      { type: String, enum: ["below", "above"], required: true },
    threshold:      { type: Number, required: true },
    windowMinutes:  { type: Number, default: 5 },
    channels:       { type: mongoose.Schema.Types.Mixed, default: {} },
    cooldownMinutes: { type: Number, default: 30 },
    lastFiredAt:    { type: Date },
  },
  { timestamps: true, _id: false, collection: "alertrules" },
);

AlertRuleSchema.index({ enabled: 1 });

export const AlertRuleModel: Model<IAlertRule> =
  mongoose.models.AlertRule ?? mongoose.model<IAlertRule>("AlertRule", AlertRuleSchema);
