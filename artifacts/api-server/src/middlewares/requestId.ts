import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.requestId = (req.headers["x-request-id"] as string) || randomUUID();
  next();
}
