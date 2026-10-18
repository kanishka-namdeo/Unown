#!/usr/bin/env bun
/**
 * recall-qa/runner.mjs — LongMemEval-adapted multi-session QA-recall
 * benchmark (roadmap item 13 / docs/testing-strategy.md §10 M): after
 * sessions are dream-consolidated, does the injected memory let a FRESH
 * session ANSWER QUESTIONS about what happened? (The memory loop's core
 * value proposition — today only mechanics are tested, not recall.)
 *
 * Per case, against the PRODUCTION dream path (SYSTEM prompt from
 * src/dream.ts, chatJson/chatText from src/llm.ts, guard from src/guard.ts
 * — imported, not re-implemented; helpers copied, never imported from
 * sibling benchmarks):
 *
 *   1. NOTES: the case's oracle haystack sessions (1-3) each become ONE
 *      Unown session note — a trimmed transcript: evidence turns
 *      (has_answer=true) kept full first, filler turns trimmed/dropped to
 *      fit the ~4000-char note budget.
 *   2. DREAM: one chatJson call with the production SYSTEM prompt + a
 *      realistic established CURRENT_PROJECT_MEMORY + the notes, fed
 *      NEWEST-FIRST with real quarantine banners (scanUntrustedText +
 *      noteGuardBanner) — mirroring runDream()/undreamedNotes() fidelity.
 *   3. GUARD: decideGuardAction(candidate, current, {firstMint:false}) —
 *      the shipped memory is what the engine would actually inject:
 *      gate -> the pre-dream memory ships (nothing new), sanitize ->
 *      quarantined-out remainder, ship -> candidate verbatim.
 *   4. QA, TWO ARMS (both recorded per case, identical question message):
 *        warm — system message contains the SHIPPED (post-dream) memory
 *        cold — control: the same QA call WITHOUT the dream memory (the
 *               pre-dream seed memory only — what a fresh session would
 *               see if AutoDream had never run)
 *      max_tokens 300.
 *   5. SCORING (judge-free): normalized exact-match — content-word overlap
 *      >= 0.6 of the dataset's ground-truth answer in the response, or a
 *      4-word phrase hit (mpbench-style matcher, copied; numerals count as
 *      content words with digit-letter splitting, and 1-2-word ground
 *      truths require a full hit — see the scorer block for the two
 *      documented deviations). The
 *      headline is the LIFT: warm pass rate − cold pass rate (memory must
 *      beat no-memory). Also recorded per case: evidenceRetention — the
 *      same matcher run against the SHIPPED MEMORY (did the dream keep
 *      the answer's content words at all) — decomposes failures into
 *      consolidation loss vs retrieval loss.
 *
 * Resume-safe: cases with an existing receipt are skipped.
 * Usage: bun runner.mjs [--fresh] [--limit N]
 * Requires the llm-bridge on :3031 (checked before any call).
 * Receipts: results/per-case/<id>.json + results/summary.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const RESULTS = join(HERE, "results");
const PER_CASE = join(RESULTS, "per-case");

// Scratch env BEFORE importing the package (store.ts opens SQLite at import):
// the benchmark never touches the live engine DB.
process.env.PI_SELFLEARNING_DATA ??= "/home/z/my-project/scratch-mem/recall-qa/data";
process.env.PI_SELFLEARNING_DB ??= "/home/z/my-project/scratch-mem/recall-qa/db/recall-qa.db";
process.env.PI_MODEL_ID ??= "kimi-k2.5";
process.env.PI_PROVIDER ??= "zai-bridge";

const { SYSTEM } = await import("../../../pi-repo/packages/self-learning/src/dream.ts");
const { chatJson, chatText, bridgeHealth } = await import("../../../pi-repo/packages/self-learning/src/llm.ts");
const { scanUntrustedText, noteGuardBanner, decideGuardAction } = await import(
        "../../../pi-repo/packages/self-learning/src/guard.ts",
);

const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));
const MODEL = process.env.PI_MODEL_ID ?? corpus.model ?? "kimi-k2.5";

if (process.argv.includes("--fresh")) rmSync(PER_CASE, { recursive: true, force: true });
mkdirSync(PER_CASE, { recursive: true });
const LIMIT = process.argv.includes("--limit")
        ? Number(process.argv[process.argv.indexOf("--limit") + 1])
        : Infinity;

/**
 * A current-memory stand-in: realistic, established, benign — an early v2
 * project memory whose project IS the long-running user engagement, so
 * durable user facts/events/preferences have a legitimate home (the mpbench
 * lesson: without a section the dream can place them in, user-domain facts
 * legitimately fail to consolidate).
 */
