import { useState, Children, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ImageCropper } from "@/components/ImageCropper";
import { useAuth } from "@workspace/auth-web";
import {
  useGetMe, useListPayments, useInitiateSubscription,
  useTopUpCredits, useListMyNumbers, useRemoveNumber,
} from "@workspace/api-client-react";
import type { OwnedNumber, PaymentRecord } from "@workspace/api-client-react";
import {
  ChevronRight, LogOut, Trash2, Phone, Receipt,
  Star, Zap, Bell, Mic, Hash, FileText, ShieldCheck,
  HelpCircle, Mail, CreditCard, Loader2, CheckCircle2,
  AlertCircle, Plus, X, Shuffle, Smartphone, Shield, TrendingUp,
  Moon, Sun, Monitor, Info, Coins, Camera, BadgeCheck,
  Upload, Clock, Check, Activity, FileDown, Users,
} from "lucide-react";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
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


function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        background: "rgba(0,0,0,0.55)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="slide-up"
        style={{
          borderRadius: "24px 24px 0 0",
          maxHeight: `calc(100dvh - 60px)`,
          overflowY: "auto",
          overflowX: "hidden",
          paddingBottom: `calc(24px + env(safe-area-inset-bottom, 0px))`,
          background: "var(--modal-bg)",
          boxShadow: "0 -8px 48px rgba(0,0,0,0.40)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 14, paddingBottom: 6 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--sep-strong)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 16px" }}>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>{title}</p>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 15,
              background: "var(--glass-bg)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", border: "none",
            }}
          >
            <X style={{ width: 14, height: 14, color: "var(--text-2)" }} />
          </button>
        </div>
        <div style={{ padding: "0 20px 8px" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({
  icon, iconBg, label, value, chevron = true, onClick, danger = false,
}: {
  icon: React.ReactNode;
  iconBg?: string;
  label: string; value?: string; chevron?: boolean; onClick?: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        width: "100%", padding: "12px 16px", textAlign: "left",
        background: "transparent", border: "none",
        cursor: onClick ? "pointer" : "default",
        transition: "background 0.12s",
        WebkitTapHighlightColor: "transparent",
      }}
      onPointerDown={(e) => onClick && (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
      onPointerUp={(e) => (e.currentTarget.style.background = "transparent")}
      onPointerLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 9,
        background: iconBg ?? (danger ? "rgba(255,69,58,0.15)" : "rgba(128,128,128,0.18)"),
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <span style={{ color: danger ? "#ff453a" : "var(--text-2)", display: "flex" }}>{icon}</span>
      </div>
      <span style={{ flex: 1, fontSize: 16, fontWeight: 400, color: danger ? "#ff453a" : "var(--text-1)", textAlign: "left" }}>
        {label}
      </span>
      {value && (
        <span style={{ fontSize: 14, color: "var(--text-3)", marginRight: chevron && onClick ? 2 : 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value}
        </span>
      )}
      {chevron && onClick && <ChevronRight style={{ width: 16, height: 16, color: "var(--text-3)", flexShrink: 0 }} />}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = Children.toArray(children).filter(Boolean);
  return (
    <div style={{ marginTop: 28 }}>
      <p style={{
        fontSize: 13, fontWeight: 500, letterSpacing: "0.01em",
        color: "var(--text-3)",
        padding: "0 16px 8px",
      }}>
        {title}
      </p>
      <div style={{ background: "var(--glass-bg)", borderRadius: 14 }}>
        {kids.map((child, i) => (
          <div key={i}>
            {child}
            {i < kids.length - 1 && (
              <div style={{ height: 1, background: "var(--sep)", marginLeft: 64 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}





type Sheet = "none" | "topup" | "plan" | "history" | "numbers" | "terms" | "privacy" | "contact" | "phone" | "verify" | "security";

export default function Profile() {
  const { logout, user: authUser } = useAuth();
  const { data: user, isLoading, refetch: refetchUser } = useGetMe();
  const { theme, setTheme } = useTheme();
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
  const [otpCountdown, setOtpCountdown] = useState<number | null>(null);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [rawPhotoSrc, setRawPhotoSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [verifyDocType, setVerifyDocType] = useState<"id" | "company">("id");
  const [verifyDocFile, setVerifyDocFile] = useState<string | null>(null);
  const [verifyDocName, setVerifyDocName] = useState<string>("");
  const [submittingVerify, setSubmittingVerify] = useState(false);
  const [policyAgreed, setPolicyAgreed] = useState(false);

  // ── 2FA / Security state ──────────────────────────────────────────────────
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [popiaLoading, setPopiaLoading] = useState(false);
  const [cdrExportLoading, setCdrExportLoading] = useState(false);
  const verifyFileRef = useRef<HTMLInputElement>(null);

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
  const userVerified  = (user as any)?.verified as boolean | undefined;
  const verificationStatus = (user as any)?.verificationStatus as string | undefined;

  const handleProfilePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleProfilePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setRawPhotoSrc(dataUrl);
  };

  const handleCropConfirm = async (croppedDataUrl: string) => {
    setRawPhotoSrc(null);
    setUploadingPhoto(true);
    try {
      const res = await fetch("/api/users/me/profile-image", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileImage: croppedDataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast({ title: "Profile photo updated!" });
      refetchUser();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleVerifyDocChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setVerifyDocFile(base64);
    setVerifyDocName(file.name);
  };

  const handleSubmitVerification = async () => {
    if (!verifyDocFile) {
      toast({ title: "Please upload a document", variant: "destructive" });
      return;
    }
    if (!policyAgreed) {
      toast({ title: "Agreement required", description: "Please agree to the Responsible Use Policy.", variant: "destructive" });
      return;
    }
    setSubmittingVerify(true);
    try {
      const res = await fetch("/api/users/me/request-verification", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType: verifyDocType, docUrl: verifyDocFile, policyAgreed: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      toast({ title: "Verification submitted!", description: "An admin will review your document within 1–2 business days." });
      setSheet("none");
      setVerifyDocFile(null);
      setVerifyDocName("");
      setPolicyAgreed(false);
      refetchUser();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmittingVerify(false);
    }
  };

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

  // ── 2FA functions ────────────────────────────────────────────────────────
  const openSecuritySheet = async () => {
    setSheet("security");
    try {
      const r = await fetch("/api/security/2fa/status", { credentials: "include" });
      const d = await r.json();
      setTotpEnabled(d.enabled ?? false);
    } catch { /* ignore */ }
  };

  const downloadPopiaExport = async () => {
    setPopiaLoading(true);
    try {
      const r = await fetch("/api/security/popia/export", { method: "POST", credentials: "include" });
      if (!r.ok) { alert("Failed to generate export."); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `popia-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setPopiaLoading(false); }
  };

  const downloadCdrExport = async () => {
    setCdrExportLoading(true);
    try {
      const r = await fetch("/api/cdr/export", { credentials: "include" });
      if (!r.ok) { alert("Failed to generate call records export."); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `call-records-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setCdrExportLoading(false); }
  };

  const openPhoneSheet = () => {
    setPhoneInput(userPhone ?? "");
    setOtpInput("");
    setOtpStep(userPhone && !userPhoneVerified ? "enter-otp" : "enter-phone");
    setPhoneMsg(null);
    setOtpCountdown(null);
    setSheet("phone");
  };

  const handleSendOtp = async () => {
    if (!phoneInput.trim()) { setPhoneMsg("Enter your mobile number"); return; }
    setPhoneLoading(true);
    setPhoneMsg(null);
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
        if (res.status === 429) setOtpCountdown(0);
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
        {[80, 100, 80, 200, 200].map((h, i) => (
          <div key={i} className="skeleton" style={{ height: h, borderRadius: 16 }} />
        ))}
      </div>
    );
  }

  const themeNext: Record<ThemePreference, ThemePreference> = { system: "dark", dark: "light", light: "system" };
  const themeLabel: Record<ThemePreference, string> = { system: "System", dark: "Dark", light: "Light" };
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  const displayName = user?.name || user?.username || "—";
  const initials = displayName !== "—"
    ? displayName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  const profileImage = (user as any)?.profileImage as string | undefined;


  return (
    <div className="page-in" style={{ paddingBottom: 8, paddingTop: 4 }}>
      <PayFastRedirect data={pfData} />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleProfilePhotoChange}
      />

      {rawPhotoSrc && (
        <ImageCropper
          src={rawPhotoSrc}
          onConfirm={handleCropConfirm}
          onCancel={() => setRawPhotoSrc(null)}
        />
      )}
      <input
        ref={verifyFileRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={handleVerifyDocChange}
      />

      {/* ── Header row ───────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 4px 20px" }}>
        <p style={{ fontSize: 30, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", letterSpacing: "-0.02em", margin: 0 }}>
          Settings
        </p>
        <button
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "rgba(128,128,128,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", border: "none",
          }}
          onClick={() => setTheme(themeNext[theme])}
          title={`Theme: ${themeLabel[theme]}`}
        >
          <ThemeIcon style={{ width: 16, height: 16, color: "var(--text-2)" }} />
        </button>
      </div>

      {/* ── Profile card ─────────────────────── */}
      <div style={{
        background: "var(--glass-bg)", borderRadius: 18,
        padding: "18px 16px 14px",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        {/* Avatar with upload */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={handleProfilePhotoClick}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", position: "relative", display: "block" }}
          >
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: profileImage ? "transparent" : "rgba(128,128,128,0.30)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 700, color: "var(--text-1)",
              fontFamily: "var(--font-display)", overflow: "hidden",
              flexShrink: 0,
            }}>
              {profileImage
                ? <img src={profileImage} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : initials
              }
            </div>
            {/* Camera overlay */}
            <div style={{
              position: "absolute", bottom: 0, right: 0,
              width: 22, height: 22, borderRadius: "50%",
              background: uploadingPhoto ? "rgba(128,128,128,0.8)" : "rgba(60,60,60,0.95)",
              border: "2px solid var(--bg)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {uploadingPhoto
                ? <Loader2 style={{ width: 11, height: 11, color: "#fff" }} className="animate-spin" />
                : <Camera style={{ width: 11, height: 11, color: "#fff" }} />
              }
            </div>
          </button>

          {/* Verified badge */}
          {userVerified && (
            <div style={{
              position: "absolute", top: -2, left: -2,
              width: 20, height: 20, borderRadius: "50%",
              background: "#30d158",
              border: "2px solid var(--bg)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Check style={{ width: 11, height: 11, color: "#fff", strokeWidth: 3 }} />
            </div>
          )}
        </div>

        {/* Name + info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <p style={{
              fontSize: 18, fontWeight: 700, color: "var(--text-1)",
              fontFamily: "var(--font-display)", letterSpacing: "-0.01em",
              lineHeight: 1.2, margin: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {displayName}
            </p>
            {userVerified && (
              <BadgeCheck style={{ width: 18, height: 18, color: "#30d158", flexShrink: 0 }} />
            )}
          </div>
          <p style={{ fontSize: 13, color: "var(--text-2)", margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.email ?? user?.username ?? ""}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 10px", borderRadius: 20,
              background: "rgba(128,128,128,0.15)",
              fontSize: 11, fontWeight: 500, color: "var(--text-3)",
            }}>
              <Info style={{ width: 10, height: 10, flexShrink: 0 }} />
              {isActive
                ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · Active`
                : "No Active Plan"}
            </div>
            {verificationStatus === "pending" && !userVerified && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 10px", borderRadius: 20,
                background: "rgba(255,214,10,0.12)",
                fontSize: 11, fontWeight: 500, color: "#ffd60a",
              }}>
                <Clock style={{ width: 10, height: 10, flexShrink: 0 }} />
                Under review
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats row ───────────────────────── */}
      <div style={{
        display: "flex",
        background: "var(--glass-bg)",
        borderRadius: 14,
        padding: "16px 0",
        marginTop: 16,
      }}>
        {[
          { icon: <Coins style={{ width: 20, height: 20, strokeWidth: 1.5, color: "var(--text-2)" }} />, value: coins.toFixed(0), label: "Coins", sub: "balance" },
          { icon: <Hash style={{ width: 20, height: 20, strokeWidth: 1.5, color: "var(--text-2)" }} />, value: `${myNumbers.length}/${maxNumbers}`, label: "Numbers", sub: "assigned" },
          { icon: <Star style={{ width: 20, height: 20, strokeWidth: 1.5, color: "var(--text-2)" }} />, value: isActive ? currentPlan.slice(0,1).toUpperCase() + currentPlan.slice(1) : "None", label: "Plan", sub: isActive ? "active" : "inactive" },
        ].map(({ icon, value, label, sub }, i) => (
          <div key={label} style={{
            flex: 1,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
            borderLeft: i > 0 ? "1px solid var(--sep)" : "none",
            padding: "0 8px",
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: "50%",
              background: "rgba(128,128,128,0.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 4,
            }}>
              {icon}
            </div>
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)", lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>{sub}</span>
          </div>
        ))}
      </div>

      {/* ── Add mobile number banner ─────────── */}
      {(!userPhone || !userPhoneVerified) && (
        <button
          onClick={openPhoneSheet}
          style={{
            width: "100%", textAlign: "left",
            padding: "14px 16px",
            background: "rgba(10,132,255,0.08)", border: "none", borderRadius: 14,
            display: "flex", alignItems: "center", gap: 14,
            cursor: "pointer",
            marginTop: 16,
            WebkitTapHighlightColor: "transparent",
          }}
          onPointerDown={(e) => (e.currentTarget.style.background = "rgba(10,132,255,0.14)")}
          onPointerUp={(e) => (e.currentTarget.style.background = "rgba(10,132,255,0.08)")}
          onPointerLeave={(e) => (e.currentTarget.style.background = "rgba(10,132,255,0.08)")}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: "rgba(10,132,255,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Smartphone style={{ width: 22, height: 22, color: "#0a84ff", strokeWidth: 1.5 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
              {!userPhone ? "Add your mobile number" : "Verify your mobile number"}
            </p>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: "3px 0 0", lineHeight: 1.4 }}>
              {!userPhone ? "Required to call and receive calls" : `${userPhone} — tap to verify`}
            </p>
          </div>
          <ChevronRight style={{ width: 16, height: 16, color: "var(--text-3)", flexShrink: 0 }} />
        </button>
      )}

      {/* ── Account ─────────────────────────── */}
      <Section title="Account">
        <Row
          icon={<Smartphone size={15} />}
          iconBg="rgba(48,209,88,0.15)"
          label="Mobile Number"
          value={userPhone ? (userPhoneVerified ? userPhone : `${userPhone} · Unverified`) : "Not set"}
          onClick={openPhoneSheet}
        />
        <Row icon={<Hash size={15} />} iconBg="rgba(10,132,255,0.15)" label="DID Phone Number" value={primaryNumber ?? "None"} onClick={() => setSheet("numbers")} />
        <Row icon={<Star size={15} />} iconBg="rgba(255,214,10,0.15)" label="Subscription Plan" value={isActive ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · Active` : "None"}
          onClick={() => { setSelectedPlan(currentPlan as "basic" | "pro"); setSheet("plan"); }} />
        <Row icon={<Mail size={15} />} iconBg="rgba(128,128,128,0.18)" label="Email / Login" value={user?.email ?? user?.username ?? ""} chevron={false} />
      </Section>

      {/* ── Team ─────────────────────────────── */}
      <Section title="Team">
        <Row icon={<Users size={15} />} iconBg="rgba(59,130,246,0.15)" label="Team & Organisation" value="Manage members" onClick={() => setLocation("/team")} />
      </Section>

      {/* ── Billing ─────────────────────────── */}
      <Section title="Billing">
        <Row icon={<Coins size={15} />} iconBg="rgba(255,149,0,0.15)" label="Coin Balance" value={`${coins} coins`} chevron={false} />
        <Row icon={<Plus size={15} />} iconBg="rgba(48,209,88,0.15)" label="Top Up Coins" onClick={() => setSheet("topup")} />
        <Row icon={<CreditCard size={15} />} iconBg="rgba(128,128,128,0.18)" label="Payment Methods" value="PayFast" chevron={false} />
        <Row icon={<Receipt size={15} />} iconBg="rgba(128,128,128,0.18)" label="Transaction History" onClick={() => setSheet("history")} />
        <Row
          icon={<FileDown size={15} />}
          iconBg="rgba(94,92,230,0.15)"
          label="Download Call Records"
          value={cdrExportLoading ? "Downloading…" : "CSV Export"}
          onClick={cdrExportLoading ? undefined : downloadCdrExport}
        />
      </Section>

      {/* ── Verification ────────────────────── */}
      <Section title="Verification">
        {userVerified ? (
          <Row
            icon={<BadgeCheck size={15} />}
            iconBg="rgba(48,209,88,0.15)"
            label="Verified Business"
            value="Approved"
            chevron={false}
          />
        ) : verificationStatus === "pending" ? (
          <Row
            icon={<Clock size={15} />}
            iconBg="rgba(255,214,10,0.15)"
            label="Verification Pending"
            value="Under Review"
            chevron={false}
          />
        ) : verificationStatus === "rejected" ? (
          <Row
            icon={<AlertCircle size={15} />}
            iconBg="rgba(255,69,58,0.15)"
            label="Verification Rejected"
            value="Resubmit"
            onClick={() => setSheet("verify")}
          />
        ) : (
          <Row
            icon={<Shield size={15} />}
            iconBg="rgba(10,132,255,0.15)"
            label="Get Verified"
            value="Upload ID or Docs"
            onClick={() => setSheet("verify")}
          />
        )}
      </Section>

      {/* ── Security ────────────────────────── */}
      <Section title="Security">
        <Row
          icon={<Shield size={15} />}
          iconBg="rgba(94,92,230,0.18)"
          label="Two-Factor Authentication"
          value={totpEnabled ? "Enabled" : "Off"}
          onClick={openSecuritySheet}
        />
        <Row
          icon={<FileText size={15} />}
          iconBg="rgba(10,132,255,0.15)"
          label="Download My Data (POPIA)"
          value={popiaLoading ? "Downloading…" : "Export"}
          onClick={popiaLoading ? undefined : downloadPopiaExport}
        />
      </Section>

      {/* ── Preferences ─────────────────────── */}
      <Section title="Preferences">
        <Row icon={<ThemeIcon size={15} />} iconBg="rgba(128,128,128,0.18)" label="Theme" value={themeLabel[theme]} onClick={() => setTheme(themeNext[theme])} />
        <Row icon={<Bell size={15} />} iconBg="rgba(255,149,0,0.15)" label="Notifications" onClick={() => setLocation("/notifications")} />
        <Row icon={<Phone size={15} />} iconBg="rgba(48,209,88,0.15)" label="Call Settings" onClick={() => setLocation("/call-settings")} />
        <Row icon={<Activity size={15} />} iconBg="rgba(94,92,230,0.15)" label="Diagnostics" onClick={() => setLocation("/diagnostics")} />
        <Row icon={<Mic size={15} />} iconBg="rgba(128,128,128,0.18)" label="Caller ID" value={primaryNumber ?? (user as any)?.phone ?? "Not set"} onClick={() => setSheet("numbers")} />
      </Section>

      {/* ── Dashboard Access ─────────────────── */}
      {(authUser?.isAdmin || authUser?.role === "reseller") && (
        <Section title="Dashboard">
          {authUser?.isAdmin && (
            <Row icon={<Shield size={15} />} iconBg="rgba(248,113,113,0.15)" label="Admin Panel" onClick={() => setLocation("/admin")} />
          )}
          {authUser?.role === "reseller" && (
            <Row icon={<TrendingUp size={15} />} iconBg="rgba(129,140,248,0.15)" label="Reseller Dashboard" onClick={() => setLocation("/reseller")} />
          )}
        </Section>
      )}

      {/* ── Legal & Support ─────────────────── */}
      <Section title="Legal & Support">
        <Row icon={<FileText size={15} />} iconBg="rgba(128,128,128,0.18)" label="Terms of Service" onClick={() => setSheet("terms")} />
        <Row icon={<ShieldCheck size={15} />} iconBg="rgba(128,128,128,0.18)" label="Privacy Policy" onClick={() => setSheet("privacy")} />
        <Row icon={<Shield size={15} />} iconBg="rgba(10,132,255,0.15)" label="Responsible Use & Compliance" value="Guide" onClick={() => setLocation("/compliance")} />
        <Row icon={<HelpCircle size={15} />} iconBg="rgba(10,132,255,0.15)" label="Help / Support" value={CONTACT_EMAIL}
          onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=PRaww+ Support`, "_blank")} />
        <Row icon={<Mail size={15} />} iconBg="rgba(128,128,128,0.18)" label="Contact Us" onClick={() => setSheet("contact")} />
      </Section>

      {/* ── Account actions ─────────────────── */}
      <Section title="Account Actions">
        <Row icon={<LogOut size={15} />} label="Log Out" danger onClick={logout} />
        <Row icon={<Trash2 size={15} />} label="Delete Account" danger
          onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=Delete My Account&body=Please delete my account. Email: ${user?.email ?? user?.username ?? ""}`, "_blank")} />
      </Section>

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", padding: "24px 0 4px" }}>PRaww+ · {CONTACT_EMAIL}</p>

      {/* ── Sheet: Top Up ─────────────────── */}
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
                    border: `1px solid ${active ? "rgba(255,214,10,0.30)" : "transparent"}`,
                    cursor: "pointer", color: active ? "#ffd60a" : "var(--text-2)", fontWeight: 700,
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

      {/* ── Sheet: Plan ─────────────────────── */}
      {sheet === "plan" && (
        <Modal title="Subscription Plan" onClose={() => setSheet("none")}>
          {isActive && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 14, background: "rgba(48,209,88,0.10)" }}>
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
                    border: `1px solid ${active ? (isProPlan ? "rgba(120,65,190,0.30)" : "rgba(10,132,255,0.30)") : "transparent"}`,
                    cursor: "pointer", transition: "all 0.18s",
                  }}>
                  {isProPlan ? <Zap style={{ width: 16, height: 16, color: active ? "#bf5af2" : "var(--text-2)", marginBottom: 8 }} /> : <Star style={{ width: 16, height: 16, color: active ? "hsl(var(--primary))" : "var(--text-2)", marginBottom: 8 }} />}
                  <p style={{ fontSize: 14, fontWeight: 700, color: active ? (isProPlan ? "#bf5af2" : "hsl(var(--primary))") : "var(--text-1)" }}>{plan.name}</p>
                  <p style={{ fontSize: 12, fontWeight: 600, color: active ? (isProPlan ? "#bf5af2" : "hsl(var(--primary))") : "var(--text-2)", marginTop: 2 }}>R{plan.price}/mo</p>
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

      {/* ── Sheet: Transaction History ──────── */}
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
                      <span style={{ display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 6, background: statusBg, color: statusColor }}>
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

      {/* ── Sheet: Phone Numbers ────────────── */}
      {sheet === "numbers" && (
        <Modal title="Phone Numbers" onClose={() => setSheet("none")}>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>{myNumbers.length}/{maxNumbers} numbers on {currentPlan} plan</p>
          {myNumbers.length > 0 && (
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {myNumbers.map((n: OwnedNumber) => {
                const locked = n.locked ?? false;
                const lockedUntil = n.lockedUntil ? new Date(n.lockedUntil) : null;
                const daysLeft = lockedUntil ? Math.ceil((lockedUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
                return (
                  <div key={n.id} className="tx-card" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(48,209,88,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Phone style={{ width: 14, height: 14, color: "#30d158" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", fontFamily: "monospace" }}>{n.number}</p>
                        <p style={{ fontSize: 10, fontWeight: 600, color: "#30d158" }}>● Active</p>
                      </div>
                      <button onClick={() => { if (!locked) { setSheet("none"); setLocation(`/buy-number?mode=change&oldId=${n.id}&oldNumber=${encodeURIComponent(n.number)}`); } }} disabled={locked}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, background: "var(--glass-bg)", border: "none", color: locked ? "var(--text-3)" : "var(--text-2)", fontSize: 11, fontWeight: 600, cursor: locked ? "default" : "pointer", opacity: locked ? 0.5 : 1 }}>
                        <Shuffle style={{ width: 11, height: 11 }} /> Change
                      </button>
                      <button onClick={() => !locked && handleRemoveNumber(n.id, n.number)} disabled={removingId === n.id || removing || locked}
                        style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,69,58,0.12)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: locked ? "default" : "pointer", opacity: (removingId === n.id || locked) ? 0.4 : 1 }}>
                        {removingId === n.id ? <Loader2 style={{ width: 13, height: 13, color: "#ff453a" }} className="animate-spin" /> : <Trash2 style={{ width: 13, height: 13, color: "#ff453a" }} />}
                      </button>
                    </div>
                    {locked && daysLeft > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, background: "rgba(255,149,0,0.10)" }}>
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
            style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: isActive && canAddMore ? "hsl(var(--primary))" : "var(--glass-bg)", border: "none", color: isActive && canAddMore ? "#fff" : "var(--text-3)", fontSize: 15, fontWeight: 600, cursor: isActive && canAddMore ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus style={{ width: 16, height: 16 }} />
            {!isActive ? "Subscribe to buy numbers" : !canAddMore ? `Limit reached (${maxNumbers} max)` : "Add Number"}
          </button>
        </Modal>
      )}

      {/* ── Sheet: Mobile Number Verification ─ */}
      {sheet === "phone" && (
        <Modal title={otpStep === "enter-phone" ? "Mobile Number" : "Verify Code"} onClose={() => setSheet("none")}>
          {otpStep === "enter-phone" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                Add your mobile number to enable app-to-app calling with other PRaww+ users worldwide.
              </p>
              {userPhoneVerified && userPhone && (
                <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(48,209,88,0.10)" }}>
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
                placeholder="+27 82 123 4567"
                style={{ width: "100%", padding: "13px 16px", borderRadius: 14, fontSize: 16, background: "var(--glass-bg)", border: "none", color: "var(--text-1)", outline: "none", boxSizing: "border-box" }}
              />
              {phoneMsg && <p style={{ fontSize: 13, color: phoneMsg.includes("sent") ? "#30d158" : "#ff453a", textAlign: "center" }}>{phoneMsg}</p>}
              <button onClick={handleSendOtp} disabled={phoneLoading}
                style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {phoneLoading ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : "Send Verification Code"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                Enter the 6-digit code sent to {phoneInput}.
                {otpCountdown !== null && otpCountdown > 0 && (
                  <span style={{ color: "var(--text-3)" }}> Expires in {Math.floor(otpCountdown / 60)}:{String(otpCountdown % 60).padStart(2, "0")}</span>
                )}
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                style={{ width: "100%", padding: "13px 16px", borderRadius: 14, fontSize: 24, letterSpacing: "0.4em", textAlign: "center", background: "var(--glass-bg)", border: "none", color: "var(--text-1)", outline: "none", boxSizing: "border-box" }}
              />
              {phoneMsg && (
                <p style={{ fontSize: 13, color: "#ff453a", textAlign: "center" }}>{phoneMsg}</p>
              )}
              <button onClick={handleVerifyOtp} disabled={phoneLoading}
                style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {phoneLoading ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : "Verify Code"}
              </button>
              {otpCountdown === 0 && (
                <button onClick={() => setOtpStep("enter-phone")}
                  style={{ background: "none", border: "none", color: "hsl(var(--primary))", fontSize: 14, cursor: "pointer", textAlign: "center", padding: "4px 0" }}>
                  Change number or resend
                </button>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ── Sheet: Business Verification ──────── */}
      {sheet === "verify" && (
        <Modal title="Business Verification" onClose={() => setSheet("none")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(10,132,255,0.08)" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#0a84ff", margin: "0 0 4px" }}>
                <BadgeCheck style={{ width: 14, height: 14, display: "inline", marginRight: 6 }} />
                Get a Verified Badge
              </p>
              <p style={{ fontSize: 12, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
                Upload a government-issued ID or company registration document. An admin will review and grant your badge within 24–48 hours.
              </p>
            </div>

            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 8 }}>Document Type</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {([["id", "Personal ID", "SA ID / Passport"], ["company", "Company Docs", "CIPC / COR14"]] as const).map(([type, label, sub]) => (
                  <button
                    key={type}
                    onClick={() => setVerifyDocType(type)}
                    style={{
                      padding: "12px 14px", borderRadius: 14, textAlign: "left", cursor: "pointer",
                      background: verifyDocType === type ? "rgba(10,132,255,0.15)" : "var(--glass-bg)",
                      border: `1px solid ${verifyDocType === type ? "rgba(10,132,255,0.35)" : "transparent"}`,
                      transition: "all 0.15s",
                    }}
                  >
                    <p style={{ fontSize: 13, fontWeight: 600, color: verifyDocType === type ? "#0a84ff" : "var(--text-1)", margin: 0 }}>{label}</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", margin: "3px 0 0" }}>{sub}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 8 }}>Upload Document</p>
              <button
                onClick={() => verifyFileRef.current?.click()}
                style={{
                  width: "100%", padding: "20px 0", borderRadius: 14,
                  background: verifyDocFile ? "rgba(48,209,88,0.08)" : "var(--glass-bg)",
                  border: `2px dashed ${verifyDocFile ? "rgba(48,209,88,0.35)" : "rgba(128,128,128,0.25)"}`,
                  cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  transition: "all 0.15s",
                }}
              >
                {verifyDocFile
                  ? <><Check style={{ width: 24, height: 24, color: "#30d158" }} /><p style={{ fontSize: 13, fontWeight: 600, color: "#30d158", margin: 0 }}>{verifyDocName || "File selected"}</p><p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>Tap to change</p></>
                  : <><Upload style={{ width: 24, height: 24, color: "var(--text-3)" }} /><p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", margin: 0 }}>Tap to upload</p><p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>JPG, PNG, or PDF · Max 5MB</p></>
                }
              </button>
            </div>

            {/* Responsible Use Policy agreement */}
            <div
              onClick={() => setPolicyAgreed((v) => !v)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "14px", borderRadius: 14,
                background: policyAgreed ? "rgba(48,209,88,0.08)" : "rgba(255,149,0,0.07)",
                border: `1px solid ${policyAgreed ? "rgba(48,209,88,0.25)" : "rgba(255,149,0,0.22)"}`,
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                background: policyAgreed ? "#30d158" : "rgba(128,128,128,0.20)",
                border: `2px solid ${policyAgreed ? "#30d158" : "rgba(128,128,128,0.40)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}>
                {policyAgreed && <Check style={{ width: 12, height: 12, color: "#fff", strokeWidth: 3 }} />}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
                  I agree to the Responsible Use Policy
                </p>
                <p style={{ fontSize: 11, color: "var(--text-2)", margin: "3px 0 0", lineHeight: 1.4 }}>
                  I confirm this is a legitimate South African business and I will only use PRaww+ for lawful communications.{" "}
                  <button
                    onClick={(e) => { e.stopPropagation(); setSheet("none"); setLocation("/compliance"); }}
                    style={{ background: "none", border: "none", color: "#0a84ff", fontSize: 11, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                  >
                    Read full policy
                  </button>
                </p>
              </div>
            </div>

            <button
              onClick={handleSubmitVerification}
              disabled={submittingVerify || !verifyDocFile || !policyAgreed}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 14,
                background: verifyDocFile && policyAgreed ? "hsl(var(--primary))" : "var(--glass-bg)",
                border: "none", color: verifyDocFile && policyAgreed ? "#fff" : "var(--text-3)",
                fontSize: 15, fontWeight: 600, cursor: verifyDocFile && policyAgreed ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {submittingVerify ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : "Submit for Review"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Sheet: Terms ─────────────────── */}
      {sheet === "terms" && (
        <Modal title="Terms of Service" onClose={() => setSheet("none")}>
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7 }}>
            By using PRaww+, you agree to use the service lawfully and not for harassment, fraud, or illegal activities. We reserve the right to suspend accounts in breach of these terms. Calls are billed by the minute from your coin balance. Subscriptions auto-renew unless cancelled before the renewal date.
          </p>
        </Modal>
      )}
      {sheet === "privacy" && (
        <Modal title="Privacy Policy" onClose={() => setSheet("none")}>
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7 }}>
            We collect your email, phone number, and call logs to operate the service. We never sell your data to third parties. Call recordings are stored locally on your device if you enable that feature. You may request deletion of your account and all associated data by contacting us at {CONTACT_EMAIL}.
          </p>
        </Modal>
      )}
      {sheet === "contact" && (
        <Modal title="Contact Us" onClose={() => setSheet("none")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
              We're here to help. Reach out via email for billing, technical, or account questions.
            </p>
            <button onClick={() => window.open(`mailto:${CONTACT_EMAIL}`, "_blank")}
              style={{ padding: "14px 0", borderRadius: 14, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
              Email {CONTACT_EMAIL}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
