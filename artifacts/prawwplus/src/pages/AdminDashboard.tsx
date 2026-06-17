import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function adminFetch(path: string, opts?: RequestInit) {
  const method = (opts?.method ?? "GET").toUpperCase();
  const csrfHeaders: Record<string, string> =
    ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? { "X-CSRF-Token": getCsrfToken() }
      : {};
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders, ...(opts?.headers ?? {}) },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

type StatusColor = "green" | "amber" | "red";

function dot(color: StatusColor) {
  const c = color === "green" ? "#34d399" : color === "amber" ? "#f59e0b" : "#f87171";
  return (
    <span style={{
      display: "inline-block", width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
      background: c, boxShadow: `0 0 6px ${c}`,
    }} />
  );
}

function Card({
  title, status, children,
}: { title: string; status?: StatusColor; children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16, padding: "20px 22px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {status && dot(status)}
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.5)",
        }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Row({
  label, value, status,
}: { label: string; value: React.ReactNode; status?: StatusColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 26 }}>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {status && dot(status)}
        <span style={{
          fontSize: 12, fontWeight: 600, textAlign: "right",
          color: status === "red" ? "#f87171" : status === "amber" ? "#f59e0b" : "rgba(255,255,255,0.85)",
        }}>
          {value}
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "2px 0" }} />;
}

