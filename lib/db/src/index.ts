import mongoose from "mongoose";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set.");
}

let connectionPromise: Promise<void> | null = null;
let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(process.env.MONGODB_URI!, {
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
