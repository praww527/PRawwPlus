import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

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

interface LiveCall {
  id:                  string;
  fsCallId:            string | null;
  status:              "initiated" | "ringing" | "answered" | "bridged";
  callType:            "external" | "internal";
  direction:           "inbound" | "outbound";
  callerNumber:        string | null;
  recipientNumber:     string | null;
  createdAt:           string;
  startedAt:           string | null;
  ageMs:               number;
  lastEslEvent:        string | null;
  lastEslEventAgeMs:   number | null;
  eslTrace:            Array<{ event: string; ts: string }>;
  user:                { id: string; username: string; extension: string | null } | null;
}

interface LiveCallsData {
  calls: LiveCall[];
  count: number;
  asOf:  string;
}

interface PH {
  status:        "ok" | "degraded";
  ts:            string;
  uptimeSeconds: number;
  db:   { ok: boolean; latencyMs: number; state: number };
  esl:  {
    enabled: boolean; connected: boolean; host: string; port: number;
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
    rtpFailures: number; noBridgeTimeouts: number; iceFailures: number;
    voicemailFallbacks: number; answerRatePct: number | null;
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
    cpuUserMs: number; cpuSysMs: number; loopLagMs: number; sampledAt: string | null;
  };
  history: Array<{
    ts: number; heapUsedMb: number; rssMb: number;
    loopLagMs: number; activeCalls: number; wsVertoClients: number;
  }>;
}

