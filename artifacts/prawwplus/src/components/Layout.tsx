import { Link, useLocation } from "wouter";
import { Phone, Clock, Users, Voicemail, Star } from "lucide-react";
import { VertoInit } from "@/components/VertoInit";

interface LayoutProps {
  children: React.ReactNode;
}

export const NAV_H = 72;
export const NAV_Z = 50;
export const MODAL_Z = 300;

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
          paddingBottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px) + 16px)`,
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

      {/* Fixed glass bottom navbar */}
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
          backdropFilter: "blur(32px) saturate(1.9)",
          WebkitBackdropFilter: "blur(32px) saturate(1.9)",
          borderTop: "1px solid var(--nav-border)",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.18), 0 -1px 0 var(--glass-highlight) inset",
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
                  gap: 5,
                  cursor: "pointer",
                  userSelect: "none",
                  transition: "opacity 0.18s",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {/* Circle icon container */}
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: active ? "var(--nav-active-circle)" : "transparent",
                    border: active ? "1px solid var(--nav-active-circle-border)" : "1px solid transparent",
                    backdropFilter: active ? "blur(12px)" : "none",
                    WebkitBackdropFilter: active ? "blur(12px)" : "none",
                    transition: "all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)",
                    boxShadow: active ? "0 2px 12px rgba(59,130,246,0.20), 0 1px 0 rgba(255,255,255,0.14) inset" : "none",
                  }}
                >
                  <item.icon
                    style={{
                      width: 20,
                      height: 20,
                      color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                      strokeWidth: active ? 2.3 : 1.6,
                      transition: "color 0.2s, stroke-width 0.2s",
                    }}
                  />
                </div>

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
