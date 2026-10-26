/**
 * fleet.ts — the interactive subagent fleet: pure state machine + protocols.
 *
 * Ported from pi-interactive-subagents (amosblomqvist) — the async
 * fire-and-forget subagent model, mid-run steering, child→parent questions,
 * resume-by-name, the live status widget and the stall watchdog — rebuilt on
 * Unown's cross-platform native substrate: subprocess pipes + atomic control
 * files instead of tmux panes. Works identically on Windows, macOS and Linux
 * (no terminal multiplexer anywhere).
 *
 * The pieces that needed a substrate swap, and what they became:
 *
 *   tmux split-pane (child surface)      → a plain `unown --mode json`
 *                                          subprocess whose stdout event
 *                                          stream the parent tails live
 *   tmux send-keys (steering)            → an atomic control-file inbox the
 *                                          child's fleet extension polls
 *                                          and delivers via pi's native
 *                                          steer queue (sendUserMessage
 *                                          deliverAs:"steer")
 *   capture-pane exit scraping           → the subprocess close event
 *   the 1s status widget                 → same, but theme-aware through
 *                                          ctx.ui.setWidget (the upstream
 *                                          weakness — hardcoded RGB colors —
 *                                          is not ported)
 *
 * This module is PURE (fs only through injected helpers where needed): no pi
 * imports, no spawns, no timers — the runtime lives in fleet-runtime.ts and
 * the child side in fleet-child.ts, both wired through tools.ts / cli.ts.
 *
 * Public surface:
 *   - FleetStatus / FLEET_STALL_MS / FLEET_TIMEOUT_MS / FLEET_ASK_TIMEOUT_MS
 *   - FLEET_CONTROL_ENV / FLEET_ASK_ENV / FLEET_ID_ENV / FLEET_SESSION_ENV
 *   - classifyFleetStatus(state, now)          — the stall watchdog state machine
 *   - nextFleetStatus(state, kind, now)        — activity-event transitions
 *   - formatFleetWidgetLines(children, opts)   — the live widget (theme strings pre-colored by caller)
 *   - formatFleetStatusLine(children)          — the footer line
 *   - flattenSteerText(text)                   — newline flattening (each newline would submit a separate turn)
 *   - ControlCommand / parseControlCommands / appendControlCommand — the inbox protocol
 *   - uniqueFleetName(base, taken)             — name dedup (running + reserved + registry)
 *   - FleetLoadout / loadoutSidecarPath / readLoadout / writeLoadout — the resume contract
 *   - buildFleetResultContent(child)           — the steer-back report the parent model reads
 *   - isFleetBlocked(text)                     — BLOCKED detection (delegates to the shared parser)
 *
 * Standing invariant: no fork of the pi substrate; no pi imports.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isBlockedReply } from "./subagent-catalog.ts";
import { compactTokens } from "./subagent-progress.ts";

// ---------------------------------------------------------------------------
// Statuses + timing constants
// ---------------------------------------------------------------------------

/** The lifecycle states a fleet child moves through, as the widget shows them. */
export type FleetStatus =
        | "starting" // spawned, no events yet
        | "active" // thinking or streaming
        | "running-tool" // a tool call is executing (currentTool set)
        | "waiting-for-answer" // asked the parent a question, parked
        | "stalled" // no activity for FLEET_STALL_MS
        | "done" // exited 0
        | "failed" // exited non-zero or errored
        | "blocked" // replied BLOCKED: <reason>
        | "stopped"; // killed by task_control stop / timeout

/** No child event for this long ⇒ stalled (pi-interactive-subagents uses 60s
 *  against its activity snapshots; we watch stdout events and use 120s —
 *  a slow model turn legitimately runs quiet for a while). */
export const FLEET_STALL_MS = 120_000;

/** Hard wall-clock cap on one async child (the sync lane's 300s + headroom
 *  for interactive round-trips; the default behind resolveFleetTimeoutMs). */
export const FLEET_TIMEOUT_MS = 900_000;

