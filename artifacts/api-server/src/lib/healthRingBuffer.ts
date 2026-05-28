/**
 * healthRingBuffer.ts
 *
 * A 60-slot circular buffer (one sample per reconciliation cycle, ~1/min) that
 * records live subsystem indicators.  Consumed by /admin/platform-health-history
 * and displayed as sparklines in the admin Platform Health panel.
 *
 * Pure in-memory — no imports from other project modules, no circular deps.
 */

export interface HealthSample {
  ts:             number;   // Unix ms
  eslConnected:   boolean;
  bufferDepth:    number;   // ESL in-flight event count
  staleTotal:     number;   // sum of stale calls closed in this cycle
  pendingCount:   number;   // pending ESL events before this cycle
  // Process metrics — used by sparklines in Platform Health tab
  heapUsedMb:     number;
  rssMb:          number;
  loopLagMs:      number;
  // Call / WS metrics — used by sparklines
  activeCalls:    number;
  wsVertoClients: number;
}

const MAX_SAMPLES = 60;
const ring: HealthSample[] = [];

export function pushHealthSample(sample: HealthSample): void {
  ring.push(sample);
  if (ring.length > MAX_SAMPLES) ring.shift();
}

export function getHealthHistory(): HealthSample[] {
  return ring.slice();
}
