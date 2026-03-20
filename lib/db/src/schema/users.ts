import { pgTable, varchar, text, real, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email"),
  username: text("username"),
  name: text("name"),
  profileImage: text("profile_image"),
  creditBalance: real("credit_balance").notNull().default(0),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  subscriptionPlan: text("subscription_plan").default("basic"),
  lastPaymentDate: timestamp("last_payment_date"),
  nextPaymentDate: timestamp("next_payment_date"),
  totalCallsUsed: integer("total_calls_used").notNull().default(0),
  totalCreditUsed: real("total_credit_used").notNull().default(0),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
