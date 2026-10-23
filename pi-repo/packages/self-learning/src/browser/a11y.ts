/**
 * browser/a11y.ts — the accessibility snapshot tier (D3, D4 in docs/browser-research.md).
 *
 * The walker is a self-contained JS function injected into the page via
 * Runtime.evaluate. It produces a JSON tree of {role, name, value, ref, box,
 * children} — refs (`e1`, `e2`, …) are minted for interactive + name-bearing
 * elements AND written back to the DOM as `data-unown-ref` attributes, so a
 * ref doubles as a stable CSS selector for later actions (D4).
 *
 * The TS side formats that JSON into the YAML-ish tree models already know
 * from Playwright MCP's browser_snapshot, and keeps a registry mapping each
 * ref to its box for trusted-input clicks.
 */

// ---------------------------------------------------------------------------
// the in-page walker (plain JS — no TS syntax, no closures, it is .toString()'d)
// ---------------------------------------------------------------------------

/**
 * Build the snapshot source. Must stay plain ES2019-ish JS: it runs inside the
 * page, compiled from `walkerFn.toString()`.
 */
function pageWalker(opts: { maxNodes: number; includeBoxes: boolean }): any {
        const MAX_NODES = opts.maxNodes;
        const INCLUDE_BOXES = !!opts.includeBoxes;

        // roles that make an element addressable for interaction
        const INTERACTIVE_ROLES: Record<string, number> = {
                button: 1, link: 1, textbox: 1, searchbox: 1, checkbox: 1, radio: 1,
                combobox: 1, listbox: 1, option: 1, menuitem: 1, menuitemcheckbox: 1,
                menuitemradio: 1, tab: 1, slider: 1, spinbutton: 1, switch: 1,
                treeitem: 1, gridcell: 1, scrollbar: 1, "doc-backlink": 1,
        };
        // structural roles worth a line even when generic-looking
        const LANDMARK_ROLES: Record<string, number> = {
                banner: 1, navigation: 1, main: 1, complementary: 1, contentinfo: 1,
                region: 1, search: 1, form: 1, dialog: 1, alertdialog: 1, article: 1,
                heading: 1, img: 1, table: 1, grid: 1, list: 1, tree: 1, menubar: 1,
                menu: 1, toolbar: 1, status: 1, alert: 1, log: 1, marquee: 1, timer: 1,
                tooltip: 1, code: 1, definition: 1, note: 1, figure: 1, group: 1,
        };
        const TAG_ROLE: any = {
                a: "link", button: "button", select: "combobox", textarea: "textbox",
                output: "status", details: "group", summary: "disclosure", nav: "navigation",
                main: "main", aside: "complementary", header: "banner", footer: "contentinfo",
                form: "form", table: "table", img: "img", figure: "figure", ul: "list",
                ol: "list", dl: "list", h1: "heading", h2: "heading", h3: "heading",
                h4: "heading", h5: "heading", h6: "heading", svg: "img", canvas: "img",
                video: "img", audio: "img", dialog: "dialog", hr: "separator",
                blockquote: "blockquote", code: "code", pre: "code", meter: "meter",
                progress: "progressbar", fieldset: "group", section: "region", article: "article",
                address: "group", time: "time", label: "label",
        };
        const NAME_ATTRS = ["aria-label"];

        function visible(el: Element): boolean {
                const cs = window.getComputedStyle(el);
                if (!cs || cs.display === "none" || cs.visibility === "hidden") return false;
                // position:fixed/absolute with no size can still be "visible" per spec,
                // but an unclickable 0x0 node is snapshot noise.
                if (el.tagName !== "HTML" && el.tagName !== "BODY") {
                        const r = (el as HTMLElement).getBoundingClientRect();
                        if (r.width === 0 && r.height === 0) {
                                // label wrapping inputs has 0 box but is still interesting — keep labels
                                if (el.tagName !== "LABEL") return false;
                        }
                }
                return true;
        }

        function ariaHidden(el: Element): boolean {
                return el.getAttribute && (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden"));
        }

        function textOf(el: Element, cap: number): string {
                const t = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
                return t.length > cap ? t.slice(0, cap) + "…" : t;
        }

        function nameOf(el: Element, role: string): string {
                const own = el.getAttribute ? el.getAttribute("aria-label") : null;
                if (own && own.trim()) return trim(own, 120);
                const labelledby = el.getAttribute ? el.getAttribute("aria-labelledby") : null;
                if (labelledby) {
                        const parts = labelledby.split(/\s+/).map((id) => {
                                const lab = document.getElementById(id);
                                return lab ? textOf(lab, 120) : "";
                        }).filter(Boolean);
                        if (parts.length) return trim(parts.join(" "), 120);
                }
                // label[for]
                if (el.id) {
                        const lab = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
                        if (lab) return trim(textOf(lab, 120), 120);
                }
                // ancestor label
                let anc = el.parentElement;
                while (anc) {
                        if (anc.tagName === "LABEL") return trim(textOf(anc, 120), 120);
                        anc = anc.parentElement;
                }
                if (role === "img") {
                        const alt = el.getAttribute("alt");
                        if (alt && alt.trim()) return trim(alt, 120);
                }
                const title = el.getAttribute ? el.getAttribute("title") : null;
                if (title && title.trim()) return trim(title, 120);
                // placeholder for text-entry roles
                if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "spinbutton") {
                        const ph = el.getAttribute("placeholder");
                        if (ph && ph.trim()) return trim(ph, 120);
                }
                // buttons/links/summaries: inner text
                if (role === "button" || role === "link" || role === "disclosure" || role === "menuitem" || role === "tab" || role === "option" || role === "treeitem") {
                        const t = textOf(el, 120);
                        if (t) return t;
                        // icon-only buttons: try aria-hidden text children anyway
                        const any = (el as HTMLElement).textContent || "";
                        if (any.trim()) return trim(any.replace(/\s+/g, " "), 120);
                }
                if (role === "heading" || role === "paragraph" || role === "label") {
                        const t = textOf(el, 120);
                        if (t) return t;
                }
                return "";
        }

        function trim(s: string, cap: number): string {
                s = s.replace(/\s+/g, " ").trim();
                return s.length > cap ? s.slice(0, cap) + "…" : s;
        }

        function cssEscape(s: string): string {
                return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        }

        function roleOf(el: Element): { role: string; level?: number } {
                const explicit = el.getAttribute ? el.getAttribute("role") : null;
                if (explicit) {
                        const r = explicit.trim().split(/\s+/)[0];
                        if (r) return { role: r };
                }
                // native semantics first: Chrome exposes computedRole on Element
                const anyEl = el as any;
                if (typeof anyEl.computedRole === "string" && anyEl.computedRole) {
                        if (anyEl.computedRole !== "generic") return { role: anyEl.computedRole };
                        return { role: "generic" };
                }
                const tag = el.tagName.toLowerCase();
                const mapped = TAG_ROLE[tag];
                if (mapped === "heading") {
                        const m = /^h([1-6])$/.exec(tag);
                        return { role: "heading", level: m ? Number(m[1]) : undefined };
                }
                if (mapped) return { role: mapped };
                if (tag === "input") {
                        const type = (el.getAttribute("type") || "text").toLowerCase();
                        if (type === "hidden") return { role: "generic" };
                        if (type === "checkbox") return { role: "checkbox" };
                        if (type === "radio") return { role: "radio" };
                        if (type === "button" || type === "submit" || type === "reset") return { role: "button" };
                        if (type === "range") return { role: "slider" };
                        if (type === "number") return { role: "spinbutton" };
                        if (type === "search") return { role: "searchbox" };
                        return { role: "textbox" };
                }
                return { role: "generic" };
        }

        function isInteractive(el: Element, role: string): boolean {
                if (INTERACTIVE_ROLES[role]) return true;
                if (el.tagName === "A" && el.getAttribute("href") != null) return true;
                if (el.tagName === "BUTTON" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.tagName === "SUMMARY") return true;
                if (el.tagName === "INPUT" && (el.getAttribute("type") || "text").toLowerCase() !== "hidden") return true;
                const ti = (el as HTMLElement).tabIndex;
                if (ti !== undefined && ti >= 0) return true;
                if ((el as HTMLElement).isContentEditable) return true;
                return false;
        }

        function valueOf(el: Element, role: string): string | undefined {
                const anyEl = el as any;
                if (role === "textbox" || role === "searchbox" || role === "spinbutton") {
                        if (typeof anyEl.value === "string") return trim(anyEl.value, 200) || "";
                }
                if (role === "combobox") {
                        if (typeof anyEl.value === "string") return trim(anyEl.value, 200);
                }
                if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox" || role === "menuitemradio") {
                        return anyEl.checked ? "checked" : anyEl.indeterminate ? "mixed" : "unchecked";
                }
                if (role === "slider") {
                        const v = anyEl.value != null ? String(anyEl.value) : "";
                        const min = anyEl.min != null ? String(anyEl.min) : "";
                        const max = anyEl.max != null ? String(anyEl.max) : "";
                        if (v || min || max) return `${v || "?"} of [${min || "?"}..${max || "?"}]`;
                }
                if (role === "link") {
                        const href = el.getAttribute("href");
                        if (href && href !== "#" && !/^javascript:/i.test(href)) return href.slice(0, 200);
                }
                return undefined;
        }

        function stateOf(el: Element): Record<string, any> {
                const s: Record<string, any> = {};
                if ((el as any).disabled === true) s.disabled = true;
                if ((el as any).readOnly === true) s.readonly = true;
                if ((el as any).required === true) s.required = true;
                if ((el as any).expanded !== undefined) {
                        s.expanded = !!(el as any).expanded;
                } else {
                        const ex = el.getAttribute ? el.getAttribute("aria-expanded") : null;
                        if (ex === "true") s.expanded = true;
                        if (ex === "false") s.expanded = false;
                }
                const sel = el.getAttribute ? el.getAttribute("aria-selected") : null;
                if (sel === "true") s.selected = true;
                const pressed = el.getAttribute ? el.getAttribute("aria-pressed") : null;
                if (pressed === "true") s.pressed = true;
                if (pressed === "false") s.pressed = false;
                return s;
        }

        let counter = 0;
        let truncated = false;

        // clean previous run's markers
        const previous = document.querySelectorAll("[data-unown-ref]");
        for (let i = 0; i < previous.length; i++) previous[i].removeAttribute("data-unown-ref");

        function walk(el: Element, depth: number, out: any[], frameChain: string[]): any | null {
                if (truncated) return null;
                if (counter >= MAX_NODES) { truncated = true; return null; }
                if (!visible(el) || ariaHidden(el)) return null;
                if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "NOSCRIPT" || el.tagName === "TEMPLATE" || el.tagName === "LINK" || el.tagName === "META") return null;

                const { role, level } = roleOf(el);
                const interactive = isInteractive(el, role);
                const name = nameOf(el, role);
                const tag = el.tagName.toLowerCase();
                const isLandmark = !!LANDMARK_ROLES[role];

                // Shadow DOM (open) — recurse through it transparently
                const shadow = (el as any).shadowRoot || null;

                // same-origin iframe — recurse into its document inline
                if (tag === "iframe") {
                        let frameInfo: string | null = null;
                        let childNodes: any[] | null = null;
                        try {
                                const doc = (el as HTMLIFrameElement).contentDocument;
                                if (doc && doc.body) {
                                        childNodes = [];
                                        for (let i = 0; i < doc.body.children.length; i++) walk(doc.body.children[i], depth + 1, childNodes, frameChain.concat(doc.title || ""));
                                } else {
                                        frameInfo = "empty";
                                }
                        } catch (e) {
                                frameInfo = "cross-origin";
                        }
                        const node: any = {
                                role: "iframe",
                                name: name || (el as HTMLElement).title || el.getAttribute("src") || "",
                                url: el.getAttribute("src") || undefined,
                                children: childNodes || [],
                        };
                        if (frameInfo) node.note = frameInfo;
                        if (childNodes && childNodes.length) counter += childNodes.length;
                        out.push(node);
                        if (counter >= MAX_NODES) truncated = true;
                        return node;
                }

                // collapse invisible-to-users containers, but keep anything the model
                // could address or that carries structure
                const hasRole = role !== "generic" || tag === "body";
                if (!interactive && !isLandmark && !hasRole && !name) {
                        // pure layout container — descend without emitting a line
                        const kids = collectChildren(el, depth, frameChain);
                        if (kids.length) out.push(...kids);
                        return null;
                }

                const node: any = { role, name: name || undefined };
                if (level) node.level = level;
                if (interactive || name || isLandmark) {
                        const v = valueOf(el, role);
                        if (v !== undefined) node.value = v;
                        const st = stateOf(el);
                        if (Object.keys(st).length) node.state = st;
                }
                if (interactive) {
                        counter++;
                        const ref = "e" + counter;
                        node.ref = ref;
                        el.setAttribute("data-unown-ref", ref);
                        if (INCLUDE_BOXES) node.box = boxOf(el);
                } else if (isLandmark || role === "heading" || role === "img") {
                        counter++;
                }

                const kids = collectChildren(el, depth, frameChain);
                if (kids.length) node.children = kids;
                // text-only elements: fold the text into the node name for paragraphs
                if (role === "paragraph" && !name && kids.length === 0) node.name = textOf(el, 200) || undefined;
                out.push(node);
                return node;
        }

        function collectChildren(el: Element, depth: number, frameChain: string[]): any[] {
                const kids: any[] = [];
                const host: any = (el as any).shadowRoot || el;
                // Walk childNodes IN ORDER so stray text keeps its DOM position
                // relative to element children (mixed content stays readable).
                if (host.childNodes) {
                        for (let i = 0; i < host.childNodes.length; i++) {
                                if (truncated) break;
                                const n = host.childNodes[i];
                                if (n.nodeType === 1) {
                                        walk(n, depth + 1, kids, frameChain);
                                } else if (n.nodeType === 3) {
                                        const text = String(n.nodeValue || "").replace(/\s+/g, " ").trim();
                                        if (text) {
                                                const last = kids[kids.length - 1];
                                                // merge with the preceding paragraph when it is adjacent text
                                                if (last && last.role === "paragraph" && !last.ref) {
                                                        last.name = String(last.name || "") + " " + (text.length > 200 ? text.slice(0, 200) : text);
                                                } else {
                                                        counter++;
                                                        kids.push({ role: "paragraph", name: text.length > 200 ? text.slice(0, 200) + "…" : text });
                                                }
                                        }
                                }
                        }
                }
                return kids;
        }

        function boxOf(el: Element): number[] {
                const r = (el as HTMLElement).getBoundingClientRect();
                return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        }

        const body = document.body;
        const nodes: any[] = [];
        if (body) {
                for (let i = 0; i < body.children.length; i++) walk(body.children[i], 0, nodes, []);
        }
        return {
                url: location.href,
                title: document.title || "",
                nodes,
                count: counter,
                truncated,
        };
}

