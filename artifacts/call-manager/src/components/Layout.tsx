import { Link, useLocation } from "wouter";
import { Grid3x3, Clock, Users, User } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_BAR_H = 80;

const navItems = [
  { href: "/dashboard", label: "Keypad",   icon: Grid3x3 },
  { href: "/calls",     label: "Calls",    icon: Clock },
  { href: "/contacts",  label: "Contacts", icon: Users },
  { href: "/profile",   label: "Profile",  icon: User },
];

export const NAV_H = NAV_BAR_H;

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100dvh",
      overflow: "hidden",
      background: "var(--surface-0)",
    }}>
      <main style={{
        flex: 1,
        overflowY: "auto",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: `calc(${NAV_BAR_H}px + env(safe-area-inset-bottom, 0px))`,
      }}>
        <div style={{ maxWidth: 512, margin: "0 auto", padding: "20px 16px", width: "100%" }}>
          {children}
        </div>
      </main>

      {/* Floating pill nav bar */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        paddingBottom: `calc(14px + env(safe-area-inset-bottom, 0px))`,
        pointerEvents: "none",
      }}>
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 6,
            paddingBottom: 6,
            gap: 2,
            pointerEvents: "all",
            background: "rgba(12, 12, 20, 0.72)",
            border: "1px solid rgba(255, 255, 255, 0.10)",
            borderRadius: 36,
            backdropFilter: "blur(32px) saturate(1.6)",
            WebkitBackdropFilter: "blur(32px) saturate(1.6)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.07) inset",
          }}
        >
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? location === "/dashboard"
                : location.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
                <div style={{
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
                  position: "relative",
                  /* Glass capsule for active — no colour fill, just frosted glass */
                  background: isActive
                    ? "rgba(255, 255, 255, 0.09)"
                    : "transparent",
                  border: isActive
                    ? "1px solid rgba(255, 255, 255, 0.15)"
                    : "1px solid transparent",
                  boxShadow: isActive
                    ? "0 1px 0 rgba(255,255,255,0.10) inset, 0 2px 12px rgba(0,0,0,0.25)"
                    : "none",
                  transition: "background 0.22s, border-color 0.22s, box-shadow 0.22s",
                }}>
                  <item.icon style={{
                    width: 21,
                    height: 21,
                    /* Active = bright white; inactive = muted */
                    color: isActive
                      ? "rgba(255, 255, 255, 0.95)"
                      : "rgba(255, 255, 255, 0.32)",
                    strokeWidth: isActive ? 2.1 : 1.6,
                    transition: "color 0.22s, stroke-width 0.22s",
                    filter: isActive
                      ? "drop-shadow(0 0 6px rgba(255,255,255,0.30))"
                      : "none",
                  }} />
                  <span style={{
                    fontSize: 10,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive
                      ? "rgba(255, 255, 255, 0.90)"
                      : "rgba(255, 255, 255, 0.30)",
                    lineHeight: 1,
                    letterSpacing: "0.01em",
                    transition: "color 0.22s",
                  }}>
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
