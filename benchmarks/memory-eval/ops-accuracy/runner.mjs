#!/usr/bin/env bun
/**
 * ops-accuracy/runner.mjs — memory-OPERATIONS accuracy benchmark (roadmap
 * layer 1 of the SOTA memory-test design; the docs/memory-competitor-research
 * failure modes get their pinned cases here): does the dream apply the RIGHT
 * memory operation — ADD / UPDATE / DELETE / NOOP — for each fact a note
 * sequence implies?
 *
 * Methodology lineage:
 *   - Mem0 (arXiv 2504.19413 §3.1 / Alg. 1): the ADD/UPDATE/DELETE/NOOP
 *     taxonomy of memory operations an extraction+update loop must resolve.
 *     This suite scores exactly that taxonomy: every corpus fact carries a
 *     GOLD op, and after the dream the OBSERVED effect is classified into
 *     applied / missed / over-applied / wrong-winner — the receipt is a
 *     goldOp × observed confusion matrix with a macro-averaged opsF1.
 *   - MEME (arXiv 2605.12477): the Cascade (chained dependency reasoning —
 *     auth → identity rename → config relocation) and Deletion (post-removal
 *     state must not assert the removed feature as active) hard cases.
 *   - MemoryAgentBench (arXiv 2507.05257): conflict resolution over
 *     multi-session contradictions (supersede / revocation / temporal-order)
 *     and cross-session information composition (multi-session-compose).
 *   - Bi-temporal recency (competitor-research failure mode 11, Letta #4097,
 *     Zep's bi-temporal lesson): a note about MONDAY's state DELIVERED after
 *     Wednesday's — event time, not delivery order, must decide the winner.
 *
 * What it measures per case (11 cases, one fictional TypeScript API-gateway
 * project 'aurora-gateway'; the 12th documented shape — dedup at corpus
 * scale — is pinned as failure-modes/fm-03, one dream not two): the case's
 * notes go through the PRODUCTION post-swap path (commit 25c6601, the Mem0
 * learning core — notes -> consolidate() over a scratch mem0 platform:
 * structural quarantine -> ONE mem0 extraction add -> guard sweep ->
 * reconcile -> deterministic render; imported from packages/self-learning
 * via _lib/dream-pipeline.mjs, no re-implementation drift), then
 * DETERMINISTIC probes (no LLM judge) classify the observed state over
 * THREE surfaces — platform.getAll(scope) memory texts, the rendered
 * markdown lines, and platform.search(query, scope, 10) results:
 *   - present[fact]:       the fact's match regex hits ≥1 platform memory OR
 *                          render line (normalized first: lowercase,
 *                          whitespace collapsed, markdown bullet markers
 *                          stripped; the satisfying surface is recorded).
 *   - absentCurrent[fact] (facts with "current": false): the regex must NOT
 *                          hit any CURRENT render line, AND must not hit a
 *                          search hit's text — a hit is exempt ONLY when the
 *                          line/text explicitly marks the fact historical/
 *                          superseded/revoked (superseded|revoked|removed|
 *                          no longer|decommissioned|migrated|old|deprecated|
 *                          was |used to|before, case-insensitive); matched
 *                          lines are recorded verbatim for audit.
 *   - once[fact]:          exactly ONE distinct platform memory matches
 *                          (the count is recorded).
 *   - maxMatchCount[fact]: match count ≤ limit (a corpus-pinned ceiling).
 *   - search[{q, expect}]: the expected fact's regex hits one of the TOP-5
 *                          results of platform.search(q, scope, 10).
 *
 * Ops scoring per fact: observed ∈ applied / missed / over-applied (duplicate
 * where once failed or matchCount>1 for ADD/NOOP) / wrong-winner
 * (absentCurrent failed). NOOP facts with dedupOf score through their target
 * fact (present AND exactly once — the restatement must not mint a second
 * memory). UPDATE applied = new text present AND the case's current:false
 * counterparts absent-current. DELETE applied = the current:false fact
 * absent-current AND (for supersede/revocation pairs) the current:true
 * replacement present. Case pass = every probe passes; suite pass = every
 * case passes (exit code mirrors it in live mode).
 *
 * Fidelity notes (mirroring consolidate()/runProjectDream in src/dream.ts):
 *   - each case owns an ISOLATED mem0 scope (projectScope("oa-<caseid>")),
 *     wiped + seeded with corpus.seedMemory exactly like production seeding
 *     (importLegacyMarkdown kind "seed": bullet-split, verbatim infer:false,
 *     no LLM);
 *   - notes are fed NEWEST-FIRST by created_at ?? ts descending
 *     (undreamedNotes() ORDER BY created_at DESC) — the real pipeline's
 *     actual (surprising) order; the bi-temporal case's notes carry BOTH ts
 *     (event time) and created_at (delivery time): DELIVERY order decides
 *     the feed (the monday note has the later created_at and is fed first),
 *     the event chronology rides in the note text;
 *   - ONE consolidation per case (LLM economy: ~2 LLM calls per case — the
 *     mem0 extraction add + the reconcile pass; sequential awaits, no
 *     parallel fire against the metered bridge).
 *
 * Resume-safe: a case with an existing ERROR-FREE receipt is skipped; errored
 * cases re-run (the case scope is wiped first, so a re-run never inherits
 * the failed attempt's platform state). Receipts: results/per-case/<id>.json
 * + results/summary.json (model-scoped: a run whose model differs from the
 * one recorded in an existing results/summary.json writes to results/<model>/
 * instead of clobbering).
 *
 * Usage: bun runner.mjs [--dry] [--fresh] [--limit N] [--case <id>]
 *   --dry: no-LLM smoke lane — the full plumbing (wipe -> seed -> verbatim
 *          infer:false adds -> reconcile seam -> render -> probes -> ops
 *          classification) with zero bridge calls and NO receipt writes;
 *          exits non-zero on plumbing errors. In --dry the verbatim notes
 *          simply accumulate (no extraction, no reconcile ops), so the
 *          absentCurrent/once verdicts are meaningless by construction —
 *          what must hold is that every stage ran and every probe classified.
 * Live mode requires the llm-bridge on :3031 (checked before any dream call).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
// Model-scoped results (added 2026-10-21, mirroring quality-axes): a run whose
// model differs from the one recorded in the legacy results/summary.json
// writes to results/<model>/ instead of clobbering the committed
// single-model receipts — the agnes campaign overwrote all four suites' kimi
// receipts that way and they had to be restored from git. Same model keeps
// the legacy layout byte-compatible.
const _RESULTS_MODEL = process.env.PI_MODEL_ID ?? "agnes-3.0-flash";
let _LEGACY_MODEL = _RESULTS_MODEL;
try {
        _LEGACY_MODEL = JSON.parse(readFileSync(join(HERE, "results", "summary.json"), "utf8")).model ?? _RESULTS_MODEL;
} catch { /* no legacy summary yet — the first run defines the layout */ }
const RESULTS = _RESULTS_MODEL !== _LEGACY_MODEL ? join(HERE, "results", _RESULTS_MODEL) : join(HERE, "results");
const PER_CASE = join(RESULTS, "per-case");

