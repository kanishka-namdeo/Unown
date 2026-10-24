/**
 * instruction-guard.ts — the INSTRUCTION-SET write policy (SA-B2).
 *
 * Unown is a self-improving agent whose INSTRUCTION SET — AGENTS.md files
 * (root + any depth), .unown/skills/<name>/SKILL.md, .unown/agents/<name>.md,
 * .unown/hooks.json, .unown/permissions.json — is loaded into every session's
 * model context. Research (worklog 2-b P0-3: AutoRedClaw arXiv:2610.27244;
 * Agent Commander, embracethered.com/blog/posts/2026/agent-commander-your-agent-works-for-me-now/;
 * the "Fable to Haiku" downgrade chain) shows writable agent state is THE
 * persistence vector: a hijacked agent that writes its own rule files
 * persists across sessions — one poisoned AGENTS.md or SKILL.md outlives the
 * session that wrote it and steers every future one. The Tensorlake dropper
 * (October 2026) added the IDE-side twins: .claude/settings.json and
 * .vscode/tasks.json are written for persistence on project open.
 *
 * Until now the terminal write gate (termhooks.ts) confined WHERE an
 * in-session write may land (project dir + tmp) but not WHAT: writing
 * AGENTS.md or .unown/hooks.json was a legal in-project write. This module
 * closes that: `instructionWriteDeny` is the single pure matcher both the
 * terminal gate (termhooks.ts) and the engine gate (hooks.ts) call AFTER
 * their jail check — verdict FINAL, before the declarative permissions layer
 * (a permissions rule can only ADD restrictions, never unlock this one, the
 * same contract the jail has). The redirect checker (bashRedirectEscape)
 * applies it to `> target` operands so `echo x > .unown/hooks.json` cannot
 * sidestep the write-tool gate.
 *
 * Purity contract (repo rule for policy modules, bash-policy.ts's idiom):
 * node:fs + node:path + ./write-roots.ts (the session add-dir registry —
 * node-only too, no cycle) only, and only READS (realpathSync for symlink
 * resolution — the realpathAncestor idiom). No store, no bus, no env, no
 * writes; fully unit-testable. Bash-command SHAPE rules stay in
 * bash-policy.ts (the deny-list module); this module owns PATH shapes only.
 *
 * Excluded on purpose:
 *   - .unown/skills-staged/** — the SA-B2 staged-minting directory
 *     (skills.ts) is never auto-loaded (cli.ts's additionalSkillPaths passes
 *     exactly <cwd>/.unown/skills), so it is writable surface whose promotion
 *     INTO .unown/skills is the human review point. The doctor's unicode
 *     audit still scans it (instruction-shaped content about to be promoted).
 *   - .unown/memory/local.md — deliberately NOT denied: it is the documented
 *     repo-suppliable "local overrides" lane (a cloned repo can ship one),
 *     injected with the explicit "user/repo-authored, unverified" framing and
 *     the injection-guard scan on every load — it never receives trust
 *     framing, so there is no laundering gradient. (project.md IS denied —
 *     see the table.)
 *   - out-of-project paths — the jail owns those (a /tmp/AGENTS.md is not
 *     loaded into any session's context).
 *
 * 2026-10-22 v2: .unown/memory/project.md + its provenance sidecar moved OUT
 *  of the exclusion list and INTO the deny table. The owner's Manual-notes
 *  lane (0d1a50e) made the old rationale false — dreams used to re-render
 *  project.md from platform state, clobbering any agent-written text
 *  (self-healing); they now re-append the "## Manual notes" section VERBATIM,
 *  so an in-session write became a persistent prompt-injection channel whose
 *  content the next dream launders into "written by AutoDream" trust framing
 *  (the SA2-B audit). The ENGINE still writes both files directly (dream.ts,
 *  never through the tool gate) and user hand-edits happen outside sessions —
 *  exactly the lane's documented contract — so the deny closes only the
 *  in-session channel.
 *
 * Also hosts `scanInstructionText` — the compact core of the invisible-
 * Unicode instruction lint (scripts/check_instruction_chars.mjs, SA-A),
 * reimplemented inline because this package must not depend on repo-root
 * scripts (it vendors/builds standalone). Same 7 char classes, same
 * line/column semantics; the doctor's unicode-integrity leg
 * (doctor-instructions.ts) consumes it.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve as resolvePath, win32 } from "node:path";
import { sessionWriteRoots } from "./write-roots.ts";

// ---------------------------------------------------------------------------
// The protected path shapes
// ---------------------------------------------------------------------------

/** The documented instruction-write deny table — the shapes `instructionWriteDeny`
 *  refuses in-session writes to, with the reason each is instruction-set
 *  surface. Exported for `describeInstructionGuard()` (doctor display) and for
 *  tests to pin against silent rot (a dropped shape is a reopened vector). */
