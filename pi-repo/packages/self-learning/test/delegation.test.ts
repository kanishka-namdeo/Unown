/**
 * delegation.test.ts — the delegation round's pure-core pins (checkpoint 2).
 *
 * Pins the round's audit model: the summary derivation over both lanes'
 * terminal records, the receipts-only worth lines (a blocked/timeout run is
 * "not worth it" by its own status; a done run reports facts; nothing is
 * invented), the card's clean bill (absence stated, never silence), the
 * chip's only-when-unseen rule, and the ledger singleton's push/subscribe
 * contract. The engine endpoint and the journal enrichment are pinned by
 * fleet-reaper/fleet-runtime + the integration suite; this file owns the
 * pure module.
 */

import { describe, expect, test } from "bun:test";
import {
	type DelegationRecord,
	deriveDelegationSummary,
	deriveWorthLine,
	getDelegationLedger,
	renderDelegationCard,
	renderDelegationChip,
	resetDelegationLedgerForTest,
} from "../src/delegation.ts";

const NOW = 1_700_000_000_000;

function rec(partial: Partial<DelegationRecord> = {}): DelegationRecord {
	return {
		lane: "sync",
		agent: "scout",
		task: "Map the journal",
		why: "context pressure — keep the parent window sharp",
		status: "done",
		turns: 4,
		tokensIn: 19_000,
		tokensOut: 900,
		toolCalls: 5,
		elapsedMs: 12_000,
		ts: NOW,
		cwd: "/repo",
		...partial,
	};
}

describe("deriveDelegationSummary", () => {
	test("aggregates both lanes: totals, ok/failed/blocked/timeout, per-agent tallies, why coverage", () => {
		const s = deriveDelegationSummary([
			rec(),
			rec({
				lane: "fleet",
				agent: "worker",
				name: "impl",
				status: "failed",
				turns: 2,
				tokensIn: 5_000,
				tokensOut: 100,
				toolCalls: 1,
				elapsedMs: 3_000,
			}),
			rec({
				lane: "fleet",
				agent: "general",
				status: "blocked",
				blocked: true,
				turns: 1,
				tokensIn: 1_000,
				tokensOut: 50,
				toolCalls: 1,
				elapsedMs: 1_000,
			}),
			rec({
				agent: "scout",
				status: "timeout",
				turns: 104,
				tokensIn: 596_000,
				tokensOut: 5_000,
				toolCalls: 111,
				elapsedMs: 300_000,
				why: undefined,
			}),
			rec({ agent: "scout", why: undefined, turns: 0, tokensIn: 0, tokensOut: 0, toolCalls: 0, elapsedMs: 0 }),
		]);
		expect(s.total).toBe(5);
		expect(s.ok).toBe(2);
		expect(s.failed).toBe(1);
		expect(s.blocked).toBe(1);
		expect(s.timeouts).toBe(1);
		expect(s.withWhy).toBe(3);
		expect(s.tokensIn).toBe(19_000 + 5_000 + 1_000 + 596_000 + 0);
		expect(s.tokensOut).toBe(900 + 100 + 50 + 5_000 + 0);
		expect(s.turns).toBe(4 + 2 + 1 + 104 + 0);
		expect(s.toolCalls).toBe(5 + 1 + 1 + 111 + 0);
		// per-agent: scout ×3 (1 ok + timeout + done-without-why), worker ×1, general ×1 — sorted by count
		expect(s.byAgent[0]).toMatchObject({ agent: "scout", count: 3, ok: 2 });
		expect(s.byAgent.map((a) => a.agent)).toEqual(["scout", "worker", "general"]);
	});

	test("empty input: zero totals, null average — absence is a fact, not zero-average", () => {
		const s = deriveDelegationSummary([]);
		expect(s.total).toBe(0);
		expect(s.avgElapsedMs).toBeNull();
		expect(s.byAgent).toEqual([]);
	});

	test("avgElapsedMs is the mean over records", () => {
		const s = deriveDelegationSummary([rec({ elapsedMs: 10_000 }), rec({ elapsedMs: 20_000 })]);
		expect(s.avgElapsedMs).toBe(15_000);
	});
});

