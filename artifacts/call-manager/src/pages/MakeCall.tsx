import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneCall, AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  recipientNumber: z.string().min(8, "Phone number is too short").max(20, "Phone number is too long"),
  callerNumber: z.string().optional(),
  notes: z.string().max(200, "Notes too long").optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function MakeCall() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const { mutateAsync: initiateCall, isPending } = useMakeCall();
  
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      recipientNumber: "",
      callerNumber: "",
      notes: ""
    }
  });

  const onSubmit = async (data: FormData) => {
    try {
      await initiateCall({ data });
      toast({
        title: "Call Initiated",
        description: "Your call is currently dialing...",
      });
      setLocation("/calls");
    } catch (error: any) {
      toast({
        title: "Call Failed",
        description: error.message || "Failed to initiate call. Check your balance.",
        variant: "destructive"
      });
    }
  };

  const hasBalance = (user?.creditBalance || 0) > 0;

  return (
    <div className="max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_-5px_rgba(var(--primary),0.4)]">
          <PhoneCall className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-display font-bold">New Call</h1>
        <p className="text-white/60 mt-2">Dial a number to connect via secure SIP routing.</p>
      </div>

      <Card className="shadow-2xl border-white/10 relative overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />
        
        <CardContent className="p-8 relative z-10">
          {!hasBalance ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Insufficient Credits</h3>
              <p className="text-white/60 mb-6">You need to top up your account or subscribe to make calls.</p>
              <Button onClick={() => setLocation("/credits")} variant="outline" size="lg">
                Top Up Now
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Recipient Number <span className="text-red-400">*</span></label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-mono">+</span>
                  <Input 
                    {...register("recipientNumber")}
                    placeholder="27821234567"
                    className="pl-8 text-lg font-mono tracking-wider h-14"
                  />
                </div>
                {errors.recipientNumber && <p className="text-red-400 text-xs mt-1">{errors.recipientNumber.message}</p>}
                <p className="text-xs text-white/40">Enter number in E.164 format with country code (no + needed).</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Caller ID (Optional)</label>
                <Input 
                  {...register("callerNumber")}
                  placeholder="Your verified number"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Call Notes (Optional)</label>
                <Input 
                  {...register("notes")}
                  placeholder="e.g., Follow up on Q3 proposal"
                />
              </div>

              <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                <div className="text-sm text-white/60">
                  Estimated cost: <strong className="text-white">R0.50 / min</strong>
                </div>
                <Button type="submit" size="lg" disabled={isPending} className="min-w-[140px]">
                  {isPending ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <PhoneCall className="mr-2 h-5 w-5" />
                      Dial Now
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
