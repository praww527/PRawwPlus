import mongoose, { Schema, Document, Model } from "mongoose";

export type ExpenseType = "sms" | "server" | "api" | "infrastructure" | "other";

export interface IExpense extends Document<string> {
  _id: string;
  type: ExpenseType;
  amount: number;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    _id: { type: String, required: true },
    type: {
      type: String,
      enum: ["sms", "server", "api", "infrastructure", "other"],
      required: true,
    },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
  },
  { timestamps: true, _id: false }
);

export const ExpenseModel: Model<IExpense> =
  mongoose.models.Expense || mongoose.model<IExpense>("Expense", ExpenseSchema);
