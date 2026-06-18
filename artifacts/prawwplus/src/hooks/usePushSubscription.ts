/**
 * usePushSubscription — shared hook for Web Push permission + subscription.
 *
 * Extracts the VAPID subscribe logic so both VertoInit (auto-refresh for
 * already-granted sessions) and PushPermissionPrompt (first-time request)
 * share one implementation.
 */

import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/apiFetch";

export type PushPermission = NotificationPermission | "unsupported";

function getInitialPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

async function registerSubscription(): Promise<void> {
  const keyResp = await fetch("/api/users/vapid-public-key");
  if (!keyResp.ok) return;
  const { key } = (await keyResp.json()) as { key?: string };
  if (!key) return;

  const registration = await navigator.serviceWorker.ready;
  let sub = await registration.pushManager.getSubscription();

  const appServerKey = Uint8Array.from(
    atob(key.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );

  if (sub) {
    const existing = sub.options.applicationServerKey;
    const keysMatch = existing && (() => {
      const a = new Uint8Array(existing as ArrayBuffer);
      const b = appServerKey;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    })();
    if (!keysMatch) {
      await sub.unsubscribe();
      sub = null;
    }
  }

  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  await apiFetch("/api/users/web-push-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}

export function usePushSubscription() {
  const [permission, setPermission] = useState<PushPermission>(getInitialPermission);

  /**
   * Request notification permission (if not yet decided) and register a
   * push subscription.  Returns true if permission is granted.
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (permission === "unsupported") return false;

    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
    }
    setPermission(perm);
    if (perm !== "granted") return false;

    try {
      await registerSubscription();
    } catch (err) {
      console.warn("[Push] Subscription error:", err);
    }
    return true;
  }, [permission]);

  /**
   * Silently refresh the push subscription for a session where permission is
   * already granted.  Safe to call on mount — never prompts the browser.
   */
  const refreshIfGranted = useCallback(async (): Promise<void> => {
    if (Notification.permission !== "granted") return;
    try {
      await registerSubscription();
    } catch (err) {
      console.warn("[Push] Subscription refresh error:", err);
    }
  }, []);

  return { permission, subscribe, refreshIfGranted };
}
