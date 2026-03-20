import { type Request, type Response, type NextFunction } from "express";
import { clearSession, getSessionId, getSession, type SessionUser } from "../lib/auth";

declare global {
  namespace Express {
    interface User extends SessionUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  try {
    const session = await getSession(sid);
    if (!session?.user?.id) {
      try { await clearSession(res, sid); } catch {}
      next();
      return;
    }
    req.user = session.user;
  } catch {
    // DB unavailable — proceed as unauthenticated
  }

  next();
}
