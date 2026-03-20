import { useState } from "react";
import { useLocation } from "wouter";
import { useListCalls } from "@workspace/api-client-react";
import { Phone, Search, Star, UserCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Contact {
  number: string;
  label?: string;
  callCount: number;
  starred?: boolean;
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

function initials(number: string) {
  return number.replace(/\D/g, "").slice(-2);
}

export default function Contacts() {
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();
  const { data, isLoading } = useListCalls({ limit: 200 });

  const allContacts = buildContacts(data?.calls ?? []);
  const filtered = query
    ? allContacts.filter((c) => c.number.includes(query))
    : allContacts;

  const handleCall = (number: string) => {
    setLocation(`/?dial=${encodeURIComponent(number)}`);
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="pt-2">
        <h1 className="text-2xl font-bold text-white">Contacts</h1>
        <p className="text-sm text-white/40 mt-1">Numbers from your call history</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by number…"
          className="w-full pl-10 pr-4 py-3 rounded-xl glass border border-white/10 bg-transparent text-white placeholder:text-white/30 text-sm outline-none focus:border-primary/40 transition-colors"
        />
      </div>

      {/* Contact List */}
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
            {query ? "No matching contacts" : "Make a call to save contacts"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((contact) => (
            <div
              key={contact.number}
              className="flex items-center gap-4 p-4 rounded-2xl glass border border-white/8 hover:border-primary/20 hover:bg-white/[0.03] transition-all group"
            >
              {/* Avatar */}
              <div className="w-11 h-11 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary font-mono">
                  {initials(contact.number)}
                </span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-mono text-white font-semibold text-sm truncate">{contact.number}</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {contact.callCount} call{contact.callCount !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Call Button */}
              <button
                onClick={() => handleCall(contact.number)}
                className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/25 hover:scale-105 active:scale-95 transition-all"
              >
                <Phone className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
