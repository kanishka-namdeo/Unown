/**
 * el.ts — the element-creation helper + the attribute-routing law
 * (ticket L-5, PLAN §1.1: "the Ostinato dialog contract + the el()
 * tabindex-attribute-routing law from day one — the B-12 cure").
 *
 * LAW (copied verbatim from apps/ostinato/src/ui/app.ts's el()):
 *
 *   `tabindex`, `data-*` and `aria-*` props ALWAYS land through
 *   `setAttribute` (the real-attribute branch). Hyphenless does NOT
 *   mean reflected: the DOM's reflection is the camelCase property
 *   `tabIndex`, so property-assignment of a `tabindex` prop sets a
 *   junk expando (`e.tabindex`) and the element is NEVER focusable
 *   — the B-12 class defect. `aria-*` and `data-*` hyphenated names
 *   are not DOM property names at all (reflections: `ariaLabel`,
 *   the `dataset` property) — property assignment there is a junk
 *   expando too. The attribute is the truth; only that route works.
 *
 * Everything else (class, id, type, href, value, …) routes through
 * plain property assignment.
 *
 * DOM-GUARD (the el-pin precedent, PLAN §5.3): this module resolves
 * `document` only INSIDE `el`'s body through the globalThis-seam
 * (the idb-storage.ts / fetcher.ts injection convention) — never at
 * module scope — so the module itself loads clean in the DOM-free
 * runtime (Lane A). The boundary test's DOM_GLOBS law pins that no
 * non-test module references a DOM global as a member-access
 * expression at module scope; the runtime-lookup keeps the read
 * honest too.
 */

/**
 * The structural document surface — the minimal shape `el` needs.
 * Matches both the browser's `document` global and a happy-dom
 * document.
 */
export type ElDocument = {
  createElement(tag: string): {
    setAttribute(name: string, value: string): void;
    textContent: string;
    innerHTML: string;
    className: string;
    [key: string]: unknown;
  };
};

/**
 * Resolve the document handle at call time (the globalThis-seam
 * convention — the module itself stays DOM-free at load time). A
 * missing handle (Lane A's DOM-free runtime) is a caller error:
 * `el` is only ever called from DOM-guarded code paths that never
 * run there.
 */
function doc(): Document {
  const d = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
  if (!d) throw new Error("el(): no document (DOM-free runtime)");
  return d;
}

/**
 * Create a DOM element with property-safe attribute routing.
 *
 * @param tag - the element tag name
 * @param props - property bag:
 *   - `text` → sets `textContent`
 *   - `html` → sets `innerHTML`
 *   - `class` → sets `className`
 *   - `tabindex` / `data-*` / `aria-*` → **setAttribute** (the law
 *     above — hyphenless does not mean reflected)
 *   - everything else → property assignment (id, value, href, role,
 *     type, placeholder, …)
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<
    HTMLElementTagNameMap[K]
  > & {
    text?: string;
    html?: string;
    class?: string;
    "aria-label"?: string;
    "aria-selected"?: string;
    "aria-current"?: string;
    "aria-controls"?: string;
    "aria-modal"?: string;
    "aria-describedby"?: string;
    "aria-labelledby"?: string;
    tabindex?: string;
    id?: string;
    role?: string;
    placeholder?: string;
    accept?: string;
    type?: string;
    download?: string;
    href?: string;
    value?: string;
    autocomplete?: string;
    rows?: number;
    title?: string;
    [key: `data-${string}`]: string | undefined;
  } = {},
): HTMLElementTagNameMap[K] {
  const e = doc().createElement(tag) as HTMLElementTagNameMap[K];
  const { text, html, class: className, ...rest } = props;
  if (text !== undefined) e.textContent = text;
  if (html !== undefined) e.innerHTML = html;
  if (className !== undefined) e.className = className;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (k === "tabindex" || k.startsWith("data-") || k.startsWith("aria-")) {
      // THE B-12 CURE (the attribute-routing law, binding from day
      // one in this app per PLAN §3 L-5):
      //
      // `tabindex` is hyphenless but NOT a reflected DOM property
      // name either (the reflection is `tabIndex`), so property
      // assignment sets a junk expando — the attribute is the truth.
      //
      // `data-*` must land as a real attribute: `dataset` property
      // assignment sets the camelCase property, not the hyphenated
      // attribute that CSS / attribute selectors key on.
      //
      // `aria-*` must land as a real attribute too: the hyphenated
      // name is not a reflected DOM property (the reflection is
      // `ariaLabel`), so property assignment sets a junk expando.
      (e as HTMLElement).setAttribute(k, v as string);
    } else {
      (e as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return e;
}
