import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { getTrustedClientIp } from "./lib/clientIp";

const app: Express = express();

// When behind Render/nginx, set TRUST_PROXY=1 so req.ip / X-Forwarded-For are trusted
// for PayFast IP checks. Leave unset in direct-exposed dev to prevent header spoofing.
app.set(
  "trust proxy",
  process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
);

// In production, serve the pre-built frontend from the same process.
// STATIC_DIR env var can override. Default resolves relative to cwd (repo root).
const staticDirFromCwd = path.resolve(process.cwd(), "artifacts", "call-manager", "dist", "public");
// When running the bundled server (dist/index.cjs), the working directory may
// not be the repo root. Derive a fallback from the entry script location.
const entryDir = process.argv[1] ? path.dirname(process.argv[1]) : process.cwd();
const staticDirFromEntry = path.resolve(entryDir, "..", "..", "call-manager", "dist", "public");
const staticDir =
  process.env.STATIC_DIR ??
  (fs.existsSync(staticDirFromCwd) ? staticDirFromCwd : staticDirFromEntry);

// APP_URL (e.g. https://rtc.PRaww.co.za) is the canonical production domain.
// ALLOWED_ORIGINS overrides everything — comma-separated list for multi-domain setups.
const appUrlRaw = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins: string[] = [];
if (process.env.ALLOWED_ORIGINS) {
  // Explicit override — use exactly what was provided (comma-separated list).
  allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()));
} else if (isProduction && appUrlRaw) {
  // Production only: restrict CORS to the configured APP_URL domain.
  allowedOrigins.push(appUrlRaw);
}
// In development (NODE_ENV !== "production"), allowedOrigins stays empty —
// the CORS handler below treats an empty list as "allow all origins".
// This lets the Vite dev server preview work from any hostname.

// CSP connect-src: allow wss:// on the same canonical domain for the Verto proxy.
const fsWsOrigins: string[] = [];
if (appUrlRaw) {
  fsWsOrigins.push(appUrlRaw.replace(/^https?:\/\//, "wss://"));
} else {
  const fsWsUrl = process.env.FREESWITCH_WS_URL ?? "";
  if (fsWsUrl) {
    try {
      const u = new URL(fsWsUrl);
      fsWsOrigins.push(`${u.protocol}//${u.host}`);
    } catch {
      logger.warn({ fsWsUrl }, "[CSP] Invalid FREESWITCH_WS_URL — skipping wss connect-src");
    }
  }
}
const fsWsOrigin = fsWsOrigins.join(" ");

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
    const ip = getTrustedClientIp(req) || "unknown";
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
  // SPA fallback — return index.html for client-side routes, but never for
  // asset URLs (js/css/etc) and never for /api.
  // Express 5 uses path-to-regexp v6; use the "/*" equivalent wildcard syntax.
  app.get("/{*path}", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    // If the request looks like an asset (has a file extension), don't serve index.
    if (path.extname(req.path)) {
      res.status(404).end();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
