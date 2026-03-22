import { useState } from "react";
import { useLocation } from "wouter";
import { useSearchNumbers, useBuyNumber, useChangeNumber, getSearchNumbersQueryKey } from "@workspace/api-client-react";
import type { AvailableNumber } from "@workspace/api-client-react";
import {
  ArrowLeft, Search, Loader2, Phone, Star, CheckCircle2,
  X, AlertCircle, Globe, MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const COUNTRIES = [
  { code: "ZA", name: "South Africa" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
];

interface ConfirmModalProps {
  number: string;
  numberType: string;
  isChange: boolean;
  oldNumber?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function ConfirmModal({ number, numberType, isChange, oldNumber, onConfirm, onCancel, isPending }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm glass rounded-3xl border border-white/15 p-6 animate-in slide-in-from-bottom-4 duration-300 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">
            {isChange ? "Change Number" : "Confirm Purchase"}
          </h3>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-full glass border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
          {isChange && oldNumber && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-red-500/12 flex items-center justify-center shrink-0">
                <Phone className="h-3.5 w-3.5 text-red-400" />
              </div>
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Replacing</p>
                <p className="font-mono text-sm font-semibold text-white">{oldNumber}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <Phone className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">
                {isChange ? "New Number" : "Selected Number"}
              </p>
              <p className="font-mono text-sm font-semibold text-white">{number}</p>
              <p className="text-[11px] text-white/40 capitalize mt-0.5">{numberType}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          {isChange ? (
            <div className="flex items-center justify-between px-1">
              <span className="text-white/50">Number change fee</span>
              <span className="font-bold text-amber-400">R100 once-off</span>
            </div>
          ) : (
            <div className="flex items-center justify-between px-1">
              <span className="text-white/50">Subscription</span>
              <span className="font-bold text-white">R59/month</span>
            </div>
          )}
          <div className="flex items-center justify-between px-1">
            <span className="text-white/50">Call rate</span>
            <span className="font-semibold text-white">0.89 coins/min</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 py-3 rounded-2xl glass border border-white/10 text-white/60 text-sm font-semibold hover:text-white hover:border-white/20 transition-all active:scale-95 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              "flex-1 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2",
              isChange
                ? "bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30"
                : "bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30"
            )}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isChange ? (
              "Pay R100"
            ) : (
              "Confirm"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BuyNumberProps {
  mode?: "buy" | "change";
  oldNumberId?: string;
  oldNumber?: string;
}

export default function BuyNumber({ mode = "buy", oldNumberId, oldNumber }: BuyNumberProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [countryCode, setCountryCode] = useState("ZA");
  const [locality, setLocality] = useState("");
  const [numberType, setNumberType] = useState<"local" | "mobile">("local");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<{ phone_number: string; number_type: string } | null>(null);

  const isChange = mode === "change";

  const {
    data: searchData,
    isLoading: searching,
    error: searchError,
    refetch,
  } = useSearchNumbers(
    { country_code: countryCode, number_type: numberType, locality: locality || undefined },
    { query: { enabled: false, queryKey: getSearchNumbersQueryKey({ country_code: countryCode, number_type: numberType, locality: locality || undefined }) } }
  );

  const { mutateAsync: buyNumber, isPending: buying } = useBuyNumber();
  const { mutateAsync: changeNumber, isPending: changing } = useChangeNumber();

  const isPending = buying || changing;

  const handleSearch = async () => {
    setHasSearched(true);
    refetch();
  };

  const handleConfirm = async () => {
    if (!selectedNumber) return;

    try {
      if (isChange && oldNumberId) {
        const res = await changeNumber({
          data: { oldNumberId, newPhoneNumber: selectedNumber.phone_number },
        });
        if (res && (res as any).paymentUrl && (res as any).formFields) {
          const pfData = res as any;
          const form = document.createElement("form");
          form.method = "POST";
          form.action = pfData.paymentUrl;
          form.style.display = "none";
          Object.entries(pfData.formFields as Record<string, string>).forEach(([k, v]) => {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = k;
            input.value = v;
            form.appendChild(input);
          });
          document.body.appendChild(form);
          form.submit();
        } else {
          toast({ title: "Change initiated", description: "Check your profile for the updated number." });
          setLocation("/profile");
        }
      } else {
        await buyNumber({ data: { phone_number: selectedNumber.phone_number } });
        toast({ title: "Number purchased!", description: `${selectedNumber.phone_number} is now yours.` });
        setLocation("/profile");
      }
    } catch (err: any) {
      const msg = err?.message ?? "Something went wrong. Please try again.";
      toast({ title: isChange ? "Change failed" : "Purchase failed", description: msg, variant: "destructive" });
      setSelectedNumber(null);
    }
  };

  const numbers = searchData?.numbers ?? [];
  const total = searchData?.total ?? 0;

  return (
    <>
      {selectedNumber && (
        <ConfirmModal
          number={selectedNumber.phone_number}
          numberType={selectedNumber.number_type}
          isChange={isChange}
          oldNumber={oldNumber}
          onConfirm={handleConfirm}
          onCancel={() => setSelectedNumber(null)}
          isPending={isPending}
        />
      )}

      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-400 pb-2">
        {/* Header */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => setLocation("/profile")}
            className="w-9 h-9 rounded-full glass border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors active:scale-90"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">
              {isChange ? "Change Number" : "Buy Number"}
            </h1>
            {isChange && oldNumber && (
              <p className="text-xs text-white/40 mt-0.5">Replacing {oldNumber}</p>
            )}
          </div>
        </div>

        {isChange && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>A once-off R100 fee applies to change your number.</span>
          </div>
        )}

        {/* Search Filters */}
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
          {/* Country */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-white/40 uppercase tracking-wider font-semibold flex items-center gap-1.5">
              <Globe className="h-3 w-3" /> Country
            </label>
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl glass border border-white/10 bg-transparent text-white text-sm outline-none focus:border-primary/40 transition-colors appearance-none cursor-pointer"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code} className="bg-zinc-900">
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          {/* Locality */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-white/40 uppercase tracking-wider font-semibold flex items-center gap-1.5">
              <MapPin className="h-3 w-3" /> Area / City (optional)
            </label>
            <input
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
              placeholder="e.g. Cape Town, Johannesburg…"
              className="w-full px-3.5 py-2.5 rounded-xl glass border border-white/10 bg-transparent text-white placeholder:text-white/25 text-sm outline-none focus:border-primary/40 transition-colors"
            />
          </div>

          {/* Number type */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">
              Number Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["local", "mobile"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setNumberType(type)}
                  className={cn(
                    "py-2.5 rounded-xl text-sm font-semibold transition-all border active:scale-95",
                    numberType === type
                      ? "bg-primary/18 border-primary/30 text-primary"
                      : "glass border-white/10 text-white/50 hover:text-white hover:border-white/20"
                  )}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSearch}
            disabled={searching}
            className="w-full py-3 rounded-xl bg-primary/18 border border-primary/28 text-primary text-sm font-semibold hover:bg-primary/28 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Search className="h-4 w-4" />
                Search Numbers
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {searching && (
          <div className="space-y-2.5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl glass animate-pulse" />
            ))}
          </div>
        )}

        {!searching && hasSearched && searchError && (
          <div className="flex items-center gap-3 px-4 py-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Unable to fetch numbers</p>
              <p className="text-xs mt-0.5 text-red-400/70">Please try again or change your search.</p>
            </div>
          </div>
        )}

        {!searching && hasSearched && !searchError && numbers.length === 0 && (
          <div className="py-10 text-center glass rounded-2xl border border-white/10">
            <Phone className="h-10 w-10 text-white/15 mx-auto mb-3" />
            <p className="text-sm font-semibold text-white/50">No numbers available</p>
            <p className="text-xs text-white/30 mt-1">Try a different area or country</p>
          </div>
        )}

        {!searching && numbers.length > 0 && (
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-white/40" />
                <p className="text-sm font-semibold text-white">Available Numbers</p>
              </div>
              <span className="text-[11px] text-white/30">{total} found</span>
            </div>

            <div className="divide-y divide-white/8 max-h-[360px] overflow-y-auto">
              {numbers.map((n: AvailableNumber) => (
                <div
                  key={n.phone_number}
                  className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <Phone className="h-3.5 w-3.5 text-white/40" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-mono text-sm font-semibold text-white">{n.phone_number}</p>
                        {n.is_premium && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[9px] font-bold">
                            <Star className="h-2.5 w-2.5" /> Premium
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/35 capitalize mt-0.5">
                        {n.number_type}{n.region ? ` · ${n.region}` : ""}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedNumber({ phone_number: n.phone_number, number_type: n.number_type })}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border active:scale-95",
                      isChange
                        ? "bg-amber-500/15 border-amber-500/25 text-amber-400 hover:bg-amber-500/25"
                        : "bg-primary/15 border-primary/25 text-primary hover:bg-primary/25"
                    )}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Select
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