export const INSTRUCTION_WRITE_DENY: ReadonlyArray<{ shape: string; why: string }> = [
        {
                shape: "AGENTS.md (any depth)",
                why: "the agent rule file — loaded into every session's context (root and every subdirectory)",
        },
        {
                shape: "CLAUDE.md (any depth)",
                why: "the Claude Code twin of AGENTS.md — same instruction class, same discovery",
        },
        { shape: ".unown/skills/**", why: "skill descriptions ride the system prompt; bodies inject on demand (progressive disclosure)" },
        { shape: ".unown/agents/**", why: "agent definition files — loaded as instruction context" },
        { shape: ".unown/hooks.json", why: "user-hook wiring — a poisoned hook becomes a policy layer (trust-gated, but still)" },
        { shape: ".unown/permissions.json", why: "the allow/deny/ask layer itself — self-modification of the gate" },
        { shape: ".unown/memory/policy*", why: "the tier-0 policy files (highest-authority memory tier)" },
        {
                shape: ".unown/adversary.md",
                why: "the adversary reviewer's policy/gate file — writing your own reviewer turns it off (the default gate lives outside the project; this is the in-project spelling, denied as defense-in-depth)",
        },
        { shape: ".claude/settings.json (any depth)", why: "Claude-style hook wiring — the Tensorlake dropper's persistence target (October 2026)" },
        { shape: ".claude/agents/**", why: "Claude-style subagent definitions — instruction context" },
        { shape: ".vscode/tasks.json (any depth)", why: "runs commands on project open — the Tensorlake dropper's persistence target" },
        { shape: ".vscode/settings.json (any depth)", why: "editor settings can rewire tasks/extensions on open" },
        {
                shape: ".unown/memory/project.md",
                why: "tier-1 project memory — injected into every future session's system prompt; the Manual-notes lane made agent-written content DURABLE (dreams preserve it verbatim), so an in-session write is a persistent prompt-injection channel (2026-10-22 v2)",
        },
        {
                shape: ".unown/memory/project.provenance.json",
                why: "the M10 honesty sidecar — a forged sha256 would vouch for content AutoDream never wrote (provenance laundering)",
        },
];

/** Protected shapes as a plain list — doctor display + compact test pinning. */
export function describeInstructionGuard(): string[] {
        return INSTRUCTION_WRITE_DENY.map((e) => e.shape);
}

export interface InstructionWriteDecision {
        deny: boolean;
        /** Set when deny — repo-voice reason, actionable (propose a PR instead). */
        reason?: string;
        /** The protected shape that matched (e.g. "AGENTS.md", ".unown/skills/**"). */
        match?: string;
}

// ---------------------------------------------------------------------------
// Path normalization (the bash-policy.ts jailPath/realpathAncestor idiom,
// kept local so this module stays independent of the deny-list module)
// ---------------------------------------------------------------------------

/** Absolute win32 drive path (C:\… or C:/…) — the trigger for win32-style
 *  resolution so the matcher works on BOTH separator styles from any host
 *  (tests on Linux verify Windows spellings and vice versa). */
const WIN_DRIVE = /^[a-zA-Z]:[\\/]/;

function looksWin32(...parts: string[]): boolean {
        return parts.some((p) => WIN_DRIVE.test(p) || p.includes("\\"));
}

/** Normalize to the forward-slash comparison form: backslashes become
 *  slashes, duplicate slashes collapse, trailing separators drop. Purely
 *  lexical — resolution happens before this. */
