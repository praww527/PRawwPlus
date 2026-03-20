import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PhoneOff } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 bg-background overflow-hidden">
        <img 
          src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
          alt="Background"
          className="w-full h-full object-cover opacity-30 mix-blend-screen grayscale"
        />
      </div>
      
      <div className="glass p-12 rounded-3xl text-center max-w-md w-full relative z-10 shadow-2xl border-white/10">
        <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <PhoneOff className="h-10 w-10 text-white/50" />
        </div>
        <h1 className="text-6xl font-display font-bold text-white mb-4">404</h1>
        <p className="text-xl text-white/80 mb-8">Connection Lost.</p>
        <p className="text-white/50 mb-8 text-sm">The page you are trying to reach does not exist or has been moved.</p>
        
        <Button asChild size="lg" className="w-full">
          <Link href="/">Return to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
