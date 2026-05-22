import { useLocation } from "wouter";
import {
  Shield, FileText, Mail, Phone, CheckCircle2, AlertTriangle,
  ChevronLeft, Copy, ExternalLink, BookOpen, Users, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const CONTACT_EMAIL = "info@prawwplus.co.za";

function CopyButton({ text }: { text: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handle}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 14px", borderRadius: 10,
        background: "rgba(128,128,128,0.18)", border: "none",
        color: copied ? "#30d158" : "var(--text-2)",
        fontSize: 12, fontWeight: 600, cursor: "pointer",
      }}
    >
      <Copy style={{ width: 13, height: 13 }} />
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: "var(--glass-bg)",
      borderRadius: 16,
      padding: "18px 16px",
      borderLeft: accent ? `4px solid ${accent}` : undefined,
      marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 28, marginBottom: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <p style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)", margin: 0, fontFamily: "var(--font-display)" }}>{title}</p>
    </div>
  );
}

const EMAIL_TEMPLATE = `Subject: Important Notice — Calls from [Your Business Name]

Dear [Client Name],

We are reaching out to let you know that our business uses PRaww+, a verified South African VoIP platform, for professional communications.

What this means for you:
• You may receive calls from numbers managed through PRaww+
• All calls are made for legitimate business purposes only
• We are a verified business on the PRaww+ platform

If you receive a call from us and have any concerns, please contact us directly:
• Email: [your-email@example.com]
• Phone: [your-direct-number]

We take your privacy and communication preferences seriously. If you would prefer not to be contacted, please reply to this email and we will immediately honour your request.

Kind regards,
[Your Name]
[Your Business Name]`;

const VERIFY_PAGE_TEMPLATE = `--- WEBSITE VERIFICATION SNIPPET ---

Add this to your website's contact or about page:

"Our business uses PRaww+, a verified South African VoIP communications 
platform. All calls from our business numbers are legitimate. 

Business Verification Status: Verified ✓
PRaww+ Member Since: [Year]

If you have any concerns about a call received from us, 
please contact us at [email] or visit [your website]."

--- END SNIPPET ---`;

