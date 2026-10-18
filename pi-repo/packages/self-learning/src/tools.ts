/**
 * tools.ts — Claude Code-grade session tools for the unown terminal agent.
 *
 * One bundled inline extension (`unown-tools`, wired in cli.ts) that gives a
 * plain pi session the capabilities a 2026 coding agent is expected to have:
 *
 *   - `todo` tool + /todos      visible task tracking (state rides session
 *                               entries, so branching keeps correct todos)
 *   - `task` tool + /agents     subagents with a FRESH context window — they
 *                               are full unown agents (memory + guardrails +
 *                               note capture), spawned as `unown --mode json`
 *                               subprocesses; agent definitions live in
 *                               .unown/agents/*.md (project) and
 *                               ~/.unown/agent/agents/*.md (user)
 *   - `note` tool + /note       record durable learning notes MID-session
 *                               (delivered to the engine immediately; AutoDream
 *                               consolidates them into project memory)
 *   - `fetch_url` tool          read-only HTTP GET, HTML stripped, capped
 *   - /plan + --plan flag       plan mode: read-only toolset, bash allowlist,
 *                               numbered "Plan:" extraction, approve-to-execute
 *                               flow with [DONE:n] progress tracking
 *   - /learning                 re-print the effective 4-tier memory stack
 *
 * Subagents never nest (UNOWN_SUBAGENT=1 disables the `task` tool inside a
 * subagent) and every subagent session writes its own note — subagents learn
 * too.
 */
