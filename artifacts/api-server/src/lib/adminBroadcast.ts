/**
 * adminBroadcast — thin SSE broadcaster shared between routes and lib.
 *
 * Keeping this in `lib/` (not `routes/`) avoids circular import issues when
 * `lib/callOrchestrator.ts` needs to broadcast call-state events to admin
 * SSE clients registered in `routes/adminOps.ts`.
 */

import type { Response } from "express";

const sseClients = new Set<Response>();

/** Broadcast a typed SSE event to every connected admin client. */
export function broadcastSseEvent(type: string, data: unknown): void {
  if (sseClients.size === 0) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      (client as any).write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function addSseClient(res: Response): void {
  sseClients.add(res);
}

export function removeSseClient(res: Response): void {
  sseClients.delete(res);
}

export function getSseClientCount(): number {
  return sseClients.size;
}
