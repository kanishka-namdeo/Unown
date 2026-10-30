#!/usr/bin/env node
/**
 * score-delegation.mjs — the delegation round's scorer.
 *
 * Read-only over a run directory (zero model spend): parses the per-lane
 * session transcripts + receipts + the fleet journal and computes the ten
 * axes (README.md §the-ten-axes). Every axis reports the raw measurements
 * AND a 0–100 score, with evidence quotes for audit.
 *
 * Usage:
 *   node score-delegation.mjs --run receipts/baseline-<ts>
 *   node score-delegation.mjs --run <dir> --compare receipts/baseline-<ts>   # delta table
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (n) => {
        const i = argv.indexOf(`--${n}`);
        return i >= 0 ? argv[i + 1] : undefined;
};
const runDir = argOf("run");
const compareDir = argOf("compare");
if (!runDir) {
        console.error("usage: score-delegation.mjs --run <dir> [--compare <dir>]");
        process.exit(2);
}

// ---------------------------------------------------------------------------
// transcript parsing
// ---------------------------------------------------------------------------
const HEADER_RE = /^## ([A-Za-z0-9_-]+) \(([^;()]+); (?:[^;()]*; )?(\d+) turns, ([\d.,]+[km]?) in \/ ([\d.,]+[km]?) out, (\d+) tool calls/gm;
const ASYNC_RE = /^Subagent ([A-Za-z0-9_-]+) \(([^)]+)\) (finished|FAILED|BLOCKED|stopped) in ([\d:]+)[\s\S]*?(\d+) turns · (\d+) tool calls · ([\d.,]+[km]?) in \/ ([\d.,]+[km]?) out/m;

function parseTokens(tok) {
        if (typeof tok !== "string") return null;
        tok = tok.trim().replace(/,/g, "");
        if (tok.endsWith("k")) return Math.round(parseFloat(tok) * 1000);
        if (tok.endsWith("m")) return Math.round(parseFloat(tok) * 1_000_000);
        const n = Number(tok);
        return Number.isFinite(n) ? n : null;
}

/** Parse one session JSONL into {spawns, results, asyncResults, parentUsage, taskControls, raw}. */
function parseSession(file) {
        const out = {
                taskCalls: [], // every task-tool invocation (calls, not children)
                spawnResults: [], // sync-lane per-run sections (headers)
                asyncResults: [], // async deliveries
                taskControls: [], // task_control invocations
                parentUsage: { input: 0, output: 0, cacheRead: 0, calls: 0 },
                parentPeakWindow: 0,
        };
        if (!fs.existsSync(file)) return out;
        const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
        for (const line of lines) {
                let e;
                try {
                        e = JSON.parse(line);
                } catch {
                        continue;
                }
                const msg = e?.message;
                if (!msg || typeof msg !== "object") continue;
                if (msg.role === "assistant") {
                        if (msg.usage) {
                                out.parentUsage.input += msg.usage.input ?? 0;
                                out.parentUsage.output += msg.usage.output ?? 0;
                                out.parentUsage.cacheRead += msg.usage.cacheRead ?? 0;
                                out.parentUsage.calls++;
                                out.parentPeakWindow = Math.max(out.parentPeakWindow, (msg.usage.input ?? 0) + (msg.usage.cacheRead ?? 0));
                        }
                        for (const c of msg.content ?? []) {
                                if (c?.type === "toolCall" && c.name === "task") out.taskCalls.push(c.arguments ?? {});
                                if (c?.type === "toolCall" && c.name === "task_control") out.taskControls.push(c.arguments ?? {});
                        }
                }
                if (msg.role === "toolResult" && msg.toolName === "task") {
                        const text = (msg.content ?? []).map((c) => c?.text ?? "").join("\n");
                        const runs = msg.details?.runs ?? [];
                        HEADER_RE.lastIndex = 0;
                        let m;
                        while ((m = HEADER_RE.exec(text))) {
                                out.spawnResults.push({
                                        agent: m[1],
                                        status: m[2].trim(),
                                        turns: Number(m[3]),
                                        inTok: parseTokens(m[4]),
                                        outTok: parseTokens(m[5]),
                                        toolCalls: Number(m[6]),
                                });
                        }
                        // keep the details.runs (no tokens there, but elapsedMs is)
                        for (const r of runs) {
                                const target = out.spawnResults.find((x) => !x._elapsed && x.agent === r.agent);
                                if (target) target._elapsed = r.elapsedMs;
                        }
                }
                // async deliveries arrive as custom/user messages carrying the fleet header
                const anyText = (msg.content ?? []).map((c) => c?.text ?? "").join("\n");
                if (anyText) {
                        ASYNC_RE.lastIndex = 0;
                        const m = ASYNC_RE.exec(anyText);
                        if (m) out.asyncResults.push({ name: m[1], agent: m[2], status: m[3], turns: Number(m[5]), toolCalls: Number(m[6]), inTok: parseTokens(m[7]), outTok: parseTokens(m[8]) });
                }
        }
        return out;
}