function toShape(p: string): string {
        // `(^|[^\/])\/+$/` is the linear-time form of a trailing-slash strip:
        // the old `/\/+$/` rescanned from every start position (quadratic on
        // long '/' runs); the mandatory non-slash prefix pins each run to a
        // single start position. Same matched language.
        return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/(^|[^\/])\/+$/, "$1");
}

/**
 * Resolve the deepest EXISTING ancestor of `p` to its real (symlink-free)
 * location and re-attach the non-existent tail lexically — verbatim the
 * bash-policy.ts idiom (join() for canonical separators, "/" root safe).
 * Falls back to the lexical path when nothing exists, so creating brand-new
 * files still works; only EXISTING symlinks are resolved.
 */
function realpathAncestor(p: string): string {
        let dir = p;
        let tail = "";
        for (;;) {
                try {
                        const real = realpathSync(dir);
                        return tail ? join(real, tail) : real;
                } catch {
                        /* missing path (or broken symlink) — climb one level */
                }
                const parent = dirname(dir);
                if (parent === dir) return p; // reached the root without an existing ancestor
                tail = tail ? join(basename(dir), tail) : basename(dir);
                dir = parent;
        }
}

/** True when `rel` (a lowercase, forward-slash, project-relative path) ends
 *  with exactly the given `segments` at a path boundary — any depth. */
function endsWithSegments(rel: string, segments: string): boolean {
        return rel === segments || rel.endsWith(`/${segments}`);
}

/** True when `rel` contains the given two-segment directory (".claude/agents")
 *  at any depth — a path-boundary check, not a substring. */
function hasDirAtAnyDepth(rel: string, dir: string): boolean {
        const parts = rel.split("/");
        for (let i = 0; i + 1 < parts.length; i++) {
                if (`${parts[i]}/${parts[i + 1]}` === dir) return true;
        }
        return false;
}

/**
 * Deny in-session writes (write/edit tool targets; the terminal's redirect
 * checker feeds `> target` operands here) that resolve to an instruction-set
 * path INSIDE `projectPath`. Handles relative vs absolute targets, `./`
 * prefixes, `..` segments (an escape resolves outside the project and is the
 * JAIL's decision, not this one), trailing separators, both `\` and `/`,
 * win32 drive-letter spellings from any host, and symlinks — the target is
 * resolved through realpathAncestor and the project root is realpathed the
 * same way, so `ln -s .unown l && write l/hooks.json` matches too.
 *
 * Comparison is case-insensitive on EVERY platform: Windows always and macOS
 * by default resolve case-variants of these filenames to the SAME file, so
 * `agents.md` is an AGENTS.md overwrite there; on case-sensitive Linux the
 * residual over-block (a file literally named agents.md) is documentation
 * cost only, and fail-closed is this list's mandated direction. Prefix
 * boundaries are separator-anchored (projx never matches proj).
 */
