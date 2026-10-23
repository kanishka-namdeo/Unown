/**
 * adversary.ts — Adversary Mode PreToolUse reviewer (Milestone 1.4).
 *
 * File-gated LLM reviewer reverse-engineered from goose's
 * `crates/goose/src/security/adversary_inspector.rs:14-299`. When the gate
 * file (`~/.config/unown/adversary.md` by default) exists, every PreToolUse
 * call in the configured allowlist (bash / powershell / write / edit by
 * default) is sent to an LLM with the gate file's policy as the system
 * instruction and a redacted, truncated snapshot of the input as the user
 * message. The model's first line containing `BLOCK` (case-insensitive)
 * blocks the call; `ALLOW` (or anything ambiguous) lets it through. On LLM
 * error/timeout the default-allow posture is kept unless `failClosed: true`.
 *
 * Why file-gated (goose's design, kept verbatim): the reviewer is opt-in by
 * touching a file the agent itself cannot create (it lives outside the
 * sandbox jail). No file → no LLM call → no tokens spent → no latency.
 * Mirrors `goose`'s `~/.config/goose/adversary.md` original; the unown
 * equivalent lives at `${UNOWN_HOME || ~/.unown}/.config/unown/adversary.md`
 * — separate from `UNOWN_AGENT_DIR` because the gate file is a user-authored
 * policy document, not engine state.
 *
 * Purity: `node:fs` + `node:os` + `node:path` only. No pi imports. The LLM
 * call is injected by the caller (the same `callLlm` function used by the
 * `prompt` hook handler in `hooks-config.ts`), so this module is fully
 * unit-testable with a mock. The decision type is structurally compatible
 * with `PreToolDecision` in `hooks.ts` (`{block: boolean; reason?: string}`).
 *
 * Composition with hooks.ts: `decideAdversary` is the second guard in the
 * PreToolUse chain — after `decideBash`/`jailPath` (built-in policies) and
 * before the user-configured multi-type hooks. If the built-in policies
 * already blocked, the adversary is skipped. If the adversary blocks, the
 * user hooks are skipped. Both log to the `hook_log` table via the caller.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default review-tools allowlist: the destructive surface only. */
const DEFAULT_TOOLS = ["bash", "powershell", "write", "edit"];

/** Default LLM-call timeout (ms) — matches goose's adversary_inspector. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Per-input-field truncation limit (2 KB) — spec §"Input truncation". */
const FIELD_LIMIT = 2 * 1024;

/** Total LLM-prompt truncation limit (8 KB) — spec §"Input truncation". */
const PROMPT_LIMIT = 8 * 1024;

/** Truncation marker appended to a truncated field/prompt. */
const FIELD_MARKER = "…[truncated]";
const PROMPT_MARKER = "…[prompt truncated]";

/**
 * Default the model id to PI_MODEL_ID (the same env var llm.ts / runner.ts /
 * term.ts use), falling back to `kimi-k2.5` for parity with the rest of the
 * codebase. `||`, not `??`: empty .env values must mean "unset" (see
 * term.ts:resolveUnownHome for the full story — bun auto-loads `.env`, and
 * `.env.example` ships optional vars as `KEY=`).
 */
const DEFAULT_MODEL = process.env.PI_MODEL_ID || "kimi-k2.5";

/**
 * Config dir for the adversary gate file. `${UNOWN_HOME || ~/.unown}` is the
 * unown user-state root; the gate file lives under a `.config/unown/`
 * subdirectory mirroring goose's `~/.config/goose/` original. `||`, not
 * `??`: same empty-env-value rule as DEFAULT_MODEL.
 *
 * NOTE: this is intentionally NOT `UNOWN_AGENT_DIR` (`${UNOWN_HOME}/agent`).
 * The agent dir holds engine state (models.json, sessions/); the gate file
 * is a user-authored policy document that lives one level up + under a
 * `.config` prefix, matching the XDG-ish convention goose uses.
 *
 * Computed lazily inside `adversaryPath()` (NOT captured at module load) so
 * a long-running process that re-sets `UNOWN_HOME` (e.g. tests, multi-tenant
 * runners) sees the new path on the next call — matches
 * `term.ts:resolveUnownHome(env)`'s test-time-overridable pattern.
 */
function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
        return env.UNOWN_HOME || join(homedir(), ".config", "unown");
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Decision returned by `decideAdversary`. Structurally compatible with
 * `PreToolDecision` in `hooks.ts` (same field names + types) so the caller
 * can assign the result directly without a remap.
 */
