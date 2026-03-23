import { useState } from "react";
import { Bell, Phone, Voicemail, AlertCircle, MessageSquare, Star, TrendingUp, ChevronLeft } from "lucide-react";
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
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px",
    }}>
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
        <div
          className="toggle-thumb"
          style={{ left: enabled ? 22 : 2 }}
        />
      </div>
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

export default function NotificationsPage() {
  const [, setLocation] = useLocation();
  const [settings, setSettings] = useState({
    incomingCalls: true,
    missedCalls: true,
    voicemail: true,
    lowBalance: true,
    sms: false,
    promotions: false,
    weeklyReport: false,
    sound: true,
    vibration: true,
    badge: true,
  });

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
          Notifications
        </h1>
      </div>

      <Section title="Calls">
        <ToggleRow
          icon={<Phone size={15} />} iconBg="rgba(48,209,88,0.18)" iconColor="#30d158"
          label="Incoming Calls" description="Alert when someone calls you"
          enabled={settings.incomingCalls} onToggle={() => toggle("incomingCalls")}
        />
        <ToggleRow
          icon={<Phone size={15} />} iconBg="rgba(255,69,58,0.18)" iconColor="#ff453a"
          label="Missed Calls" description="Notify when you miss a call"
          enabled={settings.missedCalls} onToggle={() => toggle("missedCalls")}
        />
        <ToggleRow
          icon={<Voicemail size={15} />} iconBg="rgba(94,92,230,0.18)" iconColor="#5e5ce6"
          label="Voicemail" description="Alert when you receive a voicemail"
          enabled={settings.voicemail} onToggle={() => toggle("voicemail")}
        />
      </Section>

      <Section title="Account">
        <ToggleRow
          icon={<AlertCircle size={15} />} iconBg="rgba(255,149,0,0.18)" iconColor="#ff9500"
          label="Low Balance Alert" description="Notify when coins drop below 5"
          enabled={settings.lowBalance} onToggle={() => toggle("lowBalance")}
        />
        <ToggleRow
          icon={<MessageSquare size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="SMS Notifications" description="Receive alerts via text message"
          enabled={settings.sms} onToggle={() => toggle("sms")}
        />
      </Section>

      <Section title="Marketing">
        <ToggleRow
          icon={<Star size={15} />} iconBg="rgba(255,214,10,0.18)" iconColor="#ffd60a"
          label="Promotions & Offers" description="Special deals and discounts"
          enabled={settings.promotions} onToggle={() => toggle("promotions")}
        />
        <ToggleRow
          icon={<TrendingUp size={15} />} iconBg="rgba(48,209,88,0.15)" iconColor="#30d158"
          label="Weekly Usage Report" description="Summary of your call activity"
          enabled={settings.weeklyReport} onToggle={() => toggle("weeklyReport")}
        />
      </Section>

      <Section title="Delivery">
        <ToggleRow
          icon={<Bell size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="Sound" description="Play a sound for notifications"
          enabled={settings.sound} onToggle={() => toggle("sound")}
        />
        <ToggleRow
          icon={<Bell size={15} />} iconBg="rgba(120,65,190,0.18)" iconColor="#bf5af2"
          label="Vibration" description="Vibrate on notification"
          enabled={settings.vibration} onToggle={() => toggle("vibration")}
        />
        <ToggleRow
          icon={<Bell size={15} />} iconBg="rgba(255,69,58,0.15)" iconColor="#ff453a"
          label="App Badge" description="Show unread count on app icon"
          enabled={settings.badge} onToggle={() => toggle("badge")}
        />
      </Section>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", paddingBottom: 4 }}>
        Notification settings are saved automatically
      </p>
    </div>
  );
}