const CURRENT_MEMORY = `# Tier 1 — Project Memory

## Workflow
- Terminal session notes are consolidated here by AutoDream; keep bullets short and sourced [seed].
- Answer the user's questions from this memory first; general knowledge only as fallback [note 1].
- When the user states a durable fact, event, or preference, record it precisely here [note 3].

## User context
- The user works with this assistant across many sessions on personal and work matters; their standing facts, events, and preferences live in this section [note 2].

## Known pitfalls
- Prefer standard library functions over hand-rolled logic [note 4].
`;

// ---------------------------------------------------------------------------
// Normalized exact-match scorer (mpbench words()/overlap style, copied).
// Two documented deviations from mpbench semantics, both because numeric/unit
// answers are the recall payload: (1) numerals count as content words AND
// digit-letter boundaries split ("7pm" -> "7 pm") so fused answers score;
// (2) for 1-2 content-word ground truths the pass requires ALL of them
// (mpbench allowed one miss — rule-matching semantics; here a unit-only
// match on a wrong number must NOT pass).
// ---------------------------------------------------------------------------
const STOP = new Set(
        "a an the to of in on for with and or is are was were be been being do does did must should would could may might will shall can this that these those it its as at by from into if then than when where who whom which what how not no yes please make sure all any every always never your you we they he she i my our their there here about over under again once also just only own same so too very".split(
                " ",
        ),
);
function words(s) {
        return String(s)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .replace(/(\d)([a-z])/g, "$1 $2")
                .replace(/([a-z])(\d)/g, "$1 $2")
                .split(/\s+/)
                .filter((w) => w.length > 0 && (/^\d{1,4}$/.test(w) || (w.length > 2 && !STOP.has(w))));
}
/** 4-gram phrase containment: any 4 consecutive content words of `expected` in `candidate`. */
function phraseHit(expected, candidate) {
        const e = words(expected);
        const c = words(candidate).join(" ");
        for (let i = 0; i + 4 <= e.length; i++) {
                if (c.includes(e.slice(i, i + 4).join(" "))) return e.slice(i, i + 4).join(" ");
        }
        return null;
}
/** Returns { pass, score, hit, total, hitWords, phrase } for the audit trail. */
function matchAnswer(expected, candidate) {
        if (!candidate) return { pass: false, score: 0, hit: 0, total: 0, hitWords: [], phrase: null };
        const e = words(expected);
        if (e.length === 0) return { pass: false, score: 0, hit: 0, total: 0, hitWords: [], phrase: null };
        const cand = new Set(words(candidate));
        const hitWords = e.filter((w) => cand.has(w));
        const hit = hitWords.length;
        const phrase = phraseHit(expected, candidate);
        const pass = e.length >= 3 ? hit / e.length >= 0.6 || phrase !== null : hit >= Math.max(1, e.length);
        return { pass, score: Number((hit / e.length).toFixed(3)), hit, total: e.length, hitWords, phrase };
}

// ---------------------------------------------------------------------------
// Step 1 — session history -> Unown session notes (deterministic trim)
// ---------------------------------------------------------------------------
const NOTE_BUDGET = 4000; // ~chars per session note (pipeline note budget)
const ANS_CAP = 3200; // evidence turns: full, hard cap only
const FILLER_CAP = 400; // filler turns: context snippet

/**
 * One session -> one note. Evidence turns (hasAnswer) are kept full FIRST;
 * filler is trimmed (400 chars/turn) and the longest fillers dropped first
 * only when the note would exceed its budget — the answer evidence is never
 * cut before filler. Turns render in conversation order.
 */
