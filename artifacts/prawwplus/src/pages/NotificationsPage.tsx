import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Phone, Voicemail, AlertCircle, MessageSquare, Star, TrendingUp, ChevronLeft, Loader2, BellRing, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
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

type SubStatus = "idle" | "subscribed" | "failed" | "vapid_missing" | "not_supported";

async function registerWebPushSubscription(): Promise<{ ok: boolean; status: SubStatus; error?: string }> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, status: "not_supported", error: "Push notifications are not supported in this browser." };
  }

  try {
    const keyResp = await fetch("/api/users/vapid-public-key");
    if (keyResp.status === 503) {
      return { ok: false, status: "vapid_missing", error: "Push notifications are not configured on the server. Contact your administrator." };
    }
    if (!keyResp.ok) {
      return { ok: false, status: "failed", error: "Could not load push configuration from server." };
    }
    const { key } = (await keyResp.json()) as { key?: string };
    if (!key) {
      return { ok: false, status: "vapid_missing", error: "Server returned an invalid push configuration." };
    }

    const registration = await navigator.serviceWorker.ready;
    let sub = await registration.pushManager.getSubscription();

    const appServerKey = Uint8Array.from(
      atob(key.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );

    if (sub) {
      const existingKey = sub.options.applicationServerKey;
      const keysMatch = existingKey && (() => {
        const a = new Uint8Array(existingKey as ArrayBuffer);
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

    const saveResp = await fetch("/api/users/web-push-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
      credentials: "include",
    });

    if (!saveResp.ok) {
      return { ok: false, status: "failed", error: "Subscription was created but could not be saved. Please try again." };
    }

    return { ok: true, status: "subscribed" };
  } catch (err: any) {
    return { ok: false, status: "failed", error: err?.message ?? "Failed to set up push subscription." };
  }
}

export default function NotificationsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const [settings, setSettings] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [subStatus, setSubStatus] = useState<SubStatus>("idle");
  const [subError, setSubError] = useState<string | null>(null);
  const [requestingPush, setRequestingPush] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (user && !loadedRef.current) {
      loadedRef.current = true;
      const prefs = (user as any).notificationPrefs;
      if (prefs) {
        setSettings((prev) => ({ ...prev, ...prefs }));
      }
    }
  }, [user]);

  useEffect(() => {
    if ("Notification" in window) {
      setPushPermission(Notification.permission);
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSubStatus("not_supported");
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription()
      ).then((sub) => {
        if (sub) setSubStatus("subscribed");
      }).catch(() => {});
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

  const enablePush = async () => {
    if (subStatus === "not_supported") {
      toast({ title: "Not supported", description: "Your browser does not support push notifications.", variant: "destructive" });
      return;
    }

    setRequestingPush(true);
    setSubError(null);
    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
      }
      setPushPermission(permission);

      if (permission === "denied") {
        setSubStatus("failed");
        setSubError("Notification permission was blocked. See the instructions below to unblock.");
        return;
      }

      if (permission !== "granted") {
        setSubStatus("failed");
        setSubError("Permission was not granted. Please try again.");
        return;
      }

      const result = await registerWebPushSubscription();
      setSubStatus(result.status);
      if (result.ok) {
        setSettings((s) => ({ ...s, pushEnabled: true }));
        await saveToAPI("pushEnabled", true);
        toast({ title: "Push notifications enabled", description: "You will now receive call and account alerts." });
      } else {
        setSubError(result.error ?? "Failed to enable notifications.");
        if (result.status !== "vapid_missing") {
          toast({ title: "Notifications failed", description: result.error, variant: "destructive" });
        }
      }
    } catch (err: any) {
      setSubStatus("failed");
      setSubError(err?.message ?? "Unexpected error enabling notifications.");
      toast({ title: "Failed to enable notifications", variant: "destructive" });
    } finally {
      setRequestingPush(false);
    }
  };

  const isSubscribed = subStatus === "subscribed" && pushPermission === "granted";
  const isBlocked    = pushPermission === "denied";
  const isNotSupported = subStatus === "not_supported";

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

      {/* Push Notification Status Banner */}
      <div style={{
        padding: "14px 16px",
        borderRadius: 16,
        background: isSubscribed
          ? "rgba(48,209,88,0.10)"
          : isBlocked || subStatus === "vapid_missing"
          ? "rgba(255,69,58,0.08)"
          : "rgba(10,132,255,0.10)",
        border: `1px solid ${isSubscribed ? "rgba(48,209,88,0.22)" : isBlocked || subStatus === "vapid_missing" ? "rgba(255,69,58,0.22)" : "rgba(10,132,255,0.22)"}`,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        {isSubscribed
          ? <CheckCircle2 style={{ width: 22, height: 22, color: "#30d158", flexShrink: 0 }} />
          : isBlocked || subStatus === "vapid_missing"
          ? <XCircle style={{ width: 22, height: 22, color: "#ff453a", flexShrink: 0 }} />
          : <BellRing style={{ width: 22, height: 22, color: "#1a8cff", flexShrink: 0 }} />
        }
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {isSubscribed
              ? "Push notifications active"
              : isBlocked
              ? "Notifications blocked by browser"
              : subStatus === "vapid_missing"
              ? "Push notifications not configured"
              : isNotSupported
              ? "Not supported in this browser"
              : "Enable push notifications"}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0" }}>
            {isSubscribed
              ? "You'll receive alerts for incoming calls and low balance."
              : isBlocked
              ? "You have blocked notifications. See the instructions below to unblock."
              : subStatus === "vapid_missing"
              ? "Contact your administrator to configure push notifications on the server."
              : isNotSupported
              ? "Use Chrome, Edge, Firefox, or Safari 16.4+ (iOS) for push notifications."
              : "Get alerted for calls and account events even when the app is in the background."}
          </p>
        </div>
        {!isSubscribed && !isBlocked && !isNotSupported && subStatus !== "vapid_missing" && (
          <button
            onClick={enablePush}
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
        {isSubscribed && (
          <button
            onClick={enablePush}
            disabled={requestingPush}
            title="Re-register subscription"
            style={{
              flexShrink: 0, padding: "7px", borderRadius: 20,
              background: "rgba(48,209,88,0.12)", border: "1px solid rgba(48,209,88,0.25)",
              color: "#30d158", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <RefreshCw style={{ width: 13, height: 13 }} />
          </button>
        )}
      </div>

      {/* Sub error (vapid missing or other failure) */}
      {subError && !isBlocked && (
        <div style={{
          padding: "12px 14px", borderRadius: 12,
          background: "rgba(255,149,0,0.07)", border: "1px solid rgba(255,149,0,0.2)",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <AlertCircle style={{ width: 14, height: 14, color: "#ff9500", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: "#ff9500", margin: 0, lineHeight: 1.5 }}>{subError}</p>
        </div>
      )}

      {/* Browser-blocked instructions */}
      {isBlocked && (
        <div style={{
          padding: "14px 16px",
          borderRadius: 14,
          background: "rgba(255,69,58,0.07)",
          border: "1px solid rgba(255,69,58,0.18)",
        }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#ff453a", margin: "0 0 8px" }}>
            How to unblock notifications
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Chrome / Android", steps: 'Tap the lock icon in the address bar → Site settings → Notifications → Allow' },
              { label: "Safari / iOS",     steps: 'Settings → Safari → [this site] → Notifications → Allow' },
              { label: "Firefox",          steps: 'Tap the lock icon → Connection Secure → More information → Permissions → Notifications → Allow' },
            ].map(({ label, steps }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "9px 12px" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: 0, lineHeight: 1.4 }}>{steps}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "rgba(255,69,58,0.55)", margin: "10px 0 0", lineHeight: 1.4 }}>
            After allowing, reload this page and tap "Enable" again.
          </p>
        </div>
      )}

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
