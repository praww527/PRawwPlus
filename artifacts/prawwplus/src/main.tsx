import { createRoot } from "react-dom/client";
import { Component, type ReactNode, type ErrorInfo } from "react";
import App from "./App";
import "./index.css";

// ── PWA Install Prompt capture (Android / Chrome / Edge) ─────────────────────
// Intercept the native install dialog so we can trigger it on demand from
// within the app (e.g. the Notifications settings page "Install App" button).
// The event is stored on window so any component can access it without a
// context provider.
declare global {
  interface Window {
    __pwaInstallPrompt?: BeforeInstallPromptEvent;
  }
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
    prompt(): Promise<void>;
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__pwaInstallPrompt = e as BeforeInstallPromptEvent;
  window.dispatchEvent(new CustomEvent("pwa-install-available"));
});

window.addEventListener("appinstalled", () => {
  window.__pwaInstallPrompt = undefined;
  window.dispatchEvent(new CustomEvent("pwa-installed"));
});

// ── Service Worker registration with update detection ────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        // Detect when a new service worker is waiting to activate.
        const notifyUpdate = (worker: ServiceWorker) => {
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              // A new version of the app is available. Show a non-intrusive banner.
              showUpdateBanner();
            }
          });
        };

        if (registration.waiting) {
          showUpdateBanner();
        }
        registration.addEventListener("updatefound", () => {
          if (registration.installing) notifyUpdate(registration.installing);
        });

        // Reload all open tabs when the new SW takes over.
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      })
      .catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });
  });
}

function showUpdateBanner() {
  if (document.getElementById("__praww_update_banner")) return;

  const banner = document.createElement("div");
  banner.id = "__praww_update_banner";
  Object.assign(banner.style, {
    position:   "fixed",
    bottom:     "16px",
    left:       "50%",
    transform:  "translateX(-50%)",
    zIndex:     "99999",
    background: "#1a8cff",
    color:      "#fff",
    borderRadius: "12px",
    padding:    "12px 20px",
    fontSize:   "14px",
    fontWeight: "600",
    fontFamily: "system-ui, -apple-system, sans-serif",
    boxShadow:  "0 4px 24px rgba(0,0,0,0.35)",
    display:    "flex",
    alignItems: "center",
    gap:        "12px",
    cursor:     "pointer",
    maxWidth:   "calc(100vw - 32px)",
    whiteSpace: "nowrap",
  });

  banner.innerHTML =
    '<span>🔄 New version available</span>' +
    '<button style="background:rgba(255,255,255,0.2);border:none;border-radius:8px;color:#fff;padding:5px 12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Reload</button>';

  const btn = banner.querySelector("button")!;
  const doReload = () => {
    // Tell the waiting SW to activate immediately
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
    window.location.reload();
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); doReload(); });
  banner.addEventListener("click", doReload);

  document.body.appendChild(banner);
}

// ── React error boundary ──────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as Error;
      return (
        <div style={{ padding: 24, fontFamily: "monospace", background: "#1a1a2e", color: "#ff6b6b", minHeight: "100vh" }}>
          <h2 style={{ color: "#fff" }}>App crashed</h2>
          <p style={{ color: "#ffd93d" }}>{e.message}</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#aaa" }}>{e.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
