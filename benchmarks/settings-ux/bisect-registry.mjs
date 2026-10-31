#!/usr/bin/env bun
/**
 * bisect-registry.mjs — the missing-paren catch's diagnosis tool (BM-8d,
 * Phase 10 of the Settings Evolution round).
 *
 * The catch (M3): the copy-on-select item shipped with `},` instead of
 * `}),`; every parser (tsc, biome, bun) pointed at the array's `];` — the
 * error line named the END of the array, not the broken item. The fix by
 * hand was a bisection: comment out halves of the registry array until the
 * failing item is named. This tool automates exactly that procedure.
 *
 * Modes:
 *   bun benchmarks/settings-ux/bisect-registry.mjs [--out path.json]
 *     Default (diagnosis): probe the real module's import in a SUBPROCESS.
 *     If it parses — {"ok": true, "parse": "ok"} (nothing to bisect). If
 *     the probe fails, run the item-span bisection: split the
 *     SETTINGS_REGISTRY array body into item spans (string- and
 *     comment-aware bracket-depth scanning), binary-search by writing
 *     candidate files (the source with the excluded item spans blanked) to
 *     a TEMP name in the registry's own directory — never touching the
 *     real file — and report the minimal failing item.
 *
 *   --selftest
 *     (a) split the CURRENT registry into item spans and assert the span
 *         count equals the real module's SETTINGS_REGISTRY.length (the
 *         splitter cannot silently rot);
 *     (b) the synthetic drill: a temp probe file carrying the exact catch
 *         class (one item's `}),` rewritten to `},`) — the bisection must
 *         name that item. Proves the diagnosis path end to end on every
 *         run, without any product risk (all surgery on temp copies).
 *
 * Exit 0 always — the RUNNER decides pass/fail from the receipt (the same
 * contract as audit-registry.mjs).
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REGISTRY_PATH = join(
        import.meta.dir,
        "../../pi-repo/packages/self-learning/src/settings/registry.ts",
);
const PROBE_NAME = "registry.__bisect_probe__.ts";
const PROBE_PATH = join(dirname(REGISTRY_PATH), PROBE_NAME);

/** Run `bun` importing a path; true iff the import completed (parse ok). */
function importOk(path) {
        const res = spawnSync(process.execPath, ["-e", `await import(${JSON.stringify(path)});`], {
                cwd: dirname(REGISTRY_PATH),
                encoding: "utf8",
                timeout: 30000,
        });
        return res.status === 0;
}

/**
 * Split EVERY section array's body into item spans. The registry is built
 * from eleven per-section arrays (agentItems ... advancedItems) spread
 * into SETTINGS_REGISTRY - the item literals live in the section arrays,
 * so the bisect universe is their union.
 *
 * The scan is PAREN-INSENSITIVE on purpose: the shipped catch class (the
 * missing-paren bug - `}),` written as `},`) leaves braces balanced but
 * parens unbalanced, so a paren-aware depth scan cannot close the broken
 * array - exactly when the tool is needed. Depth counts only `[`/`{`; a
 * missing-BRACE class (rarer, not the shipped catch) cannot close an array
 * either, so each scan is BOUNDED by the next section declaration and the
 * un-split tail becomes one honest span ("the breakage is in here").
 * String- and comment-aware throughout: item literals contain commas inside
 * help/summary strings. Span positions are GLOBAL into the whole source.
 */
function scanArrayBody(source, open, bound) {
        let depth = 0;
        let i = open;
        let inStr = null;
        let inLine = false;
        let inBlock = false;
        const cuts = [open + 1];
        let close = -1;
        for (; i < source.length; i++) {
                if (bound > 0 && i >= bound) break;
                const c = source[i];
                const next = source[i + 1];
                if (inLine) {
                        if (c === "\n") inLine = false;
                        continue;
                }
                if (inBlock) {
                        if (c === "*" && next === "/") { inBlock = false; i++; }
                        continue;
                }
                if (inStr) {
                        if (c === "\\") { i++; continue; }
                        if (c === inStr) inStr = null;
                        continue;
                }
                if (c === "/" && next === "/") { inLine = true; i++; continue; }
                if (c === "/" && next === "*") { inBlock = true; i++; continue; }
                if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
                if (c === "[" || c === "{") { depth++; continue; }
                if (c === "]" || c === "}") {
                        depth--;
                        if (depth === 0) { close = i; break; }
                        continue;
                }
                if (c === "," && depth === 1) cuts.push(i + 1);
        }
        let endAt = close;
        let degraded = false;
        if (endAt < 0) {
                // The braces never balanced before the bound - the honest fallback:
                // the un-split tail (from the last good cut to the bound) is one span.
                endAt = bound > 0 ? bound : source.length;
                degraded = true;
        }
        cuts.push(endAt);
        const spans = [];
        for (let k = 0; k + 1 < cuts.length; k++) {
                const text = source.slice(cuts[k], cuts[k + 1]);
                if (text.trim().length > 0) spans.push({ start: cuts[k], end: cuts[k + 1], text });
        }
        return { spans, degraded };
}

