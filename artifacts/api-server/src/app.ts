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

// When behind Oracle VPS nginx, set TRUST_PROXY=1 so req.ip / X-Forwarded-For are trusted
// for PayFast IP checks. Leave unset in direct-exposed dev to prevent header spoofing.
app.set(
  "trust proxy",
  process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
);

// In production, serve the pre-built frontend from the same process.
// STATIC_DIR env var can override. Default resolves relative to cwd (repo root).
function findStaticDirFromRoot(root: string): string {
  return path.resolve(root, "artifacts", "prawwplus", "dist", "public");
}

function resolveStaticDir(): string {
  if (process.env.STATIC_DIR) return process.env.STATIC_DIR;

  // Oracle VPS may start the server with a cwd that is *not* the repo root
  // (e.g. artifacts/api-server). Try a few likely roots.
  const cwd = process.cwd();
  const candidates: string[] = [
    findStaticDirFromRoot(cwd),
    findStaticDirFromRoot(path.resolve(cwd, "..")),
    findStaticDirFromRoot(path.resolve(cwd, "..", "..")),
  ];

  // When running the bundled server (dist/index.cjs), derive a repo-root-ish
  // directory from the entry script location as another fallback.
  const entryDir = process.argv[1] ? path.dirname(process.argv[1]) : cwd;
  const entryRoot = path.resolve(entryDir, "..", "..", "..");
  candidates.push(findStaticDirFromRoot(entryRoot));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Last resort: keep the original cwd-based guess (even if missing) so errors are obvious.
  return candidates[0];
}

const staticDir = resolveStaticDir();
const staticIndexPath = path.join(staticDir, "index.html");

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
  logger.info(
    {
      staticDir,
      staticIndexPath,
      indexExists: fs.existsSync(staticIndexPath),
    },
    "Static frontend configured",
  );

  app.use(express.static(staticDir));

  // SPA fallback — return index.html for client-side routes, but never for
  // asset URLs (js/css/etc) and never for /api.
  // Use a regex route to avoid Express 5 wildcard path-to-regexp edge-cases.
  app.get(/^(?!\/api\/).*/, (req: Request, res: Response, next: NextFunction) => {
    // If the request looks like an asset (has a file extension), do not serve index.
    if (path.extname(req.path)) {
      next();
      return;
    }
    if (!fs.existsSync(staticIndexPath)) {
      logger.error({ staticDir, staticIndexPath }, "Static index.html not found — frontend build missing");
      res.status(503).json({ error: "Frontend not built", staticDir });
      return;
    }
    res.sendFile(staticIndexPath);
  });
}

// Global Express error handler — catches any error passed to next(err) or thrown
// inside async route handlers (Express 5 wraps async throws automatically).
// Without this, unhandled errors write a stack trace to stdout and may leave
// the response hanging (no status sent to the client).
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, "Unhandled Express error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
