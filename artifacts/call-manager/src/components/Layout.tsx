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
      {/* Frosted-glass background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
          alt=""
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-background/80 backdrop-blur-[60px]" />
      </div>

      <main
        className="relative z-10 flex-1 overflow-y-auto"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="max-w-lg mx-auto px-4 w-full py-4">
          {children}
        </div>
      </main>

      {/* Flat frosted-glass bottom nav — iOS style */}
      <nav
        className="relative z-30 shrink-0 w-full"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          backdropFilter: "blur(40px) saturate(180%)",
          WebkitBackdropFilter: "blur(40px) saturate(180%)",
          background: "var(--nav-surface)",
          borderTop: "0.5px solid var(--nav-border-top)",
        }}
      >
        <div className="max-w-lg mx-auto flex items-center justify-around px-2 py-2">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? location === "/dashboard"
                : location.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href} className="flex-1">
                <div
                  className={cn(
                    "flex flex-col items-center gap-1 py-1 cursor-pointer select-none",
                    isActive ? "nav-icon-active" : "nav-icon-inactive"
                  )}
                >
                  <item.icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="text-[10px] font-medium tracking-wide leading-none">
                    {item.label}
                  </span>
                  {/* Active dot indicator */}
                  <span
                    className="w-1 h-1 rounded-full"
                    style={{ opacity: isActive ? 1 : 0, background: "currentColor" }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
