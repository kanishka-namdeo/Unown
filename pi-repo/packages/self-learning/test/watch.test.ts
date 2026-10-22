// Unit tests for src/watch.ts + src/watch-cli.ts — the AI-comment watch (M3,
// aider's --watch-files semantics on the always-on engine).
//
// Coverage contract (the design doc):
//   - the marker matrix: four language families, case tolerance, whitespace
//     tolerance, adjacent text, non-comment lines ignored, 500-char truncation
//   - hash stability: same comment → same hash; edited text/line/kind → new
//   - collectWatchableFiles guards through an injected fake walker (.git/
//     node_modules/.unown skips, size cap, file-count cap, symlink refusal,
//     allowlist, include globs) + a real-fs binary sniff
//   - buildWatchPrompt content (file:line refs, per-kind instructions,
//     remove-only-that-comment, report-mode no-edit)
//   - schema idempotency
//   - the new-vs-seen dedup state machine and resolved-comment cleanup
//   - marker discovery (enabled / disabled / malformed JSON)
//   - watch_runs recording + bus events
//   - the kill switch
//
// No test ever spawns a real agent run: runWatchScan's spawn seam is
// dependency-injected (the production adapter is the automations.ts
// spawnAutomationRun seam, exercised live elsewhere).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { subscribe } from "../src/bus.ts";
import { store } from "../src/store.ts";
import { runWatchCommand } from "../src/watch-cli.ts";
import {
        AI_COMMENT_MARKERS,
        buildWatchPrompt,
        collectWatchableFiles,
        commentHash,
        discoverWatchRoots,
        ensureWatchSchema,
        envWatchRoots,
        runWatchScan,
        scanFilesForAiComments,
        type AiComment,
        type WatchFs,
        type WatchSpawnFn,
} from "../src/watch.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempRoots: string[] = [];

/** A temp watch root with a marker file + source files (real fs). */
function makeWatchRoot(files: Record<string, string>, marker: unknown = { enabled: true }): string {
        const root = mkdtempSync(join(tmpdir(), "unown-watch-"));
        tempRoots.push(root);
        mkdirSync(join(root, ".unown"), { recursive: true });
        writeFileSync(join(root, ".unown", "watch.json"), typeof marker === "string" ? marker : JSON.stringify(marker));
        for (const [rel, content] of Object.entries(files)) {
                mkdirSync(dirname(join(root, rel)), { recursive: true });
                writeFileSync(join(root, rel), content);
        }
        return root;
}

/** A recording fake spawn — never spawns, captures the prompt, can mutate files. */
function fakeSpawn(
        behavior: (args: { root: string; prompt: string; mode: "report" | "standard" }) => Promise<{ exitCode: number; output: string }> | { exitCode: number; output: string },
): { spawn: WatchSpawnFn; calls: Array<{ root: string; prompt: string; mode: string }> } {
        const calls: Array<{ root: string; prompt: string; mode: string }> = [];
        const spawn: WatchSpawnFn = async (args) => {
                calls.push({ ...args });
                const out = await behavior(args);
                return { exitCode: out.exitCode, output: out.output, turns: 1, tokensIn: 10, tokensOut: 20 };
        };
        return { spawn, calls };
}

/** A fake fs walker over a declared file/dir tree (no disk). Dirs only need
 *  declaring when EMPTY or SYMLINKED — a file's parent is derived. */
function fakeFs(
        files: Array<{ path: string; content?: string | null; size?: number; symlink?: boolean }>,
        dirs: Array<{ path: string; symlink?: boolean }> = [],
): WatchFs {
        const children = new Map<string, Array<{ name: string; isDirectory: boolean; isSymlink: boolean }>>();
        const add = (dir: string, entry: { name: string; isDirectory: boolean; isSymlink: boolean }) => {
                const key = resolve(dir);
                const list = children.get(key) ?? [];
                if (!list.some((e) => e.name === entry.name)) list.push(entry);
                children.set(key, list);
        };
        // Materialize every ancestor DIRECTORY as an entry in its parent — the
        // real readdir(3) lists intermediate dirs; a naive file-derived map
        // never would, and the walker would see an empty root. NOTE: only the
        // ancestors of the LEAF's directory — the leaf entry itself is added
        // by the file/dir loops with its true kind.
        const ensureAncestors = (leafDir: string) => {
                let child = leafDir;
                let dir = dirname(leafDir);
                while (dir !== "/" && dir !== "" && dir !== child) {
                        add(dir, { name: basename(child), isDirectory: true, isSymlink: false });
                        child = dir;
                        dir = dirname(dir);
                }
        };
        for (const dir of dirs) {
                ensureAncestors(dirname(dir.path));
                add(dirname(dir.path) || "/", { name: basename(dir.path), isDirectory: true, isSymlink: Boolean(dir.symlink) });
        }
        for (const file of files) {
                ensureAncestors(dirname(file.path));
                add(dirname(file.path) || "/", { name: basename(file.path), isDirectory: false, isSymlink: Boolean(file.symlink) });
        }
        const find = (file: string) => files.find((f) => resolve(f.path) === resolve(file));
        return {
                readDir: (dir) => children.get(resolve(dir)) ?? [],
                statSize: (file) => {
                        const f = find(file);
                        if (!f) return null;
                        return f.size ?? (f.content ?? "").length;
                },
                readFile: (file) => {
                        const f = find(file);
                        return f?.content ?? null;
                },
        };
}