export function instructionWriteDeny(projectPath: string, p: string): InstructionWriteDecision {
        const allow = (): InstructionWriteDecision => ({ deny: false });
        if (!projectPath || !p) return allow();

        // Resolution: win32.resolve when either side is win32-shaped (drive
        // letter or backslash) so cross-host spellings behave; node:path.resolve
        // otherwise. Both yield absolute paths; toShape() normalizes after.
        const winShaped = looksWin32(projectPath, p);
        const resolved = toShape(winShaped ? win32.resolve(projectPath, p) : resolvePath(projectPath, p));

        // Symlink hardening (jailPath idiom): realpath the project root AND the
        // deepest existing ancestor of the target, then compare prefixes — a
        // symlinked project root keeps working, an in-project symlink chain
        // resolves to what the write would actually hit. SKIPPED for
        // win32-shaped spellings on a non-win32 host: realpathAncestor climbs
        // with POSIX dirname semantics, which rewrites "C:/work/proj/x" into
        // "/work/proj/x" once the (nonexistent-on-this-host) prefix exhausts —
        // silently un-rooting the target from the project and ALLOWING the
        // write (found by test/instruction-guard.test.ts's cross-host matrix).
        // On a real win32 host the paths exist natively and realpath works;
        // on any host, a POSIX-shaped target resolves normally.
        const crossHostWin = winShaped && process.platform !== "win32";
        let root = projectPath;
        if (!crossHostWin) {
                try {
                        root = realpathSync(projectPath);
                } catch {
                        /* project root does not exist — keep the lexical prefix */
                }
        }
        const real = toShape(crossHostWin ? resolved : realpathAncestor(resolved));
        const rootL = toShape(root).toLowerCase();
        const realL = real.toLowerCase();

        // Outside the project → not this guard's project decision (the jail owns
        // it)… except the session's additional write roots (write-roots.ts, the
        // 2026-10-24 trust round): a path inside an added root gets the SAME deny
        // set relative to that root. An added directory's AGENTS.md,
        // .unown/hooks.json or .claude/settings.json is instruction-set material
        // for whoever works in that tree — in-session writes stay PR-reviewed
        // there exactly like the project's own. Native spellings only: the roots
        // are current-host realpaths, so cross-host win32 shapes fall through to
        // allow (the jail — the WHERE — still confines those writes).
        if (realL !== rootL && !realL.startsWith(`${rootL}/`)) {
                for (const extra of sessionWriteRoots()) {
                        const extraL = toShape(extra).toLowerCase();
                        if (extraL && (realL === extraL || realL.startsWith(`${extraL}/`))) {
                                const rel2 = realL === extraL ? "" : realL.slice(extraL.length + 1);
                                const d = denyForRel(rel2);
                                if (d) return d;
                        }
                }
                return allow();
        }
        const rel = realL === rootL ? "" : realL.slice(rootL.length + 1);
        const d = denyForRel(rel);
        return d ?? allow();
}

/** The deny set for one tree-relative path (project or an added root):
 *  AGENTS.md / CLAUDE.md basenames, the .unown state trees, the memory
 *  engine-written files, the Tensorlake dropper targets. Returns the deny
 *  decision or null when the path is not instruction-set material. */
function denyForRel(rel: string): InstructionWriteDecision | null {
        const denyWith = (match: string, guidance = "propose changes via a PR for human review"): InstructionWriteDecision => ({
                deny: true,
                match,
                reason: `instruction-set file is not writable in-session: ${match} (${guidance})`,
        });

        // AGENTS.md / CLAUDE.md — exact basename at any depth (`**/AGENTS.md`).
        // AGENTS-guide.md, agents.mdx, AGENTS.md.bak stay allowed: the loader
        // keys on the exact basename.
        const base = rel.slice(rel.lastIndexOf("/") + 1);
        if (base === "agents.md" || base === "claude.md") return denyWith(base);

        // .unown trees and files. Equality denies too (`.unown/skills` itself,
        // fail-closed: replacing the tree root is as good as editing its leaves).
        if (rel === ".unown/skills" || rel.startsWith(".unown/skills/")) return denyWith(".unown/skills/**");
        if (rel === ".unown/agents" || rel.startsWith(".unown/agents/")) return denyWith(".unown/agents/**");
        if (rel === ".unown/hooks.json") return denyWith(".unown/hooks.json");
        if (rel === ".unown/permissions.json") return denyWith(".unown/permissions.json");
        if (rel === ".unown/adversary.md") return denyWith(".unown/adversary.md");
        // The tier-0 policy files — prefix shape (policy.md, policy-rules.md, …).
        // local.md is deliberately absent (repo-suppliable lane, injected as
        // "user/repo-authored, unverified" — no trust gradient to launder).
        if (rel.startsWith(".unown/memory/policy")) return denyWith(".unown/memory/policy*");

        // The dream target + its honesty sidecar (2026-10-22 v2 — see the module
        // header): tier-1 memory is injected into every future session, the
        // Manual-notes lane made agent writes durable (dreams re-append the
        // section verbatim), and a forged sidecar upgrades the framing to
        // "written by AutoDream". The ENGINE writes both directly (dream.ts,
        // never through this gate); the user hand-edits outside sessions — the
        // deny closes only the in-session echo/redirect channel.
        if (rel === ".unown/memory/project.md")
                return denyWith(
                        ".unown/memory/project.md",
                        "memory is engine-written — add Manual notes by editing the file outside a session; dreams preserve them verbatim",
                );
        if (rel === ".unown/memory/project.provenance.json")
                return denyWith(
                        ".unown/memory/project.provenance.json",
                        "the provenance sidecar is engine-written — a forged one would misstate trust",
                );

        // Tensorlake dropper targets (October 2026: writes .claude/settings.json
        // / .vscode/tasks.json for persistence on project open) + the Claude
        // subagent definitions — matched at any depth like the unicode lint's
        // isInstructionPath.
        if (endsWithSegments(rel, ".claude/settings.json")) return denyWith(".claude/settings.json");
        if (hasDirAtAnyDepth(rel, ".claude/agents")) return denyWith(".claude/agents/**");
        if (endsWithSegments(rel, ".vscode/tasks.json")) return denyWith(".vscode/tasks.json");
        if (endsWithSegments(rel, ".vscode/settings.json")) return denyWith(".vscode/settings.json");

        return null;
}

