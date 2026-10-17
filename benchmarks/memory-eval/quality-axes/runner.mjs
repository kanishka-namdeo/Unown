#!/usr/bin/env bun
/**
 * quality-axes/runner.mjs — memory-quality axes benchmark (docs/testing-strategy.md
 * §7.6 / §10 item M / roadmap item 12): contradiction, staleness, forgetting,
 * interference under accumulation.
 *
 * What it measures: the DREAM's consolidation quality on a synthetic 12-session
 * evolving project (corpus.json) — run LIVE against the real llm-bridge via the
 * PRODUCTION dream path (SYSTEM prompt from src/dream.ts, chatJson from src/llm.ts,
 * note quarantine banners from src/guard.ts — imported, not re-implemented):
 *
 *   1. CONTRADICTION — sessions carry an old lint rule (imports sorted
 *      alphabetically) and its replacement (imports grouped by type). After the
 *      dream, the candidate must NOT state both rules as current: the old-rule
 *      regex must be absent, or its line must carry an explicit
 *      historical/superseded marker. Two scenarios: in-batch (all notes in one
 *      dream) and accumulated (the old rule is already IN the current memory,
 *      the change arrives via new notes — the add-only-architecture trap).
 *   2. STALENESS — zod 3 -> zod 4 mid-story. The final candidate must reference
 *      the NEW version, and the old version must not be stated as current.
 *   3. FORGETTING (revocation) — axios approved early, forbidden later. After
 *      the revocation, no line may state the axios approval/usage as current
 *      (lines that explicitly revoke it or mark it historical are exempt).
 *   4. INTERFERENCE — two logging rules (pino / winston) fight across sessions
 *      (asserted, contradicted, re-asserted...). The final candidate must
 *      resolve to EXACTLY ONE current rule; the winner is recorded, plus the
 *      per-step oscillation trail (which rule each intermediate memory held).
 *
 * Scoring is DETERMINISTIC — no LLM judge: regex/substring line classification on
 * the returned projectMd candidate, with every matched line + classification
 * reason recorded in the receipt so any verdict is human-auditable. LLM usage is
 * the dream calls themselves (~10 chatJson calls) — nothing else.
 *
 * Guard measurement: every axis's final candidate also runs the REAL
 * decideGuardAction (guard.ts). These are BENIGN rule changes — a ship verdict
 * is expected; sanitize/gate is a false-positive signal worth recording (and
 * the axis assertion is re-evaluated on the sanitized text that would ship).
 *
 * Fidelity notes (mirroring runDream in src/dream.ts):
 *   - user message shape: "CURRENT PROJECT MEMORY (version N): ... SESSION NOTES
 *     SINCE LAST DREAM (n): ..." with "--- note (<ts>) run=<id> ---" blocks;
 *   - notes are fed NEWEST-FIRST (undreamedNotes() ORDER BY created_at DESC) —
 *     the real pipeline's actual (surprising) order; timestamps in the note
 *     headers carry the chronology;
 *   - flagged notes get the real quarantine banner (scanUntrustedText +
 *     noteGuardBanner); maxTokens 3000; established-memory guard context
 *     (firstMint false — first-mint gating is pinned in unit tests).
 *
 * Resume-safe: an axis with an existing ERROR-FREE receipt is skipped; errored
 * axes re-run. Receipts: results/<axis>.json + results/summary.json.
 *
 * Usage: bun runner.mjs [--fresh] [--axis contradiction|staleness|forgetting|interference]
 * Requires the llm-bridge on :3031 (checked before any dream call).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const RESULTS = join(HERE, "results");

// Scratch env BEFORE importing the package (store.ts opens SQLite at import):
// the benchmark never touches the live engine DB.
process.env.PI_SELFLEARNING_DATA ??= "/home/z/my-project/scratch-mem/quality-axes/data";
process.env.PI_SELFLEARNING_DB ??= "/home/z/my-project/scratch-mem/quality-axes/db/quality-axes.db";
process.env.PI_MODEL_ID ??= "kimi-k2.5";
process.env.PI_PROVIDER ??= "zai-bridge";

const { SYSTEM } = await import("../../../pi-repo/packages/self-learning/src/dream.ts");
const { chatJson, bridgeHealth } = await import("../../../pi-repo/packages/self-learning/src/llm.ts");
const { scanUntrustedText, noteGuardBanner, decideGuardAction } = await import(
        "../../../pi-repo/packages/self-learning/src/guard.ts",
);

const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));
const MODEL = process.env.PI_MODEL_ID ?? corpus.model ?? "kimi-k2.5";
const SEED = corpus.seedMemory;

if (process.argv.includes("--fresh")) rmSync(RESULTS, { recursive: true, force: true });
mkdirSync(RESULTS, { recursive: true });

const ONLY = process.argv.includes("--axis") ? process.argv[process.argv.indexOf("--axis") + 1] : null;

// ---------------------------------------------------------------------------
// Deterministic line classification (no LLM judge — this is the whole point)
// ---------------------------------------------------------------------------
/** Broad historical/superseded framing — exempts LOSER-rule lines (past tense counts). */
const SUPERSEDED_RE =
        /superseded|replaced|no longer|deprecat\w*|obsolete|outdated|retired|removed|revert\w*|formerly|previously|used to|legacy|historical|experiment|past|was\b|were\b|had been|migrat\w*|upgrad\w*|switch\w*|moved (?:away|off)|away from|older|earlier|before|since then|dropped|eliminated|initial(?:ly)?|original(?:ly)?|phased? out|forbidden|prohibited|banned|disallow\w*|not allowed|barred|no more/i;