afterAll(() => {
        for (const root of tempRoots) {
                try {
                        rmSync(root, { recursive: true, force: true });
                } catch {
                        /* best-effort teardown (the router.test.ts bounded-retry idiom) */
                }
        }
        delete process.env.PI_WATCH_DISABLE;
        delete process.env.PI_WATCH_ROOTS;
});

// ---------------------------------------------------------------------------
// The marker matrix
// ---------------------------------------------------------------------------

describe("scanFilesForAiComments — the marker matrix", () => {
        test("the four language families × the three kinds", () => {
                const files = [
                        { path: "a.py", content: "# AI: py task\n# AI! py urgent\n# AI? py question\n" },
                        { path: "b.sh", content: "# AI: sh task\n" },
                        { path: "c.yml", content: "# AI: yml task\n" },
                        { path: "d.rb", content: "# AI: rb task\n" },
                        { path: "e.toml", content: "# AI: toml task\n" },
                        { path: "f.ts", content: "// AI: ts task\n" },
                        { path: "g.js", content: "// AI: js task\n" },
                        { path: "h.go", content: "// AI: go task\n" },
                        { path: "i.rs", content: "// AI: rs task\n" },
                        { path: "j.java", content: "// AI: java task\n" },
                        { path: "k.c", content: "// AI: c task\n" },
                        { path: "l.sql", content: "-- AI: sql task\n" },
                        { path: "m.lua", content: "-- AI: lua task\n" },
                        { path: "n.ini", content: "; AI: ini task\n" },
                ];
                const out = scanFilesForAiComments(files);
                expect(out.map((c) => `${c.file}:${c.kind}`).sort()).toEqual([
                        "a.py:question",
                        "a.py:task",
                        "a.py:urgent",
                        "b.sh:task",
                        "c.yml:task",
                        "d.rb:task",
                        "e.toml:task",
                        "f.ts:task",
                        "g.js:task",
                        "h.go:task",
                        "i.rs:task",
                        "j.java:task",
                        "k.c:task",
                        "l.sql:task",
                        "m.lua:task",
                        "n.ini:task",
                ].sort());
                // line numbers are 1-based and per file
                expect(out.filter((c) => c.file === "a.py").map((c) => c.line)).toEqual([1, 2, 3]);
        });

        test("case-insensitive markers, whitespace tolerance, adjacent text", () => {
                const out = scanFilesForAiComments([
                        { path: "a.py", content: "# ai: lowercase\n" },
                        { path: "b.py", content: "# Ai! mixed case\n" },
                        { path: "c.rb", content: "   #  AI:   padded marker and text   \n" },
                        { path: "d.ts", content: "\t//AI:no-space-after-marker\n" },
                        { path: "e.lua", content: "--- AI: lua doc-comment prefix\n" },
                        { path: "f.py", content: "## AI: doubled hash\n" },
                ]);
                expect(out.map((c) => c.text)).toEqual([
                        "lowercase",
                        "mixed case",
                        "padded marker and text",
                        "no-space-after-marker",
                        "lua doc-comment prefix",
                        "doubled hash",
                ]);
                expect(out.map((c) => c.kind)).toEqual(["task", "urgent", "task", "task", "task", "task"]);
        });

        test("non-comment lines are ignored (strings, mid-line comments, bare markers, shebangs)", () => {
                const content = [
                        'x = "# AI: inside a string"', // not start-of-line
                        "y = 1  # AI: trailing comment", // mid-line comment
                        "# just a normal comment",
                        "#AI no kind char",
                        "# A I: spaced marker",
                        "# AI:", // bare marker — no instruction text
                        "# AI!   ", // marker + whitespace only
                        "#!/usr/bin/env python3", // shebang: # then !, no AI
                        "SELECT '-- AI: not a comment start';",
                        "url = 'http://x// AI: no'",
                ].join("\n");
                expect(scanFilesForAiComments([{ path: "a.py", content }])).toEqual([]);
        });

        test("text truncates at 500 chars with a truncated flag, and the hash covers the clipped text", () => {
                const long = "x".repeat(600);
                const [comment] = scanFilesForAiComments([{ path: "a.py", content: `# AI: ${long}\n` }]);
                expect(comment.text).toHaveLength(500);
                expect(comment.truncated).toBe(true);
                expect(comment.hash).toBe(commentHash("a.py", 1, "task", "x".repeat(500)));
                // The clipped tail is NOT in the text: the full 600-char string
                // cannot fit in a 500-char clip (a 100-char slice of x's WOULD
                // match inside 500 x's — substring-of-homogeneous-text trap).
                expect(comment.text).not.toContain(long);
                // Under the cap: no flag
                const [short] = scanFilesForAiComments([{ path: "a.py", content: `# AI: ${"y".repeat(499)}\n` }]);
                expect(short.truncated).toBeUndefined();
        });

        test("the marker table carries the four families and documents the block-comment exclusion", () => {
                expect(AI_COMMENT_MARKERS.map((m) => m.prefix)).toEqual(["#", "//", "--", ";"]);
                for (const m of AI_COMMENT_MARKERS) expect(m.languages.length).toBeGreaterThan(3);
        });
});

