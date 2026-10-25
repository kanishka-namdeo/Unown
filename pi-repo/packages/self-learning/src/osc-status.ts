/**
 * osc-status.ts — OSC 7501 Program Status Protocol emission (rev 0.4).
 *
 * The 2026-10 convergence round: Claude Code shipped it in v2.1.295
 * (2026-10-08), Crush in v0.98.0 (2026-10-08) and Goose in v1.56.0
 * (2026-10-23) — the spec is Mitchell Hashimoto's "A Terminal Protocol for
 * Program Status" (mitchellh.com/writing/program-status-osc7501,
 * 2026-10-06; rev 0.4 reference implementations in libghostty + Rex).
 * A program reports what it is doing so terminals (Rex, Ghostty) can show
 * it in the tab title / status area instead of us guessing from screens.
 *
 * Unown's pi substrate already PARSES the protocol's feature-detection
 * reply (tui/src/stdin-buffer.ts tolerates `7501;?` among XTVersion and
 * Kitty replies) — this module completes the other half: EMISSION, from
 * the session lifecycle events, through the same direct stream write the
 * OSC-9 turn ping uses (notify.ts: an OSC is consumed by the emulator and
 * never renders, so a single synchronous write is frame-safe mid-TUI).
 *
 * Spec (kept byte-exact here, tested against the published grammar):
 *   OSC 7501 ; key=value(:key=value)* ST        ST = ESC \  (or BEL)
 *   state     required — idle | working | done | blocked | error | clear
 *   id        optional — a path of segments, [A-Za-z0-9_.+-]{1,32} each,
 *             `/`-separated, ≤8 levels, ≤128 bytes total; absent = root record
 *   kind      optional — permission | question | auth (meaningful with blocked)
 *   progress  optional — integer 0–100 (working/blocked; absent = indeterminate)
 *   app       optional — [A-Za-z0-9_.+-]{1,32} machine-readable program name
 *   title     optional — base64 UTF-8, ≤256 bytes encoded / ≤192 decoded
 *   msg       optional — base64 UTF-8 (padding optional), ≤2732 encoded /
 *             ≤2048 decoded, ONE line, no control characters in the decode
 *   Whole sequence ≤ 4096 bytes. Unknown keys are skipped by terminals.
 *
 * Emission rules (spec + reference implementations):
 *   - Only when the target stream is a TTY. The Ruby reference gates on
 *     `PROGRAM_STATUS != "0"`; Unown adds its native spelling as an alias
 *     (UNOWN_OSC7501=0). Nothing is written in print mode / CI.
 *   - `done`/`error` survive process exit; `working`/`blocked` must be
 *     dropped at exit — so shutdown reports `clear` (drops every record:
 *     the terminal-side complement of a clean leave).
 *
 * Pure module: no pi imports, no fs, no network. The terminal session
 * wiring lives in tools.ts (`pi.on(...)` handlers — before_agent_start,
 * agent_end, session_start, session_shutdown) exactly like the OSC-9 ping.
 */

// ---------------------------------------------------------------------------
// Env knobs — exported constants, read lazily per call (tests mutate env).
// ---------------------------------------------------------------------------

/** The spec-wide opt-out (the Ruby reference implementation's name). */
export const PROGRAM_STATUS_ENV = "PROGRAM_STATUS";
/** Unown's native alias — same "0 disables" semantics. */
export const UNOWN_OSC7501_ENV = "UNOWN_OSC7501";

export type ProgramStatusState = "idle" | "working" | "done" | "blocked" | "error" | "clear";
export type ProgramStatusKind = "permission" | "question" | "auth";

export interface ProgramStatusFields {
        state: ProgramStatusState;
        id?: string;
        kind?: ProgramStatusKind;
        progress?: number;
        app?: string;
        title?: string;
        msg?: string;
}

// Spec limits — every one enforced here so a malformed report is never sent
// (the terminal discards out-of-limit reports wholesale; better to clamp or
// refuse locally with a reason the caller can ignore).
const MAX_SEQUENCE_BYTES = 4096;
const MAX_ID_BYTES = 128;
const MAX_ID_SEGMENTS = 8;
const MAX_ID_SEGMENT_BYTES = 32;
const MAX_APP_BYTES = 32;
const MAX_TITLE_ENCODED = 256;
const MAX_TITLE_DECODED = 192;
const MAX_MSG_ENCODED = 2732;
const MAX_MSG_DECODED = 2048;

const ID_SEGMENT_RE = /^[A-Za-z0-9_.+-]+$/;

const STATES: ReadonlySet<string> = new Set(["idle", "working", "done", "blocked", "error", "clear"]);
const KINDS: ReadonlySet<string> = new Set(["permission", "question", "auth"]);

const ESC = "\x1b";
const OSC = `${ESC}]`;
const ST = `${ESC}\\`;

/** Single-line, control-character-free clip of a human message. Control
 *  characters become spaces (deleting them would join words); whitespace
 *  collapses; the result trims. */
