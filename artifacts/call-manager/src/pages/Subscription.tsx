import { useState } from "react";
import { useGetMe, useInitiateSubscription } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Star, Zap } from "lucide-react";
import { PayfastForm } from "@/components/PayfastForm";

export default function Subscription() {
  const { data: user } = useGetMe();
  const { mutateAsync: subscribe, isPending } = useInitiateSubscription();
  const [payfastData, setPayfastData] = useState<any>(null);

  const handleSubscribe = async () => {
    try {
      const data = await subscribe();
      setPayfastData(data);
    } catch (error) {
      console.error("Subscription failed", error);
    }
  };

  if (payfastData) {
    return <PayfastForm data={payfastData} />;
  }

  const isActive = user?.subscriptionStatus === 'active';

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass border-primary/30 text-primary text-sm font-medium mb-4">
          <Star className="h-4 w-4 fill-primary" />
          Pro Plan
        </div>
        <h1 className="text-4xl font-display font-bold mb-4">Manage Your Subscription</h1>
        <p className="text-white/60 text-lg">
          Get continuous access and monthly credits to power your communications.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Current Status */}
        <Card className="border-white/10">
          <CardHeader>
            <CardTitle>Current Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
              <div>
                <p className="text-sm text-white/60 mb-1">Plan</p>
                <p className="font-semibold text-lg">{isActive ? 'Pro Monthly' : 'Free Tier'}</p>
              </div>
              <Badge variant={isActive ? 'success' : 'outline'} className="text-sm px-3 py-1">
                {isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>

            {isActive && user?.nextPaymentDate && (
              <div>
                <p className="text-sm text-white/60 mb-1">Next Billing Date</p>
                <p className="font-medium">{new Date(user.nextPaymentDate).toLocaleDateString()}</p>
              </div>
            )}

            {!isActive && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                You are currently on the free tier. Subscribe to get R20 monthly call credits and access to premium routing.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pricing Card */}
        <Card className="relative overflow-hidden border-primary/30 shadow-[0_0_40px_-10px_rgba(var(--primary),0.3)]">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Zap className="w-32 h-32 text-primary" />
          </div>
          
          <CardContent className="p-8 relative z-10 flex flex-col h-full">
            <div className="mb-6">
              <h3 className="text-2xl font-bold mb-2">Pro Monthly</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-display font-bold text-primary">R100</span>
                <span className="text-white/50">/month</span>
              </div>
            </div>

            <ul className="space-y-4 flex-1 mb-8">
              {[
                "R20 Call Credit included every month",
                "Premium Telnyx SIP Voice Routing",
                "Detailed call history and analytics",
                "Priority email support",
                "Cancel anytime"
              ].map((feature, i) => (
                <li key={i} className="flex items-start gap-3 text-white/80">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <Button 
              size="lg" 
              className="w-full h-14 text-lg" 
              onClick={handleSubscribe}
              disabled={isPending || isActive}
            >
              {isPending ? "Connecting..." : isActive ? "Currently Subscribed" : "Subscribe via PayFast"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
