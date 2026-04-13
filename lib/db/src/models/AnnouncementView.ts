import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAnnouncementView extends Document<string> {
  _id: string;
  announcementId: string;
  userId: string;
  viewedAt: Date;
}

const AnnouncementViewSchema = new Schema<IAnnouncementView>(
  {
    _id: { type: String, required: true },
    announcementId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    viewedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, _id: false },
);

AnnouncementViewSchema.index({ announcementId: 1, userId: 1 }, { unique: true });

export const AnnouncementViewModel: Model<IAnnouncementView> =
  mongoose.models.AnnouncementView ||
  mongoose.model<IAnnouncementView>("AnnouncementView", AnnouncementViewSchema);
