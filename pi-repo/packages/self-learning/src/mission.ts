/**
 * mission.ts — the mission panel and the returning-user brief.
 *
 * The observability round (2026-10-30, docs/tui-observability-audit.md):
 * the audit's headline finding — a returning user in a normal session has
 * zero on-screen statement of "what we are doing and why", no derived
 * progress on ordinary turns, no composed risk line and no confidence
 * signal. The machinery was strong (meters, state machines, receipts);
 * the narrative was missing. This module is the narrative's pure core:
 *
 *   - MISSION — the pinned objective, resolved by precedence: an active
 *     /goal, else a user /mission, else the auto-titled session name.
 *     Never invented: with none of the three there is no mission line.
 *   - PROGRESS — derived, not decorative: plan steps while executing a
 *     plan, else todo completion, else an honest absence ("no tracked
 *     steps"). Never a fabricated percentage.
 *   - CONFIDENCE — deterministic signals only (tool errors, verify/test
 *     failures, permission denials this session), composed into
 *     high/medium/low with the drivers named. The agent never grades
 *     itself here — the receipts do.
 *   - RISKS — composed worst-first from the surfaces that already exist
 *     (engine state, context pressure, verify failures, dead letters).
 *   - THE BRIEF — the 60-second returning-user answer: objective,
 *     happened, changed, state, learning, risks, session, remains. The
 *     auto-recap's activity shape ("3 turns, 14 tool calls") becomes a
 *     state shape. Deterministic on the prompt path; the LLM lane is
 *     /brief's optional decision miner through the btw side-channel
 *     (never the transcript, never AutoDream mining).
 *
 * Pure module: no pi imports, no fs. The tools.ts wiring passes facts in
 * (todos through the addons bridge, engine state through getEngineStatusInfo,
 * telemetry through sessionUsageSummary) and renders the returned lines
 * through ctx.ui.setWidget / setStatus / notify, coloring by the role
 * vocabulary the plan-steps widget already uses. UNOWN_MISSION_PANEL=0 is
 * the kill switch for the whole panel (the brief and /recovery survive —
 * they answer explicit asks, not ambient chrome).
 */

export const MISSION_PANEL_ENV = "UNOWN_MISSION_PANEL";

/** Is the ambient mission panel on? (default on; UNOWN_MISSION_PANEL=0 off) */
export function missionPanelEnabled(env: Record<string, string | undefined> = process.env): boolean {
        return (env[MISSION_PANEL_ENV] ?? "") !== "0";
}

// ---------------------------------------------------------------------------
// Mission state
// ---------------------------------------------------------------------------

export type MissionSource = "goal" | "user" | "auto";

export interface MissionState {
        /** The objective text, as the user set it (goal/mission) or as titled. */
        text: string;
        source: MissionSource;
        /** Epoch ms — drives the age suffix and the brief's mission line. */
        createdAt: number;
}

export interface ResolveMissionInputs {
        /** The live /goal state (goal.ts). Only an ACTIVE goal is the mission. */
        goal?: { text: string; status: string; createdAt: number } | null;
        /** The /mission-pinned objective (tools.ts session state). */
        userMission?: MissionState | null;
        /** The auto-titled session name (auto-title.ts) — the fallback mission. */
        sessionName?: string | null;
        /** Injectable clock (tests). */
        now?: number;
}

/**
 * Resolve the mission by precedence: active goal > /mission pin > session
 * title. The session-title fallback is what closes audit flag E1 ("the
 * first prompt is never echoed as the mission it becomes") — auto-title
 * names the session after the first settle, so from turn 2 onward the panel
 * carries the session's own purpose. Empty/absent everywhere = no mission
 * (the panel's first line is omitted, never invented).
 */
