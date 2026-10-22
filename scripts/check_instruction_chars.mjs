// Instruction-set invisible-Unicode lint — the machine gate for the threat
// that research/instruction_set_hardening.md §6.5 validated: instruction
// files (AGENTS.md / SKILL.md / CLAUDE.md / .unown/** / hook configs /
// subagent definitions) are loaded into model context verbatim every
// session, so an invisible code point inside one is a prompt-injection
// payload that no human reviewer can see but the model reads as text.
//
// The rule set is the smuggler's toolbox — every class has a live attack
// behind it (Embrace the Red 2025 "Scary Agent Skills" / "Sneaky Bits",
// trojansource.codes, arXiv:2111.00197 Trojan Source):
//
//   bidi-control            U+202A-U+202E   LRE/RLE/PDF/LRO/RLO — "Trojan
//                                          Source": reorders the line so the
//                                          reviewer reads different text than
//                                          the model consumes.
//   bidi-isolate            U+2066-U+2069   LRI/RLI/FSI/PDI — the isolating
//                                          variant of the same reordering.
//   zero-width              U+200B-U+200D, U+2060, U+FEFF — invisible
//                                          carriers between visible words
//                                          (ZWSP/ZWNJ/ZWJ/word-joiner/BOM;
//                                          a leading BOM is also flagged:
//                                          instruction files must be plain).
//                                          NOTE: ZWJ U+200D is in the mandated
//                                          class even though emoji sequences
//                                          use it — an instruction file that
//                                          wants a ZWJ family emoji needs an
//                                          allowlist entry; strictness is the
//                                          point for files the model obeys.
//   soft-hyphen             U+00AD           invisible to review, tokenizes.
//   invisible-operator      U+2061-U+2064   FUNCTION APPLICATION / INVISIBLE
//                                          TIMES / SEPARATOR / PLUS — the
//                                          "Sneaky Bits" smuggling alphabet
//                                          appended after an emoji.
//   unicode-tag             U+E0000-U+E007F Unicode Tags — THE emoji
//                                          backdoor: invisible to humans,
//                                          decoded as instructions by models;
//                                          the backdoored-skills attack class.
//   variation-selector-run  U+FE00-U+FE0F + U+E0100-U+E01EF, runs of 3+ —
//                                          240+ invisible selector code
//                                          points usable as a byte-encoding
//                                          alphabet behind a single emoji.
//                                          One VS after a character is legit
//                                          (emoji presentation); two can
//                                          occur in composed sequences; three
//                                          in a row has no honest use. Mixed
//                                          runs count: the two ranges are one
//                                          rule so FE FE MVS can't slip by.
//
// Usage: node scripts/check_instruction_chars.mjs [--fix-hints] [paths...]
//   no paths    -> discover every instruction file in the repo. The walk
//                  covers the WORKING TREE, not git's index: the agent loads
//                  .unown/ and AGENTS.md from disk whether git tracks them
//                  or not. Excluded: .git, node_modules, .next, dist (any
//                  depth) and the gitignored .unown runtime dirs
//                  (receipts/checkpoints/fleet/reviews — per-machine state,
//                  not the instruction set).
//   paths...    -> each file is scanned exactly as given (the caller decides
//                  scope — this is how the pre-commit hook passes staged
//                  names); each directory is walked with the discovery
//                  patterns above.
//   --fix-hints -> print remediation commands after the findings. This tool
//                  NEVER modifies files, and NEVER echoes a raw invisible
//                  char back to the terminal — echoing the payload is the
//                  attack. Every excerpt is hex-escaped.
//
// Allowlist: scripts/instruction-chars-allowlist.txt — lines of `path:rule`
// (or `path:*` to exempt one file entirely); `#` starts a comment. Paths are
// repo-relative, forward slashes. The env var INSTRUCTION_CHARS_ALLOWLIST
// points at a different allowlist file (the test suite uses this). An
// unknown rule name is a CONFIG ERROR (exit 2), never a silent no-op: a
// typo'd exemption must be loud, or the gate rots quietly. Discovery mode
// warns about allowlist entries that matched no scanned file — stale
// exemptions are pre-cut holes for whoever recreates the path next.
//
// Exit codes: 0 clean · 1 findings · 2 usage/config error.
// Pure Node (ES2020), zero deps, no shell-outs; runs under node and bun
// alike, same behavior on Linux/macOS/Windows. Findings report 1-based
// line and column, columns counted in Unicode code points.
//
// Note: the first line is a `//` comment, not `#` — some node builds (this
// workspace's included) refuse to parse a module whose first byte is `#`.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_ALLOWLIST = join(SCRIPT_DIR, "instruction-chars-allowlist.txt");

