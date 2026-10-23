// Unit tests for src/repomap/* — the aider-style repo map: tag projection
// (incl. the #not-eq?/#not-match? guards that web-tree-sitter compiles but
// does not filter), the reference graph + multipliers, PageRank determinism,
// budget-fitting render, the per-file cache, mention extraction, and the
// end-to-end buildRepoMap against the REAL vendored grammars (mirrors
// aider's tests/basic/test_repomap.py case list).
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        tagsFromCaptures,
        regexFallbackTags,
        looksMeaningful,
        extOf,
        grammarForExt,
        type Tag,
        type RawCapture,
} from "../src/repomap/tags.ts";
import { buildRefGraph, pagerank, rankDefinitionsWith } from "../src/repomap/graph.ts";
import { buildRenderEntries, fitToBudget, renderEntry } from "../src/repomap/render.ts";
import { entryMatchesStat, entryMatchesHash, sha256Of, loadTagsCache, saveTagsCache, MapCache, trimCache, emptyCache } from "../src/repomap/cache.ts";
import { buildRepoMap, extractMentions, clearRepomapCaches } from "../src/repomap/repomap-core.ts";
import { parseRepomapArgs, composeTaskWithMap } from "../src/repomap/repomap-cli.ts";
import { getRepomapRuntime } from "../src/repomap/treesitter.ts";

const cap = (name: string, row: number, text: string): RawCapture => ({
        name,
        node: { startPosition: { row }, text },
});