describe("deriveWorthLine — receipts only, never a fabricated verdict", () => {
	test("a blocked run is not worth it, by its own status", () => {
		expect(deriveWorthLine(rec({ status: "blocked", blocked: true }))).toContain(
			"not worth it — the child refused (BLOCKED)",
		);
	});

	test("the F26 shape: a timeout is not worth it — the wall-clock budget killed it", () => {
		const line = deriveWorthLine(rec({ status: "timeout", turns: 104, tokensIn: 596_000, elapsedMs: 300_000 }));
		expect(line).toContain("not worth it — hit the wall-clock budget");
	});

	test("a spawn error and an aborted run name their status", () => {
		expect(deriveWorthLine(rec({ status: "spawn_error" }))).toContain("spawn_error");
		expect(deriveWorthLine(rec({ status: "aborted" }))).toContain("aborted");
	});

	test("a non-zero exit after work is not worth it", () => {
		expect(deriveWorthLine(rec({ status: "failed", turns: 3 }))).toContain(
			"not worth it — exited non-zero after 3 turns",
		);
	});

	test("a done run reports FACTS — turns, tokens, seconds — with no judgment word", () => {
		const line = deriveWorthLine(rec({ turns: 4, tokensIn: 19_000, tokensOut: 900, elapsedMs: 12_000 }));
		expect(line).toBe("ok — 4 turns, 20k tok, 12s");
	});

	test("an expensive done run (>=100k tokens) is flagged for audit, not judged", () => {
		const line = deriveWorthLine(rec({ turns: 104, tokensIn: 596_000, tokensOut: 5_000, elapsedMs: 300_000 }));
		expect(line).toContain("expensive — 601k tok for 104 turns (audit it)");
	});

	test("token compaction: k and M forms", () => {
		expect(deriveWorthLine(rec({ turns: 1, tokensIn: 950, tokensOut: 40, elapsedMs: 1_000 }))).toBe(
			"ok — 1 turns, 990 tok, 1s",
		);
		expect(deriveWorthLine(rec({ turns: 2, tokensIn: 1_400_000, tokensOut: 20_000, elapsedMs: 2_000 }))).toContain(
			"1.4M tok",
		);
	});

	test("a stopped run is attributed to the orchestrator, not scored", () => {
		expect(deriveWorthLine(rec({ status: "stopped" }))).toBe("stopped by the orchestrator");
	});
});

describe("renderDelegationCard", () => {
	test("an empty session gets the stated clean bill — never silence", () => {
		const card = renderDelegationCard({ records: [] });
		expect(card).toContain("delegation — no subagents this session");
		expect(card).toContain("nothing delegated");
	});

	test("each row carries the why, the task preview, and the worth line; totals ride the footer", () => {
		const card = renderDelegationCard({
			records: [
				rec({
					lane: "fleet",
					agent: "general",
					name: "counter",
					task: "Count the test lines",
					why: "parallelism — keep working while it counts",
				}),
				rec({
					agent: "scout",
					status: "timeout",
					why: "context pressure",
					turns: 104,
					tokensIn: 596_000,
					tokensOut: 5_000,
					toolCalls: 111,
					elapsedMs: 300_000,
				}),
			],
		});
		// timeout is its own category in the title, never folded into failed
		expect(card).toContain("delegation — 2 spawns · 1 ok · 0 blocked · 0 failed · 1 timed out");
		expect(card).toContain("counter (general) — Count the test lines");
		expect(card).toContain("why: parallelism — keep working while it counts");
		expect(card).toContain("not worth it — hit the wall-clock budget");
		expect(card).toContain("totals: 615k in · 6k out · 108 turns");
		expect(card).toContain("agents: general 1/1 · scout 0/1");
		expect(card).toContain("standing: /tasks (live fleet)");
	});

	test("a record without a why says '(not stated)' — absent stays absent, never invented", () => {
		const card = renderDelegationCard({ records: [rec({ why: undefined })] });
		expect(card).toContain("why: (not stated)");
	});

	test("more than 8 records cap the card with the history pointer", () => {
		const records = Array.from({ length: 10 }, (_, i) => rec({ ts: NOW + i }));
		const card = renderDelegationCard({ records });
		expect(card).toContain("… +2 earlier (unown delegations for the full history)");
	});
});

describe("renderDelegationChip — only when unseen, not-ok first", () => {
	test("nothing unseen → no chip (a quiet session is byte-identical to pre-change)", () => {
		expect(renderDelegationChip(0, 0)).toBeUndefined();
	});

	test("unseen healthy delegations → the informational chip with its drill-in", () => {
		expect(renderDelegationChip(0, 2)).toBe("fleet: 2 delegated this session · /delegation");
	});

	test("unseen not-ok delegations → the review chip", () => {
		expect(renderDelegationChip(1, 3)).toBe("⊘ 1 delegation to review · /delegation");
	});
});

describe("the session ledger singleton", () => {
	test("push appends, all() snapshots, subscribe fires on push and survives a throwing listener", () => {
		resetDelegationLedgerForTest();
		const ledger = getDelegationLedger();
		const seen: DelegationRecord[][] = [];
		ledger.subscribe((r) => {
			seen.push(r);
			throw new Error("a listener never breaks the ledger");
		});
		ledger.push(rec({ ts: NOW }));
		ledger.push(rec({ ts: NOW + 1, lane: "fleet", name: "x" }));
		expect(ledger.all()).toHaveLength(2);
		expect(seen).toHaveLength(2); // the throwing listener did not stop the second push
		resetDelegationLedgerForTest();
		expect(getDelegationLedger().all()).toHaveLength(0);
	});

	test("the ledger caps at 64 records (the ring contract)", () => {
		resetDelegationLedgerForTest();
		const ledger = getDelegationLedger();
		for (let i = 0; i < 70; i++) ledger.push(rec({ ts: NOW + i }));
		expect(ledger.all()).toHaveLength(64);
		expect(ledger.all().at(-1)?.ts).toBe(NOW + 69);
		resetDelegationLedgerForTest();
	});
});
