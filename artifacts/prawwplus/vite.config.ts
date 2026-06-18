import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// PORT is only needed for dev/preview — default to 3000 during build
const rawPort = process.env.PORT ?? "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// In production BASE_PATH isn't set — default to root "/"
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) return "react-vendor";
          if (id.includes("node_modules/wouter")) return "router";
          if (id.includes("node_modules/@tanstack/")) return "query";
          if (id.includes("node_modules/@radix-ui/")) return "radix";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "charts";
          if (id.includes("node_modules/jssip") || id.includes("node_modules/sip.js")) return "telephony";
          if (id.includes("node_modules/date-fns")) return "date-fns";
          if (id.includes("node_modules/")) return "vendor";
          if (id.includes("lib/api-client-react") || id.includes("lib/api-zod")) return "api-client";
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: process.env.API_HOST ?? `http://localhost:${process.env.API_PORT ?? 8080}`,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.API_HOST ?? `http://localhost:${process.env.API_PORT ?? 8080}`,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
