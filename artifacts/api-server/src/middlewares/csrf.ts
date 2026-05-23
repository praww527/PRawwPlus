/**
 * Lightweight CSRF protection via the Synchronizer Token pattern.
 *
 * On GET /api/auth/csrf-token the client receives a token bound to its session.
 * Mutating requests (POST/PUT/PATCH/DELETE) must echo this token in the
 * X-CSRF-Token header OR as a JSON body field `_csrf`.
 *
 * Exempt paths: /api/auth/login, /api/auth/signup, /api/healthz*, /api/metrics,
 * /api/payments/notify (PayFast server-to-server webhook), /api/verto/ws,
 * /api/sip/ws — these cannot carry a CSRF token.
 */

import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";

const CSRF_COOKIE   = "csrf_token";
const CSRF_HEADER   = "x-csrf-token";
const CSRF_BODY_KEY = "_csrf";

const EXEMPT_METHODS  = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/phone/",
  "/api/payments/notify",
  "/api/verto/",
  "/api/sip/",
  "/api/healthz",
  "/api/metrics",
];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  // Ensure every response carries a fresh CSRF token cookie (SameSite=Strict)
  let token = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (!token || token.length < 32) {
    token = generateToken();
  }

  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: "strict",
    secure:   isSecure,
    path:     "/",
    maxAge:   2 * 60 * 60 * 1000,
  });

  if (EXEMPT_METHODS.has(req.method) || isExempt(req.path)) {
    next();
    return;
  }

  const provided =
    (req.headers[CSRF_HEADER] as string | undefined) ??
    (req.body?.[CSRF_BODY_KEY] as string | undefined);

  if (!provided || !crypto.timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(provided, "utf8"))) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}
