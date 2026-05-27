import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft, Wifi, Server, Globe,
  ClipboardCopy, RotateCcw, CheckCircle2, XCircle,
  AlertCircle, Loader2, Mic,
  Zap, AlertTriangle, Info,
} from "lucide-react";
import { useLocation } from "wouter";
import { useCall } from "@/context/CallContext";

// ─── helpers ────────────────────────────────────────────────────────────────

type Severity = "ok" | "warning" | "critical" | "info" | "loading" | "unknown";

interface DiagResult {
  id: string;
  label: string;
  severity: Severity;
  value: string;
  fix?: string;
}

function SeverityIcon({ severity }: { severity: Severity }) {
  const sz = 14;
  if (severity === "ok")       return <CheckCircle2 size={sz} style={{ color: "#30d158", flexShrink: 0 }} />;
  if (severity === "critical") return <XCircle      size={sz} style={{ color: "#ff453a", flexShrink: 0 }} />;
  if (severity === "warning")  return <AlertTriangle size={sz} style={{ color: "#ff9f0a", flexShrink: 0 }} />;
  if (severity === "info")     return <Info         size={sz} style={{ color: "#636366", flexShrink: 0 }} />;
  if (severity === "loading")  return <Loader2      size={sz} style={{ color: "#636366", flexShrink: 0, animation: "spin 1s linear infinite" }} />;
  return <AlertCircle size={sz} style={{ color: "#636366", flexShrink: 0 }} />;
}

function severityColor(s: Severity): string {
  if (s === "ok")       return "#30d158";
  if (s === "critical") return "#ff453a";
  if (s === "warning")  return "#ff9f0a";
  return "#636366";
}

function severityBg(s: Severity): string {
  if (s === "ok")       return "rgba(48,209,88,0.08)";
  if (s === "critical") return "rgba(255,69,58,0.08)";
  if (s === "warning")  return "rgba(255,159,10,0.08)";
  return "rgba(255,255,255,0.04)";
}

function severityBorder(s: Severity): string {
  if (s === "ok")       return "1px solid rgba(48,209,88,0.2)";
  if (s === "critical") return "1px solid rgba(255,69,58,0.2)";
  if (s === "warning")  return "1px solid rgba(255,159,10,0.2)";
  return "1px solid rgba(255,255,255,0.07)";
}

function DiagCard({ result }: { result: DiagResult }) {
  const [showFix, setShowFix] = useState(false);
  return (
    <div style={{ background: severityBg(result.severity), border: severityBorder(result.severity), borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <SeverityIcon severity={result.severity} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{result.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: severityColor(result.severity), textTransform: "uppercase", letterSpacing: "0.07em", flexShrink: 0 }}>{result.severity}</span>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "3px 0 0", lineHeight: 1.4 }}>{result.value}</p>
        </div>
      </div>
      {result.fix && (
        <div style={{ marginLeft: 23 }}>
          {!showFix ? (
            <button
              onClick={() => setShowFix(true)}
              style={{ fontSize: 11, color: "#1a8cff", background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600 }}
            >
              How to fix →
            </button>
          ) : (
            <div style={{ background: "rgba(26,140,255,0.08)", border: "1px solid rgba(26,140,255,0.2)", borderRadius: 8, padding: "8px 10px" }}>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.5 }}>{result.fix}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 4, marginBottom: 8 }}>
        <span style={{ color: "var(--text-3)", display: "flex" }}>{icon}</span>
        <p className="section-label" style={{ margin: 0 }}>{title}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

// ─── ICE/TURN probe ──────────────────────────────────────────────────────────

async function probeIceServers(iceServers: RTCIceServer[]): Promise<{ hasRelay: boolean; hasHost: boolean; hasSrflx: boolean; durationMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const pc = new RTCPeerConnection({ iceServers });
    let hasRelay = false, hasHost = false, hasSrflx = false;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try { pc.close(); } catch {}
      resolve({ hasRelay, hasHost, hasSrflx, durationMs: Date.now() - start });
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) { finish(); return; }
      const t = e.candidate.type;
      if (t === "relay")  hasRelay = true;
      if (t === "host")   hasHost  = true;
      if (t === "srflx")  hasSrflx = true;
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };

    pc.createDataChannel("probe");
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(finish);

    setTimeout(finish, 8000);
  });
}