function splitItemSpans(source) {
        const declRe = /const\s+\w+Items\s*:\s*SettingsItem\[\]\s*=\s*\[/g;
        const decls = [...source.matchAll(declRe)];
        const exportIdx = source.indexOf("export const SETTINGS_REGISTRY");
        const spans = [];
        const degradedArrays = [];
        decls.forEach((m, d) => {
                const open = source.indexOf("[", m.index + m[0].length - 1);
                const bound = d + 1 < decls.length ? decls[d + 1].index : exportIdx > 0 ? exportIdx : source.length;
                if (process.env.BISECT_DEBUG) {
                        console.error(`[bisect-debug] match=${JSON.stringify(m[0].slice(0, 40))} idx=${m.index} open=${open} bound=${bound}`);
                }
                const r = scanArrayBody(source, open, bound);
                spans.push(...r.spans);
                if (r.degraded) {
                        degradedArrays.push(m[0].match(/const\s+(\w+Items)/)?.[1] ?? `decl#${d}`);
                }
        });
        if (spans.length === 0) throw new Error("no SettingsItem[] section arrays found");
        return { spans, degradedArrays };
}

/** The item id: from an item span's text (`id: "..."`). */
function itemIdOf(spanText) {
        const m = spanText.match(/id:\s*"([^"]+)"/);
        return m ? m[1] : "(unknown item)";
}

/** Write a candidate file: the full source with the excluded spans blanked. */
function writeCandidate(source, spans, keepIdx) {
        let out = source;
        for (let k = spans.length - 1; k >= 0; k--) {
                if (!keepIdx.has(k)) out = out.slice(0, spans[k].start) + "\n" + out.slice(spans[k].end);
        }
        writeFileSync(PROBE_PATH, out, "utf8");
}

/** The bisection itself: name the minimal failing item. */
function bisect(source, spans) {
        const keep = new Set(spans.map((_, k) => k));
        // Empty first: if even an empty array fails, the breakage is outside the items.
        writeCandidate(source, spans, new Set());
        const emptyOk = importOk(PROBE_PATH);
        let probes = 1;
        if (!emptyOk) {
                rmSync(PROBE_PATH, { force: true });
                return { candidateItem: "(outside the item array — the source fails even with an empty array)", probes };
        }
        while (keep.size > 1) {
                const arr = [...keep];
                const half = Math.ceil(arr.length / 2);
                const tryKeep = new Set(arr.slice(0, half));
                writeCandidate(source, spans, tryKeep);
                const ok = importOk(PROBE_PATH);
                probes++;
                const drop = ok ? arr.slice(0, half) : arr.slice(half);
                for (const k of drop) keep.delete(k);
        }
        rmSync(PROBE_PATH, { force: true });
        const k = [...keep][0];
        return { candidateItem: itemIdOf(spans[k].text), probes };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
try {
        const source = readFileSync(REGISTRY_PATH, "utf8");
        const { spans } = splitItemSpans(source);

        const outIdx = process.argv.indexOf("--out");
        const emit = (receipt) => {
                console.log(JSON.stringify(receipt, null, 1));
                if (outIdx > 0 && outIdx + 1 < process.argv.length) {
                        writeFileSync(process.argv[outIdx + 1], `${JSON.stringify(receipt, null, 1)}\n`, "utf8");
                }
                return receipt;
        };

        if (process.argv.includes("--selftest")) {
                const { SETTINGS_REGISTRY } = await import(REGISTRY_PATH);
                const match = spans.length === SETTINGS_REGISTRY.length;
                // The synthetic drill: the exact M3 catch class (a `}),` -> `},`)
                // introduced into ONE helper-wrapped item of a temp copy; the
                // bisection must name that item. Victim: the first item whose
                // span closes with `}),` (the toggle()/helper-wrapped shape) —
                // rewriting its closing to `},` is precisely the shipped bug.
                const victimIdx = spans.findIndex((s) => /\}\),/.test(s.text));
                if (victimIdx < 0) throw new Error("selftest drill: no `}),`-wrapped item found to break");
                const victim = spans[victimIdx];
                const brokenText = victim.text.replace(/\}\),(?=\s*$)/, "},");
                if (brokenText === victim.text) throw new Error("selftest drill: the rewrite did not bite");
                const drillSource =
                        source.slice(0, victim.start) + brokenText + source.slice(victim.end);
                // sanity: the drill copy must NOT parse (the catch is real)
                writeCandidate(drillSource, spans, new Set(spans.map((_, k) => k)));
                const drillParseOk = importOk(PROBE_PATH);
                rmSync(PROBE_PATH, { force: true });
                let drill = null;
                if (!drillParseOk) {
                        drill = bisect(drillSource, splitItemSpans(drillSource).spans);
                } else {
                        drill = { candidateItem: null, probes: 0, error: "drill copy unexpectedly parsed — the synthetic catch was not introduced" };
                }
                const receipt = {
                        ok: match && !drillParseOk && drill?.candidateItem === itemIdOf(victim.text),
                        selftest: "bisect",
                        spans: spans.length,
                        items: SETTINGS_REGISTRY.length,
                        spanCountMatches: match,
                        drillParseOk,
                        drill,
                };
                emit(receipt);
        } else {
                const parseOk = importOk(REGISTRY_PATH);
                let receipt;
                if (parseOk) {
                        receipt = { ok: true, parse: "ok", note: "the real module imports cleanly — nothing to bisect" };
                } else {
                        const result = bisect(source, spans);
                        receipt = { ok: false, parse: "failed", ...result };
                }
                emit(receipt);
        }
} finally {
        rmSync(PROBE_PATH, { force: true });
}
