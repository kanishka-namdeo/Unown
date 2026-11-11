/**
 * Sanitization boundary for rendered markdown (XSS lane prevention).
 *
 * `marked` output is plain HTML. Before ANY insertion into the DOM we
 * run it through `sanitizeHtml`: parse into a template, strip
 * `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>` elements,
 * every `on*` event-handler attribute, and `javascript:`/`data:` URLs.
 * This is a DOM-purify-free allowlist pass — the app is local-first but
 * notes must not become an XSS lane.
 *
 * Runs in the browser (uses `document`); the domain layer never sees it.
 */

const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "svg",
]);

function stripForbidden(el: Element): void {
  for (const child of Array.from(el.children)) {
    stripForbidden(child);
  }
  if (FORBIDDEN_ELEMENTS.has(el.tagName.toLowerCase())) {
    el.remove();
    return;
  }
  // Strip event handlers and dangerous attributes.
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
    } else if (name === "href" || name === "src" || name === "xlink:href") {
      // CodeQL js/incomplete-url-scheme-check (alert #87, the 2026-11-11
      // Recital dependency-hygiene round): a blocklist `startsWith("javascript:")`
      // is case/shape-bypassable (vbscript:, unknown schemes, whitespace and
      // control-char variants browsers normalize away). The allowlist is the
      // sound shape: strip whitespace/control characters (the browser does,
      // so a scheme spelled with them must be tested as the browser sees it),
      // then let the attribute survive ONLY when it carries no scheme
      // (relative paths, #anchors, ?queries — a colon in the first segment
      // IS the scheme to the URL parser) or one of the explicitly safe
      // schemes — http(s), mailto, tel, and data: images (never
      // data:text/html). Every other scheme is removed, known or not.
      const value = attr.value.trim().toLowerCase().replace(/[\x00-\x20]+/g, "");
      const scheme = value.match(/^([a-z][a-z0-9+.\-]*):/)?.[1];
      const schemeOk =
        scheme === undefined || // scheme-less: relative, #anchor, ?query — safe
        /^(https?|mailto|tel)$/.test(scheme) ||
        /^data:image\/(png|jpeg|gif|webp|avif);/.test(value); // data: images only
      if (!schemeOk) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * Sanitize a block of HTML: returns a clean HTML string safe to insert.
 * All text, structure and safe attributes survive; scripts/styles/
 * iframes and event handlers do not.
 */
export function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const child of Array.from(template.content.children)) {
    stripForbidden(child as Element);
  }
  // DocumentFragment has no innerHTML in the DOM lib types, so
  // serialize through a throwaway element.
  const holder = document.createElement("div");
  holder.appendChild(template.content);
  return holder.innerHTML;
}
