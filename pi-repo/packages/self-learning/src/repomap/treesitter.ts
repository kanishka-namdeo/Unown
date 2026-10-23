/**
 * treesitter.ts — the web-tree-sitter runtime for the repo map.
 *
 * Lazy singletons: Parser.init once, then per-grammar (Language, Query,
 * Parser) triples loaded on demand from the VENDORED wasm files
 * (native/grammars/ — see its README for provenance + ABI pinning). This
 * is the ONLY module in src/repomap/ that touches web-tree-sitter or the
 * filesystem grammar store; everything downstream consumes Tags.
 *
 * Verified under Bun 1.4.3 with web-tree-sitter 0.27.1 (see the research
 * notes + tests):
 *   - `Parser.init({ locateFile })` must be pointed at the package's own
 *     `web-tree-sitter.wasm` (the default import.meta.url-relative lookup
 *     is fragile under monorepo installs);
 *   - `Language.load` takes a **Uint8Array**, never an ArrayBuffer (an
 *     ArrayBuffer silently takes the fs-path branch and hangs);
 *   - grammar wasm must match the runtime's tree-sitter ABI (vendored set
 *     is pinned to 0.27.x-era release assets — native/grammars/README.md).
 *
 * Degradation contract (lsp.ts's): a missing/corrupt grammar, a failed
 * init, or UNOWN_REPOMAP=0 yields `null` from getRuntime() with a reason —
 * callers proceed WITHOUT the map, never abort. A negative result is
 * cached per process (no per-build retry storms).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// LAZY by design: a static `import { Parser } from "web-tree-sitter"` loads
// the emscripten/wasm runtime at CLI boot and keeps the process from exiting
// cleanly after the answer (the M6 live E2E: print mode hung 120 s+ post-
// answer with the module merely imported, zero map builds) — the dynamic
// import below pays the load ONLY when a repo map is actually built. The
// type-only import is erased at runtime and carries no such handle.
import type { Parser, Language, Query } from "web-tree-sitter";
import { TREE_SITTER_QUERIES, VENDORED_GRAMMARS, tagsFromCaptures, type RawCapture, type Tag } from "./tags.ts";

/** The runtime values (loaded once, on first map build). */
interface WtsModule {
        Parser: typeof Parser;
        Language: typeof Language;
        Query: typeof Query;
}
let wts: WtsModule | null = null;

const HERE = dirname(fileURLToPath(import.meta.url));

/** Resolve a grammar wasm path: `src/repomap/../../native/grammars/<name>`. */
export function grammarWasmPath(grammar: string): string {
        return join(HERE, "..", "..", "native", "grammars", `tree-sitter-${grammar}.wasm`);
}

/** The kill switch + env gates (pure; UNOWN_REPOMAP=0/false/off/no). */
export function repomapEnabled(env: Record<string, string | undefined> = process.env): boolean {
        return !/^(0|false|off|no)$/i.test(env.UNOWN_REPOMAP ?? "");
}

export interface RepomapRuntime {
        /** Extract tags for one file's code with its grammar. Returns null when
         * the extension has no vendored grammar (caller falls back to regex). */
        extract(relFname: string, ext: string, code: string): Tag[] | null;
}

interface GrammarRuntime {
        lang: Language;
        query: Query;
        parser: Parser;
}

let runtimePromise: Promise<RepomapRuntime | null> | null = null;
let runtimeError: string | null = null;

/** The wasm filename → URL/path resolver for Parser.init (the npm copy). */
function locateRuntimeWasm(): (file: string) => string {
        return (file: string) => {
                try {
                        // Bun's import.meta.resolve returns the file URL string.
                        return import.meta.resolve(`web-tree-sitter/${file}`);
                } catch {
                        return file;
                }
        };
}

/** Load (or reuse) the shared runtime. Cached null on failure — one
 * attempt per process; UNOWN_REPOMAP=0 short-circuits before any wasm
 * work. The promise is shared so concurrent first-builds don't init twice. */
export function getRepomapRuntime(env: Record<string, string | undefined> = process.env): Promise<RepomapRuntime | null> {
        if (!repomapEnabled(env)) return Promise.resolve(null);
        if (runtimePromise) return runtimePromise;
        runtimePromise = (async () => {
                try {
                        // Grammar store present? (Compiled-binary installs without the
                        // vendored files degrade — never crash.)
                        for (const g of VENDORED_GRAMMARS) {
                                if (!existsSync(grammarWasmPath(g))) {
                                        runtimeError = `grammar wasm missing: ${grammarWasmPath(g)}`;
                                        return null;
                                }
                        }
                        // The lazy module load (see the import note above — boot-time
                        // static imports of the wasm runtime hang print mode's exit).
                        wts = (await import("web-tree-sitter")) as unknown as WtsModule;
                        await wts.Parser.init({ locateFile: locateRuntimeWasm() });
                        // Preload every vendored grammar + compile its query ONCE per
                        // process (~100-400ms total; verified timings in the research)
                        // — after init, extract() is pure sync parse+captures.
                        const grammars = new Map<string, GrammarRuntime>();
                        for (const g of VENDORED_GRAMMARS) {
                                const bytes = readFileSync(grammarWasmPath(g));
                                const lang = await wts.Language.load(new Uint8Array(bytes));
                                const query = new wts.Query(lang, TREE_SITTER_QUERIES[g]);
                                const parser = new wts.Parser();
                                parser.setLanguage(lang);
                                grammars.set(g, { lang, query, parser });
                        }
                        return {
                                extract(relFname: string, ext: string, code: string): Tag[] | null {
                                        const grammar = EXT_TO_GRAMMAR[ext];
                                        if (!grammar) return null;
                                        const rt = grammars.get(grammar);
                                        if (!rt) return null;
                                        const tree = rt.parser.parse(code);
                                        if (!tree) return [];
                                        const caps = rt.query.captures(tree.rootNode) as unknown as RawCapture[];
                                        return tagsFromCaptures(relFname, caps);
                                },
                        };
                } catch (err: any) {
                        runtimeError = `tree-sitter init failed: ${err instanceof Error ? err.message : String(err)}`;
                        return null;
                }
        })();
        return runtimePromise;
}

/** The last init failure reason (diagnostics for /repomap + doctor). */
export function repomapRuntimeError(): string | null {
        return runtimeError;
}

/** Test seam: reset the singleton (so a test can inject a fake runtime or
 * re-run init after touching env). */
export function __resetRepomapRuntimeForTests(): void {
        runtimePromise = null;
        runtimeError = null;
}

/** Test seam: inject a runtime (hermetic tests never touch wasm). */
export function __setRepomapRuntimeForTests(rt: RepomapRuntime | null): void {
        runtimePromise = Promise.resolve(rt);
}

/** Extension → grammar (mirrors tags.ts's map; kept private there, surfaced
 * here for the runtime's dispatch). */
const EXT_TO_GRAMMAR: Record<string, string> = {
        ts: "typescript",
        mts: "typescript",
        cts: "typescript",
        tsx: "tsx",
        js: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        jsx: "javascript",
        py: "python",
        pyi: "python",
};
