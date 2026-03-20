import { pgTable, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callsTable = pgTable("calls", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  callerNumber: text("caller_number"),
  recipientNumber: text("recipient_number").notNull(),
  status: text("status").notNull().default("initiated"),
  duration: integer("duration").notNull().default(0),
  cost: real("cost").notNull().default(0),
  telnyxCallId: text("telnyx_call_id"),
  notes: text("notes"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;