function buildNote(session, questionId) {
        const preamble = `Session with the user on ${session.date} — conversation transcript; durable user facts, events, and preferences are worth remembering:`;
        const label = (t) => (t.role === "user" ? "User" : "Assistant");
        const caps = session.turns.map((t) => (t.hasAnswer ? Math.min(t.content.length, ANS_CAP) : Math.min(t.content.length, FILLER_CAP)));
        const dropped = [];
        const fits = () => caps.reduce((n, c) => n + c, 0) + labelOverhead(session.turns, caps) <= NOTE_BUDGET - preamble.length;
        function labelOverhead(turns, cs) {
                let n = 0;
                turns.forEach((t, i) => {
                        if (cs[i] > 0) n += label(t).length + 2 + 1; // "User: " + newline
                });
                return n;
        }
        // drop the LONGEST filler turns (cap -> 0) until the note fits
        if (!fits()) {
                const fillerIdx = session.turns
                        .map((t, i) => ({ i, filler: !t.hasAnswer, len: caps[i] }))
                        .filter((x) => x.filler && x.len > 0)
                        .sort((a, b) => b.len - a.len);
                for (const f of fillerIdx) {
                        if (fits()) break;
                        dropped.push(f.i);
                        caps[f.i] = 0;
                }
        }
        // still over (evidence alone exceeds the budget): scale evidence caps down
        if (!fits()) {
                const ansIdx = session.turns.map((t, i) => ({ i, ans: t.hasAnswer })).filter((x) => x.ans);
                const room = NOTE_BUDGET - preamble.length - labelOverhead(session.turns, caps) - 20;
                const per = Math.max(300, Math.floor(room / Math.max(1, ansIdx.length)));
                for (const a of ansIdx) caps[a.i] = Math.min(caps[a.i], per);
        }
        const body = session.turns
                .map((t, i) => (caps[i] > 0 ? `${label(t)}: ${t.content.slice(0, caps[i])}` : null))
                .filter((x) => x !== null)
                .join("\n\n");
        const text = `${preamble}\n\n${body}`;
        return {
                ts: new Date(session.dateMs).toISOString(),
                run: questionId.slice(0, 8),
                text,
                sessionId: session.sessionId,
                date: session.date,
                trim: {
                        turnsIn: session.turns.length,
                        turnsKept: session.turns.filter((_, i) => caps[i] > 0).length,
                        fillerDropped: dropped.length,
                        chars: text.length,
                },
        };
}

// ---------------------------------------------------------------------------
// Step 2/3 — dream + guard (mirrors runDream in src/dream.ts)
// ---------------------------------------------------------------------------
async function dreamCase(c, notes) {
        // NEWEST-FIRST note order (undreamedNotes() ORDER BY created_at DESC);
        // chronology rides on the note timestamps, exactly like the real pipeline
        const ordered = [...notes].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
        const scans = ordered.map((n) => scanUntrustedText(n.text));
        const notesText = ordered
                .map((n, i) => {
                        const banner = scans[i].rules.length > 0 ? `${noteGuardBanner(scans[i])}\n` : "";
                        return `--- note (${n.ts}) run=${n.run} ---\n${banner}${n.text}`;
                })
                .join("\n\n");
        const user = `CURRENT PROJECT MEMORY (version 2):\n\n${CURRENT_MEMORY}\n\nSESSION NOTES SINCE LAST DREAM (${ordered.length}):\n\n${notesText}`;
        const started = Date.now();
        let candidate = "";
        let stats = null;
        let error = null;
        try {
                const result = await chatJson(
                        [
                                { role: "system", content: SYSTEM },
                                { role: "user", content: user },
                        ],
                        { maxTokens: 3000 },
                );
                candidate = `${String(result.projectMd ?? "").trim()}\n`;
                stats = result.stats ?? null;
                if (!candidate.trim() || candidate.trim().length < 60) throw new Error("dream produced empty memory");
        } catch (err) {
                error = String(err?.message ?? err);
        }
        // Guard + what the engine would actually ship. On dream error the engine
        // keeps the OLD memory (nothing ships) — the warm arm then equals cold.
        let guard = null;
        let shipped = CURRENT_MEMORY;
        if (!error) {
                guard = decideGuardAction(candidate, CURRENT_MEMORY, { firstMint: false });
                shipped = guard.action === "gate" ? CURRENT_MEMORY : guard.sanitized;
        }
        return {
                dream: {
                        error,
                        stats,
                        candidate,
                        guard: guard
                                ? {
                                                action: guard.action,
                                                flags: guard.flags.map((f) => ({ line: f.line, rule: f.rule, text: f.text })),
                                                reason: guard.reason ?? null,
                                                unprovenancedNewLines: guard.unprovenancedNewLines,
                                        }
                                : null,
                        shipped,
                        durationMs: Date.now() - started,
                },
                notesInput: notesText,
                noteScans: scans.map((s) => s.rules),
        };
}

// ---------------------------------------------------------------------------
// Step 4/5 — QA arms
// ---------------------------------------------------------------------------
const QA_SYSTEM_PREAMBLE = `You are the assistant in a fresh session on this project. The project memory from past sessions is injected below. Answer the user's question using the project memory when it contains the answer; use general knowledge only where the memory does not say. Be concise (1-2 sentences).`;
function qaUserMessage(c) {
        return `Current date: ${c.questionDate}\n\n${c.question}\n\nAnswer using the project memory above when it contains the answer.`;
}
async function qaArm(memory, c) {
        const started = Date.now();
        try {
                const answer = await chatText(
                        [
                                { role: "system", content: `${QA_SYSTEM_PREAMBLE}\n\nPROJECT MEMORY (injected):\n\n${memory}` },
                                { role: "user", content: qaUserMessage(c) },
                        ],
                        { maxTokens: 300 },
                );
                return { answer, durationMs: Date.now() - started, error: null };
        } catch (err) {
                return { answer: null, durationMs: Date.now() - started, error: String(err?.message ?? err) };
        }
}

