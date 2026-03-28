import { type Request, type Response, type NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets.entries()) {
    if (now > b.resetAt) buckets.delete(k);
  }
}, 60_000);

/**
 * Per-user sliding window (after authentication). Use on sensitive routes
 * together with IP-based limits in app.ts.
 */
export function userRateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      next();
      return;
    }
    const userId = req.user!.id;
    const key    = userId;
    const now    = Date.now();
    let entry    = buckets.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs };
      buckets.set(key, entry);
      next();
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: "Too many requests for this account. Please slow down." });
      return;
    }
    next();
  };
}
