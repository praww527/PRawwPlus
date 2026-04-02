import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2 
      className={cn("h-4 w-4 animate-spin text-primary", className)} 
      {...props} 
    />
  );
}

export function LoadingScreen() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background/50 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-10 w-10" />
        <p className="text-white/60 font-medium animate-pulse">Loading system...</p>
      </div>
    </div>
  );
}
