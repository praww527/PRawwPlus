import { useState, Children, useEffect } from "react";
import { useAuth } from "@workspace/auth-web";
import {
  useGetMe, useListPayments, useInitiateSubscription,
  useTopUpCredits, useListMyNumbers, useRemoveNumber,
} from "@workspace/api-client-react";
import type { OwnedNumber, PaymentRecord } from "@workspace/api-client-react";
import {
  ChevronRight, LogOut, Trash2, Phone, Coins, Receipt,
  Star, Zap, Bell, Mic, Hash, FileText, ShieldCheck,
  HelpCircle, Mail, CreditCard, Loader2, CheckCircle2,
  AlertCircle, Plus, X, Shuffle, Smartphone,
} from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { MODAL_Z, NAV_H, NAV_BOTTOM_GAP } from "@/components/Layout";

const PLANS = [
  { id: "basic", name: "Basic", price: 59,  maxNumbers: 1 },
  { id: "pro",   name: "Pro",   price: 109, maxNumbers: 2 },
] as const;

const CONTACT_EMAIL = "info@prawwplus.co.za";

function PayFastRedirect({ data }: { data: any }) {
  if (!data) return null;
  return (
    <form method="POST" action={data.paymentUrl} target="_self" className="hidden" id="pf-form">
      {Object.entries(data.formFields as Record<string, string>).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </form>
  );
}

const SHEET_CLEAR = NAV_H + NAV_BOTTOM_GAP + 10;

/* ── Modal sheet ───────────────────────────────────────────────────── */
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="overlay-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: MODAL_Z,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        paddingBottom: `calc(${SHEET_CLEAR}px + env(safe-area-inset-bottom, 0px))`,
      }}
    >
      <div
        className="modal-surface slide-up"
        style={{
          borderRadius: "24px 24px 0 0",
          paddingBottom: 24,
          maxHeight: `calc(100dvh - ${SHEET_CLEAR}px - env(safe-area-inset-bottom, 0px))`,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 14, paddingBottom: 6 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--sep-strong)" }} />
        </div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 16px" }}>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>{title}</p>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 15,
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X style={{ width: 14, height: 14, color: "var(--text-2)" }} />
          </button>
        </div>
        <div style={{ padding: "0 20px 8px" }}>{children}</div>
      </div>
    </div>
  );
}

/* ── Settings row ──────────────────────────────────────────────────── */
function Row({
  icon, iconColor = "hsl(var(--primary))", iconBg = "rgba(10,132,255,0.18)",
  label, value, chevron = true, onClick, danger = false,
}: {
  icon: React.ReactNode; iconColor?: string; iconBg?: string;
  label: string; value?: string; chevron?: boolean; onClick?: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "11px 16px", textAlign: "left",
        background: "transparent", border: "none",
        cursor: onClick ? "pointer" : "default",
        transition: "background 0.12s",
      }}
      onPointerDown={(e) => onClick && (e.currentTarget.style.background = "var(--glass-bg-strong)")}
      onPointerUp={(e) => (e.currentTarget.style.background = "transparent")}
      onPointerLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div className="icon-badge" style={{ background: iconBg }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: danger ? "#ff453a" : "var(--text-1)", textAlign: "left" }}>
        {label}
      </span>
      {value && <span style={{ fontSize: 13, color: "var(--text-3)", marginRight: 2, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>}
      {chevron && onClick && <ChevronRight style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />}
    </button>
  );
}

/* ── Section wrapper ───────────────────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = Children.toArray(children).filter(Boolean);
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

/* ── Inline: Notifications toggles ────────────────────────────────── */
function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <div
      className="toggle-track"
      style={{ background: enabled ? "hsl(var(--primary))" : "rgba(128,128,128,0.25)" }}
      onClick={onToggle}
    >
      <div className="toggle-thumb" style={{ left: enabled ? 22 : 2 }} />
    </div>
  );
}