function sanitizeLine(text: string): string {
        return text
                .replace(/[\x00-\x1f\x7f]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
}

/** Strict base64 (standard alphabet + padding). */
function b64(text: string): string {
        return Buffer.from(text, "utf8").toString("base64");
}

/**
 * Build the OSC 7501 report for `fields`, or null when a field breaks a spec
 * limit that cannot be safely clamped (id / app shape) or the assembled
 * sequence would exceed 4096 bytes even after clamping msg/title. `msg` and
 * `title` are CLIPPED to their decoded budgets before encoding (the spec's
 * per-field caps apply to the report as sent, and a terminal discards a
 * whole out-of-limit report — a clamped line is always better than silence).
 */
export function buildProgramStatus(fields: ProgramStatusFields): string | null {
        if (!fields || !STATES.has(fields.state)) return null;
        if (fields.kind !== undefined && !KINDS.has(fields.kind)) return null;

        const pairs: string[] = [`state=${fields.state}`];

        if (fields.id !== undefined && fields.id !== "") {
                // Root record = absent id; an empty string is treated as absent.
                if (fields.id.length > MAX_ID_BYTES) return null;
                const segments = fields.id.split("/");
                if (segments.length > MAX_ID_SEGMENTS) return null;
                for (const seg of segments) {
                        if (seg.length === 0 || seg.length > MAX_ID_SEGMENT_BYTES || !ID_SEGMENT_RE.test(seg)) return null;
                }
                pairs.push(`id=${fields.id}`);
        }

        if (fields.kind !== undefined) pairs.push(`kind=${fields.kind}`);

        if (fields.progress !== undefined) {
                if (!Number.isFinite(fields.progress)) return null;
                pairs.push(`progress=${Math.max(0, Math.min(100, Math.round(fields.progress)))}`);
        }

        if (fields.app !== undefined && fields.app !== "") {
                if (fields.app.length > MAX_APP_BYTES || !ID_SEGMENT_RE.test(fields.app)) return null;
                pairs.push(`app=${fields.app}`);
        }

        if (fields.title !== undefined && fields.title !== "") {
                const clean = sanitizeLine(fields.title).slice(0, MAX_TITLE_DECODED);
                if (!clean) return null;
                const encoded = b64(clean);
                if (encoded.length > MAX_TITLE_ENCODED) return null;
                pairs.push(`title=${encoded}`);
        }

        if (fields.msg !== undefined && fields.msg !== "") {
                const clean = sanitizeLine(fields.msg).slice(0, MAX_MSG_DECODED);
                if (!clean) return null;
                const encoded = b64(clean);
                if (encoded.length > MAX_MSG_ENCODED) return null;
                pairs.push(`msg=${encoded}`);
        }

        const sequence = `${OSC}7501;${pairs.join(":")}${ST}`;
        if (Buffer.byteLength(sequence, "utf8") > MAX_SEQUENCE_BYTES) return null;
        return sequence;
}

/**
 * Is emission enabled? Spec + reference rule: the target stream must be a
 * TTY, and neither opt-out env is set to "0". Streams without a TTY flag
 * (pipes, the engine's log files, print mode) never see a byte.
 */
export function programStatusEnabled(stream: { isTTY?: boolean } | undefined): boolean {
        try {
                if (!stream?.isTTY) return false;
                if (process.env[PROGRAM_STATUS_ENV] === "0") return false;
                if (process.env[UNOWN_OSC7501_ENV] === "0") return false;
                return true;
        } catch {
                return false;
        }
}

/**
 * Clip helper for event-derived messages: keep one line, control-free, and
 * at most `max` characters (the caller's semantic budget — e.g. a 120-char
 * turn preview keeps the report far inside the 2048-byte decode budget).
 */
export function clipStatusText(text: string, max: number): string {
        return sanitizeLine(String(text ?? "")).slice(0, Math.max(0, max));
}

/**
 * Emit one report. Best-effort by contract (identical posture to notify.ts's
 * emitOsc9): a malformed/unbuildable report or a dead stream is a silent
 * no-op — program status must never break the session it describes.
 */
export function emitProgramStatus(
        fields: ProgramStatusFields,
        stream: { isTTY?: boolean; write(s: string): boolean } = process.stdout,
): boolean {
        try {
                if (!programStatusEnabled(stream)) return false;
                const sequence = buildProgramStatus(fields);
                if (!sequence) return false;
                stream.write(sequence);
                return true;
        } catch {
                return false;
        }
}

// ---------------------------------------------------------------------------
// Session-lifecycle helpers — the four transitions the terminal agent makes.
// Every message passes through clipStatusText; `app` is the stable program
// name the spec asks for ("unown", matching the CLI's identity).
// ---------------------------------------------------------------------------

export const PROGRAM_STATUS_APP = "unown";

/** One-line preview of a user prompt or an assistant answer for `msg`. */
export const STATUS_MSG_PREVIEW_CHARS = 120;

/** `idle` — at rest, waiting for the user's next instruction. */
export function reportIdle(msg: string, stream?: { isTTY?: boolean; write(s: string): boolean }): boolean {
        return emitProgramStatus({ state: "idle", app: PROGRAM_STATUS_APP, msg: clipStatusText(msg, STATUS_MSG_PREVIEW_CHARS) }, stream);
}

/** `working` — the agent turn is running (msg = what it was asked). */
export function reportWorking(msg: string, stream?: { isTTY?: boolean; write(s: string): boolean }): boolean {
        return emitProgramStatus({ state: "working", app: PROGRAM_STATUS_APP, msg: clipStatusText(msg, STATUS_MSG_PREVIEW_CHARS) }, stream);
}

/** `blocked` — the turn needs the user (a question dialog, a permission). */
export function reportBlocked(kind: ProgramStatusKind, msg: string, stream?: { isTTY?: boolean; write(s: string): boolean }): boolean {
        return emitProgramStatus(
                { state: "blocked", kind, app: PROGRAM_STATUS_APP, msg: clipStatusText(msg, STATUS_MSG_PREVIEW_CHARS) },
                stream,
        );
}

/** `clear` — shutdown hygiene: drop every record we own (working/blocked must not outlive us). */
export function reportClear(stream?: { isTTY?: boolean; write(s: string): boolean }): boolean {
        return emitProgramStatus({ state: "clear", app: PROGRAM_STATUS_APP }, stream);
}
