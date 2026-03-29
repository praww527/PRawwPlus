import mongoose, { Schema, Document, Model } from "mongoose";

export interface IInvoiceLine {
  description: string;
  coins: number;
  callId?: string;
  cdrId?: string;
}

export interface IInvoice extends Document<string> {
  _id: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  totalCoins: number;
  lines: IInvoiceLine[];
  status: "draft" | "final";
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceLineSchema = new Schema<IInvoiceLine>(
  {
    description: { type: String, required: true },
    coins: { type: Number, required: true },
    callId: { type: String },
    cdrId: { type: String },
  },
  { _id: false },
);

const InvoiceSchema = new Schema<IInvoice>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    totalCoins: { type: Number, default: 0 },
    lines: { type: [InvoiceLineSchema], default: [] },
    status: { type: String, enum: ["draft", "final"], default: "draft" },
  },
  { timestamps: true, _id: false },
);

InvoiceSchema.index({ userId: 1, periodStart: -1 }, { unique: true });

export const InvoiceModel: Model<IInvoice> =
  mongoose.models.Invoice || mongoose.model<IInvoice>("Invoice", InvoiceSchema);