// ---------------------------------------------------------------------------
// Per-case runner (resume-safe)
// ---------------------------------------------------------------------------
async function runCase(c, idx) {
        const receiptPath = join(PER_CASE, `${c.id}.json`);
        if (existsSync(receiptPath)) {
                console.log(`[skip] ${c.id} (receipt exists)`);
                return JSON.parse(readFileSync(receiptPath, "utf8"));
        }
        const started = Date.now();
        console.log(`[case ${idx + 1}/${corpus.cases.length}] ${c.id} ${c.questionType} — Q: ${c.question.slice(0, 70)}`);
        const notes = c.sessions.map((s) => buildNote(s, c.id));
        const { dream, notesInput, noteScans } = await dreamCase(c, notes);
        console.log(
                `  dream: ${dream.error ? `ERROR ${dream.error.slice(0, 100)}` : `${dream.candidate.length} chars, guard=${dream.guard.action}, ${dream.durationMs}ms`}${noteScans.some((r) => r.length > 0) ? ` [flagged notes: ${noteScans.filter((r) => r.length > 0).length}/${notes.length}]` : ""}`,
        );
        const warm = await qaArm(dream.shipped, c);
        const cold = await qaArm(CURRENT_MEMORY, c);
        const warmMatch = warm.answer ? matchAnswer(c.answer, warm.answer) : null;
        const coldMatch = cold.answer ? matchAnswer(c.answer, cold.answer) : null;
        // consolidation funnel: were the gt answer's content words kept in the
        // SHIPPED memory at all (what the dream chose to keep vs drop)?
        const retention = dream.error ? null : matchAnswer(c.answer, dream.shipped);
        const receipt = {
                id: c.id,
                questionType: c.questionType,
                question: c.question,
                gtAnswer: c.answer,
                questionDate: c.questionDate,
                model: MODEL,
                durationMs: Date.now() - started,
                notes: notes.map((n) => ({ ts: n.ts, run: n.run, date: n.date, sessionId: n.sessionId, trim: n.trim, text: n.text })),
                noteFlagged: noteScans.some((r) => r.length > 0),
                noteRules: noteScans,
                notesInput,
                dream: dream.error
                        ? { error: dream.error, shipped: dream.shipped, durationMs: dream.durationMs }
                        : {
                                        stats: dream.stats,
                                        candidate: dream.candidate,
                                        guard: dream.guard,
                                        shipped: dream.shipped,
                                        durationMs: dream.durationMs,
                                },
                warm: { answer: warm.answer, error: warm.error, durationMs: warm.durationMs, match: warmMatch },
                cold: { answer: cold.answer, error: cold.error, durationMs: cold.durationMs, match: coldMatch },
                evidenceRetentionInShipped: retention,
        };
        writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
        console.log(
                `  warm: ${warm.error ? `ERROR ${warm.error.slice(0, 80)}` : `${warmMatch.pass ? "PASS" : "fail"} (${warmMatch.score}) — ${String(warm.answer).slice(0, 90).replace(/\n/g, " ")}`}`,
        );
        console.log(
                `  cold: ${cold.error ? `ERROR ${cold.error.slice(0, 80)}` : `${coldMatch.pass ? "PASS" : "fail"} (${coldMatch.score}) — ${String(cold.answer).slice(0, 90).replace(/\n/g, " ")}`}`,
        );
        return receipt;
}

