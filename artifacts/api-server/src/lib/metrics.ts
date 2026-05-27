/**
 * In-memory metrics store for PRaww+ operational observability.
 *
 * Designed as a singleton that is safe to import from any module.
 * All counters are monotonically increasing; gauges reflect current state.
 * Prometheus text format is rendered on demand by the /api/metrics route.
 */
import { getActiveReconnectCount } from "./proxyBuffer";
import { getProcessMetrics } from "./processMetrics";

interface LatencySample {
  value: number;
  ts:    number;
}

const MAX_LATENCY_SAMPLES = 1_000;

class MetricsStore {
  readonly startedAt = new Date();

  // ── Gauges ─────────────────────────────────────────────────────────────────
  activeVertoClients = 0;
  activeSipClients   = 0;
  activeCalls        = 0;

  // ESL connectivity — timestamp (ms) when ESL went down, null when connected.
  eslDisconnectedAt: number | null = null;

  /** Returns how many milliseconds ESL has been disconnected (0 when connected). */
  eslDisconnectedMs(): number {
    return this.eslDisconnectedAt == null ? 0 : Math.max(0, Date.now() - this.eslDisconnectedAt);
  }

  // ── Counters ───────────────────────────────────────────────────────────────
  callsInitiated           = 0;
  callsAnswered            = 0;
  callsFailed              = 0;
  failedOriginates         = 0;
  rtpFailures              = 0;
  noBridgeTimeouts         = 0;
  wsDisconnectsVerto       = 0;
  wsDisconnectsSip         = 0;
  wsReconnectsVerto        = 0;
  wsReconnectsSip          = 0;
  iceFailures              = 0;
  registrationFailures     = 0;
  reconnectAttempts        = 0;
  reconnectSuccesses       = 0;
  reconnectFailures        = 0;
  upstreamDisconnectsVerto = 0;
  upstreamDisconnectsSip   = 0;
  staleSessionCleanups     = 0;
  staleSweepRuns           = 0;
  zombieCallsKilled        = 0;
  voicemailFallbacks       = 0;

  // ── Security / rate-limit counters ────────────────────────────────────────
  /** WebSocket connections dropped because the per-IP slot cap was reached. */
  wsConnectionsRejectedIpLimit = 0;
  /** SIP registration bursts flagged as flood (>threshold per minute per IP). */
  sipFloodBlocked              = 0;
  /** Call attempts rejected by the per-user throttle guard. */
  callThrottleRejections       = 0;
  /** Times the ESL event throughput dropped below the stall threshold while connected. */
  eslStalledThroughputCount    = 0;
  /** Times a bgapi command was dropped because the queue was at the depth cap. */
  bgapiQueueDropped            = 0;

  // ── Push delivery counters ─────────────────────────────────────────────────
  pushFcmSent    = 0;
  pushFcmFailed  = 0;
  pushWebSent    = 0;
  pushWebFailed  = 0;
  pushExpoSent   = 0;
  pushExpoFailed = 0;
  pushWakeups    = 0;

  // ── Proxy buffer / reconnect counters ─────────────────────────────────────
  /** Messages dropped from the Verto upstream buffer (overflow + TTL expiry). */
  proxyMessagesDroppedVerto = 0;
  /** Messages dropped from the SIP upstream buffer (overflow + TTL expiry). */
  proxyMessagesDroppedSip   = 0;

  // ── Latency samples ────────────────────────────────────────────────────────
  private readonly setupLatencySamples:           LatencySample[] = [];
  private readonly bridgeLatencySamples:          LatencySample[] = [];
  private readonly proxyReconnectDurationVerto:   LatencySample[] = [];
  private readonly proxyReconnectDurationSip:     LatencySample[] = [];
  private readonly proxyFlushLatencyVertoSamples: LatencySample[] = [];
  private readonly proxyFlushLatencySipSamples:   LatencySample[] = [];

  recordCallSetupLatency(ms: number): void {
    this._push(this.setupLatencySamples, ms);
  }

  recordBridgeSetupLatency(ms: number): void {
    this._push(this.bridgeLatencySamples, ms);
  }

  /**
   * Record how long (ms) an upstream WebSocket took to reach OPEN after the
   * retry was scheduled (close-handler fires → ws.on("open")).
   */
  recordProxyReconnectDuration(protocol: "verto" | "sip", ms: number): void {
    this._push(
      protocol === "verto" ? this.proxyReconnectDurationVerto : this.proxyReconnectDurationSip,
      ms,
    );
  }