export default function CompliancePage() {
  const [, setLocation] = useLocation();

  return (
    <div className="page-in" style={{ paddingBottom: 32, paddingTop: 4 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 20px" }}>
        <button
          onClick={() => setLocation("/profile")}
          style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(128,128,128,0.18)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
        >
          <ChevronLeft style={{ width: 18, height: 18, color: "var(--text-1)" }} />
        </button>
        <div>
          <p style={{ fontSize: 26, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", letterSpacing: "-0.02em", margin: 0 }}>
            Responsible Use
          </p>
          <p style={{ fontSize: 13, color: "var(--text-2)", margin: "2px 0 0" }}>Compliance & Client Communication Guide</p>
        </div>
      </div>

      {/* Intro banner */}
      <div style={{ padding: "16px", borderRadius: 16, background: "rgba(10,132,255,0.10)", border: "1px solid rgba(10,132,255,0.20)", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Shield style={{ width: 22, height: 22, color: "#0a84ff", flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#0a84ff", margin: "0 0 4px" }}>Verified Business Platform</p>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
              PRaww+ is a South African business VoIP platform. Verification ensures only legitimate businesses make calls. Use this guide to stay compliant and keep your clients informed.
            </p>
          </div>
        </div>
      </div>

      {/* ── Verification Requirements ── */}
      <SectionHeader icon={<FileText size={16} />} title="Verification Requirements" color="#0a84ff" />

      <Card accent="#0a84ff">
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", margin: "0 0 12px" }}>Required Documents</p>
        {[
          { label: "Company Registration Certificate (CIPC)", desc: "Proof your business is registered in South Africa" },
          { label: "South African ID or Passport", desc: "Identity of the account holder / director" },
          { label: "Business Physical Address", desc: "Proof of a legitimate business address (utility bill or lease)" },
        ].map(({ label, desc }) => (
          <div key={label} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
            <CheckCircle2 style={{ width: 16, height: 16, color: "#30d158", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>{label}</p>
              <p style={{ fontSize: 12, color: "var(--text-2)", margin: "2px 0 0" }}>{desc}</p>
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", margin: "0 0 8px" }}>Verification Timeline</p>
        {[
          { step: "1", label: "Submit documents", time: "Instant" },
          { step: "2", label: "Admin review", time: "1–2 business days" },
          { step: "3", label: "Approval & calling enabled", time: "After review" },
        ].map(({ step, label, time }) => (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: step !== "3" ? "1px solid var(--sep)" : "none" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(10,132,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0a84ff" }}>{step}</span>
            </div>
            <span style={{ flex: 1, fontSize: 13, color: "var(--text-1)" }}>{label}</span>
            <span style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock style={{ width: 11, height: 11 }} />{time}
            </span>
          </div>
        ))}
      </Card>

      {/* ── Responsible Use Policy ── */}
      <SectionHeader icon={<BookOpen size={16} />} title="Responsible Use Policy" color="#ff9f0a" />

      <Card accent="#ff9f0a">
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", margin: "0 0 10px" }}>You agree to use PRaww+ only for:</p>
        {[
          "Legitimate business communications with existing or prospective clients",
          "Customer support, follow-ups and appointment confirmations",
          "Communicating with suppliers, partners and staff",
          "Any lawful purpose under South African law",
        ].map((item) => (
          <div key={item} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
            <CheckCircle2 style={{ width: 14, height: 14, color: "#30d158", flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.4 }}>{item}</p>
          </div>
        ))}
      </Card>

      <Card accent="#ff453a">
        <p style={{ fontSize: 14, fontWeight: 700, color: "#ff453a", margin: "0 0 10px" }}>
          <AlertTriangle style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "middle" }} />
          Prohibited Activities
        </p>
        {[
          "Automated robocalling or mass unsolicited dialling",
          "Harassment, threats, or abusive communication",
          "Impersonating another business, person or organisation",
          "Calling numbers on the South African Do-Not-Call registry",
          "Any activity that violates POPIA, ECT Act or WASPA guidelines",
        ].map((item) => (
          <div key={item} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: "rgba(255,69,58,0.25)", flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 6, height: 2, background: "#ff453a", borderRadius: 1 }} />
            </div>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.4 }}>{item}</p>
          </div>
        ))}
      </Card>

      {/* ── Automated Monitoring ── */}
      <SectionHeader icon={<Shield size={16} />} title="Automated Call Monitoring" color="#30d158" />

      <Card>
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: "0 0 12px", lineHeight: 1.5 }}>
          PRaww+ automatically monitors call patterns to protect businesses and their clients. The following triggers an automatic review:
        </p>
        {[
          { flag: "High volume", desc: "More than 50 calls placed within 24 hours" },
          { flag: "Short calls", desc: "More than 60% of calls lasting under 10 seconds" },
          { flag: "Wide spread", desc: "Calls to more than 30 unique numbers in 24 hours" },
        ].map(({ flag, desc }) => (
          <div key={flag} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--sep)", alignItems: "flex-start" }}>
            <div style={{ padding: "3px 8px", borderRadius: 6, background: "rgba(255,149,0,0.15)", flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#ff9f0a" }}>{flag}</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.4 }}>{desc}</p>
          </div>
        ))}
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: "12px 0 0", lineHeight: 1.4 }}>
          Flagged accounts are reviewed by our team within 1 business day. Repeated violations may result in suspension.
        </p>
      </Card>

      {/* ── Client Communication Guide ── */}
      <SectionHeader icon={<Users size={16} />} title="Client Communication Guide" color="#bf5af2" />

      <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, margin: "0 0 16px" }}>
        Keep your clients informed that they may receive calls from your PRaww+ numbers. Use the templates below.
      </p>

      {/* Email template */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Mail style={{ width: 15, height: 15, color: "#bf5af2" }} />
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>Client Notification Email</p>
          </div>
          <CopyButton text={EMAIL_TEMPLATE} />
        </div>
        <div style={{
          background: "var(--glass-bg)", borderRadius: 12, padding: "14px 16px",
          border: "1px solid var(--sep)",
        }}>
          <pre style={{
            fontSize: 12, color: "var(--text-2)", whiteSpace: "pre-wrap",
            wordBreak: "break-word", margin: 0, fontFamily: "var(--font-sans)",
            lineHeight: 1.6,
          }}>
            {EMAIL_TEMPLATE}
          </pre>
        </div>
      </div>

      {/* Website verification snippet */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ExternalLink style={{ width: 15, height: 15, color: "#bf5af2" }} />
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>Website Verification Notice</p>
          </div>
          <CopyButton text={VERIFY_PAGE_TEMPLATE} />
        </div>
        <div style={{
          background: "var(--glass-bg)", borderRadius: 12, padding: "14px 16px",
          border: "1px solid var(--sep)",
        }}>
          <pre style={{
            fontSize: 12, color: "var(--text-2)", whiteSpace: "pre-wrap",
            wordBreak: "break-word", margin: 0, fontFamily: "var(--font-sans)",
            lineHeight: 1.6,
          }}>
            {VERIFY_PAGE_TEMPLATE}
          </pre>
        </div>
      </div>

      {/* Best practices */}
      <SectionHeader icon={<CheckCircle2 size={16} />} title="Best Practices" color="#30d158" />
      <Card>
        {[
          "Always identify your business name at the start of a call",
          "Respect clients who ask to be removed from your call list",
          "Only call during business hours (8am–6pm SAST) unless agreed otherwise",
          "Keep a record of consent for marketing calls",
          "Use your PRaww+ DID number as your public-facing caller ID",
          "Send a follow-up email after first contact from a new number",
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i < 5 ? "1px solid var(--sep)" : "none", alignItems: "flex-start" }}>
            <CheckCircle2 style={{ width: 14, height: 14, color: "#30d158", flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.4 }}>{item}</p>
          </div>
        ))}
      </Card>

      {/* Contact */}
      <div style={{ padding: "16px", borderRadius: 14, background: "rgba(128,128,128,0.10)", marginTop: 8 }}>
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, textAlign: "center", lineHeight: 1.5 }}>
          Questions about compliance?{" "}
          <button
            onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=Compliance Query`, "_blank")}
            style={{ background: "none", border: "none", color: "#0a84ff", fontSize: 13, cursor: "pointer", padding: 0, textDecoration: "underline" }}
          >
            Contact us
          </button>
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", marginTop: 24, opacity: 0.45 }}>
        <Phone style={{ width: 12, height: 12, color: "var(--text-3)" }} />
        <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>PRaww+ · Responsible Use Policy v1.0</p>
      </div>
    </div>
  );
}