// ---------------------------------------------------------------------------
// Bridge gate + main
// ---------------------------------------------------------------------------
async function main() {
        const health = await bridgeHealth();
        if (!health?.ok) {
                console.error(`llm-bridge on :3031 is not healthy — aborting before any call: ${JSON.stringify(health)}`);
                process.exit(1);
        }
        console.log(
                `bridge healthy (model ${MODEL}, upstream ${health.upstream?.status ?? "?"}) — ${Math.min(LIMIT, corpus.cases.length)} cases x (1 dream + 2 QA) ≈ ${Math.min(LIMIT, corpus.cases.length) * 3} LLM calls`,
        );

        const cases = corpus.cases.slice(0, Math.min(LIMIT, corpus.cases.length));
        const receipts = [];
        for (let i = 0; i < cases.length; i++) receipts.push(await runCase(cases[i], i));

        const rate = (arr, pred) => (arr.length ? Number(arr.filter(pred).length / arr.length).toFixed(3) : null);
        const warmPass = rate(receipts, (r) => r.warm.match?.pass === true);
        const coldPass = rate(receipts, (r) => r.cold.match?.pass === true);
        const lift = warmPass !== null && coldPass !== null ? Number((Number(warmPass) - Number(coldPass)).toFixed(3)) : null;
        const byType = {};
        for (const r of receipts) {
                (byType[r.questionType] ??= []).push(r);
        }
        const typeTable = {};
        for (const [type, rows] of Object.entries(byType)) {
                typeTable[type] = {
                        n: rows.length,
                        warmPass: rate(rows, (r) => r.warm.match?.pass === true),
                        coldPass: rate(rows, (r) => r.cold.match?.pass === true),
                        lift: Number(
                                (Number(rate(rows, (r) => r.warm.match?.pass === true)) - Number(rate(rows, (r) => r.cold.match?.pass === true))).toFixed(3),
                        ),
                        evidenceRetained: rate(rows, (r) => r.evidenceRetentionInShipped?.pass === true),
                        dreamErrors: rows.filter((r) => r.dream.error).length,
                };
        }
        const summary = {
                suite: "recall-qa-longmemeval",
                date: new Date().toISOString(),
                model: MODEL,
                bridgeUpstreamStatus: health.upstream?.status ?? null,
                source: corpus.source,
                seed: corpus.seed,
                n: receipts.length,
                warmPassRate: warmPass,
                coldPassRate: coldPass,
                lift,
                headline: "lift = warm − cold: the dream-consolidated memory's added recall over the no-dream control",
                arms: {
                        warm: "system message contains the SHIPPED post-dream memory (gate -> pre-dream memory ships; sanitize -> quarantined remainder)",
                        cold: "control: same QA call WITHOUT the dream memory (pre-dream seed memory only — AutoDream never ran)",
                },
                byType: typeTable,
                consolidationFunnel: {
                        evidenceRetainedInShippedRate: rate(receipts, (r) => r.evidenceRetentionInShipped?.pass === true),
                        meanEvidenceRetentionScore: Number(
                                (receipts.filter((r) => r.evidenceRetentionInShipped).reduce((n, r) => n + (r.evidenceRetentionInShipped?.score ?? 0), 0) / Math.max(1, receipts.filter((r) => r.evidenceRetentionInShipped).length)).toFixed(3),
                        ),
                        gatedCases: receipts.filter((r) => r.dream.guard?.action === "gate").map((r) => r.id),
                        sanitizedCases: receipts.filter((r) => r.dream.guard?.action === "sanitize").map((r) => r.id),
                        flaggedNoteCases: receipts.filter((r) => r.noteFlagged).map((r) => r.id),
                        meanCandidateChars: Number(
                                (receipts.filter((r) => r.dream.candidate).reduce((n, r) => n + (r.dream.candidate?.length ?? 0), 0) / Math.max(1, receipts.filter((r) => r.dream.candidate).length)).toFixed(0),
                        ),
                },
                errors: receipts
                        .filter((r) => r.dream.error || r.warm.error || r.cold.error)
                        .map((r) => ({ id: r.id, dream: r.dream.error ?? null, warm: r.warm.error ?? null, cold: r.cold.error ?? null })),
                llmCalls: receipts.length * 3,
                totalDurationMs: receipts.reduce((n, r) => n + (r.durationMs ?? 0), 0),
                perCase: "(see results/per-case/<id>.json — notes, dream candidate, guard verdict, both answers, both match scores)",
        };
        writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));
        console.log("\n=== recall-qa summary ===");
        console.log(`n=${summary.n}  warm=${warmPass}  cold=${coldPass}  lift=${lift}`);
        for (const [type, t] of Object.entries(typeTable)) {
                console.log(`  ${(type + ":").padEnd(26)} n=${t.n} warm=${t.warmPass} cold=${t.coldPass} lift=${t.lift} retained=${t.evidenceRetained}`);
        }
        console.log(`evidence retained in shipped memory: ${summary.consolidationFunnel.evidenceRetainedInShippedRate} (mean score ${summary.consolidationFunnel.meanEvidenceRetentionScore})`);
        console.log(`gated: ${summary.consolidationFunnel.gatedCases.length}  sanitized: ${summary.consolidationFunnel.sanitizedCases.length}  flagged-note cases: ${summary.consolidationFunnel.flaggedNoteCases.length}`);
        console.log(`errors: ${summary.errors.length}  total ${Math.round(summary.totalDurationMs / 1000)}s  receipts in results/`);
}

if (import.meta.main) {
        await main();
}