  /**
   * Record how long (ms) the buffer flush took once the upstream was ready
   * (auth confirmed or immediate on open).  Detects socket-layer backpressure.
   */
  recordProxyFlushLatency(protocol: "verto" | "sip", ms: number): void {
    this._push(
      protocol === "verto" ? this.proxyFlushLatencyVertoSamples : this.proxyFlushLatencySipSamples,
      ms,
    );
  }

  proxyReconnectDurationPercentiles(protocol: "verto" | "sip") {
    return this._percentiles(
      protocol === "verto" ? this.proxyReconnectDurationVerto : this.proxyReconnectDurationSip,
    );
  }

  proxyFlushLatencyPercentiles(protocol: "verto" | "sip") {
    return this._percentiles(
      protocol === "verto" ? this.proxyFlushLatencyVertoSamples : this.proxyFlushLatencySipSamples,
    );
  }

  private _push(arr: LatencySample[], value: number): void {
    if (arr.length >= MAX_LATENCY_SAMPLES) arr.shift();
    arr.push({ value, ts: Date.now() });
  }

  private _percentiles(samples: LatencySample[]): { p50: number; p95: number; p99: number; count: number } {
    const values = samples.map((s) => s.value).sort((a, b) => a - b);
    const count  = values.length;
    if (count === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const p = (pct: number) => values[Math.floor(((pct / 100) * count) - 1)] ?? values[count - 1] ?? 0;
    return { p50: p(50), p95: p(95), p99: p(99), count };
  }

  callSetupLatencyPercentiles() { return this._percentiles(this.setupLatencySamples); }
  bridgeSetupLatencyPercentiles() { return this._percentiles(this.bridgeLatencySamples); }

  // ── Helpers ────────────────────────────────────────────────────────────────
  uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
  }

  snapshot() {
    const lat         = this.callSetupLatencyPercentiles();
    const bridge      = this.bridgeSetupLatencyPercentiles();
    const reconVerto  = this.proxyReconnectDurationPercentiles("verto");
    const reconSip    = this.proxyReconnectDurationPercentiles("sip");
    const flushVerto  = this.proxyFlushLatencyPercentiles("verto");
    const flushSip    = this.proxyFlushLatencyPercentiles("sip");
    const proc        = getProcessMetrics();
    return {
      startedAt:               this.startedAt.toISOString(),
      uptimeSeconds:           this.uptimeSeconds(),
      eslDisconnectedMs:       this.eslDisconnectedMs(),
      activeVertoClients:      this.activeVertoClients,
      activeSipClients:        this.activeSipClients,
      activeCalls:             this.activeCalls,
      callsInitiated:          this.callsInitiated,
      callsAnswered:           this.callsAnswered,
      callsFailed:             this.callsFailed,
      failedOriginates:        this.failedOriginates,
      rtpFailures:             this.rtpFailures,
      noBridgeTimeouts:        this.noBridgeTimeouts,
      wsDisconnectsVerto:      this.wsDisconnectsVerto,
      wsDisconnectsSip:        this.wsDisconnectsSip,
      wsReconnectsVerto:       this.wsReconnectsVerto,
      wsReconnectsSip:         this.wsReconnectsSip,
      iceFailures:             this.iceFailures,
      registrationFailures:    this.registrationFailures,
      reconnectAttempts:       this.reconnectAttempts,
      reconnectSuccesses:      this.reconnectSuccesses,
      reconnectFailures:       this.reconnectFailures,
      upstreamDisconnectsVerto: this.upstreamDisconnectsVerto,
      upstreamDisconnectsSip:   this.upstreamDisconnectsSip,
      staleSessionCleanups:    this.staleSessionCleanups,
      staleSweepRuns:          this.staleSweepRuns,
      zombieCallsKilled:       this.zombieCallsKilled,
      voicemailFallbacks:      this.voicemailFallbacks,
      pushFcmSent:             this.pushFcmSent,
      pushFcmFailed:           this.pushFcmFailed,
      pushWebSent:             this.pushWebSent,
      pushWebFailed:           this.pushWebFailed,
      pushExpoSent:            this.pushExpoSent,
      pushExpoFailed:          this.pushExpoFailed,
      pushWakeups:             this.pushWakeups,
      proxyMessagesDroppedVerto: this.proxyMessagesDroppedVerto,
      proxyMessagesDroppedSip:   this.proxyMessagesDroppedSip,
      activeUpstreamReconnectsVerto: getActiveReconnectCount("verto"),
      activeUpstreamReconnectsSip:   getActiveReconnectCount("sip"),
      proxyReconnectDuration:  { verto: reconVerto, sip: reconSip },
      proxyFlushLatency:       { verto: flushVerto, sip: flushSip },
      callSetupLatency:        lat,
      bridgeSetupLatency:      bridge,
      // Security / resilience counters
      wsConnectionsRejectedIpLimit: this.wsConnectionsRejectedIpLimit,
      sipFloodBlocked:              this.sipFloodBlocked,
      callThrottleRejections:       this.callThrottleRejections,
      eslStalledThroughputCount:    this.eslStalledThroughputCount,
      bgapiQueueDropped:            this.bgapiQueueDropped,
      // Process-level metrics (sampled by processMetrics.ts)
      process: {
        heapUsedMb:  proc.heapUsedMb,
        heapTotalMb: proc.heapTotalMb,
        rssMb:       proc.rssMb,
        cpuUserMs:   proc.cpuUserMs,
        cpuSysMs:    proc.cpuSysMs,
        loopLagMs:   proc.loopLagMs,
        sampledAt:   proc.sampledAt,
      },
    };
  }