export const SNAPSHOT_SCRIPT = `(${pageWalker.toString()})`;

// ---------------------------------------------------------------------------
// wire types + formatting
// ---------------------------------------------------------------------------

export interface SnapshotNode {
        role: string;
        name?: string;
        value?: string;
        level?: number;
        ref?: string;
        box?: number[];
        url?: string;
        note?: string;
        state?: Record<string, unknown>;
        children?: SnapshotNode[];
}

export interface Snapshot {
        url: string;
        title: string;
        nodes: SnapshotNode[];
        count: number;
        truncated: boolean;
}

/** One ref → where it lives. */
export interface RefEntry {
        ref: string;
        /** CSS selector that finds the element in the page (data attribute). */
        selector: string;
        box: number[];
        role: string;
        name: string;
}

/**
 * Format the snapshot as a YAML-ish tree. Interactive elements carry their
 * `[ref]`; the model reads this exactly like a Playwright MCP snapshot.
 */
export function formatSnapshot(snap: Snapshot): string {
        const lines: string[] = [];
        const usedChars = { n: 0 };
        for (const node of snap.nodes) emitNode(node, 0, lines, usedChars);
        const header = `# ${snap.title || "(untitled)"} — ${snap.url}`;
        let body = lines.join("\n");
        if (snap.truncated) {
                body += `\n- ... (snapshot truncated at the element cap — narrow with browser find or act on what is visible)`;
        }
        return `${header}\n${body}`;
}

