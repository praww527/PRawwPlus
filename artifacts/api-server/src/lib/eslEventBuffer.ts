/**
 * ESL event buffer — zero event loss system.
 *
 * Problem: FreeSWITCH fires ESL events (CHANNEL_ANSWER, CHANNEL_HANGUP_COMPLETE,
 * CHANNEL_ORIGINATE) keyed by the Unique-ID (fsCallId). The matching DB call record
 * is created by the client via POST /calls just before dialling. In rare cases the
 * ESL event arrives on the socket before Mongoose has persisted the record, so
 * `CallModel.findOne({ fsCallId })` returns null and the event is silently dropped.
 *
 * Solution: when a handler returns `EventResult.RETRY` (record not found yet), the
 * event is queued and replayed with exponential back-off. After MAX_RETRIES the
 * event is logged and discarded so the queue never grows unbounded.
 *
 * Usage:
 *   eslEventBuffer.enqueue(fsCallId, async () => {
 *     const call = await CallModel.findOne({ fsCallId });
 *     if (!call) return EventResult.RETRY;       // not in DB yet — come back later
 *     await doSomething(call);
 *     return EventResult.DONE;
 *   });
 */

import { logger } from "./logger";

export const enum EventResult {
  DONE  = "done",
  RETRY = "retry",
}

type EventHandler = () => Promise<EventResult>;

interface QueuedEvent {
  fsCallId:    string;
  handler:     EventHandler;
  label:       string;
  attempt:     number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

const MAX_RETRIES   = 5;
const BASE_DELAY_MS = 200;

/** In-memory queue: fsCallId → ordered list of pending events */
const queue = new Map<string, QueuedEvent[]>();

function dequeue(fsCallId: string) {
  const events = queue.get(fsCallId);
  if (!events || events.length === 0) {
    queue.delete(fsCallId);
    return;
  }
  const ev = events[0];
  if (ev.retryTimer) {
    clearTimeout(ev.retryTimer);
    ev.retryTimer = undefined;
  }
  // Remove from front, process next
  events.shift();
  if (events.length === 0) queue.delete(fsCallId);
}

async function processEvent(ev: QueuedEvent): Promise<void> {
  let result: EventResult;
  try {
    result = await ev.handler();
  } catch (err) {
    logger.error({ err, fsCallId: ev.fsCallId, label: ev.label, attempt: ev.attempt },
      "[ESLBuffer] Handler threw — treating as final failure");
    dequeue(ev.fsCallId);
    return;
  }

  if (result === EventResult.DONE) {
    logger.debug({ fsCallId: ev.fsCallId, label: ev.label, attempt: ev.attempt },
      "[ESLBuffer] Event processed OK");
    dequeue(ev.fsCallId);

    // Process next queued event for this fsCallId (ordered processing)
    const remaining = queue.get(ev.fsCallId);
    if (remaining && remaining.length > 0) {
      setImmediate(() => processEvent(remaining[0]));
    }
    return;
  }

  // RETRY
  ev.attempt++;
  if (ev.attempt > MAX_RETRIES) {
    logger.warn({ fsCallId: ev.fsCallId, label: ev.label, maxRetries: MAX_RETRIES },
      "[ESLBuffer] Max retries exceeded — dropping event");
    dequeue(ev.fsCallId);
    return;
  }

  const delay = BASE_DELAY_MS * Math.pow(2, ev.attempt - 1);
  logger.debug({ fsCallId: ev.fsCallId, label: ev.label, attempt: ev.attempt, delayMs: delay },
    "[ESLBuffer] Retrying event after delay");

  ev.retryTimer = setTimeout(() => processEvent(ev), delay);
}

/**
 * Enqueue an ESL event handler for `fsCallId`.
 * Events for the same fsCallId are processed in FIFO order.
 * `label` is used only for logging.
 */
export function enqueueEslEvent(
  fsCallId: string,
  label: string,
  handler: EventHandler,
): void {
  const ev: QueuedEvent = { fsCallId, handler, label, attempt: 1 };

  const existing = queue.get(fsCallId);
  if (existing && existing.length > 0) {
    // Another event for this call is already in-flight — queue behind it
    existing.push(ev);
    logger.debug({ fsCallId, label, queueDepth: existing.length },
      "[ESLBuffer] Event queued behind in-flight event");
    return;
  }

  queue.set(fsCallId, [ev]);
  // Start immediately
  setImmediate(() => processEvent(ev));
}

/** How many calls currently have buffered/retrying events (for health checks) */
export function eslBufferDepth(): number {
  let total = 0;
  for (const events of queue.values()) total += events.length;
  return total;
}