function tmpRepo(files: Record<string, string>): { root: string; cleanup: () => void } {
        const root = mkdtempSync(join(tmpdir(), "unown-repomap-"));
        for (const [rel, content] of Object.entries(files)) {
                const abs = join(root, rel);
                mkdirSync(join(abs, ".."), { recursive: true });
                writeFileSync(abs, content);
        }
        return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("tags.ts (pure projection)", () => {
        test("name.definition.*/name.reference.* captures map to def/ref tags", () => {
                const tags = tagsFromCaptures("a.ts", [
                        cap("name.definition.function", 3, "greet"),
                        cap("name.reference.call", 8, "greet"),
                        cap("name.definition.class", 1, "Foo"),
                        cap("other.capture", 9, "ignored"),
                ]);
                expect(tags).toEqual([
                        { relFname: "a.ts", line: 3, name: "greet", kind: "def" },
                        { relFname: "a.ts", line: 8, name: "greet", kind: "ref" },
                        { relFname: "a.ts", line: 1, name: "Foo", kind: "def" },
                ]);
        });
        test("web-tree-sitter predicate guards enforced in code: constructor defs and require refs are dropped", () => {
                const tags = tagsFromCaptures("a.js", [
                        cap("name.definition.method", 2, "constructor"),
                        cap("name.definition.method", 5, "realMethod"),
                        cap("name.reference.call", 7, "require"),
                        cap("name.reference.call", 8, "otherCall"),
                ]);
                expect(tags.map((t) => t.name)).toEqual(["realMethod", "otherCall"]);
        });
        test("regex fallback: go/rust/ruby defs extracted, unknown ext yields nothing", () => {
                const go = regexFallbackTags("main.go", "package main\nfunc main() {}\nfunc helper(x int) int {\n\treturn x\n}\n");
                expect(go.map((t) => t.name)).toEqual(["main", "helper"]);
                const rs = regexFallbackTags("lib.rs", "pub struct Config {\n    pub name: String,\n}\npub fn build() -> Config {\n    unimplemented!()\n}\n");
                expect(rs.map((t) => t.name)).toEqual(["Config", "build"]);
                const rb = regexFallbackTags("app.rb", "class Application\n  def run!\n    puts 1\n  end\nend\n");
                expect(rb.map((t) => t.name)).toEqual(["Application", "run!"]);
                expect(regexFallbackTags("data.csv", "a,b\n1,2\n")).toEqual([]);
        });
        test("looksMeaningful: aider's heuristic", () => {
                expect(looksMeaningful("parse_config")).toBe(true);
                expect(looksMeaningful("HttpClient")).toBe(true);
                expect(looksMeaningful("short")).toBe(false);
                expect(looksMeaningful("data")).toBe(false);
                expect(looksMeaningful("HTTPCLIENT")).toBe(false); // all-caps → not mixed
        });
        test("ext mapping", () => {
                expect(extOf("src/a.test.ts")).toBe("ts");
                expect(extOf(".env")).toBe("");
                expect(grammarForExt("ts")).toBe("typescript");
                expect(grammarForExt("tsx")).toBe("tsx");
                expect(grammarForExt("py")).toBe("python");
                expect(grammarForExt("go")).toBe(null);
        });
});

describe("graph.ts (reference graph + PageRank)", () => {
        const tags: Tag[] = [
                { relFname: "util.ts", line: 0, name: "computeValue", kind: "def" },
                { relFname: "app.ts", line: 5, name: "computeValue", kind: "ref" },
                { relFname: "app.ts", line: 0, name: "mainEntry", kind: "def" },
                { relFname: "orphan.ts", line: 0, name: "lonelyHelper", kind: "def" },
        ];
        test("edges point referencer → definer; unreferenced defs get self-edges", () => {
                const g = buildRefGraph(["util.ts", "app.ts", "orphan.ts"], tags);
                const appEdges = g.edges.get("app.ts")!;
                expect(appEdges.has("util.ts")).toBe(true); // app references util's def
                expect(g.edges.get("orphan.ts")!.get("orphan.ts")!.get("lonelyHelper")).toBeCloseTo(0.1, 5);
                expect(g.outSum.get("app.ts")!).toBeGreaterThan(0);
        });
        test("chat-file referencers carry the ×50 multiplier", () => {
                const plain = buildRefGraph(["util.ts", "app.ts"], tags);
                const withChat = buildRefGraph(["util.ts", "app.ts"], tags, { chatFiles: new Set(["app.ts"]) });
                expect(withChat.outSum.get("app.ts")!).toBeGreaterThan(plain.outSum.get("app.ts")! * 10);
        });
        test("mentioned idents get the ×10 multiplier", () => {
                const plain = buildRefGraph(["util.ts", "app.ts"], tags);
                const boosted = buildRefGraph(["util.ts", "app.ts"], tags, { mentionedIdents: new Set(["computeValue"]) });
                expect(boosted.outSum.get("app.ts")!).toBeGreaterThan(plain.outSum.get("app.ts")!);
        });
        test("defs-only repo: references := defines swap keeps the graph well-defined", () => {
                const defs: Tag[] = [
                        { relFname: "a.ts", line: 0, name: "onlyDef", kind: "def" },
                        { relFname: "b.ts", line: 0, name: "anotherDef", kind: "def" },
                ];
                const g = buildRefGraph(["a.ts", "b.ts"], defs);
                expect(g.edges.size).toBeGreaterThan(0);
                const ranked = rankDefinitionsWith(g, pagerank(g));
                expect(ranked.length).toBeGreaterThan(0);
        });
        test("pagerank is deterministic and sums to 1", () => {
                const g = buildRefGraph(["util.ts", "app.ts", "orphan.ts"], tags);
                const r1 = pagerank(g);
                const r2 = pagerank(g);
                let sum = 0;
                for (const v of r1.values()) sum += v;
                expect(sum).toBeCloseTo(1, 5);
                expect([...r1.entries()].sort().toString()).toEqual([...r2.entries()].sort().toString());
        });
        test("personalization boosts the mentioned file's rank", () => {
                const g = buildRefGraph(["util.ts", "app.ts", "orphan.ts"], tags, { mentionedFiles: new Set(["orphan.ts"]) });
                const x = pagerank(g);
                expect(x.get("orphan.ts")!).toBeGreaterThan(x.get("util.ts")!);
        });
});

describe("render.ts (budget fit + tree format)", () => {
        const readLines = (f: string) => ({
                "a.ts": ["export function one() {", "  return 1;", "}", "export function two() {", "  return 2;", "}"],
                "b.md": ["# readme"],
        } as Record<string, string[]>)[f] ?? null;
        const entries = buildRenderEntries(
                [
                        { file: "a.ts", ident: "one", rank: 0.9 },
                        { file: "a.ts", ident: "two", rank: 0.8 },
                ],
                buildRefGraph(
                        ["a.ts", "b.md"],
                        [
                                { relFname: "a.ts", line: 0, name: "one", kind: "def" },
                                { relFname: "a.ts", line: 3, name: "two", kind: "def" },
                        ],
                ),
                ["a.ts", "b.md"],
                new Set(),
        );
        test("def lines render with gutters and elision; bare files render as paths", () => {
                const lines = renderEntry(entries[0], readLines);
                expect(lines[0]).toBe("a.ts:");
                expect(lines[1]).toBe("│export function one() {");
                expect(lines[2]).toBe("│⋮..."); // lines 0 → 3 gap elided
                expect(lines[3]).toBe("│export function two() {");
                const bare = renderEntry(entries[1], readLines);
                expect(bare).toEqual(["b.md"]);
        });
        test("budget fit: binary search converges, respects the budget (aider's 15% tolerance)", () => {
                const fitted = fitToBudget(entries, 30, readLines);
                expect(fitted.probes).toBeLessThanOrEqual(12); // O(log n)
                expect(fitted.tokens).toBeLessThanOrEqual(30 * 1.15);
                expect(fitted.text).toContain("a.ts:");
        });
        test("tiny budget floor: bare filenames when even one tag overflows", () => {
                const fitted = fitToBudget(entries, 2, readLines);
                expect(fitted.tagsIncluded).toBe(0);
                expect(fitted.text).toContain("a.ts");
        });
        test("100-char line truncation (minified-js guard)", () => {
                const long = "x".repeat(300);
                const lines = renderEntry(
                        { file: "min.js", bare: false, tags: [{ relFname: "min.js", line: 0, name: "huge", kind: "def" }] },
                        () => [long],
                );
                expect(lines[1].length).toBeLessThanOrEqual(102); // │ + 100 chars + …
        });
});

describe("cache.ts", () => {
        test("validity tiers: stat fast path trusts mtime+size; hash rescues stat-mismatched identical content", () => {
                const content = "function a() {}";
                const entry = { mtimeMs: 1, size: content.length, sha256: sha256Of(content), tags: [] as Tag[] };
                // Fast path: stat match → trusted without reading.
                expect(entryMatchesStat(entry, { mtimeMs: 1, size: content.length })).toBe(true);
                expect(entryMatchesStat(entry, { mtimeMs: 2, size: content.length })).toBe(false);
                expect(entryMatchesStat(undefined, { mtimeMs: 1, size: 1 })).toBe(false);
                // Slow path (stat moved → file read): same content survives,
                // different content invalidates.
                expect(entryMatchesHash(entry, sha256Of(content))).toBe(true);
                expect(entryMatchesHash(entry, sha256Of("function b() {}"))).toBe(false);
                expect(entryMatchesHash(undefined, sha256Of(content))).toBe(false);
        });
        test("round-trip: save + load; version mismatch resets; trim caps entries", () => {
                const { root, cleanup } = tmpRepo({});
                const path = join(root, "cache.json");
                const cache = emptyCache();
                cache.entries["a.ts"] = { mtimeMs: 1, size: 2, sha256: "h", tags: [{ relFname: "a.ts", line: 0, name: "x", kind: "def" }] };
                saveTagsCache(path, cache);
                const loaded = loadTagsCache(path);
                expect(loaded.entries["a.ts"].tags[0].name).toBe("x");
                const stale = { version: 999, entries: cache.entries };
                saveTagsCache(path, stale as any);
                expect(loadTagsCache(path).entries["a.ts"]).toBeUndefined();
                // Trim keeps the newest MAX entries.
                const big = emptyCache();
                for (let i = 0; i < 30; i++) big.entries[`f${i}.ts`] = { mtimeMs: i, size: 1, sha256: "h", tags: [] };
                trimCache(big, 10);
                expect(Object.keys(big.entries)).toHaveLength(10);
                expect(big.entries["f29.ts"]).toBeDefined();
                expect(big.entries["f0.ts"]).toBeUndefined();
                cleanup();
        });
        test("MapCache: hit on identical inputs (slow builds), miss on budget/mentions change; cheap builds never served", () => {
                const mc = new MapCache(2, 60_000, 0); // ttl 60s, slow-floor 0 for direct testing
                mc.set(["a.ts"], 512, "", { text: "m", tokens: 1, filesIncluded: 1 }, 1200);
                expect(mc.get(["a.ts"], 512, "")?.text).toBe("m");
                expect(mc.get(["a.ts"], 1024, "")).toBe(null);
                expect(mc.get(["a.ts"], 512, "mentioned")).toBe(null);
                // A cheap build recorded (buildMs below the default floor of a
                // default-constructed cache) is never served stale.
                const strict = new MapCache(); // slowMs = MAP_CACHE_SLOW_MS (900)
                strict.set(["a.ts"], 512, "", { text: "m", tokens: 1, filesIncluded: 1 }, 50);
                expect(strict.get(["a.ts"], 512, "")).toBe(null);
                strict.set(["a.ts"], 512, "", { text: "m", tokens: 1, filesIncluded: 1 }, 5000);
                expect(strict.get(["a.ts"], 512, "")?.text).toBe("m");
        });
});

describe("mentions + compose layers", () => {
        test("extractMentions: paths and stems match; prose words become idents", () => {
                const files = ["src/repomap/graph.ts", "src/automations.ts", "README.md"];
                const m = extractMentions("fix the pagerank in graph.ts and check automations", files);
                expect(m.files).toContain("src/repomap/graph.ts");
                // "automations" is the stem of automations.ts → file mention via stem.
                expect(m.files).toContain("src/automations.ts");
                expect(m.idents).toContain("pagerank");
        });
        test("composeTaskWithMap frames the map read-only AFTER the task", () => {
                const out = composeTaskWithMap("Do X", "file.ts:\n│fn x");
                expect(out.startsWith("Do X")).toBe(true);
                expect(out).toContain("Repo map");
                expect(out).toContain("read-only");
        });
        test("parseRepomapArgs: clear, --tokens, --refresh, invalid tokens ignored", () => {
                expect(parseRepomapArgs("clear").action).toBe("clear");
                expect(parseRepomapArgs("--tokens 2048")).toEqual({ action: "show", tokens: 2048, refresh: false });
                expect(parseRepomapArgs("-r").refresh).toBe(true);
                expect(parseRepomapArgs("--tokens 3").tokens).toBeUndefined(); // below floor
        });
});

// ---------------------------------------------------------------------------
// End-to-end: the REAL vendored grammars (aider's per-language test set)
// ---------------------------------------------------------------------------

describe("buildRepoMap (real grammars, tmp repos)", () => {
        beforeAll(async () => {
                const rt = await getRepomapRuntime();
                if (!rt) throw new Error(`grammar runtime unavailable: ${process.env.UNOWN_REPOMAP ?? ""}`);
        });

        test("multi-language map: JS/TS/TSX/Python defs + cross-file references rank (aider test_get_repo_map_with_identifiers)", async () => {
                const { root, cleanup } = tmpRepo({
                        "person.py": "class Person:\n    def greet(self):\n        return \"hi\"\n",
                        "main.py": "from person import Person\n\ndef use():\n    return Person().greet()\n",
                        "greet.ts": "export function greetUser(name: string): string {\n  return `hi ${name}`;\n}\nexport interface UserProps {\n  name: string;\n}\n",
                        "app.tsx": "import { greetUser } from \"./greet\";\nexport function Hello(props: { name: string }) {\n  return greetUser(props.name);\n}\n",
                        "notes.md": "# notes\n",
                });
                try {
                        const result = await buildRepoMap({ root, files: ["person.py", "main.py", "greet.ts", "app.tsx", "notes.md"], budgetTokens: 2048 });
                        expect(result).not.toBeNull();
                        const text = result!.text;
                        // Python class def renders (def site line from source).
                        expect(text).toContain("person.py:");
                        expect(text).toContain("class Person:");
                        // Cross-file reference: main.py → person.py (edge exists → both ranked).
                        expect(text).toContain("main.py:");
                        // TS interface + function.
                        expect(text).toContain("greet.ts:");
                        expect(text).toContain("function greetUser");
                        expect(text).toContain("interface UserProps");
                        // TSX component.
                        expect(text).toContain("app.tsx:");
                        // No-tag file: bare filename (aider's floor).
                        expect(text).toContain("notes.md");
                } finally {
                        cleanup();
                }
        });

        test("the cache round-trip: an edit lands on the next build; unchanged files skip re-extraction", async () => {
                const { root, cleanup } = tmpRepo({
                        "a.ts": "export function alpha() {\n  return 1;\n}\n",
                        "b.ts": "export function beta() {\n  return 2;\n}\n",
                });
                const extracted: string[] = [];
                const readFileCalls: string[] = [];
                const readFile = (abs: string) => {
                        readFileCalls.push(abs);
                        try {
                                return readFileSync(abs, "utf8");
                        } catch {
                                return null;
                        }
                };
                // Spy on the default extraction path: the REAL grammar
                // runtime, with extraction events recorded.
                const runtime = await getRepomapRuntime();
                const extract = (rel: string, ext: string, code: string) => {
                        extracted.push(rel);
                        return runtime!.extract(rel, ext, code);
                };
                try {
                        const cachePath = join(root, ".unown", "repomap-cache.json");
                        const base = { root, files: ["a.ts", "b.ts"], budgetTokens: 1024, cachePath, readFile, extract };
                        const first = await buildRepoMap(base);
                        expect(first!.text).toContain("function alpha");
                        expect(first!.fromMapCache).toBe(false);
                        expect(extracted.sort()).toEqual(["a.ts", "b.ts"]); // first build: both parsed
                        // Second build, same inputs: cheap build → rebuilt
                        // fresh (never served stale), but ZERO re-extractions
                        // (the stat fast path held) — only render-line reads.
                        extracted.length = 0;
                        const second = await buildRepoMap(base);
                        expect(second!.text).toBe(first!.text);
                        expect(second!.fromMapCache).toBe(false);
                        expect(extracted).toEqual([]);
                        const persisted = loadTagsCache(cachePath);
                        expect(persisted.entries["a.ts"].tags.some((t) => t.name === "alpha")).toBe(true);
                        // Edit: a new def appears; the stat mismatch forces a
                        // read + re-extract of a.ts (b stays on the fast path).
                        writeFileSync(join(root, "a.ts"), "export function alpha() {\n  return 1;\n}\nexport function alphaTwo() {\n  return 3;\n}\n");
                        extracted.length = 0;
                        const third = await buildRepoMap(base);
                        expect(third!.text).toContain("alphaTwo");
                        expect(extracted).toEqual(["a.ts"]); // only the edited file re-parsed
                        // Hash rescue: touch b.ts (new mtime, IDENTICAL
                        // content) — the entry survives via sha256, no
                        // re-extraction.
                        const { utimesSync } = await import("node:fs");
                        const before = loadTagsCache(cachePath).entries["b.ts"];
                        extracted.length = 0;
                        utimesSync(join(root, "b.ts"), new Date(), new Date(Date.now() + 5000));
                        await buildRepoMap(base);
                        const after = loadTagsCache(cachePath).entries["b.ts"];
                        expect(after.sha256).toBe(before.sha256); // same entry, healed stat
                        expect(after.mtimeMs).not.toBe(before.mtimeMs);
                        expect(extracted).toEqual([]);
                } finally {
                        cleanup();
                }
        });

        test("budget cap: the rendered map fits (aider's 15% tolerance)", async () => {
                const files: Record<string, string> = {};
                for (let i = 0; i < 20; i++) {
                        files[`m${i}.ts`] = Array.from({ length: 10 }, (_, j) => `export function fn${i}_${j}(a: number) {\n  return a + ${j};\n}`).join("\n") + "\n";
                }
                const { root, cleanup } = tmpRepo(files);
                try {
                        const result = await buildRepoMap({ root, files: Object.keys(files), budgetTokens: 256 });
                        expect(result).not.toBeNull();
                        expect(result!.tokens).toBeLessThanOrEqual(256 * 1.15);
                } finally {
                        cleanup();
                }
        });

        test("chat files: own defs skipped, their refs still boost definers (aider's shape)", async () => {
                const { root, cleanup } = tmpRepo({
                        "lib.ts": "export function libraryFunction(x: number): number {\n  return x * 2;\n}\n",
                        "chat.ts": "import { libraryFunction } from \"./lib\";\nexport function inChat() {\n  return libraryFunction(2);\n}\n",
                });
                try {
                        const result = await buildRepoMap({ root, files: ["lib.ts", "chat.ts"], chatFiles: ["chat.ts"], budgetTokens: 1024 });
                        const text = result!.text;
                        expect(text).toContain("lib.ts:"); // the definer the chat file depends on
                        expect(text).not.toContain("chat.ts:"); // chat file's own defs stay out
                } finally {
                        cleanup();
                }
        });

        test("mentioned idents steer the map under a tight budget (personalization)", async () => {
                const files: Record<string, string> = {
                        "target.ts": "export function specialHandler(a: number) {\n  return a;\n}\n",
                        "other.ts": "export function unrelatedOne(a: number) {\n  return a;\n}\nexport function unrelatedTwo(a: number) {\n  return a;\n}\n",
                        "bridge.ts": "import { specialHandler } from \"./target\";\nimport { unrelatedOne } from \"./other\";\nexport function entry() {\n  return specialHandler(1) + unrelatedOne(2);\n}\n",
                };
                const { root, cleanup } = tmpRepo(files);
                try {
                        const mentioned = await buildRepoMap({
                                root,
                                files: Object.keys(files),
                                budgetTokens: 90,
                                mentionedIdents: ["specialHandler"],
                        });
                        expect(mentioned!.text).toContain("specialHandler");
                } finally {
                        cleanup();
                }
        });

        test("fallback tier: unknown-extension source files get regex defs (go), extensionless get bare names", async () => {
                const { root, cleanup } = tmpRepo({
                        "main.go": "package main\n\nfunc main() {\n\tprintln(1)\n}\n",
                        "Makefile": "all:\n\techo hi\n",
                });
                try {
                        const result = await buildRepoMap({ root, files: ["main.go", "Makefile"], budgetTokens: 512 });
                        const text = result!.text;
                        expect(text).toContain("main.go:");
                        expect(text).toContain("func main()");
                        expect(text).toContain("Makefile");
                } finally {
                        cleanup();
                }
        });

        test("disabled via UNOWN_REPOMAP=0 → null, no fs work", async () => {
                const prev = process.env.UNOWN_REPOMAP;
                process.env.UNOWN_REPOMAP = "0";
                try {
                        expect(await buildRepoMap({ root: "/tmp", files: ["a.ts"] })).toBeNull();
                } finally {
                        if (prev === undefined) delete process.env.UNOWN_REPOMAP;
                        else process.env.UNOWN_REPOMAP = prev;
                }
        });

        test("in-memory map cache: a SLOW build is served stale within TTL; cheap builds always rebuild (aider refresh=auto)", async () => {
                const { root, cleanup } = tmpRepo({ "a.ts": "export function cached() {\n  return 1;\n}\n" });
                try {
                        const first = await buildRepoMap({ root, files: ["a.ts"], budgetTokens: 512, mapCacheForcedMs: 5000 });
                        expect(first!.fromMapCache).toBe(false);
                        const second = await buildRepoMap({ root, files: ["a.ts"], budgetTokens: 512 });
                        expect(second!.fromMapCache).toBe(true);
                        expect(second!.text).toBe(first!.text);
                        // Different mentions → different key → rebuild.
                        const third = await buildRepoMap({ root, files: ["a.ts"], budgetTokens: 512, mentionedIdents: ["cached"] });
                        expect(third!.fromMapCache).toBe(false);
                } finally {
                        cleanup();
                }
        });
});
