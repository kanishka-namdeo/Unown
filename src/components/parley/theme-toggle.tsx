"use client";

/**
 * The theme toggle — flips `.parley-scope`'s light/dark class (the
 * bazaar shell pattern: the wrapper carries the class, never
 * `<html>`). Listens for the shell's keyboard `t` shortcut via the
 * `parley-theme-toggle` custom event, and exposes its own button.
 */
import { useEffect, useRef, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const themeRef = useRef(theme);
  themeRef.current = theme;

  function toggle() {
    const next = themeRef.current === "dark" ? "light" : "dark";
    setTheme(next);
    const target =
      document.querySelector(".parley-scope") ?? document.documentElement;
    target.classList.toggle("light", next === "light");
    target.classList.toggle("dark", next === "dark");
  }

  useEffect(() => {
    const onToggle = () => toggle();
    document.addEventListener("parley-theme-toggle", onToggle);
    return () => document.removeEventListener("parley-theme-toggle", onToggle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme (t)"
      className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-2"
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
