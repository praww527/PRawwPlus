import mongoose, { Schema, Document, Model } from "mongoose";

export interface IOrganisation extends Document<string> {
  _id: string;
  name: string;
  ownerId: string;
  coins: number;
  totalCallsUsed: number;
  totalCoinsUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

const OrganisationSchema = new Schema<IOrganisation>(
  {
    _id:             { type: String, required: true },
    name:            { type: String, required: true },
    ownerId:         { type: String, required: true, index: true },
    coins:           { type: Number, default: 0 },
    totalCallsUsed:  { type: Number, default: 0 },
    totalCoinsUsed:  { type: Number, default: 0 },
  },
  { timestamps: true, _id: false },
);

export const OrganisationModel: Model<IOrganisation> =
  mongoose.models.Organisation || mongoose.model<IOrganisation>("Organisation", OrganisationSchema);
