/**
 * context-tools.ts — `get_context_remaining` + `view_image` agent tools.
 *
 * Reverse-engineered from codex CLI's `tools/handlers/get_context_remaining.rs`
 * and `tools/handlers/view_image.rs` (Milestone 2.4 of the SDLC feature
 * roadmap). Both register as new agent tools via `pi.registerTool` and
 * follow the registration pattern from `websearch.ts` (the unown-tools
 * extension calls `registerContextTools(pi, { cwd, verbose })`).
 *
 *   - `get_context_remaining` — surface the active model's context-window
 *     utilization. Uses `ctx.getContextUsage()` (the documented pi
 *     ExtensionContext seam) when available, and falls back to a chars/4
 *     estimate of the message history when the host does not expose one.
 *
 *   - `view_image` — read an image file from disk (jailed to the project
 *     root + the system tmp dir) and convert it to a base64 data URL /
 *     Anthropic vision-format image content block. Validates magic bytes
 *     (PNG / JPEG / GIF / WebP) and caps file size at 4 MB.
 */
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Magic-byte tables
// ---------------------------------------------------------------------------

/** The image MIME types we accept. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

interface ImageSignature {
    mediaType: ImageMediaType;
    /** Magic prefix bytes (compared against the file head). */
    magic: number[];
}

/**
 * Image signatures in priority order. PNG / JPEG / GIF are recognized by
 * fixed byte prefixes; WebP needs `RIFF....WEBP` (a four-cc at offset 8).
 */
const IMAGE_SIGNATURES: ImageSignature[] = [
    { mediaType: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mediaType: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
    { mediaType: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] }, // "GIF8"
];

const WEBP_RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_FORMAT_TAG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

