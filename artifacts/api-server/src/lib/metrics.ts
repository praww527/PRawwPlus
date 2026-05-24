/**
 * In-memory metrics store for PRaww+ operational observability.
 *
 * Designed as a singleton that is safe to import from any module.
 * All counters are monotonically increasing; gauges reflect current state.
 * Prometheus text format is rendered on demand by the /api/metrics route.
 */

interface LatencySample {
  value: number;
  ts: number;
}

const MAX_LATENCY_SAMPLES = 1_000;

class MetricsStore {
  readonly startedAt = new Date();

  // ── Gauges ─────────────────────────────────────────────────────────────────
  activeVertoClients = 0;
  activeSipClients   = 0;
  activeCalls        = 0;

  // ── Counters ───────────────────────────────────────────────────────────────
  callsInitiated           = 0;
  callsAnswered            = 0;
  callsFailed              = 0;
  failedOriginates         = 0;   // originate commands rejected pre-flight
  rtpFailures              = 0;   // no RTP within watchdog window post-bridge
  noBridgeTimeouts         = 0;   // calls that timed out before CHANNEL_BRIDGE
  wsDisconnectsVerto       = 0;
  wsDisconnectsSip         = 0;
  wsReconnectsVerto        = 0;   // successful Verto reconnects
  wsReconnectsSip          = 0;   // successful SIP reconnects
  iceFailures              = 0;
  registrationFailures     = 0;
  reconnectAttempts        = 0;
  reconnectSuccesses       = 0;
  reconnectFailures        = 0;
  upstreamDisconnectsVerto = 0;
  upstreamDisconnectsSip   = 0;
  staleSessionCleanups     = 0;   // Verto sessions removed by sweeper
  staleSweepRuns           = 0;   // number of sweep cycles executed
  zombieCallsKilled        = 0;   // orphaned DB calls cleared by sweeper
  voicemailFallbacks       = 0;   // calls routed to voicemail

  // ── Latency samples ────────────────────────────────────────────────────────
  // Ring-buffers of latency measurements (ms).
  private readonly setupLatencySamples:  LatencySample[] = [];
  private readonly bridgeLatencySamples: LatencySample[] = [];

  recordCallSetupLatency(ms: number): void {
    if (this.setupLatencySamples.length >= MAX_LATENCY_SAMPLES) {
      this.setupLatencySamples.shift();
    }
    this.setupLatencySamples.push({ value: ms, ts: Date.now() });
  }

  /** Record time from call initiation to CHANNEL_BRIDGE (ms). */
  recordBridgeSetupLatency(ms: number): void {
    if (this.bridgeLatencySamples.length >= MAX_LATENCY_SAMPLES) {
      this.bridgeLatencySamples.shift();
    }
    this.bridgeLatencySamples.push({ value: ms, ts: Date.now() });
  }