/** Narrow killer — a line stating the WINNER rule is dropped/retired (past-tense "was chosen as the standard" is NOT killed). */
const WINNER_KILLER_RE =
        /\b(?:no longer|deprecat\w*|obsolete|retired|revert\w*|dropped|abandoned|phased out|forbidden|banned|removed|superseded|used to|formerly|previously|eliminated|before the|earlier|had been)\b|was\s+(?:the\s+)?(?:previous|former|old|initial|original|past)\b/i;

/**
 * Directional "losing position" patterns for one rule token: the rule is on the
 * LOSING side of a transition phrase. Gaps are TEMPERED: they may not cross the
 * OTHER rule's token ("Logging uses pino; winston was removed" must not mark
 * pino as losing) nor, for D2, a by/with/for/over/in-favor connector
 * ("replaced WITH x" makes x the winner).
 *   D1 passive: "<token> ... was/were/got replaced/removed/..."
 *   D2 active:  "replaced/removed/... <token>"
 *   D3 source:  "from <token> ... to <other>"
 *   D4 failure: "<token> dropped/lost/failed/crashed ..." — the token is the SUBJECT of an
 *               active-voice failure verb ("winston dropped lines under load" is a pitfall
 *               fact about winston, NOT a current-rule statement; SYSTEM rule 8 tells the
 *               dream to record such outcome knowledge). Without D4 that line misreads as
 *               "both rules current" — pinned in selftest.mjs from a live run.
 */
function losingPatterns(reSource, otherSource) {
        const src = `(?:${reSource})`;
        const other = `(?:${otherSource})`;
        return [
                new RegExp(`${src}(?:(?!${other})[^\\n]){0,25}\\b(?:was|were|got|been)\\s+(?:replaced|removed|dropped|abandoned|retired|reverted|switched|moved|eliminated)\\b`, "i"),
                new RegExp(
                        `\\b(?:replac\\w*|remov\\w*|drop\\w*|abandon\\w*|retir\\w*|revert\\w*|switch\\w*|migrat\\w*|upgrad\\w*|eliminat\\w*|mov\\w*|away\\s+from|off\\s+of)\\b(?:(?!\\b(?:by|with|for|in\\s+favor|over)\\b|${other})[^\\n]){0,60}${src}`,
                        "i",
                ),
                new RegExp(`\\bfrom\\s+${src}(?:(?!${other})[^\\n]){0,60}\\bto\\b`, "i"),
                new RegExp(`\\b(?:${src})(?:(?!${other})[^\\n]){0,20}\\b(?:dropped|dropping|lost|loses|losing|failed|fails|failing|crashes?|crashed|corrupt\\w*|leaks?|leaking|data\\s*-\\s*loss|defective|unusable)\\b`, "i"),
        ];
}

