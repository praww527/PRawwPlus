/**
 * useKeepalive — pings /api/healthz every 30 s while `active` is true.
 *
 * Keeps the HTTP connection warm on mobile/flaky networks during active calls,
 * helping catch connectivity drops before they silently kill the Verto WS.
 * The ping is fire-and-forget — failures are logged but not surfaced to the UI.
 */

import { useEffect, useRef } from "react";

const INTERVAL_MS = 30_000;

export function useKeepalive(active: boolean): void {
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;

    const ping = () => {
      if (!activeRef.current) return;
      fetch("/api/healthz", { credentials: "include", cache: "no-store" }).catch(
        () => { /* swallow — network may be temporarily down */ }
      );
    };

    ping(); // immediate ping when call goes active
    const interval = setInterval(ping, INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active]);
}
