import { useEffect, useRef } from "react";
import type { PayFastPaymentData } from "@workspace/api-client-react";
import { Spinner } from "@/components/ui/spinner";

interface PayfastFormProps {
  data: PayFastPaymentData;
  autoSubmit?: boolean;
}

export function PayfastForm({ data, autoSubmit = true }: PayfastFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (autoSubmit && formRef.current) {
      // Small delay to let user see the transition
      const timer = setTimeout(() => {
        formRef.current?.submit();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [autoSubmit, data]);

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center glass rounded-2xl">
      <Spinner className="h-12 w-12 text-primary mb-4" />
      <h3 className="text-xl font-semibold text-white mb-2">Redirecting to PayFast...</h3>
      <p className="text-white/60 text-sm mb-6">
        Please wait while we transfer you to our secure payment provider.
      </p>
      
      <form ref={formRef} action={data.paymentUrl} method="POST">
        {Object.entries(data.formFields as Record<string, string>).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        {!autoSubmit && (
          <button 
            type="submit" 
            className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors"
          >
            Click here if not redirected
          </button>
        )}
      </form>
    </div>
  );
}
