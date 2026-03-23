import { Link, useLocation } from "wouter";
import { Q2, Clock, Users, User } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

export const NAV_H = 80;

const navItems = [
  { href: "/dashboard", label: "Keypad",  icon: Q2 },
  { href: "/calls",     label: "Calls",   icon: Clock },
  { href: "/contacts",  label: "Contacts",icon: Users },
  { href: "/profile",   label: "Profile", icon: User },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const isActive = (href: string) =>
    href === "/dashboard" ? location === "/dashboard" : location.startsWith(href);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100dvh",
      overflow: "hidden",
      background: "var(--surface-0)",
    }}>
      {/* Page content */}
      <main style={{
        flex: 1,
        overflowY: "auto",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "calc(94px + env(safe-area-inset-bottom, 0px))",
      }}>
        <div style={{ maxWidth: 512, margin: "0 auto", padding: "20px 16px", width: "100%" }}>
          {children}
        </div>
      </main>

      {/* ── Floating pill nav bar ─────────────────────────── */}
      <div style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        zIndex: 40,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
        pointerEvents: "none",
      }}>
        <nav style={{
          display: "flex",
          alignItems: "center",
          padding: "6px",
          gap: 2,
          pointerEvents: "all",
          background: "var(--nav-pill)",
          border: "1px solid var(--nav-pill-border)",
          borderRadius: 36,
          backdropFilter: "blur(32px) saturate(1.5)",
          WebkitBackdropFilter: "blur(32px) saturate(1.5)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.06) inset",
        }}>
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
                <div style={{
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  gap: 4, padding: "6px 20px",
                  borderRadius: 28, cursor: "pointer",
                  userSelect: "none", minWidth: 64,
                  background: active ? "rgba(255,255,255,0.09)" : "transparent",
                  border: active ? "1px solid rgba(255,255,255,0.15)" : "1px solid transparent",
                  boxShadow: active
                    ? "0 1px 0 rgba(255,255,255,0.10) inset, 0 2px 12px rgba(0,0,0,0.22)"
                    : "none",
                  transition: "background 0.22s, border-color 0.22s, box-shadow 0.22s",
                }}>
                  <item.icon style={{
                    width: 21, height: 21,
                    color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                    strokeWidth: active ? 2.1 : 1.6,
                    transition: "color 0.22s",
                    filter: active ? "drop-shadow(0 0 5px rgba(255,255,255,0.22))" : "none",
                  }} />
                  <span style={{
                    fontSize: 10,
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--nav-active)" : "var(--nav-inactive)",
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
