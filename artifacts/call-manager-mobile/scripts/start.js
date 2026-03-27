#!/usr/bin/env node
/**
 * Start script — wraps `expo start` and ensures PORT has a sensible fallback.
 * Binds to 0.0.0.0 so the Replit port health-check can reach it.
 */
const { spawn } = require("child_process");

const port = process.env.PORT || "8081";

// Build the env, forwarding all Expo-related vars
const env = { ...process.env, PORT: port };

// --host 0.0.0.0 ensures Metro actually binds on all interfaces so that
// Replit's port health-check can confirm the server is up.
const child = spawn(
  "pnpm",
  ["exec", "expo", "start", "--port", port, "--host", "localhost"],
  { stdio: "inherit", env },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error("Failed to start Expo:", err);
  process.exit(1);
});
