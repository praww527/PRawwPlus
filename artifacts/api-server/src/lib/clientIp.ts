import type { Request } from "express";

/**
 * Client IP for security checks (e.g. PayFast allowlist).
 * Only reads X-Forwarded-For when `trust proxy` is enabled on the app —
 * otherwise clients could spoof PayFast IPs.
 */
export function getTrustedClientIp(req: Request): string {
  if (req.app.get("trust proxy")) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "";
}