function InlineToggleRow({ icon, iconBg, iconColor, label, description, enabled, onToggle }: {
  icon: React.ReactNode; iconBg: string; iconColor: string;
  label: string; description?: string; enabled: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
      <div className="icon-badge" style={{ background: iconBg, flexShrink: 0 }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-1)", margin: 0 }}>{label}</p>
        {description && <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0", lineHeight: 1.3 }}>{description}</p>}
      </div>
      <ToggleSwitch enabled={enabled} onToggle={onToggle} />
    </div>
  );
}

function InlineSelectRow({ icon, iconBg, iconColor, label, value, options, onChange }: {
  icon: React.ReactNode; iconBg: string; iconColor: string;
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
      <div className="icon-badge" style={{ background: iconBg, flexShrink: 0 }}>
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: "var(--text-1)" }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 8, color: "var(--text-2)", fontSize: 13, padding: "4px 8px", cursor: "pointer", outline: "none" }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function InlineSection({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = Children.toArray(children).filter(Boolean);
  return (
    <div style={{ marginBottom: 16 }}>
      <p className="section-label" style={{ paddingLeft: 0, marginBottom: 6 }}>{title}</p>
      <div className="section-card" style={{ padding: "0 16px" }}>
        {kids.map((child, i) => (
          <div key={i}>
            {child}
            {i < kids.length - 1 && <div style={{ height: 1, background: "var(--sep)", margin: "0 -16px 0" }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsSheet() {
  const [s, setS] = useState({
    incomingCalls: true, missedCalls: true, voicemail: true,
    lowBalance: true, sms: false, promotions: false,
    weeklyReport: false, sound: true, vibration: true, badge: true,
  });
  const toggle = (k: keyof typeof s) => setS((prev) => ({ ...prev, [k]: !prev[k] }));
  return (
    <div>
      <InlineSection title="Calls">
        <InlineToggleRow icon={<Phone size={15} />} iconBg="rgba(48,209,88,0.18)" iconColor="#30d158"
          label="Incoming Calls" description="Alert when someone calls you" enabled={s.incomingCalls} onToggle={() => toggle("incomingCalls")} />
        <InlineToggleRow icon={<Phone size={15} />} iconBg="rgba(255,69,58,0.18)" iconColor="#ff453a"
          label="Missed Calls" description="Notify when you miss a call" enabled={s.missedCalls} onToggle={() => toggle("missedCalls")} />
        <InlineToggleRow icon={<Bell size={15} />} iconBg="rgba(94,92,230,0.18)" iconColor="#5e5ce6"
          label="Voicemail" description="Alert when you receive a voicemail" enabled={s.voicemail} onToggle={() => toggle("voicemail")} />
      </InlineSection>
      <InlineSection title="Account">
        <InlineToggleRow icon={<Zap size={15} />} iconBg="rgba(255,149,0,0.18)" iconColor="#ff9500"
          label="Low Balance Alert" description="Notify when coins drop below 5" enabled={s.lowBalance} onToggle={() => toggle("lowBalance")} />
        <InlineToggleRow icon={<Bell size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="SMS Notifications" description="Receive alerts via text message" enabled={s.sms} onToggle={() => toggle("sms")} />
      </InlineSection>
      <InlineSection title="Delivery">
        <InlineToggleRow icon={<Bell size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="Sound" description="Play sound for notifications" enabled={s.sound} onToggle={() => toggle("sound")} />
        <InlineToggleRow icon={<Bell size={15} />} iconBg="rgba(120,65,190,0.18)" iconColor="#bf5af2"
          label="Vibration" description="Vibrate on notification" enabled={s.vibration} onToggle={() => toggle("vibration")} />
        <InlineToggleRow icon={<Bell size={15} />} iconBg="rgba(255,69,58,0.15)" iconColor="#ff453a"
          label="App Badge" description="Show unread count on app icon" enabled={s.badge} onToggle={() => toggle("badge")} />
      </InlineSection>
      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)" }}>Settings saved automatically</p>
    </div>
  );
}

function CallSettingsSheet() {
  const [s, setS] = useState({
    wifiCalling: true, noiseCancellation: true, autoAnswer: false,
    recordCalls: false, hd: true, earpiece: false, forwarding: false, waitingTone: true,
  });
  const [codec, setCodec] = useState("Opus HD");
  const [ringtone, setRingtone] = useState("Default");
  const [forwardTo, setForwardTo] = useState("Voicemail");
  const toggle = (k: keyof typeof s) => setS((prev) => ({ ...prev, [k]: !prev[k] }));
  return (
    <div>
      <InlineSection title="Audio & Quality">
        <InlineToggleRow icon={<Mic size={15} />} iconBg="rgba(48,209,88,0.18)" iconColor="#30d158"
          label="Wi-Fi Calling" description="Use internet for better call quality" enabled={s.wifiCalling} onToggle={() => toggle("wifiCalling")} />
        <InlineToggleRow icon={<Mic size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="Noise Cancellation" description="Filter background noise" enabled={s.noiseCancellation} onToggle={() => toggle("noiseCancellation")} />
        <InlineToggleRow icon={<Mic size={15} />} iconBg="rgba(94,92,230,0.18)" iconColor="#5e5ce6"
          label="HD Voice" description="High-definition audio when supported" enabled={s.hd} onToggle={() => toggle("hd")} />
        <InlineSelectRow icon={<Mic size={15} />} iconBg="rgba(120,65,190,0.18)" iconColor="#bf5af2"
          label="Audio Codec" value={codec} options={["Opus HD", "G.711", "G.722", "G.729"]} onChange={setCodec} />
      </InlineSection>
      <InlineSection title="Incoming Calls">
        <InlineToggleRow icon={<Phone size={15} />} iconBg="rgba(255,149,0,0.18)" iconColor="#ff9500"
          label="Auto-Answer" description="Answer calls after 5 seconds" enabled={s.autoAnswer} onToggle={() => toggle("autoAnswer")} />
        <InlineToggleRow icon={<Phone size={15} />} iconBg="rgba(48,209,88,0.15)" iconColor="#30d158"
          label="Call Waiting Tone" description="Tone when another call comes in" enabled={s.waitingTone} onToggle={() => toggle("waitingTone")} />
        <InlineSelectRow icon={<Phone size={15} />} iconBg="rgba(255,214,10,0.15)" iconColor="#ffd60a"
          label="Ringtone" value={ringtone} options={["Default", "Chime", "Classic", "Silent"]} onChange={setRingtone} />
      </InlineSection>
      <InlineSection title="Call Forwarding">
        <InlineToggleRow icon={<Phone size={15} />} iconBg="rgba(10,132,255,0.18)" iconColor="#1a8cff"
          label="Forward Calls" description="Redirect incoming calls" enabled={s.forwarding} onToggle={() => toggle("forwarding")} />
        <InlineSelectRow icon={<Phone size={15} />} iconBg="rgba(255,69,58,0.15)" iconColor="#ff453a"
          label="Forward To" value={forwardTo} options={["Voicemail", "Another Number", "Off"]} onChange={setForwardTo} />
      </InlineSection>
      <InlineSection title="Privacy">
        <InlineToggleRow icon={<Mic size={15} />} iconBg="rgba(48,209,88,0.18)" iconColor="#30d158"
          label="Record Calls" description="Auto-record all calls locally" enabled={s.recordCalls} onToggle={() => toggle("recordCalls")} />
        <InlineToggleRow icon={<Mic size={15} />} iconBg="rgba(100,100,110,0.28)" iconColor="var(--text-2)"
          label="Use Earpiece" description="Route audio to earpiece by default" enabled={s.earpiece} onToggle={() => toggle("earpiece")} />
      </InlineSection>
      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)" }}>Settings apply to all future calls</p>
    </div>
  );
}

type Sheet = "none" | "topup" | "plan" | "history" | "numbers" | "terms" | "privacy" | "contact" | "phone";

export default function Profile() {
  const { logout } = useAuth();
  const { data: user, isLoading } = useGetMe();
  const { data: paymentData } = useListPayments();
  const { data: numbersData, refetch: refetchNumbers } = useListMyNumbers();
  const { mutateAsync: subscribe, isPending: subscribing } = useInitiateSubscription();
  const { mutateAsync: topup, isPending: toppingUp } = useTopUpCredits();
  const { mutateAsync: removeNum, isPending: removing } = useRemoveNumber();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [pfData, setPfData] = useState<any>(null);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [topupAmount, setTopupAmount] = useState("50");
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro">("basic");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [phoneInput, setPhoneInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpStep, setOtpStep] = useState<"enter-phone" | "enter-otp">("enter-phone");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [otpCountdown, setOtpCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (otpStep !== "enter-otp" || otpCountdown === null || otpCountdown <= 0) return;
    const id = setTimeout(() => {
      setOtpCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearTimeout(id);
  }, [otpStep, otpCountdown]);

  const isActive      = user?.subscriptionStatus === "active";
  const currentPlan   = user?.subscriptionPlan ?? "basic";
  const coins         = user?.coins ?? 0;
  const myNumbers     = numbersData?.myNumbers ?? [];
  const maxNumbers    = numbersData?.maxNumbers ?? 1;
  const canAddMore    = myNumbers.length < maxNumbers;
  const primaryNumber = myNumbers[0]?.number ?? null;
  const recentPayments = paymentData?.payments?.slice(0, 20) ?? [];

  const handleSubscribe = async () => {
    try {
      const res = await subscribe({ data: { plan: selectedPlan } });
      setPfData(res);
      setTimeout(() => (document.getElementById("pf-form") as HTMLFormElement)?.submit(), 100);
    } catch { toast({ title: "Failed to initiate payment", variant: "destructive" }); }
  };

  const handleTopup = async () => {
    const amount = parseFloat(topupAmount);
    if (!amount || amount < 10) { toast({ title: "Minimum top-up is R10", variant: "destructive" }); return; }
    try {
      const res = await topup({ data: { amount } });
      setPfData(res);
      setTimeout(() => (document.getElementById("pf-form") as HTMLFormElement)?.submit(), 100);
    } catch { toast({ title: "Failed to initiate top-up", variant: "destructive" }); }
  };

  const userPhone = (user as any)?.phone as string | undefined;
  const userPhoneVerified = (user as any)?.phoneVerified as boolean | undefined;

  const openPhoneSheet = () => {
    setPhoneInput(userPhone ?? "");
    setOtpInput("");
    setOtpStep(userPhone && !userPhoneVerified ? "enter-otp" : "enter-phone");
    setPhoneMsg(null);
    setDevOtp(null);
    setOtpCountdown(userPhone && !userPhoneVerified ? null : null);
    setSheet("phone");
  };

  const handleSendOtp = async () => {
    if (!phoneInput.trim()) { setPhoneMsg("Enter your mobile number"); return; }
    setPhoneLoading(true);
    setPhoneMsg(null);
    setDevOtp(null);
    try {
      const res = await fetch("/api/auth/phone/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput.trim() }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setPhoneMsg(data.error ?? "Failed to send code");
      } else {
        setPhoneMsg(data.message ?? "Verification code sent");
        if (data.otp) setDevOtp(data.otp);
        setOtpInput("");
        setOtpCountdown(180);
        setOtpStep("enter-otp");
      }
    } catch {
      setPhoneMsg("Network error. Please try again.");
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpInput.trim() || otpInput.trim().length !== 6) { setPhoneMsg("Enter the 6-digit code"); return; }
    setPhoneLoading(true);
    setPhoneMsg(null);
    try {
      const res = await fetch("/api/auth/phone/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: otpInput.trim() }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setPhoneMsg(data.error ?? "Invalid code");
        if (res.status === 429) {
          setOtpCountdown(0);
        }
      } else {
        toast({ title: "Mobile number verified!", description: "Your number is now your PRaww+ calling identity." });
        setSheet("none");
        setTimeout(() => window.location.reload(), 500);
      }
    } catch {
      setPhoneMsg("Network error. Please try again.");
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleRemoveNumber = async (id: string, number: string) => {
    if (!confirm(`Remove ${number}? This cannot be undone.`)) return;
    setRemovingId(id);
    try {
      await removeNum({ id });
      toast({ title: "Number removed", description: `${number} has been released.` });
      refetchNumbers();
    } catch (err: any) {
      toast({ title: "Failed to remove number", description: err?.message, variant: "destructive" });
    } finally { setRemovingId(null); }
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
        {[120, 80, 180, 180].map((h, i) => (
          <div key={i} className="skeleton" style={{ height: h, borderRadius: 20 }} />
        ))}
      </div>
    );
  }

  return (
    <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 8, paddingTop: 4 }}>
      <PayFastRedirect data={pfData} />

      {/* ── User header ──────────────────────────────────── */}
      {(() => {
        const displayName = user?.name || user?.username || "—";
        const initials = displayName !== "—"
          ? displayName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
          : "?";
        return (
          <div style={{
            display: "flex", alignItems: "center", gap: 16,
            padding: "18px 20px",
            borderRadius: 24,
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 4px 28px var(--glass-shadow), 0 1px 0 var(--glass-highlight) inset",
          }}>
            {/* Avatar with initials */}
            <div style={{
              width: 64, height: 64, borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 16px rgba(59,130,246,0.35), 0 1px 0 rgba(255,255,255,0.22) inset",
              fontSize: 22, fontWeight: 700, color: "#fff",
              fontFamily: "var(--font-display)", letterSpacing: "-0.01em",
              border: "2px solid rgba(255,255,255,0.18)",
            }}>
              {initials}
            </div>

            {/* Name / email / status */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 19, fontWeight: 700, color: "var(--text-1)",
                fontFamily: "var(--font-display)", letterSpacing: "-0.01em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                lineHeight: 1.2,
              }}>
                {displayName}
              </p>
              <p style={{
                fontSize: 13, color: "var(--text-2)", marginTop: 3,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {user?.email ?? user?.username ?? ""}
              </p>
              {primaryNumber && (
                <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace", marginTop: 2 }}>
                  {primaryNumber}
                </p>
              )}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8,
                padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: isActive ? "rgba(48,209,88,0.14)" : "rgba(128,128,128,0.14)",
                color: isActive ? "#30d158" : "var(--text-3)",
                border: `1px solid ${isActive ? "rgba(48,209,88,0.25)" : "var(--sep)"}`,
              }}>
                {isActive
                  ? <CheckCircle2 style={{ width: 11, height: 11 }} />
                  : <AlertCircle style={{ width: 11, height: 11 }} />}
                {isActive
                  ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · Active`
                  : "No Active Plan"}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Quick stats ──────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        {[
          { label: "Coins", value: coins.toFixed(0), sub: "balance", color: "#ffd60a", bg: "rgba(255,214,10,0.12)" },
          { label: "Numbers", value: `${myNumbers.length}/${maxNumbers}`, sub: "assigned", color: "hsl(var(--primary))", bg: "rgba(10,132,255,0.12)" },
          { label: "Plan", value: isActive ? currentPlan.slice(0,1).toUpperCase() + currentPlan.slice(1) : "None", sub: isActive ? "active" : "inactive", color: isActive ? "#30d158" : "var(--text-3)", bg: isActive ? "rgba(48,209,88,0.12)" : "var(--surface-1)" },
        ].map(({ label, value, sub, color, bg }) => (
          <div key={label} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            padding: "14px 8px", borderRadius: 16,
            background: bg, border: "1px solid var(--sep)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          }}>
            <span style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 10, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 9, color: "var(--text-3)" }}>{sub}</span>
          </div>
        ))}
      </div>

      {/* ── Mobile Number Alert (if not verified) ─────────── */}
      {!userPhone || !userPhoneVerified ? (
        <button
          onClick={openPhoneSheet}
          style={{
            width: "100%", textAlign: "left",
            padding: "14px 16px", borderRadius: 16,
            background: "rgba(255,149,0,0.10)",
            border: "1px solid rgba(255,149,0,0.30)",
            display: "flex", alignItems: "center", gap: 12,
            cursor: "pointer",
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,149,0,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Smartphone style={{ width: 16, height: 16, color: "#ff9f0a" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#ff9f0a", margin: 0 }}>
              {!userPhone ? "Add your mobile number" : "Verify your mobile number"}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-2)", margin: "2px 0 0", lineHeight: 1.3 }}>
              {!userPhone
                ? "Required to call and receive calls on PRaww+"
                : `${userPhone} — tap to verify`}
            </p>
          </div>
          <ChevronRight style={{ width: 14, height: 14, color: "#ff9f0a", flexShrink: 0 }} />
        </button>
      ) : null}

      {/* ── Account ───────────────────────────────────────── */}
      <Section title="Account">
        <Row
          icon={<Smartphone size={15} />}
          iconBg={userPhoneVerified ? "rgba(48,209,88,0.20)" : "rgba(255,149,0,0.20)"}
          iconColor={userPhoneVerified ? "#30d158" : "#ff9f0a"}
          label="Mobile Number"
          value={userPhone
            ? (userPhoneVerified ? userPhone : `${userPhone} · Unverified`)
            : "Not set"}
          onClick={openPhoneSheet}
        />
        <Row icon={<Hash size={15} />} iconBg="rgba(10,132,255,0.20)" iconColor="hsl(var(--primary))"
          label="DID Phone Number" value={primaryNumber ?? "None"} onClick={() => setSheet("numbers")} />
        <Row icon={<Star size={15} />} iconBg="rgba(255,149,0,0.20)" iconColor="#ff9500"
          label="Subscription Plan" value={isActive ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · Active` : "None"}
          onClick={() => { setSelectedPlan(currentPlan as "basic" | "pro"); setSheet("plan"); }} />
        <Row icon={<Mail size={15} />} iconBg="rgba(120,65,190,0.20)" iconColor="#bf5af2"
          label="Email / Login" value={user?.email ?? user?.username ?? ""} chevron={false} />
      </Section>

      {/* ── Billing ───────────────────────────────────────── */}
      <Section title="Billing">
        <Row icon={<Coins size={15} />} iconBg="rgba(255,214,10,0.20)" iconColor="#ffd60a"
          label="Coin Balance" value={`${coins} coins`} chevron={false} />
        <Row icon={<Plus size={15} />} iconBg="rgba(48,209,88,0.20)" iconColor="#30d158"
          label="Top Up Coins" onClick={() => setSheet("topup")} />
        <Row icon={<CreditCard size={15} />} iconBg="rgba(94,92,230,0.20)" iconColor="#5e5ce6"
          label="Payment Methods" value="PayFast" chevron={false} />
        <Row icon={<Receipt size={15} />} iconBg="rgba(100,100,110,0.28)" iconColor="var(--text-2)"
          label="Transaction History" onClick={() => setSheet("history")} />
      </Section>

      {/* ── Preferences ───────────────────────────────────── */}
      <Section title="Preferences">
        <Row icon={<Bell size={15} />} iconBg="rgba(255,69,58,0.20)" iconColor="#ff453a"
          label="Notifications" onClick={() => setLocation("/notifications")} />
        <Row icon={<Phone size={15} />} iconBg="rgba(48,209,88,0.20)" iconColor="#30d158"
          label="Call Settings" onClick={() => setLocation("/call-settings")} />
        <Row icon={<Mic size={15} />} iconBg="rgba(255,149,0,0.20)" iconColor="#ff9500"
          label="Caller ID" value={primaryNumber ?? "Not set"} chevron={false} />
      </Section>

      {/* ── Legal & Support ───────────────────────────────── */}
      <Section title="Legal & Support">
        <Row icon={<FileText size={15} />} iconBg="rgba(100,100,110,0.28)" iconColor="var(--text-2)"
          label="Terms of Service" onClick={() => setSheet("terms")} />
        <Row icon={<ShieldCheck size={15} />} iconBg="rgba(100,100,110,0.28)" iconColor="var(--text-2)"
          label="Privacy Policy" onClick={() => setSheet("privacy")} />
        <Row icon={<HelpCircle size={15} />} iconBg="rgba(10,132,255,0.20)" iconColor="hsl(var(--primary))"
          label="Help / Support" value={CONTACT_EMAIL}
          onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=PRaww+ Support`, "_blank")} />
        <Row icon={<Mail size={15} />} iconBg="rgba(48,209,88,0.20)" iconColor="#30d158"
          label="Contact Us" value={CONTACT_EMAIL} onClick={() => setSheet("contact")} />
      </Section>

      {/* ── Bottom danger ─────────────────────────────────── */}
      <div className="section-card">
        <Row icon={<LogOut size={15} />} iconBg="rgba(255,69,58,0.15)" iconColor="#ff453a"
          label="Log Out" danger onClick={logout} />
        <div className="row-sep" />
        <Row icon={<Trash2 size={15} />} iconBg="rgba(255,69,58,0.15)" iconColor="#ff453a"
          label="Delete Account" danger
          onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=Delete My Account&body=Please delete my account. Email: ${user?.email ?? user?.username ?? ""}`, "_blank")} />
      </div>

      <p style={{ textAlign: "center", fontSize: 10, color: "var(--text-3)", paddingBottom: 4 }}>PRaww+ · {CONTACT_EMAIL}</p>

      {/* ── Sheet: Top Up ─────────────────────────────────── */}
      {sheet === "topup" && (
        <Modal title="Top Up Coins" onClose={() => setSheet("none")}>
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-2)", marginBottom: 16 }}>1 coin ≈ R0.90 · ~1 min of call time</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
            {["20", "50", "100", "200"].map((amt) => {
              const c = Math.floor(Number(amt) / 0.9);
              const active = topupAmount === amt;
              return (
                <button key={amt} onClick={() => setTopupAmount(amt)}
                  style={{
                    padding: "12px 0", borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    background: active ? "rgba(255,214,10,0.15)" : "var(--glass-bg)",
                    border: `1px solid ${active ? "rgba(255,214,10,0.30)" : "var(--glass-border)"}`,
                    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    cursor: "pointer", color: active ? "#ffd60a" : "var(--text-2)", fontWeight: 700,
                    boxShadow: active ? "0 2px 12px rgba(255,214,10,0.20)" : "none",
                    transition: "all 0.18s",
                  }}>
                  <span style={{ fontSize: 13 }}>R{amt}</span>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{c}c</span>
                </button>
              );
            })}
          </div>
          <button onClick={handleTopup} disabled={toppingUp}
            style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "rgba(255,214,10,0.18)", border: "1px solid rgba(255,214,10,0.28)", color: "#ffd60a", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {toppingUp ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : `Pay R${topupAmount} → ${Math.floor(Number(topupAmount) / 0.9)} coins`}
          </button>
        </Modal>
      )}

      {/* ── Sheet: Subscription Plan ───────────────────────── */}
      {sheet === "plan" && (
        <Modal title="Subscription Plan" onClose={() => setSheet("none")}>
          {isActive && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 14, background: "rgba(48,209,88,0.10)", border: "1px solid rgba(48,209,88,0.20)" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#30d158" }}>
                {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan — Active
              </p>
              {user?.nextPaymentDate && (
                <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
                  Renews {format(new Date(user.nextPaymentDate), "MMM d, yyyy")}
                </p>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {PLANS.map((plan) => {
              const active = selectedPlan === plan.id;
              const isProPlan = plan.id === "pro";
              return (
                <button key={plan.id} onClick={() => setSelectedPlan(plan.id)}
                  style={{
                    padding: "16px 12px", borderRadius: 16, textAlign: "left",
                    background: active ? (isProPlan ? "rgba(120,65,190,0.18)" : "rgba(10,132,255,0.18)") : "var(--glass-bg)",
                    border: `1px solid ${active ? (isProPlan ? "rgba(120,65,190,0.30)" : "rgba(10,132,255,0.30)") : "var(--glass-border)"}`,
                    backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
                    cursor: "pointer",
                    transition: "all 0.18s",
                  }}>
                  {isProPlan ? <Zap style={{ width: 16, height: 16, color: "#bf5af2", marginBottom: 8 }} /> : <Star style={{ width: 16, height: 16, color: "hsl(var(--primary))", marginBottom: 8 }} />}
                  <p style={{ fontSize: 14, fontWeight: 700, color: active ? (isProPlan ? "#bf5af2" : "hsl(var(--primary))") : "var(--text-1)" }}>{plan.name}</p>
                  <p style={{ fontSize: 12, fontWeight: 600, color: active ? (isProPlan ? "#bf5af2" : "hsl(var(--primary))") : "var(--text-2)", opacity: 0.85, marginTop: 2 }}>R{plan.price}/mo</p>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{plan.maxNumbers} number{plan.maxNumbers > 1 ? "s" : ""}</p>
                </button>
              );
            })}
          </div>
          <button onClick={handleSubscribe} disabled={subscribing}
            style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 2px 16px rgba(26,140,255,0.32)" }}>
            {subscribing ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : `Pay R${PLANS.find(p => p.id === selectedPlan)?.price}/mo`}
          </button>
        </Modal>
      )}

      {/* ── Sheet: Transaction History ──────────────────────── */}
      {sheet === "history" && (
        <Modal title="Transaction History" onClose={() => setSheet("none")}>
          {recentPayments.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <Receipt style={{ width: 32, height: 32, color: "var(--text-3)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 14, color: "var(--text-2)" }}>No transactions yet</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentPayments.map((p: PaymentRecord) => {
                const isPending   = p.status === "pending";
                const isCompleted = p.status === "completed";
                const statusColor = isCompleted ? "#30d158" : isPending ? "#ff9f0a" : "#ff453a";
                const statusBg    = isCompleted ? "rgba(48,209,88,0.14)" : isPending ? "rgba(255,149,0,0.14)" : "rgba(255,69,58,0.14)";
                const statusLabel = isCompleted ? "Completed" : isPending ? "Pending" : p.status;
                return (
                  <div key={p.id} className="tx-card stagger-item" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.paymentType === "number_change" ? "Number Change" : p.paymentType}
                        {p.subscriptionPlan ? ` · ${p.subscriptionPlan}` : ""}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                        {format(new Date(p.createdAt), "MMM d, yyyy · h:mm a")}
                      </p>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>R{p.amount.toFixed(2)}</p>
                      <span style={{
                        display: "inline-block", marginTop: 4,
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        padding: "3px 8px", borderRadius: 6,
                        background: statusBg, color: statusColor,
                      }}>
                        {statusLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* ── Sheet: Phone Numbers ───────────────────────────── */}
      {sheet === "numbers" && (
        <Modal title="Phone Numbers" onClose={() => setSheet("none")}>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>{myNumbers.length}/{maxNumbers} numbers on {currentPlan} plan</p>
          {myNumbers.length > 0 && (
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {myNumbers.map((n: OwnedNumber) => {
                const locked = n.locked ?? false;
                const lockedUntil = n.lockedUntil ? new Date(n.lockedUntil) : null;
                const daysLeft = lockedUntil
                  ? Math.ceil((lockedUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : 0;
                return (
                  <div key={n.id} className="tx-card" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(48,209,88,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Phone style={{ width: 14, height: 14, color: "#30d158" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", fontFamily: "monospace" }}>{n.number}</p>
                        <p style={{ fontSize: 10, fontWeight: 600, color: "#30d158" }}>● Active</p>
                      </div>
                      <button
                        onClick={() => { if (!locked) { setSheet("none"); setLocation(`/buy-number?mode=change&oldId=${n.id}&oldNumber=${encodeURIComponent(n.number)}`); } }}
                        disabled={locked}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, background: locked ? "var(--surface-1)" : "var(--glass-bg)", border: "1px solid var(--glass-border)", color: locked ? "var(--text-3)" : "var(--text-2)", fontSize: 11, fontWeight: 600, cursor: locked ? "default" : "pointer", opacity: locked ? 0.5 : 1 }}>
                        <Shuffle style={{ width: 11, height: 11 }} /> Change
                      </button>
                      <button
                        onClick={() => !locked && handleRemoveNumber(n.id, n.number)}
                        disabled={removingId === n.id || removing || locked}
                        style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,69,58,0.12)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: locked ? "default" : "pointer", opacity: (removingId === n.id || locked) ? 0.4 : 1 }}>
                        {removingId === n.id ? <Loader2 style={{ width: 13, height: 13, color: "#ff453a" }} className="animate-spin" /> : <Trash2 style={{ width: 13, height: 13, color: "#ff453a" }} />}
                      </button>
                    </div>
                    {locked && daysLeft > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, background: "rgba(255,149,0,0.10)", border: "1px solid rgba(255,149,0,0.22)" }}>
                        <ShieldCheck style={{ width: 12, height: 12, color: "#ff9f0a", flexShrink: 0 }} />
                        <p style={{ fontSize: 11, color: "#ff9f0a", margin: 0 }}>
                          Locked for {daysLeft} more day{daysLeft !== 1 ? "s" : ""} · unlocks {lockedUntil ? format(lockedUntil, "MMM d, yyyy") : ""}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {myNumbers.length === 0 && (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <Phone style={{ width: 28, height: 28, color: "var(--text-3)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 14, color: "var(--text-2)" }}>No numbers yet</p>
            </div>
          )}
          <button onClick={() => { setSheet("none"); setLocation("/buy-number"); }} disabled={!isActive || !canAddMore}
            style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: isActive && canAddMore ? "hsl(var(--primary))" : "var(--glass-bg)", border: isActive && canAddMore ? "none" : "1px solid var(--glass-border)", color: isActive && canAddMore ? "#fff" : "var(--text-3)", fontSize: 15, fontWeight: 600, cursor: isActive && canAddMore ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus style={{ width: 16, height: 16 }} />
            {!isActive ? "Subscribe to buy numbers" : !canAddMore ? `Limit reached (${maxNumbers} max)` : "Add Number"}
          </button>
        </Modal>
      )}

      {/* ── Sheet: Mobile Number Verification ─────────────── */}
      {sheet === "phone" && (
        <Modal title={otpStep === "enter-phone" ? "Mobile Number" : "Verify Code"} onClose={() => setSheet("none")}>
          {otpStep === "enter-phone" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                Add your mobile number to enable app-to-app calling with other PRaww+ users worldwide. Each number can only be registered once.
              </p>
              {userPhoneVerified && userPhone && (
                <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(48,209,88,0.10)", border: "1px solid rgba(48,209,88,0.20)" }}>
                  <p style={{ fontSize: 13, color: "#30d158", fontWeight: 600 }}>
                    <CheckCircle2 style={{ width: 13, height: 13, display: "inline", marginRight: 6 }} />
                    Current: {userPhone}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>Enter a new number below to change it</p>
                </div>
              )}
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+27821234567"
                style={{
                  width: "100%", padding: "14px 16px", borderRadius: 12,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  color: "var(--text-1)", fontSize: 17, fontFamily: "monospace",
                  outline: "none", boxSizing: "border-box",
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
              />
              {phoneMsg && (
                <p style={{ fontSize: 13, color: phoneMsg.includes("sent") || phoneMsg.includes("generated") ? "#30d158" : "#ff453a" }}>
                  {phoneMsg}
                </p>
              )}
              <button
                onClick={handleSendOtp}
                disabled={phoneLoading || !phoneInput.trim()}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: 14,
                  background: "hsl(var(--primary))", border: "none",
                  color: "#fff", fontSize: 15, fontWeight: 600,
                  cursor: phoneLoading || !phoneInput.trim() ? "default" : "pointer",
                  opacity: phoneLoading || !phoneInput.trim() ? 0.55 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {phoneLoading
                  ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
                  : "Send Verification Code"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(10,132,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <Smartphone style={{ width: 22, height: 22, color: "hsl(var(--primary))" }} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>Code sent!</p>
                <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, lineHeight: 1.5 }}>
                  A 6-digit code was sent via SMS to{" "}
                  <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{phoneInput}</span>
                </p>
              </div>

              {/* Countdown timer */}
              {otpCountdown !== null && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: "10px 16px", borderRadius: 12,
                  background: otpCountdown === 0
                    ? "rgba(255,69,58,0.10)"
                    : otpCountdown <= 30
                      ? "rgba(255,149,0,0.10)"
                      : "rgba(10,132,255,0.08)",
                  border: `1px solid ${otpCountdown === 0 ? "rgba(255,69,58,0.30)" : otpCountdown <= 30 ? "rgba(255,149,0,0.30)" : "rgba(10,132,255,0.18)"}`,
                }}>
                  {otpCountdown === 0 ? (
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#ff453a", textAlign: "center" }}>
                      Code expired — request a new one below
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: 13, color: otpCountdown <= 30 ? "#ff9500" : "var(--text-2)" }}>
                        Code expires in
                      </p>
                      <p style={{
                        fontSize: 15, fontWeight: 700, fontFamily: "monospace",
                        color: otpCountdown <= 30 ? "#ff453a" : otpCountdown <= 60 ? "#ff9500" : "hsl(var(--primary))",
                        minWidth: 36, textAlign: "center",
                      }}>
                        {Math.floor(otpCountdown / 60)}:{String(otpCountdown % 60).padStart(2, "0")}
                      </p>
                    </>
                  )}
                </div>
              )}

              {devOtp && (
                <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(255,214,10,0.10)", border: "1px solid rgba(255,214,10,0.25)" }}>
                  <p style={{ fontSize: 11, color: "#ffd60a", fontWeight: 600, marginBottom: 4 }}>DEV MODE — Code (SMS Portal not configured):</p>
                  <p style={{ fontSize: 24, fontWeight: 700, fontFamily: "monospace", color: "#ffd60a", letterSpacing: 6 }}>{devOtp}</p>
                </div>
              )}
              {phoneMsg && (
                <p style={{ fontSize: 13, color: phoneMsg.includes("sent") || phoneMsg.includes("generated") ? "var(--text-2)" : "#ff453a" }}>
                  {phoneMsg}
                </p>
              )}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                disabled={otpCountdown === 0}
                style={{
                  width: "100%", padding: "18px 16px", borderRadius: 12,
                  background: otpCountdown === 0 ? "var(--glass-bg)" : "var(--glass-bg)",
                  border: "1px solid var(--glass-border)",
                  color: otpCountdown === 0 ? "var(--text-3)" : "var(--text-1)",
                  fontSize: 28, fontFamily: "monospace",
                  outline: "none", textAlign: "center", letterSpacing: 12,
                  boxSizing: "border-box", opacity: otpCountdown === 0 ? 0.45 : 1,
                  cursor: otpCountdown === 0 ? "not-allowed" : "text",
                }}
                onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                autoFocus
              />
              <button
                onClick={handleVerifyOtp}
                disabled={phoneLoading || otpInput.length !== 6 || otpCountdown === 0}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: 14,
                  background: "rgba(48,209,88,0.85)", border: "none",
                  color: "#fff", fontSize: 15, fontWeight: 600,
                  cursor: phoneLoading || otpInput.length !== 6 || otpCountdown === 0 ? "default" : "pointer",
                  opacity: phoneLoading || otpInput.length !== 6 || otpCountdown === 0 ? 0.55 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {phoneLoading
                  ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
                  : "Verify Number"}
              </button>
              <button
                onClick={() => {
                  setPhoneMsg(null);
                  setOtpInput("");
                  handleSendOtp();
                }}
                disabled={phoneLoading}
                style={{
                  background: "none", border: "none", fontSize: 13, cursor: phoneLoading ? "default" : "pointer",
                  textAlign: "center", opacity: phoneLoading ? 0.5 : 1,
                  color: otpCountdown === 0 ? "#ff453a" : "hsl(var(--primary))",
                  fontWeight: otpCountdown === 0 ? 600 : 400,
                }}
              >
                {otpCountdown === 0 ? "Request new code" : "Resend code"}
              </button>
              <button
                onClick={() => { setOtpStep("enter-phone"); setPhoneMsg(null); setOtpCountdown(null); }}
                style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: 12, cursor: "pointer", textAlign: "center" }}
              >
                Use a different number
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* ── Sheet: Terms of Service ────────────────────────── */}
      {sheet === "terms" && (
        <Modal title="Terms of Service" onClose={() => setSheet("none")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 14, color: "var(--text-2)", lineHeight: 1.6 }}>
            <p style={{ color: "var(--text-1)", fontWeight: 600 }}>Last updated: March 2025</p>
            {[
              ["1. Acceptance of Terms", "By accessing or using PRaww+, you agree to be bound by these Terms of Service. If you do not agree, you may not use the service."],
              ["2. Service Description", "PRaww+ provides VoIP calling services, virtual phone number management, and related communication tools for users in South Africa."],
              ["3. Subscriptions & Billing", "Subscriptions are billed monthly via PayFast. Your subscription renews automatically unless cancelled. Coin balances are non-refundable once purchased and consumed."],
              ["4. Acceptable Use", "You agree not to use the service for spam, harassment, illegal activities, or any purpose that violates South African law."],
              ["5. Limitation of Liability", "PRaww+ is provided \"as is.\" We do not guarantee uninterrupted service and are not liable for any damages arising from use of the service."],
            ].map(([title, body]) => (
              <div key={title as string}>
                <p style={{ fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>{title}</p>
                <p>{body}</p>
              </div>
            ))}
            <div style={{ paddingTop: 8, borderTop: "1px solid var(--sep)" }}>
              <p>Questions? Contact us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "hsl(var(--primary))" }}>{CONTACT_EMAIL}</a></p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Sheet: Privacy Policy ──────────────────────────── */}
      {sheet === "privacy" && (
        <Modal title="Privacy Policy" onClose={() => setSheet("none")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 14, color: "var(--text-2)", lineHeight: 1.6 }}>
            <p style={{ color: "var(--text-1)", fontWeight: 600 }}>Last updated: March 2025</p>
            {[
              ["1. Information We Collect", "We collect your name, email address, phone numbers you claim, call metadata, and payment records. We do not store call audio."],
              ["2. How We Use Your Information", "Your data is used to provide the service, process payments, send account-related emails, and improve our platform. We do not sell your personal information."],
              ["3. Data Storage & Security", "Your data is stored securely in encrypted databases. Payment processing is handled by PayFast."],
              ["4. Third-Party Services", "We use FreeSWITCH for VoIP services and PayFast for payments. These providers have their own privacy policies."],
              ["5. Your Rights", "You may request access to, correction of, or deletion of your personal data by contacting us. Account deletion requests are processed within 30 days."],
            ].map(([title, body]) => (
              <div key={title as string}>
                <p style={{ fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>{title}</p>
                <p>{body}</p>
              </div>
            ))}
            <div style={{ paddingTop: 8, borderTop: "1px solid var(--sep)" }}>
              <p>We comply with the Protection of Personal Information Act (POPIA) of South Africa.</p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Sheet: Contact ─────────────────────────────────── */}
      {sheet === "contact" && (
        <Modal title="Contact Us" onClose={() => setSheet("none")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="tx-card" style={{ padding: "16px" }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
                For support, billing queries, or feature requests, reach out to our team. We respond within 24 hours on business days.
              </p>
            </div>
            <button
              onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=PRaww+ Support`, "_blank")}
              style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Mail style={{ width: 16, height: 16 }} />
              Email Support
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
