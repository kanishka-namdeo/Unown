/**
 * delegations-cli.ts — `unown delegations`: the delegation round's
 * cross-session audit view (checkpoint 2's CLI surface).
 *
 * Two sources, one table:
 *   - the fleet journal (<repo>/.unown/fleet/journal.jsonl) — the durable
 *     LOCAL truth: both lanes' spawned/finished pairs, now carrying the
 *     round's audit fields (why / taskPreview / usage / outcome).
 *   - the engine's /api/delegations aggregate (optional, --engine) — the
 *     cross-session/cross-repo view the dashboard renders.
 *
 * Default (no flags): the journal of the CURRENT repo, paired into complete
 * delegations (spawned ⊕ finished by id), newest first, with the honest
 * notes: open spawns (no terminal record — crashed parent, swept by the next
 * boot), pre-0.0.46 entries without why (stated, never invented).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engineFetch } from "./engine-auth.ts";
import { type FleetJournalEntry, readFleetJournal, subagentJournalDir } from "./fleet-reaper.ts";
import { ENGINE_URL } from "./term.ts";

export const DELEGATIONS_USAGE = `usage: unown delegations [--limit N] [--json] [--engine]

The delegation audit: every subagent spawn recorded in this repo's fleet
journal — why it ran (when stated), what it cost, how it ended. Cross-session:
the journal is append-only and survives restarts.

  --limit N   show the N most recent delegations (default 20)
  --json      print the paired records as JSON (machine-readable)
  --engine    ALSO query the self-learning engine's cross-project aggregate
              (requires the engine up; the journal stays the local truth)`;

export interface DelegationCliRecord {
	id: string;
	lane: "sync" | "fleet";
	agent: string;
	name?: string;
	taskPreview?: string;
	why?: string;
	status: string;
	ts: number;
	finishedTs?: number;
	turns?: number;
	tokensIn?: number;
	tokensOut?: number;
	toolCalls?: number;
	elapsedMs?: number;
	blocked?: boolean;
}

/** Pair the journal's spawned/finished entries by id into complete records
 *  (pure — the test seam). Open spawns surface with status "open". */
export function pairJournal(entries: FleetJournalEntry[]): DelegationCliRecord[] {
	const spawns = new Map<string, DelegationCliRecord>();
	const order: string[] = [];
	for (const e of entries) {
		if (e.op === "spawned") {
			const rec: DelegationCliRecord = {
				id: e.id,
				lane: e.lane === "sync" ? "sync" : "fleet",
				agent: e.agent,
				name: e.name,
				taskPreview: (e as { taskPreview?: string }).taskPreview,
				why: (e as { why?: string }).why,
				status: "open",
				ts: e.ts,
			};
			spawns.set(e.id, rec);
			order.push(e.id);
		}
	}
	for (const e of entries) {
		if (e.op === "finished") {
			const rec = spawns.get(e.id);
			if (!rec) continue; // a finish without a spawn (legacy journal slice)
			rec.status = e.status;
			rec.finishedTs = e.ts;
			const x = e as {
				turns?: number;
				tokensIn?: number;
				tokensOut?: number;
				toolCalls?: number;
				elapsedMs?: number;
				blocked?: boolean;
				why?: string;
				taskPreview?: string;
			};
			rec.turns = x.turns;
			rec.tokensIn = x.tokensIn;
			rec.tokensOut = x.tokensOut;
			rec.toolCalls = x.toolCalls;
			rec.elapsedMs = x.elapsedMs;
			rec.blocked = x.blocked;
			// the finish entry re-carries the audit fields so a finish-only
			// slice still renders them (both writers include them)
			rec.why = rec.why ?? x.why;
			rec.taskPreview = rec.taskPreview ?? x.taskPreview;
		}
	}
	return order.map((id) => spawns.get(id)!).sort((a, b) => b.ts - a.ts);
}

function fmtTokens(n: number | undefined): string {
	const v = n ?? 0;
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (v >= 1_000) return `${Math.round(v / 1000)}k`;
	return String(v);
}

