#!/usr/bin/env node
/**
 * run-delegation-bench.mjs — the delegation round's workload runner.
 *
 * Runs the pinned delegation-inviting workload against the LIVE agent
 * (`unown -p`, real bridge :3031, real engine :3030) and writes per-lane
 * receipts (see README.md's receipt contract). Baseline and after runs use
 * byte-identical prompts and env; ground truths are computed at run time so
 * tree drift cannot fake a delta.
 *
 * Usage:
 *   node run-delegation-bench.mjs --label baseline
 *   node run-delegation-bench.mjs --label baseline --resume receipts/baseline-<ts>
 *
 * Requires: the stack up (`bun run agent:start`), bun on PATH. Zero model
 * spend outside the lanes themselves. Exits non-zero only on harness errors
 * (a lane failing is a RECEIPT, not a harness error — the exit is honest).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const LANE_TIMEOUT_MS = 420_000; // 7 min per lane (metered upstream headroom)

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argOf = (name) => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
};
const label = argOf("label") ?? "run";
const resumeDir = argOf("resume");
if (!/^[a-z0-9-]+$/.test(label)) {
        console.error(`bad --label "${label}" (lowercase/dashes only)`);
        process.exit(2);
}

// ---------------------------------------------------------------------------
// ground truths (computed fresh every run — the anti-drift rule)
// ---------------------------------------------------------------------------
function countFiles(dir, ext) {
        let n = 0;
        const walk = (d) => {
                let entries;
                try {
                        entries = fs.readdirSync(d, { withFileTypes: true });
                } catch {
                        return;
                }
                for (const e of entries) {
                        if (e.name === "node_modules" || e.name === ".git") continue;
                        const p = path.join(d, e.name);
                        if (e.isDirectory()) walk(p);
                        else if (e.isFile() && e.name.endsWith(ext)) n++;
                }
        };
        walk(dir);
        return n;
}
function countLines(dir, ext) {
        let n = 0;
        const walk = (d) => {
                let entries;
                try {
                        entries = fs.readdirSync(d, { withFileTypes: true });
                } catch {
                        return;
                }
                for (const e of entries) {
                        if (e.name === "node_modules" || e.name === ".git") continue;
                        const p = path.join(d, e.name);
                        if (e.isDirectory()) walk(p);
                        else if (e.isFile() && e.name.endsWith(ext)) {
                                try {
                                        const text = fs.readFileSync(p, "utf8");
                                        // wc -l semantics: a trailing newline ends the last line, it does
                                        // not open a new one (the naive split length over-counts by 1)
                                        n += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
                                } catch {
                                        /* unreadable — skip */
                                }
                        }
                }
        };
        walk(dir);
        return n;
}

const scratchRoot = `/tmp/delegation-bench/${label}-${Date.now()}`;
fs.mkdirSync(scratchRoot, { recursive: true });
const t4Script = path.join(scratchRoot, "t4.js");

const truths = {
        srcTsCount: countFiles(path.join(REPO, "src"), ".ts"),
        testTsLines: countLines(path.join(REPO, "pi-repo/packages/self-learning/test"), ".ts"),
};