/** The effective hard cap: UNOWN_FLEET_TIMEOUT_MS (milliseconds) wins when it
 *  parses as a finite number ≥ 1000 — anything else (unset, empty, garbage,
 *  sub-second) falls back to the default so a typo can never zero the
 *  watchdog. Read once per consumer, never cached, so tests stay hermetic. */
export function resolveFleetTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
        const raw = env.UNOWN_FLEET_TIMEOUT_MS?.trim();
        if (!raw) return FLEET_TIMEOUT_MS;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 1_000 ? Math.floor(n) : FLEET_TIMEOUT_MS;
}

/** How long ask_question parks before giving up and telling the child to
 *  proceed with best judgment (the parent may simply be unattended). */
export const FLEET_ASK_TIMEOUT_MS = 600_000;

/** Fleet-wide concurrency cap (2026-10-26 stress round): the maximum number
 *  of LIVE (non-terminal) async children one manager may run. The batch cap
 *  bounds a single call (4); this bounds the STACK of async calls a model can
 *  pile up across turns — pre-fix spawnFleetChild accepted unbounded spawns
 *  (the widget's 8 rows only cosmetically clipped the view). 8 matches the
 *  widget row cap and Claude Code's shipped default family (20 interactive
 *  slots; ours is heavier — each child is a full process). The overflow is a
 *  typed spawn failure that TELLS the model to wait or stop first, never a
 *  silent drop. */
export const FLEET_MAX_CONCURRENT_DEFAULT = 8;

/** The effective cap: UNOWN_FLEET_MAX_CONCURRENT wins when it parses as a
 *  finite integer ≥ 0 — 0 means UNLIMITED (the kill-switch escape hatch),
 *  unset/empty/garbage falls back to the default so a typo can never zero
 *  the guard. Read once per spawn, never cached — tests stay hermetic. */
export function resolveFleetMaxConcurrent(env: NodeJS.ProcessEnv = process.env): number {
        const raw = env.UNOWN_FLEET_MAX_CONCURRENT?.trim();
        if (!raw) return FLEET_MAX_CONCURRENT_DEFAULT;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return FLEET_MAX_CONCURRENT_DEFAULT;
        return Math.floor(n);
}

/** Env vars the parent sets on the child (read by fleet-child.ts via cli.ts). */
export const FLEET_CONTROL_ENV = "UNOWN_FLEET_CONTROL";
export const FLEET_ASK_ENV = "UNOWN_FLEET_ASK";
export const FLEET_ID_ENV = "UNOWN_FLEET_ID";
export const FLEET_SESSION_ENV = "UNOWN_FLEET_SESSION";

// ---------------------------------------------------------------------------
// The state shape (one entry per running/finished child)
// ---------------------------------------------------------------------------

export interface FleetUsage {
        input: number;
        output: number;
}

/** Everything the parent tracks about one fleet child. The runtime owns the
 *  process handle; this record is the serializable projection. */
export interface FleetChildState {
        id: string;
        name: string;
        agent: string;
        task: string;
        model?: string;
        cwd: string;
        startedAt: number;
        status: FleetStatus;
        /** Currently executing tool (from tool_execution_start), if any. */
        currentTool?: string;
        toolCount: number;
        turns: number;
        usage: FleetUsage;
        sessionFile: string;
        lastActivityAt: number;
        lastText?: string;
        blockReason?: string;
        exitCode?: number;
        stderr?: string;
        steerCount: number;
        /** Question currently parked with the parent (ask file written). */
        pendingQuestion?: string;
        endedAt?: number;
        /** Why a stopped child stopped (timeout watchdog vs orchestrator
         *  request) — delivered with the result so the parent can re-plan;
         *  pre-fix the reason only reached the log (2026-10-26 stress round). */
        stopReason?: string;
}

/** The activity kinds that drive status transitions (from the child's stdout
 *  event stream, plus parent-side actions). */
