import { Link, useLocation } from "wouter";
import { Grid3x3, Clock, Users, User } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_BAR_H = 49; // standard iOS tab bar height (px)

const navItems = [
  { href: "/dashboard", label: "Keypad",   icon: Grid3x3 },
  { href: "/calls",     label: "Calls",    icon: Clock },
  { href: "/contacts",  label: "Contacts", icon: Users },
  { href: "/profile",   label: "Profile",  icon: User },
];

export const NAV_H = NAV_BAR_H; // exported for DialPad

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

      {/* Native-style tab bar */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        background: "var(--tab-bar-bg, var(--surface-1))",
        borderTop: "1px solid var(--sep)",
        display: "flex",
        alignItems: "stretch",
        height: `calc(${NAV_BAR_H}px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? location === "/dashboard"
              : location.startsWith(item.href);

          return (
            <Link key={item.href} href={item.href} style={{ flex: 1, textDecoration: "none" }}>
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                height: "100%",
                paddingTop: 6,
                cursor: "pointer",
                userSelect: "none",
              }}>
                {/* Icon wrapper — active gets a subtle circular bg for Keypad (like reference) */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 28,
                  borderRadius: 14,
                  background: isActive && item.href === "/dashboard"
                    ? "rgba(10,132,255,0.12)"
                    : "transparent",
                  transition: "background 0.15s",
                }}>
                  <item.icon style={{
                    width: 22,
                    height: 22,
                    color: isActive ? "hsl(var(--primary))" : "var(--nav-inactive)",
                    strokeWidth: isActive ? 2.2 : 1.8,
                    transition: "color 0.15s",
                  }} />
                </div>
                <span style={{
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "hsl(var(--primary))" : "var(--nav-inactive)",
                  lineHeight: 1,
                  letterSpacing: "0.005em",
                  transition: "color 0.15s",
                }}>
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
