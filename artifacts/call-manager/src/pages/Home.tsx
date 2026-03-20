import { useLocation } from "wouter";
import {
  Phone, Zap, CreditCard, Globe, Shield, Star,
  ArrowRight, CheckCircle, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Phone,
    title: "Get your own number instantly",
    description: "A dedicated South African business number assigned to you in minutes.",
  },
  {
    icon: Zap,
    title: "Cheap calls from R0.90/min",
    description: "No monthly contracts. Only pay for the minutes you actually use.",
  },
  {
    icon: CreditCard,
    title: "Top up anytime with PayFast",
    description: "Instant credit top-ups via PayFast — debit card, EFT, or SnapScan.",
  },
  {
    icon: Globe,
    title: "Works on phone and browser",
    description: "Make calls from your desktop browser or any smartphone. No extra app needed.",
  },
];

const trustItems = [
  { icon: Shield, text: "Secure payments with PayFast" },
  { icon: Globe, text: "Powered by global telecom infrastructure" },
  { icon: CheckCircle, text: "No contracts, cancel anytime" },
];

const testimonials = [
  {
    name: "Sipho M.",
    role: "Small Business Owner, Johannesburg",
    text: "My call costs dropped by 60%. I top up with PayFast and I'm done. No contracts, no hassle.",
    rating: 5,
  },
  {
    name: "Lerato K.",
    role: "Freelancer, Cape Town",
    text: "I needed a business number fast. Had one in 5 minutes. Calls are crystal clear.",
    rating: 5,
  },
  {
    name: "Thabo N.",
    role: "Startup Founder, Durban",
    text: "Finally a calling solution built for South Africa. PayFast integration is seamless.",
    rating: 5,
  },
];

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/60 via-background to-indigo-950/40" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-primary/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[400px] bg-indigo-600/6 rounded-full blur-[100px]" />
      </div>

      {/* Nav */}
      <header className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/30">
            <Phone className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-display font-bold text-white">CallManager</span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            className="text-white/70 hover:text-white hover:bg-white/5"
            onClick={() => setLocation("/login")}
          >
            Login
          </Button>
          <Button
            onClick={() => setLocation("/signup")}
            className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
          >
            Get Started
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-20 pb-32 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-primary/20 bg-primary/10 text-primary text-sm font-medium mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Now available across South Africa
        </div>

        <h1 className="text-5xl md:text-7xl font-display font-bold text-white leading-[1.05] tracking-tight mb-6 max-w-4xl mx-auto">
          Call Any Number for Less –{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-blue-400 to-indigo-400">
            No Contracts
          </span>
        </h1>

        <p className="text-xl md:text-2xl text-white/55 max-w-2xl mx-auto mb-10 leading-relaxed">
          Get your own business number, make calls from your phone or browser,
          and only pay for what you use.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button
            size="lg"
            className="h-14 px-8 text-lg bg-primary hover:bg-primary/90 shadow-xl shadow-primary/25 group"
            onClick={() => setLocation("/signup")}
          >
            Get Started Free
            <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 px-8 text-lg border-white/15 text-white/80 hover:bg-white/5 hover:text-white"
            onClick={() => {
              document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            See Pricing
          </Button>
        </div>

        <div className="flex flex-wrap justify-center gap-6 mt-12 text-sm text-white/40">
          {["No credit card required", "Setup in under 5 minutes", "Cancel anytime"].map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-green-400" />
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* Value Props */}
      <section className="relative z-10 px-6 md:px-12 py-24 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-white mb-4">
            Everything your business needs to call
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            No jargon, no hidden fees. Just clear, affordable calling for South African businesses.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((f) => (
            <div
              key={f.title}
              className="glass rounded-2xl p-6 border border-white/8 hover:border-primary/25 hover:bg-white/8 transition-all duration-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                <f.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-white font-semibold text-lg mb-2 leading-snug">{f.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative z-10 px-6 md:px-12 py-24 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-white mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            No surprises. Pay for your number, then only for calls you make.
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">
          {/* Monthly Plan */}
          <div className="glass rounded-3xl p-8 border border-primary/25 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-[60px] pointer-events-none" />
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/15 text-primary text-xs font-semibold mb-6">
                MOST POPULAR
              </div>
              <h3 className="text-2xl font-display font-bold text-white mb-2">Business Number</h3>
              <p className="text-white/50 text-sm mb-6">Your own dedicated South African number</p>
              <div className="flex items-end gap-1 mb-2">
                <span className="text-5xl font-display font-bold text-white">R59</span>
                <span className="text-white/40 mb-2">/month</span>
              </div>
              <p className="text-white/40 text-sm mb-8">Includes number rental + calling access</p>

              <ul className="space-y-3 mb-8">
                {[
                  "Dedicated SA business number",
                  "Browser & mobile calling",
                  "Call history & logs",
                  "PayFast top-ups",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-white/70 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>

              <Button
                className="w-full h-12 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
                onClick={() => setLocation("/signup")}
              >
                Get Started
              </Button>
            </div>
          </div>

          {/* Per-minute pricing */}
          <div className="space-y-5">
            <div className="glass rounded-2xl p-6 border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-white font-semibold">Call Rate</h4>
                <span className="text-2xl font-display font-bold text-primary">R0.90<span className="text-white/40 text-base font-normal">/min</span></span>
              </div>
              <p className="text-white/50 text-sm">Local & national calls. Only billed for connected time.</p>
            </div>

            <div className="glass rounded-2xl p-6 border border-white/10">
              <h4 className="text-white font-semibold mb-4">Example calculation</h4>
              <div className="space-y-3">
                {[
                  { label: "Top up R100", result: "≈ 111 minutes of calls" },
                  { label: "Top up R200", result: "≈ 222 minutes of calls" },
                  { label: "Top up R500", result: "≈ 555 minutes of calls" },
                ].map((ex) => (
                  <div key={ex.label} className="flex items-center justify-between text-sm">
                    <span className="text-white/60">{ex.label}</span>
                    <span className="flex items-center gap-1.5 text-green-400 font-medium">
                      <ChevronRight className="h-3.5 w-3.5" />
                      {ex.result}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass rounded-2xl p-6 border border-white/10 bg-green-500/5 border-green-500/15">
              <p className="text-green-400 text-sm font-medium">
                💡 <strong>R100 = ~110 minutes</strong> of calls — enough for a full business day of conversations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="relative z-10 px-6 md:px-12 py-24 max-w-7xl mx-auto">
        <div className="flex flex-wrap justify-center gap-8 mb-20">
          {trustItems.map((item) => (
            <div key={item.text} className="flex items-center gap-3 glass rounded-2xl px-6 py-4 border border-white/8">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <item.icon className="h-4.5 w-4.5 text-primary" />
              </div>
              <span className="text-white/70 font-medium text-sm">{item.text}</span>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-display font-bold text-white mb-3">
            Trusted by South African businesses
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {testimonials.map((t) => (
            <div key={t.name} className="glass rounded-2xl p-6 border border-white/8">
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-white/70 text-sm leading-relaxed mb-4">"{t.text}"</p>
              <div>
                <p className="text-white font-semibold text-sm">{t.name}</p>
                <p className="text-white/40 text-xs">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 md:px-12 py-24 max-w-7xl mx-auto">
        <div className="glass rounded-3xl p-12 border border-primary/20 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/8 via-transparent to-indigo-600/8 pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-white mb-4">
              Ready to cut your call costs?
            </h2>
            <p className="text-white/55 text-lg mb-8 max-w-lg mx-auto">
              Join hundreds of South African businesses saving money on every call.
            </p>
            <Button
              size="lg"
              className="h-14 px-10 text-lg bg-primary hover:bg-primary/90 shadow-xl shadow-primary/25 group"
              onClick={() => setLocation("/signup")}
            >
              Create Free Account
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 md:px-12 py-10 border-t border-white/8 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
            <Phone className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-white/50 text-sm font-medium">CallManager</span>
        </div>
        <p className="text-white/30 text-xs">© 2025 CallManager. All rights reserved.</p>
      </footer>
    </div>
  );
}
