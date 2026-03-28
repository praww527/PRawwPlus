/**
 * ESL event buffer — ordered processing with retry. Durable persistence hooks
 * into MongoDB when retries exhaust or the handler throws (see PendingEslEvent).
 */

import { randomUUID } from "crypto";
import { connectDB, PendingEslEventModel } from "@workspace/db";
import { logger } from "./logger";

export const enum EventResult {
  DONE  = "done",
  RETRY = "retry",
}

type EventHandler = () => Promise<EventResult>;

/** Data required to replay a dropped event from the worker */
export type DurableEslPayload = {
  billsec?: number;
  hangupCause?: string;
  otherLegId?: string;
  /** CHANNEL_ORIGINATE */
  bLegUuid?: string;
  aLegUuid?: string;
};

interface QueuedEvent {
  fsCallId:    string;
  handler:     EventHandler;
  label:       string;
  attempt:     number;
  retryTimer?: ReturnType<typeof setTimeout>;
  durable?:    DurableEslPayload;
}

const MAX_RETRIES   = 5;
const BASE_DELAY_MS = 200;

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
  events.shift();
  if (events.length === 0) queue.delete(fsCallId);
}

async function persistDurable(ev: QueuedEvent, reason: string): Promise<void> {
  if (!ev.durable) return;
  try {
    await connectDB();
    const label = ev.label as "CHANNEL_HANGUP_COMPLETE" | "CHANNEL_ANSWER" | "CHANNEL_ORIGINATE";
    if (
      label !== "CHANNEL_HANGUP_COMPLETE" &&
      label !== "CHANNEL_ANSWER" &&
      label !== "CHANNEL_ORIGINATE"
    ) {
      return;
    }
    await PendingEslEventModel.create({
      _id:      randomUUID(),
      fsCallId: ev.fsCallId,
      label,
      payload:  { ...ev.durable, _persistReason: reason },
      status:   "pending",
      attempts: 0,
    });
    logger.info({ fsCallId: ev.fsCallId, label }, "[ESLBuffer] Persisted dropped event for reconciliation");
  } catch (err) {
    logger.error(
      { err, fsCallId: ev.fsCallId, label: ev.label },
      "[ESLBuffer] CRITICAL: failed to persist durable ESL event",
    );
  }
}

async function processEvent(ev: QueuedEvent): Promise<void> {
  let result: EventResult;
  try {
    result = await ev.handler();
  } catch (err) {
    logger.error({ err, fsCallId: ev.fsCallId, label: ev.label, attempt: ev.attempt },
      "[ESLBuffer] Handler threw — persisting durable payload if any");
    await persistDurable(ev, `handler_throw:${String(err)}`);
    dequeue(ev.fsCallId);
    return;
  }

  if (result === EventResult.DONE) {
    logger.debug({ fsCallId: ev.fsCallId, label: ev.label, attempt: ev.attempt },
      "[ESLBuffer] Event processed OK");
    dequeue(ev.fsCallId);

    const remaining = queue.get(ev.fsCallId);
    if (remaining && remaining.length > 0) {
      setImmediate(() => processEvent(remaining[0]));
    }
    return;
  }

  ev.attempt++;
  if (ev.attempt > MAX_RETRIES) {
    const billingRisk = ev.label === "CHANNEL_HANGUP_COMPLETE";
    logger.warn(
      {
        fsCallId: ev.fsCallId,
        label:    ev.label,
        maxRetries: MAX_RETRIES,
        billingRisk,
      },
      billingRisk
        ? "[ESLBuffer] CRITICAL: hangup max retries — persisting for reconciliation"
        : "[ESLBuffer] Max retries exceeded — persisting / dropping ESL event",
    );
    await persistDurable(ev, "max_retries");
    dequeue(ev.fsCallId);
    return;
  }

  const delay = BASE_DELAY_MS * Math.pow(2, ev.attempt - 1);
  logger.warn({ fsCallId: ev.fsCallId, label: ev.label, attempt: ev.attempt, delayMs: delay },
    "[ESLBuffer] DB record not found — retrying ESL event after delay");

  ev.retryTimer = setTimeout(() => processEvent(ev), delay);
}

/**
 * Enqueue an ESL event. Pass `durable` for payloads that must survive process
 * restarts (recommended for all production call legs).
 */
export function enqueueEslEvent(
  fsCallId: string,
  label: string,
  handler: EventHandler,
  durable?: DurableEslPayload,
): void {
  const ev: QueuedEvent = { fsCallId, handler, label, attempt: 1, durable };

  const existing = queue.get(fsCallId);
  if (existing && existing.length > 0) {
    existing.push(ev);
    logger.debug({ fsCallId, label, queueDepth: existing.length },
      "[ESLBuffer] Event queued behind in-flight event");
    return;
  }

  queue.set(fsCallId, [ev]);
  setImmediate(() => processEvent(ev));
}

export function eslBufferDepth(): number {
  let total = 0;
  for (const events of queue.values()) total += events.length;
  return total;
}