// ---------------------------------------------------------------------------
// scanInstructionText — the compact invisible-Unicode core (SA-A parity)
// ---------------------------------------------------------------------------

/** One invisible-character finding. Code points are reported as U+XXXX —
 *  the payload itself is NEVER echoed raw (echoing it is the attack). */
export interface InstructionCharFlag {
        /** 1-based line. */
        line: number;
        /** 1-based column, counted in Unicode code points. */
        col: number;
        /** Rule name (same 7 as scripts/check_instruction_chars.mjs). */
        rule: string;
        /** The matched code points, U+XXXX form. */
        codepoints: string[];
}

/** The 7 char classes of the smuggler's toolbox (Embrace the Red "Scary
 *  Agent Skills" / "Sneaky Bits", trojansource.codes, arXiv:2111.00197) —
 *  identical ranges to scripts/check_instruction_chars.mjs so the doctor leg
 *  and the CI lint flag the same things. Every regex carries the `u` flag:
 *  without it the astral classes (U+E0000.., U+E0100..) silently match lone
 *  surrogates of ordinary text — the false-positive trap SA-A's validation
 *  hit. BMP ranges keep `\uXXXX` escapes (valid in both modes). The one
 *  mandated quirk: ZWJ (U+200D) flags even inside emoji sequences — files
 *  the model obeys get the strict class; the CI lint's allowlist is the
 *  escape hatch there. */
const CHAR_RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
        { name: "bidi-control", re: /[\u202A-\u202E]/gu },
        { name: "bidi-isolate", re: /[\u2066-\u2069]/gu },
        { name: "zero-width", re: /[\u200B-\u200D\u2060\uFEFF]/gu },
        { name: "soft-hyphen", re: /[\u00AD]/gu },
        { name: "invisible-operator", re: /[\u2061-\u2064]/gu },
        { name: "unicode-tag", re: /[\u{E0000}-\u{E007F}]/gu },
        { name: "variation-selector-run", re: /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]{3,}/gu },
];

/**
 * Scan instruction text for the invisible-Unicode backdoor classes. Pure
 * string work (no fs); CRLF-safe (a bare \r is in no rule); columns are code
 * points, not UTF-16 units. One VS after a char is legit (emoji
 * presentation), two can occur in composed sequences, three in a row has no
 * honest use — the run rule fires at 3+, mixed FE/MVS ranges counting as
 * ONE rule so a payload can't slip between two thresholds.
 */
export function scanInstructionText(text: string): InstructionCharFlag[] {
        const flags: InstructionCharFlag[] = [];
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                for (const rule of CHAR_RULES) {
                        rule.re.lastIndex = 0; // matchAll clones, but reset anyway — runtimes differ
                        for (const m of line.matchAll(rule.re)) {
                                const cps = [...m[0]];
                                const col = [...line.slice(0, m.index ?? 0)].length + 1;
                                flags.push({
                                        line: i + 1,
                                        col,
                                        rule: rule.name,
                                        codepoints: cps.map((c) => {
                                                const h = c.codePointAt(0)!.toString(16).toUpperCase();
                                                return `U+${h.padStart(4, "0")}`; // U+00AD, not U+AD; U+E0041 stays 5 digits
                                        }),
                                });
                        }
                }
        }
        return flags;
}