function Alert({ type, children }: { type: "error" | "warn" | "ok"; children: React.ReactNode }) {
  const colors = {
    error: { bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.25)", text: "#f87171" },
    warn:  { bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.25)",  text: "#f59e0b" },
    ok:    { bg: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.18)",  text: "#34d399" },
  }[type];
  return (
    <div style={{
      padding: "8px 12px", borderRadius: 9,
      background: colors.bg, border: `1px solid ${colors.border}`,
    }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: colors.text, margin: 0 }}>{children}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
      color: "rgba(255,255,255,0.3)", margin: "6px 0 4px",
    }}>
      {children}
    </p>
  );
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();

  const [ph,    setPh]    = useState<any>(null);
  const [sm,    setSm]    = useState<any>(null);
  const [regs,  setRegs]  = useState<any>(null);
  const [live,  setLive]  = useState<any>(null);
  const [users, setUsers] = useState<any>(null);
  const [cdr,   setCdr]   = useState<any>(null);
  const [db,    setDb]    = useState<any>(null);
  const [gw,    setGw]    = useState<any>(null);
  const [lookup, setLookup] = useState<{ ok: boolean; value: string | null } | null>(null);

  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown,   setCountdown]   = useState(30);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rPh, rSm, rRegs, rLive, rUsers, rCdr, rDb, rGw] = await Promise.allSettled([
        adminFetch("/admin/platform-health"),
        adminFetch("/admin/system-metrics"),
        adminFetch("/admin/live-registrations"),
        adminFetch("/admin/calls/live"),
        adminFetch("/admin/users?limit=200"),
        adminFetch("/admin/calls?limit=10"),
        adminFetch("/admin/db-info"),
        adminFetch("/admin/gateway-status"),
      ]);

      if (rPh.status    === "fulfilled") setPh(rPh.value);
      if (rSm.status    === "fulfilled") setSm(rSm.value);
      if (rRegs.status  === "fulfilled") setRegs(rRegs.value);
      if (rLive.status  === "fulfilled") setLive(rLive.value);
      if (rUsers.status === "fulfilled") setUsers(rUsers.value);
      if (rCdr.status   === "fulfilled") setCdr(rCdr.value);
      if (rDb.status    === "fulfilled") setDb(rDb.value);
      if (rGw.status    === "fulfilled") setGw(rGw.value);

      // Lookup health is derived from DB + ESL state — the /freeswitch/lookup
      // endpoint is loopback-only (FreeSWITCH server → API) and cannot be called
      // from browser JS.  We infer health from platform-health + db-info instead.
      try {
        const eslOk   = rPh.status === "fulfilled" && rPh.value?.esl?.connected === true;
        const dbOk    = rDb.status === "fulfilled"  && rDb.value?.connected      === true;
        setLookup({ ok: eslOk && dbOk, value: eslOk && dbOk ? "inferred" : null });
      } catch {
        setLookup({ ok: false, value: null });
      }
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
      setCountdown(30);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { refresh(); return 30; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const eslEnabled   = ph?.esl?.enabled ?? false;
  const eslConnected = ph?.esl?.connected ?? false;
  const activeCalls  = live?.calls?.length ?? 0;
  const totalOnline  = regs?.totalOnline ?? 0;
  const vertoAlive   = (regs?.verto ?? []).filter((s: any) => s.alive).length;
  const sipAlive     = (regs?.sip   ?? []).filter((s: any) => s.alive).length;

  const dbConnected  = db?.connected ?? false;
  const dbName       = db?.dbName ?? null;
  const dbCorrect    = db?.correctDb ?? false;

  const allUsers   = users?.users ?? [];
  const totalUsers = users?.total ?? 0;
  const withExt    = allUsers.filter((u: any) => u.extension).length;
  const withoutExt = allUsers.filter((u: any) => !u.extension).length;

  const onlineExts = new Set([
    ...(regs?.verto ?? []).filter((s: any) => s.alive).map((s: any) => s.extension),
    ...(regs?.sip   ?? []).filter((s: any) => s.alive).map((s: any) => s.extension),
  ]);

  const voipStatus: StatusColor   = !eslEnabled ? "amber" : eslConnected ? "green" : "red";
  const apiStatus: StatusColor    = dbConnected ? "green" : "red";
  const lookupStatus: StatusColor = lookup === null ? "amber" : lookup.ok ? "green" : "red";
  const usersStatus: StatusColor  = withoutExt > 0 ? "amber" : "green";

  // PSTN gateway derived state
  const gwConfigured   = gw?.configured ?? false;
  const gwEslOk        = gw?.eslConnected ?? false;
  const gwInfo         = gw?.gateway ?? null;
  const gwName         = gw?.gatewayName ?? null;
  const gwCodec        = gw?.codec ?? null;
  const gwRegistered   = gwInfo?.registered === true;
  const gwTrying       = gwInfo?.trying === true;
  const gwFailed       = gwInfo?.failed === true;
  const gwState        = gwInfo?.state ?? null;
  const gwStatus: StatusColor = !gwConfigured
    ? "amber"
    : !gwEslOk
    ? "amber"
    : gwRegistered
    ? "green"
    : gwTrying
    ? "amber"
    : "red";

  return (
    <div style={{ padding: "24px 20px", maxWidth: 1120, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 24, flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.95)", margin: 0 }}>
            Platform Dashboard
          </h1>
          {lastRefresh && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "4px 0 0" }}>
              Refreshed {lastRefresh.toLocaleTimeString()} · Next in {countdown}s
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={refresh} disabled={loading}
            style={{
              padding: "7px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.75)", cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.55 : 1,
            }}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
          <button
            onClick={() => setLocation("/admin/platform-health")}
            style={{
              padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)",
              color: "#60a5fa", cursor: "pointer",
            }}
          >
            ⬡ Platform Health
          </button>
          <button
            onClick={() => setLocation("/admin")}
            style={{
              padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              background: "transparent", border: "1px solid rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.4)", cursor: "pointer",
            }}
          >
            ← Admin
          </button>
        </div>
      </div>

      {/* ── Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(490px, 1fr))", gap: 14 }}>

        {/* ══ VoIP / FreeSWITCH ══ */}
        <Card title="VoIP / FreeSWITCH" status={voipStatus}>
          <Row
            label="FreeSWITCH ESL"
            value={!eslEnabled ? "Not configured" : eslConnected ? "Connected" : "Disconnected"}
            status={!eslEnabled ? "amber" : eslConnected ? "green" : "red"}
          />
          {eslEnabled && ph?.esl?.host && (
            <Row label="Host" value={`${ph.esl.host}:${ph.esl.port ?? 8021}`} />
          )}
          {eslEnabled && !eslConnected && ph?.esl?.lastDisconnectReason && (
            <Row label="Disconnect reason" value={ph.esl.lastDisconnectReason} status="red" />
          )}
          {eslEnabled && ph?.esl?.reconnectAttempt != null && !eslConnected && (
            <Row label="Reconnect attempt" value={String(ph.esl.reconnectAttempt)} status="amber" />
          )}

          <Divider />

          <Row label="Active calls" value={String(activeCalls)} status={activeCalls > 0 ? "green" : undefined} />
          <Row label="Users online"  value={String(totalOnline)} status={totalOnline > 0 ? "green" : "amber"} />
          <Row label="Verto (WebRTC)" value={`${vertoAlive} registered`} />
          <Row label="SIP (mobile)"   value={`${sipAlive} registered`} />

          {/* SIP profiles — inferred from ESL state when connected */}
          {eslEnabled && (
            <>
              <Divider />
              <SectionLabel>SIP Profiles</SectionLabel>
              <Row
                label="prawwplus_mobile (port 5066)"
                value={eslConnected ? "RUNNING" : "UNKNOWN"}
                status={eslConnected ? "green" : "amber"}
              />
              <Row
                label="Verto default-v4 (port 8081)"
                value={eslConnected ? "RUNNING" : "UNKNOWN"}
                status={eslConnected ? "green" : "amber"}
              />
            </>
          )}

          {/* Recent CDR */}
          {cdr?.calls?.length > 0 && (
            <>
              <Divider />
              <SectionLabel>Recent Call Activity (last 10)</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {cdr.calls.map((c: any) => {
                  const sc = c.status === "completed" ? "#34d399"
                    : c.status === "answered" ? "#60a5fa"
                    : c.status === "failed"    ? "#f87171"
                    : "rgba(255,255,255,0.35)";
                  return (
                    <div key={c.id ?? c._id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "5px 9px", borderRadius: 7, background: "rgba(255,255,255,0.03)", gap: 8,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)",
                          display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {c.username ?? "—"} → {c.recipientNumber ?? "?"}
                        </span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>
                          {c.callType ?? c.type ?? "—"}
                          {c.duration != null ? ` · ${c.duration}s` : ""}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sc, textTransform: "uppercase", flexShrink: 0 }}>
                        {c.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        {/* ══ API & Infrastructure ══ */}
        <Card title="API & Infrastructure" status={apiStatus}>
          <Row
            label="API server"
            value={sm ? "Running" : "Unknown"}
            status={sm ? "green" : "amber"}
          />
          {sm?.process && (
            <>
              <Row label="Process uptime"  value={uptime(sm.process.uptimeS)} />
              <Row label="Heap used"       value={`${Math.round(sm.process.heapUsedKb / 1024)} MB`} />
              <Row label="RSS"             value={`${Math.round(sm.process.rssKb / 1024)} MB`} />
              <Row label="PID"             value={String(sm.process.pid)} />
            </>
          )}
          {sm?.system && (
            <>
              <Row label="Host uptime" value={uptime(sm.system.uptimeS)} />
              <Row label="Platform"    value={`${sm.system.platform} ${sm.system.arch}`} />
              <Row label="Hostname"    value={sm.system.hostname} />
            </>
          )}
          {sm?.cpu && (
            <Row
              label="CPU avg"
              value={`${sm.cpu.avgUsagePct}% (${sm.cpu.cores} cores)`}
              status={sm.cpu.avgUsagePct > 85 ? "red" : sm.cpu.avgUsagePct > 60 ? "amber" : "green"}
            />
          )}
          {sm?.memory && (
            <Row
              label="System RAM"
              value={`${sm.memory.usedMb} / ${sm.memory.totalMb} MB (${sm.memory.usedPct}%)`}
              status={sm.memory.usedPct > 90 ? "red" : sm.memory.usedPct > 75 ? "amber" : "green"}
            />
          )}

          <Divider />

          <Row
            label="MongoDB"
            value={dbConnected ? "Connected" : "Disconnected"}
            status={dbConnected ? "green" : "red"}
          />
          {dbName ? (
            <Row
              label="Database name"
              value={dbName}
              status={dbCorrect ? "green" : "red"}
            />
          ) : (
            <Row label="Database name" value="unknown" status="amber" />
          )}
          {dbName && !dbCorrect && (
            <Alert type="error">
              ⚠ Wrong database "{dbName}" — expected "prawwplus". Calls will not route. Check MONGODB_URI.
            </Alert>
          )}

          <Row
            label="ESL connection"
            value={!eslEnabled ? "Disabled" : eslConnected ? "Connected" : "Disconnected"}
            status={!eslEnabled ? "amber" : eslConnected ? "green" : "red"}
          />
          {ph?.eslBuffer != null && (
            <Row label="ESL event buffer depth" value={String(ph.eslBuffer.depth ?? 0)} />
          )}
        </Card>

        {/* ══ Phone Number Lookup Health ══ */}
        <Card title="Phone Number Lookup Health" status={lookupStatus}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: 0 }}>
            Live test:{" "}
            <code style={{ fontSize: 11, background: "rgba(255,255,255,0.07)", padding: "2px 6px", borderRadius: 4 }}>
              GET /api/freeswitch/lookup?number=0763155369
            </code>
          </p>

          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0 }}>
            Health is inferred from ESL + DB status — the lookup endpoint is
            loopback-only (FreeSWITCH → API) and is not reachable from the browser.
          </p>

          {lookup === null && (
            <Alert type="warn">Checking…</Alert>
          )}
          {lookup !== null && lookup.ok && (
            <Alert type="ok">
              ✓ Routing stack healthy — ESL connected and database reachable.
            </Alert>
          )}
          {lookup !== null && !lookup.ok && (
            <Alert type="error">
              ✗ Routing degraded — ESL or database is not healthy. Check cards above.
            </Alert>
          )}

          <Divider />

          <Row
            label="MongoDB database"
            value={dbName ?? (dbConnected ? "unknown" : "not connected")}
            status={!dbConnected ? "red" : dbCorrect ? "green" : "red"}
          />
          {dbConnected && dbCorrect && (
            <Alert type="ok">✓ Database "{dbName}" is correct — phone lookups will route.</Alert>
          )}
          {dbConnected && !dbCorrect && dbName && (
            <Alert type="error">
              Wrong database — calls will not route
            </Alert>
          )}
        </Card>

        {/* ══ PSTN Gateway ══ */}
        <Card title="PSTN Trunk / Gateway" status={gwStatus}>
          {!gwConfigured ? (
            <>
              <Row label="Configuration" value="Not configured" status="amber" />
              <Alert type="warn">
                Set PSTN_GATEWAY_NAME and credentials in environment secrets to enable external calls.
              </Alert>
            </>
          ) : !gwEslOk ? (
            <>
              <Row label="Gateway" value={gwName ?? "—"} />
              <Row label="ESL" value="Not connected" status="amber" />
              <Alert type="warn">ESL must be connected to query gateway registration state.</Alert>
            </>
          ) : gwInfo === null ? (
            <>
              <Row label="Gateway" value={gwName ?? "—"} />
              <Row label="Registration" value="Not found in FreeSWITCH" status="red" />
              <Alert type="error">
                Gateway "{gwName}" not registered in FreeSWITCH. Push config and reload Sofia.
              </Alert>
            </>
          ) : (
            <>
              <Row
                label="Registration"
                value={
                  gwRegistered ? "REGISTERED"
                    : gwTrying  ? "TRYING"
                    : gwFailed  ? "NOT REGISTERED"
                    : gwState ?? "UNKNOWN"
                }
                status={
                  gwRegistered ? "green"
                    : gwTrying  ? "amber"
                    : "red"
                }
              />
              <Row label="Gateway name"  value={gwName ?? "—"} />
              {gwInfo?.realm    && <Row label="Realm / Proxy"  value={String(gwInfo.realm)} />}
              {gwInfo?.username && <Row label="SIP username"   value={String(gwInfo.username)} />}
              {gwInfo?.profile  && <Row label="SIP profile"    value={String(gwInfo.profile)} />}
              {gwCodec          && <Row label="Codec"          value={gwCodec} />}
              {gwInfo?.scheme   && <Row label="Auth scheme"    value={String(gwInfo.scheme)} />}

              <Divider />

              {gwInfo?.expires != null && (
                <Row label="Reg TTL"     value={`${gwInfo.expires}s`} />
              )}
              {gwInfo?.freq != null && (
                <Row label="Reg freq"    value={`every ${gwInfo.freq}s`} />
              )}
              {gwInfo?.uptimeHuman ? (
                <Row label="Uptime" value={String(gwInfo.uptimeHuman)} status="green" />
              ) : gwRegistered ? (
                <Row label="Uptime" value="<1s" />
              ) : null}
              {gwInfo?.pingState && gwInfo.pingState !== "0/0/0" && (
                <Row label="Ping state" value={String(gwInfo.pingState)} />
              )}

              <Divider />
              <SectionLabel>Call Counters</SectionLabel>

              <Row label="Calls in"          value={String(gwInfo?.callsIn  ?? 0)} />
              <Row label="Calls out"         value={String(gwInfo?.callsOut ?? 0)} />
              {(gwInfo?.failedCallsIn ?? 0) > 0 && (
                <Row label="Failed in"  value={String(gwInfo.failedCallsIn)}  status="red" />
              )}
              {(gwInfo?.failedCallsOut ?? 0) > 0 && (
                <Row label="Failed out" value={String(gwInfo.failedCallsOut)} status="red" />
              )}

              {gwRegistered && (
                <Alert type="ok">✓ PSTN trunk is registered — external calls are enabled.</Alert>
              )}
              {gwTrying && (
                <Alert type="warn">⏳ FreeSWITCH is attempting SIP registration with the carrier…</Alert>
              )}
              {gwFailed && (
                <Alert type="error">
                  ✗ Gateway failed to register. Check SIP credentials and carrier connectivity.
                </Alert>
              )}
            </>
          )}

          {gw?.checkedAt && (
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", margin: "4px 0 0" }}>
              Checked {new Date(gw.checkedAt).toLocaleTimeString()}
            </p>
          )}
        </Card>

        {/* ══ Users ══ */}
        <Card title="Users" status={usersStatus}>
          <Row label="Total registered"   value={String(totalUsers)} />
          <Row
            label="With extensions"
            value={String(withExt)}
            status={withExt > 0 ? "green" : "amber"}
          />
          <Row
            label="Without extensions"
            value={String(withoutExt)}
            status={withoutExt > 0 ? "amber" : "green"}
          />
          {withoutExt > 0 && (
            <Alert type="warn">
              {withoutExt} user{withoutExt !== 1 ? "s" : ""} need extension provisioning.
            </Alert>
          )}

          <Divider />
          <SectionLabel>All Users</SectionLabel>

          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 400, overflowY: "auto" }}>
            {allUsers.map((u: any) => {
              const ext      = u.extension ?? null;
              const isOnline = ext != null && onlineExts.has(ext);
              const dotC     = isOnline ? "#34d399" : "rgba(255,255,255,0.13)";
              return (
                <div key={u._id ?? u.id} style={{
                  display: "grid",
                  gridTemplateColumns: "9px 1fr auto auto",
                  alignItems: "center", gap: 10,
                  padding: "7px 9px", borderRadius: 8,
                  background: "rgba(255,255,255,0.025)",
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%", background: dotC,
                    boxShadow: isOnline ? `0 0 5px ${dotC}` : "none",
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)",
                      display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {u.name ?? u.username ?? u.email ?? "Unknown"}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>
                      {u.phone ?? "no phone"}{u.phoneVerified ? " ✓" : ""}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: ext ? "#60a5fa" : "rgba(255,255,255,0.2)", flexShrink: 0,
                  }}>
                    {ext ? `ext ${ext}` : "—"}
                  </span>
                  <span style={{
                    fontSize: 10,
                    color: isOnline ? "#34d399" : "rgba(255,255,255,0.22)", flexShrink: 0,
                  }}>
                    {isOnline ? "online" : "offline"}
                  </span>
                </div>
              );
            })}
            {allUsers.length === 0 && (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", margin: "4px 0" }}>
                {loading ? "Loading…" : "No users found"}
              </p>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
