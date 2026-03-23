import { Link, useLocation } from "wouter";
import { Phone, History, Users, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/dashboard", label: "Dial Pad", icon: Phone },
  { href: "/calls",     label: "Calls",    icon: History },
  { href: "/contacts",  label: "Contacts", icon: Users },
  { href: "/profile",   label: "Profile",  icon: User },
];

/* Height of the nav area (pill + spacing + safe area) */
export const NAV_H = 80;

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--surface-0)",
      }}
    >
      {/* Scrollable page content */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: "env(safe-area-inset-top, 0px)",
          /* bottom padding = nav pill area so content isn't hidden behind it */
          paddingBottom: `${NAV_H + 8}px`,
        }}
      >
        <div className="max-w-lg mx-auto px-4 w-full py-5">
          {children}
        </div>
      </main>

      {/* Floating pill bottom nav */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          display: "flex",
          justifyContent: "center",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)",
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 8,
          background: "var(--surface-0)",
        }}
      >
        <nav
          className="nav-pill"
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            maxWidth: 420,
            padding: "6px 8px",
          }}
        >
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? location === "/dashboard"
                : location.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href} style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    padding: "7px 4px",
                    borderRadius: 20,
                    background: isActive ? "rgba(10,132,255,0.14)" : "transparent",
                    cursor: "pointer",
                    userSelect: "none",
                    transition: "background 0.15s",
                  }}
                >
                  <item.icon
                    style={{
                      width: 22,
                      height: 22,
                      color: isActive ? "var(--nav-active)" : "var(--nav-inactive)",
                      strokeWidth: isActive ? 2.3 : 1.9,
                      transition: "color 0.15s",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.01em",
                      color: isActive ? "var(--nav-active)" : "var(--nav-inactive)",
                      lineHeight: 1,
                      transition: "color 0.15s",
                    }}
                  >
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
