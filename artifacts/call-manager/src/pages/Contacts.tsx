import { useState } from "react";
import { useLocation } from "wouter";
import { useListCalls } from "@workspace/api-client-react";
import { Phone, Search, UserCircle2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Contact {
  number: string;
  label?: string;
  callCount: number;
}

interface PhoneContact {
  number: string;
  name?: string;
}

function buildContacts(calls: any[]): Contact[] {
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
    const parts = name.trim().split(" ");
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return (number ?? "").replace(/\D/g, "").slice(-2);
}

const hasContactsApi = typeof navigator !== "undefined" && "contacts" in navigator;

export default function Contacts() {
  const [query, setQuery] = useState("");
  const [phoneContacts, setPhoneContacts] = useState<PhoneContact[]>([]);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useListCalls({ limit: 200 });

  const callContacts = buildContacts(data?.calls ?? []);

  const importFromPhone = async () => {
    if (!hasContactsApi) {
      toast({
        title: "Not supported",
        description: "Your browser does not support the Contact Picker. Try Chrome on Android.",
        variant: "destructive",
      });
      return;
    }
    try {
      const contactsApi = (navigator as any).contacts;
      const results = await contactsApi.select(["name", "tel"], { multiple: true });
      const imported: PhoneContact[] = [];
      for (const c of results) {
        for (const tel of c.tel ?? []) {
          const cleaned = tel.replace(/\s/g, "");
          if (cleaned) {
            imported.push({ number: cleaned, name: c.name?.[0] });
          }
        }
      }
      if (imported.length === 0) {
        toast({ title: "No contacts selected" });
      } else {
        setPhoneContacts((prev) => {
          const existing = new Set(prev.map((p) => p.number));
          const fresh = imported.filter((i) => !existing.has(i.number));
          return [...prev, ...fresh];
        });
        toast({ title: `Imported ${imported.length} contact${imported.length !== 1 ? "s" : ""}` });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ title: "Import failed", description: err?.message, variant: "destructive" });
      }
    }
  };

  const handleCall = (number: string) => {
    setLocation(`/dashboard?dial=${encodeURIComponent(number)}`);
  };

  const mergedContacts: (Contact | PhoneContact)[] = [
    ...phoneContacts.map((pc) => ({
      number: pc.number,
      label: pc.name,
      callCount: callContacts.find((c) => c.number === pc.number)?.callCount ?? 0,
      fromPhone: true,
    })),
    ...callContacts.filter((c) => !phoneContacts.some((pc) => pc.number === c.number)),
  ];

  const filtered = query
    ? mergedContacts.filter(
        (c) =>
          c.number.includes(query) ||
          ((c as any).label ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : mergedContacts;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="pt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Contacts</h1>
          <p className="text-sm text-white/40 mt-1">Your saved and call history contacts</p>
        </div>
        <button
          onClick={importFromPhone}
          className="flex items-center gap-2 px-4 py-2 rounded-full glass border border-white/10 text-white/70 hover:text-white hover:border-primary/30 text-sm font-medium transition-all active:scale-95"
        >
          <Download className="h-4 w-4" />
          Import
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or number…"
          className="w-full pl-11 pr-4 py-3 rounded-full glass border border-white/10 bg-transparent text-white placeholder:text-white/30 text-sm outline-none focus:border-primary/40 transition-colors"
        />
      </div>

      {/* Contact List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-full glass animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <UserCircle2 className="h-14 w-14 text-white/10 mx-auto mb-4" />
          <p className="text-white/40 text-sm">
            {query ? "No matching contacts" : "Make a call or import contacts to get started"}
          </p>
          {!query && hasContactsApi && (
            <button
              onClick={importFromPhone}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary/20 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/30 transition-all active:scale-95"
            >
              <Download className="h-4 w-4" />
              Import from Phone
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((contact) => {
            const label = (contact as any).label as string | undefined;
            const fromPhone = (contact as any).fromPhone as boolean | undefined;
            const callCount = (contact as any).callCount as number;
            return (
              <div
                key={contact.number}
                className="flex items-center gap-4 p-3 pr-3 rounded-full glass border border-white/8 hover:border-primary/20 hover:bg-white/[0.03] transition-all group"
              >
                {/* Avatar */}
                <div className="w-11 h-11 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary font-mono">
                    {initials(label, contact.number)}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {label && (
                    <p className="text-white font-semibold text-sm truncate">{label}</p>
                  )}
                  <p className={cn("font-mono text-sm truncate", label ? "text-white/50 text-xs" : "text-white font-semibold")}>
                    {contact.number}
                  </p>
                  {callCount > 0 && (
                    <p className="text-xs text-white/30 mt-0.5">
                      {callCount} call{callCount !== 1 ? "s" : ""}
                    </p>
                  )}
                  {fromPhone && callCount === 0 && (
                    <p className="text-xs text-white/30 mt-0.5">From phone</p>
                  )}
                </div>

                {/* Call Button */}
                <button
                  onClick={() => handleCall(contact.number)}
                  className="w-11 h-11 rounded-full bg-green-500/15 border border-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/25 hover:scale-105 active:scale-95 transition-all shrink-0"
                >
                  <Phone className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
