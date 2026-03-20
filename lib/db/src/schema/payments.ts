import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  amount: real("amount").notNull(),
  creditAdded: real("credit_added").notNull().default(0),
  status: text("status").notNull().default("pending"),
  paymentType: text("payment_type").notNull().default("subscription"),
  payfastPaymentId: text("payfast_payment_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
