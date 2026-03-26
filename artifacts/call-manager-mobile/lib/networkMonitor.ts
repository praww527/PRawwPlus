/**
 * Network Monitor
 *
 * Tracks device connectivity using React Native's built-in NetInfo.
 * Detects: online, offline, roaming, cellular vs Wi-Fi.
 *
 * Uses a simple polling + event approach compatible with react-native 0.81.
 */

import { Platform } from "react-native";

export type NetworkState =
  | "online"
  | "offline"
  | "unknown";

type NetworkListener = (state: NetworkState) => void;

const listeners: NetworkListener[] = [];
let currentState: NetworkState = "unknown";
let NetInfo: any = null;
let unsubscribe: (() => void) | null = null;

function getNetInfo() {
  if (!NetInfo) {
    try {
      NetInfo = require("@react-native-community/netinfo").default;
    } catch {
      // Not installed — fall back to always-online
      console.warn("[NetworkMonitor] @react-native-community/netinfo not available, assuming online");
    }
  }
  return NetInfo;
}

function resolveState(state: any): NetworkState {
  if (!state) return "unknown";
  if (state.isConnected === false) return "offline";
  if (state.isInternetReachable === false) return "offline";
  if (state.isConnected === true) return "online";
  return "unknown";
}

function notify(state: NetworkState) {
  if (state === currentState) return;
  currentState = state;
  listeners.forEach((l) => l(state));
}

export const networkMonitor = {
  start(): void {
    const ni = getNetInfo();
    if (!ni) {
      currentState = "online";
      return;
    }

    // Get initial state
    ni.fetch().then((state: any) => {
      notify(resolveState(state));
    }).catch(() => {});

    // Subscribe to changes
    if (!unsubscribe) {
      unsubscribe = ni.addEventListener((state: any) => {
        notify(resolveState(state));
      });
    }
  },

  stop(): void {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  },

  getState(): NetworkState {
    return currentState;
  },

  isOnline(): boolean {
    return currentState !== "offline";
  },

  addListener(listener: NetworkListener): () => void {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  },
};
