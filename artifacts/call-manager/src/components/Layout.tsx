import { Link, useLocation } from "wouter";
import { Phone, History, BookUser, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/dashboard", label: "Dial Pad", icon: Phone },
  { href: "/calls", label: "Call Logs", icon: History },
  { href: "/contacts", label: "Contacts", icon: BookUser },
  { href: "/profile", label: "Profile", icon: User },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
          alt=""
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-background/85 backdrop-blur-[80px]" />
      </div>

      {/* Scrollable Content */}
      <main className="relative z-10 flex-1 overflow-y-auto pb-28">
        <div className="max-w-lg mx-auto px-4 pt-6 min-h-full">
          {children}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 inset-x-0 z-30">
        <div className="max-w-lg mx-auto px-6 pb-6">
          <div className="glass rounded-full border border-white/10 shadow-2xl shadow-black/40 px-4 py-3 flex items-center justify-around">
            {navItems.map((item) => {
              const isActive = item.href === "/dashboard"
                ? location === "/dashboard"
                : location.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div className={cn(
                    "flex flex-col items-center gap-1 px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer",
                    isActive
                      ? "text-primary"
                      : "text-white/40 hover:text-white/70"
                  )}>
                    <div className={cn(
                      "relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200",
                      isActive
                        ? "bg-primary/20 shadow-[0_0_20px_-4px_hsl(var(--primary)/0.5)]"
                        : "hover:bg-white/5"
                    )}>
                      <item.icon className="h-5 w-5" />
                      {isActive && (
                        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className={cn(
                      "text-[10px] font-semibold tracking-wide transition-colors",
                      isActive ? "text-primary" : "text-white/40"
                    )}>
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
