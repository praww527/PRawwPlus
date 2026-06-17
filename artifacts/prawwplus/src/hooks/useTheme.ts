import { useEffect, useState } from "react";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme   = "dark" | "light";

function getStored(): ThemePreference {
  try {
    const v = localStorage.getItem("theme");
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {}
  return "dark";
}

function getResolved(pref: ThemePreference): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

export function initTheme() {
  try {
    const stored = localStorage.getItem("theme");
    const pref = (stored === "dark" || stored === "light" || stored === "system" ? stored : "dark") as ThemePreference;
    const resolved = getResolved(pref);
    document.documentElement.setAttribute("data-theme", resolved);
  } catch {}
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePreference>(getStored);

  useEffect(() => {
    const resolved = getResolved(pref);
    document.documentElement.setAttribute("data-theme", resolved);
  }, [pref]);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [pref]);

  const setTheme = (t: ThemePreference) => {
    try { localStorage.setItem("theme", t); } catch {}
    setPref(t);
  };

  const resolved = getResolved(pref);
  return { theme: pref, setTheme, resolved, isDark: resolved === "dark" };
}
