import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

// In production (Render), serve the pre-built frontend from the same process.
// STATIC_DIR env var can override. Default resolves relative to cwd (repo root).
const staticDir =
  process.env.STATIC_DIR ??
  path.resolve(process.cwd(), "artifacts", "call-manager", "dist", "public");

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : process.env.REPLIT_DOMAINS
    ? process.env.REPLIT_DOMAINS.split(",").map((d) => `https://${d.trim()}`)
    : [];

// Build the WebSocket origin for CSP connect-src so browsers allow the Verto WS
const fsWsUrl = process.env.FREESWITCH_WS_URL ?? "";
const fsWsOrigin = fsWsUrl
  ? (() => {
      try { return new URL(fsWsUrl).origin; } catch { return ""; }
    })()
  : "";

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  }),
);

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Relaxed CSP — the SPA loads scripts, fonts, and inline styles
  const connectSrc = ["'self'", fsWsOrigin].filter(Boolean).join(" ");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src ${connectSrc}; frame-ancestors 'none'`,
  );
  next();
});

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ??
      req.socket?.remoteAddress ??
      "unknown";
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 60_000);

app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));
app.use(authMiddleware);

app.use("/api/auth/login", rateLimit(10, 60_000));
app.use("/api/auth/signup", rateLimit(5, 60_000));
app.use("/api/auth/forgot-password", rateLimit(5, 60_000));
app.use("/api/auth/reset-password", rateLimit(5, 60_000));
app.use("/api", rateLimit(300, 60_000));

app.use("/api", router);

// Serve static frontend in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(staticDir));
  // SPA fallback — send index.html for any non-API route (Express 5 wildcard syntax)
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