function emitNode(node: SnapshotNode, depth: number, lines: string[], usedChars: { n: number }): void {
        const pad = "  ".repeat(depth);
        // name-first, playwright-mcp style: - link "Sign in" [e6] key=value…
        const parts: string[] = [];
        if (node.name) parts.push(JSON.stringify(node.name).slice(0, 220));
        if (node.level) parts.push(`level=${node.level}`);
        if (node.value !== undefined) parts.push(`value=${JSON.stringify(node.value.slice(0, 120))}`);
        if (node.state) {
                for (const [k, v] of Object.entries(node.state)) {
                        parts.push(`${k}=${v === true ? "true" : v === false ? "false" : String(v)}`);
                }
        }
        if (node.url) parts.push(`url=${JSON.stringify(node.url.slice(0, 160))}`);
        if (node.note) parts.push(`(${node.note})`);
        let line = `${pad}- ${node.role}${parts.length ? ` ${parts.join(" ")}` : ""}`;
        if (node.ref) line += ` [${node.ref}]`;
        lines.push(line);
        usedChars.n += line.length;
        const children = node.children ?? [];
        for (const child of children) {
                emitNode(child, depth + 1, lines, usedChars);
        }
}

/** Collect every ref from a snapshot into a registry (flat, with boxes). */
export function snapshotRefs(snap: Snapshot, includeBoxes: boolean): Map<string, RefEntry> {
        const out = new Map<string, RefEntry>();
        const visit = (node: SnapshotNode) => {
                if (node.ref) {
                        out.set(node.ref, {
                                ref: node.ref,
                                selector: `[data-unown-ref="${node.ref}"]`,
                                box: node.box ?? [0, 0, 0, 0],
                                role: node.role,
                                name: node.name ?? "",
                        });
                }
                for (const child of node.children ?? []) visit(child);
        };
        for (const node of snap.nodes) visit(node);
        return out;
}
