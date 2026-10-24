/**
 * subagent-progress.ts — live tool-label humanization for subagent rows.
 *
 * WHY THIS FILE EXISTS
 *
 * Both subagent lanes (the sync `task` tool in tools.ts and the async fleet
 * in fleet-runtime.ts) parse the child's JSONL stdout and surface a
 * "current tool" string in the TUI: the fleet widget row (`running · bash`)
 * and the task tool's in-flight frame (`⟳ 3 turns, 2 tools in bash`). The
 * bare tool name is the 2023 shape — every 2025-2026 agent TUI (Claude
 * Code's subagent label, Gemini CLI's formatToolArgs, Codex's detail rows)
 * shows a humanized one-liner of WHAT the tool is doing, because "running ·
 * browser" tells the user nothing while a child is 40 seconds deep in a
 * login flow.
 *
 * The `tool_execution_start` event already carries the full tool args on
 * the wire (core/extensions/types.ts:798), so the label can be derived in
 * the PARENT from data that is already streaming — zero child-side changes,
 * zero new events, no polling.
 *
 * The logic is pure (no pi imports, no fs, no network) so it can be tested
 * hermetically (test/subagent-progress.test.ts imports ONLY this file),
 * matching the standing pattern of subagent-routing.ts / fleet.ts.
 *
 * Public surface (all pure):
 *   - humanizeToolLabel(toolName, args)  — compact "tool: detail" label
 *   - humanizeBrowserAction(args)        — browser-tool specific detail
 *   - truncateLabel(s, max)              — width-safe ellipsis
 *   - compactUrl(u)                      — scheme-stripped host+path for rows
 *   - compactTokens(n)                   — 1234 → "1.2k tok"
 *
 * Standing invariant: no fork of the pi substrate; no pi imports.
 */

/** Maximum characters of a humanized label before ellipsis. Terminal rows
 * are width-capped by the callers too (the fleet widget caps to its inner
 * width) — this is the transport cap, not the render cap. */
export const LABEL_MAX = 56;

/** Width-safe truncation that never returns an empty string for non-empty
 * input and always leaves room for the ellipsis character. */
export function truncateLabel(s: string, max = LABEL_MAX): string {
	const t = s.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** Strip the scheme and www prefix from a URL for compact row display:
 * "https://example.com/a/b?x=1" → "example.com/a/b". A query string is
 * dropped (rows are for orientation, not debugging); a hash is kept only
 * when it is a SPA route anchor. Bare hosts pass through unchanged. */
export function compactUrl(u: string): string {
	const s = u.trim();
	if (!s) return s;
	try {
		const parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) ? s : `https://${s}`);
		const host = parsed.host.replace(/^www\./, "");
		const path = parsed.pathname === "/" ? "" : parsed.pathname;
		const hash = parsed.hash && path === "" ? parsed.hash : "";
		// A search/query with no path needs the slash back ("example.com/?q=1")
		// — without it the row shows "example.com?q=1", which reads as a typo.
		const search = parsed.search && path === "" ? `/${parsed.search}` : "";
		return `${host}${path}${hash}${search}`;
	} catch {
		return s;
	}
}

/** Compact token counts for status rows: 0 → "" (omitted by callers),
 * 832 → "832 tok", 12345 → "12.3k tok". */
export function compactTokens(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n < 1000) return `${n} tok`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k tok`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tok`;
}

/** Compact elapsed for finished rows, Codex-style ("1m 00s", "42s",
 * "1h 03m") — shorter than fleet.ts's `02:14` clock form so a 4-wide
 * batch summary stays one line per child at 80 columns. Pure. */
