import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListCalls, useListMyNumbers, useListContacts,
  useCreateContact, useBulkImportContacts, useDeleteContact,
} from "@workspace/api-client-react";
import { Phone, Search, UserCircle2, Download, X, Plus, Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCall } from "@/context/CallContext";

interface PhoneEntry { name: string; number: string; }

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
    <div className="overlay-backdrop" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
      <div className="modal-surface" style={{ width: "100%", maxWidth: 420, borderRadius: 20, padding: "20px 0", display: "flex", flexDirection: "column", maxHeight: "80vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 16px" }}>
          <p style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)" }}>
            Select Contacts ({selected.size}/{entries.length})
          </p>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 15, background: "var(--surface-2)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X style={{ width: 15, height: 15, color: "var(--text-2)" }} />
          </button>
        </div>
        <button onClick={() => selected.size === entries.length ? setSelected(new Set()) : setSelected(new Set(entries.map(e => e.number)))}
          style={{ textAlign: "left", padding: "0 20px 12px", fontSize: 13, fontWeight: 600, color: "hsl(var(--primary))", background: "none", border: "none", cursor: "pointer" }}>
          {selected.size === entries.length ? "Deselect all" : "Select all"}
        </button>
        <div style={{ overflowY: "auto", flex: 1, padding: "0 12px" }}>
          {entries.map((e) => (
            <button key={e.number} onClick={() => toggle(e.number)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "10px 8px", borderRadius: 12, marginBottom: 4,
                background: selected.has(e.number) ? "rgba(10,132,255,0.12)" : "transparent",
                border: "none", cursor: "pointer", textAlign: "left",
              }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: selected.has(e.number) ? "rgba(10,132,255,0.18)" : "var(--surface-2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700,
                color: selected.has(e.number) ? "hsl(var(--primary))" : "var(--text-2)",
                flexShrink: 0,
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
          <button onClick={onClose}
            style={{ flex: 1, padding: "12px 0", borderRadius: 12, background: "var(--surface-2)", border: "none", color: "var(--text-1)", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => onImport(entries.filter((e) => selected.has(e.number)))} disabled={selected.size === 0}
            style={{ flex: 1, padding: "12px 0", borderRadius: 12, background: selected.size === 0 ? "var(--surface-2)" : "hsl(var(--primary))", border: "none", color: selected.size === 0 ? "var(--text-3)" : "#fff", fontSize: 15, fontWeight: 600, cursor: selected.size === 0 ? "default" : "pointer" }}>
            Import {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddContactModal({ onAdd, onClose }: { onAdd: (name: string, number: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const inputStyle = {
    width: "100%", padding: "12px 14px", borderRadius: 12,
    background: "var(--surface-2)", border: "1px solid var(--sep)",
    color: "var(--text-1)", fontSize: 15, outline: "none",
  };
  return (
    <div className="overlay-backdrop" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
      <div className="modal-surface" style={{ width: "100%", maxWidth: 420, borderRadius: 20, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <p style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)" }}>Add Contact</p>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 15, background: "var(--surface-2)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X style={{ width: 15, height: 15, color: "var(--text-2)" }} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input style={inputStyle} type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={{ ...inputStyle, fontFamily: "monospace" }} type="tel" placeholder="+27821234567" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "12px 0", borderRadius: 12, background: "var(--surface-2)", border: "none", color: "var(--text-1)", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => name.trim() && number.trim() && onAdd(name.trim(), number.trim())}
            disabled={!name.trim() || !number.trim()}
            style={{ flex: 1, padding: "12px 0", borderRadius: 12, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: !name.trim() || !number.trim() ? "default" : "pointer", opacity: !name.trim() || !number.trim() ? 0.45 : 1 }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Contacts() {
  const [query, setQuery] = useState("");
  const [phoneEntries, setPhoneEntries] = useState<PhoneEntry[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { startOutgoing } = useCall();
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

  const handleCall = (number: string, name?: string) => {
    if (!primaryNumber) {
      toast({ title: "No number assigned", description: "Claim a phone number first.", variant: "destructive" });
      setLocation("/profile");
      return;
    }
    startOutgoing({ number, name });
  };

  const contacts = contactsData?.contacts ?? [];
  const filtered = contacts.filter((c) => {
    const q = query.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.number.includes(q);
  });

  return (
    <>
      {showImportModal && <ImportModal entries={phoneEntries} onImport={handleImport} onClose={() => setShowImportModal(false)} />}
      {showAddModal && <AddContactModal onAdd={handleAddContact} onClose={() => setShowAddModal(false)} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 4 }}>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-1)" }}>Contacts</h1>
            <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {hasContactsApi && (
              <button onClick={triggerPhoneImport} disabled={importing}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 12, background: "var(--surface-1)", border: "1px solid var(--sep)", color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {importing ? <RefreshCw style={{ width: 15, height: 15 }} className="animate-spin" /> : <Download style={{ width: 15, height: 15 }} />}
                Import
              </button>
            )}
            <button onClick={() => setShowAddModal(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 12, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <Plus style={{ width: 15, height: 15 }} />
              Add
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--text-3)", pointerEvents: "none" }} />
          <input
            type="text"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%", padding: "11px 40px", borderRadius: 12,
              background: "var(--surface-1)", border: "1px solid var(--sep)",
              color: "var(--text-1)", fontSize: 15, outline: "none",
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer" }}>
              <X style={{ width: 16, height: 16, color: "var(--text-3)" }} />
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="section-card">
            {[...Array(5)].map((_, i) => (
              <div key={i}>
                <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--surface-2)", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 14, width: "55%", borderRadius: 6, background: "var(--surface-2)", marginBottom: 6 }} />
                    <div style={{ height: 11, width: "35%", borderRadius: 6, background: "var(--surface-2)" }} />
                  </div>
                </div>
                {i < 4 && <div className="row-sep" />}
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "60px 0", textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--surface-1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <UserCircle2 style={{ width: 28, height: 28, color: "var(--text-3)" }} />
            </div>
            <p style={{ color: "var(--text-2)", fontSize: 15, marginBottom: 16 }}>
              {query ? "No contacts match your search" : "No contacts yet"}
            </p>
            {!query && (
              <button onClick={() => setShowAddModal(true)}
                style={{ padding: "10px 20px", borderRadius: 12, background: "hsl(var(--primary))", border: "none", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Add your first contact
              </button>
            )}
          </div>
        ) : (
          <div className="section-card">
            {filtered.map((contact, i, arr) => {
              const callCount = callCounts.get(contact.number) ?? 0;
              return (
                <div key={contact.id}>
                  <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 42, height: 42, borderRadius: "50%",
                      background: "rgba(10,132,255,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, color: "hsl(var(--primary))",
                      flexShrink: 0,
                    }}>
                      {initials(contact.name, contact.number)}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contact.name}</p>
                      <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace", marginTop: 1 }}>{contact.number}</p>
                      {callCount > 0 && <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{callCount} call{callCount !== 1 ? "s" : ""}</p>}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => handleDelete(contact.id, contact.name)}
                        style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,69,58,0.12)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                        <Trash2 style={{ width: 15, height: 15, color: "#ff453a" }} />
                      </button>
                      <button onClick={() => handleCall(contact.number, contact.name)}
                        style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(48,209,88,0.14)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
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
