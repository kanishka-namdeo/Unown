#!/usr/bin/env node
/**
 * run-unown.mjs — Run oh-my-pi's typescript-edit-benchmark (106 shipped fixtures)
 * against the **Unown agent core** (Unown/pi-repo `createAgentSession`) through the
 * local zai-bridge (:3031).
 *
 * Faithful port of omp's metaharness `adapters/edit` runner semantics
 * (/home/z/probes/omp-edit-bench/edit-adapter/runner.ts, v18.11.1):
 *   - per-task in-process agent session, cwd = fresh copy of fixture input/
 *   - tools: read, edit, write only (pi-native "replace" edit semantics —
 *     edits[]: {oldText,newText} batch, exact-match-first with fuzzy fallback)
 *   - omp's default-equivalent system prompt (pi's generated default) + the
 *     omp benchmark exactness addendum (copied verbatim from
 *     edit-adapter/prompts/benchmark-*.md, MIT)
 *   - retry ladder: timeout x3, zero-tool x2, provider-failure x3 (exp backoff)
 *   - early stop on formatted byte-exact match after any successful edit/write
 *   - scoring: ported verbatim from typescript-edit-benchmark/src/verify.ts
 *     (Prettier-normalized byte equality, blank lines stripped for code)
 *   - tokens: (input+cacheRead+cacheWrite) delta minus system-prompt overhead
 *     (calls * ceil(len/4)), identical to omp's diffTokenStats
 *
 * Differences vs the omp harness run (intentional, for honest labeling):
 *   - agent core: Unown pi-repo 0.84.3 instead of @oh-my-pi 18.11.1
 *   - edit tool: pi-native replace (omp ran its default hashline variant)
 *   - no apply_patch tool (pi has none); no PI_STRICT_EDIT_MODE equivalent
 *
 * Usage:
 *   PI_CODING_AGENT_DIR=/home/z/probes/omp-edit-bench/unown-eval-agent \
 *   node run-unown.mjs --model kimi-k2.5 [--offset N --limit N] ...
 *
 * Resumable: tasks already present in unown-results/<model>.jsonl are skipped.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { diffLines } from "diff";
import * as prettier from "prettier";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo-relative (env-overridable) — resolves from this script's location so the
// benchmark runs from any checkout, not only the original author's machine.
const PI_DIST = process.env.PI_DIST ||
    path.join(__dirname, "..", "..", "pi-repo", "packages", "coding-agent", "dist", "index.js");
const RESULTS_DIR = path.join(__dirname, "unown-results"); // default; overridable via --results-dir
const DEFAULT_AGENT_DIR = path.join(__dirname, "unown-eval-agent");
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || DEFAULT_AGENT_DIR;
const PROVIDER = "zai-bridge";

const pi = await import(PI_DIST);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--summarize") out.summarize = true;
        else if (a === "--quiet") out.quiet = true;
        else if (a.startsWith("--")) {
            const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            const next = argv[i + 1];
            if (next === undefined || next.startsWith("--")) out[key] = true;
            else {
                out[key] = next;
                i++;
            }
        }
    }
    return out;
}
const args = parseArgs(process.argv.slice(2));

const config = {
    model: args.model,
    fixtures: args.fixtures || path.join(__dirname, "fixtures"),
    tarball: path.join(__dirname, "packages", "typescript-edit-benchmark", "fixtures.tar.gz"),
    concurrency: Number(args.concurrency || 4),
    runs: Math.max(1, Number(args.runs || 1)),
    resultsDir: args.resultsDir || path.join(__dirname, "unown-results"),
    timeoutMs: Number(args.timeout || 300000),
    connectionTimeoutMs: Number(args.connectionTimeout || 60000),
    maxTurns: Number(args.maxTurns || 30),
    maxAttempts: Math.max(1, Number(args.maxAttempts || 1)),
    maxTimeoutRetries: 3,
    zeroToolRetryLimit: 2,
    maxProviderFailureRetries: 3,
    offset: args.offset !== undefined ? Number(args.offset) : 0,
    limit: args.limit !== undefined ? Number(args.limit) : Infinity,
    tasks: args.tasks ? String(args.tasks).split(",").map((s) => s.trim()).filter(Boolean) : null,
};

if (!config.model && !args.summarize) {
    console.error("Usage: node run-unown.mjs --model <kimi-k2.5|qwen3.7-plus|qwen3.6-plus> [--offset N --limit N] [--summarize] [--model X --summarize]");
    process.exit(2);
}

// ---------------------------------------------------------------------------
// Benchmark prompt templates — copied verbatim from omp
// edit-adapter/prompts/{benchmark-system,benchmark-task,benchmark-retry}.md (MIT).
// ---------------------------------------------------------------------------
const TPL_SYSTEM = `Code-edit benchmark in repository: {{#if multiFile}}multiple unrelated files{{else}}a single edit task{{/if}}.

Exactness-scored: get the edit right.

## Constraints
- Make exactly the task-specified change—nothing more. Do not refactor, improve, or clean up other code.
- Tasks: single-token fixes to multi-hunk block rewrites. Shown replacement code: reproduce byte-for-byte; indentation, tabs vs. spaces, blank lines included.
- Similar regions: change only task-identified region(s).
- Verification: exact-text diff against expected fixture. Equivalent code, reordered imports/object keys, or formatting changes fail.
- NEVER modify comments or license headers unless explicitly requested.
- Re-read changed region; confirm exact task match.
{{#if multiFile}}- Modify only files referenced by the task or follow-ups. Leave all others unchanged.
{{/if}}
## Process
- First user message: task definition.
- Later follow-ups: incremental retry context for the same task.
- Use follow-up guidance to correct the previous attempt without forgetting the original task.

{{instructions}}`;

const TPL_TASK = `{{task_prompt}}
{{#if guided_context}}
## Guided fix (authoritative)

{{guided_context}}
{{/if}}`;

const TPL_RETRY = `Additional context for the same benchmark task.
{{#if guided_context}}
## Guided fix (authoritative)

{{guided_context}}
{{/if}}
## Retry context

{{retry_context}}

Apply one minimal concrete edit attempt using this new information.`;

/** Tiny handlebars: {{var}}, {{#if var}}…{{else}}…{{/if}} (omp `prompt.render` equivalent). */
function render(tpl, vars) {
    const re = /\{\{(#if [a-zA-Z_]+|else|\/if|[a-zA-Z_]+)\}\}/g;
    const out = [];
    let last = 0;
    const stack = []; // frames: {cond, phase: "then"|"else"}
    let m;
    const active = () => stack.every((f) => (f.phase === "then" ? f.cond : !f.cond));
    while ((m = re.exec(tpl)) !== null) {
        const tok = m[1];
        if (tok.startsWith("#if ")) {
            if (active()) out.push(tpl.slice(last, m.index));
            last = re.lastIndex;
            stack.push({ cond: Boolean(vars[tok.slice(4)]), phase: "then" });
            continue;
        }
        if (tok === "else") {
            if (active()) out.push(tpl.slice(last, m.index));
            last = re.lastIndex;
            const top = stack[stack.length - 1];
            if (top && top.phase === "then") top.phase = "else";
            continue;
        }
        if (tok === "/if") {
            if (active()) out.push(tpl.slice(last, m.index));
            last = re.lastIndex;
            stack.pop();
            continue;
        }
        if (active()) {
            out.push(tpl.slice(last, m.index));
            out.push(String(vars[tok] ?? ""));
        }
        last = re.lastIndex;
    }
    if (active()) out.push(tpl.slice(last));
    return out.join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const BENCHMARK_INSTRUCTIONS =
    "Read the relevant files first, then use the edit or vim tool to apply the fix.";
const benchmarkSystemPrompt = render(TPL_SYSTEM, { multiFile: false, instructions: BENCHMARK_INSTRUCTIONS });
const initialPromptFor = (taskPrompt) => render(TPL_TASK, { task_prompt: taskPrompt });
const retryPromptFor = (retryContext) => render(TPL_RETRY, { retry_context: retryContext });

// ---------------------------------------------------------------------------
// Scoring — verbatim port of typescript-edit-benchmark/src/{verify,formatter,shared}.ts
// ---------------------------------------------------------------------------
async function listFiles(rootDir, subPath = "") {
    const entries = await fsp.readdir(path.join(rootDir, subPath), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const relativePath = path.join(subPath, entry.name);
        if (entry.isDirectory()) files.push(...(await listFiles(rootDir, relativePath)));
        else if (entry.isFile()) files.push(relativePath);
    }
    return files.sort();
}

const PRETTIER_OPTIONS = {
    printWidth: 100, tabWidth: 2, useTabs: false, semi: true, singleQuote: true,
    quoteProps: "as-needed", trailingComma: "all", bracketSpacing: true,
    arrowParens: "always", endOfLine: "lf", proseWrap: "preserve",
};
const PARSER_BY_EXT = {
    ".js": "flow", ".jsx": "flow", ".ts": "typescript", ".tsx": "typescript",
    ".json": "json", ".jsonc": "json", ".md": "markdown", ".mdx": "mdx",
    ".yml": "yaml", ".yaml": "yaml", ".css": "css", ".scss": "scss", ".html": "html",
};
async function formatContent(filePath, content) {
    const parser = PARSER_BY_EXT[path.extname(filePath).toLowerCase()];
    if (!parser) return { formatted: content, didFormat: false };
    try {
        return { formatted: await prettier.format(content, { ...PRETTIER_OPTIONS, parser }), didFormat: true };
    } catch {
        return { formatted: content, didFormat: false };
    }
}

const BLANK_SENSITIVE = { ".md": true, ".mdx": true, ".yml": true, ".yaml": true };
const blankLineSensitive = (file) => BLANK_SENSITIVE[path.extname(file).toLowerCase()] === true;
const normalizeLineEndings = (v) => v.replace(/\r\n?/g, "\n");
const normalizeBlankLines = (t) => t.replace(/\n{3,}/g, "\n\n");
const stripBlankLines = (t) => t.split("\n").filter((l) => l.trim() !== "").join("\n");
const equalsIgnoringWhitespace = (a, b) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
const splitLines = (v) => v.split("\n").filter((line, idx, arr) => idx < arr.length - 1 || line);
const countIndent = (line) => {
    let n = 0;
    for (const ch of line) {
        if (ch === " ") n += 1;
        else if (ch === "\t") n += 2;
        else break;
    }
    return n;
};

function restoreWhitespaceOnlyLineDiffs(expected, actual) {
    const changes = diffLines(expected, actual);
    const out = [];
    let pendingRemoved = [];
    let pendingAdded = [];
    const flush = () => {
        const pairs = Math.min(pendingRemoved.length, pendingAdded.length);
        for (let i = 0; i < pairs; i++) {
            const removedLine = pendingRemoved[i];
            const addedLine = pendingAdded[i];
            out.push(removedLine !== addedLine && equalsIgnoringWhitespace(removedLine, addedLine) ? removedLine : addedLine);
        }
        for (let i = pairs; i < pendingAdded.length; i++) out.push(pendingAdded[i]);
        pendingRemoved = [];
        pendingAdded = [];
    };
    for (const change of changes) {
        const lines = splitLines(change.value);
        if (change.removed) { pendingRemoved.push(...lines); continue; }
        if (change.added) { pendingAdded.push(...lines); continue; }
        flush();
        out.push(...lines);
    }
    flush();
    const joined = out.join("\n");
    return actual.endsWith("\n") ? `${joined}\n` : joined;
}

function computeIndentDistanceForDiff(expected, actual) {
    const changes = diffLines(expected, actual);
    let totalDistance = 0, samples = 0;
    let pendingRemoved = [], pendingAdded = [];
    const flush = () => {
        const max = Math.max(pendingRemoved.length, pendingAdded.length);
        for (let i = 0; i < max; i++) {
            totalDistance += Math.abs(countIndent(pendingRemoved[i] ?? "") - countIndent(pendingAdded[i] ?? ""));
            samples += 1;
        }
        pendingRemoved = [];
        pendingAdded = [];
    };
    for (const change of changes) {
        const lines = splitLines(change.value);
        if (change.removed) { pendingRemoved.push(...lines); continue; }
        if (change.added) { pendingAdded.push(...lines); continue; }
        if (pendingRemoved.length > 0 || pendingAdded.length > 0) flush();
    }
    if (pendingRemoved.length > 0 || pendingAdded.length > 0) flush();
    return samples > 0 ? totalDistance / samples : 0;
}

function createCompactDiff(expected, actual, contextLines = 3) {
    const changes = diffLines(expected, actual);
    const output = [];
    let lineNum = 1;
    for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        const lines = splitLines(change.value);
        if (change.added || change.removed) {
            if (i > 0 && !changes[i - 1].added && !changes[i - 1].removed) {
                const prevLines = splitLines(changes[i - 1].value);
                const contextStart = Math.max(0, prevLines.length - contextLines);
                if (contextStart > 0) output.push(`@@ -${lineNum - (prevLines.length - contextStart)} @@`);
                for (let j = contextStart; j < prevLines.length; j++) output.push(` ${prevLines[j]}`);
            }
            const prefix = change.added ? "+" : "-";
            for (const line of lines) output.push(`${prefix}${line}`);
            if (i + 1 < changes.length && !changes[i + 1].added && !changes[i + 1].removed) {
                const nextLines = splitLines(changes[i + 1].value);
                const contextEnd = Math.min(nextLines.length, contextLines);
                for (let j = 0; j < contextEnd; j++) output.push(` ${nextLines[j]}`);
            }
            if (!change.added) lineNum += lines.length;
        } else {
            lineNum += lines.length;
        }
    }
    return output.join("\n");
}

function computeDiffStats(expected, actual) {
    const changes = diffLines(expected, actual);
    let linesChanged = 0, charsChanged = 0;
    for (const change of changes) {
        if (!change.added && !change.removed) continue;
        linesChanged += splitLines(change.value).length;
        charsChanged += change.value.length;
    }
    return { linesChanged, charsChanged };
}

async function verifyExpectedFileSubset(expectedDir, actualDir, files) {
    const startTime = Date.now();
    let totalIndentScore = 0, fileCount = 0;
    try {
        const expectedFixtureFiles = await listFiles(expectedDir);
        const expectedFiles = files?.length ? files.slice().sort() : expectedFixtureFiles;
        const actualFiles = await listFiles(actualDir);
        const missingFiles = expectedFiles.filter((f) => !actualFiles.includes(f));
        const extraFiles = actualFiles.filter((f) => !expectedFiles.includes(f));
        const missingExpected = expectedFiles.filter((f) => !expectedFixtureFiles.includes(f));
        if (missingExpected.length > 0)
            return { success: false, error: `Expected files missing from fixture: ${missingExpected.join(", ")}`, duration: Date.now() - startTime };
        if (missingFiles.length > 0 || (files === undefined && extraFiles.length > 0)) {
            const parts = [];
            if (missingFiles.length > 0) parts.push(`Missing files: ${missingFiles.join(", ")}`);
            if (files === undefined && extraFiles.length > 0) parts.push(`Unexpected files: ${extraFiles.join(", ")}`);
            return { success: false, error: parts.join("; "), duration: Date.now() - startTime };
        }
        for (const file of expectedFiles) {
            const expectedPath = path.join(expectedDir, file);
            const actualPath = path.join(actualDir, file);
            const expectedRaw = await fsp.readFile(expectedPath, "utf8");
            const actualRaw = await fsp.readFile(actualPath, "utf8");
            const expectedNormalized = normalizeLineEndings(expectedRaw);
            const actualNormalized = normalizeLineEndings(actualRaw);
            const actualPreserved = restoreWhitespaceOnlyLineDiffs(expectedNormalized, actualNormalized);
            const expectedFormatted = await formatContent(expectedPath, normalizeBlankLines(expectedNormalized));
            const actualFormatted = await formatContent(actualPath, normalizeBlankLines(actualPreserved));
            const formattedEquivalent = blankLineSensitive(file)
                ? expectedFormatted.formatted === actualFormatted.formatted
                : stripBlankLines(expectedFormatted.formatted) === stripBlankLines(actualFormatted.formatted);
            const fileIndentScore = computeIndentDistanceForDiff(actualNormalized, actualFormatted.formatted);
            totalIndentScore += fileIndentScore;
            fileCount++;
            if (!formattedEquivalent) {
                const diffOutput = createCompactDiff(expectedFormatted.formatted, actualFormatted.formatted);
                return {
                    success: false, error: `File mismatch for ${file}`, duration: Date.now() - startTime,
                    diff: diffOutput, diffStats: computeDiffStats(expectedFormatted.formatted, actualFormatted.formatted),
                    indentScore: fileIndentScore, formattedEquivalent,
                };
            }
        }
        return {
            success: true, duration: Date.now() - startTime,
            indentScore: fileCount > 0 ? totalIndentScore / fileCount : 0, formattedEquivalent: true,
            diffStats: { linesChanged: 0, charsChanged: 0 },
        };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - startTime };
    }
}

// ---------------------------------------------------------------------------
// Fixtures (port of typescript-edit-benchmark/src/tasks.ts loading)
// ---------------------------------------------------------------------------
function parseTaskMetadata(raw) {
    if (!raw) return undefined;
    const md = {};
    if (typeof raw.mutation_type === "string") md.mutationType = raw.mutation_type;
    if (typeof raw.mutation_category === "string") md.mutationCategory = raw.mutation_category;
    else if (typeof raw.category === "string") md.mutationCategory = raw.category;
    if (typeof raw.mutationType === "string" && !md.mutationType) md.mutationType = raw.mutationType;
    if (typeof raw.difficulty === "string") md.difficulty = raw.difficulty;
    if (typeof raw.difficulty_score === "number") md.difficultyScore = raw.difficulty_score;
    if (typeof raw.file_path === "string") md.filePath = raw.file_path;
    if (typeof raw.line_number === "number") md.lineNumber = raw.line_number;
    if (typeof raw.original_snippet === "string") md.originalSnippet = raw.original_snippet;
    if (typeof raw.mutated_snippet === "string") md.mutatedSnippet = raw.mutated_snippet;
    if (typeof raw.file_name === "string") md.fileName = raw.file_name;
    if (!md.fileName && typeof raw.file_path === "string") md.fileName = path.basename(raw.file_path);
    return Object.keys(md).length > 0 ? md : undefined;
}

async function loadTasks(fixturesDir) {
    if (!fs.existsSync(fixturesDir)) {
        // extract once from the shipped tarball
        await fsp.mkdir(path.dirname(fixturesDir), { recursive: true });
        const tmp = `${fixturesDir}.extract`;
        await fsp.rm(tmp, { recursive: true, force: true });
        await fsp.mkdir(tmp, { recursive: true });
        const res = spawnSync("tar", ["-xzf", config.tarball, "-C", tmp], { stdio: "ignore" });
        if (res.status !== 0) throw new Error(`tar extraction failed: ${res.stderr?.toString() || "unknown"}`);
        // tarball nests under ./fixtures/
        await fsp.rename(path.join(tmp, "fixtures"), fixturesDir);
        await fsp.rm(tmp, { recursive: true, force: true });
    }
    const entries = await fsp.readdir(fixturesDir, { withFileTypes: true });
    const tasks = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(fixturesDir, entry.name);
        const prompt = (await fsp.readFile(path.join(dir, "prompt.md"), "utf8")).trim();
        const files = await listFiles(path.join(dir, "input"));
        let metadata;
        try { metadata = parseTaskMetadata(JSON.parse(await fsp.readFile(path.join(dir, "metadata.json"), "utf8"))); } catch { metadata = undefined; }
        tasks.push({
            id: entry.name,
            prompt,
            files,
            metadata,
            inputDir: path.join(dir, "input"),
            expectedDir: path.join(dir, "expected"),
        });
    }
    return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Unown session client (in-process, mirrors omp InProcessClient surface)
// ---------------------------------------------------------------------------
const AGENT_EVENT_TYPES = new Set([
    "agent_start", "agent_end", "turn_start", "turn_end", "message_start",
    "message_update", "message_end", "tool_execution_start", "tool_execution_update",
    "tool_execution_end", "agent_settled", "queue_update", "compaction_start",
    "compaction_end", "auto_retry_start",
]);

class UnownClient {
    #session = null;
    #unsubscribe = null;
    #listeners = [];
    #options;

    constructor(options) { this.#options = options; }

    onEvent(listener) {
        this.#listeners.push(listener);
        return () => {
            const i = this.#listeners.indexOf(listener);
            if (i >= 0) this.#listeners.splice(i, 1);
        };
    }

    async start() {
        const o = this.#options;
        const modelRuntime = await pi.ModelRuntime.create({
            authPath: path.join(AGENT_DIR, "auth.json"),
            modelsPath: path.join(AGENT_DIR, "models.json"),
        });
        const model = modelRuntime.getModel(PROVIDER, o.model);
        if (!model) throw new Error(`Model not found: ${PROVIDER}/${o.model} (agent dir ${AGENT_DIR})`);
        const services = await pi.createAgentSessionServices({
            cwd: o.cwd,
            agentDir: AGENT_DIR,
            modelRuntime,
            settingsManager: pi.SettingsManager.inMemory(),
            resourceLoaderOptions: {
                appendSystemPromptOverride: (base) => [...base, o.appendSystemPrompt],
            },
        });
        const sessionManager = pi.SessionManager.inMemory(o.cwd);
        const result = await pi.createAgentSessionFromServices({
            services,
            sessionManager,
            model,
            thinkingLevel: "off",
            tools: ["read", "edit", "write"],
        });
        this.#session = result.session;
        this.#unsubscribe = this.#session.subscribe((event) => {
            if (!event || typeof event.type !== "string") return;
            if (!AGENT_EVENT_TYPES.has(event.type)) return;
            for (const l of this.#listeners) l(event);
        });
        return this;
    }

    async prompt(text) {
        await this.#session.prompt(text, { expandPromptTemplates: false });
    }
    async followUp(text) {
        await this.#session.followUp(text);
    }
    abort() {
        try { this.#session?.abort(); } catch { /* ignore */ }
    }
    getSessionStats() {
        const s = this.#session.getSessionStats();
        return {
            tokens: {
                input: s.tokens.input, output: s.tokens.output, reasoning: 0,
                cacheRead: s.tokens.cacheRead, cacheWrite: s.tokens.cacheWrite,
            },
            assistantMessages: s.assistantMessages,
        };
    }
    getSystemPrompt() { return this.#session.systemPrompt ?? ""; }
    getLastAssistantText() { return this.#session.getLastAssistantText() ?? null; }
    getMessages() { return this.#session.messages; }
    async dispose() {
        try { this.#unsubscribe?.(); } catch { /* ignore */ }
        this.#unsubscribe = null;
        try { this.#session?.dispose(); } catch { /* ignore */ }
        this.#session = null;
        this.#listeners = [];
    }
}

// ---------------------------------------------------------------------------
// Event collection (port of omp collectPromptEvents)
// ---------------------------------------------------------------------------
class PromptTimeoutError extends Error {
    constructor(telemetry) { super(`Prompt timed out after ${telemetry.elapsedMs}ms (events=${telemetry.eventCount})`); this.telemetry = telemetry; }
}
class PromptTurnLimitError extends Error {
    constructor(telemetry) { super(`Max turn limit exceeded: observed ${telemetry.observedTurns} turn_start events (limit ${telemetry.maxTurns}).`); this.telemetry = telemetry; }
}

const isEditTool = (name) => name === "edit";
const isMutationTool = (name) => isEditTool(name) || name === "write";

async function collectPromptEvents(client, message, kind, earlyStop, logEvent) {
    const events = [];
    const startedAt = Date.now();
    let pendingRetry = false;
    let lastEventType;
    let observedTurns = 0;
    let timer;
    let settled = false;
    let receivedFirstEvent = false;
    let earlyStopTriggered = false;
    let earlyStopChain = Promise.resolve();

    let unsubscribe = null;
    const eventsPromise = new Promise((resolve, reject) => {
        const resolveWait = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            unsubscribe?.();
            resolve();
        };
        const rejectWait = (err) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            unsubscribe?.();
            reject(err);
        };
        const fireTimeout = () => {
            client.abort();
            rejectWait(new PromptTimeoutError({
                elapsedMs: Date.now() - startedAt, eventCount: events.length, lastEventType,
            }));
        };
        const triggerEarlyStop = () => {
            if (!earlyStop || earlyStopTriggered || settled) return;
            earlyStopChain = earlyStopChain
                .then(async () => {
                    if (earlyStopTriggered || settled) return;
                    let matched = false;
                    try { matched = await earlyStop.check(); } catch { return; }
                    if (!matched || earlyStopTriggered || settled) return;
                    earlyStopTriggered = true;
                    try { await earlyStop.onMatch(); } catch { /* ignore */ }
                    client.abort();
                    resolveWait();
                })
                .catch(() => { });
        };
        timer = setTimeout(fireTimeout, config.connectionTimeoutMs);
        unsubscribe = client.onEvent((event) => {
            if (!event || settled) return;
            if (!receivedFirstEvent) {
                receivedFirstEvent = true;
                if (timer) clearTimeout(timer);
                timer = setTimeout(fireTimeout, config.timeoutMs);
            }
            events.push(event);
            lastEventType = event.type;
            if (event.type === "tool_execution_end" && !event.isError && isMutationTool(event.toolName)) {
                triggerEarlyStop();
            }
            if (event.type === "tool_execution_start" || event.type === "tool_execution_end" || event.type === "message_end") {
                logEvent(event).catch(() => { });
            }
            if (event.type === "turn_start") {
                observedTurns += 1;
                if (observedTurns > config.maxTurns) {
                    client.abort();
                    rejectWait(new PromptTurnLimitError({ observedTurns, maxTurns: config.maxTurns }));
                    return;
                }
                if (pendingRetry) pendingRetry = false;
            } else if (event.type === "auto_retry_start") {
                pendingRetry = true;
            }
            if (event.type === "agent_end") {
                if (pendingRetry || event.willRetry) return;
                resolveWait();
            } else if (event.type === "agent_settled") {
                resolveWait();
            }
        });
    });
    eventsPromise.catch(() => { });

    try {
        if (kind === "followUp") await client.followUp(message);
        else await client.prompt(message);
    } catch (err) {
        if (earlyStopTriggered) {
            if (timer) clearTimeout(timer);
            try { unsubscribe?.(); } catch { /* noop */ }
            return events;
        }
        if (timer) clearTimeout(timer);
        throw err;
    }
    await eventsPromise;
    return events;
}

// ---------------------------------------------------------------------------
// Provider failure detection (port)
// ---------------------------------------------------------------------------
const AUTH_FAILURE_RE =
    /\b(401|unauthorized|forbidden|invalid api key|invalid key|user not found|authentication|not authenticated|permission denied|access denied)\b/i;
function detectProviderFailure(events) {
    for (const event of events) {
        if (event.type !== "message_end") continue;
        const message = event.message;
        if (!message || typeof message !== "object") continue;
        if (message.role !== "assistant") continue;
        const errorMessage = message.errorMessage;
        if (typeof errorMessage !== "string" || errorMessage.trim().length === 0) continue;
        return { kind: AUTH_FAILURE_RE.test(errorMessage) ? "auth" : "provider", message: errorMessage.trim() };
    }
    return null;
}
const providerFailureRetryDelayMs = (n) => Math.min(10000, 1000 * 2 ** (Math.max(1, n) - 1));

// ---------------------------------------------------------------------------
// Edit failure extraction (Unown-specific categories)
// ---------------------------------------------------------------------------
function extractToolErrorMessage(result) {
    if (result == null) return "Unknown error";
    if (typeof result === "string") return result;
    if (result instanceof Error) return result.message;
    if (Array.isArray(result?.content)) {
        for (const part of result.content) {
            if (part?.type === "text" && typeof part.text === "string") return part.text;
        }
    }
    if (typeof result?.error === "string") return result.error;
    try { return JSON.stringify(result); } catch { return "Unknown error"; }
}
function categorizeEditFailure(error) {
    if (/Found \d+ occurrences/i.test(error)) return "not-unique";
    if (/Could not find (the exact text|edits\[)/i.test(error)) return "not-found";
    if (/No changes made/i.test(error)) return "no-change";
    if (/overlap in/i.test(error)) return "overlap";
    if (/must not be empty|must contain at least one/i.test(error)) return "invalid-args";
    return "other";
}

// ---------------------------------------------------------------------------
// Mutation intent (port of evaluateMutationIntent)
// ---------------------------------------------------------------------------
async function evaluateMutationIntent(task, cwd, expectedDir) {
    const md = task.metadata;
    const file = md?.fileName ?? task.files[0];
    const lineNumber = md?.lineNumber;
    if (!file || typeof lineNumber !== "number" || lineNumber < 1) return null;
    const currentPath = file.startsWith("/") ? file : path.join(cwd, file);
    const expectedPath = file.startsWith("/") ? file : path.join(expectedDir, file);
    let currentText, expectedText;
    try {
        currentText = await fsp.readFile(currentPath, "utf8");
        expectedText = await fsp.readFile(expectedPath, "utf8");
    } catch {
        return { matched: false, reason: "Unable to read current/expected target file for mutation-intent check." };
    }
    const currentLine = currentText.split("\n")[lineNumber - 1] ?? "";
    const expectedLine = expectedText.split("\n")[lineNumber - 1] ?? "";
    if (currentLine === expectedLine && expectedLine.length > 0)
        return { matched: true, reason: "Target line exactly matches expected fixture." };
    const originalSnippet = md?.originalSnippet;
    const mutatedSnippet = md?.mutatedSnippet;
    if (typeof originalSnippet === "string" && originalSnippet.length > 0) {
        const hasOriginal = currentLine.includes(originalSnippet);
        const stillHasMutated = typeof mutatedSnippet === "string" && mutatedSnippet.length > 0 ? currentLine.includes(mutatedSnippet) : false;
        if (hasOriginal && !stillHasMutated)
            return { matched: true, reason: "Target line contains original snippet and no longer contains mutated snippet." };
    }
    return { matched: false, reason: `Target line mismatch at ${file}:${lineNumber}.` };
}

// ---------------------------------------------------------------------------
// Token stats (port of diffTokenStats)
// ---------------------------------------------------------------------------
const estimateTokens = (text) => Math.ceil(text.length / 4);
function diffTokenStats(before, after, systemPromptTokens) {
    const calls = Math.max(0, after.assistantMessages - before.assistantMessages);
    const overhead = calls * systemPromptTokens;
    const beforePrompt = before.tokens.input + before.tokens.cacheRead + before.tokens.cacheWrite;
    const afterPrompt = after.tokens.input + after.tokens.cacheRead + after.tokens.cacheWrite;
    const input = Math.max(0, afterPrompt - beforePrompt - overhead);
    const output = Math.max(0, after.tokens.output - before.tokens.output);
    const reasoning = Math.max(0, (after.tokens.reasoning ?? 0) - (before.tokens.reasoning ?? 0));
    return { input, output, reasoning, total: input + output };
}

// ---------------------------------------------------------------------------
// Conversation dump (receipts)
// ---------------------------------------------------------------------------
function textOf(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.filter((c) => c?.type === "text").map((c) => c.text).join("");
    return "";
}
async function writeConversationDump(dumpDir, taskId, session) {
    try {
        const lines = [`# ${taskId} — Unown (pi-repo) conversation dump`, "", "## System prompt", "", "```", session.getSystemPrompt(), "```", ""];
        for (const m of session.getMessages()) {
            if (m.role === "user") lines.push("## User", "", textOf(m.content), "");
            else if (m.role === "assistant") {
                lines.push("## Assistant", "", textOf(m.content) || "(no text)", "");
                for (const part of m.content ?? []) {
                    if (part?.type === "toolCall") lines.push(`- tool call \`${part.name}\`: ${JSON.stringify(part.arguments).slice(0, 1500)}`);
                }
                lines.push("");
            } else if (m.role === "toolResult") {
                lines.push(`## Tool result (${m.toolName}${m.isError ? " — ERROR" : ""})`, "", "```", textOf(m.content).slice(0, 2500), "```", "");
            }
        }
        await fsp.mkdir(dumpDir, { recursive: true });
        await fsp.writeFile(path.join(dumpDir, `${taskId}.md`), lines.join("\n"));
    } catch { /* dumps are best-effort */ }
}

// ---------------------------------------------------------------------------
// Single task run (port of runSingleTask)
// ---------------------------------------------------------------------------
async function runSingleTask(task, modelSlug, runDirs, runIndex = 0) {
    const startedAt = Date.now();
    const runTag = runIndex > 0 ? `.r${runIndex}` : "";
    const logFile = path.join(runDirs.events, `${task.id}${runTag}.jsonl`);
    const logEvent = (event) => fsp.appendFile(logFile, `${JSON.stringify(event)}\n`);
    const log = (obj) => fsp.appendFile(logFile, `${JSON.stringify(obj)}\n`);

    const workDir = path.join(runDirs.workdirs, `${task.id}${runTag}`);
    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.mkdir(workDir, { recursive: true });
    // copy input/ -> workDir
    for (const entry of await fsp.readdir(task.inputDir, { withFileTypes: true })) {
        await fsp.cp(path.join(task.inputDir, entry.name), path.join(workDir, entry.name), { recursive: true });
    }

    let error;
    let verificationPassed = false;
    let indentScore, formattedEquivalent, diffStats, diff;
    let tokens = { input: 0, output: 0, reasoning: 0, total: 0 };
    let agentResponse;
    let mutationIntent = null;
    let earlyStoppedByMatch = false;
    const toolStats = { read: 0, edit: 0, write: 0, editSuccesses: 0, editFailures: 0 };
    const editFailures = [];
    let timeoutTelemetry;
    let timeoutRetriesUsed = 0, zeroToolRetries = 0, providerFailureRetries = 0;

    const client = new UnownClient({
        cwd: workDir,
        model: config.model,
        appendSystemPrompt: benchmarkSystemPrompt,
    });

    try {
        await log({ type: "meta", task: task.id, model: config.model, workDir, agentDir: AGENT_DIR });
        await client.start();
        const systemPromptTokens = estimateTokens(client.getSystemPrompt());

        let retryContext = null;
        for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
            const delivery = retryContext
                ? { kind: "followUp", message: retryPromptFor(retryContext) }
                : { kind: "prompt", message: initialPromptFor(task.prompt) };
            await log({ type: "prompt", attempt: attempt + 1, delivery: delivery.kind, message: delivery.message });

            const statsBefore = client.getSessionStats();
            let events;
            try {
                events = await collectPromptEvents(
                    client, delivery.message, delivery.kind,
                    {
                        check: () => verifyExpectedFileSubset(task.expectedDir, workDir, task.files).then((v) => v.success),
                        onMatch: async () => {
                            earlyStoppedByMatch = true;
                            await log({ type: "early_stop", attempt: attempt + 1, reason: "formatted_match" });
                        },
                    },
                    log,
                );
            } catch (err) {
                if (err instanceof PromptTurnLimitError) { error = err.message; await log({ type: "turn_limit_exceeded", attempt: attempt + 1 }); break; }
                if (err instanceof PromptTimeoutError) {
                    timeoutTelemetry = err.telemetry;
                    await log({ type: "timeout", attempt: attempt + 1, telemetry: err.telemetry });
                    timeoutRetriesUsed += 1;
                    retryContext = [
                        `Previous attempt timed out after ${err.telemetry.elapsedMs}ms.`,
                        `Retry ${timeoutRetriesUsed}/${config.maxTimeoutRetries}. Resume the edit flow once the model responds.`,
                    ].join("\n");
                    if (timeoutRetriesUsed >= config.maxTimeoutRetries) {
                        error = `Timeout exhausted after ${config.maxTimeoutRetries} retries (last: ${err.telemetry.elapsedMs}ms)`;
                        await log({ type: "timeout_exhausted", retriesUsed: timeoutRetriesUsed });
                        break;
                    }
                    attempt--;
                    continue;
                }
                throw err;
            }
            const attemptTokens = diffTokenStats(statsBefore, client.getSessionStats(), systemPromptTokens);
            tokens = {
                input: tokens.input + attemptTokens.input,
                output: tokens.output + attemptTokens.output,
                reasoning: tokens.reasoning + attemptTokens.reasoning,
                total: tokens.total + attemptTokens.total,
            };
            await log({ type: "stats", attempt: attempt + 1, tokens: attemptTokens });

            agentResponse = client.getLastAssistantText() ?? undefined;

            const providerFailure = detectProviderFailure(events);
            const hasMutationToolCall = events.some((e) => e.type === "tool_execution_start" && isMutationTool(e.toolName));
            if (providerFailure && !hasMutationToolCall) {
                await log({ type: "provider_failure", kind: providerFailure.kind, error: providerFailure.message });
                if (providerFailureRetries < config.maxProviderFailureRetries) {
                    providerFailureRetries += 1;
                    const delayMs = providerFailureRetryDelayMs(providerFailureRetries);
                    retryContext = [
                        `Previous attempt failed due to a ${providerFailure.kind === "auth" ? "provider/auth" : "provider"} error.`,
                        `Provider error: ${providerFailure.message}`,
                        `Retry ${providerFailureRetries}/${config.maxProviderFailureRetries} after ${delayMs}ms backoff. Resume the requested edit flow once the provider responds successfully.`,
                    ].join("\n");
                    await log({ type: "provider_failure_retry", retryNumber: providerFailureRetries, delayMs });
                    await new Promise((r) => setTimeout(r, delayMs));
                    attempt--;
                    continue;
                }
                error = `Provider ${providerFailure.kind} failure: ${providerFailure.message}`;
                await log({ type: "provider_failure_exhausted", retriesUsed: providerFailureRetries });
                break;
            }

            for (const e of events) {
                if (e.type === "tool_execution_start") {
                    if (e.toolName === "read") toolStats.read++;
                    else if (isEditTool(e.toolName)) toolStats.edit++;
                    else if (e.toolName === "write") toolStats.write++;
                } else if (e.type === "tool_execution_end") {
                    if (isEditTool(e.toolName)) {
                        if (e.isError) {
                            toolStats.editFailures++;
                            const message = extractToolErrorMessage(e.result);
                            editFailures.push({ toolCallId: e.toolCallId, error: message, category: categorizeEditFailure(message) });
                        } else {
                            toolStats.editSuccesses++;
                        }
                    }
                }
            }

            const madeEditAttempt = toolStats.edit > 0 || toolStats.write > 0;
            if (!madeEditAttempt && zeroToolRetries < config.zeroToolRetryLimit) {
                zeroToolRetries++;
                await log({ type: "zero_tool_retry", retryNumber: zeroToolRetries });
                retryContext = `Previous attempt read files but made no edit attempt — you must use the edit tool to apply the fix. Retry ${zeroToolRetries}/${config.zeroToolRetryLimit}.`;
                attempt--;
                continue;
            }

            const verification = await verifyExpectedFileSubset(task.expectedDir, workDir, undefined);
            verificationPassed = verification.success;
            indentScore = verification.indentScore;
            formattedEquivalent = verification.formattedEquivalent;
            diffStats = verification.diffStats;
            diff = verification.diff;
            mutationIntent = await evaluateMutationIntent(task, workDir, task.expectedDir);
            if (!verification.success && verification.error) error = verification.error;
            if (verification.success) break;

            const suffix = mutationIntent ? `\n\nMutation intent: ${mutationIntent.matched ? "matched" : "not matched"} (${mutationIntent.reason})` : "";
            retryContext = error
                ? `Verification failed: ${error}${diff ? `\n\nDiff (expected vs actual):\n\n\`\`\`diff\n${diff}\n\`\`\`` : ""}${suffix}`
                : `Previous attempt failed.${suffix}`;
        }
        await writeConversationDump(path.join(runDirs.dumps, modelSlug), `${task.id}${runTag}`, client);
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        await log({ type: "error", error }).catch(() => { });
    } finally {
        await client.dispose().catch(() => { });
    }

    const durationMs = Date.now() - startedAt;
    const md = task.metadata ?? {};
    await log({ type: "result", success: verificationPassed, durationMs });
    const record = {
        task: task.id,
        tier: md.difficulty ?? "unknown",
        difficultyScore: md.difficultyScore,
        mutationType: md.mutationType ?? "unknown",
        mutationCategory: md.mutationCategory ?? "unknown",
        model: config.model,
        provider: PROVIDER,
        success: verificationPassed,
        verificationPassed,
        patchApplied: toolStats.edit > 0,
        error: error ?? null,
        diffExcerpt: diff ? String(diff).slice(0, 4000) : undefined,
        editCalls: toolStats.edit,
        editSuccesses: toolStats.editSuccesses,
        editFailures: toolStats.editFailures,
        editFailureDetail: editFailures.slice(0, 12),
        readCalls: toolStats.read,
        writeCalls: toolStats.write,
        tokens: { prompt: tokens.input, completion: tokens.output, reasoning: tokens.reasoning, total: tokens.total },
        durationMs,
        indentScore: indentScore ?? 0,
        mutationIntentMatched: mutationIntent?.matched ?? null,
        mutationIntentReason: mutationIntent?.reason ?? null,
        earlyStopped: earlyStoppedByMatch || undefined,
        retries: { timeout: timeoutRetriesUsed, zeroTool: zeroToolRetries, providerFailure: providerFailureRetries },
        agentResponse: agentResponse ? String(agentResponse).slice(0, 1500) : undefined,
        timeoutTelemetry: timeoutTelemetry ?? undefined,
    };
    if (!args.quiet) {
        console.log(
            `  ${verificationPassed ? "PASS" : "FAIL"} ${task.id} [${record.tier}/${record.mutationType}] ${Math.round(durationMs / 1000)}s ` +
            `edits ${toolStats.editSuccesses}/${toolStats.edit} tok ${tokens.input}/${tokens.output}${earlyStoppedByMatch ? " (early-stop)" : ""}${error ? ` — ${String(error).slice(0, 140)}` : ""}`
        );
    }
    return record;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
function percentile(sortedAscending, p) {
    const n = sortedAscending.length;
    if (n === 0) return 0;
    if (n === 1) return sortedAscending[0];
    const rank = (p / 100) * (n - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sortedAscending[lo];
    return sortedAscending[lo] + (sortedAscending[hi] - sortedAscending[lo]) * (rank - lo);
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function buildSummary(model, records) {
    // Group by task; pick the "best" run per task (omp metaharness semantics:
    // success > fewer total tokens > earlier run). With 1 run per task this is
    // the identity — n=1 summaries are byte-compatible with the original format.
    const byTask = new Map();
    for (const r of records) {
        if (!byTask.has(r.task)) byTask.set(r.task, []);
        byTask.get(r.task).push(r);
    }
    const best = [...byTask.values()].map((rs) => rs.slice().sort((a, b) => {
        if (a.success !== b.success) return a.success ? -1 : 1;
        const at = a.tokens?.total ?? 0, bt = b.tokens?.total ?? 0;
        if (at !== bt) return at - bt;
        return (a.run ?? 0) - (b.run ?? 0);
    })[0]);
    const runsPerTask = Math.max(...[...byTask.values()].map((rs) => rs.length));
    const anyOfN = [...byTask.values()].filter((rs) => rs.some((r) => r.success)).length;
    const allRunsPassed = records.filter((r) => r.success).length;
    const allRunsTotal = records.length;
    const flakyTasks = [...byTask.entries()].filter(([, rs]) => rs.length > 1 && rs.some((r) => r.success) && rs.some((r) => !r.success)).map(([t]) => t);

    const passed = best.filter((r) => r.success);
    const editCalls = sum(records.map((r) => r.editCalls));
    const editSuccesses = sum(records.map((r) => r.editSuccesses));
    const promptToks = best.map((r) => r.tokens.prompt).sort((a, b) => a - b);
    const completionToks = best.map((r) => r.tokens.completion).sort((a, b) => a - b);
    const totalToks = best.map((r) => r.tokens.total).sort((a, b) => a - b);
    const durations = best.map((r) => r.durationMs).sort((a, b) => a - b);

    const byTier = {};
    const byCategory = {};
    const byMutation = {};
    for (const r of best) {
        (byTier[r.tier] ??= { total: 0, passed: 0 }); byTier[r.tier].total++; if (r.success) byTier[r.tier].passed++;
        (byCategory[r.mutationCategory] ??= { total: 0, passed: 0 }); byCategory[r.mutationCategory].total++; if (r.success) byCategory[r.mutationCategory].passed++;
        (byMutation[r.mutationType] ??= { total: 0, passed: 0 }); byMutation[r.mutationType].total++; if (r.success) byMutation[r.mutationType].passed++;
    }
    const failureCategories = {};
    for (const r of records) for (const f of r.editFailureDetail ?? []) (failureCategories[f.category] ??= 0), failureCategories[f.category]++;

    return {
        benchmark: "oh-my-pi typescript-edit-benchmark (106 shipped fixtures)",
        agent: `Unown pi-repo createAgentSession (in-process) @ ${path.dirname(path.dirname(PI_DIST))}`,
        editSemantics: "pi-native replace (edits[]: {oldText,newText} batch; exact-first, fuzzy fallback)",
        harness: "run-unown.mjs — port of omp metaharness adapters/edit runner",
        model, provider: PROVIDER,
        generatedAt: new Date().toISOString(),
        totalTasks: best.length,
        passed: passed.length,
        passRate: best.length ? passed.length / best.length : 0,
        editCallSuccessRate: editCalls > 0 ? editSuccesses / editCalls : 1,
        editCalls, editSuccesses,
        tokens: {
            promptTotal: sum(promptToks), completionTotal: sum(completionToks),
            perTask: {
                prompt: { mean: best.length ? sum(promptToks) / best.length : 0, median: percentile(promptToks, 50), p1: percentile(promptToks, 1), p99: percentile(promptToks, 99) },
                completion: { mean: best.length ? sum(completionToks) / best.length : 0, median: percentile(completionToks, 50), p1: percentile(completionToks, 1), p99: percentile(completionToks, 99) },
                total: { mean: best.length ? sum(totalToks) / best.length : 0, median: percentile(totalToks, 50), p1: percentile(totalToks, 1), p99: percentile(totalToks, 99) },
            },
        },
        duration: {
            totalMs: sum(durations),
            meanMs: best.length ? sum(durations) / best.length : 0,
            medianMs: percentile(durations, 50),
            p1Ms: percentile(durations, 1),
            p99Ms: percentile(durations, 99),
        },
        mutationIntentMatchRate: (() => { const withIntent = best.filter((r) => r.mutationIntentMatched !== null); return withIntent.length ? withIntent.filter((r) => r.mutationIntentMatched).length / withIntent.length : null; })(),
        earlyStops: best.filter((r) => r.earlyStopped).length,
        indentScoreAvg: best.length ? sum(best.map((r) => r.indentScore)) / best.length : 0,
        byTier, byCategory, byMutation,
        editFailureCategories: failureCategories,
        failedTasks: best.filter((r) => !r.success).map((r) => ({ task: r.task, tier: r.tier, mutationType: r.mutationType, error: r.error, editCalls: r.editCalls, retries: r.retries })),
        // multi-run fields (identity when 1 run per task)
        runsPerTask,
        anyOfN,
        allRunsPassed,
        allRunsTotal,
        allRunsTaskSuccessRate: allRunsTotal ? allRunsPassed / allRunsTotal : 0,
        flakyTasks,
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    // --summarize without --model: rebuild summaries for every model that has results
    const models = config.model
        ? [config.model]
        : args.summarize && fs.existsSync(config.resultsDir)
            ? (await fsp.readdir(config.resultsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
            : [];
    if (models.length === 0 && !args.summarize) {
        console.error("--model is required (kimi-k2.5 | qwen3.7-plus | qwen3.6-plus)");
        process.exit(2);
    }
    const resultsRoot = config.resultsDir;
    for (const model of models) {
        // model ids (kimi-k2.5, qwen3.7-plus, qwen3.6-plus) contain only [a-z0-9.-]: usable verbatim as dir names
        const modelSlug = model;
        const modelResultsDir = path.join(resultsRoot, modelSlug);
        await fsp.mkdir(modelResultsDir, { recursive: true });
        const jsonlPath = path.join(modelResultsDir, `${modelSlug}.jsonl`);
        const summaryPath = path.join(modelResultsDir, "summary.json");

        if (!args.summarize) {
            const allTasks = await loadTasks(config.fixtures);
            let window = allTasks;
            if (config.tasks) window = window.filter((t) => config.tasks.includes(t.id));
            window = window.slice(config.offset, config.offset + config.limit);

            const done = new Set();
            if (fs.existsSync(jsonlPath)) {
                for (const line of (await fsp.readFile(jsonlPath, "utf8")).split("\n")) {
                    if (!line.trim()) continue;
                    try { const r = JSON.parse(line); done.add(r.run !== undefined ? `${r.task}#${r.run}` : r.task); } catch { /* tolerate */ }
                }
            }
            // (task, runIndex) pairs; run 0 of a task is keyed bare for n=1 compatibility
            const pending = [];
            for (const t of window) {
                for (let r = 0; r < config.runs; r++) {
                    const key = r === 0 ? t.id : `${t.id}#${r}`;
                    if (!done.has(key)) pending.push({ task: t, runIndex: r });
                }
            }
            console.log(`[unown-edit-bench] model=${model} window=${window.length} runs/task=${config.runs} done=${window.length * config.runs - pending.length} pending=${pending.length} (of ${allTasks.length} total fixtures)`);
            if (pending.length === 0) {
                console.log("[unown-edit-bench] nothing to do for this window");
            }

            const runDirs = {
                events: path.join(modelResultsDir, "events"),
                workdirs: path.join(modelResultsDir, "workdirs"),
                dumps: path.join(modelResultsDir, "dumps"),
            };
            for (const d of Object.values(runDirs)) await fsp.mkdir(d, { recursive: true });

            let inflight = 0;
            let cursor = 0;
            const startedAt = Date.now();
            await new Promise((resolveAll) => {
                const launchNext = () => {
                    while (inflight < config.concurrency && cursor < pending.length) {
                        const item = pending[cursor++];
                        inflight++;
                        runSingleTask(item.task, modelSlug, runDirs, item.runIndex)
                            .then(async (record) => {
                                await fsp.appendFile(jsonlPath, `${JSON.stringify({ ...record, run: item.runIndex })}\n`);
                            })
                            .catch(async (err) => {
                                const record = {
                                    task: item.task.id, tier: item.task.metadata?.difficulty ?? "unknown",
                                    mutationType: item.task.metadata?.mutationType ?? "unknown", model, run: item.runIndex,
                                    success: false, error: `runner crash: ${err?.stack || err}`, editCalls: 0,
                                    editSuccesses: 0, tokens: { prompt: 0, completion: 0, total: 0 }, durationMs: 0,
                                };
                                await fsp.appendFile(jsonlPath, `${JSON.stringify(record)}\n`);
                            })
                            .finally(() => {
                                inflight--;
                                launchNext();
                                if (cursor >= pending.length && inflight === 0) resolveAll();
                            });
                    }
                };
                launchNext();
            });
            console.log(`[unown-edit-bench] window complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        }

        // Rebuild summary from the full JSONL
        if (fs.existsSync(jsonlPath)) {
            const records = (await fsp.readFile(jsonlPath, "utf8")).split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
            const summary = buildSummary(model, records);
            await fsp.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
            console.log(`[unown-edit-bench] ${model}: ${summary.passed}/${summary.totalTasks} passed best-of-${summary.runsPerTask} (${(summary.passRate * 100).toFixed(1)}%) · any-of-${summary.runsPerTask}: ${summary.anyOfN}/${summary.totalTasks} · all-runs ${summary.allRunsPassed}/${summary.allRunsTotal} — edit-call ${(summary.editCallSuccessRate * 100).toFixed(1)}% — summary → ${summaryPath}`);
        } else {
            console.log(`[unown-edit-bench] ${model}: no results yet`);
        }
    }
}

process.on("unhandledRejection", (err) => {
    console.error("[unhandledRejection]", err);
});
main()
    .then(() => {
        // Sessions/runtimes can leave handles open (timers, watchers); exit explicitly.
        process.exit(0);
    })
    .catch((err) => {
        console.error("[unown-edit-bench] fatal:", err);
        process.exit(1);
    });
