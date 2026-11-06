/**
 * Chaconne — the element-creation helper (the Ostinato el-kin; C-3).
 *
 * Ostinato inlined its `el()` inside app.ts (and re-exported it for the
 * el-kin unit pins, R-1-e2e chunk 5). Chaconne splits the same helper
 * into its own module so the seven UI modules share ONE
 * attribute-routing path — and the pins (el.test.ts) stay the Ostinato
 * `el.test.ts` precedent, unchanged:
 *
 *   - `text` → textContent, `html` → innerHTML, `class` → className
 *   - `tabindex` / `data-*` / `aria-*` → setAttribute (the B-12 class:
 *     hyphenless-unreflected and hyphenated names must land as REAL
 *     attributes, not junk expandos — `tabIndex`/`ariaLabel` property
 *     assignment sets the wrong thing)
 *   - everything else → property assignment
 */

/** Props: standard element properties + the routing special cases. */
type ElProps<T extends HTMLElement = HTMLElement> = Partial<T> & {
  text?: string;
  html?: string;
  class?: string;
  [key: `data-${string}`]: string | undefined;
  [key: `aria-${string}`]: string | undefined;
  tabindex?: string;
  role?: string;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { text, html, class: className, ...rest } = props;
  if (text !== undefined) e.textContent = text;
  if (html !== undefined) e.innerHTML = html;
  if (className !== undefined) e.className = className;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (k === "tabindex" || k.startsWith("data-") || k.startsWith("aria-")) {
      // The B-12 routing (Ostinato's exact comment, kept): these names
      // are NOT reflected DOM property spellings — property assignment
      // would set a junk expando and the attribute the CSS/queries key
      // on never lands. setAttribute is the truth.
      e.setAttribute(k, v as string);
    } else {
      (e as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return e;
}
