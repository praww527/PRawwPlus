import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that enforces admin-only access.
 *
 * Returns 401 when the request has no authenticated session.
 * Returns 403 when the authenticated user is not an admin.
 * Calls next() when the user is authenticated and has isAdmin=true.
 *
 * Usage:
 *   router.get("/admin/something", requireAdmin, handler);
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!(req as any).isAuthenticated?.()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(req as any).user?.isAdmin) {
    res.status(403).json({ error: "Forbidden", message: "Admin access required" });
    return;
  }
  next();
}
