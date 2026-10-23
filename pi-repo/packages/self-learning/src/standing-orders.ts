/**
 * standing-orders.ts — the standing-orders convention (OpenClaw's pattern,
 * adapted) + the /promote flow's pure layers.
 *
 * A standing order is a durable "program" the operator has authorized the
 * agent to execute on its own trigger: WHAT it may do (Authority), WHEN it
 * runs (Trigger — enforced by a routine's schedule, never by prose), what
 * needs human sign-off (Approval gate), when to stop and ask (Escalation),
 * and — as important as the permissions — what it must NOT do. Orders live
 * in markdown so they are readable, diffable and owned by the human:
 *
 *     ## Program: Nightly dependency report
 *     **Authority:** Read package manifests, run the update check, post a summary note.
 *     **Trigger:** Every weekday at 09:00 (enforced by the routine's schedule).
 *     **Approval gate:** None for reports. Applying an update requires confirmation.
 *     **Escalation:** If the update check fails twice, stop and leave a note.
 *
 *     ### Execution steps
 *     1. …
 *
 *     ### What NOT to do
 *     - Do not apply updates without confirmation.
 *
 * Location (Unown's split — OpenClaw has one workspace per agent): the
 * GLOBAL store `~/.unown/agent/standing-orders.md` and the PROJECT store
 * `<cwd>/.unown/standing-orders.md`; the project layer OVERRIDES the global
 * one per program id (same id = same program, nearest wins).
 *
 * The Execute-Verify-Report loop (OpenClaw's execution rules, verbatim in
 * spirit): execute the work (acknowledgement is not execution), VERIFY the
 * result before calling it done (prove it), report what was done and what
 * was verified — retry once with an adjusted approach on failure, 3
 * attempts maximum, then escalate. It rides EVERY standing-orders digest.
 *
 * /promote (OpenClaw's "promoting a repeated job into an automation",
 * made an explicit command — the docs' ask-twice auto-offer is a community
 * synthesis, not in their docs; Unown keeps promotion user-initiated):
 * distill the session into a Program draft, show it, save it on
 * confirmation, and offer the schedule + visible test-run.
 *
 * Purity contract: parsing/rendering/validation are pure; the two fs-owning
 * functions take an injected reader/writer (tests pass fakes).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { UNOWN_HOME } from "./term.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StandingOrder {
	/** Program id (slug of the title — the dedupe/override key). */
	id: string;
	title: string;
	/** What the agent is authorized to do (required). */
	authority: string;
	/** When it runs (required — the schedule is the real enforcement). */
	trigger: string;
	/** What requires human sign-off first. */
	approvalGate: string | null;
	/** When to stop and ask for help. */
	escalation: string | null;
	executionSteps: string[];
	notToDo: string[];
	/** Raw response-matrix table lines (Condition | Action | Escalate?). */
	responseMatrix: string[];
	source: "project" | "global";
	/** The full original section (the save/append lane round-trips this). */
	raw: string;
}

export interface StandingOrdersLoad {
	orders: StandingOrder[];
	warnings: string[];
	/** The store paths that were consulted (for /promote's save targets). */
	paths: { global: string; project: string };
}

/** Per-order and total injection budgets (OpenClaw's 20k/60k bootstrap caps,
 * scaled to a prompt rider: the orders are CONTEXT, not the task). */
export const ORDER_DIGEST_BUDGET = 2_000;
export const TOTAL_DIGEST_BUDGET = 10_000;

// ---------------------------------------------------------------------------
// Parsing (pure)
// ---------------------------------------------------------------------------

/** Slugify a program title into the id (stable, filesystem-safe). */
export function orderSlug(title: string): string {
	return title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64) || "program";
}

const FIELD_RE = /^\*\*(Authority|Trigger|Approval gate|Escalation)\s*:\*\*\s*(.+)$/i;

/** Parse a standing-orders document into orders + warnings. Never throws:
 * an invalid section becomes a warning and is skipped (a bad order must not
 * take the good ones down — the same posture as skills parsing). Pure. */