/**
 * Classify every candidate line that mentions either rule of a conflicting pair.
 * Recorded per line: the raw line, which rules it mentions, whether each is
 * "stated as current", and why — the receipt is the audit trail.
 *
 * killerLoser/killerWinner: which historical-marker set exempts single-rule lines.
 * Symmetric (both WINNER_KILLER) for interference; broad-for-loser + narrow-for-
 * winner for contradiction/staleness.
 */
function classifyPair(candidate, loserRe, winnerRe, killerLoser, killerWinner) {
        const loserLose = losingPatterns(loserRe.source, winnerRe.source);
        const winnerLose = losingPatterns(winnerRe.source, loserRe.source);
        const rows = [];
        for (const raw of candidate.split("\n")) {
                const line = raw.trim();
                if (!line) continue;
                const lm = loserRe.test(line);
                const wm = winnerRe.test(line);
                if (!lm && !wm) continue;
                const loserDir = lm && loserLose.some((r) => r.test(line));
                const winnerDir = wm && winnerLose.some((r) => r.test(line));
                let loserCurrent = false;
                let winnerCurrent = false;
                let why;
                if (lm && wm) {
                        // Both rules in one line: direction decides; no direction at all is
                        // genuinely ambiguous -> both count as current (strict).
                        loserCurrent = !loserDir;
                        winnerCurrent = !winnerDir;
                        why = loserDir
                                ? winnerDir
                                        ? "both rules named as replaced (ambiguous direction)"
                                        : "transition line: loser named as replaced/superseded"
                                : winnerDir
                                        ? "transition line: winner named as replaced (direction reversed?)"
                                        : "both rules named, no direction — treated as BOTH current";
                } else if (lm) {
                        loserCurrent = !loserDir && !killerLoser.test(line);
                        why = loserCurrent ? "loser stated with no superseded marker" : loserDir ? "loser in replaced/from position" : "superseded marker present";
                } else {
                        winnerCurrent = !winnerDir && !killerWinner.test(line);
                        why = winnerCurrent
                                ? "winner stated as current"
                                : winnerDir
                                        ? "winner in replaced/from position"
                                        : "winner-killer marker present (stated as dropped)";
                }
                rows.push({ line, loserMatch: lm, winnerMatch: wm, loserCurrent, winnerCurrent, why });
        }
        return {
                rows,
                loserCurrentCount: rows.filter((r) => r.loserCurrent).length,
                winnerCurrentCount: rows.filter((r) => r.winnerCurrent).length,
        };
}

/** FORGETTING: lines mentioning the revoked rule that are NOT exempt count as failures. */
function classifyRevoked(candidate, revokedRe, winnerRe) {
        const revokedLose = losingPatterns(revokedRe.source, winnerRe.source);
        const rows = [];
        for (const raw of candidate.split("\n")) {
                const line = raw.trim();
                if (!line) continue;
                const rv = revokedRe.test(line);
                const wn = winnerRe.test(line);
                if (!rv && !wn) continue;
                if (rv) {
                        const dir = revokedLose.some((r) => r.test(line));
                        const marked = SUPERSEDED_RE.test(line);
                        rows.push({
                                line,
                                revokedCurrent: !dir && !marked,
                                why: dir ? "revoked rule in replaced/from position" : marked ? "superseded/forbidden marker present" : "revoked rule stated with no exemption",
                        });
                } else {
                        rows.push({ line, winnerOnly: true, why: "replacement rule mentioned" });
                }
        }
        return {
                rows,
                revokedCurrentCount: rows.filter((r) => r.revokedCurrent === true).length,
                winnerMentionCount: rows.filter((r) => r.winnerOnly).length,
        };
}

// ---------------------------------------------------------------------------
// Dream pipeline (mirrors runDream in src/dream.ts)
// ---------------------------------------------------------------------------
function sessionsInRange(from, to) {
        const i = corpus.sessions.findIndex((s) => s.id === from);
        const j = corpus.sessions.findIndex((s) => s.id === to);
        if (i < 0 || j < 0 || j < i) throw new Error(`bad session slice ${from}..${to}`);
        return corpus.sessions.slice(i, j + 1);
}

