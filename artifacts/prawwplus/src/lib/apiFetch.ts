/**
 * apiFetch — drop-in replacement for fetch() that automatically injects
 * distributed-tracing headers on every request:
 *
 *   X-Session-ID   Stable tab-scoped UUID (sessionId) — correlates all
 *                  requests from this browser session in server logs.
 *   X-Request-ID   Per-request UUID — used as traceId in CallEvent rows.
 *
 * Usage:
 *   import { apiFetch } from "@/lib/apiFetch";
 *   const res = await apiFetch("/api/calls", { method: "POST", body: ... });
 */

import { sessionId } from "./sessionId";

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Session-ID", sessionId);
  headers.set("X-Request-ID", generateRequestId());
  return fetch(input, { ...init, headers });
}