function clip(text: string | undefined, max: number): string {
	if (!text) return "";
	const one = text.replace(/\s+/g, " ").trim();
	return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Render the human table (pure — the test seam). */
export function renderDelegationsTable(records: DelegationCliRecord[], limit: number): string {
	const shown = records.slice(0, limit);
	const lines: string[] = [];
	if (shown.length === 0) {
		lines.push("no delegations recorded in this repo yet.");
		lines.push("spawn a subagent in any unown session — the audit lands here (and in /delegation).");
		return lines.join("\n");
	}
	let ok = 0;
	let notOk = 0;
	let open = 0;
	let withWhy = 0;
	for (const r of shown) {
		if (r.status === "open") open++;
		else if (r.status === "done" && !r.blocked) ok++;
		else notOk++;
		if (r.why) withWhy++;
	}
	lines.push(
		`delegations — ${shown.length} shown · ${ok} ok · ${notOk} not-ok${open ? ` · ${open} open` : ""} · why on ${withWhy}/${shown.length}`,
	);
	lines.push("");
	for (const r of shown) {
		const glyph = r.status === "open" ? "…" : r.status === "done" && !r.blocked ? "✓" : r.blocked ? "⊘" : "✗";
		const label = r.name && r.name !== r.agent ? `${r.name} (${r.agent})` : r.agent;
		const when = new Date(r.ts).toISOString().slice(5, 16).replace("T", " ");
		const cost = r.turns !== undefined ? `${r.turns}t ${fmtTokens(r.tokensIn)}in/${fmtTokens(r.tokensOut)}out` : "";
		lines.push(`  ${glyph} ${label} · ${r.lane} · ${when} · ${r.status}${cost ? ` · ${cost}` : ""}`);
		if (r.why) lines.push(`      why: ${clip(r.why, 100)}`);
		else lines.push("      why: (not stated)");
		if (r.taskPreview) lines.push(`      task: ${clip(r.taskPreview, 100)}`);
	}
	if (records.length > shown.length) lines.push(`  … ${records.length - shown.length} earlier`);
	lines.push("");
	lines.push(
		"journal: .unown/fleet/journal.jsonl · in-session: /delegation · dashboard: unown dashboard → Delegation",
	);
	return lines.join("\n");
}

export async function runDelegationsCommand(argv: string[]): Promise<number> {
	let limit = 20;
	let json = false;
	let engine = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--limit" || a === "-n") {
			const v = Number(argv[++i]);
			if (!Number.isFinite(v) || v < 1) {
				console.error("unown delegations: --limit needs a positive number");
				return 2;
			}
			limit = Math.floor(v);
		} else if (a === "--json") json = true;
		else if (a === "--engine") engine = true;
		else if (a === "--help" || a === "-h") {
			console.log(DELEGATIONS_USAGE);
			return 0;
		} else {
			console.error(`unown delegations: unknown argument "${a}"\n\n${DELEGATIONS_USAGE}`);
			return 2;
		}
	}
	const journalPath = join(subagentJournalDir(process.cwd()), "journal.jsonl");
	let entries: FleetJournalEntry[] = [];
	try {
		entries = readFleetJournal(subagentJournalDir(process.cwd()));
	} catch {
		/* no journal yet — the empty table states it */
	}
	// readFleetJournal already tolerates a missing file; keep the path for the note.
	void journalPath;
	const records = pairJournal(entries);

	if (engine) {
		try {
			const res = await engineFetch(`${ENGINE_URL}/api/delegations?limit=${limit}`, {
				signal: AbortSignal.timeout(4000),
			});
			const data = (await res.json()) as {
				delegations?: Array<{
					agent: string;
					status: string;
					turns: number;
					tokens_in: number;
					tokens_out: number;
					why: string | null;
					ts: number;
				}>;
				totals?: { total: number; ok: number | null; with_why: number | null };
			};
			const t = data.totals;
			console.log(
				`engine aggregate: ${t?.total ?? 0} delegation(s) recorded cross-session · ${t?.ok ?? 0} ok · why on ${t?.with_why ?? 0}/${t?.total ?? 0}`,
			);
			for (const d of (data.delegations ?? []).slice(0, limit)) {
				console.log(
					`  ${d.status === "done" ? "✓" : "✗"} ${d.agent} · ${new Date(d.ts).toISOString().slice(5, 16).replace("T", " ")} · ${d.turns}t ${fmtTokens(d.tokens_in)}/${fmtTokens(d.tokens_out)}${d.why ? ` · ${clip(d.why, 70)}` : ""}`,
				);
			}
			console.log("");
		} catch (e) {
			console.log(
				`engine aggregate: unreachable (${e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80)}) — the journal below is the local truth`,
			);
			console.log("");
		}
	}

	if (json) {
		console.log(
			JSON.stringify(
				{ source: subagentJournalDir(process.cwd()), count: records.length, records: records.slice(0, limit) },
				null,
				2,
			),
		);
	} else {
		// the journal file is read directly (readFleetJournal swallows the
		// missing-file case into []); surface the honest note when absent.
		try {
			readFileSync(journalPath, "utf8");
		} catch {
			console.log(`no fleet journal yet (${journalPath}) — no subagent has been spawned from this repo.`);
			return 0;
		}
		console.log(renderDelegationsTable(records, limit));
	}
	return 0;
}
