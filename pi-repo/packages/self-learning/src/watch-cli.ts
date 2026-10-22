/**
 * watch-cli.ts — `unown watch`: the shell surface for the AI-comment watch
 * (aider's --watch-files semantics on the always-on engine; the loop itself
 * lives in src/watch.ts, the router job `watch-scan`).
 *
 *   unown watch list [--json]   scan every watch root now; print comments
 *                               grouped by root+file with kind badges +
 *                               new/seen (a scan, never a run)
 *   unown watch run             force one scan+resolve pass NOW, bypassing
 *                               the 2-minute interval — through the SAME
 *                               spawn seam the engine job uses
 *   unown watch roots [--json]  discovered watch roots + mode + marker path
 *
 * Engine-down behavior (deliberate, the M1 self-heal posture): `list` and
 * `roots` are fully offline — marker discovery is a file read, newness is a
 * read-only query over the engine's SQLite (WAL allows a concurrent reader).
 * `run` ping-and-spawns a down engine first (the interval job's home is the
 * engine — a forced pass that also revives the daemon fixes both now and
 * next), then executes IN-PROCESS against the same store the engine uses:
 * SQLite WAL supports a second short-lived writer, and the engine's
 * busy-mutex covers its own jobs — the same accepted pattern as `unown note`
 * writing the outbox. The worst case of a forced pass racing the engine's own
 * tick is one duplicated batch (both saw "new" before either committed); the
 * hash dedup converges on the next scan. No REST endpoint exists for watch,
 * by design: server.ts stays the other agents' surface.
 */
import { collectWatchableFiles, discoverWatchRoots, ensureWatchSchema, runWatchScan, scanFilesForAiComments } from "./watch.ts";
import { store } from "./store.ts";

export interface CliResult {
        stdout?: string;
        stderr?: string;
        exitCode: number;
}

export const WATCH_USAGE = `unown watch — AI comments in code, resolved by the always-on engine
(aider's --watch-files semantics: drop instructions in comments, the engine collects them)

Usage:
  unown watch list [--json]     scan every watch root now; show comments with
                                kind badges (AI: task · AI! urgent · AI? question)
                                and new/seen state — never dispatches a run
  unown watch run               force one scan+resolve pass NOW (bypasses the
                                engine's 2-minute interval; same spawn seam)
  unown watch roots [--json]    discovered watch roots, their mode and marker file

Opt-in: a project becomes a watch root via .unown/watch.json
  {"enabled": true, "mode": "report" | "standard", "include": ["*.py", "src/**"]}
(mode defaults to "report" — read-only; "standard" grants writes, choose it
deliberately. include is optional and replaces the default source allowlist.)

Markers (line comments, start-of-line, case-insensitive):
  # AI: task   # AI! urgent   # AI? question      (python, shell, yaml, ruby, toml)
  // AI: · // AI! · // AI?                        (typescript, js, go, rust, java, c...)
  -- AI: · -- AI! · -- AI?                        (sql, lua, haskell)
  ; AI: · ; AI! · ; AI?                           (ini, cfg)

A comment triggers exactly once (hash dedup); the run removes the comment line
when the work is done — a removed comment is forgotten, so re-adding it later
triggers again. Docs: docs/watch.md.`;

const KIND_BADGE: Record<string, string> = { task: "[AI:]", urgent: "[AI!]", question: "[AI?]" };

function hasFlag(argv: string[], name: string): boolean {
        return argv.includes(name);
}

/** The first non-flag token (the automations-cli convention; watch takes no
 *  value-flags, so a plain filter is exact). */
function subcommand(argv: string[]): string | undefined {
        return argv.find((a) => !a.startsWith("-"));
}

function seenHashes(): Set<string> {
        try {
                return new Set(store.query<{ hash: string }>(`SELECT hash FROM watch_seen`).map((r) => r.hash));
        } catch {
                return new Set();
        }
}