export type FleetActivityKind =
        | "spawned"
        | "assistant-message"
        | "tool-start"
        | "tool-end"
        | "steered"
        | "asked"
        | "answered"
        | "error";

/**
 * Advance a child's status from one activity event. Pure — the caller merges
 * the result into its state. Rules:
 *
 *   spawned          → starting
 *   assistant-message→ active (a turn completed)
 *   tool-start       → running-tool (sets currentTool via the second return)
 *   tool-end         → active (clears currentTool)
 *   steered          → active (a just-steered child is NOT stalled — the
 *                       upstream forceStatusAfterInterrupt rule)
 *   asked            → waiting-for-answer (supersedes stall)
 *   answered         → active
 *   error            → failed
 *
 * Terminal statuses (done/failed/blocked/stopped) are never overridden here —
 * exit handling owns them.
 */
export function nextFleetStatus(
        state: Pick<FleetChildState, "status">,
        kind: FleetActivityKind,
): { status: FleetStatus; currentTool?: string } {
        switch (kind) {
                case "spawned":
                        return { status: "starting" };
                case "assistant-message":
                        return { status: "active" };
                case "tool-start":
                        return { status: "running-tool" };
                case "tool-end":
                        return { status: "active" };
                case "steered":
                        return { status: "active" };
                case "asked":
                        return { status: "waiting-for-answer" };
                case "answered":
                        return { status: "active" };
                case "error":
                        return { status: "failed" };
        }
}

/**
 * The stall watchdog (pi-interactive-subagents' classifyStatus): a non-terminal
 * child with no activity for FLEET_STALL_MS is stalled; one that recovers
 * activity flips back through nextFleetStatus. waiting-for-answer never
 * stalls (the parent owes it a reply — that is not the child's fault).
 */
export function classifyFleetStatus(
        state: Pick<FleetChildState, "status" | "lastActivityAt">,
        now: number,
        stallMs = FLEET_STALL_MS,
): FleetStatus {
        switch (state.status) {
                case "done":
                case "failed":
                case "blocked":
                case "stopped":
                        return state.status;
                case "waiting-for-answer":
                        return "waiting-for-answer";
                default:
                        return now - state.lastActivityAt >= stallMs ? "stalled" : state.status;
        }
}

// ---------------------------------------------------------------------------
// Widget + footer formatting (theme colors applied by the caller)
// ---------------------------------------------------------------------------

export interface FleetWidgetTheme {
        /** Pre-colored status glyphs by status. */
        glyph: (status: FleetStatus) => string;
        /** Pre-colored glyph for BROWSER-ACTIVE children (the browser subagent,
         *  or any child currently driving the browser tool). Optional — falls
         *  back to `glyph` so a plain theme keeps the generic shape. */
        browserGlyph?: (status: FleetStatus) => string;
        /** Pre-colored text for a line body. */
        dim: (s: string) => string;
        accent: (s: string) => string;
        warn: (s: string) => string;
        title: (s: string) => string;
        /** Per-child lane color (beauty-4): rail + child name. Optional — an
         *  absent lane fn keeps the pre-lane row shape byte-identical. */
        lane?: (childName: string, s: string) => string;
}

/** A child is "browser-active" when it is the browser subagent OR any child
 *  whose current tool is the browser tool (a general agent may also drive
 *  the web). Pure — used by the widget and the /tasks row formatter. */
export function isBrowserChild(child: Pick<FleetChildState, "agent" | "currentTool">): boolean {
        if (child.agent === "browser") return true;
        const t = child.currentTool ?? "";
        return t === "browser" || t.startsWith("browser:");
}