// ── rules ─────────────────────────────────────────────────────────────────
// Every regex carries the `u` flag: the astral-plane classes (U+E0000-U+E007F,
// U+E0100-U+E01EF) silently match lone surrogates of ordinary text without
// it — the false-positive trap the research validation hit on its first run.
// BMP ranges keep `\uXXXX` escapes, which are valid in both modes.
const RULES = [
        {
                name: "bidi-control",
                re: /[\u202A-\u202E]/gu,
                ranges: "U+202A-U+202E",
                why: "bidi override (Trojan Source: LRE/RLE/PDF/LRO/RLO) reorders what the reviewer reads",
        },
        {
                name: "bidi-isolate",
                re: /[\u2066-\u2069]/gu,
                ranges: "U+2066-U+2069",
                why: "bidi isolate (LRI/RLI/FSI/PDI) — isolating variant of the Trojan Source trick",
        },
        {
                name: "zero-width",
                re: /[\u200B-\u200D\u2060\uFEFF]/gu,
                ranges: "U+200B-U+200D, U+2060, U+FEFF",
                why: "zero-width char (ZWSP/ZWNJ/ZWJ/word-joiner/BOM) hides carriers between visible words; ZWJ flags even in emoji sequences — allowlist if truly needed",
        },
        {
                name: "soft-hyphen",
                re: /[\u00AD]/gu,
                ranges: "U+00AD",
                why: "soft hyphen — invisible to review, survives tokenization",
        },
        {
                name: "invisible-operator",
                re: /[\u2061-\u2064]/gu,
                ranges: "U+2061-U+2064",
                why: "invisible operator (Sneaky Bits: function-application/invisible-times/separator/plus) smuggles ASCII payloads",
        },
        {
                name: "unicode-tag",
                re: /[\u{E0000}-\u{E007F}]/gu,
                ranges: "U+E0000-U+E007F",
                why: "Unicode Tag code point — the emoji backdoor; invisible to humans, read as instructions by models",
        },
        {
                name: "variation-selector-run",
                re: /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]{3,}/gu,
                ranges: "U+FE00-U+FE0F, U+E0100-U+E01EF (run of 3+)",
                why: "variation-selector run encodes a payload behind one emoji (mixed-range runs count)",
        },
];
const RULE_NAMES = new Set(RULES.map((r) => r.name));

// ── discovery ─────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist"]);
// Gitignored per-machine runtime state under .unown/ (see .gitignore): not
// part of the instruction set, huge, and regenerated every session.
const UNOWN_RUNTIME_DIRS = new Set(["receipts", "checkpoints", "fleet", "reviews"]);

function toPosix(p) {
        return p.split(sep).join("/");
}

/** True when a repo-relative (forward-slash) path is an instruction file:
 * something the agent loads as behavior. AGENTS.md / SKILL.md / CLAUDE.md /
 * hooks.json at ANY depth (root, docs/, src/, pi-repo/**, vendored fixtures
 * — a smuggled char in a fixture reaches the model the same way), everything
 * under .unown/ AT ANY DEPTH except runtime state (the vendored
 * pi-repo/packages/self-learning/.unown/ tree — committed seed memory + the
 * dogfooding instruction surface — is an instruction file exactly like the
 * root one; the 2026-10-22 nested-discovery fix closed the gap where a
 * nested .unown shipped uninspected), Claude-style hook wiring
 * (.claude/settings.json) and subagent definitions (.claude/agents/*.md). */