export function parseStandingOrders(md: string, source: "project" | "global"): { orders: StandingOrder[]; warnings: string[] } {
	const warnings: string[] = [];
	const orders: StandingOrder[] = [];
	if (!md.trim()) return { orders, warnings };
	// Split into `## Program: <title>` sections (other headings ignored).
	const sections: Array<{ title: string; body: string[] }> = [];
	let current: { title: string; body: string[] } | null = null;
	for (const line of md.split(/\r?\n/)) {
		const m = /^##\s+Program\s*:\s*(.+?)\s*$/i.exec(line);
		if (m) {
			current = { title: m[1], body: [] };
			sections.push(current);
			continue;
		}
		if (current) current.body.push(line);
	}
	for (const section of sections) {
		const raw = `## Program: ${section.title}\n${section.body.join("\n")}`.trim();
		const order: StandingOrder = {
			id: orderSlug(section.title),
			title: section.title,
			authority: "",
			trigger: "",
			approvalGate: null,
			escalation: null,
			executionSteps: [],
			notToDo: [],
			responseMatrix: [],
			source,
			raw,
		};
		let mode: "fields" | "steps" | "not" | "matrix" = "fields";
		for (const line of section.body) {
			const heading = /^###\s+(.+?)\s*$/.exec(line);
			if (heading) {
				const h = heading[1].toLowerCase();
				mode = h.startsWith("execution") ? "steps" : h.startsWith("what not") ? "not" : h.startsWith("response matrix") ? "matrix" : "fields";
				continue;
			}
			const field = FIELD_RE.exec(line);
			if (field && mode === "fields") {
				const value = field[2].trim();
				switch (field[1].toLowerCase()) {
					case "authority":
						order.authority = value;
						break;
					case "trigger":
						order.trigger = value;
						break;
					case "approval gate":
						order.approvalGate = value;
						break;
					case "escalation":
						order.escalation = value;
						break;
				}
				continue;
			}
			if (mode === "steps" && /^\s*\d+[.)]/.test(line)) order.executionSteps.push(line.replace(/^\s*\d+[.)]\s*/, "").trim());
			else if (mode === "not" && /^\s*[-*]/.test(line)) order.notToDo.push(line.replace(/^\s*[-*]\s*/, "").trim());
			else if (mode === "matrix" && line.trim().startsWith("|")) order.responseMatrix.push(line.trim());
		}
		if (!order.authority || !order.trigger) {
			warnings.push(
				`standing order "${order.title}" (${source}) is missing ${!order.authority ? "Authority" : ""}${!order.authority && !order.trigger ? " and " : ""}${!order.trigger ? "Trigger" : ""} — skipped`,
			);
			continue;
		}
		if (!order.approvalGate) warnings.push(`standing order "${order.title}" has no Approval gate — treat anything risky as gated`);
		if (!order.escalation) warnings.push(`standing order "${order.title}" has no Escalation clause — the default (3 attempts, then stop and report) applies`);
		orders.push(order);
	}
	return { orders, warnings };
}

// ---------------------------------------------------------------------------
// Loading (fs injected — tests pass a reader)
// ---------------------------------------------------------------------------

export function standingOrdersPaths(cwd: string, unownHome: string = UNOWN_HOME): { global: string; project: string } {
	return {
		global: join(unownHome, "agent", "standing-orders.md"),
		project: join(cwd, ".unown", "standing-orders.md"),
	};
}

/** Load + merge the two layers (project overrides global per program id).
 * Missing files are fine (empty layer). Never throws. */
export function loadStandingOrders(
	cwd: string,
	opts: { read?: (path: string) => string | null; unownHome?: string } = {},
): StandingOrdersLoad {
	const read = opts.read ?? ((p: string) => {
		try {
			return existsSync(p) ? readFileSync(p, "utf8") : null;
		} catch {
			return null;
		}
	});
	const paths = standingOrdersPaths(cwd, opts.unownHome);
	const warnings: string[] = [];
	const global = parseStandingOrders(read(paths.global) ?? "", "global");
	const project = parseStandingOrders(read(paths.project) ?? "", "project");
	warnings.push(...global.warnings, ...project.warnings);
	const byId = new Map<string, StandingOrder>();
	for (const o of global.orders) byId.set(o.id, o);
	for (const o of project.orders) byId.set(o.id, o); // project wins
	return { orders: [...byId.values()], warnings, paths };
}

