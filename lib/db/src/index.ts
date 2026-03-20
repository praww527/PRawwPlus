import mongoose from "mongoose";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set.");
}

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGODB_URI!);
  isConnected = true;
}

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
  isConnected = false;
});

export * from "./models/User";
export * from "./models/Session";
export * from "./models/Call";
export * from "./models/Payment";