import { spawn } from "node:child_process";
import { type Dirent, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Key, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { trustBypassed } from "./config-trust.ts";
import {
    characterForLine,
    countErrors,
    languageFromPath,
    LspManager,
    readLineText,
    renderDiagnostics,
    renderLocations,
    resolveLspConfig,
    trustProjectLspConfig,
} from "./lsp.ts";
import { deliverTerminalNote, ENGINE_URL, resolveTerminalMemory, UNOWN_AGENT_DIR } from "./term.ts";
import {
    checkGoalCompletion,
    goalContextMessage,
    hasGoalTag,
    type GoalState,
    parseGoalCommand,
    parseGoalEntry,
    renderGoalStatus,
} from "./goal.ts";
import { checkSchemaShape, SchemaError, type SchemaIssue, validateJsonSchema } from "./jsonschema.ts";
import {
        characterForLine,
        countErrors,
        LspManager,
        languageFromPath,
        readLineText,
        renderDiagnostics,
        renderLocations,
        resolveLspConfig,
        trustProjectLspConfig,
} from "./lsp.ts";
import { assistantTextOf } from "./messages.ts";
import {
        buildReviewerTask,
        captureReviewTarget,
        mergeReviews,
        parseReviewOutput,
        REVIEWER_FOCUSES,
        renderReview,
        reviewerAgent,
        saveReviewArtifact,
} from "./review.ts";
import { deliverTerminalNote, resolveTerminalMemory, UNOWN_AGENT_DIR } from "./term.ts";
import { fetchPageContent, registerWebTools } from "./websearch.ts";
import { cleanupWorktree, createWorktree, type WorktreeHandle } from "./worktree.ts";

// ---------------------------------------------------------------------------
// Subagent registry: built-ins + .unown/agents/*.md + ~/.unown/agent/agents/*.md
// ---------------------------------------------------------------------------

export interface SubagentConfig {
        name: string;
        description: string;
        tools?: string[];
        systemPrompt: string;
        source: "built-in" | "user" | "project";
}

const BUILTIN_AGENTS: SubagentConfig[] = [
        {
                name: "general",
                description:
                        "General-purpose coding subagent with the full unown toolset (read/write/edit/bash + todo/note/web_search/webfetch) and the same tiered memory. Use for self-contained implementation or investigation tasks that deserve a fresh context.",
                systemPrompt: `You are unown's general-purpose coding subagent. You run inside the user's project with unown's tiered memory injected and guardrail hooks active.

You receive ONE self-contained task; you do not see the parent conversation. Do the task completely, then report back concisely:
- what you did (files touched, commands run)
- the result / answer, with evidence (command output, file:line references)
- anything the parent agent should know (blockers, follow-ups)

Use the todo tool to track multi-step work. Record durable project pitfalls you discover with the note tool. Be direct and factual; no filler.`,
                source: "built-in",
        },
        {
                name: "explore",
                description:
                        "Read-only exploration subagent (read/grep/find/ls only). Maps where things live in the repo and returns file:line evidence. Use whenever the parent context would be polluted by broad code search.",
                tools: ["read", "grep", "find", "ls"],
                systemPrompt: `You are unown's exploration subagent — read-only. You cannot write, edit, or run state-changing commands; bash is limited to read-only inspection.

You receive ONE self-contained question about the codebase. Answer it with evidence:
- enumerate the relevant files with their roles
- cite file:line for every claim
- end with a short direct answer first, details after

Do not propose changes; do not edit anything. If the answer is not in the repo, say so.`,
                source: "built-in",
        },
];

type AgentFrontmatter = {
        name?: unknown;
        description?: unknown;
        tools?: unknown;
};

function parseToolList(value: unknown): string[] | undefined {
        const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
        const tools = raw
                .filter((t): t is string => typeof t === "string")
                .map((t) => t.trim())
                .filter(Boolean);
        return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): SubagentConfig[] {
        const agents: SubagentConfig[] = [];
        if (!existsSync(dir)) return agents;
        let entries: Dirent[];
        try {
                entries = readdirSync(dir, { withFileTypes: true });
        } catch {
                return agents;
        }
        for (const entry of entries) {
                if (!entry.name.endsWith(".md")) continue;
                const filePath = join(dir, entry.name);
                let content: string;
                try {
                        content = readFileSync(filePath, "utf8");
                } catch {
                        continue;
                }
                let frontmatter: AgentFrontmatter | undefined;
                try {
                        ({ frontmatter } = parseFrontmatter<AgentFrontmatter>(content));
                } catch {
                        continue;
                }
                const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
                if (!frontmatter) continue;
                if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;
                agents.push({
                        name: frontmatter.name,
                        description: frontmatter.description,
                        tools: parseToolList(frontmatter.tools),
                        systemPrompt: body.trim(),
                        source,
                });
        }
        return agents;
}

/** Built-ins first; project-level .unown/agents/*.md overrides user-level by name. */
export function discoverSubagents(cwd: string): SubagentConfig[] {
        const user = loadAgentsFromDir(join(UNOWN_AGENT_DIR, "agents"), "user");
        const project = loadAgentsFromDir(join(cwd, ".unown", "agents"), "project");
        const byName = new Map<string, SubagentConfig>();
        for (const a of BUILTIN_AGENTS) byName.set(a.name, a);
        for (const a of user) byName.set(a.name, a);
        for (const a of project) byName.set(a.name, a);
        return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Subagent process runner — spawns `unown --mode json -p --no-session`
// ---------------------------------------------------------------------------

const SUBAGENT_TIMEOUT_MS = 300_000;
const SUBAGENT_OUTPUT_CAP = 16_000;
const SUBAGENT_STDERR_CAP = 2_000;

export interface SubagentRunResult {
        agent: string;
        task: string;
        exitCode: number;
        output: string;
        stderr: string;
        toolResults: number;
        usage: { input: number; output: number; turns: number };
        /** True when the output was cut at SUBAGENT_OUTPUT_CAP — callers that
         *  parse the output (e.g. /review) mark the result as possibly
         *  incomplete instead of presenting a truncated finding set as whole
         *  (R-b S3). */
        outputTruncated?: boolean;
        /** Structured-output lane (oh-my-pi task outputSchema port): present
         *  when the caller requested a schema. `ok` true carries the parsed,
         *  validated JSON in `data`; false carries the extraction/validation
         *  error (after retries). */
        structured?: { ok: boolean; data?: unknown; error?: string };
        /** Worktree-isolation lane (muse worktree fan-out port): the tree this
         *  run executed in, plus its cleanup disposition when already
         *  decided by the runner. */
        worktree?: { path: string; baseCommit: string; cleanup?: { action: string; detail: string } };
}

// ---------------------------------------------------------------------------
// Structured outputs (oh-my-pi `task` outputSchema port)
// ---------------------------------------------------------------------------

/** Options on a subagent run that engage the structured-output lane. */
export interface StructuredRunOptions {
        /** JSON Schema the subagent's final reply must satisfy. */
        outputSchema?: unknown;
        /** "permissive" (default): an invalid final reply still returns the
         *  text with a visible warning; "strict": it is reported as an
         *  error. Mirrors oh-my-pi's schemaMode semantics. */
        schemaMode?: "permissive" | "strict";
}

/** Schema-validation retries before the permissive/strict verdict — the
 *  oh-my-pi shape is "up to 3 reminder prompts"; ours is one original run +
 *  2 corrective re-runs (each carries the exact schema defects back to the
 *  child, same contract omp's reminders implement inside one session). */
const STRUCTURED_RETRIES = 2;

/** Extract the JSON a model was asked to emit: handles bare JSON, fenced
 *  ```json blocks, and leading/trailing prose around ONE balanced object or
 *  array. Pure + exported for tests. */
export function extractJsonReply(text: string): { ok: true; data: unknown } | { ok: false; error: string } {
        const trimmed = text.trim();
        if (!trimmed) return { ok: false, error: "empty reply" };
        // 1) fenced block (```json … ``` or ``` … ```)
        const fence = trimmed.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
        const candidates: string[] = [];
        if (fence?.[1]) candidates.push(fence[1].trim());
        // 2) the whole reply
        candidates.push(trimmed);
        // 3) first balanced {...} or [...] inside the reply (models like a
        //    little prose around their JSON despite instructions)
        const scan = scanBalancedJson(trimmed);
        if (scan !== null) candidates.push(scan);
        for (const candidate of candidates) {
                try {
                        return { ok: true, data: JSON.parse(candidate) };
                } catch {
                        /* try the next candidate shape */
                }
        }
        return { ok: false, error: "reply is not valid JSON (no parseable object or array found)" };
}

/** Find the first balanced top-level {...} or [...] in `text`, or null. */
function scanBalancedJson(text: string): string | null {
        const start = text.search(/[{[]/);
        if (start === -1) return null;
        const open = text[start];
        const close = open === "{" ? "}" : "]";
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < text.length; i++) {
                const ch = text[i];
                if (inString) {
                        if (escaped) escaped = false;
                        else if (ch === "\\") escaped = true;
                        else if (ch === '"') inString = false;
                        continue;
                }
                if (ch === '"') inString = true;
                else if (ch === open) depth++;
                else if (ch === close) {
                        depth--;
                        if (depth === 0) return text.slice(start, i + 1);
                }
        }
        return null;
}

/** Validate a reply against a schema; issues become one actionable string
 *  (path-annotated, capped) that the retry loop can quote back. */
export function formatSchemaIssues(issues: SchemaIssue[], cap = 8): string {
        const shown = issues.slice(0, cap).map((i) => `${i.path}: ${i.message}`);
        const more = issues.length > cap ? ` (+${issues.length - cap} more)` : "";
        return shown.join("; ") + more;
}

/** The corrective re-run task: same job + the schema + the exact defects. */
function buildSchemaRetryTask(task: string, schema: unknown, problems: string): string {
        return (
                `${task}\n\n` +
                `STRUCTURED OUTPUT REQUIRED: your previous reply failed validation — ${problems}.\n` +
                `Reply with ONLY the corrected JSON value (no prose, no markdown fences) that validates against this JSON Schema:\n` +
                `${JSON.stringify(schema, null, 2)}`
        );
}

function getUnownInvocation(args: string[]): { command: string; args: string[] } {
        const currentScript = process.argv[1];
        if (currentScript && !isBunVirtualScriptPath(currentScript) && existsSync(currentScript)) {
                return { command: process.execPath, args: [currentScript, ...args] };
        }
        // Fallback. With shell:false, `spawn("unown")` cannot resolve unown.cmd
        // on Windows — so there we re-resolve the actual CLI script (bin/unown,
        // found by walking up from this module) and exec it with the current
        // runtime, mirroring the primary path. POSIX keeps the PATH lookup.
        if (process.platform === "win32") {
                const cli = resolveUnownCliScript();
                if (cli) return { command: process.execPath, args: [cli, ...args] };
        }
        return { command: "unown", args };
}

// Bun compiled binaries run from a virtual filesystem: POSIX spells it
// /$bunfs/root/…; the Windows form is a drive letter + backslashes,
// C:\$bunfs\root\… (case-insensitive, either separator). Neither exists on
// disk, so the primary exec path must never use them as the script.
const BUN_FS_PREFIX_POSIX = "/$bunfs/root/";
const BUN_FS_PREFIX_WIN = /^[a-zA-Z]:[\\/]\$bunfs[\\/]root[\\/]/i;

/** True when `script` is Bun's virtual compiled-binary path in either
 *  platform spelling. Exported for tests. */
export function isBunVirtualScriptPath(script: string | undefined): boolean {
        if (!script) return false;
        return script.startsWith(BUN_FS_PREFIX_POSIX) || BUN_FS_PREFIX_WIN.test(script);
}

/** Locate the canonical CLI script: walk up from this module until a
 *  directory containing bin/unown is found (pi-repo/packages/self-learning/src
 *  -> … -> repo root/bin/unown). Cross-platform by construction — no PATH
 *  or .cmd resolution involved. */
export function resolveUnownCliScript(): string | null {
        let dir = import.meta.dir;
        for (;;) {
                const candidate = join(dir, "bin", "unown");
                if (existsSync(candidate)) return candidate;
                const parent = dirname(dir);
                if (parent === dir) return null;
                dir = parent;
        }
}

function assistantText(message: any): string {
        if (!message || message.role !== "assistant") return "";
        const content = message.content;
        if (typeof content === "string") return content;
        if (!Array.isArray(content)) return "";
        return content
                .filter((b: any) => b?.type === "text" && typeof b.text === "string")
                .map((b: any) => b.text)
                .join("\n");
}

function formatTokens(count: number): string {
        if (count < 1000) return String(count);
        if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
        return `${(count / 1_000_000).toFixed(1)}M`;
}

interface KillableProc {
        pid?: number | undefined;
        kill(signal?: NodeJS.Signals | number): boolean;
}

/** Kill a timed-out / aborted subagent. Windows: bun's kill() emulation
 *  hard-terminates only the DIRECT child while grandchildren survive, so
 *  spawn System32 taskkill /F /T for a forceful tree kill (same approach as
 *  pi's killProcessTree — not importable from the package root, so kept
 *  local). POSIX: the subagent is spawned WITHOUT its own process group, so
 *  a group kill is impossible (it would take the parent down too) — keep the
 *  SIGTERM escalation on the direct child. */
function killSubagentTree(proc: KillableProc): void {
        if (process.platform === "win32") {
                if (proc.pid === undefined) return;
                try {
                        const killer = spawn(
                                join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
                                ["/F", "/T", "/PID", String(proc.pid)],
                                { stdio: "ignore", detached: true, windowsHide: true },
                        );
                        // A failed spawn emits "error" asynchronously; consume it
                        // so it cannot crash the parent.
                        killer.once("error", () => {});
                } catch {
                        try {
                                proc.kill("SIGKILL");
                        } catch {
                                /* already gone */
                        }
                }
                return;
        }
        try {
                proc.kill("SIGTERM");
        } catch {
                /* already gone */
        }
}

/** One subagent attempt: spawn, collect, and (when a schema was requested)
 *  validate the final reply. Shared by the original run and the corrective
 *  re-runs. */
async function runSubagentOnce(
        agent: SubagentConfig,
        task: string,
        cwd: string,
        signal: AbortSignal | undefined,
): Promise<SubagentRunResult> {
        const result: SubagentRunResult = {
                agent: agent.name,
                task,
                exitCode: 0,
                output: "",
                stderr: "",
                toolResults: 0,
                usage: { input: 0, output: 0, turns: 0 },
        };
        const args: string[] = ["--mode", "json", "-p", "--no-session"];
        if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
        let promptDir: string | null = null;
        try {
                if (agent.systemPrompt.trim()) {
                        promptDir = mkdtempSync(join(tmpdir(), "unown-subagent-"));
                        const promptFile = join(promptDir, "system-prompt.md");
                        writeFileSync(promptFile, agent.systemPrompt, { encoding: "utf8", mode: 0o600 });
                        args.push("--append-system-prompt", promptFile);
                }
                args.push(`Task: ${task}`);

                await new Promise<void>((resolve) => {
                        const invocation = getUnownInvocation(args);
                        const proc = spawn(invocation.command, invocation.args, {
                                cwd,
                                shell: false,
                                stdio: ["ignore", "pipe", "pipe"],
                                env: { ...process.env, UNOWN_SUBAGENT: "1" },
                        });
                        let buffer = "";
                        let stderrBuffer = "";
                        let lastText = "";
                        let settled = false;

                        const finish = () => {
                                if (settled) return;
                                settled = true;
                                clearTimeout(watchdog);
                                result.outputTruncated = lastText.length > SUBAGENT_OUTPUT_CAP;
                                result.output = lastText.slice(0, SUBAGENT_OUTPUT_CAP);
                                result.stderr = stderrBuffer.slice(0, SUBAGENT_STDERR_CAP);
                                resolve();
                        };

                        const processLine = (line: string) => {
                                if (!line.trim()) return;
                                let event: any;
                                try {
                                        event = JSON.parse(line);
                                } catch {
                                        return;
                                }
                                if (event?.type === "message_end" && event.message) {
                                        const msg = event.message;
                                        if (msg.role === "assistant") {
                                                result.usage.turns++;
                                                const usage = msg.usage;
                                                if (usage) {
                                                        result.usage.input += usage.input || 0;
                                                        result.usage.output += usage.output || 0;
                                                }
                                                const text = assistantText(msg);
                                                if (text.trim()) lastText = text;
                                        }
                                } else if (event?.type === "tool_result_end") {
                                        result.toolResults++;
                                }
                        };

                        proc.stdout.on("data", (data) => {
                                buffer += data.toString();
                                const lines = buffer.split("\n");
                                buffer = lines.pop() || "";
                                for (const line of lines) processLine(line);
                        });
                        proc.stderr.on("data", (data) => {
                                stderrBuffer += data.toString();
                        });
                        proc.on("close", (code) => {
                                if (buffer.trim()) processLine(buffer);
                                result.exitCode = code ?? 0;
                                finish();
                        });
                        proc.on("error", () => {
                                result.exitCode = 1;
                                stderrBuffer += "failed to spawn subagent process";
                                finish();
                        });

                        const watchdog = setTimeout(() => {
                                stderrBuffer += `\n(subagent timed out after ${SUBAGENT_TIMEOUT_MS / 1000}s and was killed)`;
                                killSubagentTree(proc);
                                if (process.platform !== "win32") {
                                        // POSIX escalation: SIGTERM (sent by killSubagentTree)
                                        // then SIGKILL. On win32 taskkill /F /T is already a
                                        // forceful tree kill — no second stage needed.
                                        setTimeout(() => {
                                                try {
                                                        proc.kill("SIGKILL");
                                                } catch {
                                                        /* already gone */
                                                }
                                        }, 5000);
                                }
                        }, SUBAGENT_TIMEOUT_MS);

                        const killProc = () => {
                                stderrBuffer += "\n(subagent aborted)";
                                killSubagentTree(proc);
                        };
                        if (signal) {
                                if (signal.aborted) killProc();
                                else signal.addEventListener("abort", killProc, { once: true });
                        }
                });
        } finally {
                if (promptDir) {
                        try {
                                rmSync(promptDir, { recursive: true, force: true });
                        } catch {
                                /* best effort */
                        }
                }
        }
        return result;
}

/** Spawn one unown subagent and collect its JSON event stream. When
 *  `opts.outputSchema` is set, the final reply is extracted + validated
 *  against the schema, with up to STRUCTURED_RETRIES corrective re-runs that
 *  quote the exact defects back to the child (oh-my-pi task outputSchema
 *  port: permissive keeps an invalid reply with a warning; strict reports
 *  it as an error). */
export async function runSubagent(
        agent: SubagentConfig,
        task: string,
        cwd: string,
        signal: AbortSignal | undefined,
        opts: StructuredRunOptions = {},
): Promise<SubagentRunResult> {
        if (!opts.outputSchema) return runSubagentOnce(agent, task, cwd, signal);
        const schema = opts.outputSchema;
        let attempts = 0;
        let result = await runSubagentOnce(agent, task, cwd, signal);
        // usage/toolResults accumulate ACROSS retries (the caller bills and
        // reports the whole structured-output contract, not the last try).
        let usage = { ...result.usage };
        let toolResults = result.toolResults;
        let currentTask = task;
        for (;;) {
                attempts++;
                const problems: string[] = [];
                if (result.exitCode !== 0) {
                        problems.push(
                                `subagent exited with code ${result.exitCode}${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 200)}` : ""}`,
                        );
                } else {
                        const extracted = extractJsonReply(result.output);
                        if (!extracted.ok) problems.push(extracted.error);
                        else {
                                try {
                                        const validation = validateJsonSchema(extracted.data, schema);
                                        if (validation.valid) {
                                                result.structured = { ok: true, data: extracted.data };
                                                result.usage = usage;
                                                result.toolResults = toolResults;
                                                return result;
                                        }
                                        problems.push(formatSchemaIssues(validation.issues));
                                } catch (err) {
                                        // SchemaError — the SCHEMA is malformed, not the reply.
                                        problems.push(`schema error: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                }
                if (attempts > STRUCTURED_RETRIES || signal?.aborted) {
                        result.structured = { ok: false, error: problems.join("; ") };
                        result.usage = usage;
                        result.toolResults = toolResults;
                        return result;
                }
                // Corrective re-run with the defects quoted back.
                currentTask = buildSchemaRetryTask(currentTask, schema, problems.join("; "));
                const retry = await runSubagentOnce(agent, currentTask, cwd, signal);
                usage = {
                        input: usage.input + retry.usage.input,
                        output: usage.output + retry.usage.output,
                        turns: usage.turns + retry.usage.turns,
                };
                toolResults += retry.toolResults;
                result = retry;
        }
}

// ---------------------------------------------------------------------------
// fetch_url helpers
//
// The fetch pipeline itself (SSRF guard, robots check, HTML stripping and
// the extraction fallback chain) now lives in websearch.ts, shared with the
// webfetch tool. fetch_url keeps its name for compatibility and delegates.
// ---------------------------------------------------------------------------

async function fetchUrlText(url: string, maxChars: number): Promise<string> {
        return fetchPageContent(url, { maxChars });
}

// ---------------------------------------------------------------------------
// Plan-mode helpers (adapted from pi's plan-mode example extension)
// ---------------------------------------------------------------------------

const DESTRUCTIVE_PATTERNS = [
        /\brm\b/i,
        /\brmdir\b/i,
        /\bmv\b/i,
        /\bcp\b/i,
        /\bmkdir\b/i,
        /\btouch\b/i,
        /\bchmod\b/i,
        /\bchown\b/i,
        /\bchgrp\b/i,
        /\bln\b/i,
        /\btee\b/i,
        /\btruncate\b/i,
        /\bdd\b/i,
        /\bshred\b/i,
        /(^|[^<])>(?!>)/,
        />>/,
        /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
        /\byarn\s+(add|remove|install|publish)/i,
        /\bpnpm\s+(add|remove|install|publish)/i,
        /\bpip\s+(install|uninstall)/i,
        /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
        /\bbrew\s+(install|uninstall|upgrade)/i,
        /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
        /\bsudo\b/i,
        /\bsu\b/i,
        /\bkill\b/i,
        /\bpkill\b/i,
        /\bkillall\b/i,
        /\breboot\b/i,
        /\bshutdown\b/i,
        /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
        /\bservice\s+\S+\s+(start|stop|restart)/i,
        /\b(vim?|nano|emacs|code|subl)\b/i,
        // ---- Windows / PowerShell family (case-insensitive: PowerShell verbs
        // and flags are case-insensitive at runtime, and `-flag`/`/flag` are
        // both accepted). These are the chained-command backstop: a command
        // must pass the SAFE allowlist AND contain none of these.
        /\bremove-item\b/i, // any Remove-Item: plan mode is read-only (covers -Recurse/-Force/system dirs)
        /\b(?:del|rd|rmdir|erase)\s[^\n]*\/s\b/i, // recursive cmd deletes (bare `del file` chained is a known residual)
        /\bformat\s+[a-zA-Z]:/i,
        /\breg\s/i, // any reg.exe use (query included — plan mode never touches the registry)
        /\bbcdedit\b/i,
        /\bdiskpart\b/i,
        /\bvssadmin\b/i,
        /\bwbadmin\b/i,
        /\bset-executionpolicy\b/i,
        /\bstop-process\b/i,
        /\btaskkill\s[^\n]*\/f\b/i,
];

const SAFE_PATTERNS = [
        /^\s*cat\b/,
        /^\s*head\b/,
        /^\s*tail\b/,
        /^\s*less\b/,
        /^\s*more\b/,
        /^\s*grep\b/,
        /^\s*find\b/,
        /^\s*ls\b/,
        /^\s*pwd\b/,
        /^\s*echo\b/,
        /^\s*printf\b/,
        /^\s*wc\b/,
        /^\s*sort\b/,
        /^\s*uniq\b/,
        /^\s*diff\b/,
        /^\s*file\b/,
        /^\s*stat\b/,
        /^\s*du\b/,
        /^\s*df\b/,
        /^\s*tree\b/,
        /^\s*which\b/,
        /^\s*whereis\b/,
        /^\s*type\b/,
        /^\s*env\b/,
        /^\s*printenv\b/,
        /^\s*uname\b/,
        /^\s*whoami\b/,
        /^\s*id\b/,
        /^\s*date\b/,
        /^\s*cal\b/,
        /^\s*uptime\b/,
        /^\s*ps\b/,
        /^\s*top\b/,
        /^\s*htop\b/,
        /^\s*free\b/,
        /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
        /^\s*git\s+ls-/i,
        /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
        /^\s*yarn\s+(list|info|why|audit)/i,
        /^\s*node\s+--version/i,
        /^\s*python\s+--version/i,
        /^\s*curl\s/i,
        /^\s*jq\b/,
        /^\s*sed\s+-n/i,
        /^\s*awk\b/,
        /^\s*rg\b/,
        /^\s*fd\b/,
        /^\s*bat\b/,
        // ---- Windows / PowerShell read-only family (case-insensitive).
        /^\s*(Get-Content|Get-ChildItem|Get-Item|Get-Location|Get-Command|Get-Process|Get-Date|Select-String|Measure-Object|Test-Path)\b/i,
        /^\s*dir\b/i, // cmd + PowerShell alias for Get-ChildItem
        /^\s*where\.exe\b/i,
        // (type and whoami are already above; kept case-sensitive with their POSIX peers.)
        /^\s*(git|npm|node|python|bun)\s+--version\b/i,
];

export function isSafeCommand(command: string): boolean {
        const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
        const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
        return !isDestructive && isSafe;
}

export interface PlanStep {
        step: number;
        text: string;
        completed: boolean;
}

export function extractPlanSteps(message: string): PlanStep[] {
        const items: PlanStep[] = [];
        const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
        if (!headerMatch) return items;
        const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
        const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;
        for (const match of planSection.matchAll(numberedPattern)) {
                const text = match[2]
                        .trim()
                        .replace(/\*{1,2}$/, "")
                        .trim();
                if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
                        const cleaned = text
                                .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
                                .replace(/\s+/g, " ")
                                .trim();
                        if (cleaned.length > 3) items.push({ step: items.length + 1, text: cleaned, completed: false });
                }
        }
        return items;
}

export function markCompletedSteps(text: string, items: PlanStep[]): number {
        let marked = 0;
        for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
                const step = Number(match[1]);
                const item = items.find((t) => t.step === step);
                if (item && !item.completed) {
                        item.completed = true;
                        marked++;
                }
        }
        return marked;
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

/**
 * Footer status line (P1-b): pi's `ctx.ui.setStatus(key, text)` seam — the
 * interactive footer renders one joined, width-truncated row from all
 * extension statuses (`FooterDataProvider.getExtensionStatuses()`; pass
 * undefined to clear the key). Plan mode already used it; the LSP surface,
 * unown-mcp, /review and /goal now do too (R-c §3: the API existed and was
 * simply unused — state was only visible via /lsp and /mcp popups).
 *
 * Guarded on every call: the UI shape varies across pi modes/builds (print
 * mode has no ui, older builds may lack setStatus), so a missing or throwing
 * setStatus degrades to no status line — never a crash.
 */
const setStatusLine = (ctx: any, key: string, text: string | undefined): void => {
        try {
                if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;
                ctx.ui.setStatus(key, text);
        } catch {
                /* the footer is cosmetic — degrade silently */
        }
};

/** The /goal footer line for a goal state (undefined = clear the key). */
const goalFooterLine = (g: GoalState | null): string | undefined => {
        if (!g) return undefined;
        if (g.status === "active") return "goal: active";
        if (g.status === "paused") return "goal: paused";
        return "goal: \u2713 complete";
};

export interface UnownToolsOptions {
        cwd: string; // the user's real project directory
        engineUrl: string;
        isSubagent?: boolean; // inside a spawned subagent: disable the task tool (no nesting)
        verbose?: boolean;
}

const PLAN_MODE_TOOLS = [
        "read",
        "bash",
        "grep",
        "find",
        "ls",
        "todo",
        "note",
        "fetch_url",
        "web_search",
        "webfetch",
        "lsp",
];
const PLAN_MODE_DISABLED_TOOLS = new Set(["edit", "write", "task"]);
const PLAN_MANAGED_TOOLS = new Set([...PLAN_MODE_TOOLS, ...PLAN_MODE_DISABLED_TOOLS, "edit", "write"]);

interface Todo {
        id: number;
        text: string;
        done: boolean;
}

interface TodoDetails {
        action: "list" | "add" | "toggle" | "clear";
        todos: Todo[];
        nextId: number;
        error?: string;
}

interface TaskRunDetails {
        runs: Array<{
                agent: string;
                task: string;
                exitCode: number;
                turns: number;
                toolResults: number;
                /** structured-output lane (present when output_schema was set) */
                structured?: { ok: boolean; error?: string };
                /** worktree-isolation lane (present when worktree_isolation was set) */
                worktree?: { action: string; path?: string; detail: string };
        }>;
}

const TodoParams = Type.Object({
        action: StringEnum(["list", "add", "toggle", "clear"] as const),
        text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
        id: Type.Optional(Type.Number({ description: "Todo ID (for toggle)" })),
});

const NoteParams = Type.Object({
        text: Type.String({
                description:
                        "Durable learning note, delivered to the self-learning engine immediately. Concise imperative rule ('When X, do Y') covering a pitfall, convention, or decision worth remembering across sessions.",
        }),
});

const TaskParams = Type.Object({
        agent: Type.Optional(
                Type.String({ description: 'Subagent name (default "general"; run /agents to list). "explore" is read-only.' }),
        ),
        task: Type.Optional(
                Type.String({
                        description:
                                "Self-contained task for the subagent. It does NOT see this conversation — include all needed detail.",
                }),
        ),
        tasks: Type.Optional(
                Type.Array(
                        Type.Object({
                                agent: Type.Optional(Type.String({ description: "Subagent name (default general)" })),
                                task: Type.String({ description: "Self-contained task" }),
                                output_schema: Type.Optional(
                                        Type.Any({
                                                description:
                                                        "JSON Schema (object) this subagent's FINAL reply must satisfy — the reply is parsed as JSON and validated; invalid replies are retried with the exact defects quoted back. Use for typed fan-out (findings, reports, structured data).",
                                        }),
                                ),
                                schema_mode: Type.Optional(
                                        StringEnum(["permissive", "strict"] as const, {
                                                description:
                                                        '"permissive" (default): an invalid final reply still returns its text with a warning; "strict": it is reported as an error.',
                                        }),
                                ),
                                worktree_isolation: Type.Optional(
                                        Type.Boolean({
                                                description:
                                                        "Run this subagent in its own git worktree (an isolated copy of the repo at HEAD) so parallel writers never collide. The result reports the kept worktree path when work was committed/left dirty — merge it via your normal source-control workflow. Rejected (never silently shared) outside a git repository.",
                                        }),
                                ),
                        }),
                        { description: "Parallel mode: run several subagents at once (max 4)" },
                ),
        ),
        output_schema: Type.Optional(
                Type.Any({
                        description:
                                "JSON Schema (object) the subagent's FINAL reply must satisfy (single-task form; per-item in tasks[]). The reply is parsed as JSON and validated; invalid replies are retried with the exact defects quoted back.",
                }),
        ),
        schema_mode: Type.Optional(
                StringEnum(["permissive", "strict"] as const, {
                        description:
                                '"permissive" (default) keeps an invalid final reply with a warning; "strict" reports it as an error.',
                }),
        ),
        worktree_isolation: Type.Optional(
                Type.Boolean({
                        description:
                                "Run the subagent in its own git worktree (isolated copy of the repo at HEAD) — parallel writers never collide; the result reports the kept worktree path for merge. Rejected (never silently shared) outside a git repository.",
                }),
        ),
});

const FetchParams = Type.Object({
        url: Type.String({ description: "http(s) URL to fetch (GET)" }),
        max_chars: Type.Optional(Type.Number({ description: "Cap on returned characters (default 12000)" })),
});

const LspParams = Type.Object({
        action: StringEnum(["status", "diagnostics", "hover", "definition", "references", "symbols"] as const),
        file: Type.Optional(Type.String({ description: "File path (absolute or cwd-relative)" })),
        line: Type.Optional(Type.Number({ description: "1-based line number (for hover/definition/references)" })),
        symbol: Type.Optional(
                Type.String({ description: "Symbol on that line to look at (default: first word on the line)" }),
        ),
        all: Type.Optional(Type.Boolean({ description: "diagnostics: report every open file instead of one" })),
});

export function createUnownToolsExtension(opts: UnownToolsOptions) {
        const verbose = opts.verbose ?? false;
        const isSubagent = opts.isSubagent ?? process.env.UNOWN_SUBAGENT === "1";
        const log = (msg: string) => {
                if (verbose) console.error(`[unown-tools] ${msg}`);
        };

        const factory = (pi: ExtensionAPI) => {
                // ---- todo state (reconstructed from session entries so branching stays correct)
                let todos: Todo[] = [];
                let nextId = 1;

                const reconstructTodos = (ctx: any) => {
                        todos = [];
                        nextId = 1;
                        try {
                                for (const entry of ctx.sessionManager.getBranch()) {
                                        if (entry?.type !== "message") continue;
                                        const msg = entry.message;
                                        if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
                                        const details = msg.details as TodoDetails | undefined;
                                        if (details) {
                                                todos = details.todos;
                                                nextId = details.nextId;
                                        }
                                }
                        } catch {
                                /* session access is best-effort */
                        }
                };

                // ---- plan-mode state
                let planModeEnabled = false;
                let executionMode = false;
                let planItems: PlanStep[] = [];
                let toolsBeforePlanMode: string[] | undefined;

                // ---- goal state (zcode Goal Mode / muse goals port — see goal.ts)
                let goal: GoalState | null = null;
                const persistGoal = () => {
                        try {
                                pi.appendEntry("unown-goal", goal);
                        } catch {
                                /* persistence is best-effort */
                        }
                };

                const uniqueTools = (names: string[]) => [...new Set(names)];
                const planModeTools = (active: string[]) =>
                        uniqueTools([...active.filter((n) => !PLAN_MODE_DISABLED_TOOLS.has(n)), ...PLAN_MODE_TOOLS]);
                const normalTools = (active: string[]) =>
                        uniqueTools([...active.filter((n) => !PLAN_MANAGED_TOOLS.has(n)), "read", "bash", "edit", "write"]);

                const enablePlanTools = () => {
                        if (toolsBeforePlanMode === undefined) toolsBeforePlanMode = pi.getActiveTools();
                        pi.setActiveTools(planModeTools(toolsBeforePlanMode));
                };
                const restoreNormalTools = () => {
                        pi.setActiveTools(toolsBeforePlanMode ?? normalTools(pi.getActiveTools()));
                        toolsBeforePlanMode = undefined;
                };

                const updateStatus = (ctx: any) => {
                        if (!ctx?.hasUI) return;
                        if (executionMode && planItems.length > 0) {
                                const completed = planItems.filter((t) => t.completed).length;
                                ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `plan ${completed}/${planItems.length}`));
                                ctx.ui.setWidget(
                                        "plan-steps",
                                        planItems.map((item) =>
                                                item.completed
                                                        ? ctx.ui.theme.fg("success", "[x] ") + ctx.ui.theme.fg("muted", item.text)
                                                        : ctx.ui.theme.fg("muted", `[ ] ${item.text}`),
                                        ),
                                );
                        } else if (planModeEnabled) {
                                ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "PLAN"));
                                ctx.ui.setWidget("plan-steps", undefined);
                        } else {
                                ctx.ui.setStatus("plan-mode", undefined);
                                ctx.ui.setWidget("plan-steps", undefined);
                        }
                };

                const persistPlanState = () => {
                        try {
                                pi.appendEntry("unown-plan-mode", {
                                        enabled: planModeEnabled,
                                        steps: planItems,
                                        executing: executionMode,
                                        toolsBeforePlanMode,
                                });
                        } catch {
                                /* persistence is best-effort */
                        }
                };

                const togglePlanMode = (ctx: any) => {
                        planModeEnabled = !planModeEnabled;
                        executionMode = false;
                        planItems = [];
                        if (planModeEnabled) {
                                enablePlanTools();
                                ctx.ui.notify(
                                        "Plan mode ON — write tools disabled, bash allowlisted. Explore, then produce a numbered Plan.",
                                );
                        } else {
                                restoreNormalTools();
                                ctx.ui.notify("Plan mode OFF — full tool access restored.");
                        }
                        updateStatus(ctx);
                        persistPlanState();
                };

                // -------------------------------------------------------------------
                // Tools
                // -------------------------------------------------------------------

                pi.registerTool({
                        name: "todo",
                        label: "Todo",
                        description:
                                "Manage a visible todo list so multi-step work stays on track. Actions: list, add (text), toggle (id), clear. Update the list as you go; the user sees it live.",
                        parameters: TodoParams,
                        async execute(_toolCallId, params) {
                                let details: TodoDetails;
                                let text: string;
                                switch (params.action) {
                                        case "list":
                                                text = todos.length
                                                        ? todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
                                                        : "No todos";
                                                details = { action: "list", todos: [...todos], nextId };
                                                break;
                                        case "add": {
                                                if (!params.text) {
                                                        text = "Error: text required for add";
                                                        details = { action: "add", todos: [...todos], nextId, error: "text required" };
                                                        break;
                                                }
                                                const todo: Todo = { id: nextId++, text: params.text, done: false };
                                                todos.push(todo);
                                                text = `Added todo #${todo.id}: ${todo.text}`;
                                                details = { action: "add", todos: [...todos], nextId };
                                                break;
                                        }
                                        case "toggle": {
                                                const todo = todos.find((t) => t.id === params.id);
                                                if (!todo) {
                                                        text = `Todo #${params.id} not found`;
                                                        details = { action: "toggle", todos: [...todos], nextId, error: `#${params.id} not found` };
                                                        break;
                                                }
                                                todo.done = !todo.done;
                                                text = `Todo #${todo.id} ${todo.done ? "completed" : "reopened"}`;
                                                details = { action: "toggle", todos: [...todos], nextId };
                                                break;
                                        }
                                        case "clear": {
                                                const count = todos.length;
                                                todos = [];
                                                nextId = 1;
                                                text = `Cleared ${count} todos`;
                                                details = { action: "clear", todos: [], nextId: 1 };
                                                break;
                                        }
                                }
                                return { content: [{ type: "text", text }], details };
                        },
                        renderCall(args: any, theme: any) {
                                let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
                                if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
                                if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
                                return new Text(text, 0, 0);
                        },
                        renderResult(result: any, { expanded }: any, theme: any) {
                                const details = result.details as TodoDetails | undefined;
                                if (!details) return new Text("", 0, 0);
                                if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
                                if (details.todos.length === 0) return new Text(theme.fg("dim", "No todos"), 0, 0);
                                const display = expanded ? details.todos : details.todos.slice(0, 5);
                                let listText = theme.fg(
                                        "muted",
                                        `${details.todos.filter((t) => t.done).length}/${details.todos.length} done:`,
                                );
                                for (const t of display) {
                                        const check = t.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
                                        listText += `\n${check} ${theme.fg("accent", `#${t.id}`)} ${t.done ? theme.fg("dim", t.text) : theme.fg("muted", t.text)}`;
                                }
                                if (!expanded && details.todos.length > 5) {
                                        listText += `\n${theme.fg("dim", `... ${details.todos.length - 5} more`)}`;
                                }
                                return new Text(listText, 0, 0);
                        },
                });

                pi.registerTool({
                        name: "note",
                        label: "Note",
                        description:
                                "Record a durable learning note mid-session. Delivered to the self-learning engine now (or queued in the outbox if it is down); AutoDream consolidates notes into this project's memory. Use the moment you learn a pitfall, convention, or decision worth remembering — do not wait for session end.",
                        parameters: NoteParams,
                        async execute(_toolCallId, params) {
                                const noteText = params.text.trim();
                                if (!noteText) return { content: [{ type: "text", text: "Error: empty note" }] };
                                const result = await deliverTerminalNote({ content: noteText, projectPath: opts.cwd, ts: Date.now() });
                                const text = result.delivered
                                        ? "Note delivered to the self-learning engine."
                                        : `Engine unreachable — note queued in the outbox (${result.detail ?? "offline"}) and will sync later.`;
                                log(`note ${result.delivered ? "delivered" : "queued"}: ${noteText.slice(0, 80)}`);
                                return { content: [{ type: "text", text }] };
                        },
                        renderCall(args: any, theme: any) {
                                return new Text(
                                        theme.fg("toolTitle", theme.bold("note ")) +
                                                theme.fg("dim", `"${String(args.text ?? "").slice(0, 60)}"`),
                                        0,
                                        0,
                                );
                        },
                        renderResult(result: any, _opts: any, theme: any) {
                                const block = result.content?.[0];
                                return new Text(
                                        theme.fg("success", "✓ ") + theme.fg("muted", block?.type === "text" ? block.text : ""),
                                        0,
                                        0,
                                );
                        },
                });

                if (!isSubagent) {
                        pi.registerTool({
                                name: "task",
                                label: "Task",
                                description:
                                        "Launch a unown subagent with a FRESH context window to work on a self-contained task (research, exploration, or implementation). The subagent does not see this conversation and cannot spawn further subagents; it returns a concise report. Agents: 'general' (full tools, default) and 'explore' (read-only) plus any defined in .unown/agents/*.md. Pass {tasks: [...]} to run up to 4 in parallel. Set worktree_isolation: true to give a writing subagent its own git worktree (parallel writers never collide; kept trees are reported for merge). Set output_schema to a JSON Schema the subagent's final reply must satisfy (typed fan-out: invalid replies are retried with the exact defects quoted back). Prefer this whenever a focused investigation would pollute this session's context.",
                                parameters: TaskParams,
                                async execute(_toolCallId, params, signal) {
                                        const agents = discoverSubagents(opts.cwd);
                                        // Job = normalized spawn request (single form + batch form).
                                        const jobs = params.tasks
                                                ? params.tasks.slice(0, 4).map((t: any) => ({
                                                                agent: t.agent ?? "general",
                                                                task: t.task as string,
                                                                worktreeIsolation: t.worktree_isolation === true || params.worktree_isolation === true,
                                                                outputSchema: t.output_schema ?? undefined,
                                                                schemaMode: t.schema_mode ?? params.schema_mode,
                                                        }))
                                                : [
                                                                {
                                                                        agent: params.agent ?? "general",
                                                                        task: params.task ?? "",
                                                                        worktreeIsolation: params.worktree_isolation === true,
                                                                        outputSchema: params.output_schema ?? undefined,
                                                                        schemaMode: params.schema_mode,
                                                                },
                                                        ];
                                        if (jobs.length === 0 || jobs.some((j) => !j.task.trim())) {
                                                return {
                                                        content: [
                                                                { type: "text", text: "Error: provide task (or tasks[]) — each needs a non-empty task string" },
                                                        ],
                                                };
                                        }
                                        // Malformed schemas fail HERE — before any paid spawn (omp: invalid
                                        // caller schemas fail preflight).
                                        for (const job of jobs) {
                                                if (job.outputSchema === undefined) continue;
                                                const shape = checkSchemaShape(job.outputSchema);
                                                if (!shape.ok) {
                                                        return {
                                                                content: [
                                                                        { type: "text", text: `Error: output_schema is not a usable JSON Schema — ${shape.error}` },
                                                                ],
                                                        };
                                                }
                                        }
                                        const sections: string[] = new Array(jobs.length).fill("");
                                        const runs: TaskRunDetails["runs"] = [];
                                        const maxConcurrency = 4;
                                        const queue = jobs.map((job, index) => ({ job, index }));
                                        const workers = Array.from({ length: Math.min(maxConcurrency, queue.length) }, async () => {
                                                while (queue.length > 0) {
                                                        const next = queue.shift();
                                                        if (!next) break;
                                                        const { job, index } = next;
                                                        const agent = agents.find((a) => a.name === job.agent);
                                                        if (!agent) {
                                                                const available = agents.map((a) => `"${a.name}"`).join(", ");
                                                                sections[index] =
                                                                        `## ${job.agent}: FAILED\nUnknown agent "${job.agent}". Available: ${available}.`;
                                                                runs.push({ agent: job.agent, task: job.task, exitCode: 1, turns: 0, toolResults: 0 });
                                                                continue;
                                                        }
                                                        // ---- worktree isolation (muse fan-out port): opt-in,
                                                        // fail-closed — a rejected tree is a typed failure, never
                                                        // a silent fallback to the shared checkout.
                                                        let tree: WorktreeHandle | null = null;
                                                        let treeNote = "";
                                                        let treeFailure = "";
                                                        if (job.worktreeIsolation) {
                                                                const childId = `${agent.name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                                                                const created = await createWorktree(opts.cwd, childId);
                                                                if (created.ok) {
                                                                        tree = created.handle;
                                                                        log(`subagent ${agent.name} isolated in worktree ${tree.path}`);
                                                                } else {
                                                                        treeFailure = `worktree isolation REJECTED (${created.reason}): ${created.detail} — the subagent was NOT run in the shared tree; retry without worktree_isolation or fix the cause.`;
                                                                        runs.push({
                                                                                agent: agent.name,
                                                                                task: job.task,
                                                                                exitCode: 1,
                                                                                turns: 0,
                                                                                toolResults: 0,
                                                                                worktree: { action: "rejected", detail: treeFailure },
                                                                        });
                                                                        sections[index] = `## ${agent.name}: FAILED\n${treeFailure}`;
                                                                        continue;
                                                                }
                                                        }
                                                        log(`spawning subagent ${agent.name}`);
                                                        const result = await runSubagent(agent, job.task, tree ? tree.path : opts.cwd, signal, {
                                                                outputSchema: job.outputSchema,
                                                                schemaMode: job.schemaMode,
                                                        });
                                                        const run: TaskRunDetails["runs"][number] = {
                                                                agent: agent.name,
                                                                task: job.task,
                                                                exitCode: result.exitCode,
                                                                turns: result.usage.turns,
                                                                toolResults: result.toolResults,
                                                        };
                                                        // ---- worktree disposition: cleanup per remove_if_clean; kept
                                                        // trees carry the path for merge (nothing merges automatically).
                                                        if (tree) {
                                                                const cleanup = await cleanupWorktree(tree);
                                                                run.worktree = {
                                                                        action: cleanup.action,
                                                                        path: tree.path,
                                                                        detail: cleanup.detail,
                                                                };
                                                                treeNote = `\n\n[worktree ${cleanup.action}] ${cleanup.detail}`;
                                                        }
                                                        // ---- structured-output verdict (omp schemaMode semantics).
                                                        if (result.structured) {
                                                                run.structured = { ok: result.structured.ok, error: result.structured.error };
                                                        }
                                                        runs.push(run);
                                                        const header =
                                                                `## ${agent.name} (${result.exitCode === 0 ? "ok" : `exit ${result.exitCode}`}; ` +
                                                                `${result.usage.turns} turns, ${formatTokens(result.usage.input)} in / ${formatTokens(result.usage.output)} out, ` +
                                                                `${result.toolResults} tool calls)`;
                                                        const parts: string[] = [];
                                                        if (result.structured) {
                                                                if (result.structured.ok) {
                                                                        // The validated JSON IS the report — the parent asked for
                                                                        // structured data; print it as the body.
                                                                        parts.push("```json\n" + JSON.stringify(result.structured.data, null, 2) + "\n```");
                                                                } else {
                                                                        const strict = job.schemaMode === "strict";
                                                                        parts.push(
                                                                                strict
                                                                                        ? `**STRUCTURED OUTPUT FAILED (strict): ${result.structured.error}**`
                                                                                        : `**warning: structured output invalid (permissive): ${result.structured.error}** — raw reply follows`,
                                                                        );
                                                                        if (result.output.trim()) parts.push(result.output.trim());
                                                                }
                                                        } else {
                                                                const body =
                                                                        result.output.trim() ||
                                                                        (result.stderr.trim()
                                                                                ? `(no output; stderr: ${result.stderr.trim().slice(0, 500)})`
                                                                                : "(no output)");
                                                                parts.push(body);
                                                        }
                                                        sections[index] = `${header}${treeNote}\n\n${parts.join("\n\n")}`;
                                                }
                                        });
                                        await Promise.all(workers);
                                        const details: TaskRunDetails = { runs };
                                        return { content: [{ type: "text", text: sections.filter(Boolean).join("\n\n---\n\n") }], details };
                                },
                                renderCall(args: any, theme: any) {
                                        if (args.tasks) {
                                                const isolated = args.tasks.filter((t: any) => t?.worktree_isolation === true).length;
                                                const structured = args.tasks.filter((t: any) => t?.output_schema !== undefined).length;
                                                return new Text(
                                                        theme.fg("toolTitle", theme.bold("task ")) +
                                                                theme.fg("muted", `${args.tasks.length} subagents in parallel`) +
                                                                (isolated ? theme.fg("accent", ` · ${isolated} worktree`) : "") +
                                                                (structured ? theme.fg("accent", ` · ${structured} schema`) : ""),
                                                        0,
                                                        0,
                                                );
                                        }
                                        return new Text(
                                                theme.fg("toolTitle", theme.bold("task → ")) +
                                                        theme.fg("accent", String(args.agent ?? "general")) +
                                                        (args.worktree_isolation === true ? theme.fg("accent", " [worktree]") : "") +
                                                        (args.output_schema !== undefined ? theme.fg("accent", " [schema]") : "") +
                                                        theme.fg("dim", ` "${String(args.task ?? "").slice(0, 50)}"`),
                                                0,
                                                0,
                                        );
                                },
                                renderResult(result: any, _o: any, theme: any) {
                                        const details = result.details as TaskRunDetails | undefined;
                                        if (!details) return new Text(theme.fg("dim", "subagent finished"), 0, 0);
                                        const summary = details.runs
                                                .map((r) => {
                                                        const mark = r.exitCode === 0 ? (r.structured && !r.structured.ok ? "~" : "✓") : "✗";
                                                        const tree = r.worktree ? ` [${r.worktree.action}]` : "";
                                                        return `${r.agent}: ${mark} ${r.turns} turns, ${r.toolResults} tools${tree}`;
                                                })
                                                .join("\n");
                                        return new Text(theme.fg("muted", summary), 0, 0);
                                },
                        });
                }

                // -------------------------------------------------------------------
                // Automations (zcode port) — scheduled recurring agent runs.
                // Trust story: config lives in the ENGINE's DB (never in repo
                // files); default mode is read-only; automation runs carry
                // UNOWN_AUTOMATION=1 which HIDES the mutation tools inside a
                // run (zcode's turn-scoped denylist — List stays available).
                // -------------------------------------------------------------------
                const isAutomationRun = /^(1|true)$/i.test(process.env.UNOWN_AUTOMATION ?? "");
                const engineApi = async (
                        method: string,
                        path: string,
                        body?: unknown,
                ): Promise<{ ok: boolean; status: number; data: any }> => {
                        try {
                                const res = await fetch(`${ENGINE_URL}${path}`, {
                                        method,
                                        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
                                        body: body !== undefined ? JSON.stringify(body) : undefined,
                                        signal: AbortSignal.timeout(8000),
                                });
                                const data = (await res.json().catch(() => ({}))) as any;
                                return { ok: res.ok, status: res.status, data };
                        } catch {
                                return {
                                        ok: false,
                                        status: 0,
                                        data: { error: `the self-learning engine is not reachable at ${ENGINE_URL} — automations need the stack running (bun run agent:start)` },
                                };
                        }
                };
                const ENGINE_DOWN_HINT =
                        "the self-learning engine is not reachable — automations need the stack running (bun run agent:start); this session's chat is unaffected";

                const AutomationListParams = Type.Object({}, { description: "List the project's scheduled automations (needs the engine running)." });
                const AutomationCreateParams = Type.Object({
                        title: Type.String({
                                description: "Short title preserving the user's scheduling phrase verbatim (e.g. 'weekday 9am dev brief')",
                        }),
                        prompt: Type.String({
                                description:
                                        "The unattended task to run on schedule, in THIS project. State the expected deliverable explicitly — nobody will answer questions during the run. Describe the final work directly; do NOT ask it to create or schedule other automations.",
                        }),
                        cron: Type.Optional(
                                Type.String({
                                        description: 'Standard 5-field cron expression in the user\'s LOCAL timezone (minute hour day-of-month month day-of-week), e.g. "0 9 * * 1-5". Do not convert to UTC.',
                                }),
                        ),
                        delay_minutes: Type.Optional(
                                Type.Number({ description: "One-shot alternative to cron: run once after N minutes (1..525600). Pass either cron or delay_minutes, not both." }),
                        ),
                        mode: Type.Optional(
                                StringEnum(["read-only", "standard"] as const, {
                                        description:
                                                'Permission for the unattended run: "read-only" (default — the run gets read/grep/find/ls/lsp/fetch_url tools only, no shell or writes) or "standard" (the full session toolset; choose deliberately).',
                                }),
                        ),
                        max_runs: Type.Optional(Type.Number({ description: "Stop after N scheduled runs (optional; manual runs never consume the budget)" })),
                });
                const AutomationUpdateParams = Type.Object({
                        id: Type.String({ description: "Automation id from automation_list" }),
                        title: Type.Optional(Type.String({ description: "Re-synced title" })),
                        prompt: Type.Optional(Type.String()),
                        cron: Type.Optional(Type.String({ description: "New 5-field cron (local timezone)" })),
                        mode: Type.Optional(StringEnum(["read-only", "standard"] as const)),
                        lifecycle: Type.Optional(StringEnum(["active", "paused"] as const, { description: "Pause/resume the schedule" })),
                });
                const AutomationDeleteParams = Type.Object({ id: Type.String({ description: "Automation id from automation_list" }) });

                pi.registerTool({
                        name: "automation_list",
                        label: "Automations",
                        description:
                                "List this project's scheduled automations (recurring agent runs managed by the self-learning engine): id, title, schedule, next run, last outcome, lifecycle. Automations run unattended while the engine is up; a read-only automation reports on the repo without changing it.",
                        parameters: AutomationListParams,
                        async execute() {
                                const res = await engineApi("GET", "/api/automations");
                                if (!res.ok) return { content: [{ type: "text", text: `Error: ${res.data?.error ?? ENGINE_DOWN_HINT}` }] };
                                const mine = (res.data.automations ?? []).filter(
                                        (a: any) => a?.workspace === opts.cwd || a?.workspace === resolve(opts.cwd),
                                );
                                if (mine.length === 0) {
                                        return { content: [{ type: "text", text: "No automations in this project. Create one with automation_create (or `unown automations create`)." }] };
                                }
                                const lines = mine.map(
                                        (a: any) =>
                                                `${a.id} · ${a.title}\n  schedule: ${a.schedule ?? a.cron_expr ?? "one-shot"} · mode: ${a.mode} · ${a.lifecycle}${a.next_run_at ? `\n  next run: ${new Date(a.next_run_at).toLocaleString()}` : ""}${a.lastRun ? `\n  last run: ${a.lastRun.status} at ${new Date(a.lastRun.started_at).toLocaleString()}` : ""}`,
                                );
                                return { content: [{ type: "text", text: lines.join("\n\n") }] };
                        },
                        renderCall(_a: any, theme: any) {
                                return new Text(theme.fg("toolTitle", theme.bold("automations")), 0, 0);
                        },
                        renderResult(result: any, _o: any, theme: any) {
                                const text = result?.content?.[0]?.text ?? "";
                                return new Text(theme.fg("muted", text.split("\n")[0].slice(0, 80)), 0, 0);
                        },
                });

                if (!isSubagent && !isAutomationRun) {
                        pi.registerTool({
                                name: "automation_create",
                                label: "Automation+",
                                description:
                                        'Create a scheduled automation that runs an unattended agent in THIS project on a cron schedule (local timezone) or once after a delay. Default mode is read-only (the run reports on the repo; no shell, no writes) — "standard" grants the full toolset and must be chosen deliberately. The user should commit pending work before creating a standard automation. Do not create automations the user did not ask for.',
                                parameters: AutomationCreateParams,
                                async execute(_toolCallId, params) {
                                        const res = await engineApi("POST", "/api/automations", {
                                                title: params.title,
                                                prompt: params.prompt,
                                                workspace: opts.cwd,
                                                cron: params.cron,
                                                delayMinutes: params.delay_minutes,
                                                mode: params.mode ?? "read-only",
                                                maxRuns: params.max_runs ?? null,
                                        });
                                        if (!res.ok) return { content: [{ type: "text", text: `Error: ${res.data?.error ?? ENGINE_DOWN_HINT}` }] };
                                        const a = res.data.automation;
                                        const when = a.next_run_at ? `next run ${new Date(a.next_run_at).toLocaleString()}` : "scheduled";
                                        return {
                                                content: [
                                                        {
                                                                type: "text",
                                                                text: `Created automation ${a.id} ("${a.title}") — ${a.cron_expr ? `cron ${a.cron_expr} (${a.schedule})` : "one-shot"} · mode ${a.mode} · ${when}. Runs are recorded; use automation_list or \`unown automations history ${a.id}\` to inspect.`,
                                                        },
                                                ],
                                        };
                                },
                                renderCall(args: any, theme: any) {
                                        return new Text(theme.fg("toolTitle", theme.bold("automation+ ")) + theme.fg("accent", String(args?.cron ?? "once")), 0, 0);
                                },
                        });
                        pi.registerTool({
                                name: "automation_update",
                                label: "Automation~",
                                description:
                                        "Update an automation (title, prompt, cron, mode) or pause/resume it. A completed (exhausted) automation is terminal — create a new one instead. Editing the schedule re-arms the next run from now.",
                                parameters: AutomationUpdateParams,
                                async execute(_toolCallId, params) {
                                        const patch: Record<string, unknown> = {};
                                        for (const key of ["title", "prompt", "cron", "mode"] as const) {
                                                if ((params as any)[key] !== undefined) patch[key] = (params as any)[key];
                                        }
                                        if (params.lifecycle !== undefined) patch.lifecycle = params.lifecycle;
                                        const res = await engineApi("PATCH", `/api/automations/${encodeURIComponent(params.id)}`, patch);
                                        if (!res.ok) return { content: [{ type: "text", text: `Error: ${res.data?.error ?? ENGINE_DOWN_HINT}` }] };
                                        const a = res.data.automation;
                                        return { content: [{ type: "text", text: `Updated ${a.id}: ${a.lifecycle}${a.next_run_at ? `, next run ${new Date(a.next_run_at).toLocaleString()}` : ""}.` }] };
                                },
                                renderCall(args: any, theme: any) {
                                        return new Text(theme.fg("toolTitle", theme.bold("automation~ ")) + theme.fg("muted", String(args?.id ?? "")), 0, 0);
                                },
                        });
                        pi.registerTool({
                                name: "automation_delete",
                                label: "Automation-",
                                description: "Delete an automation and its non-running run history. This cannot be undone — confirm with the user first when the request is ambiguous.",
                                parameters: AutomationDeleteParams,
                                async execute(_toolCallId, params) {
                                        const res = await engineApi("DELETE", `/api/automations/${encodeURIComponent(params.id)}`);
                                        if (!res.ok) return { content: [{ type: "text", text: `Error: ${res.data?.error ?? ENGINE_DOWN_HINT}` }] };
                                        return { content: [{ type: "text", text: `Deleted automation ${params.id}.` }] };
                                },
                                renderCall(args: any, theme: any) {
                                        return new Text(theme.fg("toolTitle", theme.bold("automation- ")) + theme.fg("muted", String(args?.id ?? "")), 0, 0);
                                },
                        });
                }

                pi.registerTool({
                        name: "fetch_url",
                        label: "Fetch",
                        description:
                                "Fetch an http(s) URL with GET and return the page/document as text (HTML stripped, capped). Hardened: private-address SSRF guard, robots-aware, with an extraction fallback chain for sites that block plain clients. Prefer web_search when you don't have a URL yet; prefer webfetch for the same pipeline with a larger default cap.",
                        parameters: FetchParams,
                        async execute(_toolCallId, params) {
                                const maxChars = Math.min(Math.max(params.max_chars ?? 12_000, 500), 60_000);
                                try {
                                        const text = await fetchUrlText(params.url, maxChars);
                                        return { content: [{ type: "text", text }] };
                                } catch (err: any) {
                                        return {
                                                content: [{ type: "text", text: `fetch_url failed: ${err?.message ?? String(err)}` }],
                                                isError: true,
                                        };
                                }
                        },
                        renderCall(args: any, theme: any) {
                                return new Text(
                                        theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("dim", String(args.url ?? "").slice(0, 70)),
                                        0,
                                        0,
                                );
                        },
                });

                // -------------------------------------------------------------------
                // web_search + webfetch (see websearch.ts — the provider registry)
                // -------------------------------------------------------------------

                registerWebTools(pi, { verbose });

                // -------------------------------------------------------------------
                // LSP code intelligence (oh-my-pi port — see src/lsp.ts)
                // -------------------------------------------------------------------

                let lspManager: LspManager | null = null;
                let lspExitHooked = false;
                const getLsp = (): LspManager => {
                        if (!lspManager) {
                                lspManager = new LspManager({ cwd: opts.cwd, config: resolveLspConfig(opts.cwd) });
                                // Safety net for hard exits: language servers must not outlive
                                // us. Registered once — /lsp trust rebuilds the manager and this
                                // closure always reads the CURRENT lspManager.
                                if (!lspExitHooked) {
                                        lspExitHooked = true;
                                        process.once("exit", () => lspManager?.disposeAll());
                                }
                        }
                        return lspManager;
                };
                const resolveFile = (p: string): string => (isAbsolute(p) ? p : join(opts.cwd, p));

                // ---- LSP footer line (P1-b): "lsp: ts,py ready" once servers
                // are live, "lsp: ts (restarting)" while a crashed server sits
                // in its cooldown, "lsp: ts paused" once restarts are
                // exhausted. Updates are TRANSITION-ONLY: composing the line
                // from manager.status() is cheap, but every setStatus call
                // repaints the shared footer row (R-c budget discipline).
                let lspFooter: string | null | undefined; // undefined = never rendered
                const lspStatusLine = (m: LspManager): string | null => {
                        const s = m.status();
                        const running = s.servers.filter((e) => e.state === "running").map((e) => e.language);
                        if (running.length > 0) return `lsp: ${running.join(",")} ready`;
                        const crashed = s.servers.filter((e) => e.state === "crashed");
                        if (crashed.length > 0) {
                                const exhausted = crashed.some((e) => e.detail?.includes("restarts exhausted"));
                                return `lsp: ${crashed.map((e) => e.language).join(",")}${exhausted ? " paused" : " (restarting)"}`;
                        }
                        return null;
                };
                const refreshLspFooter = (ctx: any) => {
                        try {
                                if (!lspManager) return;
                                const line = lspStatusLine(lspManager);
                                if (lspFooter !== undefined && line === lspFooter) return; // no transition
                                lspFooter = line;
                                setStatusLine(ctx, "lsp", line ?? undefined);
                        } catch {
                                /* never break the edit path for a cosmetic line */
                        }
                };

                pi.registerTool({
                        name: "lsp",
                        label: "LSP",
                        description:
                                "Language-server code intelligence: compiler/type diagnostics, hover info, go-to-definition, find-references and document symbols. Actions: status, diagnostics (file or all), hover/definition/references (file+line+symbol), symbols (file). Auto-detects language servers on PATH (typescript-language-server, pyright, gopls, rust-analyzer, clangd...); configure or override via .unown/lsp.json. Use after edits to catch type errors, and to navigate symbols instead of grepping.",
                        parameters: LspParams,
                        async execute(_toolCallId, params) {
                                const manager = getLsp();
                                if (manager.disabled) {
                                        return {
                                                content: [{ type: "text", text: "LSP support is disabled (UNOWN_LSP=0 or disabled in lsp.json)." }],
                                        };
                                }
                                try {
                                        switch (params.action) {
                                                case "status": {
                                                        const s = manager.status();
                                                        const servers = s.servers.length
                                                                ? s.servers
                                                                                .map((e) => {
                                                                                        const mark = e.state === "running" ? "●" : e.state === "crashed" ? "✗" : "○";
                                                                                        const state =
                                                                                                e.state === "running"
                                                                                                        ? " (running)"
                                                                                                        : e.state === "crashed"
                                                                                                                ? ` (crashed${e.crashCount ? ` ${e.crashCount}×` : ""})`
                                                                                                                : " (available)";
                                                                                        return `  ${mark} ${e.language}: ${e.command}${state}`;
                                                                                })
                                                                                .join("\n")
                                                                : "  (no language servers detected on PATH — configure .unown/lsp.json)";
                                                        // H2 trust gate: the agent sees the withheld state and the
                                                        // approval action (/lsp trust), not silence.
                                                        const guidance = s.needsTrust && s.trustGuidance ? `\n  ⚠ ${s.trustGuidance}` : "";
                                                        const text = `LSP status:\n${servers}${guidance}\n  open documents: ${s.openDocs}\n  cached diagnostics: ${s.diagnostics}`;
                                                        return { content: [{ type: "text", text }] };
                                                }
                                                case "diagnostics": {
                                                        if (params.all) {
                                                                const all = manager.allDiagnostics();
                                                                if (all.length === 0) {
                                                                        return {
                                                                                content: [
                                                                                        {
                                                                                                type: "text",
                                                                                                text: "No diagnostics cached yet — open/query files first (hover, symbols, or an edit).",
                                                                                        },
                                                                                ],
                                                                        };
                                                                }
                                                                const parts = all.map((d) => renderDiagnostics(d.path, d.items, 30));
                                                                return { content: [{ type: "text", text: parts.join("\n\n") }] };
                                                        }
                                                        if (!params.file) {
                                                                return { content: [{ type: "text", text: "Error: file required for diagnostics" }] };
                                                        }
                                                        const path = resolveFile(params.file);
                                                        const language = languageFromPath(path);
                                                        if (!language || !manager.serverCommandFor(language)) {
                                                                return {
                                                                        content: [
                                                                                {
                                                                                        type: "text",
                                                                                        text: `No language server available for ${path}${language ? ` (${language})` : ""}. Install one on PATH (typescript-language-server, pyright, gopls, rust-analyzer, clangd, ...) or configure .unown/lsp.json.`,
                                                                                },
                                                                        ],
                                                                };
                                                        }
                                                        const syncTs = Date.now();
                                                        const conn = await manager.syncDocument(path);
                                                        const items = conn
                                                                ? await manager.waitForFreshDiagnostics(path, syncTs)
                                                                : (manager.diagnosticsFor(path)?.items ?? []);
                                                        return {
                                                                content: [{ type: "text", text: renderDiagnostics(path, items) }],
                                                                details: { action: "diagnostics", file: path, errors: countErrors(items), total: items.length },
                                                        };
                                                }
                                                case "hover":
                                                case "definition":
                                                case "references": {
                                                        if (!params.file || !params.line) {
                                                                return {
                                                                        content: [{ type: "text", text: `Error: file and line required for ${params.action}` }],
                                                                };
                                                        }
                                                        const path = resolveFile(params.file);
                                                        const line1 = Math.max(1, Math.floor(params.line));
                                                        const lineText = readLineText(path, line1);
                                                        const character = characterForLine(lineText, params.symbol);
                                                        if (params.action === "hover") {
                                                                const hover = await manager.hover(path, line1 - 1, character);
                                                                return {
                                                                        content: [
                                                                                {
                                                                                        type: "text",
                                                                                        text: hover ?? `No hover information at ${path}:${line1}.`,
                                                                                },
                                                                        ],
                                                                };
                                                        }
                                                        const locations =
                                                                params.action === "definition"
                                                                        ? await manager.definition(path, line1 - 1, character)
                                                                        : await manager.references(path, line1 - 1, character);
                                                        return {
                                                                content: [{ type: "text", text: renderLocations(locations) }],
                                                                details: { action: params.action, file: path, line: line1, count: locations.length },
                                                        };
                                                }
                                                case "symbols": {
                                                        if (!params.file) {
                                                                return { content: [{ type: "text", text: "Error: file required for symbols" }] };
                                                        }
                                                        const path = resolveFile(params.file);
                                                        const symbols = await manager.symbols(path);
                                                        if (symbols.length === 0) {
                                                                return {
                                                                        content: [
                                                                                {
                                                                                        type: "text",
                                                                                        text: `No symbols returned for ${path} (no language server, or the file has none).`,
                                                                                },
                                                                        ],
                                                                };
                                                        }
                                                        const text = symbols
                                                                .slice(0, 80)
                                                                .map((s) => `${path}:${s.line + 1}  ${s.name}${s.container ? ` (in ${s.container})` : ""}`)
                                                                .join("\n");
                                                        return {
                                                                content: [{ type: "text", text }],
                                                                details: { action: "symbols", file: path, count: symbols.length },
                                                        };
                                                }
                                        }
                                        return { content: [{ type: "text", text: `Error: unknown action ${params.action}` }] };
                                } catch (err: any) {
                                        return {
                                                content: [{ type: "text", text: `lsp ${params.action} failed: ${err?.message ?? String(err)}` }],
                                                isError: true,
                                        };
                                }
                        },
                        renderCall(args: any, theme: any) {
                                return new Text(
                                        theme.fg("toolTitle", theme.bold("lsp ")) +
                                                theme.fg("accent", String(args.action ?? "")) +
                                                (args.file
                                                        ? theme.fg("dim", ` ${String(args.file).slice(0, 60)}${args.line ? ":" + args.line : ""}`)
                                                        : ""),
                                        0,
                                        0,
                                );
                        },
                        renderResult(result: any, _o: any, theme: any) {
                                const block = result?.content?.[0];
                                const text = block?.type === "text" ? block.text : "";
                                const first = text.split("\n")[0] ?? "";
                                return new Text(theme.fg("muted", first.slice(0, 100)), 0, 0);
                        },
                });

                // -------------------------------------------------------------------
                // Commands
                // -------------------------------------------------------------------

                pi.registerCommand("plan", {
                        description: "Toggle plan mode (read-only exploration → numbered plan → execute)",
                        handler: async (_args, ctx) => togglePlanMode(ctx),
                });

                pi.registerShortcut(Key.ctrlAlt("p"), {
                        description: "Toggle plan mode",
                        handler: async (ctx) => togglePlanMode(ctx),
                });

                pi.registerCommand("todos", {
                        description: "Show the session todo list",
                        handler: async (_args, ctx) => {
                                if (todos.length === 0) {
                                        ctx.ui.notify("No todos yet — ask the agent to track its work with the todo tool.", "info");
                                        return;
                                }
                                const list = todos.map((t) => `${t.done ? "✓" : "○"} #${t.id} ${t.text}`).join("\n");
                                const done = todos.filter((t) => t.done).length;
                                ctx.ui.notify(`Todos (${done}/${todos.length} done):\n${list}`, "info");
                        },
                });

                pi.registerCommand("note", {
                        description: "Deliver a learning note to the self-learning engine: /note <text>",
                        handler: async (args, ctx) => {
                                const text = (args ?? "").trim();
                                if (!text) {
                                        ctx.ui.notify("Usage: /note <something worth remembering>", "info");
                                        return;
                                }
                                const result = await deliverTerminalNote({ content: text, projectPath: opts.cwd, ts: Date.now() });
                                ctx.ui.notify(
                                        result.delivered
                                                ? "Note delivered to the engine."
                                                : `Note queued in outbox (${result.detail ?? "engine offline"}).`,
                                        result.delivered ? "info" : "warning",
                                );
                        },
                });

                pi.registerCommand("agents", {
                        description: "List available subagents (built-ins + .unown/agents/*.md)",
                        handler: async (_args, ctx) => {
                                const agents = discoverSubagents(opts.cwd);
                                const list = agents
                                        .map((a) => `${a.name} (${a.source})${a.tools ? ` [${a.tools.join(",")}]` : ""}: ${a.description}`)
                                        .join("\n");
                                ctx.ui.notify(list, "info");
                        },
                });

                pi.registerCommand("learning", {
                        description: "Show the effective 4-tier memory stack (fresh read from disk)",
                        handler: async (_args, ctx) => {
                                const files = resolveTerminalMemory(opts.cwd);
                                const parts = files.map((f) => {
                                        const lines = f.content.trimEnd().split("\n");
                                        const shown =
                                                lines.slice(0, 60).join("\n") + (lines.length > 60 ? `\n… (${lines.length - 60} more lines)` : "");
                                        return `── ${f.tier.toUpperCase()} · ${f.path} ──\n${shown}`;
                                });
                                ctx.ui.notify(parts.join("\n\n"), "info");
                        },
                });

                pi.registerCommand("lsp", {
                        description: "LSP status + trust: /lsp — /lsp trust approves a project .unown/lsp.json",
                        handler: async (args, ctx) => {
                                try {
                                        const sub = ((args ?? "").trim().split(/\s+/)[0] ?? "").toLowerCase();
                                        const manager = getLsp();
                                        if (manager.disabled) {
                                                ctx.ui.notify("LSP support is disabled (UNOWN_LSP=0 or lsp.json).", "info");
                                                return;
                                        }
                                        if (sub === "trust") {
                                                // /lsp trust (P1-b): approve the project lsp.json the
                                                // H2 gate is withholding — same shape as /mcp trust.
                                                const projectFile = join(opts.cwd, ".unown", "lsp.json");
                                                if (!existsSync(projectFile)) {
                                                        ctx.ui.notify("No project .unown/lsp.json found — nothing to trust.", "info");
                                                        return;
                                                }
                                                if (trustBypassed()) {
                                                        ctx.ui.notify("UNOWN_TRUST_PROJECT_CONFIG is set — the trust gate is already bypassed.", "info");
                                                        return;
                                                }
                                                if (!trustProjectLspConfig(opts.cwd)) {
                                                        ctx.ui.notify(
                                                                `Trusting ${projectFile} failed (unreadable file or unwritable trust state).`,
                                                                "error",
                                                        );
                                                        return;
                                                }
                                                log(`trusted ${projectFile}`);
                                                // LspManager snapshots config + trust state at
                                                // construction (no reload seam like McpManager's),
                                                // so rebuild it: dispose the old servers (none may
                                                // leak), then re-resolve with the now-trusted
                                                // project overrides in place.
                                                try {
                                                        manager.disposeAll();
                                                } catch {
                                                        /* best effort */
                                                }
                                                lspManager = null;
                                                ctx.ui.notify(
                                                        `Trusted ${projectFile} — server overrides apply from the next status refresh.`,
                                                        "info",
                                                );
                                                // falls through: the status render below re-resolves
                                        } else if (sub !== "") {
                                                ctx.ui.notify(`Unknown /lsp argument "${sub}". Usage: /lsp [trust]`, "info");
                                                return;
                                        }
                                        const m = getLsp();
                                        const s = m.status();
                                        const servers = s.servers.length
                                                ? s.servers
                                                                .map((e) => {
                                                                        const mark = e.state === "running" ? "●" : e.state === "crashed" ? "✗" : "○";
                                                                        const suffix = e.state === "crashed" && e.detail ? ` (${e.detail})` : "";
                                                                        return `${mark} ${e.language} — ${e.command}${suffix}`;
                                                                })
                                                                .join("\n")
                                                : "no language servers detected on PATH (configure .unown/lsp.json)";
                                        const guidance = s.needsTrust && s.trustGuidance ? `\n⚠ ${s.trustGuidance}` : "";
                                        ctx.ui.notify(
                                                `LSP servers:\n${servers}${guidance}\nopen documents: ${s.openDocs} · cached diagnostics: ${s.diagnostics}`,
                                                "info",
                                        );
                                        refreshLspFooter(ctx);
                                } catch (err: any) {
                                        ctx.ui.notify(`LSP command failed: ${err?.message ?? err}`, "error");
                                }
                        },
                });

                pi.registerCommand("goal", {
                        description: "Durable goal with evidence-verified completion: /goal <objective> | pause | resume | clear",
                        handler: async (args, ctx) => {
                                const { action, text } = parseGoalCommand(args ?? "");
                                switch (action) {
                                        case "status":
                                                ctx.ui.notify(renderGoalStatus(goal), "info");
                                                return;
                                        case "set": {
                                                goal = { text: text!.trim(), status: "active", createdAt: Date.now() };
                                                persistGoal();
                                                setStatusLine(ctx, "goal", goalFooterLine(goal));
                                                ctx.ui.notify(
                                                        `Goal set: ${text}\n\nCompletion requires ALL of: the [GOAL:COMPLETE] tag in a final reply, every todo done, and cited evidence (changed-file paths and/or command output). /goal shows status; /goal clear removes it.`,
                                                        "info",
                                                );
                                                return;
                                        }
                                        case "pause": {
                                                if (!goal) {
                                                        ctx.ui.notify("No goal to pause.", "warning");
                                                        return;
                                                }
                                                goal = { ...goal, status: "paused" };
                                                persistGoal();
                                                setStatusLine(ctx, "goal", goalFooterLine(goal));
                                                ctx.ui.notify("Goal paused (no per-turn injection until /goal resume).", "info");
                                                return;
                                        }
                                        case "resume": {
                                                if (!goal) {
                                                        ctx.ui.notify("No goal to resume.", "warning");
                                                        return;
                                                }
                                                goal = { ...goal, status: "active" };
                                                persistGoal();
                                                setStatusLine(ctx, "goal", goalFooterLine(goal));
                                                ctx.ui.notify(`Goal resumed: ${goal.text}`, "info");
                                                return;
                                        }
                                        case "clear": {
                                                goal = null;
                                                persistGoal();
                                                setStatusLine(ctx, "goal", undefined);
                                                ctx.ui.notify("Goal cleared.", "info");
                                                return;
                                        }
                                }
                        },
                });

                pi.registerCommand("review", {
                        description:
                                "Parallel-subagent code review of uncommitted work (or /review <base-branch>): P0–P3 findings + SHIP verdict",
                        handler: async (args, ctx) => {
                                const base = (args ?? "").trim() || undefined;
                                ctx.ui.notify("Review: freezing the diff snapshot…", "info");
                                let target;
                                try {
                                        target = await captureReviewTarget(opts.cwd, base);
                                } catch (err: any) {
                                        // Git-plumbing aborts (non-repo, git missing, merge-base
                                        // failure, timeout) arrive as actionable messages —
                                        // rendered as a command result, never a crash (R-b G1/G2).
                                        ctx.ui.notify(`Review aborted: ${err?.message ?? err}`, "warning");
                                        return;
                                }
                                if (!target.diff.trim() && target.untracked.length === 0) {
                                        ctx.ui.notify(
                                                "Nothing to review — no uncommitted changes and no untracked files. Try /review <base-branch> for a branch diff.",
                                                "info",
                                        );
                                        return;
                                }
                                const agent = reviewerAgent(target.diff);
                                const focuses = target.diff.length < 6000 ? REVIEWER_FOCUSES.slice(0, 1) : REVIEWER_FOCUSES;
                                ctx.ui.notify(
                                        `Review: ${focuses.length} reviewer(s) over ${target.label} (${target.diff.length} chars${target.truncated ? ", truncated" : ""}) — subagents spawn with fresh contexts…`,
                                        "info",
                                );
                                // Footer progress line (P1-b): the multi-minute fan-out is
                                // otherwise invisible after the notify scrolls away. Cleared
                                // when the verdict lands (or the handler throws).
                                setStatusLine(ctx, "review", `review: ${focuses.length} reviewer(s) running`);
                                // S4: thread the command ctx abort signal when pi provides one
                                // (usually undefined for idle-context commands — full cancel UI
                                // needs restructuring runSubagent's caller; runSubagent itself
                                // already handles a signal by tree-killing the reviewers).
                                const signal = (ctx as any)?.signal as AbortSignal | undefined;
                                try {
                                        const results = await Promise.all(
                                                focuses.map((f) =>
                                                        runSubagent(
                                                                agent,
                                                                buildReviewerTask({
                                                                        label: target.label,
                                                                        diff: target.diff,
                                                                        untracked: target.untracked,
                                                                        focusBrief: f.brief,
                                                                        cwd: opts.cwd,
                                                                }),
                                                                opts.cwd,
                                                                signal,
                                                        ),
                                                ),
                                        );
                                        // Reviewer honesty (R-b S1): a non-zero exit, timeout or empty
                                        // output marks the reviewer FAILED — its silence must never
                                        // render as "the diff looked clean". Truncated outputs are
                                        // marked too (S3).
                                        const outputs = results.map((r, i) =>
                                                parseReviewOutput(
                                                        r.output + (r.outputTruncated ? "\n(reviewer output truncated)" : ""),
                                                        focuses[i].key,
                                                        {
                                                                failed: r.exitCode !== 0 || !r.output.trim(),
                                                                truncated: r.outputTruncated,
                                                        },
                                                ),
                                        );
                                        const merged = mergeReviews(outputs);
                                        const text = renderReview(target.label, outputs, merged.findings);
                                        const artifact = saveReviewArtifact(opts.cwd, target.label, text);
                                        const allFailed = outputs.length > 0 && outputs.every((o) => o.failed);
                                        ctx.ui.notify(
                                                text + (artifact ? `\n\nSaved to ${artifact}` : ""),
                                                merged.verdict === "block" || allFailed ? "warning" : "info",
                                        );
                                } finally {
                                        setStatusLine(ctx, "review", undefined);
                                }
                        },
                });

                // -------------------------------------------------------------------
                // Plan-mode wiring
                // -------------------------------------------------------------------

                pi.registerFlag("plan", {
                        description: "Start in plan mode (read-only exploration)",
                        type: "boolean",
                        default: false,
                });

                pi.registerFlag("goal", {
                        description: "Start with a durable goal (evidence-verified completion)",
                        type: "string",
                        default: "",
                });

                pi.on("tool_call", async (event: any) => {
                        if (!planModeEnabled || event?.toolName !== "bash") return undefined;
                        const command = String(event?.input?.command ?? "");
                        if (!isSafeCommand(command)) {
                                return {
                                        block: true,
                                        reason: `Plan mode: command not on the read-only allowlist. Use /plan to leave plan mode first.\nCommand: ${command}`,
                                };
                        }
                        return undefined;
                });

                pi.on("context", async (event: any) => {
                        if (planModeEnabled || executionMode) return undefined;
                        const messages = event?.messages ?? [];
                        // Keep only the NEWEST goal-context message, and only while a
                        // goal is active — this turn's injection must survive the
                        // filter, stale ones from earlier turns must not accumulate.
                        let lastGoalIdx = -1;
                        for (let i = messages.length - 1; i >= 0; i--) {
                                if (messages[i]?.customType === "unown-goal-context") {
                                        lastGoalIdx = i;
                                        break;
                                }
                        }
                        return {
                                messages: messages.filter((m: any, i: number) => {
                                        if (m?.customType === "unown-plan-context") return false;
                                        if (m?.customType === "unown-goal-context") {
                                                return goal?.status === "active" && i === lastGoalIdx;
                                        }
                                        const content = m?.content;
                                        if (typeof content === "string") return !content.includes("[PLAN MODE ACTIVE]");
                                        if (Array.isArray(content)) {
                                                return !content.some(
                                                        (c: any) => c?.type === "text" && String(c.text ?? "").includes("[PLAN MODE ACTIVE]"),
                                                );
                                        }
                                        return true;
                                }),
                        };
                });

                pi.on("before_agent_start", async () => {
                        if (planModeEnabled) {
                                return {
                                        message: {
                                                customType: "unown-plan-context",
                                                content: `[PLAN MODE ACTIVE]
You are in plan mode — a read-only exploration mode for safe code analysis.

Restrictions:
- edit, write and the task tool are disabled
- bash is restricted to an allowlist of read-only commands (cat/grep/find/ls/git log etc.)
- fetch_url, todo and note remain available

Explore the codebase first (read/grep/find/ls). Ask the user clarifying questions in plain text when requirements are ambiguous.

Then produce a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes — just describe what you would do and why.`,
                                                display: false,
                                        },
                                };
                        }
                        if (executionMode && planItems.length > 0) {
                                const remaining = planItems.filter((t) => !t.completed);
                                const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
                                return {
                                        message: {
                                                customType: "unown-plan-context",
                                                content: `[EXECUTING PLAN — full tool access enabled]

Remaining steps:
${todoList}

Execute the steps in order. After completing a step, include a [DONE:n] tag in your response. Track progress with the todo tool.`,
                                                display: false,
                                        },
                                };
                        }
                        if (goal && goal.status === "active") {
                                return {
                                        message: {
                                                customType: "unown-goal-context",
                                                content: goalContextMessage(goal),
                                                display: false,
                                        },
                                };
                        }
                        return undefined;
                });

                pi.on("turn_end", async (event: any, ctx: any) => {
                        if (!executionMode || planItems.length === 0) return;
                        const msg = event?.message;
                        if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return;
                        const text = msg.content
                                .filter((b: any) => b?.type === "text")
                                .map((b: any) => b.text)
                                .join("\n");
                        if (markCompletedSteps(text, planItems) > 0) {
                                updateStatus(ctx);
                                persistPlanState();
                        }
                });

                pi.on("agent_end", async (event: any, ctx: any) => {
                        // ---- goal completion gate (zcode/muse port): tag + todos + evidence
                        if (goal && goal.status === "active") {
                                const messages = Array.isArray(event?.messages) ? event.messages : [];
                                const lastAssistant = [...messages].reverse().find((m: any) => m?.role === "assistant");
                                if (lastAssistant) {
                                        const text = assistantTextOf(lastAssistant);
                                        // T6: the tag counts only as its own line in the final
                                        // message — a mid-text mention (the agent discussing the
                                        // tag) neither completes the goal nor triggers reject noise.
                                        if (hasGoalTag(text)) {
                                                const check = checkGoalCompletion(text, todos);
                                                if (check.complete) {
                                                        goal = {
                                                                ...goal,
                                                                status: "complete",
                                                                completedAt: Date.now(),
                                                                completedEvidence: check.evidence,
                                                        };
                                                        persistGoal();
                                                        setStatusLine(ctx, "goal", goalFooterLine(goal));
                                                        if (ctx?.hasUI) {
                                                                ctx.ui.notify(
                                                                        "Goal COMPLETE — evidence verified:\n" +
                                                                                check.evidence
                                                                                        .slice(0, 6)
                                                                                        .map((e) => `  • ${e}`)
                                                                                        .join("\n"),
                                                                        "info",
                                                                );
                                                        }
                                                } else if (ctx?.hasUI) {
                                                        ctx.ui.notify("Goal NOT complete — " + check.reasons.join("; "), "warning");
                                                }
                                        }
                                }
                        }

                        if (executionMode && planItems.length > 0) {
                                if (planItems.every((t) => t.completed)) {
                                        executionMode = false;
                                        planItems = [];
                                        updateStatus(ctx);
                                        persistPlanState();
                                        if (ctx?.hasUI) {
                                                ctx.ui.notify("Plan complete — all steps done.", "info");
                                        }
                                }
                                return;
                        }

                        if (!planModeEnabled || !ctx?.hasUI) return;

                        const messages = Array.isArray(event?.messages) ? event.messages : [];
                        const lastAssistant = [...messages]
                                .reverse()
                                .find((m: any) => m?.role === "assistant" && Array.isArray(m.content));
                        if (lastAssistant) {
                                const text = lastAssistant.content
                                        .filter((b: any) => b?.type === "text")
                                        .map((b: any) => b.text)
                                        .join("\n");
                                const extracted = extractPlanSteps(text);
                                if (extracted.length > 0) planItems = extracted;
                        }
                        if (planItems.length === 0) return;
                        persistPlanState();

                        const planText = planItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
                        const choice = await ctx.ui.select(`Plan ready (${planItems.length} steps). What next?`, [
                                "Execute the plan (track progress)",
                                "Stay in plan mode",
                                "Refine the plan",
                        ]);
                        if (choice?.startsWith("Execute")) {
                                planModeEnabled = false;
                                executionMode = true;
                                restoreNormalTools();
                                updateStatus(ctx);
                                persistPlanState();
                                const remainingList = planItems.map((t) => `${t.step}. ${t.text}`).join("\n");
                                pi.sendMessage(
                                        {
                                                customType: "unown-plan-echo",
                                                content: `**Plan (${planItems.length} steps):**\n\n${planText}`,
                                                display: true,
                                        },
                                        { deliverAs: "followUp" },
                                );
                                pi.sendMessage(
                                        {
                                                customType: "unown-plan-execute",
                                                content: `Execute the plan.\n\nRemaining steps:\n${remainingList}\n\nStart with: ${planItems[0]?.text ?? ""}\nAfter completing a step, include a [DONE:n] tag in your response.`,
                                                display: true,
                                        },
                                        { triggerTurn: true, deliverAs: "followUp" },
                                );
                        } else if (choice === "Refine the plan") {
                                const refinement = await ctx.ui.editor("Refine the plan:", "");
                                if (refinement?.trim()) {
                                        pi.sendMessage(
                                                {
                                                        customType: "unown-plan-echo",
                                                        content: `**Plan (${planItems.length} steps):**\n\n${planText}`,
                                                        display: true,
                                                },
                                                { deliverAs: "followUp" },
                                        );
                                        pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
                                }
                        }
                });

                // ---- LSP PostToolUse feedback loop: fresh diagnostics after edits.
                // Cold start never blocks: the first edit kicks off the server,
                // the second one onward gets compiler feedback appended.
                pi.on("tool_result", async (event: any, ctx: any) => {
                        const tool = event?.toolName as string;
                        if (tool !== "write" && tool !== "edit") return undefined;
                        const raw = String(event?.input?.path ?? "");
                        if (!raw) return undefined;
                        const path = resolveFile(raw);
                        const language = languageFromPath(path);
                        if (!language) return undefined;
                        let manager: LspManager;
                        try {
                                manager = getLsp();
                        } catch {
                                return undefined;
                        }
                        if (manager.disabled) return undefined;
                        if (!manager.isLiveFor(language)) {
                                void manager.warmFor(language).then(() => refreshLspFooter(ctx)); // "lsp: ts ready" once the server is up
                                return undefined;
                        }
                        try {
                                const changedTs = Date.now();
                                await manager.syncDocument(path);
                                const items = await manager.waitForFreshDiagnostics(path, changedTs);
                                refreshLspFooter(ctx); // crash/respawn transitions surface here
                                if (items.length === 0) return undefined;
                                const errors = countErrors(items);
                                const text =
                                        `\n\n[lsp] ${errors > 0 ? `${errors} error(s)` : "diagnostics"} in ${path}:\n` +
                                        renderDiagnostics(path, items, 20);
                                if (errors > 0) {
                                        log(`PostToolUse lsp gate flagged ${path} (${errors} errors)`);
                                        return { content: [...(event.content ?? []), { type: "text", text }], isError: true };
                                }
                                return { content: [...(event.content ?? []), { type: "text", text }] };
                        } catch {
                                refreshLspFooter(ctx);
                                return undefined; // LSP must never break the edit path
                        }
                });

                // ---- restore state on session (re)start
                pi.on("session_start", async (_event: any, ctx: any) => {
                        if (pi.getFlag("plan") === true) planModeEnabled = true;
                        reconstructTodos(ctx);
                        try {
                                const entries = ctx.sessionManager.getEntries();
                                const planEntry = [...entries]
                                        .reverse()
                                        .find((e: any) => e?.type === "custom" && e?.customType === "unown-plan-mode") as
                                        | {
                                                        data?: {
                                                                enabled?: boolean;
                                                                steps?: PlanStep[];
                                                                executing?: boolean;
                                                                toolsBeforePlanMode?: string[];
                                                        };
                                          }
                                        | undefined;
                                if (planEntry?.data) {
                                        planModeEnabled = planEntry.data.enabled ?? planModeEnabled;
                                        planItems = planEntry.data.steps ?? planItems;
                                        executionMode = planEntry.data.executing ?? executionMode;
                                        toolsBeforePlanMode = planEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
                                }
                                const goalEntry = [...entries]
                                        .reverse()
                                        .find((e: any) => e?.type === "custom" && e?.customType === "unown-goal") as
                                        | { data?: GoalState | null }
                                        | undefined;
                                // T7: validate the restored entry — a drifted/old shape
                                // (missing text, unknown status) must load as null with a
                                // one-line warning instead of crashing /goal's renderer.
                                const restored = parseGoalEntry(goalEntry?.data);
                                goal = restored.goal;
                                if (restored.warning && ctx?.hasUI) {
                                        ctx.ui.notify(restored.warning, "warning");
                                }
                        } catch {
                                /* best effort */
                        }
                        // --goal flag: start (print or TUI) with a fresh goal
                        const flagGoal = pi.getFlag("goal");
                        if (typeof flagGoal === "string" && flagGoal.trim()) {
                                goal = { text: flagGoal.trim(), status: "active", createdAt: Date.now() };
                                persistGoal();
                        }
                        if (planModeEnabled) enablePlanTools();
                        updateStatus(ctx);
                        setStatusLine(ctx, "goal", goalFooterLine(goal));
                });

                pi.on("session_tree", async (_event: any, ctx: any) => {
                        reconstructTodos(ctx);
                });

                pi.on("session_shutdown", () => {
                        try {
                                lspManager?.disposeAll();
                        } catch {
                                /* best effort */
                        }
                });
        };

        return { name: "unown-tools", factory, hidden: true } as const;
}
