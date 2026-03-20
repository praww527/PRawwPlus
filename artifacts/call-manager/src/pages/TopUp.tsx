import { useState } from "react";
import { useGetMe, useTopUpCredits } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, cn } from "@/lib/utils";
import { Wallet, Check, AlertCircle } from "lucide-react";
import { PayfastForm } from "@/components/PayfastForm";

const TOPUP_AMOUNTS = [50, 100, 200, 500];

export default function TopUp() {
  const { data: user } = useGetMe();
  const { mutateAsync: topUp, isPending } = useTopUpCredits();
  const [selectedAmount, setSelectedAmount] = useState<number>(100);
  const [payfastData, setPayfastData] = useState<any>(null);

  const handleCheckout = async () => {
    try {
      const data = await topUp({ data: { amount: selectedAmount } });
      setPayfastData(data);
    } catch (error) {
      console.error("Top up failed", error);
    }
  };

  if (payfastData) {
    return <PayfastForm data={payfastData} />;
  }

  return (
    <div className="max-w-3xl mx-auto animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-primary/20 text-primary rounded-2xl border border-primary/30">
          <Wallet className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold">Top Up Credits</h1>
          <p className="text-white/60">Add funds to your account for pay-as-you-go calling.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-6">
        <div className="md:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Select Amount</CardTitle>
              <CardDescription>Choose how much credit you want to add.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {TOPUP_AMOUNTS.map(amount => (
                  <button
                    key={amount}
                    onClick={() => setSelectedAmount(amount)}
                    className={cn(
                      "p-6 rounded-xl border text-center transition-all duration-200 relative overflow-hidden",
                      selectedAmount === amount 
                        ? "bg-primary/20 border-primary shadow-[0_0_15px_-3px_rgba(var(--primary),0.5)]" 
                        : "glass hover:bg-white/10"
                    )}
                  >
                    {selectedAmount === amount && (
                      <div className="absolute top-2 right-2 text-primary">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                    <span className="text-2xl font-bold font-display">{formatCurrency(amount)}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card className="bg-black/40 border-white/5">
            <CardHeader>
              <CardTitle className="text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm text-white/70 pb-4 border-b border-white/10">
                <span>Current Balance</span>
                <span className="font-mono">{formatCurrency(user?.creditBalance || 0)}</span>
              </div>
              <div className="flex justify-between font-medium pb-4 border-b border-white/10">
                <span>Top Up Amount</span>
                <span className="text-primary font-mono">{formatCurrency(selectedAmount)}</span>
              </div>
              <div className="flex justify-between items-end pt-2">
                <span className="text-white/60 text-sm">Total Due</span>
                <span className="text-3xl font-bold font-display">{formatCurrency(selectedAmount)}</span>
              </div>

              <div className="pt-6">
                <Button 
                  className="w-full h-12 text-lg" 
                  onClick={handleCheckout}
                  disabled={isPending}
                >
                  {isPending ? "Processing..." : "Pay with PayFast"}
                </Button>
                
                <p className="text-xs text-center text-white/40 mt-4 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Secure payment via PayFast gateway
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