export async function runWatchCommand(argv: string[], opts: { cwd: string }): Promise<CliResult> {
        const sub = subcommand(argv);
        // Help flags FIRST: `--help` renders the page and exits 0 even though
        // subcommand() sees no positional verb (a flag token is not a verb —
        // the bare-invocation exit-1 branch below must not own the help path).
        if (sub === "help" || hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
                return { stdout: WATCH_USAGE, exitCode: 0 };
        }
        if (sub === undefined) {
                // clig.dev: `unown watch` with no verb is a usage question, not a
                // scan — print the page (exit 1 only for the bare invocation).
                return { stdout: WATCH_USAGE, exitCode: 1 };
        }
        if (sub !== "list" && sub !== "run" && sub !== "roots") {
                return { stderr: `unown watch: unknown subcommand "${sub}"\n\n${WATCH_USAGE}`, exitCode: 1 };
        }
        const json = hasFlag(argv, "--json");

        if (sub === "roots") {
                const discovery = discoverWatchRoots();
                if (json) {
                        return { stdout: JSON.stringify(discovery, null, 2) + "\n", exitCode: 0 };
                }
                const lines: string[] = [];
                if (discovery.roots.length === 0) {
                        lines.push("No watch roots discovered.");
                        lines.push("A project opts in with .unown/watch.json: {\"enabled\": true}  (see docs/watch.md)");
                }
                for (const r of discovery.roots) {
                        lines.push(`${r.root}`);
                        lines.push(`  mode: ${r.mode}${r.include ? ` · include: ${r.include.join(", ")}` : " · include: default source allowlist"}`);
                        lines.push(`  marker: ${r.markerPath}`);
                }
                for (const d of discovery.disabled) {
                        lines.push(`${d.root} — opted out (enabled: false in ${d.markerPath})`);
                }
                const out = lines.join("\n") + "\n";
                return { stdout: out, stderr: discovery.warnings.length > 0 ? discovery.warnings.join("\n") + "\n" : undefined, exitCode: 0 };
        }

        if (sub === "list") {
                ensureWatchSchema();
                const discovery = discoverWatchRoots();
                const seen = seenHashes();
                const byRoot = discovery.roots.map((r) => {
                        const files = collectWatchableFiles(r.root, r.include ? { include: r.include } : {});
                        const comments = scanFilesForAiComments(files);
                        return { root: r, files: files.length, comments };
                });
                if (json) {
                        return {
                                stdout:
                                        JSON.stringify(
                                                {
                                                        roots: byRoot.map((r) => ({
                                                                root: r.root.root,
                                                                mode: r.root.mode,
                                                                files: r.files,
                                                                comments: r.comments.map((c) => ({ ...c, isNew: !seen.has(c.hash) })),
                                                        })),
                                                        warnings: discovery.warnings,
                                                },
                                                null,
                                                2,
                                        ) + "\n",
                                exitCode: 0,
                        };
                }
                const lines: string[] = [];
                if (byRoot.length === 0) {
                        lines.push("No watch roots discovered.");
                        lines.push("A project opts in with .unown/watch.json: {\"enabled\": true}  (see docs/watch.md)");
                }
                for (const r of byRoot) {
                        const newCount = r.comments.filter((c) => !seen.has(c.hash)).length;
                        lines.push(`${r.root.root}  (mode ${r.root.mode} · ${r.files} files · ${r.comments.length} comments · ${newCount} new)`);
                        if (r.comments.length === 0) lines.push("  no AI comments found");
                        let lastFile = "";
                        for (const c of r.comments) {
                                if (c.file !== lastFile) {
                                        lines.push(`  ${c.file}`);
                                        lastFile = c.file;
                                }
                                const state = seen.has(c.hash) ? "seen" : "new";
                                lines.push(`    ${String(c.line).padStart(4)} ${KIND_BADGE[c.kind] ?? "[AI:]"} ${c.text}${c.truncated ? " …(truncated)" : ""}  (${state})`);
                        }
                }
                const out = lines.join("\n") + "\n";
                return { stdout: out, stderr: discovery.warnings.length > 0 ? discovery.warnings.join("\n") + "\n" : undefined, exitCode: 0 };
        }

        // `unown watch run` — the forced pass. Self-heal first (the P3 posture:
        // every engine-touching surface revives a down daemon), then run
        // IN-PROCESS: the forced pass must work even while the engine is still
        // booting, and the concurrency contract is the module header's.
        if (process.env.PI_DISABLE_ENGINE_SPAWN !== "1") {
                try {
                        const { ensureEngineRunning } = await import("./engine-supervisor.ts");
                        await ensureEngineRunning(15_000);
                } catch {
                        /* the forced pass below still runs in-process — the honest per-root report follows */
                }
        }
        const result = await runWatchScan();
        if (json) {
                return { stdout: JSON.stringify(result, null, 2) + "\n", exitCode: 0 };
        }
        const lines: string[] = [];
        if (result.skipped) {
                return { stdout: `watch disabled — ${result.skipped}\n`, exitCode: 0 };
        }
        if (result.roots.length === 0) {
                lines.push("No watch roots discovered — nothing to do.");
                lines.push("A project opts in with .unown/watch.json: {\"enabled\": true}  (see docs/watch.md)");
        }
        let failed = false;
        for (const r of result.roots) {
                lines.push(`${r.root}  (mode ${r.mode} · ${r.files} files · ${r.comments} comments · ${r.newComments} new)`);
                if (!r.run) {
                        lines.push("  no new comments — nothing dispatched (zero LLM cost)");
                        continue;
                }
                failed = failed || r.run.status === "failed";
                lines.push(
                        `  run #${r.run.runId}: ${r.run.status} · ${r.run.comments} dispatched · ${r.run.resolved} resolved · ${r.run.stillPresent} kept` +
                                (r.run.turns || r.run.tokensIn || r.run.tokensOut ? ` · ${r.run.turns} turns · ${r.run.tokensIn}+${r.run.tokensOut} tokens` : ""),
                );
                const row = store.get<{ output: string | null }>(`SELECT output FROM watch_runs WHERE id = ?`, [r.run.runId]);
                const head = (row?.output ?? "")
                        .split("\n")
                        .filter((l) => l.trim() !== "")
                        .slice(0, 8)
                        .map((l) => `    ${l}`)
                        .join("\n");
                if (head) lines.push(head);
        }
        const out = lines.join("\n") + "\n";
        return {
                stdout: out,
                stderr: result.warnings.length > 0 ? result.warnings.join("\n") + "\n" : undefined,
                exitCode: failed ? 1 : 0,
        };
}
