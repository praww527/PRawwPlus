/**
 * useWakeLock — prevents the device screen from sleeping during active calls.
 *
 * Uses the Screen Wake Lock API (Chrome 84+, Edge 84+, Safari 16.4+ on iOS).
 * Falls back gracefully on browsers that don't support it.
 *
 * The lock is released automatically when:
 *  - `active` becomes false
 *  - The component unmounts
 *  - The browser releases it (e.g. tab hidden) — the hook re-acquires on visibilitychange
 */

import { useEffect, useRef } from "react";

export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let released = false;

    const acquire = async () => {
      if (released) return;
      try {
        const sentinel = await (navigator as any).wakeLock.request("screen");
        lockRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (!released) {
            // The browser released it (e.g. tab hidden). Re-acquire when visible.
            lockRef.current = null;
          }
        });
      } catch {
        // Permission denied or not supported — silently ignore
      }
    };

    acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !lockRef.current && active && !released) {
        acquire();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (lockRef.current) {
        lockRef.current.release().catch(() => {});
        lockRef.current = null;
      }
    };
  }, [active]);
}