// ---------------------------------------------------------------------------
// handoff heuristic (README §axis-1; identical for baseline and after)
// ---------------------------------------------------------------------------
const HANDOFF = {
        objective: /\b(find|map|count|list|review|create|write|run|report|answer|double-?check|read|cite|name|tell|verify|locate)\b/i,
        context: /(\.ts\b|\.tsx\b|\.md\b|\.js\b|src\/|pi-repo\/|file:line|models\.json|`[^`]+`|\/api\/|FleetJournal|advertised|atomic\.ts)/i,
        boundary: /\b(under \d+ words|only|just|exactly|verbatim|one line|first line|short numbered|report just|no more than)\b/i,
        done: /\b(report|return|answer|cite|reply|tell me|print|digest|verdict|count|list)\b/i,
};
function handoffScore(taskText) {
        const hits = Object.entries(HANDOFF).filter(([, re]) => re.test(taskText)).map(([k]) => k);
        return { score: hits.length / 4, hits, misses: Object.keys(HANDOFF).filter((k) => !hits.includes(k)) };
}

// duplicate detection: same agent + Jaccard(wordset) > 0.6
function jaccard(a, b) {
        const A = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
        const B = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
        let inter = 0;
        for (const w of A) if (B.has(w)) inter++;
        const uni = new Set([...A, ...B]).size;
        return uni ? inter / uni : 0;
}

// ---------------------------------------------------------------------------
// load the run
// ---------------------------------------------------------------------------
const summary = JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8"));
const lanes = {};
for (const f of fs.readdirSync(runDir)) {
        const m = f.match(/^task-(.+)\.session\.jsonl$/);
        if (!m) continue;
        const id = m[1];
        const receipt = JSON.parse(fs.readFileSync(path.join(runDir, `task-${id}.receipt.json`), "utf8"));
        lanes[id] = { receipt, session: parseSession(path.join(runDir, f)) };
}

// PTY lane evidence (optional): the widget pane is the live-rows receipt, the
// result pane is the delivery receipt (the lane's own file names — not a sort)
const ptyDir = path.join(runDir, "pty-fleet");
let ptyPane = null;
let ptyResultPane = null;
if (fs.existsSync(ptyDir)) {
        const widget = path.join(ptyDir, "fleet-widget.pane.txt");
        const result = path.join(ptyDir, "fleet-result.pane.txt");
        if (fs.existsSync(widget)) ptyPane = fs.readFileSync(widget, "utf8");
        if (fs.existsSync(result)) ptyResultPane = fs.readFileSync(result, "utf8");
        if (!ptyPane) {
                const panes = fs.readdirSync(ptyDir).filter((f) => f.endsWith(".pane.txt"));
                if (panes.length) ptyPane = fs.readFileSync(path.join(ptyDir, panes.sort().at(-1)), "utf8");
        }
}

// ---------------------------------------------------------------------------
// per-lane spawn normalization: taskCalls → children (batch expansion)
// ---------------------------------------------------------------------------
const allSpawns = [];
for (const [id, { session, receipt }] of Object.entries(lanes)) {
        let spawnIdx = 0;
        for (const call of session.taskCalls) {
                const items = call.tasks ? call.tasks : [call];
                for (const item of items) {
                        const res = session.spawnResults[spawnIdx] ?? null;
                        allSpawns.push({
                                lane: id,
                                agent: item.agent ?? call.agent ?? "general",
                                task: item.task ?? call.task ?? "",
                                why: item.why ?? call.why ?? null,
                                async: !!(call.async ?? item.async),
                                name: call.name ?? item.name ?? null,
                                result: res,
                        });
                        spawnIdx++;
                }
        }
        // async children not in spawnResults (delivered as messages). The delivery
        // itself is not always persisted in the transcript (measured live
        // 2026-10-30: the steer lands but no entry is written) — the lane's journal
        // delta is the honest fallback: a finished "done" for this lane's window
        // proves the child's outcome even when the transcript lacks the delivery.
        const journalDone = (receipt.journalDelta ?? []).some((l) => /"op":"finished"/.test(l) && /"status":"done"/.test(l));
        for (const a of session.asyncResults) {
                if (!allSpawns.some((s) => s.lane === id && s.name === a.name)) {
                        allSpawns.push({ lane: id, agent: a.agent, task: "", why: null, async: true, name: a.name, result: a });
                }
        }
        for (const s of allSpawns) {
                if (s.lane === id && !s.result && s.async && journalDone) {
                        s.result = { status: "ok", journalOnly: true };
                        s.deliveryNotPersisted = true;
                }
        }
}

// ---------------------------------------------------------------------------
// the ten axes
// ---------------------------------------------------------------------------
const NATURAL_LANES = ["t1-map", "t2-callers", "t3-triptych", "t4-script", "t5-review", "t7-duplicate", "t8-async"];
const INJECTED_LANES = ["t6a-unknown-agent", "t6b-blocked-task"];
const evidence = (axis) => [];
const axes = {};
const push = (axis, lines) => (axes[axis].evidence.push(...lines));

// --- 1. delegation quality
{
        const spawnCount = allSpawns.length;
        const handoffs = spawnCount ? allSpawns.map((s) => ({ lane: s.lane, agent: s.agent, ...handoffScore(s.task) })) : [];
        const handoffPct = spawnCount ? (handoffs.reduce((a, h) => a + h.score, 0) / spawnCount) * 100 : null;
        const okCount = allSpawns.filter((s) => s.result && /(^ok$|finished)/i.test(String(s.result.status))).length;
        const notOk = allSpawns.filter((s) => !s.result || !/(^ok$|finished)/i.test(String(s.result.status)));
        const outcomePct = spawnCount ? (okCount / spawnCount) * 100 : null;
        axes.delegationQuality = {
                score: spawnCount ? Math.round(0.5 * handoffPct + 0.5 * outcomePct) : null,
                raw: { spawns: spawnCount, okSpawns: okCount, handoffPct: handoffPct === null ? null : Math.round(handoffPct), perSpawn: handoffs, notOkSpawns: notOk.map((s) => ({ lane: s.lane, agent: s.agent, status: s.result?.status ?? "no-result" })) },
                evidence: [],
        };
        if (!spawnCount) axes.delegationQuality.evidence.push("zero subagent spawns across the workload — the model completed every natural lane inline");
}

// --- 2. subagent reuse
{
        const dups = [];
        for (let i = 0; i < allSpawns.length; i++)
                for (let j = i + 1; j < allSpawns.length; j++)
                        if (allSpawns[i].agent === allSpawns[j].agent && jaccard(allSpawns[i].task, allSpawns[j].task) > 0.6)
                                dups.push({ first: { lane: allSpawns[i].lane, task: allSpawns[i].task.slice(0, 90) }, second: { lane: allSpawns[j].lane, task: allSpawns[j].task.slice(0, 90) }, jaccard: Math.round(jaccard(allSpawns[i].task, allSpawns[j].task) * 100) / 100 });
        const steers = Object.values(lanes).flatMap(({ session }) => session.taskControls.filter((t) => t.action === "steer"));
        const followUps = allSpawns.filter((s) => allSpawns.filter((x) => x.lane === s.lane).indexOf(s) > 0).length;
        const reuseHits = steers.length;
        const opportunities = dups.length + followUps;
        axes.subagentReuse = {
                score: opportunities === 0 ? null : Math.round((reuseHits / opportunities) * 100),
                raw: { duplicateSpawns: dups, steerOrResumeEvents: steers.length, followUpSpawns: followUps, opportunities },
                evidence: [],
        };
        if (dups.length) axes.subagentReuse.evidence.push(`${dups.length} duplicate spawn pair(s): same agent + task Jaccard > 0.6`);
}

// --- 3. context efficiency
{
        const childTok = allSpawns.reduce((a, s) => a + (s.result?.inTok ?? 0) + (s.result?.outTok ?? 0), 0);
        const parentTok = Object.values(lanes).reduce((a, { session }) => a + session.parentUsage.input + session.parentUsage.output, 0);
        const share = childTok + parentTok > 0 ? (childTok / (childTok + parentTok)) * 100 : null;
        axes.contextEfficiency = {
                score: share === null ? null : Math.round(share),
                raw: {
                        childTokens: childTok,
                        parentTokens: parentTok,
                        offloadSharePct: share === null ? null : Math.round(share),
                        parentPeakWindow: Math.max(...Object.values(lanes).map(({ session }) => session.parentPeakWindow), 0),
                },
                evidence: [],
        };
}

// --- 4. user explainability (deterministic components)
{
        const withWhy = allSpawns.filter((s) => s.why).length;
        const reasonPct = allSpawns.length ? (withWhy / allSpawns.length) * 100 : 0;
        const withHeader = allSpawns.filter((s) => s.result && s.result.turns !== undefined).length;
        const postHocPct = allSpawns.length ? (withHeader / allSpawns.length) * 100 : 0;
        const asyncAck = !!lanes["t8-async"]?.session.taskCalls.some((c) => c.async);
        const duringRun = (asyncAck ? 15 : 0) + (ptyPane && /Subagents/.test(ptyPane) ? 15 : 0);
        axes.userExplainability = {
                score: Math.round(reasonPct * 0.4 + postHocPct * 0.3 + duringRun),
                raw: { spawns: allSpawns.length, withWhy, reasonPct: Math.round(reasonPct), postHocPct: Math.round(postHocPct), asyncAckVisible: asyncAck, paneWidgetVisible: !!(ptyPane && /Subagents/.test(ptyPane)) },
                evidence: [],
        };
        if (!allSpawns.length) axes.userExplainability.evidence.push("no spawns: nothing to explain — scored on the surface's capacity (post-hoc + during-run components only)");
        axes.userExplainability.evidence.push(`why recorded on ${withWhy}/${allSpawns.length || 0} spawns (baseline has no why field)`);
}

// --- 5. progress visibility
{
        const paneBox = ptyPane && /╭─ Subagents/.test(ptyPane);
        const paneRow = ptyPane && /(⟳|◉|○)/.test(ptyPane);
        const asyncAck = !!lanes["t8-async"]?.session.taskCalls.some((c) => c.async);
        const streamEvents = false; // delegation events in the print-mode stream: not implemented in 0.0.45
        axes.progressVisibility = {
                score: (paneBox ? 25 : 0) + (paneRow ? 15 : 0) + (asyncAck ? 15 : 0) + (streamEvents ? 45 : 0),
                raw: { paneBox: !!paneBox, paneRow: !!paneRow, asyncAck: !!asyncAck, streamEvents },
                evidence: [],
        };
        if (!ptyPane) axes.progressVisibility.evidence.push("no PTY pane receipt — TUI components scored 0 (run pty_fleet_lane.py to measure)");
}

// --- 6. memory utilisation
{
        const first = Object.values(lanes)[0]?.receipt.overviewBefore;
        const last = Object.values(lanes).at(-1)?.receipt.overviewAfter;
        const notesDelta = first?.ok && last?.ok ? (last.notes ?? 0) - (first.notes ?? 0) : null;
        // each parent -p run also writes one note; children write one each on exit
        const parentRuns = Object.keys(lanes).length;
        const childNotes = notesDelta === null ? null : Math.max(0, notesDelta - parentRuns);
        axes.memoryUtilisation = {
                score: allSpawns.length && childNotes !== null ? Math.round((Math.min(childNotes, allSpawns.length) / allSpawns.length) * 100) : null,
                raw: { notesBefore: first?.notes ?? null, notesAfter: last?.notes ?? null, notesDelta, parentRuns, childNotesApprox: childNotes, spawns: allSpawns.length },
                evidence: [],
        };
}

// --- 7. learning retention
{
        // the original trigger could 409 (engine busy with its own scheduled job);
        // a dream-retry.receipt.json re-drove the same production path with retry
        // semantics and is the completion of this measurement when present.
        const retryPath = path.join(runDir, "dream-retry.receipt.json");
        const retry = fs.existsSync(retryPath) ? JSON.parse(fs.readFileSync(retryPath, "utf8")) : null;
        const d = retry ?? summary.dream ?? {};
        const before = retry ? { ok: true, ...retry.before } : (d.before ?? {});
        const after = retry ? { ok: true, ...retry.after } : (d.after ?? {});
        const versionBump = before.ok && after.ok && (after.memoryProjectVersion ?? 0) > (before.memoryProjectVersion ?? 0);
        const dreamsDelta = before.ok && after.ok ? (after.dreams ?? 0) - (before.dreams ?? 0) : null;
        const pendingDrained = before.ok && after.ok ? (before.notesPending ?? 0) - (after.notesPending ?? 0) : null;
        axes.learningRetention = {
                score: (versionBump ? 40 : 0) + (dreamsDelta && dreamsDelta > 0 ? 30 : 0) + (pendingDrained !== null && pendingDrained > 0 ? 30 : 0),
                raw: { memoryProjectVersionBefore: before.memoryProjectVersion ?? null, memoryProjectVersionAfter: after.memoryProjectVersion ?? null, dreamsDelta, pendingDrained, triggerStatus: d.trigger?.status ?? null },
                evidence: [],
        };
}

// --- 8. failure recovery
{
        const results = [];
        for (const id of INJECTED_LANES) {
                const lane = lanes[id];
                if (!lane) continue;
                const markerOk = lane.receipt.allMarkersPass;
                const typedErrorSurfaced =
                        id === "t6a-unknown-agent"
                                ? /available agents|unknown agent|not found|repo-cartographer/i.test(JSON.stringify(lane.session)) || lane.receipt.journalDelta.some((l) => /spawned/.test(l))
                                : /BLOCKED|denied|refus/i.test(JSON.stringify(lane.session));
                results.push({ lane: id, markerOk, typedErrorSurfaced, recovered: markerOk && typedErrorSurfaced });
        }
        axes.failureRecovery = {
                score: results.length ? Math.round((results.filter((r) => r.recovered).length / results.length) * 100) : null,
                raw: { injected: results.length, recovered: results.filter((r) => r.recovered).length, results },
                evidence: [],
        };
}

// --- 9. autonomous decision quality
{
        const decisions = [];
        const laneSpawns = (id) => allSpawns.filter((s) => s.lane === id);
        const inline = (id) => laneSpawns(id).length === 0;
        // t1/t2: investigation — explore/scout/general or inline all fine
        for (const id of ["t1-map", "t2-callers"]) {
                const sp = laneSpawns(id);
                const ok = inline(id) || sp.every((s) => ["explore", "scout", "general", "background-explore"].includes(s.agent));
                decisions.push({ lane: id, choice: inline(id) ? "inline" : sp.map((s) => s.agent).join(","), ok });
        }
        // t3: parallelism — a batch (tasks[]) or multiple calls or inline
        {
                const calls = lanes["t3-triptych"]?.session.taskCalls ?? [];
                const batch = calls.some((c) => Array.isArray(c.tasks) && c.tasks.length >= 2);
                const multi = calls.length >= 2;
                const ok = inline("t3-triptych") || batch || multi;
                decisions.push({ lane: "t3-triptych", choice: inline("t3-triptych") ? "inline" : `${calls.length} call(s)${batch ? " (batch)" : ""}`, ok });
        }
        // t4: implementation — worker or inline
        {
                const sp = laneSpawns("t4-script");
                const ok = inline("t4-script") || sp.every((s) => ["worker", "general"].includes(s.agent));
                decisions.push({ lane: "t4-script", choice: inline("t4-script") ? "inline" : sp.map((s) => s.agent).join(","), ok });
        }
        // t5: review — reviewer or general
        {
                const sp = laneSpawns("t5-review");
                const ok = inline("t5-review") || sp.every((s) => ["reviewer", "general"].includes(s.agent));
                decisions.push({ lane: "t5-review", choice: inline("t5-review") ? "inline" : sp.map((s) => s.agent).join(","), ok });
        }
        // t7: the double-check spawn (the second investigation)
        {
                const sp = laneSpawns("t7-duplicate");
                const ok = inline("t7-duplicate") || sp.every((s) => ["explore", "scout", "general"].includes(s.agent));
                decisions.push({ lane: "t7-duplicate", choice: inline("t7-duplicate") ? "inline" : sp.map((s) => s.agent).join(","), ok });
        }
        // t8: async lane
        {
                const asyncUsed = (lanes["t8-async"]?.session.taskCalls ?? []).some((c) => c.async);
                decisions.push({ lane: "t8-async", choice: asyncUsed ? "async" : "sync-or-inline", ok: asyncUsed });
        }
        const okCount = decisions.filter((d) => d.ok).length;
        axes.autonomousDecisionQuality = {
                score: decisions.length ? Math.round((okCount / decisions.length) * 100) : null,
                raw: { decisions, okDecisions: okCount },
                evidence: [],
        };
}

// --- 10. human intervention rate
{
        const headless = Object.entries(lanes).filter(([id]) => INJECTED_LANES.concat(NATURAL_LANES).includes(id));
        const needed = headless.filter(([, { receipt }]) => !receipt.allMarkersPass || receipt.exit !== 0 || receipt.timedOut);
        axes.humanInterventionRate = {
                score: headless.length ? Math.round(((headless.length - needed.length) / headless.length) * 100) : null,
                raw: { lanes: headless.length, completedWithoutIntervention: headless.length - needed.length, interventions: needed.map(([id, r]) => ({ lane: id, markers: r.receipt.allMarkersPass, exit: r.receipt.exit, timedOut: r.receipt.timedOut })) },
                evidence: [],
        };
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------
const overall = Object.values(axes).every((a) => a.score === null)
        ? null
        : Math.round(Object.values(axes).filter((a) => a.score !== null).reduce((a, x) => a + x.score, 0) / Object.values(axes).filter((a) => a.score !== null).length);
const scores = {
        schema: "delegation-round/scores/1",
        run: path.basename(runDir),
        label: summary.label,
        scoredAt: new Date().toISOString(),
        unownVersion: summary.unownVersion,
        gitSha: summary.gitSha,
        overall,
        axes,
};
fs.writeFileSync(path.join(runDir, `scores-${summary.label}.json`), JSON.stringify(scores, null, "\t"));

const pct = (v) => (v === null ? "  —  " : String(v).padStart(3));
console.log(`\n# delegation-bench scores — ${summary.label} (${summary.unownVersion} @ ${String(summary.gitSha).slice(0, 8)})`);
console.log(`  axis                                   score   key raw`);
const ROWS = [
        ["delegationQuality", (a) => `${a.raw.spawns} spawns · ${a.raw.okSpawns} ok · handoff ${a.raw.handoffPct ?? "—"}%`],
        ["subagentReuse", (a) => `${a.raw.duplicateSpawns.length} dup · ${a.raw.steerOrResumeEvents} steer/resume`],
        ["contextEfficiency", (a) => `child ${a.raw.childTokens} · parent ${a.raw.parentTokens} · offload ${a.raw.offloadSharePct ?? "—"}%`],
        ["userExplainability", (a) => `why ${a.raw.withWhy}/${a.raw.spawns} · post-hoc ${a.raw.postHocPct}% · ack ${a.raw.asyncAckVisible}`],
        ["progressVisibility", (a) => `pane ${a.raw.paneBox} · rows ${a.raw.paneRow} · stream events ${a.raw.streamEvents}`],
        ["memoryUtilisation", (a) => `child notes ≈${a.raw.childNotesApprox}/${a.raw.spawns}`],
        ["learningRetention", (a) => `version ${a.raw.memoryProjectVersionBefore}→${a.raw.memoryProjectVersionAfter} · dreams Δ${a.raw.dreamsDelta ?? "?"}`],
        ["failureRecovery", (a) => `${a.raw.recovered}/${a.raw.injected} recovered`],
        ["autonomousDecisionQuality", (a) => `${a.raw.okDecisions}/${a.raw.decisions.length} decisions ok`],
        ["humanInterventionRate", (a) => `${a.raw.completedWithoutIntervention}/${a.raw.lanes} lanes clean`],
];
for (const [k, fmt] of ROWS) console.log(`  ${k.padEnd(38)} ${pct(axes[k].score)}    ${fmt(axes[k])}`);
console.log(`  ${"OVERALL (mean of measured)".padEnd(38)} ${pct(overall)}\n`);

if (compareDir) {
        const base = JSON.parse(fs.readFileSync(path.join(compareDir, `scores-${JSON.parse(fs.readFileSync(path.join(compareDir, "summary.json"), "utf8")).label}.json`), "utf8"));
        console.log(`# delta vs ${path.basename(compareDir)}`);
        console.log(`  axis                                   before → after`);
        for (const [k] of ROWS) {
                const b = base.axes[k]?.score;
                const a = axes[k].score;
                const d = b === null || a === null ? "" : a - b === 0 ? " (=)" : a - b > 0 ? ` (+${a - b})` : ` (${a - b})`;
                console.log(`  ${k.padEnd(38)} ${pct(b)} → ${pct(a)}${d}`);
        }
        console.log(`  ${"OVERALL".padEnd(38)} ${pct(base.overall)} → ${pct(overall)}\n`);
}