export function formatElapsedCompact(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * The browser tool's detail line. One tool, 32 actions (docs/browser.md) —
 * the action verb is the noun and the first identifying operand is the
 * object, mirroring how the browser tool's own renderCall titles itself
 * (`web navigate example.com`) so the two surfaces read the same.
 *
 * Operand precedence: url > ref > selector > text > key > code > tabsAction
 * > generic first string. Refs render as `[e12]` (the docs' own notation).
 */
export function humanizeBrowserAction(args: unknown): string {
	if (args == null || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	const action = typeof a.action === "string" ? a.action : "";
	const str = (v: unknown): string => (typeof v === "string" ? v : "");
	const parts: string[] = [];
	const url = str(a.url);
	const ref = str(a.ref);
	const selector = str(a.selector);
	const text = str(a.text);
	const key = str(a.key);
	const code = str(a.code);
	const path = str(a.path) || str(a.filename);
	if (url) parts.push(compactUrl(url));
	if (ref) parts.push(`[${ref}]`);
	if (!ref && selector) parts.push(selector);
	if (text) parts.push(`"${text.slice(0, 24)}"`);
	if (key) parts.push(key);
	if (code && !url && !ref && !selector && !text) parts.push(`${code.split("\n", 1)[0].slice(0, 24)}`);
	if (path && !parts.length) parts.push(path);
	if (!parts.length && typeof a.tabsAction === "string") parts.push(String(a.tabsAction));
	if (!parts.length && typeof a.stealthAction === "string") parts.push(String(a.stealthAction));
	if (!parts.length && typeof a.captchaAction === "string") parts.push(String(a.captchaAction));
	if (!parts.length && typeof a.cookiesAction === "string") parts.push(String(a.cookiesAction));
	if (!parts.length && typeof a.storageAction === "string") parts.push(String(a.storageAction));
	return parts.length ? `${action} ${parts.join(" ")}`.trim() : action;
}

/**
 * Humanize one tool_execution_start into a compact row label.
 *
 * Precedence (adapted from Gemini CLI's formatToolArgs, cross-checked
 * against Claude Code's statusline label guidance): an explicit
 * `description` wins, then the tool's primary operand —
 *
 *   browser     → action + operand (humanizeBrowserAction)
 *   bash        → first line of `command`
 *   read/write/edit/ls → `path`/`file_path` (basename when long)
 *   grep/find   → `pattern`
 *   webfetch/fetch_url/web_search → `url`/`query`
 *   todo/note   → first words of `text`
 *   anything    → first short string value as a last resort
 *
 * The label never contains newlines (rows are one line) and is truncated
 * to LABEL_MAX. Unparsable args degrade to the bare tool name — a label
 * must never throw into the child stream parser.
 */
export function humanizeToolLabel(toolName: string, args: unknown): string {
	const name = typeof toolName === "string" && toolName.trim() ? toolName.trim() : "tool";
	if (args == null) return name;
	let a: Record<string, unknown>;
	if (typeof args !== "object" || Array.isArray(args)) return name;
	a = args as Record<string, unknown>;
	const str = (v: unknown): string => (typeof v === "string" ? v : "");
	const firstLine = (v: unknown): string => str(v).split("\n", 1)[0] ?? "";

	// An explicit description is the model's own summary of the call — the
	// highest-signal operand wherever it exists.
	const description = str(a.description).trim();
	if (description && name !== "browser") {
		return truncateLabel(`${name}: ${firstLine(description)}`);
	}

	if (name === "browser" || name === "browser_tool") {
		const detail = humanizeBrowserAction(args);
		return detail ? truncateLabel(`browser: ${detail}`) : "browser";
	}
	if (name === "bash" || name === "powershell" || name === "shell") {
		const cmd = firstLine(a.command ?? a.script).trim();
		return cmd ? truncateLabel(`${name}: ${cmd}`) : name;
	}
	const filePath = str(a.path ?? a.file_path ?? a.file).trim();
	if (filePath) {
		return truncateLabel(`${name}: ${shortenPath(filePath)}`);
	}
	const pattern = str(a.pattern ?? a.query).trim();
	if (pattern && (name === "grep" || name === "find" || name === "search")) {
		return truncateLabel(`${name}: ${pattern}`);
	}
	const url = str(a.url).trim();
	if (url) {
		return truncateLabel(`${name}: ${compactUrl(url)}`);
	}
	if (pattern) {
		return truncateLabel(`${name}: ${pattern}`);
	}
	const text = str(a.text ?? a.task ?? a.prompt).trim();
	if (text) {
		return truncateLabel(`${name}: ${firstLine(text).slice(0, 32)}`);
	}
	const code = firstLine(a.code).trim();
	if (code) {
		return truncateLabel(`${name}: ${code.slice(0, 32)}`);
	}
	// Last resort: the first short string operand (schemas evolve; this
	// keeps new tools readable instead of degrading to the bare name).
	for (const v of Object.values(a)) {
		if (typeof v === "string" && v.trim() && v.length <= 80) {
			return truncateLabel(`${name}: ${firstLine(v).slice(0, 40)}`);
		}
	}
	return name;
}

/** Shorten a path for row display: keep the basename and the nearest parent
 * ("src/…/foo.ts" shape) so two files with the same basename stay
 * distinguishable. Short paths pass through untouched. */
export function shortenPath(p: string): string {
	const norm = p.replace(/\\/g, "/");
	if (norm.length <= 34 || !norm.includes("/")) return norm;
	const parts = norm.split("/");
	const base = parts[parts.length - 1];
	const parent = parts[parts.length - 2] ?? "";
	return parent ? `${parent}/…/${base}` : `…/${base}`;
}