function isInstructionPath(relPosix) {
        const base = relPosix.slice(relPosix.lastIndexOf("/") + 1);
        if (base === "AGENTS.md" || base === "SKILL.md" || base === "CLAUDE.md" || base === "hooks.json") {
                return true;
        }
        // .unown/ at ANY depth (root or nested — "pi-repo/.../.unown/memory/project.md"
        // is tier-1 memory when the package dir is the working project).
        const unownAt = relPosix.match(/(^|\/)\.unown\//);
        if (unownAt) {
                const after = relPosix.slice((unownAt.index ?? 0) + unownAt[0].length);
                const tier = after.split("/")[0];
                if (UNOWN_RUNTIME_DIRS.has(tier)) return false;
                return base.endsWith(".md") || base.endsWith(".json");
        }
        if (relPosix === ".claude/settings.json" || relPosix.endsWith("/.claude/settings.json")) {
                return true;
        }
        if (/(^|\/)\.claude\/agents\/[^/]+\.md$/.test(relPosix)) {
                return true;
        }
        return false;
}

/** Walk a directory, skipping the excluded trees. Symlinked directories are
 * never followed (readdir Dirents are lstat-based), so the walk cannot
 * cycle; a symlinked instruction FILE is still read and scanned. */
function* walk(dir) {
        let entries;
        try {
                entries = readdirSync(dir, { withFileTypes: true });
        } catch {
                return;
        }
        for (const e of entries) {
                const p = join(dir, e.name);
                if (e.isDirectory()) {
                        if (SKIP_DIRS.has(e.name)) continue;
                        yield* walk(p);
                } else if (e.isFile()) {
                        yield p;
                }
        }
}

/** Identity of a file for reports and allowlist matching: repo-relative
 * posix path when the file lives under the repo root, else its absolute
 * posix path (test fixtures, arbitrary outside files). */
function pathKey(abs) {
        const rel = relative(ROOT, abs);
        if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return toPosix(rel);
        return toPosix(abs);
}

// ── rendering ─────────────────────────────────────────────────────────────
/** Escape every code point outside printable ASCII as \uXXXX / \u{XXXXX},
 * and backslash/quote as themselves-escaped so a literal "\u202E" string in
 * reviewed text cannot be confused for an escape we generated. */
function hexEscape(text) {
        let out = "";
        for (const ch of text) {
                const cp = ch.codePointAt(0);
                if (cp >= 0x20 && cp <= 0x7e) {
                        out += ch === "\\" || ch === '"' ? "\\" + ch : ch;
                } else if (cp === 0x09) {
                        out += "\\t";
                } else {
                        out +=
                                cp > 0xffff
                                        ? `\\u{${cp.toString(16).toUpperCase()}}`
                                        : `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}`;
                }
        }
        return out;
}

/** A bounded, fully hex-escaped excerpt around a match. `idx`/`len` are in
 * code points; the window is ±24 code points, cut-marked with "...". */
function excerpt(line, idx, len) {
        const cps = [...line];
        const start = Math.max(0, idx - 24);
        const end = Math.min(cps.length, idx + len + 24);
        return (
                (start > 0 ? "..." : "") + hexEscape(cps.slice(start, end).join("")) + (end < cps.length ? "..." : "")
        );
}

/** GitHub-Actions annotation property escaping (%, CR, LF, :, ,). Outside CI
 * this is inert noise — the same trade check_docs.mjs makes. */
function ghaEsc(s) {
        return s
                .replace(/%/g, "%25")
                .replace(/\r/g, "%0D")
                .replace(/\n/g, "%0A")
                .replace(/:/g, "%3A")
                .replace(/,/g, "%2C");
}

// ── scanning ──────────────────────────────────────────────────────────────
/** Scan one file's text. Returns findings: {key, line, col, rule, cps, excerpt}. */
function scanText(key, text) {
        const findings = [];
        const lines = text.split(/\r?\n/); // CRLF-safe: a bare \r is in no rule
        for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                for (const rule of RULES) {
                        rule.re.lastIndex = 0; // matchAll clones, but reset anyway — runtimes differ
                        for (const m of line.matchAll(rule.re)) {
                                const cps = [...m[0]];
                                const col = [...line.slice(0, m.index)].length + 1; // code points, 1-based
                                findings.push({
                                        key,
                                        line: i + 1,
                                        col,
                                        rule: rule.name,
                                        cps: cps.map((c) => {
                                                const h = c.codePointAt(0).toString(16).toUpperCase();
                                                return "U+" + h.padStart(4, "0"); // U+00AD, not U+AD; U+E0041 stays 5 digits
                                        }),
                                        excerpt: excerpt(line, col - 1, cps.length),
                                });
                        }
                }
        }
        return findings;
}

