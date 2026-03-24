import mongoose from "mongoose";

let connectionPromise: Promise<void> | null = null;
let isConnected = false;

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
