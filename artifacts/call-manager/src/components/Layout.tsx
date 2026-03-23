import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Grid3x3, Clock, Users, User, X } from "lucide-react";
import Profile from "@/pages/Profile";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_BAR_H = 80;

const navItems = [
  { href: "/dashboard", label: "Keypad",   icon: Grid3x3 },
  { href: "/calls",     label: "Calls",    icon: Clock },
  { href: "/contacts",  label: "Contacts", icon: Users },
  { href: "/profile",   label: "Profile",  icon: User,   isModal: true },
];

export const NAV_H = NAV_BAR_H;

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);

  const isNavActive = (item: typeof navItems[number]) => {
    if (item.isModal) return profileOpen;
    return item.href === "/dashboard"
      ? location === "/dashboard"
      : location.startsWith(item.href);
  };

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

      {/* ── Profile modal sheet ───────────────────────────── */}
      {profileOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            display: "flex", flexDirection: "column", justifyContent: "flex-end",
          }}
        >
          {/* Blurred backdrop */}
          <div
            onClick={() => setProfileOpen(false)}
            style={{
              position: "absolute", inset: 0,
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
            }}
          />

          {/* Sheet */}
          <div
            style={{
              position: "relative",
              height: "91dvh",
              borderRadius: "24px 24px 0 0",
              background: "var(--modal-bg)",
              border: "1px solid var(--modal-border)",
              borderBottom: "none",
              backdropFilter: "blur(32px)",
              WebkitBackdropFilter: "blur(32px)",
              boxShadow: "0 -16px 60px rgba(0,0,0,0.55)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Drag handle + close */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              paddingTop: 12, paddingBottom: 4, flexShrink: 0, position: "relative",
            }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--sep-strong)" }} />
              <button
                onClick={() => setProfileOpen(false)}
                style={{
                  position: "absolute", right: 16,
                  width: 30, height: 30, borderRadius: "50%",
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <X style={{ width: 14, height: 14, color: "var(--text-2)" }} />
              </button>
            </div>

            {/* Scrollable profile content */}
            <div style={{ overflowY: "auto", flex: 1, paddingBottom: `calc(16px + env(safe-area-inset-bottom, 0px))` }}>
              <div style={{ maxWidth: 512, margin: "0 auto", padding: "8px 16px 20px" }}>
                <Profile />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating pill nav bar ─────────────────────────── */}
      <div style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        zIndex: 40,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        paddingBottom: `calc(14px + env(safe-area-inset-bottom, 0px))`,
        pointerEvents: "none",
      }}>
        <nav style={{
          display: "flex",
          alignItems: "center",
          paddingLeft: 6, paddingRight: 6,
          paddingTop: 6, paddingBottom: 6,
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
            const active = isNavActive(item);

            const handleClick = item.isModal
              ? (e: React.MouseEvent) => { e.preventDefault(); setProfileOpen(true); }
              : undefined;

            const inner = (
              <div
                onClick={handleClick}
                style={{
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
                }}
              >
                <item.icon style={{
                  width: 21, height: 21,
                  color: active ? "var(--nav-active)" : "var(--nav-inactive)",
                  strokeWidth: active ? 2.1 : 1.6,
                  transition: "color 0.22s",
                  filter: active ? "drop-shadow(0 0 5px rgba(255,255,255,0.25))" : "none",
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
            );

            return item.isModal ? (
              <div key={item.href}>{inner}</div>
            ) : (
              <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
                {inner}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