  /** Render Prometheus exposition format. */
  toPrometheusText(): string {
    const lat        = this.callSetupLatencyPercentiles();
    const bridge     = this.bridgeSetupLatencyPercentiles();
    const reconVerto = this.proxyReconnectDurationPercentiles("verto");
    const reconSip   = this.proxyReconnectDurationPercentiles("sip");
    const flushVerto = this.proxyFlushLatencyPercentiles("verto");
    const flushSip   = this.proxyFlushLatencyPercentiles("sip");
    const up         = this.uptimeSeconds();
    const lines: string[] = [];

    const gauge = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    };
    const counter = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}_total ${value}`);
    };
    const summary = (name: string, help: string, p: { p50: number; p95: number; p99: number; count: number }) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} summary`);
      lines.push(`${name}{quantile="0.5"} ${p.p50}`);
      lines.push(`${name}{quantile="0.95"} ${p.p95}`);
      lines.push(`${name}{quantile="0.99"} ${p.p99}`);
      lines.push(`${name}_count ${p.count}`);
    };

    gauge("prawwplus_uptime_seconds",           "Server uptime in seconds",                            up);
    gauge("prawwplus_esl_disconnected_seconds", "Seconds ESL has been disconnected (0 when connected)", this.eslDisconnectedMs() / 1000);
    gauge("prawwplus_active_verto_clients",     "Currently connected Verto WebSocket clients",          this.activeVertoClients);
    gauge("prawwplus_active_sip_clients",       "Currently connected SIP WebSocket clients",            this.activeSipClients);
    gauge("prawwplus_active_calls",             "Calls currently in-progress",                          this.activeCalls);
    gauge("prawwplus_active_upstream_reconnects_verto", "In-flight Verto upstream reconnect attempts",  getActiveReconnectCount("verto"));
    gauge("prawwplus_active_upstream_reconnects_sip",   "In-flight SIP upstream reconnect attempts",    getActiveReconnectCount("sip"));

    counter("prawwplus_calls_initiated",        "Total call invites sent",                              this.callsInitiated);
    counter("prawwplus_calls_answered",         "Total calls answered",                                 this.callsAnswered);
    counter("prawwplus_calls_failed",           "Total calls that failed or were rejected",             this.callsFailed);
    counter("prawwplus_failed_originates",      "Total originate commands rejected pre-flight",         this.failedOriginates);
    counter("prawwplus_rtp_failures",           "Total calls with no RTP after bridge",                 this.rtpFailures);
    counter("prawwplus_no_bridge_timeouts",     "Total calls that timed out before CHANNEL_BRIDGE",     this.noBridgeTimeouts);
    counter("prawwplus_ws_disconnects_verto",   "Total Verto client WebSocket disconnections",          this.wsDisconnectsVerto);
    counter("prawwplus_ws_disconnects_sip",     "Total SIP client WebSocket disconnections",            this.wsDisconnectsSip);
    counter("prawwplus_ws_reconnects_verto",    "Total successful Verto WebSocket reconnects",          this.wsReconnectsVerto);
    counter("prawwplus_ws_reconnects_sip",      "Total successful SIP WebSocket reconnects",            this.wsReconnectsSip);
    counter("prawwplus_ice_failures",           "Total ICE negotiation failures reported by clients",   this.iceFailures);
    counter("prawwplus_registration_failures",  "Total SIP registration failures",                      this.registrationFailures);
    counter("prawwplus_reconnect_attempts",     "Total reconnect attempts across all protocols",        this.reconnectAttempts);
    counter("prawwplus_reconnect_successes",    "Total successful reconnects",                          this.reconnectSuccesses);
    counter("prawwplus_reconnect_failures",     "Total failed reconnect attempts",                      this.reconnectFailures);
    counter("prawwplus_upstream_disconnects_verto", "Total upstream FreeSWITCH Verto disconnections",  this.upstreamDisconnectsVerto);
    counter("prawwplus_upstream_disconnects_sip",   "Total upstream FreeSWITCH SIP disconnections",    this.upstreamDisconnectsSip);
    counter("prawwplus_stale_session_cleanups", "Total Verto sessions removed by sweeper",              this.staleSessionCleanups);
    counter("prawwplus_stale_sweep_runs",       "Total stale session sweep cycles",                     this.staleSweepRuns);
    counter("prawwplus_zombie_calls_killed",    "Total zombie call DB records cleared by sweeper",      this.zombieCallsKilled);
    counter("prawwplus_voicemail_fallbacks",    "Total calls routed to voicemail",                      this.voicemailFallbacks);
    counter("prawwplus_proxy_messages_dropped_verto", "Verto buffer messages dropped (overflow + TTL)", this.proxyMessagesDroppedVerto);
    counter("prawwplus_proxy_messages_dropped_sip",   "SIP buffer messages dropped (overflow + TTL)",   this.proxyMessagesDroppedSip);

    counter("prawwplus_ws_connections_rejected_ip_limit", "WS connections dropped — per-IP cap reached",            this.wsConnectionsRejectedIpLimit);
    counter("prawwplus_sip_flood_blocked",                "SIP registration bursts flagged as flood events",         this.sipFloodBlocked);
    counter("prawwplus_call_throttle_rejections",         "Call attempts rejected by per-user throttle guard",       this.callThrottleRejections);
    counter("prawwplus_esl_stalled_throughput",           "Times ESL event throughput stalled below threshold",      this.eslStalledThroughputCount);
    counter("prawwplus_bgapi_queue_dropped",              "bgapi commands dropped because queue was at depth cap",   this.bgapiQueueDropped);

    const proc = getProcessMetrics();
    gauge("prawwplus_process_heap_used_mb",   "Node.js heap used in MiB",                     proc.heapUsedMb);
    gauge("prawwplus_process_heap_total_mb",  "Node.js heap total allocated in MiB",           proc.heapTotalMb);
    gauge("prawwplus_process_rss_mb",         "Node.js resident set size in MiB",              proc.rssMb);
    gauge("prawwplus_process_cpu_user_ms",    "Node.js CPU user time (delta, ms)",             proc.cpuUserMs);
    gauge("prawwplus_process_cpu_sys_ms",     "Node.js CPU system time (delta, ms)",           proc.cpuSysMs);
    gauge("prawwplus_process_loop_lag_ms",    "Event-loop lag in ms (setImmediate delay)",     proc.loopLagMs);

    summary("prawwplus_call_setup_latency_ms",       "Call setup latency percentiles in milliseconds",          lat);
    summary("prawwplus_bridge_setup_latency_ms",     "Time from call initiation to CHANNEL_BRIDGE in ms",       bridge);
    summary("prawwplus_proxy_reconnect_duration_ms_verto", "Verto upstream reconnect duration (close→open) ms", reconVerto);
    summary("prawwplus_proxy_reconnect_duration_ms_sip",   "SIP upstream reconnect duration (close→open) ms",   reconSip);
    summary("prawwplus_proxy_flush_latency_ms_verto", "Verto buffer flush latency after upstream ready (ms)",   flushVerto);
    summary("prawwplus_proxy_flush_latency_ms_sip",   "SIP buffer flush latency after upstream ready (ms)",     flushSip);

    return lines.join("\n") + "\n";
  }
}

export const metrics = new MetricsStore();
