import { useState } from "react";
import { useLocation } from "wouter";
import { useListContacts, useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Star, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCall } from "@/context/CallContext";

function initials(name?: string, number?: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return (number ?? "").replace(/\D/g, "").slice(-2);
}

function isInternalNumber(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  return digits.length === 4;
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
      toast({
        title: "Not connected",
        description: "VoIP connection is not ready. Please wait and try again.",
        variant: "destructive",
      });
      return;
    }

    if (!isInternal && (!isActive || coins <= 0)) {
      toast({
        title: "Cannot make external call",
        description: !isActive ? "Subscribe to make external calls" : "Top up your balance",
        variant: "destructive",
      });
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
      toast({
        title: "Call failed",
        description: err?.message ?? "Could not connect.",
        variant: "destructive",
      });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ paddingTop: 4 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0 }}>
          Favorites
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
          {favorites.length} favorite{favorites.length !== 1 ? "s" : ""}
        </p>
      </div>

      {isLoading ? (
        <div className="section-card">
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: 14, width: "55%", borderRadius: 6, background: "var(--glass-bg)", marginBottom: 6 }} />
                <div style={{ height: 11, width: "35%", borderRadius: 6, background: "var(--glass-bg)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : favorites.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: 24,
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <Star style={{ width: 30, height: 30, color: "var(--text-3)" }} />
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15, marginBottom: 8 }}>No favorites yet</p>
          <p style={{ color: "var(--text-3)", fontSize: 13 }}>Star contacts to see them here</p>
          <button
            className="btn-press"
            onClick={() => setLocation("/contacts")}
            style={{
              marginTop: 16,
              padding: "11px 24px", borderRadius: 22,
              background: "hsl(var(--primary))", border: "none",
              color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
              boxShadow: "0 2px 12px rgba(26,140,255,0.28)",
            }}
          >
            Go to Contacts
          </button>
        </div>
      ) : (
        <div className="section-card">
          {favorites.map((contact: any, i: number, arr: any[]) => (
            <div key={contact.id}>
              <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, color: "var(--text-1)", flexShrink: 0,
                }}>
                  {initials(contact.name, contact.number)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
                    {contact.name}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace", marginTop: 1 }}>
                    {contact.number}
                  </p>
                </div>
                <button
                  className="btn-press"
                  onClick={() => handleCall(contact.number, contact.name)}
                  style={{
                    width: 38, height: 38, borderRadius: 13,
                    background: "rgba(48,209,88,0.10)",
                    border: "1px solid rgba(48,209,88,0.18)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
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
