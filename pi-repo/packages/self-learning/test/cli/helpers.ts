// CLI golden-test harness (Phase 3, docs/testing-strategy.md §4.3 —
// "Non-interactive golden tests").
//
// Spawns the REAL `bin/unown` as a subprocess (stdin </dev/null) against a
// local MOCK OpenAI-compatible bridge on an OS-assigned ephemeral port — the
// same hermetic pattern as test/integration/helpers.ts, but for the terminal
// CLI. No in-process src/ imports live here (the spawned CLI opens its own
// SQLite store), so this file does NOT need test/_env.ts and cannot clash
// with the unit suite's module registry.
//
// Hermeticity rules enforced by unown():
//   - every spawn gets a private UNOWN_HOME (state-dir override)
//   - UNOWN_ENGINE_URL points at a dead loopback port by default (127.0.0.1:9
//     — nothing listens there; the live engine on :3030 is never touched, and
//     session notes queue in the private outbox instead of being delivered)
//   - PI_BRIDGE_URL points at OUR mock (never the live bridge on :3031)
//   - PI_SELFLEARNING_DB / PI_SELFLEARNING_DATA point into the temp root (the
//     CLI process imports store.ts, which opens SQLite at module scope)
//   - UNOWN_* / PI_* / BRIDGE_* inherited from the test runner are stripped
//     first, so the parent suite's env (or a developer's shell) cannot leak
//     into the golden results
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (…/Unown) — test/cli/helpers.ts lives five levels below. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));

/** bin/unown — the real CLI entry (bun shebang). */
export const UNOWN_BIN = join(REPO_ROOT, "bin", "unown");

/** Dead loopback endpoint (nothing listens on port 9) — engine by default. */
export const DEAD_URL = "http://127.0.0.1:9";

// ---------------------------------------------------------------------------
// Mock bridge (OpenAI-compatible, mirroring mini-services/llm-bridge shapes)
// ---------------------------------------------------------------------------

/** One recorded POST /v1/chat/completions request. */
export interface MockChatRequest {
        ts: number;
        model: string;
        /** Tool names as sent in the request's `tools` array. */
        tools: string[];
        stream: boolean;
        /** Role sequence of the messages array (turn reconstruction check). */
        roles: string[];
}

export interface MockBridge {
        port: number;
        url: string;
        requests: MockChatRequest[];
        close(): void;
}

export interface MockBridgeOptions {
        /** HTTP status GET /v1/models answers with (default 200; 401 simulates rejected credentials). */
        modelsStatus?: number;
}

/**
 * Start the mock bridge. Chats stream SSE; a prompt containing
 * `TOOLCALL <name> <json-args>` makes the model emit exactly that tool call
 * (the script may live in ANY user message — the CLI appends its own context
 * message after the user's prompt, so scanning only the last user message
 * would miss prompts entirely; follow-up turns with tool results get a plain
 * text answer, so scripted runs terminate).
 */
