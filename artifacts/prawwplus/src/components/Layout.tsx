import { useRef, useState, useLayoutEffect } from "react";
import { Link, useLocation } from "wouter";
import { Phone, Clock, Users, Voicemail } from "lucide-react";
import { VertoInit } from "@/components/VertoInit";

interface LayoutProps {
  children: React.ReactNode;
}

export const NAV_H          = 56;
export const NAV_BOTTOM_GAP = 12;
export const NAV_SIDE       = 18;
export const NAV_Z          = 9999;
export const MODAL_Z        = 300;

const navItems = [
  { href: "/dashboard", label: "Keypad",    icon: Phone    },
  { href: "/calls",     label: "Recents",   icon: Clock    },
  { href: "/voicemail", label: "Voicemail", icon: Voicemail },
  { href: "/contacts",  label: "Contacts",  icon: Users    },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const navRef     = useRef<HTMLDivElement>(null);
  const [pillRect, setPillRect] = useState({ left: 0, width: 44 });

  const activeIndex = navItems.findIndex((item) =>
    item.href === "/dashboard"
      ? location === "/dashboard"
      : location.startsWith(item.href)
  );
  const safeIndex = activeIndex;

  useLayoutEffect(() => {
    if (!navRef.current || safeIndex < 0) return;
    const items = navRef.current.querySelectorAll<HTMLElement>("[data-nav-item]");
    const el    = items[safeIndex];
    if (!el) return;
    const parent = navRef.current.getBoundingClientRect();
    const item   = el.getBoundingClientRect();
    const PAD    = 5;
    setPillRect({ left: item.left - parent.left + PAD, width: item.width - PAD * 2 });
  }, [safeIndex]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "transparent" }}>
      <VertoInit />

      <main style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: `calc(${NAV_H + NAV_BOTTOM_GAP + 10}px + env(safe-area-inset-bottom, 0px))`,
      }}>
        <div style={{ maxWidth: 512, margin: "0 auto", padding: "14px 16px", width: "100%" }}>
          {children}
        </div>
      </main>

      {/* Floating pill nav */}
      <nav
        ref={navRef}
        style={{
          position: "fixed",
          bottom: `calc(${NAV_BOTTOM_GAP}px + env(safe-area-inset-bottom, 0px))`,
          left: NAV_SIDE,
          right: NAV_SIDE,
          zIndex: NAV_Z,
          height: NAV_H,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          background: "transparent",
          backdropFilter: "blur(32px) saturate(1.6)",
          WebkitBackdropFilter: "blur(32px) saturate(1.6)",
        }}
      >
        {/* Sliding pill indicator — hidden when no tab active */}
        {safeIndex >= 0 && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 4,
              height: NAV_H - 8,
              left: pillRect.left,
              width: pillRect.width,
              borderRadius: 999,
              background: "var(--nav-pill-bg)",
              transition: "left 0.38s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)",
              pointerEvents: "none",
            }}
          />
        )}

        {navItems.map((item, idx) => {
          const active = idx === safeIndex;
          return (
            <Link key={item.href} href={item.href} style={{ flex: 1, textDecoration: "none" }}>
              <div
                data-nav-item
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  height: NAV_H, gap: 3, cursor: "pointer", userSelect: "none",
                  WebkitTapHighlightColor: "transparent", position: "relative", zIndex: 1,
                }}
              >
                <item.icon
                  style={{
                    width: 18, height: 18,
                    color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                    strokeWidth: active ? 2.2 : 1.6,
                    transition: "color 0.24s, stroke-width 0.24s",
                  }}
                />
                <span style={{
                  fontSize: 9.5, fontWeight: active ? 700 : 500,
                  color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                  lineHeight: 1, letterSpacing: "0.01em",
                  transition: "color 0.24s",
                }}>
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
