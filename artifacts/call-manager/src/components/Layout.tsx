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

export const NAV_H = 72;

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div
      className="bg-background flex flex-col"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
          alt=""
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-background/85 backdrop-blur-[80px]" />
      </div>

      <main
        className="relative z-10 flex-1 overflow-y-auto"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="max-w-lg mx-auto px-4 w-full py-4">
          {children}
        </div>
      </main>

      {/* Liquid Glass bottom nav */}
      <nav
        className="relative z-30 shrink-0 max-w-lg w-full mx-auto px-3"
        style={{
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 14px)",
          paddingTop: "10px",
        }}
      >
        <div
          className="relative rounded-[30px] flex items-center justify-around px-2 py-2 overflow-hidden"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.055) 100%)",
            backdropFilter: "blur(52px) saturate(200%) brightness(1.08)",
            WebkitBackdropFilter: "blur(52px) saturate(200%) brightness(1.08)",
            border: "1px solid rgba(255,255,255,0.18)",
            boxShadow: [
              "inset 0 1.5px 0 rgba(255,255,255,0.28)",
              "inset 0 -1px 0 rgba(0,0,0,0.14)",
              "inset 1px 0 0 rgba(255,255,255,0.07)",
              "inset -1px 0 0 rgba(255,255,255,0.07)",
              "0 8px 40px rgba(0,0,0,0.45)",
              "0 2px 12px rgba(0,0,0,0.25)",
            ].join(", "),
          }}
        >
          {/* Inner top-gloss sheen */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[42%] rounded-t-[30px]"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 100%)",
            }}
          />

          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? location === "/dashboard"
                : location.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href} className="flex-1">
                <div
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-1.5 rounded-[22px] transition-all duration-200 cursor-pointer select-none",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground/70"
                  )}
                >
                  <div
                    className={cn(
                      "w-10 h-8 rounded-[16px] flex items-center justify-center transition-all duration-200",
                    )}
                    style={
                      isActive
                        ? {
                            background:
                              "linear-gradient(180deg, rgba(59,130,246,0.28) 0%, rgba(59,130,246,0.14) 100%)",
                            boxShadow: [
                              "inset 0 1px 0 rgba(255,255,255,0.22)",
                              "0 0 18px -4px rgba(59,130,246,0.55)",
                            ].join(", "),
                            border: "1px solid rgba(59,130,246,0.25)",
                          }
                        : {}
                    }
                  >
                    <item.icon className="h-[15px] w-[15px]" />
                  </div>
                  <span
                    className={cn(
                      "text-[9px] font-semibold tracking-wide leading-none",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
