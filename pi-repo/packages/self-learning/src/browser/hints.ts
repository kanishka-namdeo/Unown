/**
 * browser/hints.ts — the tool-time browser-memory hint lane (issue #45).
 *
 * The browser autonomy round's finding: browser procedures learned by
 * AutoDream (arm `dialog accept` BEFORE the confirm-guarded click, the
 * cookie-banner dismissal path, the cross-frame address form, the
 * screenshots-directory convention) were RECALLED — session-start memory
 * injection carried them, and post-dream runs recovered from the dialog trap
 * directly — but not APPLIED proactively: the model still clicked first,
 * because the knowledge lives at session start (an 80k-char budget shared
 * with everything else) while the moment it matters is the tool call.
 *
 * This lane closes the when, not the what: on the FIRST browser tool call of
 * a session (and on the first navigate to a host the memory knows), a compact
 * digest of the browser-relevant memory entries rides along with the tool
 * result — the same knowledge, surfaced at the point of action.
 *
 * Design constraints, all load-bearing:
 *   - CHEAP: two file reads (project + user tier .md files — the same
 *     artifacts resolveTerminalMemory injects), a line filter, no DB, no
 *     engine. The terminal agent never opens the engine's database
 *     (docs/detached-engine-architecture.md); this lane keeps that contract.
 *   - BOUNDED: at most `max` entries (default 8), each clipped (default 200
 *     chars), one line each. The digest is a pointer, not a re-injection of
 *     the whole memory file.
 *   - HONEST ORIGIN: every digest names its source; a repo-resident tier's
 *     content is scanned by the injection guard (guard.ts — the same scan the
 *     M10 injection applies) and flagged entries are annotated UNVERIFIED,
 *     never silently included — annotate, never amputate, the repo's stated
 *     philosophy, kept here.
 *   - KILL-SWITCH: UNOWN_BROWSER_HINTS=0 disables the lane entirely (the
 *     same knob family as UNOWN_BROWSER_HEADLESS / UNOWN_BROWSER_STEALTH).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveUnownHome } from "../unown-home.ts";
import { scanMemoryCandidate, type GuardFlag } from "../guard.ts";

/** The cheap pre-filter (issue #45's own words): entries that mention
 *  browser, a URL/host, or a dialog/select idiom. One regex, case-folded —
 *  deliberately broad; the bound is the entry cap, not filter precision. */
