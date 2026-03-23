import { Link, useLocation } from "wouter";
import { Grid3x3, Clock, Users, User } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_BAR_H = 80; // total bottom reservation (floating pill + gap)

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
      {/* Page content */}
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
          className="nav-pill"
          style={{
            display: "flex",
            alignItems: "center",
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 6,
            paddingBottom: 6,
            gap: 2,
            pointerEvents: "all",
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
                  padding: "6px 18px",
                  borderRadius: 28,
                  cursor: "pointer",
                  userSelect: "none",
                  background: isActive ? "rgba(26, 140, 255, 0.13)" : "transparent",
                  transition: "background 0.18s",
                  minWidth: 62,
                }}>
                  <item.icon style={{
                    width: 22,
                    height: 22,
                    color: isActive ? "#1a8cff" : "var(--nav-inactive)",
                    strokeWidth: isActive ? 2.2 : 1.7,
                    transition: "color 0.18s, stroke-width 0.18s",
                  }} />
                  <span style={{
                    fontSize: 10,
                    fontWeight: isActive ? 650 : 500,
                    color: isActive ? "#1a8cff" : "var(--nav-inactive)",
                    lineHeight: 1,
                    letterSpacing: "0.01em",
                    transition: "color 0.18s",
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
