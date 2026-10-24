/**
 * import-cli.ts — `unown import` (the 2026-10-24 parity round): one-command
 * config migration from Claude Code / Codex / Gemini CLI / Cursor / OpenCode.
 *
 *   unown import [--from <auto|claude-code|codex|gemini|cursor|opencode>]
 *                [--dry-run] [--lane <instructions|commands|skills|agents|mcp>]...
 *                [--list]
 *
 * The Claude Code /import acquisition play (instruction files, MCP servers,
 * commands, subagents, skills carried over in one command), pointed the other
 * way. `--from auto` (the default) scans every source and reports what each
 * can contribute — an empty report means "nothing found to import".
 *
 * Pattern matches sessions-cli.ts / automations-cli.ts: exit-code-returning
 * entry point, stdout/stderr directly. The pure core is import-config.ts.
 */

import {
    detectAvailableSources,
    executeImport,
    IMPORT_LANES,
    IMPORT_SOURCES,
    planImport,
    type ImportLane,
    type ImportSource,
} from "./import-config.ts";
import { join } from "node:path";

export const IMPORT_USAGE = `unown import — one-command config migration from the other agents

Usage:
  unown import [--from <auto|${IMPORT_SOURCES.join("|")}>] [--dry-run]
               [--lane <${IMPORT_LANES.join("|")}>]...
  unown import --list          what each source could contribute (no writes)

Lanes:
  instructions   CLAUDE.md / GEMINI.md / AGENTS.md / cursor rules — appended to
                 AGENTS.md under a marked comment section (never overwrites;
                 a re-run of the same source appends nothing)
  commands       .claude/commands, codex prompts, gemini TOML commands
                 (converted to markdown), .opencode/command → .unown/commands
  skills         .claude/skills/<name>/SKILL.md → .unown/skills/<name>/
  agents         .claude/agents, .opencode/agent → .unown/agents
  mcp            .mcp.json / ~/.claude.json / config.toml / settings.json →
                 .unown/mcp.json (existing unown servers win; the file stays
                 trust-gated — run /mcp trust to activate)

Never overwrites: an existing target file is skipped with the reason. MCP
servers already configured in unown are skipped (unown wins). Everything is
per-artifact best-effort — one unreadable file never fails the import.

Docs: docs/usage.md (unown import).`;

function flagValue(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(name);
}

/** Exit-code-returning entry point. `argv` is everything AFTER `unown import`. */
export async function runImportCommand(argv: string[]): Promise<number> {
    if (hasFlag(argv, "-h") || hasFlag(argv, "--help") || argv[0] === "help") {
        process.stdout.write(IMPORT_USAGE + "\n");
        return 0;
    }

    const cwd = process.cwd();
    const projectDir = cwd;
    const homeFlag = flagValue(argv, "--home");
    const opts = { projectDir, ...(homeFlag !== undefined ? { homeDir: homeFlag } : {}) };

    // --list: the survey (what each source can contribute).
    if (hasFlag(argv, "--list")) {
        const available = detectAvailableSources(opts);
        const rows = available.map((a) => {
            const mark = a.count > 0 ? "✓" : " ";
            const where = a.count > 0 ? ` — ${a.count} artifact(s)` : "";
            return ` ${mark} ${a.source.padEnd(12)}${where}`;
        });
        process.stdout.write(`Import sources (scan of ${cwd} + your home):\n${rows.join("\n")}\n`);
        process.stdout.write("\nRun `unown import --from <source>` to import one, or `unown import` (auto) for everything.\n");
        return 0;
    }

    // --from (default auto).
    const from = flagValue(argv, "--from") ?? "auto";
    if (from !== "auto" && !IMPORT_SOURCES.includes(from as ImportSource)) {
        process.stderr.write(`unown import: unknown source "${from}" (expected auto|${IMPORT_SOURCES.join("|")})\n`);
        return 1;
    }

    // --lane (repeatable).
    const lanes: ImportLane[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--lane" && i + 1 < argv.length) {
            const lane = argv[i + 1] as ImportLane;
            if (!IMPORT_LANES.includes(lane)) {
                process.stderr.write(`unown import: unknown lane "${argv[i + 1]}" (expected ${IMPORT_LANES.join("|")})\n`);
                return 1;
            }
            lanes.push(lane);
            i++;
        }
    }

    const dryRun = hasFlag(argv, "--dry-run");
    const sources: ImportSource[] = from === "auto" ? IMPORT_SOURCES : [from as ImportSource];

    let totalDone = 0;
    let totalSkipped = 0;
    const writtenBySource: string[] = [];
    const notesBySource: string[] = [];

    for (const source of sources) {
        const plan = planImport(source, { ...opts, lanes: lanes.length > 0 ? lanes : undefined });
        if (plan.artifacts.length === 0 && plan.skipped.length === 0) continue; // nothing here — quiet in auto mode
        const result = executeImport(plan, { ...opts, dryRun });
        const laneCounts = new Map<string, number>();
        for (const a of result.done) laneCounts.set(a.lane, (laneCounts.get(a.lane) ?? 0) + 1);
        const laneSummary = [...laneCounts.entries()].map(([lane, n]) => `${n} ${lane}`).join(", ");
        if (result.done.length > 0) {
            process.stdout.write(
                `${dryRun ? "[dry-run] " : "✓ "}${source}: would import / imported ${laneSummary}\n`,
            );
            for (const d of result.done) {
                const target = d.lane === "mcp" ? `mcp server "${d.serverName}"` : d.lane === "instructions" ? "AGENTS.md section" : join(d.target ?? "");
                process.stdout.write(`    + ${target}  (from ${d.origin})\n`);
            }
        } else if (sources.length === 1) {
            process.stdout.write(`${source}: nothing to import\n`);
        }
        for (const s of result.skipped) {
            process.stdout.write(`    - skipped ${s.lane} from ${s.origin}: ${s.reason}\n`);
        }
        for (const note of result.notes) notesBySource.push(`${source}: ${note}`);
        totalDone += result.done.length;
        totalSkipped += result.skipped.length;
        writtenBySource.push(...result.written);
    }

    for (const note of [...new Set(notesBySource)]) {
        process.stdout.write(`note: ${note}\n`);
    }
    if (totalDone === 0 && totalSkipped === 0) {
        process.stdout.write("Nothing found to import (no CLAUDE.md / GEMINI.md / .claude / .codex / .gemini / .cursor / .opencode artifacts).\n");
        process.stdout.write("`unown import --list` surveys every source; docs/usage.md has the lane table.\n");
    }
    if (dryRun && totalDone > 0) {
        process.stdout.write("\n[dry-run] nothing written — re-run without --dry-run to apply.\n");
    }
    return 0;
}
