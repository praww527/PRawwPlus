import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";

const POLL_INTERVAL_MS = 4000;

/**
 * Shared hook for ESL offline auto-retry.
 *
 * Usage:
 *   const { eslOfflinePending, eslRetryNumberRef, handleEslOfflineError, stopEslRetry } = useEslOfflineRetry();
 *
 *   // In your call's catch block:
 *   if (handleEslOfflineError(err, number, () => placeCall(number))) return;
 *
 *   // In JSX:
 *   {eslOfflinePending && <EslOfflineBanner number={eslRetryNumberRef.current} onCancel={stopEslRetry} />}
 */
export function useEslOfflineRetry() {
  const { toast } = useToast();
  const [eslOfflinePending, setEslOfflinePending] = useState(false);
  const eslRetryNumberRef   = useRef("");
  const eslRetryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eslRetryFnRef       = useRef<(() => void) | null>(null);

  const stopEslRetry = useCallback(() => {
    if (eslRetryIntervalRef.current) {
      clearInterval(eslRetryIntervalRef.current);
      eslRetryIntervalRef.current = null;
    }
    eslRetryFnRef.current = null;
    setEslOfflinePending(false);
  }, []);

  useEffect(() => () => stopEslRetry(), [stopEslRetry]);

  /**
   * Call this in the catch block of any call-placement function.
   * Returns true if the error was an ESL offline 503 (caller should return early).
   * Returns false for all other errors (caller should handle normally).
   */
  const handleEslOfflineError = useCallback(
    (err: any, number: string, retryFn: () => void): boolean => {
      const isEslOffline =
        err?.status === 503 && (err?.data as any)?.eslOffline === true;
      if (!isEslOffline) return false;

      eslRetryNumberRef.current = number;
      eslRetryFnRef.current     = retryFn;
      setEslOfflinePending(true);

      toast({
        title:       "Call system offline",
        description: "FreeSWITCH is reconnecting. Your call will retry automatically.",
      });

      if (!eslRetryIntervalRef.current) {
        eslRetryIntervalRef.current = setInterval(async () => {
          try {
            const res  = await apiFetch("/api/healthz-lite");
            const data = await res.json() as { esl?: { connected?: boolean } };
            if (data?.esl?.connected) {
              const fn = eslRetryFnRef.current;
              stopEslRetry();
              toast({ title: "Call system ready", description: "Retrying your call…" });
              setTimeout(() => fn?.(), 800);
            }
          } catch { /* network hiccup — keep polling */ }
        }, POLL_INTERVAL_MS);
      }

      return true;
    },
    [stopEslRetry, toast],
  );

  return { eslOfflinePending, eslRetryNumberRef, handleEslOfflineError, stopEslRetry };
}
