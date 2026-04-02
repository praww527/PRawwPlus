import { Link, useLocation } from "wouter";
import { Phone, Clock, Users, Voicemail, Star } from "lucide-react";
import { VertoInit } from "@/components/VertoInit";

interface LayoutProps {
  children: React.ReactNode;
}

export const NAV_H = 62;

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
        background: "var(--surface-0)",
      }}
    >
      <VertoInit />

      <main
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px))`,
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

      {/* Fixed full-width bottom navbar */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "stretch",
          height: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px))`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          background: "rgba(14,14,20,0.95)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
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
                  gap: 3,
                  cursor: "pointer",
                  userSelect: "none",
                  position: "relative",
                  transition: "opacity 0.15s",
                }}
              >
                {active && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 28,
                      height: 2,
                      borderRadius: "0 0 2px 2px",
                      background: "#3b82f6",
                    }}
                  />
                )}
                <item.icon
                  style={{
                    width: 22,
                    height: 22,
                    color: active ? "#3b82f6" : "rgba(255,255,255,0.35)",
                    strokeWidth: active ? 2.2 : 1.5,
                    transition: "color 0.15s",
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: active ? 700 : 500,
                    color: active ? "#3b82f6" : "rgba(255,255,255,0.35)",
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
  );
}
