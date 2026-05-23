/**
 * useConnectionStatus — monitors network and Verto/SIP connection state.
 *
 * Returns:
 *   isOnline     – browser navigator.onLine (network layer)
 *   isVertoReady – Verto WebSocket + FreeSWITCH session is active
 *   isReconnecting – currently in exponential-backoff reconnect loop
 *   lastSeen     – Date when the connection was last confirmed live
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface ConnectionStatus {
  isOnline:       boolean;
  isVertoReady:   boolean;
  isReconnecting: boolean;
  lastSeen:       Date | null;
  reconnectCount: number;
}

type Listener = (status: ConnectionStatus) => void;

class ConnectionStatusStore {
  private status: ConnectionStatus = {
    isOnline:       typeof navigator !== "undefined" ? navigator.onLine : true,
    isVertoReady:   false,
    isReconnecting: false,
    lastSeen:       null,
    reconnectCount: 0,
  };

  private listeners = new Set<Listener>();

  getStatus(): ConnectionStatus { return { ...this.status }; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snap = { ...this.status };
    this.listeners.forEach((fn) => fn(snap));
  }

  setOnline(v: boolean) {
    if (this.status.isOnline === v) return;
    this.status = { ...this.status, isOnline: v };
    this.emit();
  }

  setVertoReady(v: boolean) {
    const changed = this.status.isVertoReady !== v;
    this.status = {
      ...this.status,
      isVertoReady:   v,
      isReconnecting: v ? false : this.status.isReconnecting,
      lastSeen:       v ? new Date() : this.status.lastSeen,
    };
    if (changed) this.emit();
  }

  setReconnecting(v: boolean) {
    if (this.status.isReconnecting === v) return;
    this.status = {
      ...this.status,
      isReconnecting: v,
      reconnectCount: v
        ? this.status.reconnectCount + 1
        : this.status.reconnectCount,
    };
    this.emit();
  }

  reset() {
    this.status = {
      ...this.status,
      isVertoReady:   false,
      isReconnecting: false,
      reconnectCount: 0,
    };
    this.emit();
  }
}

export const connectionStore = new ConnectionStatusStore();

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() => connectionStore.getStatus());

  useEffect(() => {
    const unsub = connectionStore.subscribe(setStatus);

    const handleOnline  = () => connectionStore.setOnline(true);
    const handleOffline = () => {
      connectionStore.setOnline(false);
      connectionStore.setVertoReady(false);
      connectionStore.setReconnecting(true);
    };

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      unsub();
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return status;
}

export function useVisibilityReconnect(reconnectFn: () => void): void {
  const reconnectRef = useRef(reconnectFn);
  reconnectRef.current = reconnectFn;

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (!connectionStore.getStatus().isVertoReady) {
            reconnectRef.current();
          }
        }, 1_500);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (debounce) clearTimeout(debounce);
    };
  }, []);
}
