import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISession extends Document {
  sid: string;
  sess: Record<string, unknown>;
  expire: Date;
}

const SessionSchema = new Schema<ISession>({
  sid: { type: String, required: true, unique: true },
  sess: { type: Schema.Types.Mixed, required: true },
  expire: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const SessionModel: Model<ISession> =
  mongoose.models.Session || mongoose.model<ISession>("Session", SessionSchema);
