import { useRef, useState, useLayoutEffect } from "react";
import { Link, useLocation } from "wouter";
import { Phone, Clock, Users, Voicemail, Star } from "lucide-react";
import { VertoInit } from "@/components/VertoInit";

interface LayoutProps {
  children: React.ReactNode;
}

export const NAV_H = 64;
export const NAV_BOTTOM_GAP = 14;
export const NAV_SIDE = 20;
export const NAV_Z = 9999;
export const MODAL_Z = 300;

const navItems = [
  { href: "/dashboard",  label: "Keypad",     icon: Phone },
  { href: "/calls",      label: "Recents",    icon: Clock },
  { href: "/voicemail",  label: "Voicemail",  icon: Voicemail },
  { href: "/contacts",   label: "Contacts",   icon: Users },
  { href: "/favorites",  label: "Favourites", icon: Star },
];

const N = navItems.length;

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const navRef = useRef<HTMLDivElement>(null);
  const [pillRect, setPillRect] = useState({ left: 0, width: 48 });

  const activeIndex = navItems.findIndex((item) =>
    item.href === "/dashboard"
      ? location === "/dashboard"
      : location.startsWith(item.href)
  );
  const safeIndex = activeIndex < 0 ? 0 : activeIndex;

  useLayoutEffect(() => {
    if (!navRef.current) return;
    const items = navRef.current.querySelectorAll<HTMLElement>("[data-nav-item]");
    const el = items[safeIndex];
    if (!el) return;
    const parent = navRef.current.getBoundingClientRect();
    const item = el.getBoundingClientRect();
    const PILL_PAD = 6;
    setPillRect({
      left: item.left - parent.left + PILL_PAD,
      width: item.width - PILL_PAD * 2,
    });
  }, [safeIndex]);

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
          paddingBottom: `calc(${NAV_H + NAV_BOTTOM_GAP + 12}px + env(safe-area-inset-bottom, 0px))`,
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
          background: "var(--nav-bg)",
          backdropFilter: "blur(36px) saturate(2)",
          WebkitBackdropFilter: "blur(36px) saturate(2)",
          border: "1px solid var(--nav-border)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.32), 0 1px 0 var(--glass-highlight) inset",
        }}
      >
        {/* Liquid sliding pill indicator */}
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
            border: "1px solid var(--nav-pill-border)",
            boxShadow: "0 2px 10px var(--nav-pill-shadow)",
            transition: "left 0.42s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
            pointerEvents: "none",
          }}
        />

        {navItems.map((item, idx) => {
          const active = idx === safeIndex;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{ flex: 1, textDecoration: "none" }}
            >
              <div
                data-nav-item
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: NAV_H,
                  gap: 4,
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitTapHighlightColor: "transparent",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <item.icon
                  style={{
                    width: 19,
                    height: 19,
                    color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                    strokeWidth: active ? 2.3 : 1.6,
                    transition: "color 0.28s, stroke-width 0.28s",
                  }}
                />
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                    lineHeight: 1,
                    transition: "color 0.28s, font-weight 0.2s",
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
