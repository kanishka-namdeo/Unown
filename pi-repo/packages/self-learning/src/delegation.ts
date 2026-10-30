/**
 * delegation.ts — the delegation round's pure core: the audit ledger model,
 * the summary derivation, the in-session card/chip renderers, and the
 * best-effort engine report.
 *
 * The contract (docs/delegation-round-session.md, checkpoint 2):
 * EVERY subagent spawn — sync batch item or async fleet child — is a
 * DelegationRecord with its reason (`why`), its cost (turns/tokens/tools/
 * wall clock) and its outcome. The record answers the audit questions the
 * round's benchmark axes ask: why it was created, what it did, what it cost,
 * how it ended. Verdicts are receipts-only (the UX principles' epistemics
 * rule): a blocked/timeout run is "not worth it" by its own status; a done
 * run's worth is reported as FACTS (turns, tokens, output shape), never a
 * fabricated judgment — "worth it: unknown" is the honest default.
 *
 * Pure core (this file, no pi imports): types, deriveDelegationSummary,
 * renderDelegationCard, renderDelegationChip, deriveWorthLine.
 * Side-effect lane: the module-level session ledger (the same singleton
 * shape learning-feed.ts uses) + reportDelegations (engine POST,
 * fire-and-forget — the fleet journal is the durable local truth; the engine
 * ledger is the cross-session aggregate, and a missed report is a dashboard
 * gap, never data loss).
 */

import { engineFetch } from "./engine-auth.ts";
import { ENGINE_URL } from "./term.ts";

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** One completed (or terminal) delegation — both lanes, normalized. */
export interface DelegationRecord {
        /** Which lane spawned it. */
        lane: "sync" | "fleet";
        /** The agent definition's name (scout, worker, …). */
        agent: string;
        /** The fleet label, when the caller gave one (async lane). */
        name?: string;
        /** The task prompt (self-contained by contract). */
        task: string;
        /** The delegation reason — the `why` the parent stated at spawn time.
         *  Optional for compatibility: pre-0.0.46 journal entries and calls
         *  that skipped the field read as absent, never invented. */
        why?: string;
        /** Terminal status: done | failed | blocked | stopped | timeout | aborted | spawn_error. */
        status: string;
        turns: number;
        tokensIn: number;
        tokensOut: number;
        toolCalls: number;
        elapsedMs: number;
        /** True when the child refused via the BLOCKED protocol. */
        blocked?: boolean;
        ts: number;
        /** The project the parent session ran in (the engine aggregates by this). */
        cwd: string;
}

/** The summary the surfaces render (pure derivation, no LLM). */
export interface DelegationSummary {
        total: number;
        ok: number;
        failed: number;
        blocked: number;
        timeouts: number;
        tokensIn: number;
        tokensOut: number;
        turns: number;
        toolCalls: number;
        avgElapsedMs: number | null;
        byAgent: Array<{ agent: string; count: number; ok: number; tokens: number }>;
        withWhy: number;
}

const OK_STATUSES = new Set(["done"]);

export function deriveDelegationSummary(records: DelegationRecord[]): DelegationSummary {
        const total = records.length;
        const byAgent = new Map<string, { agent: string; count: number; ok: number; tokens: number }>();
        let ok = 0;
        let failed = 0;
        let blocked = 0;
        let timeouts = 0;
        let tokensIn = 0;
        let tokensOut = 0;
        let turns = 0;
        let toolCalls = 0;
        let elapsed = 0;
        let withWhy = 0;
        for (const r of records) {
                if (OK_STATUSES.has(r.status)) ok++;
                if (r.status === "blocked" || r.blocked) blocked++;
                if (r.status === "timeout") timeouts++;
                if (!OK_STATUSES.has(r.status) && r.status !== "blocked" && r.status !== "timeout") failed++;
                tokensIn += r.tokensIn || 0;
                tokensOut += r.tokensOut || 0;
                turns += r.turns || 0;
                toolCalls += r.toolCalls || 0;
                elapsed += r.elapsedMs || 0;
                if (r.why?.trim()) withWhy++;
                const agg = byAgent.get(r.agent) ?? { agent: r.agent, count: 0, ok: 0, tokens: 0 };
                agg.count++;
                if (OK_STATUSES.has(r.status)) agg.ok++;
                agg.tokens += (r.tokensIn || 0) + (r.tokensOut || 0);
                byAgent.set(r.agent, agg);
        }
        return {
                total,
                ok,
                failed,
                blocked,
                timeouts,
                tokensIn,
                tokensOut,
                turns,
                toolCalls,
                avgElapsedMs: total ? Math.round(elapsed / total) : null,
                byAgent: [...byAgent.values()].sort((a, b) => b.count - a.count),
                withWhy,
        };
}

