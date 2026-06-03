/**
 * Call Queue Engine — Phase 2
 *
 * Manages in-memory queue state for active callers waiting for an agent.
 * Integrates with FreeSWITCH via ESL to:
 *   - Track queue depth and wait times
 *   - Select next available agent based on strategy
 *   - Trigger queue position announcements
 *   - Handle overflow/timeout routing
 *   - Emit real-time stats for the Operations Center SSE stream
 */

import { connectDB } from "@workspace/db";
import { CallQueueModel, type ICallQueue, type QueueStrategy } from "@workspace/db";
import { logger } from "./logger";
import { broadcastSseEvent } from "./adminBroadcast";

export interface QueuedCaller {
  callerId:    string;
  fsCallId:    string;
  queueId:     string;
  queueName:   string;
  enqueuedAt:  number;
  position:    number;
  attempts:    number;
  lastAnnounce: number;
}

export interface QueueStats {
  queueId:       string;
  queueName:     string;
  depth:         number;
  avgWaitSec:    number;
  longestWaitSec: number;
  agentsAvail:   number;
  agentsBusy:    number;
  agentsPaused:  number;
  callsHandled:  number;
  callsAbandoned: number;
  callsOverflowed: number;
}

const queues     = new Map<string, QueuedCaller[]>();
const queueStats = new Map<string, QueueStats>();
const agentCallCounts = new Map<string, number>();
const agentLastCall   = new Map<string, number>();

let nextAgentIndex = 0;

export function enqueue(caller: Omit<QueuedCaller, "position" | "attempts" | "lastAnnounce">): QueuedCaller {
  const list = queues.get(caller.queueId) ?? [];
  const entry: QueuedCaller = {
    ...caller,
    position:    list.length + 1,
    attempts:    0,
    lastAnnounce: 0,
  };
  list.push(entry);
  queues.set(caller.queueId, list);

  const stats = getOrInitStats(caller.queueId, caller.queueName);
  stats.depth = list.length;
  broadcastQueueUpdate(caller.queueId);
  logger.info({ queueId: caller.queueId, callerId: caller.callerId, position: entry.position }, "[queue] Caller enqueued");
  return entry;
}

export function dequeue(queueId: string, fsCallId: string, reason: "answered" | "abandoned" | "overflow" | "timeout"): boolean {
  const list = queues.get(queueId);
  if (!list) return false;

  const idx = list.findIndex((c) => c.fsCallId === fsCallId);
  if (idx === -1) return false;

  list.splice(idx, 1);
  list.forEach((c, i) => { c.position = i + 1; });
  queues.set(queueId, list);

  const stats = getOrInitStats(queueId, "");
  stats.depth = list.length;
  if (reason === "abandoned")  stats.callsAbandoned++;
  if (reason === "overflow")   stats.callsOverflowed++;
  if (reason === "answered")   stats.callsHandled++;

  broadcastQueueUpdate(queueId);
  logger.info({ queueId, fsCallId, reason }, "[queue] Caller dequeued");
  return true;
}

export function getQueueDepth(queueId: string): number {
  return queues.get(queueId)?.length ?? 0;
}

export function getCallerPosition(queueId: string, fsCallId: string): number {
  return queues.get(queueId)?.find((c) => c.fsCallId === fsCallId)?.position ?? -1;
}

export function selectNextAgent(queue: ICallQueue): ICallQueue["agents"][number] | null {
  const available = queue.agents.filter((a) => !a.paused);
  if (!available.length) return null;

  switch (queue.strategy as QueueStrategy) {
    case "ring-all":
      return available[0];
    case "round-robin": {
      const agent = available[nextAgentIndex % available.length];
      nextAgentIndex = (nextAgentIndex + 1) % available.length;
      return agent;
    }
    case "least-recent": {
      return available.reduce((best, a) => {
        const t = agentLastCall.get(a.userId) ?? 0;
        const bestT = agentLastCall.get(best.userId) ?? 0;
        return t < bestT ? a : best;
      }, available[0]);
    }
    case "fewest-calls": {
      return available.reduce((best, a) => {
        const c = agentCallCounts.get(a.userId) ?? 0;
        const bestC = agentCallCounts.get(best.userId) ?? 0;
        return c < bestC ? a : best;
      }, available[0]);
    }
    case "random":
      return available[Math.floor(Math.random() * available.length)];
    default:
      return available[0];
  }
}

export function recordAgentCall(agentId: string): void {
  agentCallCounts.set(agentId, (agentCallCounts.get(agentId) ?? 0) + 1);
  agentLastCall.set(agentId, Date.now());
}

export function getAllQueueStats(): QueueStats[] {
  const now = Date.now();
  const result: QueueStats[] = [];

  for (const [queueId, list] of queues) {
    const s = getOrInitStats(queueId, "");
    const waitTimes = list.map((c) => (now - c.enqueuedAt) / 1000);
    s.depth          = list.length;
    s.avgWaitSec     = waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;
    s.longestWaitSec = waitTimes.length ? Math.round(Math.max(...waitTimes)) : 0;
    result.push({ ...s });
  }

  return result;
}

export async function resolveQueue(extension: number): Promise<ICallQueue | null> {
  try {
    await connectDB();
    return await CallQueueModel.findOne({ extension, active: true }).lean();
  } catch (err) {
    logger.error({ err, extension }, "[queue] resolveQueue failed");
    return null;
  }
}

function getOrInitStats(queueId: string, name: string): QueueStats {
  if (!queueStats.has(queueId)) {
    queueStats.set(queueId, {
      queueId,
      queueName:       name,
      depth:           0,
      avgWaitSec:      0,
      longestWaitSec:  0,
      agentsAvail:     0,
      agentsBusy:      0,
      agentsPaused:    0,
      callsHandled:    0,
      callsAbandoned:  0,
      callsOverflowed: 0,
    });
  }
  return queueStats.get(queueId)!;
}

function broadcastQueueUpdate(queueId: string): void {
  const stats = getAllQueueStats();
  broadcastSseEvent("queue-update", { queueId, stats, ts: Date.now() });
}

// Periodic stats broadcast for SSE clients
setInterval(() => {
  const stats = getAllQueueStats();
  if (stats.length > 0) {
    broadcastSseEvent("queue-stats", { stats, ts: Date.now() });
  }
}, 10_000);