function scanFile(abs) {
        const key = pathKey(abs);
        let text;
        try {
                text = readFileSync(abs, "utf8");
        } catch (err) {
                // Fail closed: an unreadable instruction file is a finding, not a skip.
                return [
                        {
                                key,
                                line: 0,
                                col: 0,
                                rule: "unreadable",
                                cps: [],
                                excerpt: `could not read file (${err.code || err.message})`,
                        },
                ];
        }
        return scanText(key, text);
}

// ── allowlist ─────────────────────────────────────────────────────────────
/** Parse `path:rule` / `path:*` lines. Returns { entries: Map<key, Set<rule>>,
 * errors: [{ line, text, message }] }. Split at the LAST colon so Windows
 * drive-letter paths (C:/...) keep their own colon. */
function parseAllowlist(source) {
        const entries = new Map();
        const errors = [];
        source
                .split(/\r?\n/)
                .forEach((raw, i) => {
                        const line = raw.trim();
                        if (!line || line.startsWith("#")) return;
                        const idx = line.lastIndexOf(":");
                        if (idx < 1) {
                                errors.push({ line: i + 1, text: line, message: "expected `path:rule` or `path:*`" });
                                return;
                        }
                        const path = line.slice(0, idx).trim();
                        const rule = line.slice(idx + 1).trim();
                        if (rule !== "*" && !RULE_NAMES.has(rule)) {
                                errors.push({
                                        line: i + 1,
                                        text: line,
                                        message: `unknown rule "${rule}" — known rules: ${[...RULE_NAMES].join(", ")} (or *)`,
                                });
                                return;
                        }
                        if (!entries.has(path)) entries.set(path, new Set());
                        entries.get(path).add(rule);
                });
        return { entries, errors };
}

function loadAllowlist(file) {
        if (!existsSync(file)) return { entries: new Map(), errors: [], file, present: false };
        return { ...parseAllowlist(readFileSync(file, "utf8")), file, present: true };
}

// ── remediation hints ─────────────────────────────────────────────────────
/** Prose + copy-paste commands for the rules that actually fired, grouped
 * by remediation (the five single-char BMP rules share one strip pass, so
 * the hint block is per-remediation, not per-rule). The script itself never
 * touches the files — an invisible-char finding is evidence someone hid
 * text: LOOK at it before deleting it. */
