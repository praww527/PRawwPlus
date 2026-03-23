import { Link, useLocation } from "wouter";
import { Q2, Clock, Users, User } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

export const NAV_H = 80;

const navItems = [
  { href: "/dashboard", label: "Keypad", icon: Q2 },
  { href: "/calls", label: "Calls", icon: Clock },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/profile", label: "Profile", icon: User },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const isActive = (href: string) =>
    href === "/dashboard"
      ? location === "/dashboard"
      : location.startsWith(href);

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
      {/* Page content */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom:
            "calc(94px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div
          style={{
            maxWidth: 512,
            margin: "0 auto",
            padding: "20px 16px",
            width: "100%",
          }}
        >
          {children}
        </div>
      </main>

      {/* ── GLASS NAVBAR (FIXED) ───────────────── */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end",
          paddingBottom:
            "calc(14px + env(safe-area-inset-bottom, 0px))",
          pointerEvents: "none",
        }}
      >
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            padding: "6px",
            gap: 2,
            pointerEvents: "all",
            borderRadius: 36,

            // ✅ REAL GLASS (like PRaww Reads)
            background: "rgba(255,255,255,0.12)",
            backdropFilter:
              "blur(28px) saturate(200%) brightness(1.08)",
            WebkitBackdropFilter:
              "blur(28px) saturate(200%) brightness(1.08)",

            border: "1px solid rgba(255,255,255,0.25)",

            boxShadow:
              "0 12px 40px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
        >
          {navItems.map((item) => {
            const active = isActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{ textDecoration: "none" }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    padding: "6px 20px",
                    borderRadius: 28,
                    cursor: "pointer",
                    userSelect: "none",
                    minWidth: 64,

                    // ✅ FIXED ACTIVE STATE (liquid, not button)
                    background: active
                      ? "rgba(255,255,255,0.28)"
                      : "transparent",

                    boxShadow: active
                      ? "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 4px rgba(0,0,0,0.08)"
                      : "none",

                    transition: "all 0.2s ease",
                  }}
                >
                  <item.icon
                    style={{
                      width: 21,
                      height: 21,
                      color: active
                        ? "#3b82f6" // blue active
                        : "rgba(255,255,255,0.5)",

                      strokeWidth: active ? 2.2 : 1.6,
                      transition: "all 0.2s ease",
                    }}
                  />

                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: active
                        ? "#3b82f6"
                        : "rgba(255,255,255,0.5)",
                      lineHeight: 1,
                      transition: "all 0.2s ease",
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