export function resolveMission(inputs: ResolveMissionInputs): MissionState | null {
        const now = inputs.now ?? Date.now();
        if (inputs.goal && inputs.goal.status === "active" && inputs.goal.text.trim()) {
                return { text: inputs.goal.text.trim(), source: "goal", createdAt: inputs.goal.createdAt };
        }
        if (inputs.userMission?.text.trim()) {
                return {
                        ...inputs.userMission,
                        text: inputs.userMission.text.trim(),
                        createdAt: inputs.userMission.createdAt || now,
                };
        }
        const title = (inputs.sessionName ?? "").trim();
        if (title) return { text: title, source: "auto", createdAt: now };
        return null;
}

/** `24m`, `1.5h`, `2d` — whole-unit ages for the mission line. */
export function formatMissionAge(ageMs: number): string {
        const m = Math.max(0, Math.floor(ageMs / 60_000));
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${m % 60 === 0 ? h : Math.round((ageMs / 3_600_000) * 10) / 10}h`;
        return `${Math.floor(h / 24)}d`;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface MissionProgress {
        done: number;
        total: number;
        source: "plan" | "todos";
}

export interface DeriveProgressInputs {
        /** Executing-plan facts (tools.ts planItems) — {done,total} while executing. */
        plan?: { done: number; total: number } | null;
        /** Live todos (the addons bridge) — {done,total}. */
        todos?: { done: number; total: number } | null;
}

/**
 * Progress by precedence: an executing plan is the tracked plan; else the
 * todo trail; else null (an honest absence — the panel says so, it never
 * fabricates a percentage). Zero-total inputs are treated as absent.
 */
export function deriveProgress(inputs: DeriveProgressInputs): MissionProgress | null {
        if (inputs.plan && inputs.plan.total > 0) return { ...inputs.plan, source: "plan" };
        if (inputs.todos && inputs.todos.total > 0) return { ...inputs.todos, source: "todos" };
        return null;
}

/** `▕████░░░░▏ 3/7` — the memory-bar meter family (█ fill, ░ empty, ▕▏ caps). */
export function renderProgressMeter(progress: MissionProgress): string {
        const cells = 8;
        const filled = Math.max(0, Math.min(cells, Math.round((progress.done / progress.total) * cells)));
        const bar = "█".repeat(filled) + "░".repeat(cells - filled);
        return `▕${bar}▏ ${progress.done}/${progress.total}`;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low";

/** Deterministic session signals (collected in tools.ts's tool_execution_end). */
export interface ConfidenceSignals {
        /** Tool results that ended isError, EXCLUDING permission denials. */
        toolErrors: number;
        /** Verify/test gate failures ([auto-verify]/[auto-test] feedback). */
        verifyFailures: number;
        /** Permission/bash-policy denials ([unown-permissions], "denied"). */
        denials: number;
}

export interface ConfidenceAssessment {
        level: ConfidenceLevel;
        drivers: string[];
}

/**
 * Compose the signals into a level with named drivers — the honest
 * confidence: receipts only, never self-report. Rules (pinned by tests):
 *
 *   low    any verify/test failure, or ≥3 tool errors — the session has
 *          produced work the project's own gates rejected;
 *   medium 1–2 tool errors, or any denial — something went sideways but
 *          recovered; a blocked agent also deserves less than high;
 *   high   no failures, no errors, no denials.
 *
 * A session with zero activity (fresh boot) is high — the absence of
 * failure is the only claim a quiet session can make, and the panel's
 * progress line already says "no tracked steps" when true.
 */
export function deriveConfidence(signals: ConfidenceSignals): ConfidenceAssessment {
        const drivers: string[] = [];
        if (signals.verifyFailures > 0)
                drivers.push(`${signals.verifyFailures} verify/test failure${signals.verifyFailures === 1 ? "" : "s"}`);
        if (signals.toolErrors > 0) drivers.push(`${signals.toolErrors} tool error${signals.toolErrors === 1 ? "" : "s"}`);
        if (signals.denials > 0) drivers.push(`${signals.denials} blocked action${signals.denials === 1 ? "" : "s"}`);
        if (signals.verifyFailures > 0 || signals.toolErrors >= 3) return { level: "low", drivers };
        if (signals.toolErrors > 0 || signals.denials > 0) return { level: "medium", drivers };
        return { level: "high", drivers: [] };
}

const CONFIDENCE_GLYPH: Record<ConfidenceLevel, string> = { high: "✓", medium: "◐", low: "✗" };

/** The footer chip: `conf ✓` / `conf ◐` / `conf ✗` (drivers live on the panel). */
export function renderConfidenceChip(assessment: ConfidenceAssessment): string {
        return `conf ${CONFIDENCE_GLYPH[assessment.level]}`;
}

// ---------------------------------------------------------------------------
// Risks
// ---------------------------------------------------------------------------

export interface DeriveRisksInputs {
        /** getEngineStatusInfo().state — the six-state machine. */
        engineState?: string;
        /** Live context utilization percent (0–100), when the host reports it. */
        ctxPct?: number | null;
        /** Session verify/test gate failures. */
        verifyFailures?: number;
        /** Dead-lettered notes (outbox terminal failures) — from engine status. */
        outboxDead?: number;
        /** A recently failed model endpoint (model-health marks). */
        modelUnhealthy?: string | null;
}

/**
 * Composed risks, worst-first, each phrased with its consequence — the
 * audit's A4 ("no surface composes") answer. Only real conditions appear;
 * an empty list renders no line at all.
 */
export function deriveRisks(inputs: DeriveRisksInputs): string[] {
        const risks: string[] = [];
        if (inputs.engineState === "down") risks.push("engine down — learning paused, notes queue (/engine)");
        if (inputs.engineState === "blocked") risks.push("engine blocked — auto-start refused (/engine)");
        if (inputs.engineState === "paused") risks.push("engine crash-loop paused — learning halted (/engine)");
        if (typeof inputs.ctxPct === "number" && inputs.ctxPct >= 90)
                risks.push(`context ${inputs.ctxPct}% — compact now (/compact)`);
        else if (typeof inputs.ctxPct === "number" && inputs.ctxPct >= 70)
                risks.push(`context ${inputs.ctxPct}% — compaction soon`);
        if ((inputs.verifyFailures ?? 0) > 0)
                risks.push(
                        `${inputs.verifyFailures} verify/test failure${inputs.verifyFailures === 1 ? "" : "s"} this session (/recovery)`,
                );
        if ((inputs.outboxDead ?? 0) > 0)
                risks.push(
                        `${inputs.outboxDead} dead-lettered note${inputs.outboxDead === 1 ? "" : "s"} — hand-recoverable (/recovery)`,
                );
        if (inputs.modelUnhealthy) risks.push(`model recently failing: ${inputs.modelUnhealthy} (subagents skip it 30m)`);
        return risks;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export type MissionPanelRole = "accent" | "success" | "warning" | "muted" | "dim";

export interface MissionPanelLine {
        text: string;
        role: MissionPanelRole;
}

export interface RenderMissionPanelInputs {
        mission: MissionState | null;
        progress: MissionProgress | null;
        confidence: ConfidenceAssessment;
        risks: string[];
        /** Fresh learning event line (learning-feed.ts), when one is < 10m old. */
        learned?: string | null;
        /** Session facts for the status row. */
        telemetry?: { sessionMs: number; costUsd: number | null; turns: number } | null;
        /** True while a turn is running — the progress row says what the agent is on. */
        busy?: boolean;
        /** Injectable clock (tests). */
        now?: number;
}

/**
 * The mission panel — 2–4 lines, composed rather than competing (audit
 * C1/C2): mission first, then one status row (progress + confidence +
 * telemetry), then risks and learning only when they exist. Roles map to
 * the theme tokens the plan-steps widget already uses; the wiring colors,
 * this core decides WHAT. All lines ASCII+glyph vocabulary only
 * (`▕█░▏ ● ○ ✓ ◐ ✗ ✦`), truncation left to the widget seam.
 */
export function renderMissionPanel(inputs: RenderMissionPanelInputs): MissionPanelLine[] {
        const now = inputs.now ?? Date.now();
        const lines: MissionPanelLine[] = [];

        if (inputs.mission) {
                const age = formatMissionAge(now - inputs.mission.createdAt);
                const glyph = inputs.mission.source === "goal" ? "●" : inputs.mission.source === "user" ? "●" : "○";
                lines.push({
                        text: `${glyph} mission — ${inputs.mission.text} (${inputs.mission.source} · ${age})`,
                        role: "accent",
                });
        }

        // The status row: progress (meter or honest absence), confidence, telemetry.
        const row: string[] = [];
        if (inputs.progress) {
                row.push(renderProgressMeter(inputs.progress));
        } else {
                const on = inputs.busy ? `turn ${inputs.telemetry?.turns ?? "?"} running` : "no tracked steps";
                row.push(`○ ${on}`);
        }
        row.push(renderConfidenceChip(inputs.confidence));
        if (inputs.telemetry) {
                const elapsed = formatMissionAge(inputs.telemetry.sessionMs);
                const cost = inputs.telemetry.costUsd !== null ? ` · ~$${formatCost(inputs.telemetry.costUsd)}` : "";
                row.push(`${elapsed} in session${cost}`);
        }
        lines.push({ text: row.join(" · "), role: "muted" });

        // Confidence drivers ride the status row's follow-up — only when degraded.
        if (inputs.confidence.drivers.length > 0) {
                lines.push({ text: `└ ${inputs.confidence.drivers.join(" · ")}`, role: "dim" });
        }

        if (inputs.learned) {
                lines.push({ text: `✦ ${inputs.learned}`, role: "success" });
        }

        if (inputs.risks.length > 0) {
                for (const risk of inputs.risks.slice(0, 2)) lines.push({ text: `✗ ${risk}`, role: "warning" });
                if (inputs.risks.length > 2) lines.push({ text: `└ +${inputs.risks.length - 2} more (/recovery)`, role: "dim" });
        }

        return lines;
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export interface BriefRemains {
        /** Open todo subjects (the first 3), plus the open count. */
        openTodos: string[];
        /** Remaining plan steps, when executing a plan. */
        planRemaining: number;
        /** The goal's state, when a goal exists. */
        goal?: { text: string; status: string } | null;
}

export interface BuildBriefInputs {
        /** Idle span covered (ms) — 0 for the on-demand whole-session brief. */
        awayMs?: number;
        mission: MissionState | null;
        /** The recap digest for the window (recap.ts buildRecapDigest). */
        digest: {
                turns: number;
                toolCalls: number;
                toolsUsed: string[];
                filesTouched: string[];
                lastAssistantPreview: string;
        };
        confidence: ConfidenceAssessment;
        risks: string[];
        remains: BriefRemains;
        /** Learning events inside the window (learning-feed.ts), newest first. */
        learned: string[];
        telemetry: { sessionMs: number; costUsd: number | null; tokensIn: string; tokensOut: string };
        /** The LLM-mined decision line (/brief only; absent on the auto path). */
        decisions?: string | null;
}

function formatCost(usd: number): string {
        if (usd >= 0.01) return String(Math.round(usd * 100) / 100);
        return String(Math.round(usd * 10_000) / 10_000);
}

/**
 * The 60-second brief. Deterministic, ordered by the round's information
 * architecture (mission > progress > task > decisions > evidence > risks >
 * learning > metrics > logs): every line answers one of the mission's five
 * questions, and the last line always says what remains — the activity
 * shape ("3 turns, 14 tool calls") becomes a state shape. Rendered through
 * the notify pane (theme-plain); the auto path shows it after a real idle
 * gap, `/brief` on demand (with the decision miner attached).
 */
export function buildBrief(inputs: BuildBriefInputs): string {
        const lines: string[] = [];
        const away = inputs.awayMs && inputs.awayMs > 0 ? ` · back after ${formatMissionAge(inputs.awayMs)}` : "";
        lines.push(`── brief${away} ──`);

        // 1. Mission — the objective, or its honest absence.
        lines.push(
                inputs.mission
                        ? `mission: ${inputs.mission.text} (${inputs.mission.source})`
                        : "mission: none pinned — /mission <objective> or /goal",
        );

        // 2. What happened — the window's shape, then the files it touched.
        const happened: string[] = [];
        if (inputs.digest.turns > 0) happened.push(`${inputs.digest.turns} turn${inputs.digest.turns === 1 ? "" : "s"}`);
        if (inputs.digest.toolCalls > 0)
                happened.push(`${inputs.digest.toolCalls} tool call${inputs.digest.toolCalls === 1 ? "" : "s"}`);
        if (inputs.digest.toolsUsed.length > 0) happened.push(inputs.digest.toolsUsed.slice(0, 4).join(", "));
        lines.push(`happened: ${happened.length ? happened.join(" · ") : "no new turns"}`);
        if (inputs.digest.filesTouched.length > 0) {
                lines.push(
                        `changed:  ${inputs.digest.filesTouched.slice(0, 6).join(" · ")}${inputs.digest.filesTouched.length > 6 ? ` +${inputs.digest.filesTouched.length - 6} more` : ""}`,
                );
        }
        if (inputs.digest.lastAssistantPreview) {
                const preview = inputs.digest.lastAssistantPreview.replace(/\s+/g, " ").trim();
                lines.push(`last:     ${preview.slice(0, 72)}${preview.length >= 72 ? "…" : ""}`);
        }

        // 3. Why — the decisions (LLM-mined on /brief; the auto brief points at it).
        if (inputs.decisions) {
                lines.push(`why:      ${inputs.decisions.replace(/\s+/g, " ").trim().slice(0, 140)}`);
        } else {
                lines.push("why:      /brief mines the decisions when you want them");
        }

        // 4. State + risks — where the work stands, what needs attention.
        const state: string[] = [];
        if (inputs.remains.planRemaining > 0)
                state.push(`plan ${inputs.remains.planRemaining} step${inputs.remains.planRemaining === 1 ? "" : "s"} left`);
        if (inputs.remains.openTodos.length > 0) {
                state.push(`${inputs.remains.openTodos.length} open todo${inputs.remains.openTodos.length === 1 ? "" : "s"}`);
        }
        if (inputs.remains.goal) state.push(`goal ${inputs.remains.goal.status}`);
        if (state.length > 0) lines.push(`state:    ${state.join(" · ")}`);
        lines.push(
                `conf:     ${inputs.confidence.level}${inputs.confidence.drivers.length ? ` (${inputs.confidence.drivers.join(", ")})` : " — no failures this session"}`,
        );
        if (inputs.risks.length > 0) lines.push(`risks:    ${inputs.risks.slice(0, 3).join(" · ")}`);

        // 5. What was learned — the feed's events inside the window.
        if (inputs.learned.length > 0) {
                lines.push(`learned:  ${inputs.learned.slice(0, 3).join(" · ")}`);
        } else {
                lines.push("learned:  nothing new while you were away");
        }

        // 6. Metrics — the session rollup (the /usage attribution).
        const cost = inputs.telemetry.costUsd !== null ? ` · ~$${formatCost(inputs.telemetry.costUsd)}` : "";
        lines.push(
                `session:  ${formatMissionAge(inputs.telemetry.sessionMs)} · ${inputs.telemetry.tokensIn} in / ${inputs.telemetry.tokensOut} out${cost}`,
        );

        // 7. What remains — always the last line; the next action rides it.
        const remains: string[] = [];
        if (inputs.remains.openTodos.length > 0) remains.push(`"${inputs.remains.openTodos[0]}"`);
        if (inputs.remains.planRemaining > 0 && remains.length === 0)
                remains.push(`${inputs.remains.planRemaining} plan steps`);
        if (inputs.risks.length > 0) remains.push(`attention: ${inputs.risks[0]}`);
        if (remains.length === 0) remains.push("nothing open — the last turn settled");
        lines.push(`remains:  ${remains.join(" · ")}`);

        return lines.join("\n");
}