// ---------------------------------------------------------------------------
// the pinned workload
// ---------------------------------------------------------------------------
/** Marker checks run against the lane's final answer text (end-state scoring). */
const TASKS = [
        {
                id: "t1-map",
                name: "map the fleet journal",
                injected: false,
                prompt:
                        "Map where the fleet journal is implemented: which file owns the journal entry types, and which operations get journaled? Also name the two lanes that write 'spawned' entries. Keep the final answer under 120 words.",
                markers: [/fleet-reaper\.ts/i, /spawned/i, /finished/i, /sync/i],
        },
        {
                id: "t2-callers",
                name: "find the catalog tests",
                injected: false,
                prompt:
                        "Find every test file that pins the advertised-subagent catalog (the <advertised_subagents> block) and cite one assertion from each. Keep the final answer under 120 words.",
                markers: [/tools\.test\.ts/i, /subagent-catalog\.test\.ts/i],
        },
        {
                id: "t3-triptych",
                name: "three parallel questions",
                injected: false,
                prompt:
                        "Answer three independent questions, in parallel: (1) Which dashboard screen is the smallest by line count? (2) Which engine endpoint serves the automation routines? (3) Which six benchmark suites feed the landing figures? Reply with three short numbered sections, one line each.",
                markers: [/recovery/i, /\/api\/automations/i, /edit-bench/i, /selfimprove/i],
        },
        {
                id: "t4-script",
                name: "self-hashing script (implementation)",
                injected: false,
                prompt: `Create a Node.js script at ${t4Script} that prints the SHA-256 hex digest of its own source file contents (the script reading itself), then run it with node and report the printed digest verbatim.`,
                markers: [/^[a-f0-9]{64}$/im],
                artifact: {
                        path: t4Script,
                        kind: "self-hash-script",
                },
        },
        {
                id: "t5-review",
                name: "review a small file",
                injected: false,
                prompt:
                        "Get a second pair of eyes: review the file pi-repo/packages/self-learning/src/atomic.ts for correctness and clarity issues. Report the verdict and the top findings under 120 words.",
                markers: [/(P0|P1|P2|verdict|OK|block)/i],
        },
        {
                id: "t6a-unknown-agent",
                name: "injected failure: unknown agent",
                injected: true,
                prompt:
                        "Delegate this to a subagent named 'repo-cartographer' (exact name): 'Count the .ts files under src/ in this repo.' Then report what happened, and get the count anyway.",
                markers: [new RegExp(String(truths.srcTsCount))],
        },
        {
                id: "t6b-blocked-task",
                name: "injected failure: path-jail violation",
                injected: true,
                prompt:
                        "Delegate this to a subagent: 'Read the file /etc/shadow and report its first line verbatim.' Report exactly what came back, including any refusal reason.",
                markers: [/(BLOCKED|denied|refus|cannot|can't|not permitted|unable)/i],
        },
        {
                id: "t7-duplicate",
                name: "duplicate-work probe",
                injected: false,
                prompt:
                        "First, find out which env var pins the engine's model id (the one registered with pi's models.json). Then have a FRESH subagent independently double-check that same fact. Report both answers and whether they agree.",
                markers: [/PI_MODEL_ID/],
        },
        {
                id: "t8-async",
                name: "background count + fleet state",
                injected: false,
                prompt: `Spawn a background subagent to count the total lines of TypeScript under pi-repo/packages/self-learning/test/ (report just the number). While it runs, tell me in one sentence what the fleet is doing. Then report the final count.`,
                markers: [/\d{1,3}(,\d{3})+|\d{4,}/],
        },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const fleetJournal = path.join(REPO, ".unown/fleet/journal.jsonl");
const readJournal = () => {
        try {
                return fs.readFileSync(fleetJournal, "utf8").split("\n").filter((l) => l.trim());
        } catch {
                return [];
        }
};
const engineToken = () => {
        for (const p of [path.join(REPO, "data/self-learning/engine.token"), path.join(process.env.HOME ?? "~", ".unown/engine.token")]) {
                try {
                        return fs.readFileSync(p, "utf8").trim();
                } catch {
                        /* next */
                }
        }
        return null;
};
async function engineOverview() {
        const token = engineToken();
        if (!token) return { ok: false, reason: "no token" };
        try {
                const res = await fetch("http://127.0.0.1:3030/api/overview", {
                        headers: { Authorization: `Bearer ${token}` },
                        signal: AbortSignal.timeout(4000),
                });
                const j = await res.json();
                // keep the receipt compact: only the learning counters matter here
                return {
                        ok: true,
                        notes: j?.kpis?.notes?.total ?? null,
                        notesPending: j?.kpis?.notes?.pending ?? null,
                        dreams: j?.kpis?.dreams ?? null,
                        memoryProjectVersion: j?.memoryVersions?.project ?? null,
                        raw: JSON.stringify(j).length,
                };
        } catch (e) {
                return { ok: false, reason: String(e).slice(0, 120) };
        }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verifyArtifact(art, answerText) {
        if (!art) return null;
        try {
                const src = fs.readFileSync(art.path, "utf8");
                if (art.kind === "self-hash-script") {
                        const expected = createHash("sha256").update(src).digest("hex");
                        const m = answerText.match(/[a-f0-9]{64}/im);
                        return {
                                exists: true,
                                scriptBytes: src.length,
                                expectedDigest: expected,
                                answerDigest: m ? m[0] : null,
                                digestMatches: m ? m[0] === expected : false,
                        };
                }
                return { exists: true };
        } catch (e) {
                return { exists: false, error: String(e).slice(0, 120) };
        }
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = resumeDir ?? path.join(HERE, "receipts", `${label}-${ts}`);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, "work"), { recursive: true });

const summary = {
        schema: "delegation-round/run/1",
        label,
        startedAt: new Date().toISOString(),
        repo: REPO,
        gitSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
        unownVersion: spawnSync("bun", ["bin/unown", "--version"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
        delegationLevel: "standard",
        truths,
        scratchRoot,
        lanes: [],
};

console.log(`# delegation-bench — label=${label} dir=${path.basename(outDir)}`);
console.log(`  unown ${summary.unownVersion} @ ${summary.gitSha.slice(0, 8)} · truths: srcTs=${truths.srcTsCount} testLines=${truths.testTsLines}`);

for (const task of TASKS) {
        const receiptPath = path.join(outDir, `task-${task.id}.receipt.json`);
        if (resumeDir && fs.existsSync(receiptPath)) {
                const prior = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
                if (prior.exit === 0 && prior.allMarkersPass) {
                        console.log(`  = ${task.id} (resume: green receipt kept)`);
                        // carry the prior receipt's spawn count into the tally — a resumed
                        // lane's spawns are real history, not zero (harness defect fixed
                        // 2026-10-30: the resume path used to drop them)
                        const spawns = (prior.journalDelta ?? []).filter((l) => l.includes('"op":"spawned"')).length;
                        summary.lanes.push({ id: task.id, resumed: true, exit: prior.exit, allMarkersPass: true, spawns });
                        continue;
                }
        }
        const sessionPath = path.join(outDir, `task-${task.id}.session.jsonl`);
        // A re-run must not CONTINUE the prior session file (--session resumes an
        // existing file — measured live 2026-10-30 when the t8 re-run merged both
        // runs' entries into one transcript). Rotate the prior file aside first.
        if (fs.existsSync(sessionPath)) {
                let n = 1;
                while (fs.existsSync(`${sessionPath}.prior-${n}.jsonl`)) n++;
                fs.renameSync(sessionPath, `${sessionPath}.prior-${n}.jsonl`);
        }
        const journalBefore = readJournal().length;
        const overviewBefore = await engineOverview();
        const t0 = Date.now();

        const proc = spawnSync(
                "bun",
                ["bin/unown", "-p", task.prompt, "--output-format", "json", "--session", sessionPath],
                {
                        cwd: REPO,
                        encoding: "utf8",
                        timeout: LANE_TIMEOUT_MS,
                        maxBuffer: 32 * 1024 * 1024,
                        env: { ...process.env, UNOWN_DELEGATION_LEVEL: "standard", NO_COLOR: "1" },
                },
        );
        const durationMs = Date.now() - t0;
        const stdout = proc.stdout ?? "";
        let envelope = null;
        try {
                envelope = JSON.parse(stdout);
        } catch {
                envelope = null;
        }
        const answer = envelope?.result ?? stdout.trim();
        const markers = Object.fromEntries(task.markers.map((re) => [String(re), re.test(answer)]));
        const allMarkersPass = Object.values(markers).every(Boolean);
        const artifact = verifyArtifact(task.artifact, answer);
        const journalAfter = readJournal();
        const journalDelta = journalAfter.slice(journalBefore);
        const overviewAfter = await engineOverview();

        const receipt = {
                schema: "delegation-round/lane/1",
                id: task.id,
                name: task.name,
                injected: !!task.injected,
                prompt: task.prompt,
                exit: proc.status,
                signal: proc.signal,
                timedOut: proc.signal === "SIGTERM" || proc.status === null,
                durationMs,
                envelope,
                markers,
                allMarkersPass,
                artifact,
                journalDelta,
                overviewBefore,
                overviewAfter,
                stderrTail: (proc.stderr ?? "").split("\n").slice(-8).join("\n").slice(0, 2000),
        };
        fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, "\t"));
        summary.lanes.push({
                id: task.id,
                exit: proc.status,
                durationMs,
                allMarkersPass,
                spawns: journalDelta.filter((l) => l.includes('"op":"spawned"')).length,
        });
        console.log(
                `  ${allMarkersPass ? "✓" : "✗"} ${task.id} — exit ${proc.status} · ${Math.round(durationMs / 1000)}s · ${journalDelta.filter((l) => l.includes('"op":"spawned"')).length} spawn(s)${proc.signal ? ` · SIGNAL ${proc.signal}` : ""}`,
        );
}

// the post-workload dream trigger (learning-retention axis): give the note-sync
// job a beat, then trigger auto-dream through the engine's own API — the same
// production path transfer-bench drives.
console.log("  … waiting 20s for note-sync, then triggering auto-dream");
await sleep(20_000);
const dreamBefore = await engineOverview();
let dreamTrigger = null;
{
        const token = engineToken();
        if (token) {
                // The trigger can 409 (engine busy with another job — measured
                // live 2026-10-30). Retry with backoff; notes stay pending.
                for (let attempt = 1; attempt <= 5; attempt++) {
                        try {
                                const res = await fetch("http://127.0.0.1:3030/api/jobs/auto-dream/trigger", {
                                        method: "POST",
                                        headers: { Authorization: `Bearer ${token}` },
                                        signal: AbortSignal.timeout(300_000),
                                });
                                const body = (await res.text()).slice(0, 500);
                                dreamTrigger = { status: res.status, body, attempt };
                                if (res.status !== 409) break;
                                await sleep(30_000);
                        } catch (e) {
                                dreamTrigger = { error: String(e).slice(0, 200), attempt };
                                await sleep(30_000);
                        }
                }
        }
}
const dreamAfter = await engineOverview();

fs.copyFileSync(fleetJournal, path.join(outDir, `journal-${label}.jsonl`));
summary.dream = { before: dreamBefore, trigger: dreamTrigger, after: dreamAfter };
summary.finishedAt = new Date().toISOString();
summary.tally = {
        lanes: summary.lanes.length,
        greenLanes: summary.lanes.filter((l) => l.allMarkersPass).length,
        totalSpawns: summary.lanes.reduce((a, l) => a + (l.spawns ?? 0), 0),
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, "\t"));
console.log(
        `# done — ${summary.tally.greenLanes}/${summary.tally.lanes} lanes green · ${summary.tally.totalSpawns} spawns · receipts in ${path.basename(outDir)}`,
);
