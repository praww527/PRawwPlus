import mongoose from "mongoose";

let connectionPromise: Promise<void> | null = null;
let isConnected = false;

// ─── Slow-query plugin ───────────────────────────────────────────────────────
// Applied globally before any model is compiled so every schema inherits it.
// Emits a structured warning whenever a query or save exceeds SLOW_MS.
// Uses console.warn so lib/db stays free of extra runtime dependencies;
// the API server's pino transport intercepts console output in production.
const SLOW_MS = Number(process.env.SLOW_QUERY_MS ?? 500);

mongoose.plugin((schema: mongoose.Schema) => {
  function markStart(this: any) { this._t = Date.now(); }
  function checkSlow(this: any, _result: unknown, next?: () => void) {
    const elapsed = Date.now() - (this._t ?? Date.now());
    if (elapsed >= SLOW_MS) {
      const collection =
        (this as any)?.model?.collection?.name ??
        (this as any)?.constructor?.modelName ??
        "unknown";
      const op = (this as any).op ?? (this as any)._op ?? "unknown";
      console.warn(JSON.stringify({ level: "warn", msg: "[db] Slow query", ms: elapsed, collection, op }));
    }
    if (typeof next === "function") next();
  }

  const queryMethods = [
    "find", "findOne", "findOneAndUpdate", "updateOne", "updateMany",
    "deleteOne", "deleteMany", "countDocuments", "aggregate", "distinct",
  ] as const;
  queryMethods.forEach((m) => {
    schema.pre(m as any, markStart);
    schema.post(m as any, checkSlow);
  });
  schema.pre("save", markStart);
  schema.post("save", checkSlow);
});

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  // Accept MONGO_URI or MONGODB_URI (either name works)
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      "No MongoDB connection string found. Set MONGODB_URI or MONGO_URI in the Secrets panel.",
    );
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 30000,
    })
    .then(() => {
      isConnected = true;
    })
    .catch((err) => {
      connectionPromise = null;
      isConnected = false;
      throw err;
    });

  return connectionPromise;
}

mongoose.connection.on("disconnected", () => {
  isConnected = false;
  connectionPromise = null;
});

mongoose.connection.on("error", () => {
  isConnected = false;
  connectionPromise = null;
});

export * from "./models/User";
export * from "./models/Session";
export * from "./models/Call";
export * from "./models/Payment";
export * from "./models/PhoneNumber";
export * from "./models/Contact";
export * from "./models/PendingEslEvent";
export * from "./models/RatePlan";
export * from "./models/BillingLedger";
export * from "./models/Cdr";
export * from "./models/Invoice";
export * from "./models/Earning";
export * from "./models/Expense";
export * from "./models/Payout";
export * from "./models/Announcement";
export * from "./models/AnnouncementView";
export * from "./models/AbuseFlag";
export * from "./models/AuditLog";
export * from "./models/SystemConfig";
export * from "./models/CallEvent";
export * from "./models/AlertRule";
export * from "./models/AlertEvent";