/** One dream call. Notes are fed newest-first, exactly like undreamedNotes() (ORDER BY created_at DESC). */
async function dreamStep(axisId, scenarioId, stepIdx, sessions, currentMemory, version) {
        const noteRows = [];
        for (const s of sessions)
                for (const n of s.notes) noteRows.push({ ts: n.ts, run: s.run, text: n.text, session: s.id });
        noteRows.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)); // newest first (real pipeline order)
        const noteScans = noteRows.map((n) => scanUntrustedText(n.text));
        const notesText = noteRows
                .map((n, i) => {
                        const banner = noteScans[i].rules.length > 0 ? `${noteGuardBanner(noteScans[i])}\n` : "";
                        return `--- note (${n.ts}) run=${n.run} ---\n${banner}${n.text}`;
                })
                .join("\n\n");
        const user = `CURRENT PROJECT MEMORY (version ${version}):\n\n${currentMemory}\n\nSESSION NOTES SINCE LAST DREAM (${noteRows.length}):\n\n${notesText}`;
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
        return {
                id: `${axisId}/${scenarioId}#${stepIdx + 1}`,
                sessions: sessions.map((s) => s.id).join(","),
                notesIn: noteRows.length,
                noteRules: noteScans.map((s) => s.rules),
                versionIn: version,
                durationMs: Date.now() - started,
                error,
                stats,
                candidate,
                notesText,
        };
}

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------
async function runAxis(axisId) {
        const receiptPath = join(RESULTS, `${axisId}.json`);
        if (existsSync(receiptPath)) {
                const prev = JSON.parse(readFileSync(receiptPath, "utf8"));
                const hadError = prev.error || (prev.scenarios ?? []).some((s) => s.error || (s.steps ?? []).some((t) => t.error));
                if (!hadError) {
                        console.log(`[skip] ${axisId} (receipt exists, no error)`);
                        return prev;
                }
                console.log(`[rerun] ${axisId} (previous receipt had an error)`);
        }
        const axis = corpus.axes[axisId];
        const loserRe = new RegExp(axis.loser.re, "i");
        const winnerRe = new RegExp(axis.winner.re, "i");
        const started = Date.now();
        const scenarios = [];
        let axisError = null;

        for (const sc of axis.scenarios) {
                let current = SEED;
                let version = 2;
                const steps = [];
                let scenarioError = null;
                for (let i = 0; i < sc.slices.length; i++) {
                        const [from, to] = sc.slices[i];
                        const sessions = sessionsInRange(from, to);
                        console.log(`  [dream] ${axisId}/${sc.id} step ${i + 1}/${sc.slices.length}: sessions ${from}..${to} (${sessions.reduce((n, s) => n + s.notes.length, 0)} notes, memory v${version})`);
                        const step = await dreamStep(axisId, sc.id, i, sessions, current, version);
                        // per-step guard (informational — the real dream gates every candidate)
                        if (!step.error) {
                                const d = decideGuardAction(step.candidate, current, { firstMint: false });
                                step.guard = { action: d.action, flags: d.flags.map((f) => f.rule), reason: d.reason ?? null };
                        }
                        steps.push(step);
                        console.log(
                                `    -> ${step.error ? `ERROR: ${step.error.slice(0, 120)}` : `${step.candidate.length} chars, ${step.durationMs}ms, guard=${step.guard.action}`} (flagged notes: ${step.noteRules.filter((r) => r.length > 0).length}/${step.notesIn})`,
                        );
                        if (step.error) {
                                scenarioError = step.error;
                                break;
                        }
                        current = step.candidate;
                        version += 1;
                }
                const finalStep = steps[steps.length - 1];
                const finalCandidate = finalStep?.candidate ?? "";
                const lastCurrent = steps.length >= 2 ? steps[steps.length - 2].candidate : SEED;

                // ---- deterministic assertion on the final candidate
                let assertion;
                if (scenarioError || !finalCandidate) {
                        assertion = { pass: false, error: scenarioError ?? "no candidate" };
                } else if (axisId === "forgetting") {
                        const c = classifyRevoked(finalCandidate, loserRe, winnerRe);
                        assertion = {
                                type: "revoked-rule-absent",
                                pass: c.revokedCurrentCount === 0,
                                revokedCurrentCount: c.revokedCurrentCount,
                                revokedRule: axis.loser.name,
                                replacementMentionCount: c.winnerMentionCount,
                                rows: c.rows,
                        };
                } else {
                        const killerLoser = axisId === "interference" ? WINNER_KILLER_RE : SUPERSEDED_RE;
                        const c = classifyPair(finalCandidate, loserRe, winnerRe, killerLoser, WINNER_KILLER_RE);
                        if (axisId === "interference") {
                                const exactlyOne = (c.winnerCurrentCount > 0) !== (c.loserCurrentCount > 0);
                                assertion = {
                                        type: "exactly-one-current",
                                        pass: exactlyOne,
                                        winnerName: axis.winner.name,
                                        loserName: axis.loser.name,
                                        winnerCurrentCount: c.winnerCurrentCount,
                                        loserCurrentCount: c.loserCurrentCount,
                                        winner: c.winnerCurrentCount > 0 ? axis.winner.name : c.loserCurrentCount > 0 ? axis.loser.name : null,
                                        winnerMatchesMostRecentEvidence: c.winnerCurrentCount > 0 && c.loserCurrentCount === 0,
                                        rows: c.rows,
                                };
                        } else {
                                assertion = {
                                        type: "winner-current-loser-absent",
                                        pass: c.winnerCurrentCount >= 1 && c.loserCurrentCount === 0,
                                        winnerName: axis.winner.name,
                                        loserName: axis.loser.name,
                                        winnerCurrentCount: c.winnerCurrentCount,
                                        loserCurrentCount: c.loserCurrentCount,
                                        rows: c.rows,
                                };
                        }
                }

                // ---- real guard on the final candidate (FPR signal: benign change must ship)
                let guard = null;
                let shippedAssertionPass = null;
                if (!scenarioError && finalCandidate) {
                        const d = decideGuardAction(finalCandidate, lastCurrent, { firstMint: false });
                        guard = {
                                action: d.action,
                                flags: d.flags.map((f) => ({ line: f.line, rule: f.rule, text: f.text })),
                                reason: d.reason ?? null,
                                falsePositive: d.action !== "ship",
                        };
                        // what would actually ship: re-run the deterministic assertion on sanitized
                        const sanitized = d.action === "gate" ? "" : d.sanitized;
                        if (axisId === "forgetting") {
                                shippedAssertionPass = classifyRevoked(sanitized, loserRe, winnerRe).revokedCurrentCount === 0;
                        } else if (axisId === "interference") {
                                const c = classifyPair(sanitized, loserRe, winnerRe, WINNER_KILLER_RE, WINNER_KILLER_RE);
                                shippedAssertionPass = (c.winnerCurrentCount > 0) !== (c.loserCurrentCount > 0);
                        } else {
                                const c = classifyPair(sanitized, loserRe, winnerRe, SUPERSEDED_RE, WINNER_KILLER_RE);
                                shippedAssertionPass = c.winnerCurrentCount >= 1 && c.loserCurrentCount === 0;
                        }
                }

                // ---- information trails
                const trail = {};
                if (axisId === "interference" && steps.length > 1) {
                        trail.oscillation = steps.map((s) => {
                                if (s.error) return { step: s.id, error: s.error };
                                const c = classifyPair(s.candidate, loserRe, winnerRe, WINNER_KILLER_RE, WINNER_KILLER_RE);
                                return { step: s.id, winnerCurrent: c.winnerCurrentCount, loserCurrent: c.loserCurrentCount };
                        });
                }
                if (steps.length > 1 && !steps[0].error) {
                        // was the old/revoked rule actually established in the first memory? (it must be, or the axis is vacuous)
                        if (axisId === "forgetting") {
                                const c = classifyRevoked(steps[0].candidate, loserRe, winnerRe);
                                trail.revokedRuleEstablishedInFirstMemory = c.revokedCurrentCount > 0;
                        } else {
                                const c = classifyPair(steps[0].candidate, loserRe, winnerRe, SUPERSEDED_RE, WINNER_KILLER_RE);
                                trail.loserEstablishedInFirstMemory = c.loserCurrentCount > 0;
                        }
                }

                scenarios.push({
                        id: sc.id,
                        slices: sc.slices,
                        error: scenarioError,
                        steps: steps.map((s) => ({
                                id: s.id,
                                sessions: s.sessions,
                                notesIn: s.notesIn,
                                versionIn: s.versionIn,
                                noteRules: s.noteRules,
                                durationMs: s.durationMs,
                                error: s.error,
                                stats: s.stats,
                                guard: s.guard ?? null,
                                candidate: s.candidate,
                        })),
                        finalCandidate,
                        assertion,
                        guard,
                        shippedAssertionPass,
                        trail,
                });
                if (scenarioError) axisError = scenarioError;
        }

        const pass = scenarios.every((s) => s.assertion?.pass === true);
        const receipt = {
                suite: "quality-axes",
                axis: axisId,
                what: axis.what,
                model: MODEL,
                date: new Date().toISOString(),
                durationMs: Date.now() - started,
                error: axisError,
                pass,
                scenarios,
                dreamCalls: scenarios.reduce((n, s) => n + s.steps.length, 0),
                notes: "assertions are deterministic regex/line classification — see rows[] in each scenario's assertion for the audit trail; full dream input (notesText) omitted from the receipt, candidates kept verbatim",
        };
        writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
        const finals = scenarios.map((s) => `${s.id}=${s.assertion?.pass ? "PASS" : s.error ? "ERROR" : "FAIL"}`).join(" ");
        console.log(`[axis] ${axisId}: ${pass ? "PASS" : axisError ? "ERROR" : "FAIL"} (${finals}) guard=${scenarios.map((s) => s.guard?.action ?? "-").join("/")}`);
        return receipt;
}

