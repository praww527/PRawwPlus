/**
 * callEventLog — lightweight service for writing call lifecycle events to MongoDB.
 *
 * Designed to be called from:
 *  - callOrchestrator.ts (state transitions)
 *  - vertoProxy.ts       (ICE events, reconnects, WS disconnects)
 *  - API routes          (call initiation, quality samples)
 *
 * All writes are fire-and-forget (best-effort) to avoid adding latency to
 * the critical call path. Errors are logged but never thrown.
 */

import { randomUUID } from "crypto";
import { connectDB } from "@workspace/db";
import { CallEventModel, type CallEventType } from "@workspace/db";
import { logger } from "./logger";

export interface CallEventData {
  callId: string;
  fsCallId?: string;
  userId: string;
  tenantId?: string;
  sessionId?: string;
  traceId?: string;
  event: CallEventType;
  metadata?: Record<string, unknown>;
  ts?: Date;
}

/**
 * Append a single call event. Fire-and-forget — never throws.
 */
export async function appendCallEvent(data: CallEventData): Promise<void> {
  try {
    await connectDB();
    await CallEventModel.create({
      _id:       randomUUID(),
      callId:    data.callId,
      fsCallId:  data.fsCallId,
      userId:    data.userId,
      tenantId:  data.tenantId,
      sessionId: data.sessionId,
      traceId:   data.traceId,
      event:     data.event,
      metadata:  data.metadata,
      ts:        data.ts ?? new Date(),
    });
  } catch (err) {
    logger.warn({ err, event: data.event, callId: data.callId }, "[CallEventLog] Failed to append event");
  }
}

/**
 * Append multiple events atomically. Fire-and-forget.
 */
export async function appendCallEvents(events: CallEventData[]): Promise<void> {
  if (!events.length) return;
  try {
    await connectDB();
    await CallEventModel.insertMany(
      events.map((data) => ({
        _id:       randomUUID(),
        callId:    data.callId,
        fsCallId:  data.fsCallId,
        userId:    data.userId,
        tenantId:  data.tenantId,
        sessionId: data.sessionId,
        traceId:   data.traceId,
        event:     data.event,
        metadata:  data.metadata,
        ts:        data.ts ?? new Date(),
      })),
      { ordered: false },
    );
  } catch (err) {
    logger.warn({ err, count: events.length }, "[CallEventLog] Failed to batch-append events");
  }
}

/**
 * Retrieve the full event timeline for a call.
 */
export async function getCallEvents(callId: string, limit = 200) {
  await connectDB();
  return CallEventModel
    .find({ callId })
    .sort({ ts: 1 })
    .limit(limit)
    .lean();
}