export function startMockBridge(opts: MockBridgeOptions = {}): MockBridge {
        const requests: MockChatRequest[] = [];
        let seq = 0;
        const state: MockBridge = { port: 0, url: "", requests, close: () => {} };

        const server = Bun.serve({
                port: 0, // OS-assigned ephemeral port — never the live bridge's 3031
                async fetch(req) {
                        const url = new URL(req.url);

                        if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
                                // Same shape as the real llm-bridge /health (doctor consumes it).
                                return Response.json({
                                        ok: true,
                                        port: state.port,
                                        requests: requests.length,
                                        errors: 0,
                                        upstream: { ok: true, status: 200 },
                                        upstreamKeyIsSet: true,
                                        authRequired: false,
                                        upstreamUrl: `${state.url}/v1`,
                                        defaultModel: "kimi-k2.5",
                                        models: ["kimi-k2.5", "mock-kimi"],
                                });
                        }

                        if (req.method === "GET" && url.pathname === "/v1/models") {
                                if (opts.modelsStatus && opts.modelsStatus !== 200) {
                                        return Response.json({ error: { message: "bad key", type: "auth" } }, { status: opts.modelsStatus });
                                }
                                return Response.json({
                                        object: "list",
                                        data: [
                                                { id: "kimi-k2.5", object: "model", owned_by: "llm-bridge" },
                                                { id: "mock-kimi", object: "model", owned_by: "llm-bridge" },
                                        ],
                                });
                        }

                        if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
                                const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
                                const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
                                const last = messages[messages.length - 1];
                                const lastIsUser = last?.role === "user";
                                const userTexts = messages
                                        .filter((m) => m?.role === "user")
                                        .map((m) => {
                                                const raw = m?.content;
                                                return typeof raw === "string"
                                                        ? raw
                                                        : Array.isArray(raw)
                                                                        ? raw
                                                                                        .filter((p) => (p as Record<string, unknown>)?.type === "text")
                                                                                        .map((p) => String((p as Record<string, unknown>).text ?? ""))
                                                                                        .join(" ")
                                                                        : "";
                                        });
                                // Scan every user message for a TOOLCALL script (the user prompt may
                                // not be the last user message — the CLI appends context after it).
                                const script = lastIsUser
                                        ? userTexts.map((t) => t.match(/TOOLCALL (\w+) (\{.*\})\s*$/)).find(Boolean)
                                        : null;
                                // JSONREPLY script: the (subagent) task text embeds
                                // `JSONREPLY <json>` — the mock replies with exactly that JSON
                                // (for task-tool structured-output tests: schema-valid/invalid
                                // replies are scripted per test).
                                const jsonReply = userTexts
                                        .map((t) => t.match(/JSONREPLY (\{[\s\S]*\}|\[[\s\S]*\])\s*$/))
                                        .find(Boolean);

                                requests.push({
                                        ts: Date.now(),
                                        model: String(body.model ?? "?"),
                                        tools: (Array.isArray(body.tools) ? body.tools : []).map(
                                                (t: Record<string, any>) => t?.function?.name ?? t?.name ?? t?.type,
                                        ),
                                        stream: body.stream === true,
                                        roles: messages.map((m) => String(m.role)),
                                });

                                const model = String(body.model ?? "kimi-k2.5");
                                const content = jsonReply ? jsonReply[1] : "Mock reply: done";
                                const id = `chatcmpl-mock-${++seq}`;
                                const frame = (choices: unknown[], usage?: unknown) =>
                                        new TextEncoder().encode(
                                                `data: ${JSON.stringify({
                                                        id,
                                                        object: "chat.completion.chunk",
                                                        created: Math.floor(Date.now() / 1000),
                                                        model,
                                                        choices,
                                                        ...(usage ? { usage } : {}),
                                                })}\n\n`,
                                        );
                                const stream = new ReadableStream({
                                        start(c) {
                                                c.enqueue(frame([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]));
                                                if (script) {
                                                        const [, name, args] = script;
                                                        c.enqueue(
                                                                frame([
                                                                        {
                                                                                index: 0,
                                                                                delta: {
                                                                                        tool_calls: [
                                                                                                { index: 0, id: `call-${seq}`, type: "function", function: { name, arguments: args } },
                                                                                        ],
                                                                                },
                                                                                finish_reason: null,
                                                                        },
                                                                ]),
                                                        );
                                                        c.enqueue(
                                                                frame([{ index: 0, delta: {}, finish_reason: "tool_calls" }], {
                                                                        prompt_tokens: 11,
                                                                        completion_tokens: 7,
                                                                        total_tokens: 18,
                                                                }),
                                                        );
                                                } else {
                                                        c.enqueue(frame([{ index: 0, delta: { content }, finish_reason: null }]));
                                                        c.enqueue(
                                                                frame([{ index: 0, delta: {}, finish_reason: "stop" }], {
                                                                        prompt_tokens: 11,
                                                                        completion_tokens: 7,
                                                                        total_tokens: 18,
                                                                }),
                                                        );
                                                }
                                                c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                                                c.close();
                                        },
                                });
                                return new Response(stream, {
                                        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
                                });
                        }

                        return Response.json({ error: { message: `Not found: ${req.method} ${url.pathname}` } }, { status: 404 });
                },
        });

        state.port = server.port;
        state.url = `http://127.0.0.1:${server.port}`;
        state.close = () => server.stop(true);
        return state;
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

/** Roots created by runUnown — swept by sweepTestRoots() (afterAll). */
const pendingRoots: string[] = [];

/** Delete every temp root created by runUnown (idempotent, force). */
export function sweepTestRoots(): void {
        for (const root of pendingRoots) {
                try {
                        rmSync(root, { recursive: true, force: true });
                } catch {
                        /* best effort — /tmp is janitor-swept */
                }
        }
        pendingRoots.length = 0;
}

export interface UnownRunResult {
        exitCode: number;
        stdout: string;
        stderr: string;
        command: string;
        /** Private UNOWN_HOME used for this run. */
        unownHome: string;
        /** Private project cwd used for this run. */
        projDir: string;
        /** Temp root holding unownHome/projDir/db — removed by release(). */
        root: string;
        release(): void;
}