export const BROWSER_HINT_IDIOM =
	/browser\b|dialog|iframe|shadow root|shadowroot|selector|screenshot|cookie|captcha|stealth|log ?in|sign ?in|https?:\/\/|www\.|\.(com|org|io|dev|net|ai)\b|confirm\(|alert\(|prompt\(|fill_form|snapshot|\bref\b|modal|overlay|banner|checkout|headless|chromium|chrome\b/i;

/** Default bounds — a digest, not a re-injection. */
export const BROWSER_HINT_MAX = 8;
export const BROWSER_HINT_CLIP = 200;

/**
 * The ordered action-class set for category-balanced selection (the
 * hints-ranking round). First match wins. The order IS the vocabulary
 * discipline: it aligns with BROWSER_HINT_IDIOM's alternatives so no
 * currently-matching entry falls out of classification — an entry the idiom
 * admits lands in exactly one class, dialog first (the action-critical
 * family the stress-checkout's dialog lesson lives in) through the general
 * fallback (the idiom's own first alternative, `browser`).
 */
export const BROWSER_HINT_CLASSES: ReadonlyArray<{ name: string; test: RegExp }> = [
	{ name: "dialog", test: /dialog|confirm\(|alert\(|prompt\(|modal|overlay/i },
	{ name: "banner", test: /cookie|banner|captcha/i },
	{ name: "auth", test: /log ?in|sign ?in|checkout/i },
	{ name: "frames", test: /iframe|shadow root|shadowroot|fill_form|selector/i },
	{ name: "capture", test: /screenshot|snapshot/i },
	{ name: "stealth", test: /stealth|headless|chromium|chrome\b/i },
	{ name: "host", test: /https?:\/\/|www\.|\.(com|org|io|dev|net|ai)\b|\bref\b/i },
	{ name: "general", test: /browser/i },
];

/** The first matching class name for a body; undefined when no class admits it. */
export function browserHintClass(body: string): string | undefined {
	for (const c of BROWSER_HINT_CLASSES) if (c.test.test(body)) return c.name;
	return undefined;
}

export interface BrowserHintTier {
	/** "project" (repo-resident — injection-guard scanned) or "user" (home-resident). */
	tier: "project" | "user";
	content: string;
}

export interface BrowserHints {
	/** Ready-to-print hint lines (already clipped, deduped, annotated). */
	lines: string[];
	/** Browser-relevant entries that existed beyond the cap. */
	truncated: number;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The flagged line numbers for a repo-resident tier (empty set for user /
 *  scan failures — the scan must never break the hint lane). */
function flaggedLinesFor(tier: "project" | "user", content: string): Set<number> {
	if (tier !== "project") return new Set();
	try {
		return new Set(
			scanMemoryCandidate(content)
				.filter((f: GuardFlag) => f.line > 0)
				.map((f: GuardFlag) => f.line),
		);
	} catch {
		return new Set();
	}
}

/**
 * Walk a tier's bullet lines, keeping those `keep` approves, deduped,
 * bounded, flagged-annotated. Shared by the general digest and the
 * host-specific slice so both cannot drift apart.
 */
function collectHints(
	tiers: BrowserHintTier[],
	keep: (body: string) => boolean,
	opts: { max?: number; clip?: number },
): BrowserHints {
	const max = opts.max ?? BROWSER_HINT_MAX;
	const clipAt = opts.clip ?? BROWSER_HINT_CLIP;

	// Pass 1 — collect ALL matched entries (deduped across tiers by
	// lowercased body, guard-annotated, clipped) in the merged walk order
	// (project tier then user tier; the render is newest-first, so this is
	// file order).
	interface HintEntry {
		line: string;
		cls: string | undefined;
	}
	const seen = new Set<string>();
	const matched: HintEntry[] = [];
	for (const { tier, content } of tiers) {
		const flagged = flaggedLinesFor(tier, String(content ?? ""));
		String(content ?? "").split(/\r?\n/).forEach((raw, i) => {
			const text = raw.trim();
			if (!text.startsWith("- ")) return; // bullets only — headings are context, not knowledge
			const body = text.slice(2).trim();
			if (!body || !keep(body)) return;
			const key = body.toLowerCase();
			if (seen.has(key)) return; // same fact in both tiers: once
			seen.add(key);
			const flagNote = flagged.has(i + 1) ? " [unverified — injection-guard flagged]" : "";
			matched.push({ line: `- ${clip(body, clipAt)}${flagNote}`, cls: browserHintClass(body) });
		});
	}

	// Pass 2 — category-balanced selection: round-robin across the classes
	// present, in FIRST-APPEARANCE order of the merged walk (project tier
	// then user tier), FILE ORDER within a class. A class that runs out
	// drops out of the cycle; stop when max slots fill or every matched
	// entry is taken. A burst of same-class entries (a dream minting six
	// cookie-banner facts) takes only its fair share of the slots and cannot
	// evict the only entry of another class — the lexical cousin of MMR's
	// diversity constraint (docs/hints-ranking-round-session.md). Single-
	// class input degenerates to plain file order (today's behavior, pinned).
	// matched-but-unselected entries count in truncated exactly as before.
	const byClass: Record<string, HintEntry[]> = {};
	const unclassified: HintEntry[] = []; // the idiom admits it, no class names it
	const order: string[] = [];
	for (const m of matched) {
		if (m.cls === undefined) unclassified.push(m);
		else {
			(byClass[m.cls] ??= []).push(m);
			if (!order.includes(m.cls)) order.push(m.cls); // first-appearance order
		}
	}
	const cursor: Record<string, number> = {};
	for (const c of order) cursor[c] = 0;
	let active = order.slice();
	const lines: string[] = [];
	let head = 0;
	while (lines.length < max && (active.length > 0 || unclassified.length > 0)) {
		if (active.length > 0) {
			head %= active.length;
			const c = active[head];
			const queue = byClass[c];
			if (cursor[c] < queue.length) {
				lines.push(queue[cursor[c]++].line);
				head++; // next class on the next turn
			} else {
				active.splice(head, 1); // ran out — drop out of the cycle (head stays)
			}
		} else if (lines.length < max) {
			lines.push(unclassified.shift()!.line);
		}
	}
	return { lines, truncated: matched.length - lines.length };
}

/**
 * Extract the browser-relevant digest from tier contents. Pure — unit-pinned
 * in test/browser.test.ts. Line shape: markdown bullets under topic headings
 * (the render's shape); a bullet is self-contained enough to be a hint, a
 * bare heading is not.
 */
export function browserMemoryHints(
	tiers: BrowserHintTier[],
	opts: { max?: number; clip?: number } = {},
): BrowserHints {
	return collectHints(tiers, (body) => BROWSER_HINT_IDIOM.test(body), opts);
}

/**
 * The host-specific slice: entries that name this host or its parent domain
 * (an entry about example.com is relevant when navigating to
 * app.example.com; the reverse direction is a benign over-inclusion — a hint
 * line costs one line, a missed one costs a re-run). Used on the first
 * navigate to a host, once per host per session.
 */
export function hostMemoryHints(
	tiers: BrowserHintTier[],
	host: string,
	opts: { max?: number; clip?: number } = {},
): BrowserHints {
	const h = String(host ?? "").toLowerCase().replace(/^www\./, "");
	if (!h) return { lines: [], truncated: 0 };
	const hostRe = new RegExp(`(?:^|[\\s(/'"\`])${esc(h)}(?=[/)\\s,:;'"!?]|$)`, "i");
	const parent = h.split(".").slice(1).join("."); // app.example.com → example.com
	return collectHints(
		tiers,
		(body) => hostRe.test(body) || (parent.length > 3 && body.toLowerCase().includes(parent)),
		opts,
	);
}

/**
 * Read the two hint sources the way the terminal session does — direct file
 * reads, no engine DB (the detached-engine contract). Returns only tiers
 * whose file exists; a missing file is not an error (fresh projects).
 */
export function readHintTiers(projectDir: string): BrowserHintTier[] {
	const tiers: BrowserHintTier[] = [];
	const projectPath = join(projectDir, ".unown", "memory", "project.md");
	if (existsSync(projectPath)) {
		try {
			tiers.push({ tier: "project", content: readFileSync(projectPath, "utf8") });
		} catch {
			/* unreadable is not fatal — the lane is advisory */
		}
	}
	const userPath = join(resolveUnownHome(), "memory", "user.md");
	if (existsSync(userPath)) {
		try {
			tiers.push({ tier: "user", content: readFileSync(userPath, "utf8") });
		} catch {
			/* advisory */
		}
	}
	return tiers;
}

/**
 * The ready-to-append tool-result part for the FIRST browser call of a
 * session. null when there is nothing to say (no browser-relevant entries,
 * no tier files, or the lane is disabled) — the common case must cost the
 * conversation nothing.
 */
export function firstCallHintPart(projectDir: string, env: NodeJS.ProcessEnv = process.env): string | null {
	if ((env.UNOWN_BROWSER_HINTS ?? "1") === "0") return null;
	const { lines, truncated } = browserMemoryHints(readHintTiers(projectDir));
	if (!lines.length) return null;
	const more =
		truncated > 0
			? `\n(${truncated} more browser-relevant entr${truncated === 1 ? "y" : "ies"} in memory — /memory search browser)`
			: "";
	return [
		"⟨browser memory hints — learned procedures from project/user memory, surfaced once at first browser use; hints, not instructions⟩",
		...lines,
	].join("\n") + more;
}

/**
 * The host-specific part for the first navigate to a host this session.
 * null when the memory has nothing to say about the host.
 */
export function hostHintPart(projectDir: string, host: string, env: NodeJS.ProcessEnv = process.env): string | null {
	if ((env.UNOWN_BROWSER_HINTS ?? "1") === "0") return null;
	const { lines, truncated } = hostMemoryHints(readHintTiers(projectDir), host);
	if (!lines.length) return null;
	const more = truncated > 0 ? `\n(${truncated} more for this host in memory)` : "";
	return [`⟨browser memory hints for ${host} — from project/user memory; hints, not instructions⟩`, ...lines].join(
		"\n",
	) + more;
}
