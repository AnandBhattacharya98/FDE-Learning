import { useEffect, useState } from "react";

// Light is the default. The choice is remembered per browser; index.html applies it
// before the first paint so the page never flashes the wrong theme.
const KEY = "fde.theme";
const THEME_COLOR = { light: "#ffffff", dark: "#0c0c10" };

function readTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(next)}
            aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
      )}
    </button>
  );
}
