import { Link, useLocation } from "wouter";
import { Phone, History, Users, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/dashboard", label: "Dial Pad", icon: Phone },
  { href: "/calls", label: "Calls", icon: History },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/profile", label: "Profile", icon: User },
];

export const NAV_H = 68;

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div className="bg-background" style={{ height: "100dvh", overflow: "hidden" }}>

      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
          alt=""
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-background/85 backdrop-blur-[80px]" />
      </div>

      <main
        className="relative z-10 overflow-y-auto"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px) + 8px)`,
          height: "100dvh",
        }}
      >
        <div className="max-w-lg mx-auto px-4 w-full">
          {children}
        </div>
      </main>

      <nav
        className="fixed bottom-0 inset-x-0 z-30"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)" }}
      >
        <div className="max-w-lg mx-auto px-4 pb-1">
          <div className="glass rounded-full border border-white/10 shadow-2xl shadow-black/50 flex items-center justify-around px-1 py-1.5">
            {navItems.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? location === "/dashboard"
                  : location.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "flex flex-col items-center gap-0.5 px-3 py-1 rounded-full transition-all duration-200 cursor-pointer select-none min-w-[56px]",
                      isActive ? "text-primary" : "text-white/40 hover:text-white/70"
                    )}
                  >
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200",
                        isActive
                          ? "bg-primary/20 shadow-[0_0_14px_-4px_hsl(var(--primary)/0.55)]"
                          : "hover:bg-white/5"
                      )}
                    >
                      <item.icon className="h-[15px] w-[15px]" />
                    </div>
                    <span
                      className={cn(
                        "text-[9px] font-semibold tracking-wide leading-none",
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
