import mongoose, { type Document, type Model } from "mongoose";

export interface IAuditLog extends Document {
  _id: string;
  adminId: string;
  adminEmail?: string;
  action: string;
  targetType: "user" | "payment" | "call" | "number" | "payout" | "announcement" | "system" | "other";
  targetId?: string;
  targetLabel?: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const AuditLogSchema = new mongoose.Schema<IAuditLog>(
  {
    _id:         { type: String, required: true },
    adminId:     { type: String, required: true, index: true },
    adminEmail:  { type: String },
    action:      { type: String, required: true, index: true },
    targetType:  { type: String, required: true, enum: ["user", "payment", "call", "number", "payout", "announcement", "system", "other"], index: true },
    targetId:    { type: String, index: true },
    targetLabel: { type: String },
    details:     { type: mongoose.Schema.Types.Mixed },
    ip:          { type: String },
    userAgent:   { type: String },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "auditlogs",
  },
);

// TTL: auto-delete audit logs older than 2 years
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 3600 });
// Compound index for the admin dashboard viewer (admin + time range)
AuditLogSchema.index({ adminId: 1, createdAt: -1 });
// Latest-first for the global feed
AuditLogSchema.index({ createdAt: -1 });

export const AuditLogModel: Model<IAuditLog> =
  mongoose.models.AuditLog ?? mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