// Metrics delivered via SSE every 5 s
interface SseMetics {
  activeCalls:         number;
  activeVertoClients:  number;
  activeSipClients:    number;
  uptimeSeconds:       number;
  callsInitiated:      number;
  callsAnswered:       number;
  callsFailed:         number;
  eslDisconnectedMs:   number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const G = "#22c55e", A = "#f59e0b", R = "#ef4444", B = "#60a5fa";
type Col = "green" | "amber" | "red" | "blue" | "dim";
const PALETTE: Record<Col, string> = { green: G, amber: A, red: R, blue: B, dim: "rgba(255,255,255,0.35)" };

function dot(col: Col, size = 8) {
  const c = PALETTE[col];
  return <span style={{ display:"inline-block",width:size,height:size,borderRadius:"50%",background:c,boxShadow:col!=="dim"?`0 0 6px ${c}88`:"none",flexShrink:0 }} />;
}

function fmtUptime(s: number) {
  const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  if(d>0) return `${d}d ${h}h ${m}m`;
  if(h>0) return `${h}h ${m}m`;
  return `${m}m ${s%60}s`;
}

function fmtAge(ms: number) {
  const s=Math.floor(ms/1000);
  if(s<60) return `${s}s`;
  if(s<3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

function ago(ts: string | number | null): string {
  if(!ts) return "—";
  const sec=Math.round((Date.now()-new Date(ts).getTime())/1000);
  if(sec<60) return `${sec}s ago`;
  if(sec<3600) return `${Math.round(sec/60)}m ago`;
  return `${Math.round(sec/3600)}h ago`;
}

const STATUS_COLORS: Record<string,Col> = {
  initiated:"amber", ringing:"amber", answered:"green", bridged:"green",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, accentColor, children }: { title: string; accentColor?: string; children: React.ReactNode }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.04)",border:`1px solid ${accentColor??"rgba(255,255,255,0.08)"}`,borderRadius:14,padding:"18px 20px",display:"flex",flexDirection:"column",gap:14 }}>
      <span style={{ fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.45)" }}>{title}</span>
      {children}
    </div>
  );
}

function Stat({ label, value, col, unit }: { label:string;value:React.ReactNode;col?:Col;unit?:string }) {
  const color=col?PALETTE[col]:"rgba(255,255,255,0.88)";
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:3,minWidth:80 }}>
      <span style={{ fontSize:10,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:"0.06em" }}>{label}</span>
      <span style={{ fontSize:20,fontWeight:700,color,lineHeight:1 }}>
        {value}{unit&&<span style={{ fontSize:11,fontWeight:400,color:"rgba(255,255,255,0.4)",marginLeft:3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function Row({ label, value, col }: { label:string;value:React.ReactNode;col?:Col }) {
  return (
    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,minHeight:24 }}>
      <span style={{ fontSize:12,color:"rgba(255,255,255,0.4)" }}>{label}</span>
      <span style={{ fontSize:12,fontWeight:600,color:col?PALETTE[col]:"rgba(255,255,255,0.8)",textAlign:"right" }}>{value}</span>
    </div>
  );
}

function Divider() { return <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)" }} />; }

function Spark({ data, dataKey, color }: { data:PH["history"];dataKey:keyof PH["history"][0];color:string }) {
  if(!data||data.length<2) return <span style={{ fontSize:11,color:"rgba(255,255,255,0.25)" }}>no data yet</span>;
  return (
    <ResponsiveContainer width="100%" height={44}>
      <LineChart data={data} margin={{ top:2,right:2,left:2,bottom:2 }}>
        <Line type="monotone" dataKey={dataKey as string} stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Tooltip contentStyle={{ background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,fontSize:11 }} labelStyle={{ display:"none" }} formatter={(v:number)=>[typeof v==="number"?v.toFixed(1):v,String(dataKey)]} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Live Calls Panel ──────────────────────────────────────────────────────────

function EslTrace({ trace }: { trace: Array<{event:string;ts:string}> }) {
  if (!trace.length) return <span style={{ fontSize:10,color:"rgba(255,255,255,0.2)",fontStyle:"italic" }}>no ESL events</span>;
  return (
    <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginTop:4 }}>
      {trace.slice(-6).map((e,i) => (
        <span key={i} style={{ fontSize:9,background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.5)",borderRadius:4,padding:"2px 5px",fontFamily:"monospace" }}>
          {e.event.replace("CHANNEL_","").replace(/_/g," ")}
        </span>
      ))}
    </div>
  );
}

function LiveCallRow({ call }: { call: LiveCall }) {
  const [age, setAge] = useState(call.ageMs);
  useEffect(() => {
    const t = setInterval(() => setAge(a => a + 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const statusCol: Col = STATUS_COLORS[call.status] ?? "dim";
  const isIn = call.direction === "inbound";

  return (
    <div style={{
      background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,
      borderLeft:`3px solid ${PALETTE[statusCol]}`,
    }}>
      <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
        {dot(statusCol,7)}
        <span style={{ fontSize:12,fontWeight:700,color:PALETTE[statusCol],letterSpacing:"0.05em",textTransform:"uppercase" }}>
          {call.status}
        </span>
        <span style={{
          fontSize:10,padding:"2px 7px",borderRadius:8,fontWeight:600,
          background:isIn?"rgba(96,165,250,0.12)":"rgba(168,85,247,0.12)",
          color:isIn?B:"#a855f7",border:`1px solid ${isIn?"rgba(96,165,250,0.25)":"rgba(168,85,247,0.25)"}`,
        }}>
          {isIn?"↙ INBOUND":"↗ OUTBOUND"}
        </span>
        <span style={{ fontSize:11,color:"rgba(255,255,255,0.3)",marginLeft:"auto" }}>
          {fmtAge(age)}
        </span>
      </div>

      <div style={{ display:"flex",gap:20,flexWrap:"wrap" }}>
        <div style={{ display:"flex",flexDirection:"column",gap:2 }}>
          <span style={{ fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.06em" }}>{isIn?"From":"Caller"}</span>
          <span style={{ fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.85)",fontFamily:"monospace" }}>
            {call.callerNumber ?? "—"}
          </span>
        </div>
        <div style={{ display:"flex",alignItems:"center",color:"rgba(255,255,255,0.2)",fontSize:14,paddingTop:10 }}>→</div>
        <div style={{ display:"flex",flexDirection:"column",gap:2 }}>
          <span style={{ fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.06em" }}>To</span>
          <span style={{ fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.85)",fontFamily:"monospace" }}>
            {call.recipientNumber ?? "—"}
          </span>
        </div>
        {call.user && (
          <div style={{ display:"flex",flexDirection:"column",gap:2 }}>
            <span style={{ fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.06em" }}>User</span>
            <span style={{ fontSize:12,color:"rgba(255,255,255,0.6)" }}>
              {call.user.username}{call.user.extension ? ` (ext ${call.user.extension})` : ""}
            </span>
          </div>
        )}
      </div>

      <EslTrace trace={call.eslTrace} />

      {call.lastEslEvent && (
        <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)" }}>
          Last ESL: <span style={{ color:"rgba(255,255,255,0.5)",fontFamily:"monospace" }}>{call.lastEslEvent}</span>
          {call.lastEslEventAgeMs != null && <> · {fmtAge(call.lastEslEventAgeMs)} ago</>}
        </div>
      )}
    </div>
  );
}

function LiveCallsPanel({ sseActiveCalls, onTriggerRefresh }: { sseActiveCalls:number; onTriggerRefresh: () => void }) {
  const [data,    setData]    = useState<LiveCallsData | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef<() => void>(() => {});

  const fetchLive = useCallback(async () => {
    try {
      const d = await adminFetch("/admin/calls/live");
      setData(d);
    } catch { /* non-critical — show stale data */ }
    finally  { setLoading(false); }
  }, []);

  fetchRef.current = fetchLive;

  useEffect(() => {
    fetchLive();
    const t = setInterval(fetchLive, 4_000);
    return () => clearInterval(t);
  }, [fetchLive]);

  // When SSE reports activeCalls changed, immediately refetch
  useEffect(() => { fetchLive(); }, [sseActiveCalls, fetchLive]);

  const calls = data?.calls ?? [];

  return (
    <Card title={`Live Call Flow · ${sseActiveCalls > 0 ? sseActiveCalls : (data?.count ?? 0)} active`}
      accentColor={sseActiveCalls > 0 ? "rgba(34,197,94,0.35)" : undefined}>

      {loading && !data && (
        <div style={{ fontSize:12,color:"rgba(255,255,255,0.25)",padding:"8px 0" }}>Loading live calls…</div>
      )}

      {!loading && calls.length === 0 && (
        <div style={{ fontSize:12,color:"rgba(255,255,255,0.2)",padding:"8px 0",textAlign:"center" }}>
          No active calls right now
        </div>
      )}

      {calls.length > 0 && (
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {calls.map(c => <LiveCallRow key={c.id} call={c} />)}
        </div>
      )}

      {data && (
        <div style={{ fontSize:10,color:"rgba(255,255,255,0.2)",textAlign:"right" }}>
          Polled {new Date(data.asOf).toLocaleTimeString()} · auto-refreshes every 4s · instant on state change
        </div>
      )}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlatformHealth() {
  const [, nav] = useLocation();
  const [ph,         setPh]         = useState<PH | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [lastAt,     setLastAt]     = useState<Date | null>(null);
  const [sseStatus,  setSseStatus]  = useState<"connecting"|"connected"|"disconnected">("connecting");
  // Live metrics from SSE (overrides polled values for key counters)
  const [liveMetrics, setLiveMetrics] = useState<SseMetics | null>(null);

  // Full snapshot (sparklines etc.) — refresh every 60s
  const refresh = useCallback(async () => {
    try {
      const d = await adminFetch("/admin/platform-health");
      setPh(d);
      setError(null);
      setLastAt(new Date());
    } catch (e: any) {
      setError(e.message ?? "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // ── SSE connection ──────────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      setSseStatus("connecting");
      es = new EventSource("/api/admin/events/stream", { withCredentials: true });

      es.addEventListener("connected", () => setSseStatus("connected"));

      es.addEventListener("metrics", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as SseMetics;
          setLiveMetrics(d);
          setSseStatus("connected");
        } catch { /* ignore malformed */ }
      });

      es.onerror = () => {
        es.close();
        setSseStatus("disconnected");
        reconnectTimer = setTimeout(connect, 5_000);
      };
    }

    connect();
    return () => { es?.close(); clearTimeout(reconnectTimer); };
  }, []);

  // Merge: use SSE live values for real-time counters, fall back to snapshot
  const activeCalls  = liveMetrics?.activeCalls     ?? ph?.calls.activeCalls      ?? 0;
  const vertoCl      = liveMetrics?.activeVertoClients ?? ph?.websocket.activeVertoClients ?? 0;
  const sipCl        = liveMetrics?.activeSipClients   ?? ph?.websocket.activeSipClients   ?? 0;
  const uptime       = liveMetrics?.uptimeSeconds      ?? ph?.uptimeSeconds                ?? 0;

  const healthy = ph?.status === "ok";

  // ── Derived call stats from liveMetrics ────────────────────────────────────
  const initiated = liveMetrics?.callsInitiated ?? ph?.calls.callsInitiated ?? 0;
  const answered  = liveMetrics?.callsAnswered  ?? ph?.calls.callsAnswered  ?? 0;
  const answerPct = initiated > 0 ? ((answered / initiated) * 100).toFixed(1) : null;

  return (
    <div style={{ padding:"28px 24px",maxWidth:1280,margin:"0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:28,flexWrap:"wrap",gap:16 }}>
        <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
          <div style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
            <h1 style={{ fontSize:22,fontWeight:700,color:"rgba(255,255,255,0.95)",margin:0 }}>Platform Health</h1>

            {!loading && ph && (
              <span style={{
                display:"inline-flex",alignItems:"center",gap:7,padding:"4px 12px",borderRadius:20,
                fontSize:11,fontWeight:700,letterSpacing:"0.06em",
                background:healthy?"rgba(34,197,94,0.12)":"rgba(239,68,68,0.12)",
                border:`1px solid ${healthy?"rgba(34,197,94,0.3)":"rgba(239,68,68,0.3)"}`,
                color:healthy?G:R,
              }}>
                {dot(healthy?"green":"red",7)}{healthy?"HEALTHY":"DEGRADED"}
              </span>
            )}

            {/* SSE status pill */}
            <span style={{
              display:"inline-flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:14,fontSize:10,fontWeight:700,
              background:sseStatus==="connected"?"rgba(34,197,94,0.08)":sseStatus==="connecting"?"rgba(245,158,11,0.08)":"rgba(239,68,68,0.08)",
              border:`1px solid ${sseStatus==="connected"?"rgba(34,197,94,0.2)":sseStatus==="connecting"?"rgba(245,158,11,0.2)":"rgba(239,68,68,0.2)"}`,
              color:sseStatus==="connected"?G:sseStatus==="connecting"?A:R,
            }}>
              {dot(sseStatus==="connected"?"green":sseStatus==="connecting"?"amber":"red",6)}
              {sseStatus==="connected"?"LIVE":sseStatus==="connecting"?"CONNECTING…":"OFFLINE"}
            </span>
          </div>
          {lastAt && (
            <p style={{ fontSize:11,color:"rgba(255,255,255,0.3)",margin:0 }}>
              Uptime {fmtUptime(uptime)} · Snapshot {lastAt.toLocaleTimeString()} · Snapshot refreshes every 60s · Live counters via SSE
            </p>
          )}
        </div>

        <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
          <button onClick={() => { setLoading(true); refresh(); }} disabled={loading}
            style={{ padding:"7px 16px",borderRadius:10,fontSize:12,fontWeight:600,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.7)",cursor:loading?"wait":"pointer",opacity:loading?0.5:1 }}>
            {loading?"Refreshing…":"↻ Refresh snapshot"}
          </button>
          <button onClick={() => nav("/admin/dashboard")}
            style={{ padding:"7px 14px",borderRadius:10,fontSize:12,fontWeight:600,background:"transparent",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.4)",cursor:"pointer" }}>
            ← Dashboard
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ marginBottom:20,padding:"12px 16px",borderRadius:12,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",fontSize:13,color:R }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !ph && (
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14 }}>
          {Array.from({length:8}).map((_,i) => <div key={i} style={{ height:140,borderRadius:14,background:"rgba(255,255,255,0.04)" }} />)}
        </div>
      )}

      {/* ── Live counter bar (always visible once SSE connects) ── */}
      {liveMetrics && (
        <div style={{
          display:"flex",gap:12,flexWrap:"wrap",marginBottom:20,padding:"14px 18px",
          background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:12,
          alignItems:"center",
        }}>
          <span style={{ fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:G,marginRight:4 }}>⚡ Live</span>
          <Stat label="Active calls" value={activeCalls} col={activeCalls>0?"green":undefined} />
          <Stat label="Verto clients" value={vertoCl} col={vertoCl>0?"blue":undefined} />
          <Stat label="SIP clients" value={sipCl} col={sipCl>0?"blue":undefined} />
          <Stat label="Calls today" value={initiated} />
          <Stat label="Answer rate" value={answerPct ? `${answerPct}%` : "—"} col={answerPct ? (parseFloat(answerPct) < 70 ? "red" : parseFloat(answerPct) < 85 ? "amber" : "green") : undefined} />
          <Stat label="Uptime" value={fmtUptime(uptime)} />
        </div>
      )}

      {ph && (
        <>
          {/* ── Live Calls (full width) ── */}
          <div style={{ marginBottom:14 }}>
            <LiveCallsPanel sseActiveCalls={activeCalls} onTriggerRefresh={() => {}} />
          </div>

          {/* ── Row 1: Critical subsystems ── */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14,marginBottom:14 }}>

            <Card title="Database" accentColor={ph.db.ok?undefined:"rgba(239,68,68,0.4)"}>
              <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                {dot(ph.db.ok?"green":"red")}
                <span style={{ fontSize:15,fontWeight:700,color:ph.db.ok?"rgba(255,255,255,0.9)":R }}>
                  {ph.db.ok?"Connected":"Disconnected"}
                </span>
              </div>
              <Divider />
              <div style={{ display:"flex",gap:20 }}>
                <Stat label="Latency" value={ph.db.latencyMs} unit="ms" col={ph.db.latencyMs>100?"amber":ph.db.latencyMs>50?"amber":undefined} />
                <Stat label="State" value={["Off","Ready","Connecting","Closing","Uninit"][ph.db.state]??ph.db.state} />
              </div>
            </Card>

            <Card title="FreeSWITCH ESL" accentColor={!ph.esl.enabled?"rgba(245,158,11,0.3)":ph.esl.connected?undefined:"rgba(239,68,68,0.4)"}>
              <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                {dot(!ph.esl.enabled?"dim":ph.esl.connected?"green":"red")}
                <span style={{ fontSize:15,fontWeight:700,color:!ph.esl.enabled?"rgba(255,255,255,0.35)":ph.esl.connected?"rgba(255,255,255,0.9)":R }}>
                  {!ph.esl.enabled?"Not configured":ph.esl.connected?"Connected":"Disconnected"}
                </span>
                {ph.esl.enabled&&!ph.esl.connected&&ph.esl.disconnectedMs!=null&&(
                  <span style={{ fontSize:11,color:A,background:"rgba(245,158,11,0.1)",borderRadius:8,padding:"2px 8px" }}>{Math.round(ph.esl.disconnectedMs/1000)}s down</span>
                )}
              </div>
              <Divider />
              <div style={{ display:"flex",gap:16,flexWrap:"wrap" }}>
                <Stat label="Events/min" value={ph.esl.eventsThisMinute} />
                <Stat label="Last event" value={ph.esl.lastEventStaleSec===null?"—":`${ph.esl.lastEventStaleSec}s ago`} col={(ph.esl.lastEventStaleSec??0)>120?"red":(ph.esl.lastEventStaleSec??0)>60?"amber":undefined} />
                <Stat label="Reconnects" value={ph.esl.reconnectAttempt} col={ph.esl.reconnectAttempt>0?"amber":undefined} />
                <Stat label="BgAPI Q" value={ph.esl.bgapiQueueDepth} col={ph.esl.bgapiQueueDepth>50?"amber":undefined} />
              </div>
              {ph.esl.lastDisconnectReason&&(
                <div style={{ fontSize:11,color:A,background:"rgba(245,158,11,0.08)",borderRadius:8,padding:"6px 10px",fontFamily:"monospace" }}>{ph.esl.lastDisconnectReason}</div>
              )}
            </Card>

            <Card title="WebSocket / SIP">
              <div style={{ display:"flex",gap:16,flexWrap:"wrap" }}>
                <Stat label="Verto WS" value={vertoCl} col={vertoCl>0?"blue":undefined} />
                <Stat label="SIP WS"   value={sipCl}   col={sipCl>0?"blue":undefined} />
                <Stat label="SIP Reg"  value={ph.websocket.sipRegistrationsInMemory} />
              </div>
              <Divider />
              <Row label="Verto sessions (mem)"         value={ph.websocket.vertoSessionsInMemory} />
              <Row label="Upstream reconnects (Verto)"  value={ph.websocket.activeUpstreamReconnectsVerto} col={ph.websocket.activeUpstreamReconnectsVerto>0?"amber":undefined} />
              <Row label="Upstream reconnects (SIP)"    value={ph.websocket.activeUpstreamReconnectsSip}   col={ph.websocket.activeUpstreamReconnectsSip>0?"amber":undefined} />
              <Row label="Rejected (IP limit)"          value={ph.websocket.wsConnectionsRejectedIpLimit}  col={ph.websocket.wsConnectionsRejectedIpLimit>0?"amber":undefined} />
            </Card>

          </div>

          {/* ── Row 2: Calls / Security / Sweeper / Push ── */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14,marginBottom:14 }}>

            <Card title="Call Stats">
              <div style={{ display:"flex",gap:16,flexWrap:"wrap" }}>
                <Stat label="Active"   value={activeCalls} col={activeCalls>0?"green":undefined} />
                <Stat label="Today"    value={initiated} />
                <Stat label="Answered" value={answered} />
                <Stat label="Answer %" value={ph.calls.answerRatePct!==null?`${ph.calls.answerRatePct.toFixed(1)}%`:"—"}
                  col={ph.calls.answerRatePct!==null&&ph.calls.answerRatePct<70?"red":ph.calls.answerRatePct!==null&&ph.calls.answerRatePct<85?"amber":"green"} />
              </div>
              <Divider />
              <Row label="Failed"              value={ph.calls.callsFailed}        col={ph.calls.callsFailed>0?"amber":undefined} />
              <Row label="Failed originates"   value={ph.calls.failedOriginates}   col={ph.calls.failedOriginates>0?"amber":undefined} />
              <Row label="RTP failures"        value={ph.calls.rtpFailures}        col={ph.calls.rtpFailures>0?"amber":undefined} />
              <Row label="ICE failures"        value={ph.calls.iceFailures}        col={ph.calls.iceFailures>0?"amber":undefined} />
              <Row label="No-bridge timeouts"  value={ph.calls.noBridgeTimeouts}   col={ph.calls.noBridgeTimeouts>0?"amber":undefined} />
              <Row label="Voicemail fallbacks" value={ph.calls.voicemailFallbacks} />
              {ph.calls.callSetupLatency&&(
                <>
                  <Divider />
                  <Row label="Setup latency p50" value={`${ph.calls.callSetupLatency.p50}ms`} />
                  <Row label="Setup latency p95" value={`${ph.calls.callSetupLatency.p95}ms`} col={ph.calls.callSetupLatency.p95>3000?"amber":undefined} />
                </>
              )}
            </Card>

            <Card title="Security" accentColor={ph.security.sipFloodBlocked>0||ph.security.bgapiQueueDropped>0?"rgba(245,158,11,0.3)":undefined}>
              <div style={{ display:"flex",gap:16,flexWrap:"wrap" }}>
                <Stat label="SIP Flood" value={ph.security.sipFloodBlocked} col={ph.security.sipFloodBlocked>0?"amber":undefined} />
                <Stat label="Throttled" value={ph.security.callThrottleRejections} col={ph.security.callThrottleRejections>0?"amber":undefined} />
              </div>
              <Divider />
              <Row label="Reg failures"  value={ph.security.registrationFailures} col={ph.security.registrationFailures>10?"amber":undefined} />
              <Row label="BgAPI dropped" value={ph.security.bgapiQueueDropped}    col={ph.security.bgapiQueueDropped>0?"red":undefined} />
            </Card>

            <Card title="Session Sweeper">
              <div style={{ display:"flex",gap:16,flexWrap:"wrap" }}>
                <Stat label="Sweep runs" value={ph.sweeper.staleSweepRuns} />
                <Stat label="Cleaned"    value={ph.sweeper.staleSessionCleanups} />
                <Stat label="Zombies"    value={ph.sweeper.zombieCallsKilled} col={ph.sweeper.zombieCallsKilled>0?"amber":undefined} />
              </div>
            </Card>

            <Card title="Push Notifications">
              <div style={{ display:"flex",gap:20,flexWrap:"wrap" }}>
                <Stat label="FCM sent"  value={ph.push.fcm.sent} />
                <Stat label="Web sent"  value={ph.push.web.sent} />
                <Stat label="Expo sent" value={ph.push.expo.sent} />
                <Stat label="Wakeups"   value={ph.push.wakeups} />
              </div>
              {(ph.push.fcm.failed>0||ph.push.web.failed>0||ph.push.expo.failed>0)&&(
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
          <div style={{ marginBottom:14 }}>
            <Card title="Process" accentColor={(ph.process.loopLagMs>100||ph.process.heapUsedMb>400)?"rgba(245,158,11,0.3)":undefined}>
              <div style={{ display:"flex",gap:24,flexWrap:"wrap" }}>
                <Stat label="Heap used"  value={ph.process.heapUsedMb.toFixed(1)}  unit="MiB" col={ph.process.heapUsedMb>400?"amber":undefined} />
                <Stat label="Heap total" value={ph.process.heapTotalMb.toFixed(1)} unit="MiB" />
                <Stat label="RSS"        value={ph.process.rssMb.toFixed(1)}        unit="MiB" />
                <Stat label="Loop lag"   value={ph.process.loopLagMs.toFixed(1)}   unit="ms"  col={ph.process.loopLagMs>100?"amber":ph.process.loopLagMs>50?"amber":undefined} />
                <Stat label="CPU user"   value={Math.round(ph.process.cpuUserMs)}  unit="ms" />
                <Stat label="CPU sys"    value={Math.round(ph.process.cpuSysMs)}   unit="ms" />
              </div>
              {ph.process.sampledAt&&<p style={{ fontSize:11,color:"rgba(255,255,255,0.25)",margin:0 }}>Sampled {ago(ph.process.sampledAt)}</p>}
            </Card>
          </div>

          {/* ── Row 4: Sparkline history ── */}
          {ph.history.length>1&&(
            <>
              <p style={{ fontSize:10,fontWeight:700,letterSpacing:"0.09em",textTransform:"uppercase",color:"rgba(255,255,255,0.3)",margin:"0 0 10px" }}>
                15-minute history ({ph.history.length} samples)
              </p>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14 }}>
                <Card title="Heap (MiB)"><Spark data={ph.history} dataKey="heapUsedMb" color={B} /></Card>
                <Card title="Event-loop lag (ms)" accentColor={ph.process.loopLagMs>100?"rgba(245,158,11,0.3)":undefined}>
                  <Spark data={ph.history} dataKey="loopLagMs" color={ph.process.loopLagMs>100?A:G} />
                </Card>
                <Card title="Active calls"><Spark data={ph.history} dataKey="activeCalls" color="#a78bfa" /></Card>
                <Card title="Verto WS clients"><Spark data={ph.history} dataKey="wsVertoClients" color="#fb923c" /></Card>
              </div>
            </>
          )}

          <p style={{ fontSize:11,color:"rgba(255,255,255,0.2)",marginTop:24 }}>
            Snapshot refreshes every 60s · Live counters & call events via SSE (no polling lag) · as of {new Date(ph.ts).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}
