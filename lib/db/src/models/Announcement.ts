import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAnnouncement extends Document<string> {
  _id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "promo";
  target: "all" | "resellers" | "users";
  isActive: boolean;
  expiresAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    _id: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 2000 },
    type: { type: String, enum: ["info", "warning", "promo"], default: "info" },
    target: { type: String, enum: ["all", "resellers", "users"], default: "all" },
    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date },
    createdBy: { type: String, required: true },
  },
  { timestamps: true, _id: false },
);

export const AnnouncementModel: Model<IAnnouncement> =
  mongoose.models.Announcement ||
  mongoose.model<IAnnouncement>("Announcement", AnnouncementSchema);