// ---------------------------------------------------------------------------
// Rendering (pure)
// ---------------------------------------------------------------------------

/** The Execute-Verify-Report loop + retry bound (OpenClaw's execution
 * rules) — rides every digest. */
export const EXECUTE_VERIFY_REPORT = [
	"Execution discipline (every standing order):",
	"- EXECUTE the work — acknowledging the instruction is not execution.",
	"- VERIFY the result before calling it done — prove it (the file exists, the message was delivered, the command exited 0).",
	"- REPORT what was done and what was verified, with evidence.",
	"- On failure: retry once with an adjusted approach. 3 attempts maximum, then stop and escalate (report the failure — never fail silently).",
].join("\n");

/** Render the compact digest injected into unattended-run prompts: the
 * fields that govern behavior, not the prose. Budgeted per order and in
 * total, with a visible truncation notice (never a silent cut). Pure. */
export function renderOrdersDigest(orders: StandingOrder[], perOrderBudget = ORDER_DIGEST_BUDGET, totalBudget = TOTAL_DIGEST_BUDGET): string {
	const blocks: string[] = [];
	let total = 0;
	for (const o of orders) {
		const lines: string[] = [`### ${o.title} (${o.source})`];
		lines.push(`Authority: ${o.authority}`);
		lines.push(`Trigger: ${o.trigger}`);
		if (o.approvalGate) lines.push(`Approval gate: ${o.approvalGate}`);
		if (o.escalation) lines.push(`Escalation: ${o.escalation}`);
		if (o.notToDo.length > 0) lines.push(`What NOT to do: ${o.notToDo.join("; ")}`);
		if (o.executionSteps.length > 0) lines.push(`Execution steps: ${o.executionSteps.join("; ")}`);
		if (o.responseMatrix.length > 0) lines.push(`Response matrix: ${o.responseMatrix.join(" ")}`);
		let block = lines.join("\n");
		if (block.length > perOrderBudget) block = `${block.slice(0, perOrderBudget - 1)}…\n(truncated — read the full order in standing-orders.md)`;
		if (total + block.length > totalBudget) {
			blocks.push(`(remaining standing orders omitted — the ${totalBudget}-char digest budget was reached; read standing-orders.md for the rest)`);
			break;
		}
		total += block.length;
		blocks.push(block);
	}
	if (blocks.length === 0) return "";
	return [blocks.join("\n\n"), EXECUTE_VERIFY_REPORT].join("\n\n");
}

/** Compose the standing-orders rider onto an unattended-run prompt. The
 * framing is the contract: orders are AUTHORITY, the task is the work, and
 * the payload rule from buildAutomationPrompt is not weakened. Pure. */
export function appendStandingOrders(prompt: string, digest: string): string {
	if (!digest.trim()) return prompt;
	return (
		`${prompt}\n\n` +
		`Standing orders for this workspace (your standing authority for this run — execute per standing orders; gates and escalation rules below govern everything you do):\n\n${digest}`
	);
}

// ---------------------------------------------------------------------------
// The /promote pipeline (pure layers; the command wires them)
// ---------------------------------------------------------------------------

/** The distillation prompt for a Program draft (context-brief's shape: one
 * cheap call over the newest-first session projection). Pure. */