// ---------------------------------------------------------------------------
// The worth line — receipts only, never a fabricated verdict
// ---------------------------------------------------------------------------

function compactTokens(n: number): string {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${Math.round(n / 1000)}k`;
        return String(n);
}

/**
 * The honest per-record verdict. Derivation table (deterministic):
 *   blocked            → "not worth it — the child refused (BLOCKED)"
 *   timeout            → "not worth it — hit the wall-clock budget"
 *   spawn_error/aborted→ "not worth it — <status>"
 *   failed             → "not worth it — exited non-zero after N turns"
 *   done, ≥100k tok    → "expensive — <tok> for <turns> turns (audit it)"
 *   done otherwise     → "ok — <turns> turns, <tok> tok, <elapsed>s"
 */
export function deriveWorthLine(r: DelegationRecord): string {
        if (r.blocked || r.status === "blocked") return "not worth it — the child refused (BLOCKED)";
        if (r.status === "timeout") return "not worth it — hit the wall-clock budget";
        if (r.status === "spawn_error" || r.status === "aborted") return `not worth it — ${r.status}`;
        if (r.status === "stopped") return "stopped by the orchestrator";
        if (!OK_STATUSES.has(r.status))
                return `not worth it — exited non-zero after ${r.turns} turn${r.turns === 1 ? "" : "s"}`;
        const tok = compactTokens((r.tokensIn || 0) + (r.tokensOut || 0));
        if ((r.tokensIn || 0) + (r.tokensOut || 0) >= 100_000)
                return `expensive — ${tok} tok for ${r.turns} turns (audit it)`;
        return `ok — ${r.turns} turns, ${tok} tok, ${Math.round((r.elapsedMs || 0) / 1000)}s`;
}

// ---------------------------------------------------------------------------
// The card + the chip (the /delegation command's output)
// ---------------------------------------------------------------------------

function clip(text: string, max: number): string {
        const oneLine = text.replace(/\s+/g, " ").trim();
        return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export interface DelegationCardInputs {
        records: DelegationRecord[];
        /** Extra context lines (e.g. the engine report status), rendered last. */
        footer?: string;
}

/** The /delegation card. Empty is a stated clean bill, never silence. */
export function renderDelegationCard(inputs: DelegationCardInputs): string {
        const records = inputs.records;
        const lines: string[] = [];
        const s = deriveDelegationSummary(records);
        if (records.length === 0) {
                lines.push("delegation — no subagents this session");
                lines.push("  ✓ nothing delegated · the task tool spawns one when a fresh context pays for itself");
        } else {
                lines.push(
                        `delegation — ${records.length} spawn${records.length === 1 ? "" : "s"} · ${s.ok} ok · ${s.blocked} blocked · ${s.failed} failed${s.timeouts ? ` · ${s.timeouts} timed out` : ""}`,
                );
                // newest first, capped at 8 rows like the fleet widget
                const shown = [...records].reverse().slice(0, 8);
                for (const r of shown) {
                        const label = r.name ? `${r.name} (${r.agent})` : r.agent;
                        lines.push(`  ${OK_STATUSES.has(r.status) ? "✓" : r.blocked ? "⊘" : "✗"} ${label} — ${clip(r.task, 60)}`);
                        lines.push(`    why: ${r.why ? clip(r.why, 90) : "(not stated)"}`);
                        lines.push(`    ${deriveWorthLine(r)}`);
                }
                if (records.length > shown.length)
                        lines.push(`  … +${records.length - shown.length} earlier (unown delegations for the full history)`);
        }
        lines.push(
                `totals: ${compactTokens(s.tokensIn)} in · ${compactTokens(s.tokensOut)} out · ${s.turns} turns · ${s.toolCalls} tool calls · ${s.avgElapsedMs === null ? "—" : `${Math.round(s.avgElapsedMs / 1000)}s`} avg`,
        );
        if (s.total) {
                const top = s.byAgent
                        .slice(0, 4)
                        .map((a) => `${a.agent} ${a.ok}/${a.count}`)
                        .join(" · ");
                lines.push(`agents: ${top}${s.byAgent.length > 4 ? " · …" : ""}`);
        }
        lines.push("standing: /tasks (live fleet) · unown delegations (cross-session journal) · /feed (what was learned)");
        if (inputs.footer) lines.push(inputs.footer);
        return lines.join("\n");
}

/** The footer chip — only when something needs a look (never when clean). */
export function renderDelegationChip(unseenNotOk: number, unseenTotal: number): string | undefined {
        if (unseenTotal <= 0) return undefined;
        if (unseenNotOk > 0) return `⊘ ${unseenNotOk} delegation${unseenNotOk === 1 ? "" : "s"} to review · /delegation`;
        if (unseenTotal > 0) return `fleet: ${unseenTotal} delegated this session · /delegation`;
        return undefined;
}

// ---------------------------------------------------------------------------
// The session ledger (module singleton — the learning-feed shape)
// ---------------------------------------------------------------------------

const SESSION_RECORDS: DelegationRecord[] = [];
const SESSION_CAP = 64;
type LedgerListener = (records: DelegationRecord[]) => void;
const LISTENERS: LedgerListener[] = [];

/** The in-session delegation ledger: every terminal spawn, newest last. */
export function getDelegationLedger(): {
        all(): DelegationRecord[];
        push(r: DelegationRecord): void;
        subscribe(fn: LedgerListener): void;
} {
        return {
                all: () => [...SESSION_RECORDS],
                push: (r: DelegationRecord) => {
                        SESSION_RECORDS.push(r);
                        if (SESSION_RECORDS.length > SESSION_CAP) SESSION_RECORDS.shift();
                        for (const fn of LISTENERS) {
                                try {
                                        fn([...SESSION_RECORDS]);
                                } catch {
                                        /* a listener never breaks the ledger */
                                }
                        }
                },
                subscribe: (fn: LedgerListener) => {
                        LISTENERS.push(fn);
                },
        };
}

// ---------------------------------------------------------------------------
// The engine report (best-effort aggregate; the journal is the local truth)
// ---------------------------------------------------------------------------

let reportInFlight = false;
const PENDING_REPORTS: DelegationRecord[] = [];

/**
 * Report finished delegations to the engine's /api/delegations aggregate.
 * Fire-and-forget by contract: a short-timeout POST, one retry-free attempt
 * per batch, never awaited by the caller (the tool result path must not pay
 * engine latency). When the engine is down the records are dropped from the
 * AGGREGATE only — the fleet journal already holds them locally, and the
 * next session's reports rebuild the dashboard view going forward.
 */
export function reportDelegations(records: DelegationRecord[]): void {
        if (records.length === 0) return;
        PENDING_REPORTS.push(...records);
        if (reportInFlight) return;
        reportInFlight = true;
        const batch = PENDING_REPORTS.splice(0, PENDING_REPORTS.length);
        void (async () => {
                try {
                        await engineFetch(`${ENGINE_URL}/api/delegations`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ schema: 1, records: batch }),
                                signal: AbortSignal.timeout(1500),
                        });
                } catch {
                        /* best effort — the journal is the durable local truth */
                } finally {
                        reportInFlight = false;
                        if (PENDING_REPORTS.length > 0) reportDelegations([]);
                }
        })();
}

/** Test seam: reset the module singletons. */
export function resetDelegationLedgerForTest(): void {
        SESSION_RECORDS.length = 0;
        LISTENERS.length = 0;
        PENDING_REPORTS.length = 0;
        reportInFlight = false;
}
