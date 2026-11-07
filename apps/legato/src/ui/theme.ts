/**
 * theme.ts — the two-scheme theming surface (ticket L-5, PLAN §1.1:
 * "theming (light + dark; the fugue accent-ink a11y trap cured from
 * day one — scheme-paired badge text)").
 *
 * THE MECHANISM (the Ostinato data-scheme convention, documented):
 *
 *   - the root element carries a `data-scheme` attribute:
 *     `"light"` or `"dark"`. The stylesheet (legato.css) declares the
 *     design tokens as CSS custom properties under
 *     `:root[data-scheme="light"]` / `:root[data-scheme="dark"]`.
 *   - The DEFAULT (no attribute) follows the OS preference: the
 *     stylesheet's `[data-scheme]`-absent rule mirrors
 *     `@media (prefers-color-scheme: dark)`, so an unthemed boot
 *     never flashes the wrong scheme.
 *   - The user's choice PERSISTS through the storage seam's side
 *     channel — `localStorage` under `legato.theme` (a UI-preference
 *     key, NOT part of the `legato.v1` data set — the grammar stays
 *     pure data; the house convention is that UI preferences ride
 *     the side channel, not the store). No localStorage (the DOM-free
 *     lane, a private-context reset) → the OS preference shows.
 *
 * THE TOKENS (documented here AND in legato.css — the palette
 * contract; the fugue accent-ink trap, cured by CONSTRUCTION):
 *
 *   --bg / --fg / --muted / --surface / --border / --accent /
 *   --focus / --accent-contrast / --badge-ink / --badge-bg /
 *   --shadow-overlay
 *
 *   The fugue trap (project memory, F-9): `--accent-ink` in the
 *   DARK scheme resolved to the near-black BACKGROUND token, so
 *   badge text on the accent background was unreadable (wcag2aa
 *   contrast failures). Legato cures it from day one: the badge
 *   pair is SCHEME-PAIRED —
 *     light: badge text = --accent (#0a5dc2) on --bg (≈5.6:1 ✓)
 *     dark:  badge text = #9fd4b5 (a fixed bright green) on
 *            the accent-mixed badge background (≥ 4.5:1 ✓)
 *   — so a badge NEVER renders dark-on-dark. `--badge-ink` /
 *   `--badge-bg` are the tokens the CSS routes through; the scheme
 *   pairing lives in the stylesheet, this module only flips the
 *   attribute.
 */

/** The two schemes. */
export type ThemeScheme = "light" | "dark";

/** The localStorage key the theme preference persists under
 * (UI side channel — not part of the `legato.v1` data set). */
const THEME_KEY = "legato.theme";

/**
 * Resolve the theme handle at call time through the globalThis-seam
 * (the idb-storage / fetcher injection convention — no DOM global
 * named at module scope; the boundary test's DOM_GLOBS law).
 */
function win(): Window | undefined {
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  return w;
}

function doc(): Document | undefined {
  const d = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
  return d;
}

/**
 * The current scheme as the stylesheet sees it: the explicit
 * `data-scheme` attribute when set, else the OS preference
 * (`"dark"` when `prefers-color-scheme: dark` matches).
 */
export function currentScheme(): ThemeScheme {
  const d = doc();
  if (d && d.documentElement) {
    const attr = d.documentElement.getAttribute("data-scheme");
    if (attr === "light" || attr === "dark") return attr;
  }
  const w = win();
  return w?.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

/**
 * Apply a scheme: set the `data-scheme` attribute AND persist the
 * preference (best-effort — a missing localStorage is honest: the
 * session gets the scheme, it just does not survive a reload).
 */
export function applyTheme(scheme: ThemeScheme): void {
  const d = doc();
  if (d?.documentElement) d.documentElement.setAttribute("data-scheme", scheme);
  const w = win();
  try {
    w?.localStorage?.setItem(THEME_KEY, scheme);
  } catch {
    /* no persistence surface (DOM-free lane / quota) — session-only */
  }
}

/**
 * Restore the persisted preference on boot (call BEFORE the first
 * paint, i.e. in main() before any render). No stored value → the
 * OS preference governs (the stylesheet's default branch); the
 * attribute is set so the "Toggle theme" command knows what to
 * flip to.
 */
export function restoreTheme(): ThemeScheme {
  const w = win();
  let stored: string | null = null;
  try {
    stored = w?.localStorage?.getItem(THEME_KEY) ?? null;
  } catch {
    /* no localStorage surface — OS preference */
  }
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return stored;
  }
  const scheme = currentScheme();
  applyTheme(scheme);
  return scheme;
}

/** The "Toggle theme" palette command's action: flip light ↔ dark. */
export function toggleTheme(): ThemeScheme {
  const next: ThemeScheme = currentScheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
