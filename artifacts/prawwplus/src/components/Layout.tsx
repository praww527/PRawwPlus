import { Link, useLocation } from "wouter";
import { Phone, Clock, Users, Voicemail, Star } from "lucide-react";
import { VertoInit } from "@/components/VertoInit";

interface LayoutProps {
  children: React.ReactNode;
}

export const NAV_H = 64;
export const NAV_Z = 50;
export const MODAL_Z = 200;

const navItems = [
  { href: "/dashboard",  label: "Keypad",     icon: Phone },
  { href: "/calls",      label: "Recents",    icon: Clock },
  { href: "/voicemail",  label: "Voicemail",  icon: Voicemail },
  { href: "/contacts",   label: "Contacts",   icon: Users },
  { href: "/favorites",  label: "Favourites", icon: Star },
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
        background: "transparent",
      }}
    >
      <VertoInit />

      <main
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px) + 8px)`,
        }}
      >
        <div
          className="page-in"
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

      {/* Fixed glass bottom navbar — z-index 50 */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: NAV_Z,
          display: "flex",
          alignItems: "stretch",
          height: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px))`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          background: "var(--nav-bg)",
          backdropFilter: "blur(28px) saturate(1.8)",
          WebkitBackdropFilter: "blur(28px) saturate(1.8)",
          borderTop: "1px solid var(--nav-border)",
          boxShadow: "0 -1px 0 var(--glass-highlight) inset",
        }}
      >
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{ textDecoration: "none", flex: 1 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: `${NAV_H}px`,
                  gap: 4,
                  cursor: "pointer",
                  userSelect: "none",
                  transition: "opacity 0.18s",
                }}
              >
                <item.icon
                  style={{
                    width: 22,
                    height: 22,
                    color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                    strokeWidth: active ? 2.2 : 1.6,
                    transition: "color 0.2s, stroke-width 0.2s",
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                    lineHeight: 1,
                    transition: "color 0.2s, font-weight 0.2s",
                    letterSpacing: "0.01em",
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
  );
}
