/**
 * CallEvent — immutable append-only timeline of everything that happened
 * to a call: state transitions, ICE events, quality samples, reconnects.
 *
 * Used for:
 *  - Distributed tracing (correlate frontend session → WebSocket → FreeSWITCH UUID)
 *  - Call quality analytics (RTCPeerConnection stats samples)
 *  - Alert worker (answer-rate / ICE-failure-rate calculations)
 *  - Tenant-level analytics
 *
 * TTL: 90 days (index on ts).
 */

import mongoose, { Schema, Document, Model } from "mongoose";

export type CallEventType =
  | "initiated"
  | "ringing"
  | "answered"
  | "bridged"
  | "early_media"
  | "progress"
  | "failed"
  | "hangup"
  | "destroyed"
  | "bridge_timeout"
  | "disconnect"
  | "ice_failure"
  | "ice_success"
  | "reconnect_attempt"
  | "reconnect_success"
  | "reconnect_failed"
  | "quality_sample"
  | "media_timeout"
  | "registration_failure"
  | "voicemail"
  | "custom";

export interface ICallEvent extends Document<string> {
  _id: string;
  callId: string;
  fsCallId?: string;
  userId: string;
  tenantId?: string;
  sessionId?: string;
  traceId?: string;
  event: CallEventType;
  metadata?: Record<string, unknown>;
  ts: Date;
}

const CallEventSchema = new Schema<ICallEvent>(
  {
    _id:       { type: String, required: true },
    callId:    { type: String, required: true, index: true },
    fsCallId:  { type: String, index: true, sparse: true },
    userId:    { type: String, required: true, index: true },
    tenantId:  { type: String, index: true, sparse: true },
    sessionId: { type: String, sparse: true },
    traceId:   { type: String, sparse: true },
    event:     {
      type: String,
      required: true,
      enum: [
        "initiated", "ringing", "answered", "bridged", "early_media", "progress",
        "failed", "hangup", "destroyed", "bridge_timeout",
        "disconnect", "ice_failure", "ice_success", "reconnect_attempt",
        "reconnect_success", "reconnect_failed", "quality_sample",
        "media_timeout", "registration_failure", "voicemail", "custom",
      ],
      index: true,
    },
    metadata:  { type: mongoose.Schema.Types.Mixed },
    ts:        { type: Date, required: true, default: () => new Date() },
  },
  { _id: false, timestamps: false, collection: "callevents" },
);

// Timeline query: all events for a call in order
CallEventSchema.index({ callId: 1, ts: 1 });
// Alert worker: recent events of a given type across all calls
CallEventSchema.index({ event: 1, ts: -1 });
// Per-tenant analytics
CallEventSchema.index({ tenantId: 1, event: 1, ts: -1 });
// TTL: auto-delete after 90 days
CallEventSchema.index({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const CallEventModel: Model<ICallEvent> =
  mongoose.models.CallEvent ?? mongoose.model<ICallEvent>("CallEvent", CallEventSchema);