// ---------------------------------------------------------------------------
// Hash stability
// ---------------------------------------------------------------------------

describe("commentHash — the dedup identity", () => {
        test("same comment → same hash; any edit → new hash", () => {
                const base = commentHash("src/app.py", 12, "task", "fix the retry loop");
                expect(commentHash("src/app.py", 12, "task", "fix the retry loop")).toBe(base);
                // edited text
                expect(commentHash("src/app.py", 12, "task", "fix the RETRY loop")).not.toBe(base);
                // moved line
                expect(commentHash("src/app.py", 13, "task", "fix the retry loop")).not.toBe(base);
                // different kind (AI: → AI!)
                expect(commentHash("src/app.py", 12, "urgent", "fix the retry loop")).not.toBe(base);
                // different file
                expect(commentHash("src/other.py", 12, "task", "fix the retry loop")).not.toBe(base);
        });

        test("marker case does not change the hash; path separators normalize", () => {
                const [lower] = scanFilesForAiComments([{ path: "a.py", content: "# ai: same instruction\n" }]);
                const [upper] = scanFilesForAiComments([{ path: "a.py", content: "# AI: same instruction\n" }]);
                expect(lower.hash).toBe(upper.hash);
                const [win] = scanFilesForAiComments([{ path: "src\\a.py", content: "# AI: same instruction\n" }]);
                expect(win.hash).toBe(commentHash("src/a.py", 1, "task", "same instruction"));
        });
});

// ---------------------------------------------------------------------------
// collectWatchableFiles guards (the injected fake walker)
// ---------------------------------------------------------------------------

