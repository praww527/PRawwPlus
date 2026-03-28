import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Persisted when the in-memory ESL buffer exhausts retries or the handler throws.
 * A reconciliation worker replays these so hangup billing is not silently lost.
 */
export interface IPendingEslEvent extends Document<string> {
  _id: string;
  fsCallId: string;
  /** Same labels as eslEventBuffer enqueue */
  label: "CHANNEL_HANGUP_COMPLETE" | "CHANNEL_ANSWER" | "CHANNEL_ORIGINATE";
  /** Serialized replay payload (hangup billsec/cause, answer legs, originate legs) */
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "dead";
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PendingEslEventSchema = new Schema<IPendingEslEvent>(
  {
    _id: { type: String, required: true },
    fsCallId: { type: String, required: true, index: true },
    label: {
      type: String,
      required: true,
      enum: ["CHANNEL_HANGUP_COMPLETE", "CHANNEL_ANSWER", "CHANNEL_ORIGINATE"],
    },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "processed", "dead"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
  },
  { timestamps: true, _id: false },
);

PendingEslEventSchema.index({ status: 1, createdAt: 1 });

export const PendingEslEventModel: Model<IPendingEslEvent> =
  mongoose.models.PendingEslEvent ||
  mongoose.model<IPendingEslEvent>("PendingEslEvent", PendingEslEventSchema);
