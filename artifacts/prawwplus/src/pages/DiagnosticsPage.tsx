import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, Wifi, WifiOff, Radio, Server, Globe,
  ClipboardCopy, RotateCcw, CheckCircle2, XCircle,
  AlertCircle, Loader2, ShieldCheck, ShieldOff,
} from "lucide-react";
import { useLocation } from "wouter";
import { useCall } from "@/context/CallContext";

// ─── helpers ────────────────────────────────────────────────────────────────

function dot(ok: boolean | null) {
  if (ok === null) return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,0.18)", marginRight: 6 }} />;
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: ok ? "#30d158" : "#ff453a",
      boxShadow: ok ? "0 0 6px #30d158" : "0 0 6px #ff453a",
      marginRight: 6,
    }} />
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: ok ? "rgba(48,209,88,0.18)" : "rgba(255,69,58,0.18)",
      border: `1px solid ${ok ? "rgba(48,209,88,0.4)" : "rgba(255,69,58,0.4)"}`,
      color: ok ? "#30d158" : "#ff453a",
    }}>
      {ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {ok ? "PASS" : "FAIL"}
    </span>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 16px" }}>
      <span style={{ width: 140, flexShrink: 0, fontSize: 12, color: "var(--text-3)", paddingTop: 1 }}>{label}</span>
      <span style={{
        flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text-1)",
        wordBreak: "break-all",
        fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
      }}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 4, marginBottom: 6 }}>
        <span style={{ color: "var(--text-3)", display: "flex" }}>{icon}</span>
        <p className="section-label" style={{ margin: 0 }}>{title}</p>
      </div>
      <div className="section-card">
        {Array.isArray(children)
          ? children.filter(Boolean).map((child, i, arr) => (
              <div key={i}>
                {child}
                {i < arr.length - 1 && <div className="row-sep" />}
              </div>
            ))
          : children}
      </div>
    </div>
  );
}

