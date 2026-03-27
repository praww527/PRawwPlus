import { useState, useEffect } from "react";
import {
  ChevronLeft, Volume2, BellRing, BellOff, Clock, Loader2, Check,
} from "lucide-react";
import { useLocation } from "wouter";
import { useGetVertoConfig, useUpdateUserSettings } from "@workspace/api-client-react";

interface SelectRowProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}

function SelectRow({ icon, iconBg, iconColor, label, value, options, onChange, disabled }: SelectRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", opacity: disabled ? 0.5 : 1 }}>
      <div className="icon-badge" style={{ background: iconBg }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: "var(--text-1)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 8,
          color: "var(--text-2)",
          fontSize: 13,
          padding: "4px 8px",
          cursor: disabled ? "not-allowed" : "pointer",
          outline: "none",
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value} style={{ background: "#1c1c2e" }}>{o.label}</option>)}
      </select>
    </div>
  );
}

interface ToggleRowProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function ToggleRow({ icon, iconBg, iconColor, label, description, enabled, onToggle, disabled }: ToggleRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", opacity: disabled ? 0.5 : 1 }}>
      <div className="icon-badge" style={{ background: iconBg }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-1)", margin: 0 }}>{label}</p>
        {description && <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0", lineHeight: 1.3 }}>{description}</p>}
      </div>
      <div
        className="toggle-track"
        style={{ background: enabled ? "#1a8cff" : "rgba(255,255,255,0.15)", cursor: disabled ? "not-allowed" : "pointer" }}
        onClick={disabled ? undefined : onToggle}
      >
        <div className="toggle-thumb" style={{ left: enabled ? 22 : 2 }} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <div>
      <p className="section-label" style={{ paddingLeft: 4, marginBottom: 6 }}>{title}</p>
      <div className="section-card">
        {kids.map((child, i) => (
          <div key={i}>
            {child}
            {i < kids.length - 1 && <div className="row-sep" />}
          </div>
        ))}
      </div>
    </div>
  );
}

const RINGTONE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "classic", label: "Classic" },
  { value: "digital", label: "Digital" },
  { value: "soft", label: "Soft" },
  { value: "urgent", label: "Urgent" },
  { value: "none", label: "Silent" },
];

const DURATION_OPTIONS = [
  { value: "15", label: "15 sec" },
  { value: "20", label: "20 sec" },
  { value: "30", label: "30 sec" },
  { value: "45", label: "45 sec" },
  { value: "60", label: "60 sec" },
  { value: "90", label: "90 sec" },
  { value: "120", label: "2 min" },
];

export default function CallSettingsPage() {
  const [, setLocation] = useLocation();

  const { data: vertoConfig, isLoading } = useGetVertoConfig();

  const [ringtone, setRingtone] = useState("default");
  const [ringtoneDuration, setRingtoneDuration] = useState("30");
  const [dnd, setDnd] = useState(false);

  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { mutate: saveSettings, isPending: isSaving } = useUpdateUserSettings({
    mutation: {
      onSuccess: () => {
        setSaved(true);
        setSaveError(null);
        setTimeout(() => setSaved(false), 2500);
      },
      onError: (err: any) => {
        setSaveError(err?.data?.error ?? "Failed to save settings");
      },
    },
  });

  useEffect(() => {
    if (vertoConfig?.settings) {
      const s = vertoConfig.settings;
      setRingtone(s.ringtone ?? "default");
      setRingtoneDuration(String(s.ringtoneDuration ?? 30));
      setDnd(s.dnd ?? false);
    }
  }, [vertoConfig]);

  const handleSave = () => {
    setSaveError(null);
    saveSettings({
      data: {
        ringtone,
        ringtoneDuration: parseInt(ringtoneDuration, 10),
        dnd,
      } as any,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4, paddingBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: 34, height: 34, borderRadius: "50%",
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <ChevronLeft style={{ width: 18, height: 18, color: "#1a8cff" }} />
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, flex: 1 }}>
          Call Settings
        </h1>
        <button
          onClick={handleSave}
          disabled={isSaving || isLoading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: saved ? "rgba(48,209,88,0.2)" : "rgba(26,140,255,0.18)",
            border: `1px solid ${saved ? "rgba(48,209,88,0.4)" : "rgba(26,140,255,0.35)"}`,
            borderRadius: 20, padding: "6px 14px",
            color: saved ? "#30d158" : "#1a8cff",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {isSaving ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : saved ? <Check size={13} /> : null}
          {isSaving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>

      {saveError && (
        <div style={{
          background: "rgba(255,69,58,0.15)", border: "1px solid rgba(255,69,58,0.3)",
          borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#ff453a",
        }}>
          {saveError}
        </div>
      )}

      {isLoading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "20px 0", color: "var(--text-3)" }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      )}

      <Section title="Incoming Calls">
        <ToggleRow
          icon={dnd ? <BellOff size={15} /> : <BellRing size={15} />}
          iconBg={dnd ? "rgba(255,69,58,0.18)" : "rgba(48,209,88,0.18)"}
          iconColor={dnd ? "#ff453a" : "#30d158"}
          label="Do Not Disturb" description="Reject all incoming calls"
          enabled={dnd} onToggle={() => setDnd((v) => !v)}
          disabled={isLoading}
        />
        <SelectRow
          icon={<Volume2 size={15} />} iconBg="rgba(255,214,10,0.15)" iconColor="#ffd60a"
          label="Ringtone" value={ringtone}
          options={RINGTONE_OPTIONS}
          onChange={setRingtone}
          disabled={isLoading}
        />
        <SelectRow
          icon={<Clock size={15} />} iconBg="rgba(94,92,230,0.15)" iconColor="#5e5ce6"
          label="Ring Duration" value={ringtoneDuration}
          options={DURATION_OPTIONS}
          onChange={setRingtoneDuration}
          disabled={isLoading}
        />
      </Section>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", paddingBottom: 4 }}>
        Settings sync to your account across all devices.
      </p>
    </div>
  );
}