describe("collectWatchableFiles — the walk guards", () => {
        test("skips .git, node_modules and .unown at any depth", () => {
                const fs = fakeFs(
                        [
                                { path: "/w/src/a.py", content: "# AI: keep me\n" },
                                { path: "/w/.git/x.py", content: "# AI: hidden\n" },
                                { path: "/w/node_modules/pkg/b.py", content: "# AI: hidden\n" },
                                { path: "/w/.unown/watch.json", content: "{}" },
                                { path: "/w/src/node_modules/c.py", content: "# AI: hidden\n" },
                                { path: "/w/src/.git/d.py", content: "# AI: hidden\n" },
                        ],
                        [{ path: "/w/.unown" }], // empty dir: only reachable via declaration
                );
                const out = collectWatchableFiles("/w", { fs });
                expect(out.map((f) => f.path)).toEqual(["src/a.py"]);
        });

        test("oversized files are skipped (512 KB default, override honored)", () => {
                const big = "z".repeat(600_000);
                const fs = fakeFs([
                        { path: "/w/big.py", content: big },
                        { path: "/w/small.py", content: "x" },
                ]);
                expect(collectWatchableFiles("/w", { fs }).map((f) => f.path)).toEqual(["small.py"]);
                // A smaller cap tightens the guard
                const fs2 = fakeFs([{ path: "/w/small.py", content: "x", size: 10 }]);
                expect(collectWatchableFiles("/w", { fs: fs2, maxFileBytes: 4 })).toEqual([]);
        });

        test("the file-count cap stops the walk", () => {
                const files = Array.from({ length: 30 }, (_, i) => ({ path: `/w/f${String(i).padStart(2, "0")}.py`, content: "x" }));
                const out = collectWatchableFiles("/w", { fs: fakeFs(files), maxFiles: 7 });
                expect(out).toHaveLength(7);
                // deterministic: sorted names, first 7
                expect(out[0].path).toBe("f00.py");
                expect(out[6].path).toBe("f06.py");
        });

        test("symlinked files and directories are never followed", () => {
                const fs = fakeFs(
                        [
                                { path: "/w/real.py", content: "x" },
                                { path: "/w/link.py", content: "x", symlink: true }, // symlinked FILE
                                { path: "/w/linked/secret.py", content: "x" },
                                { path: "/w/symdir/inside.py", content: "x" }, // only reachable THROUGH the symlink
                        ],
                        [{ path: "/w/symdir", symlink: true }], // symlinked DIR
                );
                const out = collectWatchableFiles("/w", { fs });
                expect(out.map((f) => f.path).sort()).toEqual(["linked/secret.py", "real.py"]);
        });

        test("the extension allowlist admits source files only", () => {
                const fs = fakeFs([
                        { path: "/w/a.py", content: "x" },
                        { path: "/w/b.ts", content: "x" },
                        { path: "/w/c.sql", content: "x" },
                        { path: "/w/d.txt", content: "x" }, // not a source family
                        { path: "/w/Makefile", content: "x" }, // no extension
                        { path: "/w/e.md", content: "x" }, // markdown: no line-comment family in v1
                ]);
                expect(collectWatchableFiles("/w", { fs }).map((f) => f.path).sort()).toEqual(["a.py", "b.ts", "c.sql"]);
        });

        test("include globs REPLACE the allowlist (basename anywhere, ** across dirs, * within a segment)", () => {
                const fs = fakeFs([
                        { path: "/w/a.py", content: "x" },
                        { path: "/w/docs/b.py", content: "x" },
                        { path: "/w/src/c.md", content: "x" },
                        { path: "/w/src/deep/d.rs", content: "x" },
                        { path: "/w/e.txt", content: "x" },
                        { path: "/w/other/f.py", content: "x" },
                ]);
                const out = collectWatchableFiles("/w", { fs, include: ["*.py", "src/**"] });
                expect(out.map((f) => f.path).sort()).toEqual(["a.py", "docs/b.py", "other/f.py", "src/c.md", "src/deep/d.rs"]);
                // A single * stays within one segment
                const out2 = collectWatchableFiles("/w", { fs, include: ["src/*.md"] });
                expect(out2.map((f) => f.path)).toEqual(["src/c.md"]);
        });

        test("real fs: a file with NUL bytes is skipped as binary", () => {
                const root = makeWatchRoot({ "bin.py": "# AI: binary\n\u0000\u0001\u0002", "txt.py": "# AI: text\n" });
                const out = collectWatchableFiles(root);
                expect(out.map((f) => f.path)).toEqual(["txt.py"]);
        });
});

// ---------------------------------------------------------------------------
// buildWatchPrompt
// ---------------------------------------------------------------------------

