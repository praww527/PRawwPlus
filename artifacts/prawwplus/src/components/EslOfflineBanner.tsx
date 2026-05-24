import { Loader2, WifiOff } from "lucide-react";

interface EslOfflineBannerProps {
  number: string;
  onCancel: () => void;
}

export function EslOfflineBanner({ number, onCancel }: EslOfflineBannerProps) {
  return (
    <div
      style={{
        width: "calc(100% - 32px)",
        margin: "10px 16px 0",
        padding: "12px 14px",
        borderRadius: 14,
        background: "rgba(255,159,10,0.10)",
        border: "1px solid rgba(255,159,10,0.30)",
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: "rgba(255,159,10,0.16)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <WifiOff style={{ width: 14, height: 14, color: "#ff9f0a" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, color: "#ff9f0a", fontWeight: 700, margin: 0 }}>
          Call system reconnecting…
        </p>
        <p style={{ fontSize: 11, color: "rgba(255,159,10,0.75)", margin: "2px 0 0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Your call to {number} will retry automatically
        </p>
      </div>
      <Loader2 style={{ width: 16, height: 16, color: "#ff9f0a", flexShrink: 0 }} className="animate-spin" />
      <button
        onClick={onCancel}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "rgba(255,159,10,0.6)", fontSize: 18, lineHeight: 1,
          padding: "0 2px", flexShrink: 0,
        }}
        aria-label="Cancel retry"
      >
        ×
      </button>
    </div>
  );
}