/** Cap on the size of an image we will load into context (4 MB). */
export const VIEW_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Validate the file's magic bytes and return the MIME type, or null when
 * the file is not a recognized image. WebP needs both the `RIFF` head and
 * the `WEBP` four-cc at offset 8.
 *
 * Pure — exported for tests. Aliased as `validateImageMagic` to match the
 * Milestone 2.4 task spec naming (codex CLI's `view_image.rs` helper).
 */
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType | null {
    if (bytes.length >= 8 && WEBP_RIFF_MAGIC.every((b, i) => bytes[i] === b) && WEBP_FORMAT_TAG.every((b, i) => bytes[8 + i] === b)) {
        return "image/webp";
    }
    for (const sig of IMAGE_SIGNATURES) {
        if (bytes.length >= sig.magic.length && sig.magic.every((b, i) => bytes[i] === b)) {
            return sig.mediaType;
        }
    }
    return null;
}

/** Alias of {@link detectImageMediaType} — codex-spec'd name. */
export const validateImageMagic = detectImageMediaType;

/**
 * Encode a byte buffer as a `data:<mime>;base64,<...>` data URL.
 * Pure — exported for tests.
 */
export function encodeImageAsDataUrl(bytes: Uint8Array, mimeType: ImageMediaType | string): string {
    const base64 = Buffer.from(bytes).toString("base64");
    return `data:${mimeType};base64,${base64}`;
}

// ---------------------------------------------------------------------------
// Path jail (project root + /tmp)
// ---------------------------------------------------------------------------

/**
 * Resolve `p` against the project root, then verify it does not escape.
 * The system tmp dir is also a permitted root (vision fixtures live there).
 * Returns `{ ok, resolved }`. Pure — exported for tests.
 */
export function jailImagePath(projectRoot: string, p: string, systemTmp: string = tmpdir()): { ok: boolean; resolved: string; reason?: string } {
    if (typeof p !== "string" || p.length === 0) return { ok: false, resolved: "", reason: "path is empty" };
    if (!isAbsolute(p)) return { ok: false, resolved: "", reason: `path must be absolute (got ${JSON.stringify(p)})` };
    const resolved = resolvePath(p);
    const roots = [resolvePath(projectRoot), resolvePath(systemTmp)];
    const inside = (root: string) => resolved === root || resolved.startsWith(`${root}/`) || resolved.startsWith(`${root}\\`);
    if (!roots.some(inside)) {
        return {
            ok: false,
            resolved,
            reason: `path escapes the project root and tmp dir (allowed roots: ${roots.map((r) => JSON.stringify(r)).join(", ")})`,
        };
    }
    return { ok: true, resolved };
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

const GetContextRemainingParams = Type.Object({}, { additionalProperties: true });

const ViewImageParams = Type.Object({
    path: Type.String({ description: "Absolute path to an image file (PNG / JPEG / GIF / WebP). Must be inside the project root or the system tmp dir; capped at 4 MB." }),
});

// ---------------------------------------------------------------------------
// get_context_remaining — token budget estimate
// ---------------------------------------------------------------------------

export interface ContextRemainingResult {
    tokensUsed: number;
    maxTokens: number;
    remainingTokens: number;
    remainingPercent: number;
}

/**
 * Default context-window size (tokens) when neither `PI_MAX_TOKENS` nor a
 * pi-reported `contextWindow` is available. Matches codex CLI's
 * `get_context_remaining.rs` default (and the model most users hit
 * first — Claude / GPT-class 200k windows).
 */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Resolve the active model's max context window. Priority:
 *
 *   1. `PI_MAX_TOKENS` env var override (explicit user / harness config)
 *   2. `contextWindow` reported by pi's `ctx.getContextUsage()` (the
 *      documented seam — matches the active model's true window)
 *   3. {@link DEFAULT_CONTEXT_WINDOW} (200 000)
 *
 * Pure — exported for tests.
 */
export function resolveMaxTokens(reportedContextWindow?: number): number {
    const env = process.env.PI_MAX_TOKENS ?? "";
    const trimmed = env.trim();
    if (trimmed.length > 0) {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
    if (typeof reportedContextWindow === "number" && reportedContextWindow > 0) return reportedContextWindow;
    return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Estimate the token count for an arbitrary message history using the
 * 4-chars-per-token heuristic pi itself uses (`estimateTokens` in
 * `compaction.ts`). Walks every block (text, tool_use input, tool_result
 * content) defensively — a malformed message never throws.
 *
 * Accepts the shapes pi's session emits:
 *
 *   - `[{ role, content: "string" | ContentBlock[] }]` — pi AgentMessage[]
 *   - `[{ type: "message", message: { role, content } }]` — pi session entries
 *   - any partial / nested shape — visited defensively
 *
 * Pure — exported for tests.
 */
export function estimateTokensUsed(messages: unknown): number {
    if (messages == null) return 0;
    let chars = 0;
    try {
        const visit = (v: unknown): void => {
            if (v == null) return;
            if (typeof v === "string") {
                chars += v.length;
                return;
            }
            if (typeof v === "number" || typeof v === "boolean") {
                chars += String(v).length;
                return;
            }
            if (typeof v !== "object") return;
            if (Array.isArray(v)) {
                for (const item of v) visit(item);
                return;
            }
            const obj = v as Record<string, unknown>;
            // Text blocks carry their payload as `.text`.
            if (typeof obj.text === "string") chars += obj.text.length;
            // Tool result blocks carry `.content` (string | array). Tool-use
            // blocks carry `.input` (object). Recurse into arrays/objects so
            // nested content (e.g. tool_result.content[].text) is counted.
            if (typeof obj.content === "string") {
                chars += obj.content.length;
            } else if (obj.content != null && typeof obj.content === "object") {
                visit(obj.content);
            }
            if (obj.input != null && typeof obj.input === "object") {
                try {
                    chars += JSON.stringify(obj.input).length;
                } catch {
                    /* circular / unstringifiable — skip */
                }
            }
            // Recurse into remaining object fields (e.g. message.content).
            for (const key of Object.keys(obj)) {
                if (key === "text" || key === "content" || key === "input") continue;
                const child = obj[key];
                if (child != null && typeof child === "object") visit(child);
            }
        };
        visit(messages);
    } catch {
        /* defensive: never throw on malformed input */
    }
    return Math.ceil(chars / 4);
}

/**
 * Build a {@link ContextRemainingResult} from pi's `ContextUsage` (the
 * documented seam — null when the host hasn't reported one yet, e.g.
 * before the first LLM response). Falls back to a chars/4 estimate of
 * the message history when usage is unknown.
 *
 * Pure — exported for tests.
 */
export function buildContextRemaining(args: {
    tokens: number | null;
    contextWindow: number | undefined;
    fallbackCharCount?: number;
}): ContextRemainingResult {
    const maxTokens = resolveMaxTokens(args.contextWindow);
    let used: number;
    if (typeof args.tokens === "number" && args.tokens >= 0) {
        used = args.tokens;
    } else if (typeof args.fallbackCharCount === "number" && args.fallbackCharCount >= 0) {
        // The standard 4-chars-per-token approximation pi itself uses
        // (compaction.ts:estimateTokens — see pi-repo/packages/agent).
        used = Math.ceil(args.fallbackCharCount / 4);
    } else {
        used = 0;
    }
    const remaining = Math.max(0, maxTokens - used);
    const percent = maxTokens > 0 ? Number(((remaining / maxTokens) * 100).toFixed(1)) : 0;
    return {
        tokensUsed: used,
        maxTokens,
        remainingTokens: remaining,
        remainingPercent: percent,
    };
}

// ---------------------------------------------------------------------------
// view_image — file → base64 data URL
// ---------------------------------------------------------------------------

export interface ViewImageResult {
    mediaType: ImageMediaType;
    dataUrl: string;
    bytes: number;
}

/**
 * Read an image file from disk, validate it, and convert it to a base64
 * data URL. Pure-ish (uses fs + path) — exported for tests so the magic
 * byte / size / jail validation is assertable without a fake pi.
 */
export function readImageFile(projectRoot: string, p: string, opts: { systemTmp?: string; maxBytes?: number } = {}): ViewImageResult {
    const jail = jailImagePath(projectRoot, p, opts.systemTmp);
    if (!jail.ok) throw new Error(`view_image: ${jail.reason}`);
    let stat;
    try {
        stat = statSync(jail.resolved);
    } catch (err) {
        throw new Error(`view_image: cannot stat ${JSON.stringify(jail.resolved)} — ${(err as Error).message}`);
    }
    if (!stat.isFile()) throw new Error(`view_image: ${JSON.stringify(jail.resolved)} is not a regular file`);
    const maxBytes = opts.maxBytes ?? VIEW_IMAGE_MAX_BYTES;
    if (stat.size > maxBytes) {
        throw new Error(`view_image: file is ${stat.size} bytes — exceeds the ${maxBytes} byte (${Math.round(maxBytes / (1024 * 1024))} MB) cap`);
    }
    let bytes: Uint8Array;
    try {
        const buf = readFileSync(jail.resolved);
        bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
        throw new Error(`view_image: cannot read ${JSON.stringify(jail.resolved)} — ${(err as Error).message}`);
    }
    const mediaType = detectImageMediaType(bytes);
    if (!mediaType) {
        throw new Error(`view_image: ${JSON.stringify(jail.resolved)} is not a recognized image (magic bytes do not match PNG/JPEG/GIF/WebP)`);
    }
    const dataUrl = encodeImageAsDataUrl(bytes, mediaType);
    return { mediaType, dataUrl, bytes: bytes.length };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export interface ContextToolsOptions {
    /** The user's real project directory — used as the path jail root. */
    cwd: string;
    /** Label prefix for log lines. */
    verbose?: boolean;
}

/**
 * Registers `get_context_remaining` + `view_image` on a pi ExtensionAPI.
 * Used by the unown-tools extension (terminal sessions).
 *
 * The pi `ExtensionContext` exposes `getContextUsage(): { tokens, contextWindow, percent } | undefined`
 * (pi-repo/packages/coding-agent/src/core/extensions/types.ts:344) — the
 * `get_context_remaining` tool uses it when available and falls back to a
 * chars/4 estimate of the visible message history when the host hasn't
 * reported one yet.
 */
export function registerContextTools(pi: ExtensionAPI, opts: ContextToolsOptions): void {
    const log = (msg: string) => {
        if (opts.verbose) console.error(`[unown-context] ${msg}`);
    };

    pi.registerTool({
        name: "get_context_remaining",
        label: "Context remaining",
        description:
            "Estimate the remaining context window for the current session. Returns the count of tokens used so far (approximate), the model's max context window, and the remaining tokens. Use this to decide whether to compact, summarize, or hand off to a subagent before the model loses early turns.",
        parameters: GetContextRemainingParams,
        async execute(_toolCallId: string, _params: object, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
            try {
                // ctx.getContextUsage(): { tokens: number|null, contextWindow: number, percent: number|null } | undefined
                // (defined in ExtensionContext — pi-repo/packages/coding-agent/
                // src/core/extensions/types.ts:344). null when the host hasn't
                // reported usage yet (e.g. before the first LLM response).
                const usage = typeof ctx?.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
                let tokens: number | null = typeof usage?.tokens === "number" ? usage.tokens! : null;
                // Fallback: when the host hasn't reported a token count yet,
                // estimate from the visible message history (chars/4).
                if (tokens === null) {
                    let messages: unknown = null;
                    try {
                        messages = ctx?.sessionManager?.getBranch?.() ?? null;
                    } catch {
                        /* best-effort */
                    }
                    if (messages && Array.isArray(messages) && messages.length > 0) {
                        tokens = estimateTokensUsed(messages);
                    }
                }
                const result = buildContextRemaining({
                    tokens,
                    contextWindow: usage?.contextWindow,
                });
                const text =
                    `Context window: ${result.tokensUsed.toLocaleString()} / ${result.maxTokens.toLocaleString()} tokens used ` +
                    `(${result.remainingPercent}% remaining — ${result.remainingTokens.toLocaleString()} tokens).`;
                log(`context remaining: ${result.tokensUsed}/${result.maxTokens} (${result.remainingPercent}%)`);
                return {
                    content: [{ type: "text", text }],
                    details: result,
                };
            } catch (err: any) {
                return {
                    content: [{ type: "text", text: `get_context_remaining failed: ${err instanceof Error ? err.message : String(err)}` }],
                    isError: true,
                };
            }
        },
        renderCall(_args: any, theme: any) {
            return new Text(theme.fg("toolTitle", theme.bold("ctx ")), 0, 0);
        },
        renderResult(result: any, _o: any, theme: any) {
            const details = result?.details as ContextRemainingResult | undefined;
            if (!details) return new Text(theme?.fg ? theme.fg("muted", "context: ?") : "context: ?", 0, 0);
            const head = `${details.tokensUsed.toLocaleString()}/${details.maxTokens.toLocaleString()} (${details.remainingPercent}%)`;
            return new Text(theme?.fg ? theme.fg("muted", head) : head, 0, 0);
        },
    } as any);

    pi.registerTool({
        name: "view_image",
        label: "View image",
        description:
            "Read an image file from disk and convert it to a base64 data URL for vision-capable models. Accepts PNG, JPEG, GIF and WebP. The path must be absolute and inside the project root or the system tmp dir; files larger than 4 MB are rejected. Returns an Anthropic-vision-format image content block (base64 source) that the model can reason about directly.",
        parameters: ViewImageParams,
        async execute(_toolCallId: string, params: { path: string }) {
            try {
                const result = readImageFile(opts.cwd, params.path);
                log(`view_image ${JSON.stringify(params.path)} → ${result.mediaType}, ${result.bytes} bytes`);
                return {
                    content: [
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: result.mediaType,
                                data: result.dataUrl.slice(result.dataUrl.indexOf(",") + 1),
                            },
                        },
                    ],
                };
            } catch (err: any) {
                return {
                    content: [{ type: "text", text: `view_image failed: ${err instanceof Error ? err.message : String(err)}` }],
                    isError: true,
                };
            }
        },
        renderCall(args: any, theme: any) {
            return new Text(
                theme.fg("toolTitle", theme.bold("img ")) + theme.fg("accent", String(args?.path ?? "").slice(0, 70)),
                0,
                0,
            );
        },
        renderResult(result: any, _o: any, theme: any) {
            const block = result?.content?.[0];
            const head = block?.type === "image" ? `image/${block.source?.media_type?.split("/")[1]}` : "image";
            return new Text(theme?.fg ? theme.fg("success", `✓ ${head}`) : head, 0, 0);
        },
    } as any);
}

/** Slim extension that only registers the context tools (engine sandbox path). */
export function createContextToolsExtension(opts: ContextToolsOptions) {
    const factory = (pi: ExtensionAPI) => {
        registerContextTools(pi, opts);
    };
    return { id: "unown-context-tools", factory } as const;
}