describe("buildWatchPrompt", () => {
        const comments: AiComment[] = [
                { file: "src/app.py", line: 12, kind: "task", text: "Add a unit test for parseRange.", hash: "h1" },
                { file: "src/app.py", line: 40, kind: "urgent", text: "Fix the off-by-one first.", hash: "h2" },
                { file: "src/db.sql", line: 3, kind: "question", text: "Why does the migration skip the index?", hash: "h3" },
        ];

        test("lists every comment as file:line with its marker badge", () => {
                const prompt = buildWatchPrompt(comments, { root: "/repo", mode: "report" });
                expect(prompt).toContain("src/app.py:12 [AI:] Add a unit test for parseRange.");
                expect(prompt).toContain("src/app.py:40 [AI!] Fix the off-by-one first.");
                expect(prompt).toContain("src/db.sql:3 [AI?] Why does the migration skip the index?");
                expect(prompt).toContain("/repo");
        });

        test("carries the per-kind contract + the remove-only-that-line rule", () => {
                const prompt = buildWatchPrompt(comments, { root: "/repo", mode: "standard" });
                expect(prompt).toContain("[AI:] task");
                expect(prompt).toContain("[AI!] urgent task");
                expect(prompt).toContain("handle these FIRST");
                expect(prompt).toContain("[AI?] question");
                expect(prompt).toContain("answer");
                expect(prompt).toContain("REMOVE its comment line");
                expect(prompt).toContain("ONLY that comment line");
                expect(prompt).toContain("never a comment you did not resolve");
        });

        test("report mode forbids edits; standard mode grants them", () => {
                const report = buildWatchPrompt(comments, { root: "/repo", mode: "report" });
                expect(report).toContain("Mode: REPORT");
                expect(report).toContain("DO NOT edit any file");
                const standard = buildWatchPrompt(comments, { root: "/repo", mode: "standard" });
                expect(standard).toContain("Mode: STANDARD");
                expect(standard).toContain("You may edit files");
                expect(standard).not.toContain("DO NOT edit any file");
        });

        test("flagged truncation is called out in the listing", () => {
                const prompt = buildWatchPrompt([{ file: "a.py", line: 1, kind: "task", text: "x".repeat(500), hash: "h", truncated: true }], {
                        root: "/repo",
                        mode: "report",
                });
                expect(prompt).toContain("text truncated at 500 chars");
        });
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("ensureWatchSchema", () => {
        test("is idempotent and installs watch_seen + watch_runs with their columns", () => {
                expect(() => {
                        ensureWatchSchema();
                        ensureWatchSchema();
                }).not.toThrow();
                const seen = store.query<{ name: string }>(`PRAGMA table_info(watch_seen)`).map((c) => c.name);
                expect(seen).toEqual(["hash", "file", "kind", "first_seen", "last_seen"]);
                const runs = store.query<{ name: string }>(`PRAGMA table_info(watch_runs)`).map((c) => c.name);
                expect(runs).toEqual(["id", "root", "comments", "mode", "status", "output", "started_at", "finished_at"]);
        });
});

// ---------------------------------------------------------------------------
// Marker discovery
// ---------------------------------------------------------------------------

describe("discoverWatchRoots — the .unown/watch.json opt-in", () => {
        test("enabled marker → a root (mode defaults to report; include parsed)", () => {
                const root = makeWatchRoot({ "a.py": "x" }, { enabled: true, mode: "standard", include: ["src/**"] });
                const d = discoverWatchRoots({ extraRoots: [root] });
                expect(d.roots).toHaveLength(1);
                expect(d.roots[0]).toMatchObject({ root, mode: "standard", include: ["src/**"] });
                expect(d.roots[0].markerPath).toBe(join(root, ".unown", "watch.json"));
                expect(d.warnings).toEqual([]);
        });

        test("enabled:false → not a root, listed as opted out, no warning", () => {
                const root = makeWatchRoot({ "a.py": "x" }, { enabled: false });
                const d = discoverWatchRoots({ extraRoots: [root] });
                expect(d.roots).toEqual([]);
                expect(d.disabled.map((x) => x.root)).toEqual([root]);
                expect(d.warnings).toEqual([]);
        });

        test("malformed JSON → disabled with a warning (surfaced in scan output)", async () => {
                const root = makeWatchRoot({ "a.py": "x" }, "{ not json");
                const d = discoverWatchRoots({ extraRoots: [root] });
                expect(d.roots).toEqual([]);
                expect(d.warnings.join("\n")).toContain("not valid JSON");
                // the scan output carries the warning too
                const scan = await runWatchScan({ roots: [root], spawn: fakeSpawn(() => ({ exitCode: 0, output: "" })).spawn });
                expect(scan.warnings.join("\n")).toContain("not valid JSON");
                expect(scan.roots).toEqual([]);
        });

        test("unknown mode → report (read-only) with a warning; invalid include → default allowlist", () => {
                const root = makeWatchRoot({ "a.py": "x" }, { enabled: true, mode: "yolo", include: "not-an-array" });
                const d = discoverWatchRoots({ extraRoots: [root] });
                expect(d.roots[0].mode).toBe("report");
                expect(d.roots[0].include).toBeNull();
                expect(d.warnings.join("\n")).toContain('unknown mode "yolo"');
                expect(d.warnings.join("\n")).toContain("invalid \"include\"");
        });

        test("no marker → not a root, silently (the common case)", () => {
                const root = mkdtempSync(join(tmpdir(), "unown-watch-"));
                tempRoots.push(root);
                const d = discoverWatchRoots({ extraRoots: [root] });
                expect(d.roots).toEqual([]);
                expect(d.warnings).toEqual([]);
        });

        test("PI_WATCH_ROOTS adds candidates (colon-separated on POSIX)", () => {
                const a = makeWatchRoot({ "a.py": "x" });
                const b = makeWatchRoot({ "b.py": "x" });
                const prev = process.env.PI_WATCH_ROOTS;
                const sep = process.platform === "win32" ? ";" : ":";
                process.env.PI_WATCH_ROOTS = [a, b].join(sep);
                try {
                        expect(envWatchRoots().sort()).toEqual([a, b].sort());
                        const d = discoverWatchRoots();
                        expect(d.roots.map((r) => r.root)).toContain(a);
                        expect(d.roots.map((r) => r.root)).toContain(b);
                } finally {
                        if (prev === undefined) delete process.env.PI_WATCH_ROOTS;
                        else process.env.PI_WATCH_ROOTS = prev;
                }
        });
});

// ---------------------------------------------------------------------------
// runWatchScan — the dedup state machine (injected spawn, real temp roots)
// ---------------------------------------------------------------------------

describe("runWatchScan — the state machine", () => {
        // Content-addressed hashes collide across tests when two roots carry the
        // same relative file + text (hashes are root-relative BY DESIGN); each
        // state-machine case gets a clean table so its expectations are hermetic.
        beforeEach(() => {
                store.run(`DELETE FROM watch_seen`);
                store.run(`DELETE FROM watch_runs`);
        });

        test("new comments dispatch ONE batched run; the run is recorded; still-present comments become seen", async () => {
                const root = makeWatchRoot({
                        "app.py": "import os\n# AI: fix the flaky retry\n# AI? why is retry capped\n",
                });
                const { spawn, calls } = fakeSpawn(() => ({ exitCode: 0, output: "done: fixed retry; answer: cap is legacy" }));
                const first = await runWatchScan({ roots: [root], spawn, now: 1_000 });
                expect(calls).toHaveLength(1);
                expect(calls[0].mode).toBe("report"); // marker default
                expect(calls[0].prompt).toContain("app.py:2 [AI:] fix the flaky retry");
                expect(calls[0].prompt).toContain("app.py:3 [AI?] why is retry capped");
                expect(first.roots[0]).toMatchObject({ newComments: 2, comments: 2, mode: "report" });
                // watch_runs: recorded, succeeded, output kept, finished set
                const run = store.get<any>(`SELECT * FROM watch_runs WHERE root = ?`, [root])!;
                expect(run).toMatchObject({ comments: 2, mode: "report", status: "succeeded" });
                expect(run.output).toContain("fixed retry");
                expect(run.started_at).toBe(1_000);
                expect(run.finished_at).not.toBeNull();
                // comments still present after the run → seen (hash-stable dedup)
                const seen = store.query<{ hash: string; last_seen: number }>(`SELECT hash, last_seen FROM watch_seen`);
                expect(seen).toHaveLength(2);
                for (const row of seen) expect(row.last_seen).toBe(1_000);
        });

        test("a quiet scan re-triggers nothing and refreshes last_seen (zero LLM cost)", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: fix the flaky retry\n" });
                const { spawn, calls } = fakeSpawn(() => ({ exitCode: 0, output: "ok" }));
                await runWatchScan({ roots: [root], spawn, now: 1_000 });
                expect(calls).toHaveLength(1);
                const second = await runWatchScan({ roots: [root], spawn, now: 2_000 });
                expect(calls).toHaveLength(1); // NO second dispatch
                expect(second.roots[0]).toMatchObject({ comments: 1, newComments: 0 });
                expect(second.roots[0].run).toBeNull();
                const row = store.get<{ last_seen: number }>(`SELECT last_seen FROM watch_seen WHERE file = ?`, ["app.py"])!;
                expect(row.last_seen).toBe(2_000); // bookkeeping still happens
        });

        test("an edited comment is a NEW comment (hash-stable dedup)", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: fix the retry\n" });
                const { spawn, calls } = fakeSpawn(() => ({ exitCode: 0, output: "ok" }));
                await runWatchScan({ roots: [root], spawn, now: 1_000 });
                // same text, one line lower → new hash → new dispatch
                writeFileSync(join(root, "app.py"), "import os\n# AI: fix the retry\n");
                await runWatchScan({ roots: [root], spawn, now: 2_000 });
                expect(calls).toHaveLength(2);
                expect(calls[1].prompt).toContain("app.py:2");
                // edited TEXT is new too
                writeFileSync(join(root, "app.py"), "# AI: fix the retry AND its test\n");
                await runWatchScan({ roots: [root], spawn, now: 3_000 });
                expect(calls).toHaveLength(3);
        });

        test("a resolved comment (run removed the line) is forgotten — its hash row is deleted", async () => {
                const root = makeWatchRoot({ "app.py": "import os\n# AI: fix the flaky retry\nx = 1\n" });
                const { spawn, calls } = fakeSpawn(({ root: r }) => {
                        // Resolve: delete ONLY the comment line (what a standard-mode run does).
                        writeFileSync(join(r, "app.py"), "import os\nx = 1\n");
                        return { exitCode: 0, output: "resolved" };
                });
                const first = await runWatchScan({ roots: [root], spawn, now: 1_000 });
                expect(first.roots[0].run).toMatchObject({ resolved: 1, stillPresent: 0 });
                expect(store.query(`SELECT * FROM watch_seen WHERE file = ?`, ["app.py"])).toEqual([]);
                // Re-adding the SAME comment later triggers again (forgiven = forgotten)
                writeFileSync(join(root, "app.py"), "import os\n# AI: fix the flaky retry\nx = 1\n");
                const third = await runWatchScan({ roots: [root], spawn, now: 2_000 });
                expect(third.roots[0].newComments).toBe(1);
                expect(calls).toHaveLength(2);
        });

        test("a comment that appears MID-RUN stays unseen and dispatches on the next scan", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: first task\n" });
                const { spawn, calls } = fakeSpawn(({ root: r }) => {
                        writeFileSync(join(r, "late.py"), "# AI: added while the run was going\n");
                        return { exitCode: 0, output: "ok" };
                });
                await runWatchScan({ roots: [root], spawn, now: 1_000 });
                expect(calls[0].prompt).not.toContain("late.py");
                // mid-run comment was NOT marked seen
                expect(store.get(`SELECT 1 FROM watch_seen WHERE file = ?`, ["late.py"])).toBeNull(); // store.get's not-found shape
                await runWatchScan({ roots: [root], spawn, now: 2_000 });
                expect(calls).toHaveLength(2);
                expect(calls[1].prompt).toContain("late.py:1");
        });

        test("a failed spawn records a failed run (exit code, output kept)", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: doomed task\n" });
                const { spawn } = fakeSpawn(() => ({ exitCode: 3, output: "the model refused" }));
                const result = await runWatchScan({ roots: [root], spawn, now: 1_000 });
                expect(result.roots[0].run).toMatchObject({ status: "failed", exitCode: 3 });
                const row = store.get<any>(`SELECT status, output FROM watch_runs WHERE root = ?`, [root])!;
                expect(row.status).toBe("failed");
                expect(row.output).toContain("the model refused");
        });

        test("emits watch:scan and watch:run-finished bus events (the SSE feed)", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: watched\n" });
                const events: Array<{ event: string; payload: any }> = [];
                const off = subscribe((e) => {
                        if (e.event === "watch:scan" || e.event === "watch:run-finished") events.push(e);
                });
                try {
                        await runWatchScan({ roots: [root], spawn: fakeSpawn(() => ({ exitCode: 0, output: "ok" })).spawn, now: 1_000 });
                } finally {
                        off();
                }
                expect(events.map((e) => e.event)).toEqual(["watch:scan", "watch:run-finished"]);
                expect(events[0].payload).toMatchObject({ root, comments: 1, new: 1 });
                expect(events[1].payload).toMatchObject({ root, status: "succeeded", comments: 1, resolved: 0 });
        });

        test("standard mode flows through the seam", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: apply me\n" }, { enabled: true, mode: "standard" });
                const { spawn, calls } = fakeSpawn(() => ({ exitCode: 0, output: "applied" }));
                await runWatchScan({ roots: [root], spawn, now: 1_000 });
                expect(calls[0].mode).toBe("standard");
                expect(calls[0].prompt).toContain("Mode: STANDARD");
        });

        test("PI_WATCH_DISABLE=1 skips the whole pass (the kill switch)", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: nothing happens\n" });
                const { spawn, calls } = fakeSpawn(() => ({ exitCode: 0, output: "ok" }));
                process.env.PI_WATCH_DISABLE = "1";
                try {
                        const result = await runWatchScan({ roots: [root], spawn, now: 1_000 });
                        expect(result.skipped).toContain("PI_WATCH_DISABLE=1");
                        expect(result.roots).toEqual([]);
                        expect(calls).toHaveLength(0);
                } finally {
                        delete process.env.PI_WATCH_DISABLE;
                }
        });
});

