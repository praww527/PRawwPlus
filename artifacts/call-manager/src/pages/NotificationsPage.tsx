import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Phone, Voicemail, AlertCircle, MessageSquare, Star, TrendingUp, ChevronLeft, Loader2, BellRing, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

interface NotifPrefs {
  incomingCalls: boolean;
  missedCalls: boolean;
  voicemail: boolean;
  lowBalance: boolean;
  sms: boolean;
  promotions: boolean;
  weeklyReport: boolean;
  sound: boolean;
  vibration: boolean;
  badge: boolean;
  pushEnabled: boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
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
  pushEnabled: false,
};

interface ToggleRowProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
  saving?: boolean;
}

function ToggleRow({ icon, iconBg, iconColor, label, description, enabled, onToggle, saving }: ToggleRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
      <div className="icon-badge" style={{ background: iconBg }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-1)", margin: 0 }}>{label}</p>
        {description && <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0", lineHeight: 1.3 }}>{description}</p>}
      </div>
      {saving ? (
        <Loader2 style={{ width: 18, height: 18, color: "var(--text-3)" }} className="animate-spin" />
      ) : (
        <div
          className="toggle-track"
          style={{ background: enabled ? "#1a8cff" : "rgba(255,255,255,0.15)", cursor: "pointer" }}
          onClick={onToggle}
        >
          <div className="toggle-thumb" style={{ left: enabled ? 22 : 2 }} />
        </div>
      )}
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
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const [settings, setSettings] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [requestingPush, setRequestingPush] = useState(false);
  const loadedRef = useRef(false);

  // Load settings from user data
  useEffect(() => {
    if (user && !loadedRef.current) {
      loadedRef.current = true;
      const prefs = (user as any).notificationPrefs;
      if (prefs) {
        setSettings((prev) => ({ ...prev, ...prefs }));
      }
    }
  }, [user]);

  // Check current push permission
  useEffect(() => {
    if ("Notification" in window) {
      setPushPermission(Notification.permission);
    }
  }, []);

  const saveToAPI = useCallback(async (key: string, value: boolean) => {
    setSavingKey(key);
    try {
      const res = await fetch("/api/users/notification-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch {
      toast({ title: "Could not save setting", variant: "destructive" });
      // Revert on error
      setSettings((s) => ({ ...s, [key]: !value }));
    } finally {
      setSavingKey(null);
    }
  }, [toast]);

  const toggle = useCallback((key: keyof NotifPrefs) => {
    setSettings((s) => {
      const next = !s[key];
      saveToAPI(key, next);
      return { ...s, [key]: next };
    });
  }, [saveToAPI]);

  const requestPushPermission = async () => {
    if (!("Notification" in window)) {
      toast({ title: "Push notifications not supported", description: "Your browser doesn't support notifications.", variant: "destructive" });
      return;
    }

    setRequestingPush(true);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission === "granted") {
        // Update pushEnabled in DB
        setSettings((s) => ({ ...s, pushEnabled: true }));
        await saveToAPI("pushEnabled", true);
        toast({ title: "Push notifications enabled" });

        // Show a test notification
        new Notification("PRaww+ Notifications", {
          body: "You will now receive call and account alerts.",
          icon: "/favicon.svg",
        });
      } else if (permission === "denied") {
        toast({
          title: "Notifications blocked",
          description: "Please enable notifications in your browser settings.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Failed to request permission", variant: "destructive" });
    } finally {
      setRequestingPush(false);
    }
  };

  const pushGranted = pushPermission === "granted" && settings.pushEnabled;

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

      {/* Push Notification Permission Banner */}
      <div style={{
        padding: "14px 16px",
        borderRadius: 16,
        background: pushGranted
          ? "rgba(48,209,88,0.10)"
          : "rgba(10,132,255,0.10)",
        border: `1px solid ${pushGranted ? "rgba(48,209,88,0.22)" : "rgba(10,132,255,0.22)"}`,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        {pushGranted
          ? <CheckCircle2 style={{ width: 22, height: 22, color: "#30d158", flexShrink: 0 }} />
          : <BellRing style={{ width: 22, height: 22, color: "#1a8cff", flexShrink: 0 }} />
        }
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {pushGranted ? "Push notifications active" : "Enable push notifications"}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0" }}>
            {pushGranted
              ? "You'll receive alerts for incoming calls and low balance."
              : "Get alerted for calls and account events even when the app is in the background."}
          </p>
        </div>
        {!pushGranted && pushPermission !== "denied" && (
          <button
            onClick={requestPushPermission}
            disabled={requestingPush}
            style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 20,
              background: "#1a8cff", border: "none",
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: requestingPush ? "default" : "pointer",
              opacity: requestingPush ? 0.7 : 1,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {requestingPush && <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />}
            {requestingPush ? "Enabling…" : "Enable"}
          </button>
        )}
        {pushPermission === "denied" && (
          <span style={{ fontSize: 11, color: "#ff453a", fontWeight: 600, flexShrink: 0 }}>
            Blocked by browser
          </span>
        )}
      </div>

      <Section title="Calls">
        <ToggleRow
          icon={<Phone size={15} />} iconBg="rgba(48,209,88,0.18)" iconColor="#30d158"
          label="Incoming Calls" description="Alert when someone calls you"
          enabled={settings.incomingCalls} onToggle={() => toggle("incomingCalls")}
          saving={savingKey === "incomingCalls"}
        />
        <ToggleRow
          icon={<Phone size={15} />} iconBg="rgba(255,69,58,0.18)" iconColor="#ff453a"
          label="Missed Calls" description="Notify when you miss a call"
          enabled={settings.missedCalls} onToggle={() => toggle("missedCalls")}
          saving={savingKey === "missedCalls"}
        />
        <ToggleRow
          icon={<Voicemail size={15} />} iconBg="rgba(94,92,230,0.18)" iconColor="#5e5ce6"
          label="Voicemail" description="Alert when you receive a voicemail"
          enabled={settings.voicemail} onToggle={() => toggle("voicemail")}
          saving={savingKey === "voicemail"}
        />
      </Section>

      <Section title="Account">
        <ToggleRow
          icon={<AlertCircle size={15} />} iconBg="rgba(255,149,0,0.18)" iconColor="#ff9500"
          label="Low Balance Alert" description="Notify when coins drop below 5"
          enabled={settings.lowBalance} onToggle={() => toggle("lowBalance")}
          saving={savingKey === "lowBalance"}
        />
        <ToggleRow
          icon={<MessageSquare size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="SMS Notifications" description="Receive alerts via text message"
          enabled={settings.sms} onToggle={() => toggle("sms")}
          saving={savingKey === "sms"}
        />
      </Section>

      <Section title="Marketing">
        <ToggleRow
          icon={<Star size={15} />} iconBg="rgba(255,214,10,0.18)" iconColor="#ffd60a"
          label="Promotions & Offers" description="Special deals and discounts"
          enabled={settings.promotions} onToggle={() => toggle("promotions")}
          saving={savingKey === "promotions"}
        />
        <ToggleRow
          icon={<TrendingUp size={15} />} iconBg="rgba(48,209,88,0.15)" iconColor="#30d158"
          label="Weekly Usage Report" description="Summary of your call activity"
          enabled={settings.weeklyReport} onToggle={() => toggle("weeklyReport")}
          saving={savingKey === "weeklyReport"}
        />
      </Section>

      <Section title="Delivery">
        <ToggleRow
          icon={<Bell size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="Sound" description="Play a sound for notifications"
          enabled={settings.sound} onToggle={() => toggle("sound")}
          saving={savingKey === "sound"}
        />
        <ToggleRow
          icon={<Bell size={15} />} iconBg="rgba(120,65,190,0.18)" iconColor="#bf5af2"
          label="Vibration" description="Vibrate on notification"
          enabled={settings.vibration} onToggle={() => toggle("vibration")}
          saving={savingKey === "vibration"}
        />
        <ToggleRow
          icon={<Bell size={15} />} iconBg="rgba(255,69,58,0.15)" iconColor="#ff453a"
          label="App Badge" description="Show unread count on app icon"
          enabled={settings.badge} onToggle={() => toggle("badge")}
          saving={savingKey === "badge"}
        />
      </Section>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", paddingBottom: 4 }}>
        Settings are saved automatically
      </p>
    </div>
  );
}
