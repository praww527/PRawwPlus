/**
 * useCallQuality — polls WebRTC getStats() every 5 seconds during an active call
 * and reports quality metrics to the backend.
 *
 * Metrics collected:
 *  - packetsLost, packetsSent, packetsReceived
 *  - jitter (s), roundTripTime (s)
 *  - bytesSent, bytesReceived
 *  - candidateType (host | srflx | relay)
 *  - MOS estimate (from packet-loss + RTT)
 *
 * Quality data is stored as CallEvent(type="quality_sample") on the backend
 * and used for per-call analytics in the admin panel.
 */

import { useEffect, useRef, useCallback } from "react";

export interface QualitySample {
  ts: string;
  packetsLost: number;
  packetsSent: number;
  packetsReceived: number;
  jitterMs: number;
  rttMs: number;
  bytesSent: number;
  bytesReceived: number;
  candidateType: string;
  mos: number;
}

/** Simplified ITU-T E-model MOS estimation (0–5 scale). */
function estimateMos(packetLossPct: number, rttMs: number): number {
  if (packetLossPct < 0) packetLossPct = 0;
  if (rttMs < 0) rttMs = 0;

  // R factor (ITU-T G.107 simplified): start at 93.2, deduct for loss and delay
  const R = Math.max(
    0,
    93.2
      - 2.5 * packetLossPct           // packet loss penalty (~2.5 R-points per %)
      - Math.max(0, (rttMs - 150) / 40), // delay penalty above 150ms
  );

  // Map R to MOS (0–5 scale)
  if (R < 0)  return 1.0;
  if (R > 100) return 4.5;
  return 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6;
}

/** Parse a single RTCInboundRtpStreamStats / RTCOutboundRtpStreamStats entry. */
function extractStats(reports: RTCStatsReport): QualitySample {
  let packetsLost     = 0;
  let packetsSent     = 0;
  let packetsReceived = 0;
  let jitterMs        = 0;
  let rttMs           = 0;
  let bytesSent       = 0;
  let bytesReceived   = 0;
  let candidateType   = "unknown";

  reports.forEach((report: RTCStats) => {
    const r = report as any;
    if (r.type === "outbound-rtp" && r.kind === "audio") {
      packetsSent  = r.packetsSent  ?? 0;
      bytesSent    = r.bytesSent    ?? 0;
      packetsLost  = r.packetsLost  ?? 0;
    }
    if (r.type === "inbound-rtp" && r.kind === "audio") {
      packetsReceived = r.packetsReceived ?? 0;
      bytesReceived   = r.bytesReceived   ?? 0;
      jitterMs        = Math.round((r.jitter ?? 0) * 1000);
    }
    if (r.type === "candidate-pair" && r.state === "succeeded" && r.nominated) {
      rttMs = Math.round((r.currentRoundTripTime ?? 0) * 1000);
    }
    if (r.type === "local-candidate") {
      candidateType = r.candidateType ?? candidateType;
    }
  });

  const totalPackets     = packetsSent + packetsReceived;
  const packetLossPct    = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
  const mos              = estimateMos(packetLossPct, rttMs);

  return {
    ts: new Date().toISOString(),
    packetsLost, packetsSent, packetsReceived,
    jitterMs, rttMs, bytesSent, bytesReceived,
    candidateType,
    mos: Math.round(mos * 100) / 100,
  };
}

const POLL_INTERVAL_MS = 5_000;

export function useCallQuality(
  callId: string | null,
  pc: RTCPeerConnection | null,
): void {
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const callIdRef   = useRef(callId);
  const pcRef       = useRef(pc);
  callIdRef.current = callId;
  pcRef.current     = pc;

  const sample = useCallback(async () => {
    const cid = callIdRef.current;
    const peerConn = pcRef.current;
    if (!cid || !peerConn || peerConn.connectionState === "closed") return;

    try {
      const stats  = await peerConn.getStats();
      const sample = extractStats(stats);

      await fetch(`/api/calls/${encodeURIComponent(cid)}/quality`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(sample),
      });
    } catch {
      // Best-effort — never block the call
    }
  }, []);

  useEffect(() => {
    if (!callId || !pc) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(sample, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [callId, pc, sample]);
}
