import { useAuth } from "@workspace/replit-auth-web";
import { Phone, ArrowRight, ShieldCheck, Zap, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Login() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4">
      {/* Beautiful Background */}
      <div className="absolute inset-0 z-0 overflow-hidden bg-background">
        <img 
          src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
          alt="Abstract Background"
          className="w-full h-full object-cover opacity-60 mix-blend-screen"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent backdrop-blur-[60px]" />
      </div>

      <div className="relative z-10 w-full max-w-5xl grid lg:grid-cols-2 gap-12 items-center">
        
        {/* Left Side: Marketing Copy */}
        <div className="space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass border-primary/30 bg-primary/10 text-primary text-sm font-medium mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Next-Gen Call Management
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-white leading-[1.1]">
              Elevate Your <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
                Business Comms.
              </span>
            </h1>
            <p className="mt-6 text-lg text-white/60 max-w-md">
              Secure, crystal clear voice calls directly from your browser. Manage credits, track history, and scale seamlessly.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: Globe, text: "Global Telnyx SIP Routing" },
              { icon: ShieldCheck, text: "Enterprise-grade Security" },
              { icon: Zap, text: "Instant PayFast Top-ups" }
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full glass flex items-center justify-center">
                  <feature.icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-white/80 font-medium">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Login Card */}
        <div className="glass p-8 md:p-12 rounded-[2rem] shadow-2xl border-white/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none" />
          
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/30 mb-6">
              <Phone className="h-8 w-8 text-white" />
            </div>
            
            <h2 className="text-2xl font-display font-bold text-white mb-2">Welcome Back</h2>
            <p className="text-white/60 mb-8">Sign in with your Replit account to access your workspace.</p>

            <Button size="lg" className="w-full text-lg h-14 group" onClick={login}>
              Continue with Replit
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
            
            <p className="mt-6 text-xs text-white/40">
              By continuing, you agree to our Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