export interface UnownRunOptions {
        bridge: MockBridge;
        /** Extra env on top of the sanitized defaults (e.g. UNOWN_NO_PREFLIGHT=1). */
        env?: Record<string, string>;
        /** Override the bridge URL (default: the passed mock bridge). */
        bridgeUrl?: string;
        /** Override UNOWN_ENGINE_URL (default: dead loopback port). */
        engineUrl?: string;
        /** Hard per-run timeout in ms (default 90 000). */
        timeoutMs?: number;
        /** Fresh dirs to create up-front (home/proj are made regardless). */
        root?: string;
        /** Run `bun bin/unown` explicitly (portable when the exec bit is missing). */
        viaBun?: boolean;
}

/**
 * Run `bin/unown <args>` with /dev/null stdin under a private UNOWN_HOME +
 * project dir; resolves when the process exits. Throws on timeout. The temp
 * root is kept (read files via the result) — call run.release() individually
 * or sweep everything with sweepTestRoots() in afterAll.
 */
export async function runUnown(args: string[], opts: UnownRunOptions): Promise<UnownRunResult> {
        const root = opts.root ?? mkdtempSync(join(tmpdir(), "unown-cli-test-"));
        if (!opts.root) pendingRoots.push(root); // swept by sweepTestRoots()
        const unownHome = join(root, "home");
        const projDir = join(root, "proj");
        mkdirSync(unownHome, { recursive: true });
        mkdirSync(projDir, { recursive: true });

        // Sanitized env: strip every project knob, then set the hermetic ones.
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
                if (v === undefined) continue;
                if (/^(UNOWN_|PI_|BRIDGE_)/.test(k)) continue;
                env[k] = v;
        }
        env.UNOWN_HOME = unownHome;
        env.UNOWN_ENGINE_URL = opts.engineUrl ?? DEAD_URL;
        env.PI_BRIDGE_URL = opts.bridgeUrl ?? opts.bridge.url;
        env.PI_SELFLEARNING_DB = join(root, "db", "selflearning.db");
        env.PI_SELFLEARNING_DATA = join(root, "data");
        for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v;

        const cmd = opts.viaBun ? ["bun", UNOWN_BIN, ...args] : [UNOWN_BIN, ...args];
        const child = spawn(cmd[0], cmd.slice(1), { cwd: projDir, env, stdio: ["ignore", "pipe", "pipe"] });

        const timeoutMs = opts.timeoutMs ?? 90_000;
        let timedOut = false;
        const timer = setTimeout(() => {
                timedOut = true;
                child.kill("SIGKILL");
        }, timeoutMs);

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        child.stdout.on("data", (c) => stdoutChunks.push(Buffer.from(c)));
        child.stderr.on("data", (c) => stderrChunks.push(Buffer.from(c)));

        const command = `unown ${args.join(" ")}`;

        try {
                const code: number | null = await new Promise((resolve) => {
                        child.on("close", (c) => resolve(c));
                        child.on("error", (err) => {
                                console.error(`runUnown spawn error for ${command}: ${err?.message ?? err}`);
                                resolve(-1);
                        });
                });
                if (timedOut) throw new Error(`runUnown timed out after ${timeoutMs}ms: ${command}`);
                return {
                        exitCode: code ?? -1,
                        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
                        stderr: Buffer.concat(stderrChunks).toString("utf8"),
                        command,
                        unownHome,
                        projDir,
                        root,
                        release: () => {
                                const i = pendingRoots.indexOf(root);
                                if (i >= 0) pendingRoots.splice(i, 1);
                                try {
                                        rmSync(root, { recursive: true, force: true });
                                } catch {
                                        /* best effort — /tmp is janitor-swept */
                                }
                        },
                };
        } finally {
                clearTimeout(timer);
        }
}

/**
 * Run + await. The temp root is KEPT (golden tests read seeded files from it
 * after the run — `unown()` used to release eagerly, which deleted the files
 * before assertions ran). Roots are swept collectively by sweepTestRoots()
 * in afterAll, or individually via run.release().
 */
export async function unown(args: string[], opts: UnownRunOptions): Promise<UnownRunResult> {
        return runUnown(args, opts);
}

// ---------------------------------------------------------------------------
// Utilities shared by the golden tests
// ---------------------------------------------------------------------------

/** Read a UTF-8 file relative to a run's private UNOWN_HOME (agent dir). */
export function agentFile(run: UnownRunResult, name: string): string | null {
        const p = join(run.unownHome, "agent", name);
        return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** Parse JSONL stdout into event objects (throws on non-JSON lines). */
export function parseJsonl(stdout: string): Array<Record<string, any>> {
        return stdout
                .split("\n")
                .filter((l) => l.trim().length > 0)
                .map((l) => JSON.parse(l));
}

/** List .md files in a run's note outbox. */
export function outboxNotes(run: UnownRunResult): string[] {
        const dir = join(run.unownHome, "notes", "outbox");
        if (!existsSync(dir)) return [];
        return readdirSync(dir).filter((f) => f.endsWith(".md"));
}
