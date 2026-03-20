import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useListCalls } from "@workspace/api-client-react";
import { Phone, Search, UserCircle2, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Contact {
  number: string;
  label?: string;
  callCount: number;
  fromPhone?: boolean;
}

function buildCallContacts(calls: any[]): Contact[] {
  const map = new Map<string, number>();
  for (const call of calls) {
    map.set(call.recipientNumber, (map.get(call.recipientNumber) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([number, callCount]) => ({ number, callCount }))
    .sort((a, b) => b.callCount - a.callCount);
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
  typeof navigator !== "undefined" && "contacts" in navigator;

function ImportPromptModal({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm glass rounded-3xl border border-white/15 p-6 animate-in slide-in-from-bottom-4 duration-300 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center">
            <Download className="h-6 w-6 text-primary" />
          </div>
          <button
            onClick={onDecline}
            className="w-8 h-8 rounded-full glass border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-lg font-bold text-white mb-1">Import Contacts</h3>
        <p className="text-sm text-white/50 mb-6 leading-relaxed">
          Would you like to import contacts from your phone book? You can choose which ones to add.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onDecline}
            className="flex-1 py-3 rounded-2xl glass border border-white/10 text-white/60 text-sm font-semibold hover:text-white hover:border-white/20 transition-all active:scale-95"
          >
            Not Now
          </button>
          <button
            onClick={onAccept}
            className="flex-1 py-3 rounded-2xl bg-primary/20 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/30 transition-all active:scale-95"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

const PROMPT_KEY = "contacts_import_prompted";

export default function Contacts() {
  const [query, setQuery] = useState("");
  const [phoneContacts, setPhoneContacts] = useState<Contact[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useListCalls({ limit: 200 });
  const prompted = useRef(false);

  // Auto-prompt once per session on first visit if Contact API is supported
  useEffect(() => {
    if (!hasContactsApi) return;
    if (prompted.current) return;
    prompted.current = true;
    const already = sessionStorage.getItem(PROMPT_KEY);
    if (!already) {
      setShowPrompt(true);
    }
  }, []);

  const importFromPhone = async () => {
    setShowPrompt(false);
    sessionStorage.setItem(PROMPT_KEY, "1");
    if (!hasContactsApi) {
      toast({
        title: "Not supported",
        description: "Try Chrome on Android to import contacts.",
        variant: "destructive",
      });
      return;
    }
    try {
      const api = (navigator as any).contacts;
      const results = await api.select(["name", "tel"], { multiple: true });
      const imported: Contact[] = [];
      for (const c of results) {
        for (const tel of c.tel ?? []) {
          const cleaned = tel.replace(/\s/g, "");
          if (cleaned) {
            imported.push({
              number: cleaned,
              label: c.name?.[0] ?? undefined,
              callCount: 0,
              fromPhone: true,
            });
          }
        }
      }
      if (imported.length === 0) {
        toast({ title: "No contacts selected" });
      } else {
        setPhoneContacts((prev) => {
          const existing = new Set(prev.map((p) => p.number));
          return [...prev, ...imported.filter((i) => !existing.has(i.number))];
        });
        toast({
          title: `Imported ${imported.length} contact${imported.length !== 1 ? "s" : ""}`,
        });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ title: "Import failed", description: err?.message, variant: "destructive" });
      }
    }
  };

  const declineImport = () => {
    setShowPrompt(false);
    sessionStorage.setItem(PROMPT_KEY, "1");
  };

  const callContacts = buildCallContacts(data?.calls ?? []);

  const merged: Contact[] = [
    ...phoneContacts.map((pc) => ({
      ...pc,
      callCount: callContacts.find((c) => c.number === pc.number)?.callCount ?? 0,
    })),
    ...callContacts.filter((c) => !phoneContacts.some((pc) => pc.number === c.number)),
  ];

  const filtered = query
    ? merged.filter(
        (c) =>
          c.number.includes(query) ||
          (c.label ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : merged;

  const handleCall = (number: string) => {
    setLocation(`/dashboard?dial=${encodeURIComponent(number)}`);
  };

  return (
    <>
      {showPrompt && (
        <ImportPromptModal onAccept={importFromPhone} onDecline={declineImport} />
      )}

      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Header */}
        <div className="pt-1 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Contacts</h1>
            <p className="text-sm text-white/40 mt-1">
              {merged.length > 0 ? `${merged.length} contacts` : "Your contacts"}
            </p>
          </div>
          {hasContactsApi && (
            <button
              onClick={importFromPhone}
              className="flex items-center gap-2 px-4 py-2 rounded-full glass border border-white/10 text-white/60 hover:text-white hover:border-primary/30 text-sm font-medium transition-all active:scale-95"
            >
              <Download className="h-4 w-4" />
              Import
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or number…"
            className="w-full pl-11 pr-4 py-3 rounded-full glass border border-white/10 bg-transparent text-white placeholder:text-white/30 text-sm outline-none focus:border-primary/40 transition-colors"
          />
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl glass animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <UserCircle2 className="h-14 w-14 text-white/10 mx-auto mb-4" />
            <p className="text-white/40 text-sm">
              {query
                ? "No matching contacts"
                : "Make a call or import contacts to get started"}
            </p>
            {!query && hasContactsApi && (
              <button
                onClick={importFromPhone}
                className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary/15 border border-primary/25 text-primary text-sm font-medium hover:bg-primary/25 transition-all active:scale-95"
              >
                <Download className="h-4 w-4" />
                Import from Phone
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((contact) => (
              <div
                key={contact.number}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl glass border border-white/8 hover:border-primary/20 hover:bg-white/[0.03] transition-all"
              >
                {/* Avatar */}
                <div className="w-11 h-11 rounded-full bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary font-mono">
                    {initials(contact.label, contact.number)}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {contact.label && (
                    <p className="font-semibold text-white text-sm truncate leading-snug">
                      {contact.label}
                    </p>
                  )}
                  <p
                    className={cn(
                      "font-mono truncate leading-snug",
                      contact.label
                        ? "text-xs text-white/45"
                        : "text-sm font-semibold text-white"
                    )}
                  >
                    {contact.number}
                  </p>
                  <p className="text-[11px] text-white/30 mt-0.5">
                    {contact.callCount > 0
                      ? `${contact.callCount} call${contact.callCount !== 1 ? "s" : ""}`
                      : contact.fromPhone
                      ? "From phone"
                      : ""}
                  </p>
                </div>

                {/* Call */}
                <button
                  onClick={() => handleCall(contact.number)}
                  className="w-11 h-11 rounded-full bg-green-500/12 border border-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/22 hover:scale-105 active:scale-90 transition-all shrink-0"
                >
                  <Phone className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
