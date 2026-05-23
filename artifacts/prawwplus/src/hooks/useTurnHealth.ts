/**
 * useTurnHealth — probes all configured TURN servers and returns them ranked
 * by latency (fastest first).
 *
 * Strategy:
 *  1. Fetch ice servers from /api/verto/config
 *  2. For each TURN/STUN url, create a transient RTCPeerConnection with that
 *     server as the sole ICE candidate source and gather candidates for 3s.
 *  3. Measure time-to-first-candidate as a latency proxy.
 *  4. Return sorted list for use in RTCConfiguration.iceServers.
 *
 * Falls back gracefully to the unranked list if probing fails.
 */

import { useState, useEffect, useCallback } from "react";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RankedIceServer extends IceServer {
  latencyMs: number | null;
  healthy: boolean;
}

const PROBE_TIMEOUT_MS = 4_000;
const REFRESH_INTERVAL_MS = 5 * 60_000; // re-probe every 5 min

async function probeServer(server: IceServer): Promise<number | null> {
  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    const timer = setTimeout(() => {
      pc?.close();
      resolve(null);
    }, PROBE_TIMEOUT_MS);

    const start = performance.now();

    try {
      pc = new RTCPeerConnection({ iceServers: [server] });
      pc.createDataChannel("probe");

      pc.onicecandidateerror = () => {
        clearTimeout(timer);
        pc?.close();
        resolve(null);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          const latency = Math.round(performance.now() - start);
          clearTimeout(timer);
          pc?.close();
          resolve(latency);
        }
      };

      pc.createOffer().then((offer) => pc!.setLocalDescription(offer)).catch(() => {
        clearTimeout(timer);
        pc?.close();
        resolve(null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function fetchIceServers(): Promise<IceServer[]> {
  try {
    const resp = await fetch("/api/verto/config", { credentials: "include" });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data.iceServers) ? data.iceServers : [];
  } catch {
    return [];
  }
}

export function useTurnHealth(): {
  servers: RankedIceServer[];
  loading: boolean;
  lastProbed: Date | null;
  reprobe: () => void;
} {
  const [servers, setServers]     = useState<RankedIceServer[]>([]);
  const [loading, setLoading]     = useState(false);
  const [lastProbed, setLastProbed] = useState<Date | null>(null);

  const probe = useCallback(async () => {
    setLoading(true);
    try {
      const iceServers = await fetchIceServers();
      if (!iceServers.length) { setServers([]); return; }

      const results = await Promise.all(
        iceServers.map(async (server): Promise<RankedIceServer> => {
          const latencyMs = await probeServer(server);
          return { ...server, latencyMs, healthy: latencyMs !== null };
        }),
      );

      // Sort: healthy first, then by latency ascending; unhealthy at end
      results.sort((a, b) => {
        if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
        if (a.latencyMs === null && b.latencyMs === null) return 0;
        if (a.latencyMs === null) return 1;
        if (b.latencyMs === null) return -1;
        return a.latencyMs - b.latencyMs;
      });

      setServers(results);
      setLastProbed(new Date());
    } catch {
      // Best-effort — keep existing results
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    probe();
    const interval = setInterval(probe, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [probe]);

  return { servers, loading, lastProbed, reprobe: probe };
}

/** Extract the healthy/ranked ICE server list for use in RTCPeerConnection. */
export function toRtcIceServers(ranked: RankedIceServer[]): RTCIceServer[] {
  return ranked
    .filter((s) => s.healthy)
    .map(({ urls, username, credential }) => ({ urls, username, credential } as RTCIceServer));
}