export function buildPromoteDistillPrompt(source: string, focus?: string): string {
	const focusLine = focus?.trim() ? `Focus the draft on: ${focus.trim()}.` : "";
	return [
		"Distill the recurring intent of THIS session into a standing-order program draft for an autonomous coding agent.",
		focusLine,
		"Output ONLY this markdown section, filled in (no prose around it):",
		"",
		"## Program: <short title>",
		"**Authority:** <what the agent is authorized to do — concrete verbs, bounded scope>",
		"**Trigger:** <when it runs — a cadence or event in plain words>",
		"**Approval gate:** <what needs human sign-off first, or 'None for …'>",
		"**Escalation:** <when to stop and ask>",
		"",
		"### Execution steps",
		"1. <ordered, concrete steps>",
		"",
		"### What NOT to do",
		"- <boundaries that matter as much as the permissions>",
		"",
		"Rules: start narrow (authority grows with trust); the Trigger describes WHEN, the schedule enforces it; What NOT to do is required; at most 1200 characters.",
		"",
		"=== SESSION (newest last) ===",
		source,
		"=== END SESSION ===",
		"",
		"Reply with ONLY the section.",
	].filter(Boolean)
		.join("\n");
}

/** Parse + validate a Program draft (the distillation output or a
 * hand-written one). Returns the order + the issues found. Pure. */
export function parseProgramDraft(md: string): { order: StandingOrder | null; issues: string[] } {
	const parsed = parseStandingOrders(md, "project");
	const issues = [...parsed.warnings];
	if (parsed.orders.length === 0) {
		return { order: null, issues: [...issues, "no '## Program: <title>' section found — the draft must follow the template"] };
	}
	if (parsed.orders.length > 1) issues.push("multiple Program sections found — keeping the first");
	const order = parsed.orders[0];
	if (order.notToDo.length === 0) issues.push("the draft has no 'What NOT to do' items — boundaries are required (add at least one)");
	return { order: { ...order, raw: md.trim() }, issues };
}

/** Render a StandingOrder back to its canonical store section (the append
 * lane writes exactly this). Pure. */
export function renderProgramSection(order: StandingOrder): string {
	const lines: string[] = [`## Program: ${order.title}`];
	lines.push(`**Authority:** ${order.authority}`);
	lines.push(`**Trigger:** ${order.trigger}`);
	lines.push(`**Approval gate:** ${order.approvalGate ?? "None stated — treat anything risky as gated"}`);
	lines.push(`**Escalation:** ${order.escalation ?? "Stop after 3 attempts and report the failure"}`);
	if (order.executionSteps.length > 0) {
		lines.push("");
		lines.push("### Execution steps");
		order.executionSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
	}
	if (order.notToDo.length > 0) {
		lines.push("");
		lines.push("### What NOT to do");
		for (const n of order.notToDo) lines.push(`- ${n}`);
	}
	if (order.responseMatrix.length > 0) {
		lines.push("");
		lines.push("### Response matrix");
		lines.push(...order.responseMatrix);
	}
	return lines.join("\n");
}

/** Append a program section to a store file (atomic rewrite: read, append,
 * write-temp, rename). Creates the file with a header when missing. The
 * writer is injectable for tests. */
export function appendOrderToStore(
	path: string,
	section: string,
	opts: { read?: (p: string) => string | null; write?: (p: string, content: string) => void } = {},
): { ok: boolean; error?: string } {
	const read = opts.read ?? ((p: string) => {
		try {
			return existsSync(p) ? readFileSync(p, "utf8") : null;
		} catch {
			return null;
		}
	});
	const write =
		opts.write ??
		((p: string, content: string) => {
			mkdirSync(dirname(p), { recursive: true });
			const tmp = `${p}.tmp`;
			writeFileSync(tmp, content);
			renameSync(tmp, p);
		});
	try {
		const existing = read(path);
		const header = existing === null ? "# Standing orders\n\n<describe the convention — see docs/standing-orders.md>\n" : "";
		const sep = existing !== null && existing.trim().length > 0 ? "\n\n" : "";
		write(path, `${header}${existing ?? ""}${sep}${section.trim()}\n`);
		return { ok: true };
	} catch (err: any) {
		return { ok: false, error: `could not write ${path}: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/** The plain-words confirmation sentence for a schedule offer (OpenClaw's
 * rule: confirm the SENTENCE, not the cron expression). Pure. */
export function plainWordsSchedule(sentence: { cadence: string; action: string; delivery: string }): string {
	return `Every ${sentence.cadence}, I will ${sentence.action}, and ${sentence.delivery}. Reply "confirm" to create it, or correct any part.`;
}