export interface PreToolDecision {
        block: boolean;
        reason?: string;
}

/** Configuration for the adversary reviewer. */
export interface AdversaryConfig {
        /**
         * Master kill-switch. When `false`, `decideAdversary` returns
         * `{block:false}` immediately — useful for tests and for env-driven
         * disable (`UNOWN_ADVERSARY=0`). Defaults to `true` (the gate file's
         * existence is the actual gate).
         */
        enabled: boolean;
        /**
         * Path to the gate file. Existence is what activates the reviewer —
         * `decideAdversary` returns `{block:false}` immediately when the
         * file doesn't exist. Defaults to `adversaryPath()`.
         */
        gateFilePath: string;
        /** Model override (defaults to `PI_MODEL_ID` env var, then `kimi-k2.5`). */
        model?: string;
        /** Per-call LLM timeout in ms (default 30000). */
        timeoutMs?: number;
        /** Tool allowlist (default `["bash","powershell","write","edit"]`). */
        tools?: string[];
        /**
         * On LLM error/timeout: `true` → block (conservative, may lock the
         * agent out if the LLM is down); `false` → allow (default — hooks
         * augment, not replace, the built-in policies).
         */
        failClosed?: boolean;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the default adversary gate file path:
 * `${UNOWN_HOME || ~/.unown}/.config/unown/adversary.md`. Cross-platform —
 * `node:path.join` picks the right separator; the `.config` prefix works on
 * Windows too (node doesn't care about dot-prefixed dirs).
 */
export function adversaryPath(): string {
        return join(resolveConfigDir(), "adversary.md");
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

interface SecretPattern {
        re: RegExp;
        type: string;
}

/**
 * Common secret shapes that must never reach the LLM. Patterns sourced from
 * the spec, mirroring the prompt-injection scanner's posture in
 * `injection-scanner.ts` (the sibling guard). All patterns carry the `g`
 * flag so a single `.replace()` call redacts every occurrence.
 *
 * Order matters: PEM blocks (multi-line) are matched first so the inner
 * `AKIA…`-style noise they sometimes embed doesn't double-trigger.
 */
const SECRET_PATTERNS: SecretPattern[] = [
        // PEM-encoded private keys (entire BEGIN..END block, multiline). MUST
        // come before the others: a PEM body can contain `AKIA…`-like noise
        // that would otherwise produce a leaky double-redaction.
        { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, type: "pem" },
        // OpenAI / Anthropic keys: sk-...
        { re: /sk-[a-zA-Z0-9-_]{20,}/g, type: "sk-key" },
        // GitHub PATs (classic): ghp_...
        { re: /ghp_[a-zA-Z0-9]{36,}/g, type: "ghp-key" },
        // GitHub fine-grained PATs: github_pat_...
        { re: /github_pat_[a-zA-Z0-9_]{20,}/g, type: "github-pat" },
        // AWS access keys: AKIA...
        { re: /AKIA[0-9A-Z]{16}/g, type: "aws-ak" },
        // Bearer tokens (Authorization: Bearer <token> in headers/commands).
        { re: /Bearer [a-zA-Z0-9._-]{20,}/g, type: "bearer" },
];

/**
 * Redact known secret shapes from `s`, replacing each with
 * `[REDACTED:<type>]`. Pure (no I/O), idempotent (a second pass is a no-op
 * — the marker `REDACTED:` is not itself a secret shape).
 *
 * Exported for unit tests + for the sibling `injection-scanner.ts` to reuse
 * (the two PreToolUse guards share the same secret posture).
 */
export function redactSecrets(s: string): string {
        let out = s;
        for (const { re, type } of SECRET_PATTERNS) {
                // Each pattern has the `g` flag, so this replaces every occurrence.
                // `re` is module-scoped (never reused with `.lastIndex` state
                // leaking), so we don't need to manually reset it.
                out = out.replace(re, `[REDACTED:${type}]`);
        }
        return out;
}

/** Counting variant of {@link redactSecrets} for share/transfer surfaces:
 *  the same table and markers, plus how many secrets were caught (drives the
 *  "N secrets redacted before export" notice) and per-occurrence SHA-256[:16]
 *  digests of the redacted material — non-reversible, so the user can verify
 *  after the fact WHICH secret was caught without the artifact carrying it.
 *  The replace callback (not a replacement string) is used so a `$`-bearing
 *  secret can never be interpreted as a replacement pattern. Pure. */
export function redactSecretsCounted(s: string): { text: string; count: number; digests: string } {
        let count = 0;
        const digests: string[] = [];
        let out = s;
        for (const { re, type } of SECRET_PATTERNS) {
                out = out.replace(re, (secret) => {
                        count++;
                        digests.push(createHash("sha256").update(secret).digest("hex").slice(0, 16));
                        return `[REDACTED:${type}]`;
                });
        }
        return { text: out, count, digests: digests.join(",") };
}

// ---------------------------------------------------------------------------
// Input truncation
// ---------------------------------------------------------------------------

/**
 * Cap `s` at `limit` characters, replacing the tail with `marker` so the
 * truncation is visible to the model. The marker counts toward `limit`
 * (the returned string is always `<= limit` chars). Pure.
 */
function cap(s: string, limit: number, marker: string): string {
        if (s.length <= limit) return s;
        const head = Math.max(0, limit - marker.length);
        return s.slice(0, head) + marker;
}

/**
 * Coerce a single input-field value to a string, redact secrets, and
 * truncate to `FIELD_LIMIT` (2 KB). Non-string values are JSON-stringified
 * (catching throws → `String(v)` as the ultimate fallback). Pure.
 */
function truncateField(v: unknown): string {
        let s: string;
        if (typeof v === "string") {
                s = v;
        } else if (v === null || v === undefined) {
                s = "";
        } else if (typeof v === "number" || typeof v === "boolean") {
                s = String(v);
        } else {
                try {
                        s = JSON.stringify(v) ?? String(v);
                } catch {
                        s = String(v);
                }
        }
        s = redactSecrets(s);
        return cap(s, FIELD_LIMIT, FIELD_MARKER);
}

/**
 * Build the user-facing review prompt: tool name + each input field
 * (redacted + truncated to 2 KB), capped at 8 KB total. Pure — no I/O.
 *
 * Exported for unit tests + for the caller to inspect what would be sent
 * without invoking the LLM (e.g. for `/doctor` diagnostics).
 */
export function buildReviewPrompt(tool: string, input: Record<string, unknown>): string {
        const lines: string[] = [`Tool: ${tool}`];
        const keys = Object.keys(input ?? {});
        if (keys.length > 0) {
                lines.push("Input:");
                for (const k of keys) {
                        lines.push(`  ${k}: ${truncateField((input as any)[k])}`);
                }
        }
        return cap(lines.join("\n"), PROMPT_LIMIT, PROMPT_MARKER);
}

// ---------------------------------------------------------------------------
// LLM call with timeout
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
        constructor(ms: number) {
                super(`adversary LLM call timed out after ${ms}ms`);
                this.name = "TimeoutError";
        }
}

/**
 * Race `callLlm(prompt, model)` against a `setTimeout` deadline. Resolves
 * with the model's reply string, or rejects with a `TimeoutError`. Never
 * throws synchronously — the rejection is always an `Error` subclass that
 * the caller can `await … catch`.
 *
 * The timer is `unref()`'d on platforms that support it so the test process
 * can exit cleanly even if the LLM call is still pending (Bun + Node both
 * honor `unref`).
 */
function callWithTimeout(
        callLlm: (prompt: string, model?: string) => Promise<string>,
        prompt: string,
        model: string | undefined,
        timeoutMs: number,
): Promise<string> {
        return new Promise<string>((resolve, reject) => {
                const timer: any = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
                // Allow the event loop to exit while the timer is pending.
                if (timer && typeof timer.unref === "function") timer.unref();
                callLlm(prompt, model)
                        .then((reply) => {
                                clearTimeout(timer);
                                resolve(reply);
                        })
                        .catch((err) => {
                                clearTimeout(timer);
                                reject(err instanceof Error ? err : new Error(String(err)));
                        });
        });
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the model's reply: the first non-empty line containing the substring
 * `BLOCK` (case-insensitive) blocks the call — the rest of that line (after
 * `BLOCK`) is surfaced as the reason, falling back to a default reason when
 * empty. If no `BLOCK` line is found, the first non-empty line containing
 * `ALLOW` (case-insensitive) lets the call through. Otherwise the call is
 * allowed (default-allow when ambiguous — the field's posture is that hooks
 * augment, not replace, the built-in policies).
 *
 * Substring match (not word-bounded) per the spec: `BLOCKED: foo` matches
 * and the reason is `ED: foo` (stripped of leading punctuation → `ED: foo`
 * — the model is responsible for emitting the keyword on its own line if it
 * wants a clean reason). Exported for unit tests.
 */
export function parseAdversaryReply(reply: string): PreToolDecision {
        const lines = reply.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const lower = line.toLowerCase();
                const blockIdx = lower.indexOf("block");
                if (blockIdx >= 0) {
                        // Rest of the line after the "block" keyword, with leading
                        // separator chars (whitespace, colons, hyphens, em-colons)
                        // stripped.
                        let rest = line
                                .slice(blockIdx + "block".length)
                                .replace(/^[\s:：\-]+/, "")
                                .trim();
                        if (!rest) {
                                // Spec: "<rest of line or model output>". Fall back to the
                                // remaining non-empty lines (joined) for the reason.
                                rest = lines
                                        .slice(i + 1)
                                        .map((l) => l.trim())
                                        .filter(Boolean)
                                        .join(" ")
                                        .trim();
                        }
                        return { block: true, reason: rest || "adversary reviewer blocked the call" };
                }
                if (lower.includes("allow")) {
                        return { block: false };
                }
        }
        return { block: false };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Decide whether to block a PreToolUse call via the adversary LLM reviewer.
 *
 * Flow (matches the spec verbatim):
 * 1. `cfg.enabled === false` OR gate file missing → `{block:false}` (the
 *    "file-gated" semantics: no file, no review, no tokens spent).
 * 2. `tool` not in `cfg.tools` (default `bash`/`powershell`/`write`/`edit`)
 *    → `{block:false}` (the reviewer only sees destructive surface).
 * 3. `callLlm` missing → `{block:false}` (no LLM = no review).
 * 4. Build the review prompt (redacted + truncated) from `input`.
 * 5. Call `callLlm(prompt, cfg.model)` with timeout (race against
 *    `setTimeout`).
 * 6. Parse the model's reply (first `BLOCK`/`ALLOW` line wins; ambiguous →
 *    allow).
 * 7. On LLM timeout/error: `cfg.failClosed` → `{block:true, reason}`;
 *    else → `{block:false}` (default-allow on error).
 *
 * Async because step 5 awaits the LLM. The caller in `hooks.ts` is an async
 * `pi.on("tool_call", ...)` handler — `decideAdversary` is awaited there.
 */
export async function decideAdversary(
        tool: string,
        input: Record<string, unknown>,
        cfg?: AdversaryConfig,
        callLlm?: (prompt: string, model?: string) => Promise<string>,
): Promise<PreToolDecision> {
        // Step 1: enabled + gate file.
        const enabled = cfg?.enabled ?? true;
        if (!enabled) return { block: false };
        const gatePath = cfg?.gateFilePath ?? adversaryPath();
        if (!existsSync(gatePath)) return { block: false };

        // Step 2: tool allowlist.
        const tools = cfg?.tools ?? DEFAULT_TOOLS;
        if (!tools.includes(tool)) return { block: false };

        // Step 3: callLlm required.
        if (!callLlm) return { block: false };

        // Step 4: read the gate file (policy) + build the review prompt.
        // Race: file was deleted between existsSync and readFileSync — treat
        // as "no policy"; the LLM alone decides (consistent with goose's
        // behavior when the policy section is empty).
        let policy = "";
        try {
                policy = readFileSync(gatePath, "utf8");
        } catch {
                policy = "";
        }
        const reviewPrompt = buildReviewPrompt(tool, input);

        const model = cfg?.model ?? DEFAULT_MODEL;
        const timeoutMs = cfg?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const failClosed = cfg?.failClosed ?? false;

        // Steps 5-6: LLM call + parse.
        try {
                // Compose the final LLM prompt: policy (system instruction) +
                // review request + reply instruction. Capped at PROMPT_LIMIT so
                // a runaway policy document can't blow the prompt budget.
                let fullPrompt =
                        `=== Adversary Policy ===\n${policy}\n\n=== Review Request ===\n${reviewPrompt}\n\nReply with BLOCK: <reason> or ALLOW.`;
                fullPrompt = cap(fullPrompt, PROMPT_LIMIT, PROMPT_MARKER);
                const reply = await callWithTimeout(callLlm, fullPrompt, model, timeoutMs);
                return parseAdversaryReply(reply);
        } catch (err: any) {
                // Step 7: error/timeout posture.
                const msg = err instanceof Error ? err.message : String(err);
                if (failClosed) {
                        return { block: true, reason: `adversary reviewer error: ${msg}` };
                }
                return { block: false };
        }
}