function fixHints(findings) {
        const groups = new Map(); // remediation group -> { rules, files }
        const groupOf = (rule) =>
                rule === "unicode-tag" ? "tag" : rule === "variation-selector-run" ? "selector" : rule === "unreadable" ? "unreadable" : "invisible";
        for (const f of findings) {
                const g = groupOf(f.rule);
                if (!groups.has(g)) groups.set(g, { rules: new Set(), files: new Set() });
                groups.get(g).rules.add(f.rule);
                groups.get(g).files.add(f.key);
        }
        const describe = (g) => {
                const rules = [...groups.get(g).rules].sort().join(", ");
                const files = [...groups.get(g).files].sort().join(", ");
                return `${rules} in ${files}`;
        };
        const lines = [
                "",
                "Remediation hints (nothing was modified):",
                "",
                "  1. SEE what was hidden first — print a line as code points (never raw chars):",
                '       node -p \'const t=require("fs").readFileSync(process.argv[1],"utf8").split(/\\r?\\n/)[N-1];[...t].map(c=>"U+"+c.codePointAt(0).toString(16).toUpperCase()).join(" ")\' <file>',
                "     (replace N with the finding's line number)",
                "",
        ];
        if (groups.has("tag")) {
                lines.push(`  ${describe("tag")} — strip every Unicode Tag code point:`);
                lines.push(`      perl -CSD -pi -e 's/[\\x{E0000}-\\x{E007F}]//g' <file>`);
        }
        if (groups.has("selector")) {
                lines.push(`  ${describe("selector")} — collapse runs of 3+ selectors:`);
                lines.push(`      perl -CSD -pi -e 's/[\\x{FE00}-\\x{FE0F}\\x{E0100}-\\x{E01EF}]{3,}//g' <file>`);
        }
        if (groups.has("invisible")) {
                lines.push(
                        `  ${describe("invisible")} — one pass strips zero-width, bidi, invisible-operator and soft-hyphen:`,
                );
                lines.push(
                        `      perl -CSD -pi -e 's/[\\x{00AD}\\x{200B}-\\x{200D}\\x{202A}-\\x{202E}\\x{2060}-\\x{2069}\\x{FEFF}]//g' <file>`,
                );
        }
        if (groups.has("unreadable")) {
                lines.push(`  unreadable (${[...groups.get("unreadable").files].sort().join(", ")}) — fix file access, then re-run`);
        }
        lines.push("");
        lines.push("  2. Re-run: node scripts/check_instruction_chars.mjs");
        lines.push("  3. Review the visible diff BEFORE committing — the finding means text was hidden");
        lines.push("     from you; find out what it said. (perl ships with macOS/Linux and");
        lines.push("     Git-for-Windows — run it from Git Bash on Windows.)");
        return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────
function usage() {
        return [
                "usage: node scripts/check_instruction_chars.mjs [--fix-hints] [paths...]",
                "",
                "  no paths    scan every instruction file in the repo (working tree)",
                "  paths...    scan exactly these files (or walk these directories)",
                "  --fix-hints print remediation commands after findings (never auto-fix)",
                "",
                "  allowlist:  scripts/instruction-chars-allowlist.txt  (`path:rule` or `path:*`)",
                "              override location with INSTRUCTION_CHARS_ALLOWLIST=<file>",
                "",
                "  exit codes: 0 clean  1 findings  2 usage/config error",
        ].join("\n");
}

function main(argv) {
        const help = argv.includes("--help") || argv.includes("-h");
        if (help) {
                console.log(usage());
                return 0;
        }
        const fixHintsWanted = argv.includes("--fix-hints");
        const rest = argv.filter((a) => a !== "--fix-hints");
        const unknown = rest.filter((a) => a.startsWith("-"));
        if (unknown.length) {
                console.error(`unknown argument: ${unknown.join(" ")}\n\n${usage()}`);
                return 2;
        }

        // Collect the file list: explicit paths, or discovery from the repo root.
        const explicit = rest.length > 0;
        const seen = new Map(); // abs -> key (dedupes double-passed paths)
        const addFile = (abs) => {
                if (!seen.has(abs)) seen.set(abs, pathKey(abs));
        };
        for (const arg of rest) {
                const abs = resolve(arg);
                let st;
                try {
                        st = statSync(abs);
                } catch {
                        console.error(`no such path: ${arg}\n\n${usage()}`);
                        return 2;
                }
                if (st.isDirectory()) {
                        for (const f of walk(abs)) {
                                // A directory argument is walked with the discovery patterns.
                                if (isInstructionPath(pathKey(f))) addFile(f);
                        }
                } else {
                        // An explicit FILE is scanned as given — the caller owns the scope
                        // (this is the pre-commit contract: staged names come through here).
                        addFile(abs);
                }
        }
        if (!explicit) {
                for (const f of walk(ROOT)) {
                        if (isInstructionPath(pathKey(f))) addFile(f);
                }
        }

        // Allowlist.
        const allowFile = process.env.INSTRUCTION_CHARS_ALLOWLIST || DEFAULT_ALLOWLIST;
        const allow = loadAllowlist(allowFile);
        if (allow.errors.length) {
                for (const e of allow.errors) {
                        console.error(`::error file=${ghaEsc(toPosix(allow.file))},line=${e.line}::allowlist ${e.message} — line ${e.line}: ${e.text}`);
                }
                console.error(`instruction-chars: allowlist config error in ${toPosix(allow.file)} — refusing to run with a broken allowlist`);
                return 2;
        }

        // Scan, then apply exemptions.
        const findings = [];
        const suppressed = []; // "key:rule" strings, printed for transparency
        const firedEntries = new Set(); // entries that actually suppressed something
        for (const [abs, key] of seen) {
                const exemptRules = allow.entries.get(key);
                if (exemptRules && exemptRules.has("*")) {
                        firedEntries.add(key);
                        suppressed.push(`${key}:* (whole file)`);
                        continue; // whole-file exemption: file still counts as scanned
                }
                for (const f of scanFile(abs)) {
                        if (exemptRules && exemptRules.has(f.rule)) {
                                firedEntries.add(key);
                                suppressed.push(`${key}:${f.rule}`);
                                continue;
                        }
                        findings.push(f);
                }
        }

        findings.sort((a, b) => {
                if (a.key !== b.key) return a.key < b.key ? -1 : 1;
                if (a.line !== b.line) return a.line - b.line;
                if (a.col !== b.col) return a.col - b.col;
                return a.rule < b.rule ? -1 : 1;
        });

        for (const f of findings) {
                const loc = f.line ? `${f.key}:${f.line}:${f.col}` : f.key;
                const cps = f.cps.length ? ` ${f.cps.join(" ")}` : "";
                console.error(
                        `::error file=${ghaEsc(f.key)},line=${f.line},col=${f.col}::${loc}  ${f.rule}${cps}  "${f.excerpt}"`,
                );
        }

        const scanned = seen.size;
        console.log(`instruction-chars: scanned ${scanned} files, ${findings.length} findings`);
        if (suppressed.length) {
                const counts = new Map();
                for (const s of suppressed) counts.set(s, (counts.get(s) || 0) + 1);
                console.log(`allowlisted (suppressed): ${[...counts].map(([k, n]) => `${k} ×${n}`).join(", ")}`);
        }
        if (explicit) {
                console.log(`mode: explicit paths (${scanned} file${scanned === 1 ? "" : "s"} scanned as given)`);
        } else if (allow.entries.size) {
                // Discovery mode is the only place allowlist hygiene is checkable: every
                // instruction file was in scope. An entry whose path matched nothing is a
                // pre-cut hole for whoever recreates that path next; an entry that fired
                // nothing on a scanned file is moot. Both get deleted, not silently kept.
                const scannedKeys = new Set([...seen.values()]);
                const stale = [...allow.entries.keys()].filter((k) => !scannedKeys.has(k));
                const moot = [...allow.entries.keys()].filter((k) => scannedKeys.has(k) && !firedEntries.has(k));
                if (stale.length) {
                        console.log(`warning: allowlist entries matching no scanned file (delete them): ${stale.join(", ")}`);
                }
                if (moot.length) {
                        console.log(`warning: allowlist entries that suppressed nothing this run (consider deleting): ${moot.join(", ")}`);
                }
        }

        if (findings.length && fixHintsWanted) {
                console.error(fixHints(findings));
        }
        return findings.length ? 1 : 0;
}

// Exported for reuse (e.g. a future `unown doctor` unicode leg, SA-B2):
export { RULES, isInstructionPath, scanText, parseAllowlist, hexEscape, usage as usageText };

// CLI guard: import-safe under `node --test` / bun import.
const invokedAsScript =
        process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
        process.exit(main(process.argv.slice(2)));
}
