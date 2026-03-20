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
    <div
      className="flex flex-col bg-background"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
          alt=""
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-background/85 backdrop-blur-[80px]" />
      </div>

      {/* Scrollable Content — sits above the fixed navbar */}
      <main
        className="relative z-10 flex-1 overflow-y-auto"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="max-w-lg mx-auto px-4 pt-5">
          {children}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav
        className="fixed bottom-0 inset-x-0 z-30"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)" }}
      >
        <div className="max-w-lg mx-auto px-5 pb-2">
          <div className="glass rounded-full border border-white/10 shadow-2xl shadow-black/50 flex items-center justify-around px-2 py-2">
            {navItems.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? location === "/dashboard"
                  : location.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "flex flex-col items-center gap-0.5 px-4 py-2 rounded-full transition-all duration-200 cursor-pointer select-none min-w-[64px]",
                      isActive ? "text-primary" : "text-white/40 hover:text-white/70"
                    )}
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200",
                        isActive
                          ? "bg-primary/20 shadow-[0_0_18px_-4px_hsl(var(--primary)/0.6)]"
                          : "hover:bg-white/5"
                      )}
                    >
                      <item.icon className="h-[18px] w-[18px]" />
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-semibold tracking-wide leading-none",
                        isActive ? "text-primary" : "text-white/40"
                      )}
                    >
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
