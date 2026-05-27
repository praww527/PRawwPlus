/**
 * processMetrics.ts — Node.js process-level health sampler.
 *
 * Samples every SAMPLE_INTERVAL_MS (default 10 s):
 *   - Heap usage (used/total/rss) in MiB
 *   - CPU time delta (user + system) in ms
 *   - Event-loop lag: how many ms behind schedule a setImmediate fires
 *     relative to the moment it was scheduled.  Values >100 ms indicate the
 *     loop is stalled under heavy I/O or CPU load.
 *
 * Designed as a standalone module with no circular imports.
 * Call startProcessMetrics() once at server startup; then read via
 * getProcessMetrics() from any route or metrics exporter.
 */

export interface ProcessMetricsSnapshot {
  heapUsedMb:  number;
  heapTotalMb: number;
  rssMb:       number;
  cpuUserMs:   number;
  cpuSysMs:    number;
  loopLagMs:   number;
  sampledAt:   number;  // Unix ms of last sample
}

let _snapshot: ProcessMetricsSnapshot = {
  heapUsedMb:  0,
  heapTotalMb: 0,
  rssMb:       0,
  cpuUserMs:   0,
  cpuSysMs:    0,
  loopLagMs:   0,
  sampledAt:   0,
};

let _prevCpu  = process.cpuUsage();
let _timer: ReturnType<typeof setInterval> | null = null;

function sample(): void {
  const mem           = process.memoryUsage();
  const MB            = 1_048_576;
  _snapshot.heapUsedMb  = Math.round((mem.heapUsed  / MB) * 10) / 10;
  _snapshot.heapTotalMb = Math.round((mem.heapTotal / MB) * 10) / 10;
  _snapshot.rssMb       = Math.round((mem.rss       / MB) * 10) / 10;

  const cpu         = process.cpuUsage(_prevCpu);
  _snapshot.cpuUserMs = Math.round(cpu.user   / 1_000);
  _snapshot.cpuSysMs  = Math.round(cpu.system / 1_000);
  _prevCpu          = process.cpuUsage();

  _snapshot.sampledAt = Date.now();

  // Event-loop lag: schedule immediate and measure actual dispatch delay.
  // The lag value is set on the *next* iteration so it always represents
  // the delay experienced by the *previous* schedule — a reliable indicator
  // of sustained loop pressure without introducing scheduling jitter itself.
  const lagStart = Date.now();
  setImmediate(() => {
    _snapshot.loopLagMs = Math.max(0, Date.now() - lagStart);
  });
}

/**
 * Start the background sampler.  Safe to call multiple times — only the first
 * call starts the interval; subsequent calls are no-ops.
 */
export function startProcessMetrics(intervalMs = 10_000): void {
  if (_timer) return;
  sample(); // Populate immediately on startup
  _timer = setInterval(sample, intervalMs);
  _timer.unref(); // Do not prevent process exit
}

export function stopProcessMetrics(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

/** Returns the most recent process metrics snapshot. */
export function getProcessMetrics(): ProcessMetricsSnapshot {
  return { ..._snapshot };
}