// ─── Microphone probe ────────────────────────────────────────────────────────

async function checkMicrophone(): Promise<"granted" | "denied" | "unavailable"> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (err: any) {
    if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") return "denied";
    return "unavailable";
  }
}

// ─── Server-side TURN health probe ──────────────────────────────────────────

interface TurnHealthResult {
  ok: boolean;
  hasTurn: boolean;
  onlyStun: boolean;
  turnDown: boolean;
  turnReachable: boolean;
  summary: string;
  servers: Array<{ url: string; scheme: string; reachable: boolean; latencyMs: number; isTurn: boolean }>;
  managedTurn: boolean;
  turnHost: string | null;
}

// ─── FreeSWITCH status type ─────────────────────────────────────────────────

interface FsStatus {
  ok: boolean;
  extension?: number;
  domain?: string;
  phone?: string | null;
  phoneVerified?: boolean;
  vertoWsUrl?: string;
  directoryUrl?: string;
  webhookSecretConfigured?: boolean;
  xmlPreview?: string;
  reason?: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  const [, setLocation] = useLocation();
  const { isVertoConnected, vertoError, vertoConfig } = useCall();

  const [results, setResults] = useState<DiagResult[]>([]);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fsStatus, setFsStatus] = useState<FsStatus | null>(null);
  const runRef = useRef(false);

  const runAll = useCallback(async () => {
    if (runRef.current) return;
    runRef.current = true;
    setRunning(true);
    setResults([]);

    const out: DiagResult[] = [];

    const push = (r: DiagResult) => {
      out.push(r);
      setResults([...out]);
    };

    // ── 1. Network ──────────────────────────────────────────────────────────
    const online = navigator.onLine;
    push({
      id: "network",
      label: "Internet Connection",
      severity: online ? "ok" : "critical",
      value: online ? "Browser reports online" : "No internet connection detected.",
      fix: online ? undefined : "Check your WiFi or mobile data connection. If you're on a corporate network, check with your IT team for firewall restrictions.",
    });

    // ── 2. WebRTC Support ───────────────────────────────────────────────────
    const hasWebRTC = typeof RTCPeerConnection !== "undefined";
    push({
      id: "webrtc",
      label: "WebRTC Support",
      severity: hasWebRTC ? "ok" : "critical",
      value: hasWebRTC ? "RTCPeerConnection is available" : "WebRTC not supported in this browser.",
      fix: hasWebRTC ? undefined : "Use a modern browser: Chrome 80+, Firefox 78+, Safari 14+, or Edge 80+.",
    });

    // ── 3. Microphone ───────────────────────────────────────────────────────
    push({ id: "mic", label: "Microphone", severity: "loading", value: "Checking permission…" });
    const micResult = await checkMicrophone();
    out[out.findIndex((r) => r.id === "mic")] = {
      id: "mic",
      label: "Microphone",
      severity: micResult === "granted" ? "ok" : micResult === "denied" ? "critical" : "warning",
      value: micResult === "granted"
        ? "Microphone access granted"
        : micResult === "denied"
        ? "Microphone access blocked — calls will have no audio."
        : "Microphone not available on this device.",
      fix: micResult === "denied"
        ? "Click the padlock icon in your browser's address bar and set Microphone to 'Allow'. Then refresh the page."
        : micResult === "unavailable"
        ? "Connect a microphone or headset to your device."
        : undefined,
    };
    setResults([...out]);

    // ── 4. Verto WebSocket ──────────────────────────────────────────────────
    push({
      id: "verto",
      label: "Verto WebSocket",
      severity: isVertoConnected ? "ok" : "critical",
      value: isVertoConnected
        ? `Connected — extension ${vertoConfig?.extension ?? "?"}`
        : vertoError
        ? `Disconnected: ${vertoError}`
        : "Not connected to FreeSWITCH",
      fix: isVertoConnected ? undefined
        : vertoError?.includes("-32601")
        ? "Admin needs to push the FreeSWITCH config: go to Admin → System → FreeSWITCH → Push Config."
        : "Check that the API server is running and FREESWITCH_DOMAIN is configured. Wait 30 seconds for the exponential-backoff reconnect.",
    });

    // ── 5. TLS / HTTPS ──────────────────────────────────────────────────────
    const isHttps = location.protocol === "https:";
    push({
      id: "tls",
      label: "TLS / HTTPS",
      severity: isHttps ? "ok" : "warning",
      value: isHttps ? "Site served over HTTPS" : "Site is on HTTP — WebRTC may be blocked by the browser.",
      fix: isHttps ? undefined : "Ensure the server has a valid TLS certificate. In production, use nginx with Let's Encrypt or an equivalent CA.",
    });

    // ── 6. FreeSWITCH directory ─────────────────────────────────────────────
    push({ id: "fs", label: "FreeSWITCH Directory", severity: "loading", value: "Running XML lookup check…" });
    try {
      const resp = await fetch("/api/freeswitch/status", { credentials: "include" });
      const data: FsStatus = await resp.json();
      setFsStatus(data);
      out[out.findIndex((r) => r.id === "fs")] = {
        id: "fs",
        label: "FreeSWITCH Directory",
        severity: data.ok ? "ok" : "critical",
        value: data.ok
          ? `Directory lookup passed — extension ${data.extension}, domain ${data.domain}`
          : `Directory check failed: ${data.reason ?? "unknown error"}`,
        fix: data.ok ? undefined : "Admin: POST /api/freeswitch/configure to push the mod_xml_curl config. Verify FREESWITCH_SSH_KEY and APP_URL are set.",
      };
    } catch {
      out[out.findIndex((r) => r.id === "fs")] = {
        id: "fs",
        label: "FreeSWITCH Directory",
        severity: "critical",
        value: "Network error — could not reach /api/freeswitch/status",
        fix: "Ensure the backend API server is running and accessible.",
      };
    }
    setResults([...out]);

    // ── 7. ICE / TURN probe ─────────────────────────────────────────────────
    if (hasWebRTC) {
      push({ id: "turn", label: "ICE / TURN Connectivity", severity: "loading", value: "Gathering ICE candidates…" });
      try {
        const iceServers: RTCIceServer[] = vertoConfig?.iceServers?.length
          ? vertoConfig.iceServers
          : [{ urls: "stun:stun.l.google.com:19302" }];

        const probe = await probeIceServers(iceServers);

        let severity: Severity = "ok";
        let value = "";
        let fix: string | undefined;

        if (!probe.hasHost && !probe.hasSrflx && !probe.hasRelay) {
          severity = "critical";
          value = `No ICE candidates gathered after ${probe.durationMs}ms — likely blocked by firewall or symmetric NAT.`;
          fix = "A TURN server is required. Configure TURN credentials in Admin → System → ICE Servers. Ensure UDP/TCP port 3478 (TURN) is open.";
        } else if (!probe.hasRelay && !probe.hasSrflx) {
          severity = "warning";
          value = `Only host candidates gathered (${probe.durationMs}ms). Calls will fail on NAT/firewall — TURN server recommended.`;
          fix = "Add a TURN server with valid credentials in Admin → System → ICE Servers. Ensure TURN ports are open (3478 UDP+TCP, 5349 TLS).";
        } else if (!probe.hasRelay) {
          severity = "warning";
          value = `STUN reflexive candidate gathered — no TURN relay (${probe.durationMs}ms). May fail on symmetric NAT.`;
          fix = "Add a TURN server to provide relay candidates for users behind strict NAT or corporate firewalls.";
        } else {
          severity = "ok";
          value = `TURN relay candidate gathered in ${probe.durationMs}ms. NAT traversal should work reliably.`;
        }

        out[out.findIndex((r) => r.id === "turn")] = { id: "turn", label: "ICE / TURN Connectivity", severity, value, fix };
      } catch (err: any) {
        out[out.findIndex((r) => r.id === "turn")] = {
          id: "turn",
          label: "ICE / TURN Connectivity",
          severity: "warning",
          value: `ICE probe error: ${err?.message ?? "unknown"}`,
          fix: "Check browser console for RTCPeerConnection errors.",
        };
      }
      setResults([...out]);
    }

    // ── 7b. Server-side TURN health probe ────────────────────────────────────
    push({ id: "turn-server", label: "TURN Server Health (Server-side)", severity: "loading", value: "Probing TURN server from API…" });
    try {
      const resp = await fetch("/api/healthz/turn", { signal: AbortSignal.timeout(10_000) });
      const th: TurnHealthResult = await resp.json();
      let severity: Severity;
      if (th.ok) {
        severity = "ok";
      } else if (th.onlyStun) {
        severity = "warning";
      } else {
        severity = "critical";
      }
      const serverList = th.servers.length > 0
        ? ` Probed: ${th.servers.map((s) => `${s.url} (${s.reachable ? `${s.latencyMs}ms` : "UNREACHABLE"})`).join(", ")}.`
        : "";
      const modeNote = th.managedTurn
        ? ` HMAC auto-mode active (host: ${th.turnHost ?? "?"}).`
        : "";
      out[out.findIndex((r) => r.id === "turn-server")] = {
        id: "turn-server",
        label: "TURN Server Health (Server-side)",
        severity,
        value: `${th.summary}${modeNote}${serverList}`,
        fix: !th.ok && !th.onlyStun
          ? "Run: sudo bash deploy/coturn-setup.sh — or configure ICE servers in Admin → System → ICE Servers."
          : th.onlyStun && !th.hasTurn
          ? "No TURN server configured. Calls will fail on 4G/mobile and behind strict NAT. Add TURN credentials in Admin → System → ICE Servers."
          : undefined,
      };
    } catch (err: any) {
      out[out.findIndex((r) => r.id === "turn-server")] = {
        id: "turn-server",
        label: "TURN Server Health (Server-side)",
        severity: "warning",
        value: `Could not reach /api/healthz/turn: ${err?.message ?? "timeout"}`,
        fix: "Ensure the API server is running and accessible.",
      };
    }
    setResults([...out]);

    // ── 8. Push notifications ───────────────────────────────────────────────
    const notifPerm = "Notification" in window ? Notification.permission : "unavailable";
    push({
      id: "push",
      label: "Push Notifications",
      severity: notifPerm === "granted" ? "ok" : notifPerm === "denied" ? "warning" : "info",
      value: notifPerm === "granted"
        ? "Notification permission granted"
        : notifPerm === "denied"
        ? "Notification permission denied — incoming call alerts won't show when tab is hidden."
        : notifPerm === "default"
        ? "Notification permission not yet requested."
        : "Notifications not supported in this browser.",
      fix: notifPerm === "denied"
        ? "Click the padlock icon in your browser's address bar, set Notifications to 'Allow', and refresh."
        : undefined,
    });

    setResults([...out]);
    setRunning(false);
    setRan(true);
    runRef.current = false;
  }, [isVertoConnected, vertoConfig, vertoError]);

  // Auto-run on mount
  useEffect(() => { runAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copyAll = useCallback(() => {
    const lines = [
      "=== PRaww+ Diagnostics Report ===",
      `Timestamp: ${new Date().toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
      "",
      ...results.map((r) => `[${r.severity.toUpperCase()}] ${r.label}: ${r.value}${r.fix ? ` | Fix: ${r.fix}` : ""}`),
      "",
      "--- FreeSWITCH Status ---",
      fsStatus ? JSON.stringify(fsStatus, null, 2) : "(not checked)",
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [results, fsStatus]);

  const criticalCount = results.filter((r) => r.severity === "critical").length;
  const warningCount  = results.filter((r) => r.severity === "warning").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4, paddingBottom: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: 34, height: 34, borderRadius: "50%",
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <ChevronLeft style={{ width: 18, height: 18, color: "#1a8cff" }} />
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, flex: 1 }}>
          Diagnostics
        </h1>
        <button
          onClick={copyAll}
          disabled={results.length === 0}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: copied ? "rgba(48,209,88,0.18)" : "rgba(255,255,255,0.07)",
            border: `1px solid ${copied ? "rgba(48,209,88,0.35)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 20, padding: "6px 14px",
            color: copied ? "#30d158" : "var(--text-2)",
            fontSize: 13, fontWeight: 600, cursor: results.length === 0 ? "not-allowed" : "pointer",
            opacity: results.length === 0 ? 0.5 : 1,
          }}
        >
          <ClipboardCopy size={13} />
          {copied ? "Copied!" : "Copy report"}
        </button>
      </div>

      {/* Summary bar */}
      {ran && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: criticalCount > 0 ? "rgba(255,69,58,0.08)" : warningCount > 0 ? "rgba(255,159,10,0.08)" : "rgba(48,209,88,0.08)",
          border: `1px solid ${criticalCount > 0 ? "rgba(255,69,58,0.2)" : warningCount > 0 ? "rgba(255,159,10,0.2)" : "rgba(48,209,88,0.2)"}`,
          borderRadius: 10, padding: "10px 14px",
        }}>
          {criticalCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#ff453a" }}>
              <XCircle size={13} /> {criticalCount} critical issue{criticalCount > 1 ? "s" : ""}
            </span>
          )}
          {warningCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#ff9f0a" }}>
              <AlertTriangle size={13} /> {warningCount} warning{warningCount > 1 ? "s" : ""}
            </span>
          )}
          {criticalCount === 0 && warningCount === 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#30d158" }}>
              <CheckCircle2 size={13} /> All checks passed
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => { runRef.current = false; runAll(); }}
            disabled={running}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16, padding: "5px 12px", color: "rgba(255,255,255,0.6)",
              fontSize: 12, fontWeight: 600, cursor: running ? "not-allowed" : "pointer",
            }}
          >
            {running ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={11} />}
            {running ? "Running…" : "Re-run"}
          </button>
        </div>
      )}

      {/* Connectivity checks */}
      <Section title="Connectivity" icon={<Wifi size={13} />}>
        {results.filter((r) => ["network", "tls", "verto"].includes(r.id)).map((r) => (
          <DiagCard key={r.id} result={r} />
        ))}
        {results.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Running checks…
          </div>
        )}
      </Section>

      {/* Media checks */}
      <Section title="Media & Permissions" icon={<Mic size={13} />}>
        {results.filter((r) => ["mic", "push"].includes(r.id)).map((r) => (
          <DiagCard key={r.id} result={r} />
        ))}
      </Section>

      {/* WebRTC / ICE */}
      <Section title="WebRTC / NAT Traversal" icon={<Zap size={13} />}>
        {results.filter((r) => ["webrtc", "turn", "turn-server"].includes(r.id)).map((r) => (
          <DiagCard key={r.id} result={r} />
        ))}
      </Section>

      {/* FreeSWITCH */}
      <Section title="FreeSWITCH" icon={<Server size={13} />}>
        {results.filter((r) => r.id === "fs").map((r) => (
          <DiagCard key={r.id} result={r} />
        ))}
        {fsStatus?.xmlPreview && (
          <div style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>
            <p style={{ fontSize: 11, color: "var(--text-3)", margin: "0 0 6px" }}>Directory XML preview</p>
            <pre style={{ fontSize: 10, color: "#a8ff78", fontFamily: "var(--font-mono, monospace)", overflowX: "auto", margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflowY: "auto" }}>
              {fsStatus.xmlPreview}
            </pre>
          </div>
        )}
      </Section>

      {/* Browser environment */}
      <Section title="Browser Environment" icon={<Globe size={13} />}>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["Platform",    navigator.platform],
            ["User-Agent",  navigator.userAgent],
            ["Verto WS",    vertoConfig?.wsUrl ?? "—"],
            ["Extension",   String(vertoConfig?.extension ?? "—")],
            ["Login",       vertoConfig?.login ?? "—"],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: 8 }}>
              <span style={{ width: 90, flexShrink: 0, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{label}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.4 }}>{value}</span>
            </div>
          ))}
        </div>
      </Section>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", paddingBottom: 4 }}>
        Use "Copy report" to share with support for faster troubleshooting.
      </p>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
