/**
 * Call-end retry queue.
 *
 * When POST /calls/:id/end fails (network drop, server restart, app killed),
 * the request is persisted to AsyncStorage and replayed automatically on:
 *   - App returning to foreground  (AppState "active" event)
 *   - Network reconnecting         (networkMonitor "online" event)
 *   - Explicit flush call          (after a successful login / register)
 *
 * Each entry expires after 24 hours to prevent stale records.
 * After 10 failed attempts the entry is discarded to prevent queue bloat.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import { apiRequest } from "./api";
import { networkMonitor } from "./networkMonitor";

const QUEUE_KEY      = "call_end_queue_v1";
const MAX_AGE_MS     = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ATTEMPTS   = 10;

export interface QueuedEndCall {
  callId:    string;
  duration:  number;
  status:    string;
  queuedAt:  number;
  attempts:  number;
}

// ─── Persistence helpers ───────────────────────────────────────────────────

async function readQueue(): Promise<QueuedEndCall[]> {
  try {
    const json = await AsyncStorage.getItem(QUEUE_KEY);
    if (!json) return [];
    const items: QueuedEndCall[] = JSON.parse(json);
    const cutoff = Date.now() - MAX_AGE_MS;
    return items.filter((i) => i.queuedAt > cutoff);
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedEndCall[]): Promise<void> {
  try {
    if (items.length === 0) {
      await AsyncStorage.removeItem(QUEUE_KEY);
    } else {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    }
  } catch {}
}

// ─── Queue operations ──────────────────────────────────────────────────────

/**
 * Add a call-end request to the persistent queue.
 * Duplicate callIds are silently ignored (idempotent).
 */
export async function enqueueEndCall(
  callId:   string,
  duration: number,
  status:   string,
): Promise<void> {
  const queue = await readQueue();
  if (queue.some((i) => i.callId === callId)) return;
  queue.push({ callId, duration, status, queuedAt: Date.now(), attempts: 0 });
  await writeQueue(queue);
}

/** How many end-call requests are waiting to be delivered */
export async function pendingEndCallCount(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

// ─── Flush ─────────────────────────────────────────────────────────────────

let flushing = false;

/**
 * Attempt to deliver all queued end-call requests.
 * Safe to call concurrently — only one flush runs at a time.
 */
export async function flushEndCallQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await readQueue();
    if (queue.length === 0) return;

    const remaining: QueuedEndCall[] = [];

    for (const item of queue) {
      try {
        const res = await apiRequest(`/calls/${item.callId}/end`, {
          method: "POST",
          body: JSON.stringify({ duration: item.duration, status: item.status }),
        });

        if (res.ok) {
          // Delivered — discard
          continue;
        }

        if (res.status === 404 || res.status === 401) {
          // Record gone or session expired — discard permanently
          continue;
        }

        // Server error (5xx) — retry later
      } catch {
        // Network error — retry later
      }

      item.attempts++;
      if (item.attempts < MAX_ATTEMPTS) {
        remaining.push(item);
      }
    }

    await writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

// ─── Auto-flush wiring ─────────────────────────────────────────────────────

let appStateSubscription: { remove: () => void } | null = null;
let networkUnsubscribe:   (() => void) | null = null;

/**
 * Start listening for foreground events and network reconnections.
 * Call once at app startup (inside the root layout or CallProvider).
 */
export function startCallEndQueueListeners(): () => void {
  // Flush when app comes back to the foreground
  appStateSubscription = AppState.addEventListener(
    "change",
    (state: AppStateStatus) => {
      if (state === "active") {
        flushEndCallQueue().catch(() => {});
      }
    },
  );

  // Flush when network reconnects
  networkUnsubscribe = networkMonitor.addListener((state) => {
    if (state === "online") {
      flushEndCallQueue().catch(() => {});
    }
  });

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    networkUnsubscribe?.();
    networkUnsubscribe = null;
  };
}
