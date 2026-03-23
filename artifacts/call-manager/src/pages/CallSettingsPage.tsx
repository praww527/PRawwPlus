import { useState } from "react";
import {
  ChevronLeft, Phone, Wifi, Mic, Volume2, Shield,
  Clock, Radio, Headphones, PhoneForwarded, PhoneMissed,
} from "lucide-react";
import { useLocation } from "wouter";

interface ToggleRowProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
}

function ToggleRow({ icon, iconBg, iconColor, label, description, enabled, onToggle }: ToggleRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
      <div className="icon-badge" style={{ background: iconBg }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-1)", margin: 0 }}>{label}</p>
        {description && <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0", lineHeight: 1.3 }}>{description}</p>}
      </div>
      <div
        className="toggle-track"
        style={{ background: enabled ? "#1a8cff" : "rgba(255,255,255,0.15)" }}
        onClick={onToggle}
      >
        <div className="toggle-thumb" style={{ left: enabled ? 22 : 2 }} />
      </div>
    </div>
  );
}

interface SelectRowProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}

function SelectRow({ icon, iconBg, iconColor, label, value, options, onChange }: SelectRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
      <div className="icon-badge" style={{ background: iconBg }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: "var(--text-1)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 8,
          color: "var(--text-2)",
          fontSize: 13,
          padding: "4px 8px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        {options.map((o) => <option key={o} value={o} style={{ background: "#1c1c2e" }}>{o}</option>)}
      </select>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children : [children];
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

export default function CallSettingsPage() {
  const [, setLocation] = useLocation();
  const [settings, setSettings] = useState({
    wifiCalling: true,
    noiseCancellation: true,
    autoAnswer: false,
    recordCalls: false,
    hd: true,
    earpiece: false,
    forwarding: false,
    waitingTone: true,
  });
  const [codec, setCodec] = useState("Opus HD");
  const [ringtone, setRingtone] = useState("Default");
  const [forwardTo, setForwardTo] = useState("Voicemail");

  const toggle = (key: keyof typeof settings) =>
    setSettings((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4, paddingBottom: 8 }}>
      {/* Header */}
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
        <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0 }}>
          Call Settings
        </h1>
      </div>

      <Section title="Audio & Quality">
        <ToggleRow
          icon={<Wifi size={15} />} iconBg="rgba(48,209,88,0.18)" iconColor="#30d158"
          label="Wi-Fi Calling" description="Use internet for better call quality"
          enabled={settings.wifiCalling} onToggle={() => toggle("wifiCalling")}
        />
        <ToggleRow
          icon={<Mic size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="Noise Cancellation" description="Filter background noise automatically"
          enabled={settings.noiseCancellation} onToggle={() => toggle("noiseCancellation")}
        />
        <ToggleRow
          icon={<Radio size={15} />} iconBg="rgba(94,92,230,0.18)" iconColor="#5e5ce6"
          label="HD Voice" description="High-definition audio when supported"
          enabled={settings.hd} onToggle={() => toggle("hd")}
        />
        <SelectRow
          icon={<Headphones size={15} />} iconBg="rgba(120,65,190,0.18)" iconColor="#bf5af2"
          label="Audio Codec" value={codec}
          options={["Opus HD", "G.711", "G.722", "G.729"]}
          onChange={setCodec}
        />
      </Section>

      <Section title="Incoming Calls">
        <ToggleRow
          icon={<Phone size={15} />} iconBg="rgba(255,149,0,0.18)" iconColor="#ff9500"
          label="Auto-Answer" description="Answer calls automatically after 5 seconds"
          enabled={settings.autoAnswer} onToggle={() => toggle("autoAnswer")}
        />
        <ToggleRow
          icon={<Volume2 size={15} />} iconBg="rgba(48,209,88,0.15)" iconColor="#30d158"
          label="Call Waiting Tone" description="Hear a tone when another call comes in"
          enabled={settings.waitingTone} onToggle={() => toggle("waitingTone")}
        />
        <SelectRow
          icon={<Volume2 size={15} />} iconBg="rgba(255,214,10,0.15)" iconColor="#ffd60a"
          label="Ringtone" value={ringtone}
          options={["Default", "Chime", "Classic", "Marimba", "Silent"]}
          onChange={setRingtone}
        />
      </Section>

      <Section title="Call Forwarding">
        <ToggleRow
          icon={<PhoneForwarded size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="Forward Calls" description="Redirect incoming calls when unavailable"
          enabled={settings.forwarding} onToggle={() => toggle("forwarding")}
        />
        <SelectRow
          icon={<PhoneMissed size={15} />} iconBg="rgba(255,69,58,0.15)" iconColor="#ff453a"
          label="Forward To" value={forwardTo}
          options={["Voicemail", "Another Number", "Off"]}
          onChange={setForwardTo}
        />
      </Section>

      <Section title="Privacy & Recording">
        <ToggleRow
          icon={<Shield size={15} />} iconBg="rgba(48,209,88,0.18)" iconColor="#30d158"
          label="Record Calls" description="Automatically record all calls locally"
          enabled={settings.recordCalls} onToggle={() => toggle("recordCalls")}
        />
        <ToggleRow
          icon={<Clock size={15} />} iconBg="rgba(100,100,110,0.28)" iconColor="var(--text-2)"
          label="Use Earpiece by Default" description="Route audio to earpiece instead of speaker"
          enabled={settings.earpiece} onToggle={() => toggle("earpiece")}
        />
      </Section>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", paddingBottom: 4 }}>
        Settings apply to all future calls
      </p>
    </div>
  );
}
