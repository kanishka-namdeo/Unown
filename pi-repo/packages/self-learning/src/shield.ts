/**
 * shield.ts — the Unown injection shield: LIVE tool-result interception.
 *
 * guard.ts owns the deterministic detector library (scanToolOutput is its
 * Layer 4); this module owns everything around it on the live path:
 *
 *   - the env knob: UNOWN_INJECTION_SHIELD (default ON; `0` disables — the
 *     escape hatch required for a fail-open security feature);
 *   - annotateToolOutput(): the FAIL-OPEN wrapper every live choke point
 *     calls — any scanner crash is caught, logged and the ORIGINAL text is
 *     returned untouched (a shield defect must never break a tool call);
 *   - in-session telemetry (scans + flags) for the session note / dashboard;
 *   - recordShieldFlag(): the pi.appendEntry seam — one session entry per
 *     fired flag so the warning is visible and auditable in the transcript.
 *
 * Wired into (see the call sites for the exact interception points):
 *   - websearch.ts — webfetch execute() (source `webfetch:<url>`) and
 *     web_search execute() (source `websearch`), annotating the result text
 *     BEFORE it is returned to the model;
 *   - termhooks.ts — the PostToolUse tool_result handler for bash/powershell
 *     (source = tool name), reusing the same feedback mechanism the syntax
 *     gate uses (a content block the agent sees);
 *   - mcp.ts — the single execute() choke point every mcp__ tool result
 *     flows through (source `mcp:<server>/<tool>`).
 *
 * Ported from goose's prompt-injection detection, deterministic variant: the
 * decision record (docs/sdlc-feature-parity.md) rejected the second-model
 * adversary as cost-doubling, so this scanner adds ZERO inference — it is
 * pure regex over the result text. Annotation, not amputation: the content
 * always passes through unmodified below a one-line banner that reframes it
 * as data; the agent keeps working with the data while being told not to
 * obey instructions found inside it.
 *
 * Like guard.ts this module stays import-light (guard.ts only) and LLM-free
 * so every runtime — terminal sessions, engine sandbox runs, MCP hosts —
 * can adopt it without dependency concerns.
 */
import { scanToolOutput, type ToolOutputScan } from "./guard.ts";

export { scanToolOutput, TOOL_OUTPUT_SCAN_CAP } from "./guard.ts";
export type { ToolOutputScan } from "./guard.ts";

/** Scanner signature (injectable for tests). */
export type ToolOutputScanner = (text: string, source: string) => ToolOutputScan;

/**
 * The env knob. Default ON; `UNOWN_INJECTION_SHIELD=0` is the documented
 * escape hatch. Read at call time per the unown env convention (`||`, empty
 * string means unset).
 */
export function shieldEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return (env.UNOWN_INJECTION_SHIELD ?? "") !== "0";
}

// ---------------------------------------------------------------------------
// In-session telemetry (counters + fired-flag records)
// ---------------------------------------------------------------------------

let telemetryScans = 0;
let telemetryFlags = 0;
const flagRecords: Array<{ source: string; flags: string[]; at: number }> = [];

/** In-session shield counters (scans happen only while enabled). */
export function shieldTelemetry(): { scans: number; flagged: number; flags: typeof flagRecords } {
        return { scans: telemetryScans, flagged: telemetryFlags, flags: [...flagRecords] };
}

/** Reset the in-session telemetry (test hook). */
export function resetShieldTelemetry(): void {
        telemetryScans = 0;
        telemetryFlags = 0;
        flagRecords.length = 0;
}

/**
 * Surface a fired flag as a session entry via the pi extension seam —
 * `pi.appendEntry("unown-injection-shield", …)` persists a one-line warning
 * into the session (visible in the transcript tooling / session JSONL; the
 * banner in the tool result is what the MODEL sees, this is what the USER
 * audits). Best-effort by design: a missing or throwing appendEntry degrades
 * to the banner + verbose log, never a failed tool call.
 */
export function recordShieldFlag(
        pi: { appendEntry?: (customType: string, data?: unknown) => void } | undefined | null,
        info: { source: string; flags: string[] },
): void {
        try {
                if (typeof pi?.appendEntry !== "function") return;
                pi.appendEntry("unown-injection-shield", { ...info, at: Date.now() });
        } catch {
                /* cosmetic seam — swallow */
        }
}

// ---------------------------------------------------------------------------
// The fail-open annotation wrapper
// ---------------------------------------------------------------------------

export interface AnnotateOptions {
        /** Scanner override (tests inject crashes / fakes here). */
        scan?: ToolOutputScanner;
        /** Fired when the scan flags the output (log + appendEntry wiring). */
        onFlag?: (info: { source: string; flags: string[] }) => void;
}

/**
 * Annotate a live tool result: when the shield is enabled and the scanner
 * flags the text, the banner is PREPENDED and the original content is
 * returned unmodified below it. Everything else — disabled, clean, empty,
 * non-string, or a scanner CRASH — returns the input text verbatim.
 * FAIL-OPEN is the contract: shield errors must never break a tool call.
 */
export function annotateToolOutput(text: string, source: string, opts: AnnotateOptions = {}): string {
        try {
                if (!shieldEnabled()) return text;
                if (typeof text !== "string" || text.length === 0) return text;
                telemetryScans++;
                const scan = opts.scan ?? scanToolOutput;
                const result = scan(text, source);
                if (result.verdict !== "suspect" || !result.banner) return text;
                telemetryFlags++;
                flagRecords.push({ source, flags: result.flags, at: Date.now() });
                try {
                        opts.onFlag?.({ source, flags: result.flags });
                } catch {
                        /* observer errors must not eat the annotation */
                }
                return `${result.banner}\n\n${text}`;
        } catch (err) {
                // FAIL-OPEN: log and pass the original through untouched.
                const message = err instanceof Error ? err.message : String(err);
                try {
                        console.error(`[unown-injection-shield] scanner error (${source}): ${message} — passing result through unscanned`);
                } catch {
                        /* even logging must not throw */
                }
                return text;
        }
}
