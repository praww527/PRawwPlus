import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  LineChart, Line, ResponsiveContainer, Tooltip,
} from "recharts";

// ─── API ──────────────────────────────────────────────────────────────────────

async function adminFetch(path: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  const raw = await res.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status}`); }
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PH {
  status:        "ok" | "degraded";
  ts:            string;
  uptimeSeconds: number;
  db:   { ok: boolean; latencyMs: number; state: number };
  esl:  {
    enabled: boolean; connected: boolean;
    host: string; port: number;
    lastConnectedAt: string | null; lastEventAt: string | null;
    lastEventStaleSec: number | null; lastDisconnectReason: string | null;
    reconnectAttempt: number; disconnectedMs: number | null;
    eventsThisMinute: number; eventsLastMinute: number;
    bgapiQueueDepth: number; bufferedEvents: number; pendingDbEvents: number;
    stalledThroughputEvents: number;
  };
  websocket: {
    activeVertoClients: number; activeSipClients: number;
    vertoSessionsInMemory: number; sipRegistrationsInMemory: number;
    activeUpstreamReconnectsVerto: number; activeUpstreamReconnectsSip: number;
    wsConnectionsRejectedIpLimit: number;
  };
  calls: {
    activeCalls: number; callsInitiated: number; callsAnswered: number;
    callsFailed: number; failedOriginates: number;
    rtpFailures: number; noBridgeTimeouts: number;
    iceFailures: number; voicemailFallbacks: number;
    answerRatePct: number | null;
    callSetupLatency: { p50: number; p95: number } | null;
    bridgeSetupLatency: { p50: number; p95: number } | null;
  };
  security: {
    sipFloodBlocked: number; callThrottleRejections: number;
    registrationFailures: number; bgapiQueueDropped: number;
  };
  sweeper: { staleSweepRuns: number; staleSessionCleanups: number; zombieCallsKilled: number };
  push: {
    fcm:  { sent: number; failed: number };
    web:  { sent: number; failed: number };
    expo: { sent: number; failed: number };
    wakeups: number;
  };
  process: {
    heapUsedMb: number; heapTotalMb: number; rssMb: number;
    cpuUserMs: number; cpuSysMs: number; loopLagMs: number;
    sampledAt: string | null;
  };
  history: Array<{
    ts: number; heapUsedMb: number; rssMb: number;
    loopLagMs: number; activeCalls: number; wsVertoClients: number;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const G = "#22c55e";
const A = "#f59e0b";
const R = "#ef4444";
const B = "#60a5fa";

type Col = "green" | "amber" | "red" | "blue" | "dim";
const PALETTE: Record<Col, string> = { green: G, amber: A, red: R, blue: B, dim: "rgba(255,255,255,0.35)" };

function dot(col: Col, size = 8) {
  const c = PALETTE[col];
  return (
    <span style={{
      display: "inline-block", width: size, height: size, borderRadius: "50%",
      background: c, boxShadow: col !== "dim" ? `0 0 6px ${c}88` : "none", flexShrink: 0,
    }} />
  );
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function ago(ts: string | number | null): string {
  if (ts === null) return "—";
  const sec = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, accentColor, children }: { title: string; accentColor?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${accentColor ?? "rgba(255,255,255,0.08)"}`,
      borderRadius: 14, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function Stat({ label, value, col, unit }: { label: string; value: React.ReactNode; col?: Col; unit?: string }) {
  const color = col ? PALETTE[col] : "rgba(255,255,255,0.88)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 80 }}>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.4)", marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function Row({ label, value, col }: { label: string; value: React.ReactNode; col?: Col }) {
  const color = col ? PALETTE[col] : "rgba(255,255,255,0.8)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 24 }}>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />;
}

function Spark({ data, dataKey, color }: { data: PH["history"]; dataKey: keyof PH["history"][0]; color: string }) {
  if (!data || data.length < 2) return <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>no data yet</span>;
  return (
    <ResponsiveContainer width="100%" height={44}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line type="monotone" dataKey={dataKey as string} stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ display: "none" }}
          formatter={(v: number) => [typeof v === "number" ? v.toFixed(1) : v, String(dataKey)]}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const INTERVAL_MS = 5_000;

export default function PlatformHealth() {
  const [, nav] = useLocation();
  const [ph,      setPh]      = useState<PH | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [lastAt,  setLastAt]  = useState<Date | null>(null);
  const [ttl,     setTtl]     = useState(INTERVAL_MS / 1000);

  const refresh = useCallback(async () => {
    try {
      const d = await adminFetch("/admin/platform-health");
      setPh(d);
      setError(null);
      setLastAt(new Date());
      setTtl(INTERVAL_MS / 1000);
    } catch (e: any) {
      setError(e.message ?? "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const poll = setInterval(refresh, INTERVAL_MS);
    const tick = setInterval(() => setTtl((t) => Math.max(0, t - 1)), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  const healthy = ph?.status === "ok";

  return (
    <div style={{ padding: "28px 24px", maxWidth: 1200, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.95)", margin: 0 }}>
              Platform Health
            </h1>
            {!loading && ph && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                background: healthy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${healthy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                color: healthy ? G : R,
              }}>
                {dot(healthy ? "green" : "red", 7)}
                {healthy ? "HEALTHY" : "DEGRADED"}
              </span>
            )}
          </div>
          {lastAt && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>
              {ph && <>Uptime {fmtUptime(ph.uptimeSeconds)} · </>}
              Updated {lastAt.toLocaleTimeString()} · Next in {ttl}s
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => { setLoading(true); refresh(); }} disabled={loading}
            style={{
              padding: "7px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.7)", cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
          <button
            onClick={() => nav("/admin/dashboard")}
            style={{
              padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.4)", cursor: "pointer",
            }}
          >
            ← Dashboard
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          marginBottom: 20, padding: "12px 16px", borderRadius: 12,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
          fontSize: 13, color: R,
        }}>
          ⚠ {error} — retrying in {ttl}s
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !ph && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 14 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ height: 140, borderRadius: 14, background: "rgba(255,255,255,0.04)", animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
      )}

      {ph && (
        <>
          {/* ── Row 1: Critical subsystems ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 14, marginBottom: 14 }}>

            {/* Database */}
            <Card title="Database" accentColor={ph.db.ok ? undefined : "rgba(239,68,68,0.4)"}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {dot(ph.db.ok ? "green" : "red")}
                <span style={{ fontSize: 15, fontWeight: 700, color: ph.db.ok ? "rgba(255,255,255,0.9)" : R }}>
                  {ph.db.ok ? "Connected" : "Disconnected"}
                </span>
              </div>
              <Divider />
              <div style={{ display: "flex", gap: 20 }}>
                <Stat label="Latency" value={ph.db.latencyMs} unit="ms" col={ph.db.latencyMs > 100 ? "amber" : ph.db.latencyMs > 50 ? "amber" : "green"} />
                <Stat label="State" value={["Off","Ready","Connecting","Closing","Uninit"][ph.db.state] ?? ph.db.state} />
              </div>
            </Card>

            {/* FreeSWITCH ESL */}
            <Card
              title="FreeSWITCH ESL"
              accentColor={!ph.esl.enabled ? "rgba(245,158,11,0.3)" : ph.esl.connected ? undefined : "rgba(239,68,68,0.4)"}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {dot(!ph.esl.enabled ? "dim" : ph.esl.connected ? "green" : "red")}
                <span style={{ fontSize: 15, fontWeight: 700, color: !ph.esl.enabled ? "rgba(255,255,255,0.35)" : ph.esl.connected ? "rgba(255,255,255,0.9)" : R }}>
                  {!ph.esl.enabled ? "Not configured" : ph.esl.connected ? "Connected" : "Disconnected"}
                </span>
                {ph.esl.enabled && !ph.esl.connected && ph.esl.disconnectedMs != null && (
                  <span style={{ fontSize: 11, color: A, background: "rgba(245,158,11,0.1)", borderRadius: 8, padding: "2px 8px" }}>
                    {Math.round(ph.esl.disconnectedMs / 1000)}s down
                  </span>
                )}
                {ph.esl.stalledThroughputEvents > 0 && (
                  <span style={{ fontSize: 11, color: A }}>⚠ {ph.esl.stalledThroughputEvents} stall</span>
                )}
              </div>
              <Divider />
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Stat label="Events/min" value={ph.esl.eventsThisMinute} />
                <Stat
                  label="Last event"
                  value={ph.esl.lastEventStaleSec === null ? "—" : `${ph.esl.lastEventStaleSec}s ago`}
                  col={(ph.esl.lastEventStaleSec ?? 0) > 120 ? "red" : (ph.esl.lastEventStaleSec ?? 0) > 60 ? "amber" : undefined}
                />
                <Stat label="Reconnects" value={ph.esl.reconnectAttempt} col={ph.esl.reconnectAttempt > 0 ? "amber" : undefined} />
                <Stat label="BgAPI Q" value={ph.esl.bgapiQueueDepth} col={ph.esl.bgapiQueueDepth > 50 ? "amber" : undefined} />
              </div>
              {ph.esl.lastDisconnectReason && (
                <div style={{ fontSize: 11, color: A, background: "rgba(245,158,11,0.08)", borderRadius: 8, padding: "6px 10px", fontFamily: "monospace" }}>
                  {ph.esl.lastDisconnectReason}
                </div>
              )}
            </Card>

            {/* WebSocket */}
            <Card title="WebSocket / SIP">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Stat label="Verto WS" value={ph.websocket.activeVertoClients} col={ph.websocket.activeVertoClients > 0 ? "blue" : undefined} />
                <Stat label="SIP WS"   value={ph.websocket.activeSipClients}   col={ph.websocket.activeSipClients > 0 ? "blue" : undefined} />
                <Stat label="SIP Reg"  value={ph.websocket.sipRegistrationsInMemory} />
              </div>
              <Divider />
              <Row label="Verto sessions (memory)"   value={ph.websocket.vertoSessionsInMemory} />
              <Row label="Upstream reconnects (Verto)" value={ph.websocket.activeUpstreamReconnectsVerto} col={ph.websocket.activeUpstreamReconnectsVerto > 0 ? "amber" : undefined} />
              <Row label="Upstream reconnects (SIP)"   value={ph.websocket.activeUpstreamReconnectsSip}   col={ph.websocket.activeUpstreamReconnectsSip > 0 ? "amber" : undefined} />
              <Row
                label="Connections rejected (IP limit)"
                value={ph.websocket.wsConnectionsRejectedIpLimit}
                col={ph.websocket.wsConnectionsRejectedIpLimit > 0 ? "amber" : undefined}
              />
            </Card>

          </div>

          {/* ── Row 2: Calls / Security / Sweeper / Push ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 14, marginBottom: 14 }}>

            {/* Calls */}
            <Card title="Calls">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Stat label="Active"    value={ph.calls.activeCalls}    col={ph.calls.activeCalls > 0 ? "green" : undefined} />
                <Stat label="Today"     value={ph.calls.callsInitiated} />
                <Stat label="Answered"  value={ph.calls.callsAnswered} />
                <Stat
                  label="Answer %"
                  value={ph.calls.answerRatePct !== null ? `${ph.calls.answerRatePct.toFixed(1)}%` : "—"}
                  col={ph.calls.answerRatePct !== null && ph.calls.answerRatePct < 70 ? "red" : ph.calls.answerRatePct !== null && ph.calls.answerRatePct < 85 ? "amber" : "green"}
                />
              </div>
              <Divider />
              <Row label="Failed"           value={ph.calls.callsFailed}        col={ph.calls.callsFailed > 0 ? "amber" : undefined} />
              <Row label="Failed originates" value={ph.calls.failedOriginates}  col={ph.calls.failedOriginates > 0 ? "amber" : undefined} />
              <Row label="RTP failures"     value={ph.calls.rtpFailures}        col={ph.calls.rtpFailures > 0 ? "amber" : undefined} />
              <Row label="ICE failures"     value={ph.calls.iceFailures}        col={ph.calls.iceFailures > 0 ? "amber" : undefined} />
              <Row label="No-bridge timeouts" value={ph.calls.noBridgeTimeouts} col={ph.calls.noBridgeTimeouts > 0 ? "amber" : undefined} />
              <Row label="Voicemail fallbacks" value={ph.calls.voicemailFallbacks} />
              {ph.calls.callSetupLatency && (
                <>
                  <Divider />
                  <Row label="Setup latency p50" value={`${ph.calls.callSetupLatency.p50}ms`} />
                  <Row label="Setup latency p95" value={`${ph.calls.callSetupLatency.p95}ms`} col={ph.calls.callSetupLatency.p95 > 3000 ? "amber" : undefined} />
                </>
              )}
            </Card>

            {/* Security */}
            <Card
              title="Security"
              accentColor={
                ph.security.sipFloodBlocked > 0 || ph.security.bgapiQueueDropped > 0
                  ? "rgba(245,158,11,0.3)" : undefined
              }
            >
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Stat label="SIP Flood"  value={ph.security.sipFloodBlocked}        col={ph.security.sipFloodBlocked > 0 ? "amber" : undefined} />
                <Stat label="Throttled"  value={ph.security.callThrottleRejections} col={ph.security.callThrottleRejections > 0 ? "amber" : undefined} />
              </div>
              <Divider />
              <Row label="Reg failures"  value={ph.security.registrationFailures}  col={ph.security.registrationFailures > 10 ? "amber" : undefined} />
              <Row label="BgAPI dropped" value={ph.security.bgapiQueueDropped}     col={ph.security.bgapiQueueDropped > 0 ? "red" : undefined} />
            </Card>

            {/* Sweeper */}
            <Card title="Session Sweeper">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Stat label="Sweep runs"  value={ph.sweeper.staleSweepRuns} />
                <Stat label="Cleaned"     value={ph.sweeper.staleSessionCleanups} />
                <Stat label="Zombies killed" value={ph.sweeper.zombieCallsKilled} col={ph.sweeper.zombieCallsKilled > 0 ? "amber" : undefined} />
              </div>
            </Card>

            {/* Push */}
            <Card title="Push Notifications">
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <Stat label="FCM sent"   value={ph.push.fcm.sent} />
                <Stat label="Web sent"   value={ph.push.web.sent} />
                <Stat label="Expo sent"  value={ph.push.expo.sent} />
                <Stat label="Wakeups"    value={ph.push.wakeups} />
              </div>
              {(ph.push.fcm.failed > 0 || ph.push.web.failed > 0 || ph.push.expo.failed > 0) && (
                <>
                  <Divider />
                  <Row label="FCM failed"  value={ph.push.fcm.failed}  col="amber" />
                  <Row label="Web failed"  value={ph.push.web.failed}  col="amber" />
                  <Row label="Expo failed" value={ph.push.expo.failed} col="amber" />
                </>
              )}
            </Card>

          </div>

          {/* ── Row 3: Process ── */}
          <div style={{ marginBottom: 14 }}>
            <Card title="Process" accentColor={(ph.process.loopLagMs > 100 || ph.process.heapUsedMb > 400) ? "rgba(245,158,11,0.3)" : undefined}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <Stat label="Heap used"  value={ph.process.heapUsedMb.toFixed(1)}  unit="MiB" col={ph.process.heapUsedMb > 400 ? "amber" : undefined} />
                <Stat label="Heap total" value={ph.process.heapTotalMb.toFixed(1)} unit="MiB" />
                <Stat label="RSS"        value={ph.process.rssMb.toFixed(1)}        unit="MiB" />
                <Stat label="Loop lag"   value={ph.process.loopLagMs.toFixed(1)}   unit="ms"  col={ph.process.loopLagMs > 100 ? "amber" : ph.process.loopLagMs > 50 ? "amber" : undefined} />
                <Stat label="CPU user"   value={Math.round(ph.process.cpuUserMs)}  unit="ms" />
                <Stat label="CPU sys"    value={Math.round(ph.process.cpuSysMs)}   unit="ms" />
              </div>
              {ph.process.sampledAt && (
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", margin: 0 }}>
                  Sampled {ago(ph.process.sampledAt)}
                </p>
              )}
            </Card>
          </div>

          {/* ── Row 4: Sparkline history ── */}
          {ph.history.length > 1 && (
            <>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", margin: "0 0 10px" }}>
                15-minute history ({ph.history.length} samples)
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: 14 }}>

                <Card title="Heap (MiB)">
                  <Spark data={ph.history} dataKey="heapUsedMb" color={B} />
                </Card>

                <Card title="Event-loop lag (ms)" accentColor={ph.process.loopLagMs > 100 ? "rgba(245,158,11,0.3)" : undefined}>
                  <Spark data={ph.history} dataKey="loopLagMs" color={ph.process.loopLagMs > 100 ? A : G} />
                </Card>

                <Card title="Active calls">
                  <Spark data={ph.history} dataKey="activeCalls" color="#a78bfa" />
                </Card>

                <Card title="Verto WS clients">
                  <Spark data={ph.history} dataKey="wsVertoClients" color="#fb923c" />
                </Card>

              </div>
            </>
          )}

          {/* ── Footer ── */}
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 24 }}>
            Auto-refreshes every {INTERVAL_MS / 1000}s · All metrics are in-memory (no DB round-trip) · as of {new Date(ph.ts).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}