export function formatElapsed(ms: number): string {
        const s = Math.max(0, Math.floor(ms / 1000));
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
        return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The live widget above the editor (the pi-interactive-subagents status
 * box, theme-aware). One bordered block titled "Subagents — N running",
 * one row per child:
 *
 *   ⟳ 02:14 scout — running · bash: npm test · 1.2k tok
 *   ◉ 00:31 browser — running · browser: click [e12] · 3.4k tok
 *   ? 00:31 worker — waiting for your answer
 *   ○ 00:02 researcher — starting
 *
 * Rows are width-safe: the caller passes the terminal width and lines are
 * truncated to it (the widget seam caps at 10 lines — MAX_WIDGET_LINES —
 * which the caller enforces by slicing). The tool detail is the humanized
 * label (subagent-progress.ts) and the trailing token count appears once a
 * child has consumed any (Claude Code's subagent-row shape — the live
 * cost signal users asked for in issues #92189/#89844).
 */
export function formatFleetWidgetLines(
        children: FleetChildState[],
        theme: FleetWidgetTheme,
        width = 80,
        now = Date.now(),
): string[] {
        const running = children.filter((c) => !isTerminalFleetStatus(c.status));
        if (running.length === 0) return [];
        const inner = Math.max(20, Math.min(width, 120) - 4);
        const cap = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…");
        const lines: string[] = [theme.title(cap(`╭─ Subagents ── ${running.length} running `, inner))];
        for (const child of running.slice(0, 8)) {
                const elapsed = formatElapsed(now - child.startedAt);
                const status =
                        child.status === "running-tool" && child.currentTool
                                ? `running · ${child.currentTool}`
                                : child.status === "waiting-for-answer"
                                        ? "waiting for your answer"
                                        : child.status === "stalled"
                                                ? "stalled — steer or stop it"
                                                : child.status === "starting"
                                                        ? "starting"
                                                        : "thinking";
                // Live token count once there is one — the compact form keeps
                // short rows unchanged ("" until the first model turn lands).
                const tok = compactTokens(child.usage.input + child.usage.output);
                const suffix = tok ? ` · ${tok}` : "";
                // Browser-active children get their own glyph (◉) so a web flow
                // is distinguishable at a glance from repo work in the same fleet.
                const glyph =
                        isBrowserChild(child) && theme.browserGlyph ? theme.browserGlyph(child.status) : theme.glyph(child.status);
                const body = `${elapsed} ${child.name} — ${status}${suffix}`;
                // The lane rail costs 2 cells ("▌ ") — budget it INSIDE the cap so
                // rows never run past the box edge (colors applied after capping,
                // so truncation can never slice an escape sequence).
                let row = cap(`${glyph} ${body}`, theme.lane ? inner - 2 : inner);
                if (theme.lane) {
                        // Beauty-4 (subagent lanes): a ▌ rail + the child's name in its
                        // lane color. A truncated name keeps the row color via the rail.
                        row = `${theme.lane(child.name, "▌")} ` + row.replace(child.name, (s) => theme.lane!(child.name, s));
                }
                lines.push(theme.dim(row));
        }
        if (running.length > 8) {
                lines.push(theme.dim(cap(`+${running.length - 8} more running.`, inner)));
        }
        lines.push(theme.title(cap("╰────────────────────────────────────────────", inner)));
        return lines;
}

/** The one-line footer status (ctx.ui.setStatus shape). */
export function formatFleetStatusLine(
        children: FleetChildState[],
        theme: FleetWidgetTheme,
        now = Date.now(),
): string | undefined {
        const running = children.filter((c) => !isTerminalFleetStatus(c.status));
        if (running.length === 0) return undefined;
        const waiting = running.filter((c) => c.status === "waiting-for-answer").length;
        const stalled = running.filter((c) => c.status === "stalled").length;
        const bits = [`${running.length} subagent${running.length === 1 ? "" : "s"} running`];
        if (waiting > 0) bits.push(`${waiting} awaiting answer`);
        if (stalled > 0) bits.push(`${stalled} stalled`);
        return theme.accent(`fleet: ${bits.join(" · ")}`);
}

export function isTerminalFleetStatus(status: FleetStatus): boolean {
        return status === "done" || status === "failed" || status === "blocked" || status === "stopped";
}

// ---------------------------------------------------------------------------
// The control-file inbox (parent → child)
// ---------------------------------------------------------------------------

export type ControlCommand =
        | { kind: "steer"; text: string; ts: number }
        | { kind: "answer"; text: string; ts: number }
        | { kind: "stop"; ts: number };

/**
 * Parse a control file's contents. Tolerant: a missing/empty/corrupt file is
 * an empty command list, never a throw (the child polls this constantly).
 * Also accepts the legacy "consumed" marker (empty array).
 */
export function parseControlCommands(raw: string): ControlCommand[] {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        let parsed: unknown;
        try {
                parsed = JSON.parse(trimmed);
        } catch {
                return [];
        }
        if (!Array.isArray(parsed)) return [];
        const out: ControlCommand[] = [];
        for (const item of parsed) {
                if (!item || typeof item !== "object") continue;
                const rec = item as Record<string, unknown>;
                const ts = typeof rec.ts === "number" ? rec.ts : Date.now();
                if (rec.kind === "steer" && typeof rec.text === "string" && rec.text.trim()) {
                        out.push({ kind: "steer", text: flattenSteerText(rec.text), ts });
                } else if (rec.kind === "answer" && typeof rec.text === "string" && rec.text.trim()) {
                        out.push({ kind: "answer", text: flattenSteerText(rec.text), ts });
                } else if (rec.kind === "stop") {
                        out.push({ kind: "stop", ts });
                }
        }
        return out;
}

/**
 * Append a command to the control file (parent side). Read-modify-write with
 * an atomic rename — single-writer (the parent), single-reader (the child),
 * so the race window is between the parent's own appends only, which are
 * serialized by the tool-call queue in practice; the atomic rename keeps the
 * child from ever seeing a half-written file.
 */
export function appendControlCommand(controlFile: string, command: Omit<ControlCommand, "ts"> & { ts?: number }): void {
        const existing = existsSync(controlFile) ? parseControlCommands(readFileSync(controlFile, "utf8")) : [];
        const next: ControlCommand = { ...command, ts: command.ts ?? Date.now() } as ControlCommand;
        atomicWriteFileSync(controlFile, JSON.stringify([...existing, next], null, 2));
}

/**
 * Consume the inbox (child side): read + truncate in one visit. Returns the
 * commands that were present; an empty list afterwards is the steady state.
 */
export function consumeControlCommands(controlFile: string): ControlCommand[] {
        if (!existsSync(controlFile)) return [];
        let raw: string;
        try {
                raw = readFileSync(controlFile, "utf8");
        } catch {
                return [];
        }
        const commands = parseControlCommands(raw);
        if (commands.length > 0) atomicWriteFileSync(controlFile, "[]");
        return commands;
}

/**
 * Flatten newlines out of steer text — each newline in a TUI would submit a
 * separate turn, and the child's steer queue treats the text as one message
 * (pi-interactive-subagents' exact rule: `\s*\n\s*` → single space).
 */
export function flattenSteerText(text: string): string {
        return text.replace(/\s*\n\s*/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Names + loadout + registry (the resume contract)
// ---------------------------------------------------------------------------

/** Unique-ify a fleet name against the taken set: `scout`, `scout-2`, … */
export function uniqueFleetName(base: string, taken: ReadonlySet<string>): string {
        const clean =
                base
                        .replace(/[^a-zA-Z0-9_-]/g, "-")
                        .replace(/^-+|-+$/g, "")
                        .slice(0, 40) || "agent";
        if (!taken.has(clean)) return clean;
        for (let i = 2; i < 1000; i++) {
                const candidate = `${clean}-${i}`;
                if (!taken.has(candidate)) return candidate;
        }
        return `${clean}-${Date.now().toString(36)}`;
}

/** The replayed spawn contract (pi-interactive-subagents' loadout sidecar):
 *  everything needed to relaunch the SAME agent sandbox later, persisted
 *  next to the session file. Resume without a loadout is refused — never
 *  relaunch unrestricted. */
export interface FleetLoadout {
        version: 1;
        name: string;
        agentName: string;
        task: string;
        cwd: string;
        model?: string;
        effort?: string;
        tools?: string[];
        mcpServers?: string[];
        injectAgentsMd?: boolean;
        systemPrompt: string;
        sessionFile: string;
        createdAt: number;
}

export function loadoutSidecarPath(sessionFile: string): string {
        return `${sessionFile}.loadout.json`;
}

export function writeLoadout(loadout: FleetLoadout): void {
        atomicWriteFileSync(loadoutSidecarPath(loadout.sessionFile), JSON.stringify(loadout, null, 2));
}

export function readLoadout(sessionFile: string): FleetLoadout | null {
        const sidecar = loadoutSidecarPath(sessionFile);
        if (!existsSync(sidecar)) return null;
        try {
                const parsed = JSON.parse(readFileSync(sidecar, "utf8")) as Partial<FleetLoadout>;
                if (parsed?.version !== 1 || typeof parsed.agentName !== "string" || typeof parsed.sessionFile !== "string") {
                        return null;
                }
                return {
                        version: 1,
                        name: parsed.name ?? "agent",
                        agentName: parsed.agentName,
                        task: parsed.task ?? "",
                        cwd: parsed.cwd ?? process.cwd(),
                        model: parsed.model,
                        effort: parsed.effort,
                        tools: parsed.tools,
                        mcpServers: parsed.mcpServers,
                        injectAgentsMd: parsed.injectAgentsMd,
                        systemPrompt: parsed.systemPrompt ?? "",
                        sessionFile: parsed.sessionFile,
                        createdAt: parsed.createdAt ?? 0,
                };
        } catch {
                return null;
        }
}

/** The persistent name registry: name → last known session + outcome, so
 *  `task_control steer` can resume a finished child by name. */
export interface FleetRegistry {
        version: 1;
        names: Record<
                string,
                { sessionFile: string; id: string; status: FleetStatus; finishedAt: number; summary?: string }
        >;
}

export function readFleetRegistry(fleetDir: string): FleetRegistry {
        const file = join(fleetDir, "registry.json");
        if (!existsSync(file)) return { version: 1, names: {} };
        try {
                const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FleetRegistry>;
                if (parsed?.version !== 1 || typeof parsed.names !== "object" || !parsed.names) return { version: 1, names: {} };
                return { version: 1, names: parsed.names };
        } catch {
                return { version: 1, names: {} };
        }
}

export function writeFleetRegistry(fleetDir: string, registry: FleetRegistry): void {
        // Keep the registry bounded: the 32 most recent finished entries.
        const entries = Object.entries(registry.names)
                .sort((a, b) => (b[1].finishedAt ?? 0) - (a[1].finishedAt ?? 0))
                .slice(0, 32);
        atomicWriteFileSync(
                join(fleetDir, "registry.json"),
                JSON.stringify({ version: 1, names: Object.fromEntries(entries) }, null, 2),
        );
}

// ---------------------------------------------------------------------------
// Result delivery (the steer-back report)
// ---------------------------------------------------------------------------

/** Build the human + model readable result content for a finished child —
 *  delivered to the parent session as a custom message that triggers a new
 *  turn (pi-interactive-subagents' subagent_result shape, Unown-flavored). */
export function buildFleetResultContent(child: FleetChildState): string {
        const elapsed = formatElapsed((child.endedAt ?? Date.now()) - child.startedAt);
        const header =
                child.status === "blocked"
                        ? `Subagent ${child.name} (${child.agent}) BLOCKED after ${elapsed}`
                        : child.status === "failed"
                                ? `Subagent ${child.name} (${child.agent}) FAILED after ${elapsed}`
                                : child.status === "stopped"
                                        ? `Subagent ${child.name} (${child.agent}) stopped after ${elapsed}${child.stopReason ? ` (${child.stopReason})` : ""}`
                                        : `Subagent ${child.name} (${child.agent}) finished in ${elapsed}`;
        const vitals = `${child.turns} turns · ${child.toolCount} tool calls · ${child.usage.input} in / ${child.usage.output} out${child.steerCount > 0 ? ` · steered ${child.steerCount}x` : ""}`;
        const rawBody = (child.lastText ?? child.stderr ?? "(no output)").trim();
        const body = rawBody.slice(0, 16_000);
        // Truncation visibility (2026-10-26 stress round): a fleet report cut
        // at the 16k cap used to pass as whole — same live finding as the sync
        // lane. Name the cut so the parent re-asks for a compressed report or
        // a file path instead of trusting a mid-word ending.
        const truncationNote =
                rawBody.length > 16_000 ? `\n\n**(report truncated at 16,000 characters — the child's full report was longer. Steer it to compress, or to write the full report to a file and return only the path.)**` : "";
        if (child.status === "blocked" && child.blockReason) {
                return `${header} — ${child.blockReason}\n\n${body}${truncationNote}`;
        }
        return `${header} — ${vitals}\n\n${body}${truncationNote}\n\nFollow up with task_control {action:"steer", id:"${child.name}", message:"…"} to continue this subagent with full context.`;
}

/** The question content the parent model reads when a child asks something. */
export function buildFleetQuestionContent(child: FleetChildState, question: string): string {
        return [
                `Subagent ${child.name} (${child.agent}) asks a question after ${formatElapsed(Date.now() - child.startedAt)}:`,
                "",
                question.trim().slice(0, 4000),
                "",
                `Answer it with task_control {action:"steer", id:"${child.name}", message:"<your answer>"} — the subagent is parked until you do (or times out).`,
        ].join("\n");
}

// ---------------------------------------------------------------------------
// Atomic write (shared with model-health's semantics, local copy to keep this
// module dependency-free)
// ---------------------------------------------------------------------------

/** Temp + rename with a small Windows-contended-rename ladder. Never throws. */
export function atomicWriteFileSync(target: string, content: string): void {
        const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
        try {
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
                let ok = false;
                for (let attempt = 0; attempt < 3 && !ok; attempt++) {
                        try {
                                renameSync(tmp, target);
                                ok = true;
                        } catch {
                                if (attempt === 2) {
                                        try {
                                                const { rmSync } = require("node:fs") as typeof import("node:fs");
                                                rmSync(target, { force: true });
                                                renameSync(tmp, target);
                                                ok = true;
                                        } catch {
                                                /* give up silently */
                                        }
                                }
                        }
                }
                if (!ok) {
                        try {
                                const { rmSync } = require("node:fs") as typeof import("node:fs");
                                rmSync(tmp, { force: true });
                        } catch {
                                /* best effort */
                        }
                }
        } catch {
                /* best effort — control files are advisory */
        }
}

/** BLOCKED detection for fleet children (same parser as the sync lane). */
export function isFleetBlocked(text: string): { blocked: boolean; reason?: string } {
        return isBlockedReply(text);
}

// ---------------------------------------------------------------------------
// Completion batching (pi-cciotti port): successes coalesce, failures race
// ---------------------------------------------------------------------------

/** Debounce window for batching successful completions (cciotti: 150ms). */
export const FLEET_BATCH_DEBOUNCE_MS = 150;

/** Max wait before a batched flush fires even while results keep arriving. */
export const FLEET_BATCH_MAX_WAIT_MS = 1_000;

/**
 * Merge N result contents into ONE batched message (the message the parent
 * model reads). A single result passes through unchanged; several arrive
 * under a header line so the turn that consumes them sees the batch shape:
 *
 *   2 subagents finished:
 *   ── name ──
 *   <content>
 *   ── name ──
 *   <content>
 *
 * Pure. Failures/questions bypass the batch upstream (they flush alone).
 */
export function mergeFleetResultContents(results: Array<{ name: string; content: string }>): string {
        if (results.length === 1) return results[0].content;
        const header = `${results.length} subagents finished:`;
        const body = results.map((r) => `── ${r.name} ──\n${r.content}`).join("\n\n");
        return `${header}\n\n${body}`;
}