// ---------------------------------------------------------------------------
// The CLI surface
// ---------------------------------------------------------------------------

describe("runWatchCommand — the CLI", () => {
        // Same hermetic-tables rule as the state-machine suite: the CLI's list
        // marking (new/seen) reads watch_seen.
        beforeEach(() => {
                store.run(`DELETE FROM watch_seen`);
                store.run(`DELETE FROM watch_runs`);
        });

        test("bare `watch` prints usage (exit 1); --help exits 0", async () => {
                const bare = await runWatchCommand([], { cwd: process.cwd() });
                expect(bare.exitCode).toBe(1);
                expect(bare.stdout).toContain("unown watch list");
                const help = await runWatchCommand(["--help"], { cwd: process.cwd() });
                expect(help.exitCode).toBe(0);
                expect(help.stdout).toContain("unown watch roots");
                const bad = await runWatchCommand(["frobnicate"], { cwd: process.cwd() });
                expect(bad.exitCode).toBe(1);
                expect(bad.stderr).toContain('unknown subcommand "frobnicate"');
        });

        test("`watch roots` lists discovered roots with mode + marker path (offline)", async () => {
                const root = makeWatchRoot({ "a.py": "x" }, { enabled: true, mode: "standard" });
                const prev = process.env.PI_WATCH_ROOTS;
                process.env.PI_WATCH_ROOTS = root;
                try {
                        const result = await runWatchCommand(["roots"], { cwd: process.cwd() });
                        expect(result.exitCode).toBe(0);
                        expect(result.stdout).toContain(root);
                        expect(result.stdout).toContain("mode: standard");
                        expect(result.stdout).toContain(join(root, ".unown", "watch.json"));
                        // a disabled marker is shown as opted out, not as a root
                        const off = makeWatchRoot({}, { enabled: false });
                        process.env.PI_WATCH_ROOTS = `${root}${process.platform === "win32" ? ";" : ":"}${off}`;
                        const result2 = await runWatchCommand(["roots"], { cwd: process.cwd() });
                        expect(result2.stdout).toContain(root);
                        expect(result2.stdout).toContain("opted out");
                        expect(result2.stdout).toContain(off);
                } finally {
                        if (prev === undefined) delete process.env.PI_WATCH_ROOTS;
                        else process.env.PI_WATCH_ROOTS = prev;
                }
        });

        test("`watch list` groups comments by root+file with kind badges + new/seen", async () => {
                const root = makeWatchRoot({
                        "app.py": "import os\n# AI: fix the flaky retry\n# AI? why is retry capped\n",
                        "db.sql": "-- AI! add the index now\n",
                });
                const prev = process.env.PI_WATCH_ROOTS;
                process.env.PI_WATCH_ROOTS = root;
                try {
                        const first = await runWatchCommand(["list"], { cwd: process.cwd() });
                        expect(first.exitCode).toBe(0);
                        expect(first.stdout).toContain(root);
                        expect(first.stdout).toContain("app.py");
                        expect(first.stdout).toContain("[AI:] fix the flaky retry");
                        expect(first.stdout).toContain("[AI?] why is retry capped");
                        expect(first.stdout).toContain("[AI!] add the index now");
                        expect(first.stdout.match(/\(new\)/g)?.length).toBe(3);
                        // after a scan+resolve pass the comments are seen
                        await runWatchScan({ roots: [root], spawn: fakeSpawn(() => ({ exitCode: 0, output: "ok" })).spawn, now: 1_000 });
                        const second = await runWatchCommand(["list"], { cwd: process.cwd() });
                        expect(second.stdout).not.toContain("(new)");
                        expect(second.stdout.match(/\(seen\)/g)?.length).toBe(3);
                        // --json is machine-readable
                        const json = await runWatchCommand(["list", "--json"], { cwd: process.cwd() });
                        const parsed = JSON.parse(json.stdout!);
                        expect(parsed.roots[0].comments).toHaveLength(3);
                        expect(parsed.roots[0].comments[0].isNew).toBe(false);
                } finally {
                        if (prev === undefined) delete process.env.PI_WATCH_ROOTS;
                        else process.env.PI_WATCH_ROOTS = prev;
                }
        });

        test("`watch run` respects the kill switch and never spawns while disabled", async () => {
                const root = makeWatchRoot({ "app.py": "# AI: never dispatched\n" });
                const prev = process.env.PI_WATCH_ROOTS;
                process.env.PI_WATCH_ROOTS = root;
                process.env.PI_WATCH_DISABLE = "1";
                try {
                        const result = await runWatchCommand(["run"], { cwd: process.cwd() });
                        expect(result.exitCode).toBe(0);
                        expect(result.stdout).toContain("watch disabled");
                        expect(store.get(`SELECT 1 FROM watch_runs WHERE root = ?`, [root])).toBeNull(); // store.get's not-found shape
                } finally {
                        delete process.env.PI_WATCH_DISABLE;
                        if (prev === undefined) delete process.env.PI_WATCH_ROOTS;
                        else process.env.PI_WATCH_ROOTS = prev;
                }
        });
});
