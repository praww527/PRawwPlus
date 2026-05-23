/**
 * sessionId — stable UUID generated once per browser session.
 *
 * Stored in sessionStorage so it survives page refreshes within the same tab
 * but resets when the tab is closed. Used for distributed tracing:
 * correlates frontend API requests → Verto WebSocket connection → CallEvent rows.
 *
 * Included as X-Session-ID on every fetch() via the apiFetch wrapper.
 */

const KEY = "prawwplus_session_id";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getOrCreate(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = generateUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return generateUUID();
  }
}

export const sessionId: string = getOrCreate();