// --dry (the no-LLM smoke lane for CI): the full plumbing with ZERO bridge
// calls, the deterministic lexical embedder forced, and NO receipt writes
// (the committed results/ are never touched). Exits non-zero on plumbing
// errors.
const DRY = process.argv.includes("--dry");

// Scratch env BEFORE importing the package (the store proxy opens SQLite at
// first use; the platform reads PI_MEM0_DIR at build): the benchmark never
// touches the live engine DB or the live mem0 dir.
process.env.PI_SELFLEARNING_DATA ??= "/home/z/my-project/scratch-mem/ops-accuracy/data";
process.env.PI_SELFLEARNING_DB ??= "/home/z/my-project/scratch-mem/ops-accuracy/db/ops-accuracy.db";
process.env.PI_MEM0_DIR ??= "/home/z/my-project/scratch-mem/ops-accuracy/mem0";
if (DRY) process.env.PI_MEM0_EMBEDDER = "lexical"; // deterministic + fast: no ONNX lane probe
process.env.PI_MODEL_ID ??= "agnes-3.0-flash";
process.env.PI_PROVIDER ??= "zai-bridge";

const { bridgeHealth } = await import("../../../pi-repo/packages/self-learning/src/llm.ts");
const { getMemoryPlatform, renderFooterMatches } = await import("../../../pi-repo/packages/self-learning/src/memzero.ts");
const { scanUntrustedText } = await import("../../../pi-repo/packages/self-learning/src/guard.ts");
const { consolidateScope, seedScope, wipeScope, renderScope, projectScope, noOpReconcileLlm, platformInfo } =
        await import("../_lib/dream-pipeline.mjs");

const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));
const MODEL = process.env.PI_MODEL_ID ?? corpus.model ?? "agnes-3.0-flash";
const SEED = corpus.seedMemory;

// ---------------------------------------------------------------------------
// Args + case selection
// ---------------------------------------------------------------------------
const ONLY_CASE = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null;
const HAS_LIMIT = process.argv.includes("--limit");
const LIMIT = HAS_LIMIT ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
if (HAS_LIMIT && (!Number.isFinite(LIMIT) || LIMIT < 1)) {
        console.error(`--limit needs a positive number (got ${process.argv[process.argv.indexOf("--limit") + 1]})`);
        process.exit(1);
}
if (ONLY_CASE && !corpus.cases.some((c) => c.id === ONLY_CASE)) {
        console.error(`--case ${ONLY_CASE}: no such case (have: ${corpus.cases.map((c) => c.id).join(", ")})`);
        process.exit(1);
}

if (DRY) {
        // no receipts in dry mode — committed results/ stay untouched
} else {
        if (process.argv.includes("--fresh")) rmSync(PER_CASE, { recursive: true, force: true });
        mkdirSync(PER_CASE, { recursive: true });
}

function selectedCases() {
        const cs = ONLY_CASE ? corpus.cases.filter((c) => c.id === ONLY_CASE) : corpus.cases;
        return cs.slice(0, Math.min(LIMIT, cs.length));
}

