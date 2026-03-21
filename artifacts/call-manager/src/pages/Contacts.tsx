import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListCalls,
  useListMyNumbers,
  useListContacts,
  useCreateContact,
  useBulkImportContacts,
  useDeleteContact,
} from "@workspace/api-client-react";
import { Phone, Search, UserCircle2, Download, X, Plus, Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCall } from "@/context/CallContext";

interface PhoneEntry {
  name: string;
  number: string;
}

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

function ImportModal({
  entries,
  onImport,
  onClose,
}: {
  entries: PhoneEntry[];
  onImport: (selected: PhoneEntry[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(entries.map((e) => e.number))
  );

  const toggle = (number: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map((e) => e.number)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm glass rounded-3xl border border-white/15 p-5 animate-in slide-in-from-bottom-4 duration-300 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">
            Select Contacts ({selected.size}/{entries.length})
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full glass border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <button onClick={toggleAll} className="text-xs text-primary/80 hover:text-primary text-left mb-3 font-semibold">
          {selected.size === entries.length ? "Deselect all" : "Select all"}
        </button>
        <div className="overflow-y-auto flex-1 space-y-1.5 pr-1">
          {entries.map((e) => (
            <button key={e.number} onClick={() => toggle(e.number)}
              className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl border transition-all text-left",
                selected.has(e.number) ? "bg-primary/15 border-primary/30" : "glass border-white/8 hover:border-white/15"
              )}>
              <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border",
                selected.has(e.number) ? "bg-primary/20 border-primary/40 text-primary" : "bg-white/5 border-white/15 text-white/50"
              )}>
                {initials(e.name, e.number)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{e.name}</p>
                <p className="text-xs text-white/45 font-mono truncate">{e.number}</p>
              </div>
              <div className={cn("w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center",
                selected.has(e.number) ? "bg-primary border-primary" : "border-white/20"
              )}>
                {selected.has(e.number) && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl glass border border-white/10 text-white/60 text-sm font-semibold hover:text-white transition-all">
            Cancel
          </button>
          <button onClick={() => onImport(entries.filter((e) => selected.has(e.number)))} disabled={selected.size === 0}
            className="flex-1 py-3 rounded-2xl bg-primary/20 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
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
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm glass rounded-3xl border border-white/15 p-6 animate-in slide-in-from-bottom-4 duration-300 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white">Add Contact</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full glass border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl glass border border-white/15 text-white placeholder:text-white/30 bg-transparent focus:outline-none focus:border-primary/50 text-sm" />
          <input type="tel" placeholder="+1234567890" value={number} onChange={(e) => setNumber(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl glass border border-white/15 text-white placeholder:text-white/30 bg-transparent focus:outline-none focus:border-primary/50 text-sm font-mono" />
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl glass border border-white/10 text-white/60 text-sm font-semibold hover:text-white transition-all">Cancel</button>
          <button onClick={() => name.trim() && number.trim() && onAdd(name.trim(), number.trim())} disabled={!name.trim() || !number.trim()}
            className="flex-1 py-3 rounded-2xl bg-primary/20 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
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
    if (!hasContactsApi) return;
    if (prompted.current) return;
    prompted.current = true;
    const already = sessionStorage.getItem(PROMPT_KEY);
    if (!already) triggerPhoneImport();
  }, []);

  const triggerPhoneImport = async () => {
    if (!hasContactsApi) {
      toast({ title: "Not supported", description: "Your browser doesn't support phone contact import. Try from a mobile device.", variant: "destructive" });
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
      if (entries.length === 0) {
        toast({ title: "No contacts selected" });
        return;
      }
      setPhoneEntries(entries);
      setShowImportModal(true);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ title: "Import failed", description: "Could not access your contacts.", variant: "destructive" });
      }
    }
  };

  const handleImport = async (selected: PhoneEntry[]) => {
    setShowImportModal(false);
    setImporting(true);
    try {
      const result = await bulkImport.mutateAsync({
        data: { contacts: selected.map((e) => ({ name: e.name, number: e.number, fromPhone: true })) },
      });
      await refetch();
      toast({ title: "Contacts imported", description: `${result.imported} contact${result.imported !== 1 ? "s" : ""} imported${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}.` });
    } catch {
      toast({ title: "Import failed", description: "Failed to save contacts.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleAddContact = async (name: string, number: string) => {
    setShowAddModal(false);
    try {
      await createContact.mutateAsync({ data: { name, number, fromPhone: false } });
      await refetch();
      toast({ title: "Contact added", description: `${name} has been saved.` });
    } catch {
      toast({ title: "Failed to add", description: "Could not save contact.", variant: "destructive" });
    }
  };

  const handleDelete = async (contactId: string, name: string) => {
    try {
      await deleteContact.mutateAsync({ contactId });
      await refetch();
      toast({ title: "Deleted", description: `${name} removed.` });
    } catch {
      toast({ title: "Failed to delete", description: "Could not remove contact.", variant: "destructive" });
    }
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

      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Contacts</h1>
            <p className="text-white/50 text-sm mt-0.5">{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex gap-2">
            {hasContactsApi && (
              <button onClick={triggerPhoneImport} disabled={importing} title="Import from phone"
                className="flex items-center gap-2 px-3 py-2 rounded-2xl glass border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-all text-sm font-semibold active:scale-95">
                {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span className="hidden sm:inline">Import</span>
              </button>
            )}
            <button onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all text-sm font-semibold active:scale-95">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add</span>
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
          <input type="text" placeholder="Search contacts..." value={query} onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-2xl glass border border-white/10 text-white placeholder:text-white/30 bg-transparent focus:outline-none focus:border-primary/40 text-sm" />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-2xl glass animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
              <UserCircle2 className="h-8 w-8 text-white/20" />
            </div>
            <p className="text-white/40 text-sm mb-4">{query ? "No contacts match your search" : "No contacts yet"}</p>
            {!query && (
              <div className="flex flex-wrap justify-center gap-3">
                {hasContactsApi && (
                  <button onClick={triggerPhoneImport}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-2xl glass border border-white/10 text-white/60 hover:text-white text-sm font-semibold transition-all">
                    <Download className="h-4 w-4" /> Import from phone
                  </button>
                )}
                <button onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 text-sm font-semibold transition-all">
                  <Plus className="h-4 w-4" /> Add manually
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((contact) => {
              const callCount = callCounts.get(contact.number) ?? 0;
              return (
                <div key={contact.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl glass border border-white/8 hover:border-primary/20 hover:bg-white/[0.03] transition-all group">
                  <div className="w-11 h-11 rounded-full bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary font-mono">{initials(contact.name, contact.number)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white text-sm truncate leading-snug">{contact.name}</p>
                    <p className="font-mono text-xs text-white/45 truncate leading-snug">{contact.number}</p>
                    {callCount > 0 && <p className="text-[11px] text-white/30 mt-0.5">{callCount} call{callCount !== 1 ? "s" : ""}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDelete(contact.id, contact.name)}
                      className="w-9 h-9 rounded-full bg-red-500/8 border border-red-500/15 flex items-center justify-center text-red-400/50 hover:text-red-400 hover:bg-red-500/15 opacity-0 group-hover:opacity-100 transition-all active:scale-90">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleCall(contact.number, contact.name)}
                      className="w-11 h-11 rounded-full bg-green-500/12 border border-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/22 hover:scale-105 active:scale-90 transition-all shrink-0">
                      <Phone className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