// ---------------------------------------------------------------------------
// Bridge gate + main (importable for the no-LLM classifier self-test)
// ---------------------------------------------------------------------------
async function main() {
        const health = await bridgeHealth();
        if (!health?.ok) {
                console.error(`llm-bridge on :3031 is not healthy — aborting before any dream call: ${JSON.stringify(health)}`);
                process.exit(1);
}
        console.log(`bridge healthy (model ${MODEL}, upstream ${health.upstream?.status ?? "?"}) — ${ONLY ? `axis: ${ONLY}` : "all 4 axes"} (~10 dream calls)`);

        const axisIds = ONLY ? [ONLY] : Object.keys(corpus.axes);
        const receipts = [];
        for (const id of axisIds) receipts.push(await runAxis(id));

        const axesOutcome = {};
        for (const r of receipts) {
                axesOutcome[r.axis] = {
                        pass: r.pass,
                        error: r.error,
                        dreamCalls: r.dreamCalls,
                        durationMs: r.durationMs,
                        guardActions: r.scenarios.map((s) => s.guard?.action ?? "error"),
                        guardFalsePositive: r.scenarios.some((s) => s.guard?.falsePositive === true),
                        shippedAssertionPass: r.scenarios.map((s) => s.shippedAssertionPass),
                        scenarios: r.scenarios.map((s) => ({ id: s.id, pass: s.assertion?.pass ?? false })),
                };
}
        const summary = {
                suite: "quality-axes",
                date: new Date().toISOString(),
                model: MODEL,
                bridgeUpstreamStatus: health.upstream?.status ?? null,
                axesTotal: axisIds.length,
                axesPassed: receipts.filter((r) => r.pass).length,
                axes: axesOutcome,
                dreamCallsTotal: receipts.reduce((n, r) => n + r.dreamCalls, 0),
                guardFalsePositiveAxes: receipts.filter((r) => r.scenarios.some((s) => s.guard?.falsePositive === true)).map((r) => r.axis),
                perAxis: "(see results/<axis>.json — full candidates + per-line classification audit trail)",
        };
        writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));
        console.log("\n=== quality-axes summary ===");
        for (const [axis, o] of Object.entries(axesOutcome)) {
                console.log(
                        `${(axis + ":").padEnd(15)} ${o.pass ? "PASS" : o.error ? "ERROR" : "FAIL"}  guard=${o.guardActions.join("/")} (FPR: ${o.guardFalsePositive})  ${o.dreamCalls} dream call(s), ${Math.round(o.durationMs / 1000)}s`,
                );
}
        console.log(`axes: ${summary.axesPassed}/${summary.axesTotal} passed · dream calls: ${summary.dreamCallsTotal} · receipts in results/`);
}

if (import.meta.main) {
        await main();
}

export { classifyPair, classifyRevoked, SUPERSEDED_RE, WINNER_KILLER_RE, losingPatterns };