  private percentiles(samples: LatencySample[]): { p50: number; p95: number; p99: number; count: number } {
    const values = samples.map((s) => s.value).sort((a, b) => a - b);
    const count  = values.length;
    if (count === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const p = (pct: number) => values[Math.floor(((pct / 100) * count) - 1)] ?? values[count - 1] ?? 0;
    return { p50: p(50), p95: p(95), p99: p(99), count };
  }

  /** Return p50/p95/p99 of call setup latency over the last N samples. */
  callSetupLatencyPercentiles() {
    return this.percentiles(this.setupLatencySamples);
  }

  /** Return p50/p95/p99 of bridge setup latency over the last N samples. */
  bridgeSetupLatencyPercentiles() {
    return this.percentiles(this.bridgeLatencySamples);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
  }

  snapshot() {
    const lat    = this.callSetupLatencyPercentiles();
    const bridge = this.bridgeSetupLatencyPercentiles();
    return {
      startedAt:               this.startedAt.toISOString(),
      uptimeSeconds:           this.uptimeSeconds(),
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
      callSetupLatency:        lat,
      bridgeSetupLatency:      bridge,
    };
  }

  /** Render Prometheus exposition format. */
  toPrometheusText(): string {
    const lat    = this.callSetupLatencyPercentiles();
    const bridge = this.bridgeSetupLatencyPercentiles();
    const up     = this.uptimeSeconds();
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

    gauge("prawwplus_uptime_seconds",          "Server uptime in seconds",                          up);
    gauge("prawwplus_active_verto_clients",    "Currently connected Verto WebSocket clients",        this.activeVertoClients);
    gauge("prawwplus_active_sip_clients",      "Currently connected SIP WebSocket clients",          this.activeSipClients);
    gauge("prawwplus_active_calls",            "Calls currently in-progress",                        this.activeCalls);

    counter("prawwplus_calls_initiated",        "Total call invites sent",                            this.callsInitiated);
    counter("prawwplus_calls_answered",         "Total calls answered",                               this.callsAnswered);
    counter("prawwplus_calls_failed",           "Total calls that failed or were rejected",           this.callsFailed);
    counter("prawwplus_failed_originates",      "Total originate commands rejected pre-flight",       this.failedOriginates);
    counter("prawwplus_rtp_failures",           "Total calls with no RTP after bridge",               this.rtpFailures);
    counter("prawwplus_no_bridge_timeouts",     "Total calls that timed out before CHANNEL_BRIDGE",   this.noBridgeTimeouts);
    counter("prawwplus_ws_disconnects_verto",   "Total Verto client WebSocket disconnections",        this.wsDisconnectsVerto);
    counter("prawwplus_ws_disconnects_sip",     "Total SIP client WebSocket disconnections",          this.wsDisconnectsSip);
    counter("prawwplus_ws_reconnects_verto",    "Total successful Verto WebSocket reconnects",        this.wsReconnectsVerto);
    counter("prawwplus_ws_reconnects_sip",      "Total successful SIP WebSocket reconnects",          this.wsReconnectsSip);
    counter("prawwplus_ice_failures",           "Total ICE negotiation failures reported by clients", this.iceFailures);
    counter("prawwplus_registration_failures",  "Total SIP registration failures",                    this.registrationFailures);
    counter("prawwplus_reconnect_attempts",     "Total reconnect attempts across all protocols",      this.reconnectAttempts);
    counter("prawwplus_reconnect_successes",    "Total successful reconnects",                        this.reconnectSuccesses);
    counter("prawwplus_reconnect_failures",     "Total failed reconnect attempts",                    this.reconnectFailures);
    counter("prawwplus_upstream_disconnects_verto", "Total upstream FreeSWITCH Verto disconnections", this.upstreamDisconnectsVerto);
    counter("prawwplus_upstream_disconnects_sip",   "Total upstream FreeSWITCH SIP disconnections",   this.upstreamDisconnectsSip);
    counter("prawwplus_stale_session_cleanups", "Total Verto sessions removed by sweeper",            this.staleSessionCleanups);
    counter("prawwplus_stale_sweep_runs",       "Total stale session sweep cycles",                   this.staleSweepRuns);
    counter("prawwplus_zombie_calls_killed",    "Total zombie call DB records cleared by sweeper",    this.zombieCallsKilled);
    counter("prawwplus_voicemail_fallbacks",    "Total calls routed to voicemail",                    this.voicemailFallbacks);

    // Call setup latency percentiles
    lines.push("# HELP prawwplus_call_setup_latency_ms Call setup latency percentiles in milliseconds");
    lines.push("# TYPE prawwplus_call_setup_latency_ms summary");
    lines.push(`prawwplus_call_setup_latency_ms{quantile="0.5"} ${lat.p50}`);
    lines.push(`prawwplus_call_setup_latency_ms{quantile="0.95"} ${lat.p95}`);
    lines.push(`prawwplus_call_setup_latency_ms{quantile="0.99"} ${lat.p99}`);
    lines.push(`prawwplus_call_setup_latency_ms_count ${lat.count}`);

    // Bridge setup latency percentiles
    lines.push("# HELP prawwplus_bridge_setup_latency_ms Time from call initiation to CHANNEL_BRIDGE in ms");
    lines.push("# TYPE prawwplus_bridge_setup_latency_ms summary");
    lines.push(`prawwplus_bridge_setup_latency_ms{quantile="0.5"} ${bridge.p50}`);
    lines.push(`prawwplus_bridge_setup_latency_ms{quantile="0.95"} ${bridge.p95}`);
    lines.push(`prawwplus_bridge_setup_latency_ms{quantile="0.99"} ${bridge.p99}`);
    lines.push(`prawwplus_bridge_setup_latency_ms_count ${bridge.count}`);

    return lines.join("\n") + "\n";
  }
}

export const metrics = new MetricsStore();