// ─── types ───────────────────────────────────────────────────────────────────

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
  httpStatus?: number;
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  const [, setLocation] = useLocation();
  const { isVertoConnected, vertoError, vertoConfig } = useCall();

  const [fsStatus, setFsStatus] = useState<FsStatus | null>(null);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [webrtcOk, setWebrtcOk] = useState<boolean | null>(null);
  const [onlineOk, setOnlineOk] = useState<boolean>(navigator.onLine);

  // Detect WebRTC support once on mount
  useEffect(() => {
    try {
      const ok = typeof RTCPeerConnection !== "undefined";
      setWebrtcOk(ok);
    } catch {
      setWebrtcOk(false);
    }
    const handleOnline  = () => setOnlineOk(true);
    const handleOffline = () => setOnlineOk(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const runFsCheck = useCallback(async () => {
    setFsLoading(true);
    setFsError(null);
    setFsStatus(null);
    try {
      const resp = await fetch("/api/freeswitch/status", { credentials: "include" });
      const data = await resp.json();
      setFsStatus(data);
    } catch (err: any) {
      setFsError(err?.message ?? "Network error — could not reach the API");
    } finally {
      setFsLoading(false);
    }
  }, []);

  const copyAll = useCallback(() => {
    const lines: string[] = [
      "=== PRaww+ Connection Diagnostics ===",
      `Timestamp:         ${new Date().toISOString()}`,
      "",
      "--- Verto WebSocket ---",
      `Connected:         ${isVertoConnected}`,
      `Extension:         ${vertoConfig?.extension ?? "(none)"}`,
      `WS URL:            ${vertoConfig?.wsUrl ?? "(none)"}`,
      `Login:             ${vertoConfig?.login ?? "(none)"}`,
      `Error:             ${vertoError ?? "(none)"}`,
      "",
      "--- Browser Environment ---",
      `Network online:    ${onlineOk}`,
      `WebRTC support:    ${webrtcOk}`,
      `User agent:        ${navigator.userAgent}`,
    ];
    if (fsStatus) {
      lines.push(
        "",
        "--- FreeSWITCH Directory Check ---",
        `Result:            ${fsStatus.ok ? "PASS" : "FAIL"}`,
        `Extension:         ${fsStatus.extension ?? "(none)"}`,
        `Domain:            ${fsStatus.domain ?? "(none)"}`,
        `Phone:             ${fsStatus.phone ?? "(none)"}`,
        `Phone verified:    ${fsStatus.phoneVerified}`,
        `Webhook secret:    ${fsStatus.webhookSecretConfigured}`,
        `Reason:            ${fsStatus.reason ?? "(n/a)"}`,
        "",
        "XML preview:",
        fsStatus.xmlPreview ?? "(none)",
      );
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [isVertoConnected, vertoConfig, vertoError, onlineOk, webrtcOk, fsStatus]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4, paddingBottom: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: 34, height: 34, borderRadius: "50%",
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <ChevronLeft style={{ width: 18, height: 18, color: "#1a8cff" }} />
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, flex: 1 }}>
          Diagnostics
        </h1>
        <button
          onClick={copyAll}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: copied ? "rgba(48,209,88,0.18)" : "rgba(255,255,255,0.07)",
            border: `1px solid ${copied ? "rgba(48,209,88,0.35)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 20, padding: "6px 14px",
            color: copied ? "#30d158" : "var(--text-2)",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <ClipboardCopy size={13} />
          {copied ? "Copied!" : "Copy all"}
        </button>
      </div>

      {/* ── Section 1: Verto WebSocket ── */}
      <Section title="Verto WebSocket" icon={<Radio size={13} />}>
        <InfoRow
          label="Status"
          value={
            <span style={{ display: "flex", alignItems: "center" }}>
              {dot(isVertoConnected)}
              <span style={{ color: isVertoConnected ? "#30d158" : "#ff453a", fontWeight: 600 }}>
                {isVertoConnected ? "Connected" : "Disconnected"}
              </span>
            </span>
          }
        />
        <InfoRow label="Extension" value={vertoConfig?.extension ?? <span style={{ color: "var(--text-3)" }}>Not assigned</span>} />
        <InfoRow label="WS URL" value={vertoConfig?.wsUrl ?? <span style={{ color: "var(--text-3)" }}>—</span>} mono />
        <InfoRow label="Login" value={vertoConfig?.login ?? <span style={{ color: "var(--text-3)" }}>—</span>} mono />
        {vertoError && (
          <div style={{
            margin: "0 12px 10px",
            display: "flex", alignItems: "flex-start", gap: 8,
            background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)",
            borderRadius: 8, padding: "8px 12px",
          }}>
            <AlertCircle size={14} style={{ color: "#ff453a", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: "#ff453a", lineHeight: 1.4 }}>{vertoError}</span>
          </div>
        )}
      </Section>

      {/* ── Section 2: FreeSWITCH Directory Self-Test ── */}
      <Section title="FreeSWITCH Directory" icon={<Server size={13} />}>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Run-check button + status badge row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={runFsCheck}
              disabled={fsLoading}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "rgba(26,140,255,0.15)",
                border: "1px solid rgba(26,140,255,0.3)",
                borderRadius: 20, padding: "7px 16px",
                color: "#1a8cff", fontSize: 13, fontWeight: 600,
                cursor: fsLoading ? "not-allowed" : "pointer",
                opacity: fsLoading ? 0.7 : 1,
              }}
            >
              {fsLoading
                ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                : <RotateCcw size={13} />}
              {fsLoading ? "Checking…" : "Run Check"}
            </button>
            {fsStatus && <Badge ok={fsStatus.ok} />}
          </div>

          {/* Error from network */}
          {fsError && (
            <div style={{
              display: "flex", gap: 8, alignItems: "flex-start",
              background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)",
              borderRadius: 8, padding: "8px 12px",
            }}>
              <XCircle size={14} style={{ color: "#ff453a", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: "#ff453a" }}>{fsError}</span>
            </div>
          )}

          {/* Failure reason */}
          {fsStatus && !fsStatus.ok && fsStatus.reason && (
            <div style={{
              display: "flex", gap: 8, alignItems: "flex-start",
              background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)",
              borderRadius: 8, padding: "8px 12px",
            }}>
              <AlertCircle size={14} style={{ color: "#ff453a", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: "#ff453a", lineHeight: 1.4 }}>{fsStatus.reason}</span>
            </div>
          )}

          {/* Success details */}
          {fsStatus && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {fsStatus.extension !== undefined && (
                <InfoRow label="Extension" value={fsStatus.extension} />
              )}
              {fsStatus.domain && (
                <InfoRow label="Domain" value={fsStatus.domain} mono />
              )}
              {fsStatus.phone !== undefined && (
                <InfoRow
                  label="Phone"
                  value={
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {fsStatus.phone ?? <span style={{ color: "var(--text-3)" }}>Not set</span>}
                      {fsStatus.phone && (
                        fsStatus.phoneVerified
                          ? <ShieldCheck size={13} style={{ color: "#30d158" }} />
                          : <ShieldOff  size={13} style={{ color: "#ff9f0a" }} />
                      )}
                      {fsStatus.phone && !fsStatus.phoneVerified && (
                        <span style={{ fontSize: 11, color: "#ff9f0a" }}>unverified</span>
                      )}
                    </span>
                  }
                />
              )}
              {fsStatus.webhookSecretConfigured !== undefined && (
                <InfoRow
                  label="Webhook secret"
                  value={
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {dot(fsStatus.webhookSecretConfigured)}
                      {fsStatus.webhookSecretConfigured ? "Configured" : "Not set (open)"}
                    </span>
                  }
                />
              )}
              {fsStatus.directoryUrl && (
                <InfoRow label="Directory URL" value={fsStatus.directoryUrl} mono />
              )}
              {fsStatus.vertoWsUrl && (
                <InfoRow label="Verto WS URL" value={fsStatus.vertoWsUrl} mono />
              )}
            </div>
          )}

          {/* XML preview */}
          {fsStatus?.xmlPreview && (
            <div>
              <p style={{ fontSize: 11, color: "var(--text-3)", margin: "0 0 5px" }}>Directory XML preview</p>
              <pre style={{
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8, padding: "10px 12px",
                fontSize: 10, color: "#a8ff78",
                fontFamily: "var(--font-mono, monospace)",
                overflowX: "auto",
                margin: 0,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: 220,
                overflowY: "auto",
              }}>
                {fsStatus.xmlPreview}
              </pre>
            </div>
          )}

          {!fsStatus && !fsLoading && !fsError && (
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
              Verifies the FreeSWITCH → mod_xml_curl → MongoDB → XML lookup chain.
              Press "Run Check" to test.
            </p>
          )}
        </div>
      </Section>

      {/* ── Section 3: Browser Environment ── */}
      <Section title="Browser Environment" icon={<Globe size={13} />}>
        <InfoRow
          label="Network"
          value={
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {onlineOk
                ? <Wifi size={13} style={{ color: "#30d158" }} />
                : <WifiOff size={13} style={{ color: "#ff453a" }} />}
              <span style={{ color: onlineOk ? "#30d158" : "#ff453a" }}>
                {onlineOk ? "Online" : "Offline"}
              </span>
            </span>
          }
        />
        <InfoRow
          label="WebRTC"
          value={
            webrtcOk === null ? (
              <span style={{ color: "var(--text-3)" }}>Checking…</span>
            ) : (
              <span style={{ display: "flex", alignItems: "center" }}>
                {dot(webrtcOk)}
                <span style={{ color: webrtcOk ? "#30d158" : "#ff453a" }}>
                  {webrtcOk ? "Supported" : "Not available"}
                </span>
              </span>
            )
          }
        />
        <InfoRow
          label="User agent"
          value={
            <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace", wordBreak: "break-all" }}>
              {navigator.userAgent}
            </span>
          }
        />
      </Section>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", paddingBottom: 4 }}>
        Share the copied report with support to speed up troubleshooting.
      </p>
    </div>
  );
}
