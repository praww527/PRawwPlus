/**
 * In-memory ring buffer for recent server-side errors.
 * Populated by the global Express error handler; read by /admin/app-errors.
 * Max 200 entries — oldest are silently dropped.
 */

export interface AppErrorEntry {
  id:        string;
  timestamp: string;
  message:   string;
  stack?:    string;
  path?:     string;
  method?:   string;
}

const MAX_ENTRIES = 200;
const buffer: AppErrorEntry[] = [];
let seq = 0;

/** Capture an unhandled Express error into the ring buffer. */
export function captureError(
  err: Error | unknown,
  req?: { path?: string; method?: string },
): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const entry: AppErrorEntry = {
    id:        `${Date.now()}-${++seq}`,
    timestamp: new Date().toISOString(),
    message:   e.message || "Unknown error",
    stack:     e.stack,
    path:      req?.path,
    method:    req?.method?.toUpperCase(),
  };
  buffer.unshift(entry);          // newest first
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
}

/** Return the N most recent errors (default 50). */
export function getRecentErrors(limit = 50): AppErrorEntry[] {
  return buffer.slice(0, Math.min(limit, buffer.length));
}

/** Clear all stored errors (called from admin clear endpoint). */
export function clearErrorStore(): void {
  buffer.length = 0;
}
