import { useState } from "react";
import { useLocation } from "wouter";
import { useListContacts, useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Star, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCall } from "@/context/CallContext";

function initials(name?: string, number?: string) {
  if (name) {
    const p = name.trim().split(/\s+/);
    return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
  }
  return (number ?? "").replace(/\D/g, "").slice(-2);
}

function isInternalNumber(num: string): boolean {
  return num.replace(/\D/g, "").length === 4;
}

export default function Favorites() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const { data: contactsData, isLoading } = useListContacts();
  const { mutateAsync: initiateCall } = useMakeCall();
  const { startOutgoing, updateCallId, makeVertoCall, endCall, isVertoConnected } = useCall();

  const contacts = contactsData?.contacts ?? [];
  const favorites = contacts.filter((c: any) => c.favorite);

  const handleCall = async (number: string, name?: string) => {
    const isInternal = isInternalNumber(number);
    const coins = user?.coins ?? 0;
    const isActive = user?.subscriptionStatus === "active";

    if (!isVertoConnected) {
      toast({ title: "Not connected", description: "VoIP connection is not ready. Please wait and try again.", variant: "destructive" });
      return;
    }
    if (!isInternal && (!isActive || coins <= 0)) {
      toast({ title: "Cannot make external call", description: !isActive ? "Subscribe to make external calls" : "Top up your balance", variant: "destructive" });
      return;
    }

    const callType: "internal" | "external" = isInternal ? "internal" : "external";
    const fsCallId = crypto.randomUUID();
    startOutgoing({ number, name, callType });

    try {
      const record = await initiateCall({ data: { recipientNumber: number, fsCallId } });
      if (record?.id) updateCallId(record.id);
      const vertoCallId = await makeVertoCall(number, fsCallId);
      if (vertoCallId === null) throw new Error("VoIP connection error. Please try again.");
    } catch (err: any) {
      endCall();
      toast({ title: "Call failed", description: err?.message ?? "Could not connect.", variant: "destructive" });
    }
  };

  return (
    <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page title */}
      <div style={{ paddingTop: 4 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0, letterSpacing: "-0.02em" }}>
          Favourites
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 3 }}>
          {favorites.length} favourite{favorites.length !== 1 ? "s" : ""}
        </p>
      </div>

      {isLoading ? (
        <div className="section-card">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="stagger-item">
              <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div className="skeleton" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 13, width: "55%", marginBottom: 7 }} />
                  <div className="skeleton" style={{ height: 10, width: "35%" }} />
                </div>
                <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 13 }} />
              </div>
              {i < 2 && <div className="row-sep" />}
            </div>
          ))}
        </div>
      ) : favorites.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center" }}>
          <div className="float-card" style={{
            width: 72, height: 72, borderRadius: 24,
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
            boxShadow: "0 4px 24px var(--glass-shadow), 0 1px 0 var(--glass-highlight) inset",
          }}>
            <Star style={{ width: 30, height: 30, color: "var(--text-3)" }} />
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15, marginBottom: 8 }}>No favourites yet</p>
          <p style={{ color: "var(--text-3)", fontSize: 13 }}>Star contacts to see them here</p>
          <button
            className="btn-press"
            onClick={() => setLocation("/contacts")}
            style={{
              marginTop: 16, padding: "11px 24px", borderRadius: 22,
              background: "hsl(var(--primary))", border: "none",
              color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
              boxShadow: "0 2px 12px rgba(26,140,255,0.30)",
            }}
          >
            Go to Contacts
          </button>
        </div>
      ) : (
        <div className="section-card">
          {favorites.map((contact: any, i: number, arr: any[]) => (
            <div key={contact.id} className="stagger-item">
              <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                {/* Avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: "rgba(255,214,10,0.15)", border: "1.5px solid rgba(255,214,10,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, color: "#ffd60a", flexShrink: 0,
                }}>
                  {initials(contact.name, contact.number)}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
                    {contact.name}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace", marginTop: 1 }}>
                    {contact.number}
                  </p>
                </div>

                {/* Call button */}
                <button
                  className="btn-press"
                  onClick={() => handleCall(contact.number, contact.name)}
                  style={{
                    width: 38, height: 38, borderRadius: 13,
                    background: "rgba(48,209,88,0.10)", border: "1px solid rgba(48,209,88,0.20)",
                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    boxShadow: "0 1px 0 var(--glass-highlight) inset",
                  }}
                >
                  <Phone style={{ width: 16, height: 16, color: "#30d158" }} />
                </button>
              </div>
              {i < arr.length - 1 && <div className="row-sep" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