/** Corpus contract validation — a broken corpus must fail BEFORE any dream. */
function validateCorpus(cases) {
        const errs = [];
        const ids = new Set();
        for (const c of cases) {
                if (ids.has(c.id)) errs.push(`duplicate case id ${c.id}`);
                ids.add(c.id);
                if (!Array.isArray(c.notes) || c.notes.length === 0) errs.push(`${c.id}: no notes`);
                for (const n of c.notes ?? []) {
                        if (!n.text) errs.push(`${c.id}: note without text`);
                        const eff = n.created_at ?? n.ts;
                        if (!eff || Number.isNaN(Date.parse(eff))) errs.push(`${c.id}: note without parseable ts/created_at`);
                }
                if (!c.facts || Object.keys(c.facts).length === 0) errs.push(`${c.id}: no facts (gold ledger empty)`);
                for (const [fid, f] of Object.entries(c.facts ?? {})) {
                        if (!GOLD_OPS.includes(f.op)) errs.push(`${c.id}/${fid}: op must be one of ${GOLD_OPS.join("/")}, got ${f.op}`);
                        if (!f.match) errs.push(`${c.id}/${fid}: no match regex`);
                        else {
                                try {
                                        new RegExp(f.match, "i");
                                } catch (e) {
                                        errs.push(`${c.id}/${fid}: match regex does not compile: ${e.message}`);
                                }
                        }
                        if (f.dedupOf && !c.facts[f.dedupOf]) errs.push(`${c.id}/${fid}: dedupOf target ${f.dedupOf} unknown`);
                }
                const p = c.probes ?? {};
                for (const kind of ["present", "absentCurrent", "once"]) {
                        for (const fid of p[kind] ?? []) if (!c.facts[fid]) errs.push(`${c.id}: ${kind} probe references unknown fact ${fid}`);
                }
                for (const [fid, limit] of Object.entries(p.maxMatchCount ?? {})) {
                        if (!c.facts[fid]) errs.push(`${c.id}: maxMatchCount references unknown fact ${fid}`);
                        else if (!Number.isFinite(limit)) errs.push(`${c.id}: maxMatchCount limit for ${fid} is not a number`);
                }
                for (const s of p.search ?? []) {
                        if (!s.q) errs.push(`${c.id}: search probe without q`);
                        if (!c.facts[s.expect]) errs.push(`${c.id}: search probe expects unknown fact ${s.expect}`);
                }
                for (const fid of p.absentCurrent ?? [])
                        if (c.facts[fid] && c.facts[fid].current !== false)
                                errs.push(`${c.id}: absentCurrent fact ${fid} lacks "current": false`);
        }
        return errs;
}

// ---------------------------------------------------------------------------
// Deterministic probe engine (no LLM judge — regex/line classification over
// normalized text, every matched line + count + satisfying surface recorded)
// ---------------------------------------------------------------------------
const GOLD_OPS = ["ADD", "UPDATE", "DELETE", "NOOP"];
const OBSERVED = ["applied", "missed", "over-applied", "wrong-winner"];

/** The spec's historical-marker exemption for absentCurrent hits: a line is
 *  allowed to mention the superseded/revoked fact ONLY when it explicitly
 *  marks it historical. Verbatim list, case-insensitive, substring semantics.
 *  Extended 2026-10-26 from the deletion-state receipts: past-tense "were"
 *  and version-context markers ("in pre-v2.3", "from v2.3 onward") are
 *  legitimate historical framing the first list missed. */
const HISTORICAL_MARKER_SRC =
        "superseded|revoked|removed|no longer|decommissioned|migrated|old|deprecated|was |were |used to|before|in pre-|pre-v|from v\\d|moved from";
const HISTORICAL_MARKER_RE = new RegExp(HISTORICAL_MARKER_SRC, "i");

/** Which marker word exempted a line (recorded for the audit trail). */
function historicalMarker(line) {
        const m = String(line).match(HISTORICAL_MARKER_RE);
        return m ? m[0].trim() : null;
}

/** Normalization before matching: lowercase, collapse whitespace, strip
 *  markdown bullet markers. */
