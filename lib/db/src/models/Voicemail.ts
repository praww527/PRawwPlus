/**
 * Voicemail — persisted voicemail recording metadata.
 *
 * Created when a call transitions to "voicemail" status in the orchestrator.
 * The actual audio file is stored on the FreeSWITCH server; this record holds
 * the metadata needed for inbox display and playback URL resolution.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

export interface IVoicemail extends Document<string> {
  _id: string;
  callId: string;
  userId: string;       // owner (the callee who received the voicemail)
  fromNumber?: string;  // caller number or extension
  fromExtension?: number;
  extension?: number;   // destination extension (callee)
  recordingPath?: string; // path on FS server
  duration: number;       // seconds
  read: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VoicemailSchema = new Schema<IVoicemail>(
  {
    _id:           { type: String, required: true },
    callId:        { type: String, required: true, index: true },
    userId:        { type: String, required: true, index: true },
    fromNumber:    { type: String },
    fromExtension: { type: Number },
    extension:     { type: Number },
    recordingPath: { type: String },
    duration:      { type: Number, default: 0 },
    read:          { type: Boolean, default: false, index: true },
    readAt:        { type: Date },
  },
  { timestamps: true, _id: false },
);

VoicemailSchema.index({ userId: 1, createdAt: -1 });
VoicemailSchema.index({ userId: 1, read: 1 });

export const VoicemailModel: Model<IVoicemail> =
  mongoose.models.Voicemail || mongoose.model<IVoicemail>("Voicemail", VoicemailSchema);
