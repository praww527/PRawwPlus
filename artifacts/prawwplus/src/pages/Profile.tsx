import { useState } from "react";
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
  AlertCircle, Plus, UserCircle2, X, Shuffle,
} from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

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

/* ── Modal sheet ───────────────────────────────────────────────────── */
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="overlay-backdrop" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div className="modal-surface" style={{ borderRadius: "20px 20px 0 0", padding: "0 0 env(safe-area-inset-bottom,16px)", maxHeight: "88dvh", overflowY: "auto" }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--sep-strong)" }} />
        </div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 16px" }}>
          <p style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)" }}>{title}</p>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 14, background: "var(--surface-2)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X style={{ width: 14, height: 14, color: "var(--text-2)" }} />
          </button>
        </div>
        <div style={{ padding: "0 20px 16px" }}>{children}</div>
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
      onPointerDown={(e) => onClick && (e.currentTarget.style.background = "var(--surface-2)")}
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
  const kids = Array.isArray(children) ? children : [children];
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

type Sheet = "none" | "topup" | "plan" | "history" | "numbers" | "terms" | "privacy" | "contact";

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
          <div key={i} style={{ height: h, borderRadius: 16, background: "var(--surface-1)", animation: "pulse 1.5s ease-in-out infinite" }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 8, paddingTop: 4 }}>
      <PayFastRedirect data={pfData} />

      {/* ── User header ──────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 4 }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <UserCircle2 style={{ width: 40, height: 40, color: "#ffffff" }} />
        </div>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
            {user?.name || user?.username || "—"}
          </p>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>{user?.email ?? user?.username ?? ""}</p>
          {primaryNumber && <p style={{ fontSize: 13, color: "var(--text-3)", fontFamily: "monospace", marginTop: 1 }}>{primaryNumber}</p>}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8,
            padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: isActive ? "rgba(48,209,88,0.12)" : "var(--surface-2)",
            color: isActive ? "#30d158" : "var(--text-3)",
            border: `1px solid ${isActive ? "rgba(48,209,88,0.22)" : "var(--sep)"}`,
          }}>
            {isActive ? <CheckCircle2 style={{ width: 11, height: 11 }} /> : <AlertCircle style={{ width: 11, height: 11 }} />}
            {isActive ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · Active` : "No Active Plan"}
          </div>
        </div>
      </div>

      {/* ── Quick stats ──────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        {[
          { label: "Coins", value: coins.toFixed(0), sub: "balance", color: "#ffd60a", bg: "rgba(255,214,10,0.12)" },
          { label: "Numbers", value: `${myNumbers.length}/${maxNumbers}`, sub: "assigned", color: "hsl(var(--primary))", bg: "rgba(10,132,255,0.12)" },
          { label: "Plan", value: isActive ? currentPlan.slice(0,1).toUpperCase() + currentPlan.slice(1) : "None", sub: isActive ? "active" : "inactive", color: isActive ? "#30d158" : "var(--text-3)", bg: isActive ? "rgba(48,209,88,0.12)" : "var(--surface-1)" },
        ].map(({ label, value, sub, color, bg }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "14px 8px", borderRadius: 14, background: bg, border: "1px solid var(--sep)" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 10, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 9, color: "var(--text-3)" }}>{sub}</span>
          </div>
        ))}
      </div>

      {/* ── Account ───────────────────────────────────────── */}
      <Section title="Account">
        <Row icon={<Hash size={15} />} iconBg="rgba(10,132,255,0.20)" iconColor="hsl(var(--primary))"
          label="Phone Number" value={primaryNumber ?? "None"} onClick={() => setSheet("numbers")} />
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
                  style={{ padding: "12px 0", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    background: active ? "rgba(255,214,10,0.15)" : "var(--surface-2)", border: `1px solid ${active ? "rgba(255,214,10,0.30)" : "var(--sep)"}`,
                    cursor: "pointer", color: active ? "#ffd60a" : "var(--text-2)", fontWeight: 700 }}>
                  <span style={{ fontSize: 13 }}>R{amt}</span>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{c}c</span>
                </button>
              );
            })}
          </div>
          <button onClick={handleTopup} disabled={toppingUp}
            style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "rgba(255,214,10,0.18)", border: "1px solid rgba(255,214,10,0.28)", color: "#ffd60a", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {toppingUp ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : `Pay R${topupAmount} → ${Math.floor(Number(topupAmount) / 0.9)} coins`}
          </button>
        </Modal>
      )}

      {/* ── Sheet: Subscription Plan ───────────────────────── */}
      {sheet === "plan" && (
        <Modal title="Subscription Plan" onClose={() => setSheet("none")}>
          {isActive && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 12, background: "rgba(48,209,88,0.10)", border: "1px solid rgba(48,209,88,0.20)" }}>
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
                  style={{ padding: "16px 12px", borderRadius: 14, textAlign: "left",
                    background: active ? (isProPlan ? "rgba(120,65,190,0.18)" : "rgba(10,132,255,0.18)") : "var(--surface-2)",
                    border: `1px solid ${active ? (isProPlan ? "rgba(120,65,190,0.30)" : "rgba(10,132,255,0.30)") : "var(--sep)"}`,
                    cursor: "pointer" }}>
                  {isProPlan ? <Zap style={{ width: 16, height: 16, color: "#bf5af2", marginBottom: 8 }} /> : <Star style={{ width: 16, height: 16, color: "hsl(var(--primary))", marginBottom: 8 }} />}
                  <p style={{ fontSize: 14, fontWeight: 700, color: active ? (isProPlan ? "#bf5af2" : "hsl(var(--primary))") : "var(--text-1)" }}>{plan.name}</p>
                  <p style={{ fontSize: 12, fontWeight: 600, color: active ? (isProPlan ? "#bf5af2" : "hsl(var(--primary))") : "var(--text-2)", opacity: 0.85, marginTop: 2 }}>R{plan.price}/mo</p>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{plan.maxNumbers} number{plan.maxNumbers > 1 ? "s" : ""}</p>
                </button>
              );
            })}
          </div>
          <button onClick={handleSubscribe} disabled={subscribing}
            style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
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
            <div className="section-card">
              {recentPayments.map((p: PaymentRecord, i) => (
                <div key={p.id}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-1)", textTransform: "capitalize" }}>
                        {p.paymentType === "number_change" ? "Number Change" : p.paymentType}
                        {p.subscriptionPlan ? ` · ${p.subscriptionPlan}` : ""}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        {format(new Date(p.createdAt), "MMM d, yyyy · h:mm a")}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>R{p.amount.toFixed(2)}</p>
                      <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: p.status === "completed" ? "#30d158" : p.status === "pending" ? "#ffd60a" : "#ff453a", marginTop: 2 }}>{p.status}</p>
                    </div>
                  </div>
                  {i < recentPayments.length - 1 && <div className="row-sep" />}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* ── Sheet: Phone Numbers ───────────────────────────── */}
      {sheet === "numbers" && (
        <Modal title="Phone Numbers" onClose={() => setSheet("none")}>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>{myNumbers.length}/{maxNumbers} numbers on {currentPlan} plan</p>
          {myNumbers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {myNumbers.map((n: OwnedNumber, i) => (
                <div key={n.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(48,209,88,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Phone style={{ width: 14, height: 14, color: "#30d158" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", fontFamily: "monospace" }}>{n.number}</p>
                      <p style={{ fontSize: 10, fontWeight: 600, color: "#30d158" }}>● Active</p>
                    </div>
                    <button onClick={() => { setSheet("none"); setLocation(`/buy-number?mode=change&oldId=${n.id}&oldNumber=${encodeURIComponent(n.number)}`); }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--sep)", color: "var(--text-2)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      <Shuffle style={{ width: 11, height: 11 }} /> Change
                    </button>
                    <button onClick={() => handleRemoveNumber(n.id, n.number)} disabled={removingId === n.id || removing}
                      style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,69,58,0.12)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: removingId === n.id ? 0.5 : 1 }}>
                      {removingId === n.id ? <Loader2 style={{ width: 13, height: 13, color: "#ff453a" }} className="animate-spin" /> : <Trash2 style={{ width: 13, height: 13, color: "#ff453a" }} />}
                    </button>
                  </div>
                  {i < myNumbers.length - 1 && <div className="row-sep" />}
                </div>
              ))}
            </div>
          )}
          {myNumbers.length === 0 && (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <Phone style={{ width: 28, height: 28, color: "var(--text-3)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 14, color: "var(--text-2)" }}>No numbers yet</p>
            </div>
          )}
          <button onClick={() => { setSheet("none"); setLocation("/buy-number"); }} disabled={!isActive || !canAddMore}
            style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: isActive && canAddMore ? "hsl(var(--primary))" : "var(--surface-2)", border: isActive && canAddMore ? "none" : "1px solid var(--sep)", color: isActive && canAddMore ? "#fff" : "var(--text-3)", fontSize: 15, fontWeight: 600, cursor: isActive && canAddMore ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus style={{ width: 16, height: 16 }} />
            {!isActive ? "Subscribe to buy numbers" : !canAddMore ? `Limit reached (${maxNumbers} max)` : "Add Number"}
          </button>
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

      {/* ── Sheet: Contact Us ──────────────────────────────── */}
      {sheet === "contact" && (
        <Modal title="Contact Us" onClose={() => setSheet("none")}>
          <div style={{ marginBottom: 16, padding: "14px", borderRadius: 14, background: "var(--surface-2)", border: "1px solid var(--sep)", display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(48,209,88,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Mail style={{ width: 16, height: 16, color: "#30d158" }} />
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>Email Support</p>
              <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>We typically respond within 24 hours on business days.</p>
              <a href={`mailto:${CONTACT_EMAIL}`} style={{ display: "inline-block", marginTop: 6, fontSize: 13, color: "hsl(var(--primary))", fontFamily: "monospace" }}>{CONTACT_EMAIL}</a>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "General Enquiry", subject: "General Enquiry" },
              { label: "Technical Support", subject: "Technical Support Request" },
              { label: "Billing Enquiry", subject: "Billing Enquiry" },
            ].map(({ label, subject }) => (
              <button key={label} onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`, "_blank")}
                style={{ padding: "13px 0", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--sep)", color: "var(--text-1)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