function stripBullet(line) {
        return String(line).replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "");
}
function norm(s) {
        return stripBullet(String(s)).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Render lines that can satisfy probes: non-empty, footer comments excluded
 *  (the "<!-- unown: rendered ... -->" footer is provenance metadata, not
 *  memory content). Headings stay in — no corpus regex matches one. */
function renderContentLines(render) {
        const raw = [];
        for (const line of String(render).split("\n")) {
                const t = line.trim();
                if (!t || t.startsWith("<!--")) continue;
                raw.push(line);
        }
        return { raw, normalized: raw.map(norm) };
}

function emptyMatrix() {
        const m = {};
        for (const op of GOLD_OPS) {
                m[op] = {};
                for (const o of OBSERVED) m[op][o] = 0;
        }
        return m;
}

// ---------------------------------------------------------------------------
// Per-case runner (resume-safe)
// ---------------------------------------------------------------------------
async function runCase(c, idx, total) {
        const receiptPath = join(PER_CASE, `${c.id}.json`);
        if (!DRY && existsSync(receiptPath)) {
                const prev = JSON.parse(readFileSync(receiptPath, "utf8"));
                const hadError = prev.dream?.error || prev.probesEvaluated === undefined;
                if (!hadError) {
                        console.log(`[skip] ${c.id} (receipt exists, no error)`);
                        return prev;
                }
                console.log(`[rerun] ${c.id} (previous receipt had an error)`);
        }
        const started = Date.now();
        console.log(`[case ${idx + 1}/${total}] ${c.id} — ${c.desc.slice(0, 78)}`);

        // ISOLATED mem0 scope per case, wiped + seeded before the dream; the seed
        // markdown enters the platform exactly like production seeding.
        const scope = projectScope(`oa-${c.id}`);
        await wipeScope(scope);
        const seededBullets = await seedScope(scope, SEED);
        const seedRender = await renderScope(scope); // the memory the dream builds on

        // NEWEST-FIRST by created_at ?? ts descending (undreamedNotes() order).
        // The bi-temporal case's notes carry BOTH ts (event time) and created_at
        // (delivery time): delivery order decides the feed — the monday-state
        // note has the LATER created_at (delivered last) but the EARLIER event
        // time, and the event date rides in the note text.
        const ordered = c.notes
                .map((n, i) => ({ ...n, _i: i, _created: Date.parse(n.created_at ?? n.ts) }))
                .sort((a, b) => b._created - a._created || a._i - b._i);
        const noteScans = ordered.map((n) => scanUntrustedText(String(n.text)).rules);

        // ONE consolidation per case (live: real extraction + reconcile; dry:
        // verbatim infer:false + the no-op reconcile verdict).
        const dream = { error: null, stats: null, reconcileOps: null, rendered: "", durationMs: 0 };
        try {
                const t = Date.now();
                const outcome = await consolidateScope(
                        scope,
                        ordered.map((n, i) => ({ id: `${c.id}#${i}`, content: n.text, created_at: n._created })),
                        DRY ? { infer: false, reconcileLlmFn: noOpReconcileLlm } : {},
                );
                dream.durationMs = Date.now() - t;
                dream.stats = {
                        added: outcome.added,
                        merged: outcome.merged,
                        pruned: outcome.pruned,
                        quarantined: outcome.quarantined,
                        guardDeleted: outcome.guardDeleted,
                };
                dream.reconcileOps = (outcome.reconcileOps ?? []).map((o) => ({
                        op: o.op,
                        id: o.id,
                        text: o.text ?? null,
                        reason: o.reason ?? null,
                }));
                dream.rendered = outcome.rendered;
                if (!dream.rendered.trim() || !/^- /m.test(dream.rendered))
                        throw new Error("dream produced no substantive memories (render carries no bullets)");
        } catch (err) {
                dream.error = String(err?.message ?? err);
        }

        // ---- surfaces (probe whatever state actually exists — honest receipts)
        const platform = await getMemoryPlatform();
        const memories = await platform.getAll(scope);
        const render = await renderScope(scope); // the file-on-disk view (the render surface)
        const memRows = memories.map((m) => ({ id: m.id, createdAt: m.createdAt ?? null, updatedAt: m.updatedAt ?? null, text: m.text }));
        const memNorm = memories.map((m) => norm(m.text));
        const { raw: lineRows, normalized: lineNorm } = renderContentLines(render);

        // ---- per-fact presence + match counts (ALL facts — the ops ledger, not
        // just the probed ones; matched lines verbatim for the audit trail)
        const evals = {};
        for (const [fid, f] of Object.entries(c.facts)) {
                const re = new RegExp(f.match, "i");
                // onceMatch: a per-fact NARROWER regex for the `once`/dedup probes — the
                // broad `match` may legitimately hit SEVERAL DISTINCT facts that share a
                // keyword ("docker compose" hits both the stack fact and the compose-FILE
                // fact); `once` asks "does THIS fact exist as exactly one memory", which
                // needs the fact-specific signature, not the family keyword.
                const onceRe = f.onceMatch ? new RegExp(f.onceMatch, "i") : re;
                const memHitIdx = [];
                memNorm.forEach((t, i) => {
                        if (re.test(t)) memHitIdx.push(i);
                });
                const onceHitIdx = [];
                memNorm.forEach((t, i) => {
                        if (onceRe.test(t)) onceHitIdx.push(i);
                });
                const lineHits = [];
                lineNorm.forEach((l, i) => {
                        if (re.test(l)) lineHits.push(lineRows[i]);
                });
                evals[fid] = {
                        re,
                        onceRe,
                        present: memHitIdx.length > 0 || lineHits.length > 0,
                        memHitIds: memHitIdx.map((i) => memories[i].id),
                        memHitTexts: memHitIdx.map((i) => memories[i].text),
                        onceHitIds: onceHitIdx.map((i) => memories[i].id),
                        lineHits,
                        matchCount: memHitIdx.length,
                        onceMatchCount: onceHitIdx.length,
                };
        }

        // ---- absentCurrent for every current:false fact: no UNMARKED render-line
        // hit, and no UNMARKED search-hit text (the search uses the fact's own
        // match source as the query — "does retrieval surface the stale fact as
        // current?" — recorded as searchQuery in the receipt)
        const absentEvals = {};
        for (const [fid, f] of Object.entries(c.facts)) {
                if (f.current !== false) continue;
                const re = evals[fid].re;
                const violations = [];
                const exempt = [];
                lineNorm.forEach((l, i) => {
                        if (!re.test(l)) return;
                        const marker = historicalMarker(l);
                        if (marker) exempt.push({ surface: "render", line: lineRows[i], marker });
                        else violations.push({ surface: "render", line: lineRows[i] });
                });
                const searchQuery = String(f.match);
                const hits = await platform.search(searchQuery, scope, 10);
                const searchTop10 = hits.map((h, i) => ({ rank: i + 1, id: h.id, score: h.score ?? null, text: h.text }));
                hits.forEach((h, i) => {
                        const t = norm(h.text);
                        if (!re.test(t)) return;
                        const marker = historicalMarker(t);
                        if (marker) exempt.push({ surface: "search", rank: i + 1, id: h.id, text: h.text, marker });
                        else violations.push({ surface: "search", rank: i + 1, id: h.id, text: h.text });
                });
                absentEvals[fid] = {
                        pass: violations.length === 0,
                        violations,
                        exempt,
                        searchQuery,
                        searchTop10,
                };
        }

        // ---- probes (the assertion set; case pass = all probes pass)
        const p = c.probes ?? {};
        const probes = { present: {}, absentCurrent: {}, once: {}, maxMatchCount: {}, search: [] };
        for (const fid of p.present ?? []) {
                const e = evals[fid];
                probes.present[fid] = {
                        pass: e.present,
                        satisfiedBy: e.memHitIds.length && e.lineHits.length ? "platform+render" : e.memHitIds.length ? "platform" : e.lineHits.length ? "render" : null,
                        matchCount: e.matchCount,
                        matchedMemoryIds: e.memHitIds,
                        matchedMemoryTexts: e.memHitTexts,
                        matchedRenderLines: e.lineHits,
                };
        }
        for (const fid of p.absentCurrent ?? []) {
                const a = absentEvals[fid];
                probes.absentCurrent[fid] = a
                        ? { pass: a.pass, violations: a.violations, exemptHits: a.exempt, searchQuery: a.searchQuery, searchTop10: a.searchTop10 }
                        : { pass: false, violations: [], exemptHits: [], searchQuery: null, searchTop10: [] };
        }
        for (const fid of p.once ?? []) {
                const e = evals[fid];
                // onceMatch-aware: count with the fact-specific signature when provided
                const count = e.onceMatchCount ?? e.matchCount;
                probes.once[fid] = { pass: count === 1, count, matchedMemoryIds: e.onceHitIds ?? e.memHitIds };
        }
        for (const [fid, limit] of Object.entries(p.maxMatchCount ?? {})) {
                const e = evals[fid];
                probes.maxMatchCount[fid] = { pass: e.matchCount <= limit, count: e.matchCount, limit };
        }
        for (const s of p.search ?? []) {
                const hits = await platform.search(s.q, scope, 10);
                const re = evals[s.expect].re;
                let satisfiedRank = null;
                for (let i = 0; i < Math.min(5, hits.length); i++) {
                        if (re.test(norm(hits[i].text))) {
                                satisfiedRank = i + 1;
                                break;
                        }
                }
                probes.search.push({
                        q: s.q,
                        expect: s.expect,
                        pass: satisfiedRank !== null,
                        satisfiedByRank: satisfiedRank,
                        surface: satisfiedRank !== null ? "search" : null,
                        top10: hits.map((h, i) => ({ rank: i + 1, id: h.id, score: h.score ?? null, text: h.text })),
                });
        }

        // ---- ops scoring: per fact, observed ∈ applied / missed / over-applied /
        // wrong-winner (the gold-op ledger classified against the probe evidence)
        const factResults = {};
        for (const [fid, f] of Object.entries(c.facts)) {
                const e = evals[fid];
                let observed = null;
                let reason = "";
                if (dream.error) {
                        observed = "missed";
                        reason = `dream error: ${dream.error}`;
                } else if (f.op === "ADD") {
                        if (!e.present) {
                                observed = "missed";
                                reason = "fact not present on any surface";
                        } else if (e.matchCount > 1) {
                                observed = "over-applied";
                                reason = `${e.matchCount} distinct memories match the fact (duplicate)`;
                        } else {
                                observed = "applied";
                                reason = e.memHitIds.length ? "present in platform memory" : "present in render";
                        }
                } else if (f.op === "NOOP") {
                        // a restatement scores through its dedupOf target: the fact must be
                        // present AND exactly once — the restatement must not mint a second
                        // memory (its own loose regex would miscount legitimate neighbors)
                        const tid = f.dedupOf ?? fid;
                        const target = f.dedupOf ? evals[f.dedupOf] : e;
                        if (!target.present) {
                                observed = "missed";
                                reason = `restated fact ${tid} absent (dedup target missing)`;
                        } else if (target.matchCount > 1) {
                                observed = "over-applied";
                                reason = `restated fact ${tid} exists as ${target.matchCount} memories (duplicate pair)`;
                        } else {
                                observed = "applied";
                                reason = `fact ${tid} present exactly once (restatement deduped)`;
                        }
                } else if (f.op === "UPDATE") {
                        if (!e.present) {
                                observed = "missed";
                                reason = "updated (new) text not present on any surface";
                        } else {
                                const staleFacts = Object.entries(c.facts).filter(([, f2]) => f2.current === false);
                                const failedStale = staleFacts.filter(([id2]) => absentEvals[id2] && !absentEvals[id2].pass);
                                if (failedStale.length) {
                                        observed = "wrong-winner";
                                        reason = `old value still current: ${failedStale.map(([id2]) => id2).join(", ")}`;
                                } else {
                                        observed = "applied";
                                        reason = `new text present${staleFacts.length ? " and old value absent-current" : ""}`;
                                }
                        }
                } else if (f.op === "DELETE") {
                        const a = absentEvals[fid];
                        if (!a || !a.pass) {
                                observed = "wrong-winner";
                                reason = a
                                        ? `superseded/revoked fact still stated as current (${a.violations.length} unmarked hit(s))`
                                        : "absentCurrent not evaluated (fact lacks current:false?)";
                        } else {
                                const pair = Object.entries(c.facts).find(([, f2]) => f2.current === true);
                                if (pair && !evals[pair[0]].present) {
                                        observed = "missed";
                                        reason = `replacement fact ${pair[0]} absent`;
                                } else {
                                        observed = "applied";
                                        reason = `old value absent-current${pair ? ` (replacement ${pair[0]} present)` : ""}`;
                                }
                        }
                }
                if (!observed) {
                        observed = "missed";
                        reason = `unhandled op ${f.op}`;
                }
                factResults[fid] = {
                        op: f.op,
                        desc: f.desc,
                        current: f.current ?? null,
                        dedupOf: f.dedupOf ?? null,
                        present: e.present,
                        matchCount: e.matchCount,
                        matchedMemoryIds: e.memHitIds,
                        matchedRenderLines: e.lineHits,
                        absentCurrentPass: absentEvals[fid]?.pass ?? null,
                        observed,
                        reason,
                };
        }

        const opsMatrix = emptyMatrix();
        for (const fr of Object.values(factResults)) opsMatrix[fr.op][fr.observed] += 1;

        const probeBooleans = [
                ...Object.values(probes.present).map((x) => x.pass),
                ...Object.values(probes.absentCurrent).map((x) => x.pass),
                ...Object.values(probes.once).map((x) => x.pass),
                ...Object.values(probes.maxMatchCount).map((x) => x.pass),
                ...probes.search.map((x) => x.pass),
        ];
        const casePass = !dream.error && probeBooleans.length > 0 && probeBooleans.every(Boolean);
        const probesEvaluated = probeBooleans.length;

        const receipt = {
                suite: "ops-accuracy",
                id: c.id,
                desc: c.desc,
                model: MODEL,
                date: new Date().toISOString(),
                durationMs: Date.now() - started,
                scope: scope.agentId,
                notesFed: ordered.map((n, i) => ({
                        order: i + 1,
                        ts: n.ts,
                        created_at: n.created_at ?? null,
                        fedBy: n.created_at ? "created_at" : "ts",
                        eventTimeInText: n.created_at ? true : null,
                        text: n.text,
                })),
                noteRules: noteScans,
                seed: { bullets: seededBullets, render: seedRender },
                dream: {
                        error: dream.error,
                        stats: dream.stats,
                        reconcileOps: dream.reconcileOps,
                        renderedCandidate: dream.rendered,
                        durationMs: dream.durationMs,
                        dreamCalls: dream.error ? 0 : 1,
                },
                render, // the render surface (file-on-disk view) the probes classified
                platform: { memoryCount: memRows.length, memories: memRows },
                probes,
                probesEvaluated,
                facts: factResults,
                opsMatrix,
                pass: casePass,
                notes:
                        "probes are deterministic regex/line classification over normalized text (lowercase, whitespace collapsed, bullet markers stripped); absentCurrent exemptions carry the historical-marker word; every verdict is auditable from matched lines/counts/surfaces recorded here",
        };
        if (!DRY) writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

        // ---- console trail
        console.log(
                `  dream: ${dream.error ? `ERROR ${dream.error.slice(0, 110)}` : `${render.length} chars, ${memRows.length} memories, added=${dream.stats.added} merged=${dream.stats.merged} pruned=${dream.stats.pruned} reconcileOps=${dream.reconcileOps.length}, ${dream.durationMs}ms`}`,
        );
        if (!dream.error) {
                const cnt = (o) => `${Object.values(o).filter((x) => x?.pass).length}/${Object.keys(o).length}`;
                console.log(
                        `  probes: present ${cnt(probes.present)} · absentCurrent ${cnt(probes.absentCurrent)} · once ${cnt(probes.once)} · maxMatchCount ${cnt(probes.maxMatchCount)} · search ${probes.search.filter((s) => s.pass).length}/${probes.search.length}`,
                );
                const applied = Object.values(factResults).filter((f) => f.observed === "applied").length;
                const notApplied = Object.entries(factResults)
                        .filter(([, f]) => f.observed !== "applied")
                        .map(([fid, f]) => `${fid}:${f.observed}`);
                console.log(
                        `  ops: ${applied}/${Object.keys(factResults).length} applied${notApplied.length ? ` — ${notApplied.join(" ")}` : ""} ${DRY ? "(dry — not meaningful without the LLM)" : ""}`,
                );
        }
        console.log(`  -> ${casePass ? "PASS" : dream.error ? "ERROR" : "FAIL"} (${Math.round(receipt.durationMs / 1000)}s)`);
        return receipt;
}

// ---------------------------------------------------------------------------
// Confusion matrix + opsF1
// ---------------------------------------------------------------------------
function aggregateMatrix(receipts) {
        const matrix = emptyMatrix();
        for (const r of receipts) {
                for (const op of GOLD_OPS) for (const o of OBSERVED) matrix[op][o] += r.opsMatrix?.[op]?.[o] ?? 0;
        }
        return matrix;
}
function opsF1(matrix) {
        const perOp = {};
        for (const op of GOLD_OPS) {
                const row = matrix[op];
                const facts = OBSERVED.reduce((n, o) => n + row[o], 0);
                if (!facts) continue;
                const denom = row.applied + 0.5 * (row.missed + row["over-applied"] + row["wrong-winner"]);
                perOp[op] = {
                        facts,
                        applied: row.applied,
                        f1: denom > 0 ? Number((row.applied / denom).toFixed(3)) : 1,
                };
        }
        const ops = Object.keys(perOp);
        const macro = ops.length ? Number((ops.reduce((n, op) => n + perOp[op].f1, 0) / ops.length).toFixed(3)) : null;
        return { perOp, macro, opsAveraged: ops };
}

// ---------------------------------------------------------------------------
// --dry main: full plumbing, zero bridge calls, no receipts
// ---------------------------------------------------------------------------
/**
 * Exercises the FULL plumbing (wipe -> seed -> verbatim infer:false adds ->
 * reconcile seam -> render -> probes -> ops classification) with zero bridge
 * calls and no receipt writes, then asserts plumbing health (NOT quality —
 * without the extraction/reconcile LLM the verbatim notes simply accumulate,
 * so absentCurrent/once/ops verdicts are meaningless by construction). What
 * must hold: every stage ran, every probe classified with a recorded
 * verdict, and — because infer:false stores the notes VERBATIM — every
 * present-probe regex must hit its note text, the dream render must match a
 * fresh re-render (footer-timestamp insensitive), and scopes must not leak
 * content across cases. Search probes must have executed and recorded their
 * ranked top-10, but their PASS is not asserted: mem0's Memory.search drops
 * results under its 0.1 similarity threshold and the forced lexical embedder
 * keeps hyphenated tokens whole, so zero hits is a legal deterministic
 * outcome in this lane (surfaced as an informational note, and honestly
 * failing the probe).
 */
async function runDry(cases) {
        const t0 = Date.now();
        console.log(
                `[dry] no-LLM smoke mode — full plumbing, zero bridge calls, no receipt writes (model ${MODEL}, embedder forced lexical, ${cases.length} case(s))`,
        );
        const failures = [];
        const receipts = [];
        for (let i = 0; i < cases.length; i++) receipts.push(await runCase(cases[i], i, cases.length));
        for (const r of receipts) {
                if (r.dream.error) failures.push(`${r.id}: dream error: ${r.dream.error}`);
                if (!r.render || r.render.trim().length < 60 || !/^- /m.test(r.render)) failures.push(`${r.id}: empty/unbulleted render`);
                if (!r.dream.stats || typeof r.dream.stats.added !== "number") failures.push(`${r.id}: no platform stats (consolidate outcome missing)`);
                if (!(r.platform.memoryCount > 0)) failures.push(`${r.id}: no memories in scope after the dream`);
                if (!(r.seed.render ?? "").includes("aurora-gateway")) failures.push(`${r.id}: seed bullets missing from the pre-dream render`);
                if (r.probesEvaluated === 0) failures.push(`${r.id}: no probes evaluated`);
                // verbatim notes are memories in --dry: every present probe MUST hit
                for (const [fid, pr] of Object.entries(r.probes.present))
                        if (!pr.pass) failures.push(`${r.id}: present probe ${fid} missed the verbatim note (probe engine or surface collection broken)`);
                // search probes must have executed and recorded their ranked top-10; the
                // PASS itself is not asserted in --dry — mem0's Memory.search drops
                // results under its 0.1 similarity threshold, and the forced lexical
                // embedder keeps hyphenated tokens whole ("feature-flags" never matches
                // the split query tokens "feature"/"flags"), so zero hits is a legal
                // deterministic outcome here, not a plumbing break (recorded below)
                for (const s of r.probes.search) {
                        if (!Array.isArray(s.top10)) failures.push(`${r.id}: search probe "${s.q}" recorded no ranked results`);
                        if (s.top10.length === 0) console.log(`[dry] note: search "${s.q}" returned 0 hits (lexical embedder + mem0 0.1 threshold) — probe honestly FAILS in this lane`);
                }
                // every probe that ran must have recorded a boolean verdict
                for (const [fid, pr] of Object.entries(r.probes.absentCurrent))
                        if (typeof pr.pass !== "boolean") failures.push(`${r.id}: absentCurrent probe ${fid} has no boolean verdict`);
                for (const [fid, pr] of Object.entries(r.probes.once))
                        if (typeof pr.count !== "number" || typeof pr.pass !== "boolean") failures.push(`${r.id}: once probe ${fid} has no recorded count`);
                // the render surface must be a faithful re-render of the platform state
                if (!r.dream.error && !renderFooterMatches(r.dream.renderedCandidate, r.render))
                        failures.push(`${r.id}: dream render and fresh renderScope diverged (render surface not faithful)`);
                // every fact must carry an observed classification
                for (const [fid, fr] of Object.entries(r.facts))
                        if (!OBSERVED.includes(fr.observed)) failures.push(`${r.id}: fact ${fid} has no observed classification`);
        }
        // ---- cross-scope isolation probes (only pairs that ran): case A's unique
        // token must not appear in case B's render — scopes are isolated mem0
        // agent_ids within the one scratch platform dir
        const ISOLATION_PROBES = [
                ["add-basic", "8787", "supersede"],
                ["supersede", "postgres 16", "add-basic"],
        ];
        const byId = new Map(receipts.map((r) => [r.id, r]));
        for (const [owner, token, other] of ISOLATION_PROBES) {
                if (!byId.has(owner) || !byId.has(other)) continue;
                if ((byId.get(other).render ?? "").includes(token))
                        failures.push(`isolation: ${other}'s render carries ${owner}'s token "${token}" (scope leak)`);
        }
        const ms = Date.now() - t0;
        const matrix = aggregateMatrix(receipts);
        const f1 = opsF1(matrix);
        console.log(`\n[dry] gold-op × observed matrix (NOT meaningful without the LLM — verbatim accumulation):`);
        for (const op of GOLD_OPS) {
                const row = matrix[op];
                if (!OBSERVED.some((o) => row[o])) continue;
                console.log(
                        `  ${(op + ":").padEnd(8)} applied=${row.applied} missed=${row.missed} over-applied=${row["over-applied"]} wrong-winner=${row["wrong-winner"]}`,
                );
        }
        console.log(`  opsF1 (dry, informational only): ${f1.macro}`);
        if (failures.length) {
                console.error(`\n[dry] ${failures.length} plumbing failure(s):`);
                for (const f of failures) console.error(`  - ${f}`);
                process.exit(1);
        }
        console.log(`\n[dry] PASS — ${receipts.length} case(s) exercised end-to-end in ${ms}ms (plumbing only; ops verdicts are live-mode only)`);
}

// ---------------------------------------------------------------------------
// Bridge gate + main
// ---------------------------------------------------------------------------
async function main() {
        const cases = selectedCases();
        const corpusErrors = validateCorpus(cases);
        if (corpusErrors.length) {
                console.error(`corpus validation failed (${corpusErrors.length} error(s)):`);
                for (const e of corpusErrors) console.error(`  - ${e}`);
                process.exit(1);
        }
        if (DRY) {
                await runDry(cases);
                return;
        }
        const health = await bridgeHealth();
        if (!health?.ok) {
                console.error(`llm-bridge on :3031 is not healthy — aborting before any dream call: ${JSON.stringify(health)}`);
                process.exit(1);
        }
        console.log(
                `bridge healthy (model ${MODEL}, upstream ${health.upstream?.status ?? "?"}) — ${cases.length} case(s), ONE dream each (mem0 extraction + reconcile per case, sequential)`,
        );

        const receipts = [];
        for (let i = 0; i < cases.length; i++) receipts.push(await runCase(cases[i], i, cases.length));

        const matrix = aggregateMatrix(receipts);
        const f1 = opsF1(matrix);
        const allPass = receipts.length > 0 && receipts.every((r) => r.pass);
        const summary = {
                suite: "ops-accuracy",
                date: new Date().toISOString(),
                model: MODEL,
                dreamPath: "mem0 consolidate (structural quarantine -> extraction add -> guard sweep -> reconcile -> render) via _lib/dream-pipeline.mjs",
                platform: platformInfo(),
                bridgeUpstreamStatus: health.upstream?.status ?? null,
                corpus: { version: corpus.version ?? null, casesTotal: corpus.cases.length, casesRun: receipts.length },
                casesPassed: receipts.filter((r) => r.pass).length,
                casesTotal: receipts.length,
                failedCases: receipts.filter((r) => !r.pass).map((r) => r.id),
                caseResults: Object.fromEntries(
                        receipts.map((r) => [
                                r.id,
                                {
                                        pass: r.pass,
                                        dreamError: r.dream.error ?? null,
                                        dreamCalls: r.dream.dreamCalls,
                                        durationMs: r.durationMs,
                                        probesEvaluated: r.probesEvaluated,
                                        factsApplied: `${Object.values(r.facts).filter((f) => f.observed === "applied").length}/${Object.keys(r.facts).length}`,
                                },
                        ]),
                ),
                opsConfusionMatrix: matrix, // rows = goldOp (ADD/UPDATE/DELETE/NOOP), columns = observed
                opsF1: f1,
                dreamCallsTotal: receipts.reduce((n, r) => n + (r.dream.dreamCalls ?? 0), 0),
                totalDurationMs: receipts.reduce((n, r) => n + (r.durationMs ?? 0), 0),
                errors: receipts.filter((r) => r.dream.error).map((r) => ({ id: r.id, error: r.dream.error })),
                pass: allPass,
                perCase:
                        "(see results/per-case/<id>.json — notes fed (order + fedBy), dream outcome fields, render, per-probe matched lines/counts/surfaces, per-fact observed + reason)",
        };
        writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));

        console.log("\n=== ops-accuracy summary ===");
        console.log("gold-op \\ observed   applied  missed  over-applied  wrong-winner");
        for (const op of GOLD_OPS) {
                const row = matrix[op];
                if (!OBSERVED.some((o) => row[o])) continue;
                console.log(
                        `${(op + ":").padEnd(18)} ${String(row.applied).padStart(7)} ${String(row.missed).padStart(7)} ${String(row["over-applied"]).padStart(13)} ${String(row["wrong-winner"]).padStart(13)}`,
                );
        }
        for (const [op, o] of Object.entries(f1.perOp)) console.log(`  opsF1[${op}] = ${o.f1} (${o.applied}/${o.facts} applied)`);
        console.log(`opsF1 (macro over ${f1.opsAveraged.join(", ")}) = ${f1.macro}`);
        console.log(
                `cases: ${summary.casesPassed}/${summary.casesTotal} passed${summary.failedCases.length ? ` — fail: ${summary.failedCases.join(", ")}` : ""} · dream calls: ${summary.dreamCallsTotal} · total ${Math.round(summary.totalDurationMs / 1000)}s · receipts in ${RESULTS}`,
        );
        if (!allPass) {
                console.error("\nsuite FAIL — not every case passed (see results/per-case/<id>.json for the audit trail)");
                process.exit(1);
        }
}

if (import.meta.main) {
        await main();
}
