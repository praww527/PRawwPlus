import { randomUUID } from "crypto";
import type { Request } from "express";
import { AuditLogModel } from "@workspace/db";
import { logger } from "./logger";

export type AuditTargetType =
  | "user" | "payment" | "call" | "number"
  | "payout" | "announcement" | "system" | "other";

interface AuditOptions {
  action: string;
  targetType: AuditTargetType;
  targetId?: string;
  targetLabel?: string;
  details?: Record<string, unknown>;
}

/**
 * Write an immutable audit log entry for any sensitive admin action.
 * Fire-and-forget: errors are swallowed so they never block the HTTP response.
 */
export function logAdminAction(req: Request, opts: AuditOptions): void {
  const adminId    = req.user?.id ?? "unknown";
  const adminEmail = (req.user as any)?.email ?? undefined;
  const ip         = (req as any).requestId
    ? (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || (req as any).ip
    : (req as any).ip;
  const userAgent  = req.headers["user-agent"] ?? undefined;

  AuditLogModel.create({
    _id:         randomUUID(),
    adminId,
    adminEmail,
    action:      opts.action,
    targetType:  opts.targetType,
    targetId:    opts.targetId,
    targetLabel: opts.targetLabel,
    details:     opts.details ?? {},
    ip,
    userAgent,
  }).catch((err) => {
    logger.warn({ err: (err as Error).message }, "[audit] Failed to write audit log — non-fatal");
  });
}
