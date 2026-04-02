import { useEffect } from "react";
import { useGetVertoConfig } from "@workspace/api-client-react";
import { useCall } from "@/context/CallContext";

/**
 * Initialises the Verto WebSocket client once the user's config is loaded.
 *
 * The WebSocket URL is always built from window.location so it works
 * regardless of what APP_URL is set to on the server.  The proxy at
 * /api/verto/ws is served by the API server (and forwarded by Vite dev
 * proxy in development), so same-origin wss:// always works.
 */
export function VertoInit() {
  const { data } = useGetVertoConfig();
  const { setVertoConfig } = useCall();

  useEffect(() => {
    if (!data) return;

    // Build the proxy WebSocket URL from the browser's current origin so we
    // never rely on the server-side APP_URL env var (which can be stale).
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/api/verto/ws`;

    setVertoConfig({ ...data, wsUrl, configured: true });
  }, [data, setVertoConfig]);

  return null;
}
