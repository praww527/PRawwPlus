import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListCalls, useListMyNumbers, useListContacts,
  useCreateContact, useBulkImportContacts, useDeleteContact,
  useMakeCall, useGetMe,
} from "@workspace/api-client-react";
import { Phone, Search, UserCircle2, Download, X, Plus, Trash2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCall } from "@/context/CallContext";
import { MODAL_Z } from "@/components/Layout";

interface PhoneEntry { name: string; number: string; }

type ContactFilter = "all" | "phone" | "frequent";

const FILTERS: { key: ContactFilter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "phone",    label: "From Phone" },
  { key: "frequent", label: "Frequent" },
];

function initials(name?: string, number?: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return (number ?? "").replace(/\D/g, "").slice(-2);
}

const hasContactsApi =
  typeof navigator !== "undefined" &&
  "contacts" in navigator &&
  "ContactsManager" in window;

const PROMPT_KEY = "contacts_import_prompted_v2";

const glassInput: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 14,
  background: "var(--glass-bg)",
  border: "1px solid var(--glass-border)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  color: "var(--text-1)",
  fontSize: 15,
  outline: "none",
};

/* ── Import modal ───────────────────────────────────────────────────── */
function ImportModal({ entries, onImport, onClose }: {
  entries: PhoneEntry[];
  onImport: (selected: PhoneEntry[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(entries.map((e) => e.number)));
  const toggle = (number: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(number) ? next.delete(number) : next.add(number);
    return next;
  });

  return (
    <div
      className="overlay-backdrop"
      style={{ position: "fixed", inset: 0, zIndex: MODAL_Z, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
    >
      <div
        className="modal-surface slide-up"
        style={{
          width: "100%", maxWidth: 480,
          borderRadius: "24px 24px 0 0",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
          display: "flex", flexDirection: "column",
          maxHeight: "90dvh",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 14, paddingBottom: 8 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--sep-strong)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 16px" }}>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
            Select Contacts ({selected.size}/{entries.length})
          </p>
          <button className="btn-press" onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 15, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X style={{ width: 15, height: 15, color: "var(--text-2)" }} />
          </button>
        </div>
        <button className="btn-press"
          onClick={() => selected.size === entries.length ? setSelected(new Set()) : setSelected(new Set(entries.map(e => e.number)))}
          style={{ textAlign: "left", padding: "0 20px 12px", fontSize: 13, fontWeight: 600, color: "hsl(var(--primary))", background: "none", border: "none", cursor: "pointer" }}>
          {selected.size === entries.length ? "Deselect all" : "Select all"}
        </button>
        <div style={{ overflowY: "auto", flex: 1, padding: "0 12px" }}>
          {entries.map((e) => (
            <button key={e.number} className="btn-press" onClick={() => toggle(e.number)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "10px 8px", borderRadius: 14, marginBottom: 6,
                background: selected.has(e.number) ? "var(--glass-bg-strong)" : "var(--glass-bg)",
                border: `1px solid ${selected.has(e.number) ? "var(--glass-border)" : "transparent"}`,
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                cursor: "pointer", textAlign: "left",
              }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: "var(--text-1)", flexShrink: 0,
              }}>
                {initials(e.name, e.number)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</p>
                <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace" }}>{e.number}</p>
              </div>
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                border: selected.has(e.number) ? "none" : "2px solid var(--sep-strong)",
                background: selected.has(e.number) ? "hsl(var(--primary))" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {selected.has(e.number) && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, padding: "16px 20px 0" }}>
          <button className="btn-press" onClick={onClose}
            style={{ flex: 1, padding: "13px 0", borderRadius: 14, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", color: "var(--text-1)", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button className="btn-press" onClick={() => onImport(entries.filter((e) => selected.has(e.number)))} disabled={selected.size === 0}
            style={{ flex: 1, padding: "13px 0", borderRadius: 14, background: selected.size === 0 ? "var(--glass-bg)" : "hsl(var(--primary))", border: "none", color: selected.size === 0 ? "var(--text-3)" : "#fff", fontSize: 15, fontWeight: 600, cursor: selected.size === 0 ? "default" : "pointer" }}>
            Import {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Add contact modal ──────────────────────────────────────────────── */
function AddContactModal({ onAdd, onClose }: { onAdd: (name: string, number: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  return (
    <div
      className="overlay-backdrop"
      style={{ position: "fixed", inset: 0, zIndex: MODAL_Z, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
    >
      <div
        className="modal-surface slide-up"
        style={{
          width: "100%", maxWidth: 480,
          borderRadius: "24px 24px 0 0",
          padding: "0 0 max(env(safe-area-inset-bottom, 0px), 20px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 14, paddingBottom: 8 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--sep-strong)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 20px" }}>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>Add Contact</p>
          <button className="btn-press" onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 15, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X style={{ width: 15, height: 15, color: "var(--text-2)" }} />
          </button>
        </div>
        <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <input style={glassInput} type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={{ ...glassInput, fontFamily: "monospace" }} type="tel" placeholder="+27821234567" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 10, padding: "20px 20px 0" }}>
          <button className="btn-press" onClick={onClose}
            style={{ flex: 1, padding: "13px 0", borderRadius: 14, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", color: "var(--text-1)", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button className="btn-press" onClick={() => name.trim() && number.trim() && onAdd(name.trim(), number.trim())}
            disabled={!name.trim() || !number.trim()}
            style={{ flex: 1, padding: "13px 0", borderRadius: 14, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: !name.trim() || !number.trim() ? "default" : "pointer", opacity: !name.trim() || !number.trim() ? 0.45 : 1 }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Avatar ─────────────────────────────────────────────────────────── */
function Avatar({ name, number }: { name: string; number: string }) {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: "50%",
      background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 14, fontWeight: 700, color: "var(--text-1)",
      flexShrink: 0,
      boxShadow: "0 2px 8px rgba(0,0,0,0.14), 0 1px 0 var(--glass-highlight) inset",
    }}>
      {initials(name, number)}
    </div>
  );
}

function isInternalNumber(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  return digits.length === 4;
}

export default function Contacts() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [phoneEntries, setPhoneEntries] = useState<PhoneEntry[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { startOutgoing, updateCallId, endCall, isVertoConnected, makeVertoCall } = useCall();
  const { data: user } = useGetMe();
  const { mutateAsync: initiateCall } = useMakeCall();
  const { data: numbersData } = useListMyNumbers();
  const { data: callData } = useListCalls({ limit: 500 });
  const prompted = useRef(false);

  const { data: contactsData, isLoading, refetch } = useListContacts();
  const createContact = useCreateContact();
  const bulkImport = useBulkImportContacts();
  const deleteContact = useDeleteContact();

  const primaryNumber = numbersData?.myNumbers?.[0] ?? null;

  const callCounts = new Map<string, number>();
  for (const call of callData?.calls ?? []) {
    callCounts.set(call.recipientNumber, (callCounts.get(call.recipientNumber) ?? 0) + 1);
  }

  useEffect(() => {
    if (!hasContactsApi || prompted.current) return;
    prompted.current = true;
    if (!sessionStorage.getItem(PROMPT_KEY)) triggerPhoneImport();
  }, []);

  const triggerPhoneImport = async () => {
    if (!hasContactsApi) {
      toast({ title: "Not supported", description: "Your browser doesn't support phone contact import.", variant: "destructive" });
      return;
    }
    try {
      sessionStorage.setItem(PROMPT_KEY, "1");
      const contacts = await (navigator as any).contacts.select(["name", "tel"], { multiple: true });
      const entries: PhoneEntry[] = [];
      for (const c of contacts) {
        const name = (c.name?.[0] ?? "").trim();
        for (const tel of c.tel ?? []) {
          const number = tel.trim().replace(/\s+/g, "");
          if (name && number) entries.push({ name, number });
        }
      }
      if (entries.length === 0) { toast({ title: "No contacts selected" }); return; }
      setPhoneEntries(entries);
      setShowImportModal(true);
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: "Import failed", variant: "destructive" });
    }
  };

  const handleImport = async (selected: PhoneEntry[]) => {
    setShowImportModal(false);
    setImporting(true);
    try {
      const result = await bulkImport.mutateAsync({ data: { contacts: selected.map((e) => ({ name: e.name, number: e.number, fromPhone: true })) } });
      await refetch();
      toast({ title: "Contacts imported", description: `${result.imported} imported.` });
    } catch { toast({ title: "Import failed", variant: "destructive" }); }
    finally { setImporting(false); }
  };

  const handleAddContact = async (name: string, number: string) => {
    setShowAddModal(false);
    try {
      await createContact.mutateAsync({ data: { name, number, fromPhone: false } });
      await refetch();
      toast({ title: "Contact added" });
    } catch { toast({ title: "Failed to add", variant: "destructive" }); }
  };

  const handleDelete = async (contactId: string, name: string) => {
    try {
      await deleteContact.mutateAsync({ contactId });
      await refetch();
      toast({ title: `${name} removed` });
    } catch { toast({ title: "Failed to delete", variant: "destructive" }); }
  };

  const handleCall = async (number: string, name?: string) => {
    const isInternal = isInternalNumber(number);
    const coins = user?.coins ?? 0;
    const isActive = user?.subscriptionStatus === "active";

    if (!isVertoConnected) {
      toast({ title: "Not connected", description: "VoIP connection is not ready. Please wait a moment and try again.", variant: "destructive" });
      return;
    }

    if (!isInternal) {
      if (!primaryNumber) {
        toast({ title: "No number assigned", description: "Claim a phone number first.", variant: "destructive" });
        setLocation("/profile");
        return;
      }
      if (!isActive || coins <= 0) {
        toast({ title: "Cannot make external call", description: !isActive ? "Subscribe to make external calls" : "Top up your balance", variant: "destructive" });
        return;
      }
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
      toast({ title: "Call failed", description: err?.message ?? (isInternalNumber(number) ? "Could not reach that extension." : "Check your subscription and coin balance."), variant: "destructive" });
    }
  };

  const contacts: any[] = contactsData?.contacts ?? [];

  const filteredContacts = contacts.filter((c: any) => {
    const q = query.toLowerCase();
    const matchesSearch = c.name.toLowerCase().includes(q) || c.number.includes(q);
    if (!matchesSearch) return false;
    if (filter === "phone")    return c.fromPhone === true;
    if (filter === "frequent") return (callCounts.get(c.number) ?? 0) >= 2;
    return true;
  });

  const frequentCount = contacts.filter((c: any) => (callCounts.get(c.number) ?? 0) >= 2).length;

  return (
    <>
      {showImportModal && <ImportModal entries={phoneEntries} onImport={handleImport} onClose={() => setShowImportModal(false)} />}
      {showAddModal && <AddContactModal onAdd={handleAddContact} onClose={() => setShowAddModal(false)} />}

      <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 4 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0, letterSpacing: "-0.02em" }}>Contacts</h1>
            <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 3 }}>{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {hasContactsApi && (
              <button
                className="btn-press"
                onClick={triggerPhoneImport}
                disabled={importing}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "9px 16px", borderRadius: 22,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  boxShadow: "0 1px 0 var(--glass-highlight) inset",
                }}
              >
                {importing
                  ? <RefreshCw style={{ width: 14, height: 14 }} className="animate-spin" />
                  : <Download style={{ width: 14, height: 14 }} />
                }
                Import
              </button>
            )}
            <button
              className="btn-press"
              onClick={() => setShowAddModal(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "9px 16px", borderRadius: 22,
                background: "hsl(var(--primary))", border: "none",
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                boxShadow: "0 2px 12px rgba(26,140,255,0.30)",
              }}
            >
              <Plus style={{ width: 14, height: 14 }} />
              Add
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? " chip-active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key === "frequent" && frequentCount > 0 && (
                <span style={{
                  marginLeft: 2, minWidth: 16, height: 16, borderRadius: 8, padding: "0 4px",
                  background: filter === "frequent" ? "rgba(255,255,255,0.30)" : "rgba(26,140,255,0.70)",
                  color: "#fff", fontSize: 10, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  {frequentCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative" }}>
          <Search style={{
            position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
            width: 16, height: 16, color: "var(--text-3)", pointerEvents: "none",
          }} />
          <input
            type="text"
            placeholder="Search contacts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...glassInput, paddingLeft: 40, paddingRight: 36, borderRadius: 18 }}
          />
          {query && (
            <button className="btn-press" onClick={() => setQuery("")}
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer" }}>
              <X style={{ width: 16, height: 16, color: "var(--text-3)" }} />
            </button>
          )}
        </div>

        {/* My Contact Card */}
        {!isLoading && !query && user && filter === "all" && (
          <div className="section-card" style={{ marginBottom: 0 }}>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "rgba(59,130,246,0.18)",
                border: "1px solid rgba(59,130,246,0.35)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700, color: "#3b82f6", flexShrink: 0,
              }}>
                {initials(user.name, primaryNumber?.number)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.name ?? user.email ?? "Me"}
                  </p>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 6, padding: "1px 6px" }}>
                    ME
                  </span>
                </div>
                {primaryNumber && (
                  <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace", marginTop: 1 }}>
                    {primaryNumber.number}
                  </p>
                )}
                {user.extension && (
                  <p style={{ fontSize: 11, color: "#30d158", marginTop: 1, fontWeight: 600 }}>
                    Ext. {user.extension}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="section-card">
            {[...Array(5)].map((_, i) => (
              <div key={i}>
                <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="skeleton" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ height: 14, width: "55%", marginBottom: 6 }} />
                    <div className="skeleton" style={{ height: 11, width: "35%" }} />
                  </div>
                </div>
                {i < 4 && <div className="row-sep" />}
              </div>
            ))}
          </div>
        ) : filteredContacts.length === 0 ? (
          <div style={{ padding: "60px 0", textAlign: "center" }}>
            <div className="float-card" style={{
              width: 72, height: 72, borderRadius: 24,
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
              boxShadow: "0 4px 24px var(--glass-shadow), 0 1px 0 var(--glass-highlight) inset",
            }}>
              <UserCircle2 style={{ width: 30, height: 30, color: "var(--text-3)" }} />
            </div>
            <p style={{ color: "var(--text-2)", fontSize: 15, marginBottom: 16 }}>
              {query ? "No contacts match your search" : filter !== "all" ? `No ${filter} contacts` : "No contacts yet"}
            </p>
            {!query && filter === "all" && (
              <button
                className="btn-press"
                onClick={() => setShowAddModal(true)}
                style={{
                  padding: "11px 24px", borderRadius: 22,
                  background: "hsl(var(--primary))", border: "none",
                  color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  boxShadow: "0 2px 12px rgba(26,140,255,0.28)",
                }}
              >
                Add your first contact
              </button>
            )}
            {filter !== "all" && (
              <button
                className="btn-press"
                onClick={() => setFilter("all")}
                style={{
                  marginTop: 8, padding: "9px 22px", borderRadius: 20,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                Show all
              </button>
            )}
          </div>
        ) : (
          <div className="section-card">
            {filteredContacts.map((contact: any, i: number, arr: any[]) => {
              const callCount = callCounts.get(contact.number) ?? 0;
              return (
                <div key={contact.id} className="stagger-item">
                  <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar name={contact.name} number={contact.number} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
                        {contact.name}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace", marginTop: 1 }}>
                        {contact.number}
                      </p>
                      {callCount > 0 && (
                        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                          {callCount} call{callCount !== 1 ? "s" : ""}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className="btn-press"
                        onClick={() => handleDelete(contact.id, contact.name)}
                        style={{
                          width: 38, height: 38, borderRadius: "50%",
                          background: "rgba(255,69,58,0.10)",
                          border: "1px solid rgba(255,69,58,0.18)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <Trash2 style={{ width: 15, height: 15, color: "#ff453a" }} />
                      </button>
                      <button
                        className="btn-press"
                        onClick={() => handleCall(contact.number, contact.name)}
                        style={{
                          width: 38, height: 38, borderRadius: "50%",
                          background: "rgba(48,209,88,0.12)",
                          border: "1px solid rgba(48,209,88,0.20)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <Phone style={{ width: 15, height: 15, color: "#30d158" }} />
                      </button>
                    </div>
                  </div>
                  {i < arr.length - 1 && <div className="row-sep" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
