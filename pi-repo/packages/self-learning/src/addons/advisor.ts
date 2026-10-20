/**
 * addons/advisor.ts — the live advisor addon.
 *
 * A reverse-engineered port of oh-my-pi's advisor/watchdog subsystem
 * (can1357/oh-my-pi, MIT) as a unown TUI addon: a second model instance
 * ("the advisor") watches the primary session's transcript as a compact
 * stream of per-turn deltas, verifies claims with read-only tools
 * (read/grep/find), and sends terse advice back to the primary agent
 * mid-run through the `advise` contract — nits queue as a visible aside at
 * the next turn boundary, concerns/blockers steer immediately.
 *
 * Runtime shape (see advisor-core.ts for the ported pure logic):
 *   - One advisor per session, created lazily at the first review.
 *   - The advisor's loop is a bounded turn loop over the session's
 *     modelRegistry.complete() — in-process, no second AgentSession, no
 *     second extension surface. It stops after the last advise call
 *     (upstream's graceful terminal-tool abort, expressed as a loop bound).
 *   - Backpressure: reviews are fire-and-forget from turn_end (the primary
 *     never waits on the advisor); deltas that arrive while a review runs
 *     coalesce into the next batch.
 *   - Context hygiene: the advisor's own history trims oldest-first against
 *     a fraction of its model's context window (default 60%).
 *   - Cost discipline: the emission guard (noise → dedupe → per-update
 *     budget) is the ONLY path from the advisor model to the primary agent.
 *
 * Delivery surfaces:
 *   - Primary agent: custom messages of type "unown-advisor" (steered for
 *     concern/blocker, next-turn for asides) carrying <advisory> XML.
 *   - User: an inline transcript card per advice batch (message renderer)
 *     plus a footer status segment while a review runs.
 *   - /advisor status|on|off — live configuration + health.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
        createFindToolDefinition,
        createGrepToolDefinition,
        createReadToolDefinition,
        type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { AdvisorAddonConfig } from "./config.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
        ADVISOR_SYSTEM_PROMPT,
        type AdviseNote,
        type AdviseSeverity,
        decideDelivery,
        escapeXmlText,
        EmissionGuard,
        estimateContextTokens,
        formatAdvisorBatchContent,
        renderDelta,
        readWatchdogGuidance,
        SEVERITY_RANK,
        trimToBudget,
} from "./advisor-core.ts";

export const ADVISOR_CUSTOM_TYPE = "unown-advisor";
const ADVISOR_MAX_TOOL_ITERATIONS = 8;
const ADVISOR_CONTEXT_FRACTION = 0.6;
const ADVISOR_MAX_CONSECUTIVE_FAILURES = 3;

/** Module-level status snapshot for /addons and /advisor status. */
let lastAdvisorStatus = "advisor: idle (no reviews yet)";

export function advisorStatusLine(): string {
        return lastAdvisorStatus;
}

// ---------------------------------------------------------------------------
// Advisor-side tool schema
// ---------------------------------------------------------------------------

const AdviseParams = Type.Object({
        note: Type.String({
                description:
                        "One concrete piece of advice for the agent you are watching. Terse, specific, actionable.",
        }),
        severity: Type.Optional(
                Type.String({
                        description: "How strongly to weigh this. Omit for a plain nit.",
                }),
        ),
});

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

interface CompleteFn {
        (model: Model<never>, context: { systemPrompt?: string; messages: AgentMessage[]; tools?: unknown[] }, options?: { reasoning?: string }): Promise<{
                content: Array<{ type: string; text?: string; name?: string; id?: string; arguments?: Record<string, unknown> }>;
                usage?: { input?: number; output?: number; totalTokens?: number };
                stopReason?: string;
                errorMessage?: string;
        }>;
}

interface AdvisorRuntimeOptions {
        config: AdvisorAddonConfig;
        cwd: string;
        complete: CompleteFn;
        model: Model<never>;
        systemPrompt: string;
        verbose?: boolean;
}

interface PendingDelta {
        text: string;
        inProgress: boolean;
        turnIndex: number;
}

class AdvisorRuntime {
        private readonly config: AdvisorAddonConfig;
        private readonly complete: CompleteFn;
        private readonly model: Model<never>;
        private readonly systemPrompt: string;
        private readonly cwd: string;
        private readonly verbose: boolean;
        private readonly guard: EmissionGuard;
        private readonly readTool: ReturnType<typeof createReadToolDefinition>;
        private readonly grepTool: ReturnType<typeof createGrepToolDefinition>;
        private readonly findTool: ReturnType<typeof createFindToolDefinition>;

        private advisorMessages: AgentMessage[] = [];
        private transcript: AgentMessage[] = [];
        private lastCount = 0;
        private pending: PendingDelta[] = [];
        private busy = false;
        private disposed = false;
        private halted = false;
        private consecutiveFailures = 0;
        private immuneTurns = 0;
        private turnCounter = 0;
        private deferredNotes: AdviseNote[] = [];
        private usageTotals = { input: 0, output: 0, reviews: 0, advises: 0 };
        private lastActivity = "never";

        onAdvise: ((notes: AdviseNote | AdviseNote[], channel: "steer" | "aside") => void) | undefined;
        onStatus: ((text: string) => void) | undefined;

        constructor(options: AdvisorRuntimeOptions) {
                this.config = options.config;
                this.complete = options.complete;
                this.model = options.model;
                this.systemPrompt = options.systemPrompt;
                this.cwd = options.cwd;
                this.verbose = options.verbose ?? false;
                this.guard = new EmissionGuard({ budgetPerUpdate: options.config.maxNotesPerUpdate });
                this.readTool = createReadToolDefinition(this.cwd);
                this.grepTool = createGrepToolDefinition(this.cwd);
                this.findTool = createFindToolDefinition(this.cwd);
        }

        // -- Primary-session feed ---------------------------------------------------

        /** Accumulate the primary transcript (skip our own delivered advice). */
        observe(message: AgentMessage): void {
                if (this.disposed) return;
                const customType = (message as { customType?: string }).customType;
                if (customType === ADVISOR_CUSTOM_TYPE) return;
                this.transcript.push(message);
        }

        /**
         * A primary turn boundary. The delta is captured NOW (detached copy) so
         * later in-place edits cannot rewrite history the advisor already saw;
         * dispatch is fire-and-forget — the primary never waits on the advisor.
         */
        onTurnEnd(willContinue: boolean): void {
                if (this.disposed || this.halted) return;
                this.turnCounter++;
                if (this.config.reviewMode === "turn" && this.turnCounter % this.config.reviewInterval !== 0) return;
                const delta = this.transcript.slice(this.lastCount);
                this.lastCount = this.transcript.length;
                if (delta.length === 0) return;
                this.pending.push({
                        text: renderDelta(delta, { inProgress: willContinue }),
                        inProgress: willContinue,
                        turnIndex: this.turnCounter,
                });
                void this.drain();
        }

        /** The agent loop finished: review remaining deltas, flush asides. */
        onAgentEnd(): void {
                if (this.disposed || this.halted) return;
                if (this.config.reviewMode === "agent-end") {
                        const delta = this.transcript.slice(this.lastCount);
                        this.lastCount = this.transcript.length;
                        if (delta.length > 0) {
                                this.pending.push({
                                        text: renderDelta(delta, { inProgress: false }),
                                        inProgress: false,
                                        turnIndex: this.turnCounter,
                                });
                        }
                }
                this.flushDeferredAsides();
                void this.drain();
        }

        reset(): void {
                this.advisorMessages = [];
                this.transcript = [];
                this.lastCount = 0;
                this.pending = [];
                this.guard.reset();
                this.deferredNotes = [];
                this.immuneTurns = 0;
                this.turnCounter = 0;
                this.halted = false;
                this.consecutiveFailures = 0;
        }

        dispose(): void {
                this.disposed = true;
                this.pending = [];
        }

        usageSummary(): string {
                return `${this.usageTotals.reviews} reviews · ${this.usageTotals.advises} advises · ${Math.round((this.usageTotals.input + this.usageTotals.output) / 1000)}k tokens`;
        }

        lastActivityAt(): string {
                return this.lastActivity;
        }

        // -- Dispatch ----------------------------------------------------------------

        private async drain(): Promise<void> {
                if (this.busy || this.disposed || this.halted) return;
                this.busy = true;
                try {
                        while (this.pending.length > 0 && !this.disposed && !this.halted) {
                                // Coalesce: everything queued joins one review batch.
                                const batch = this.pending.splice(0, this.pending.length);
                                await this.review(batch);
                        }
                } finally {
                        this.busy = false;
                }
        }

        private async review(batch: PendingDelta[]): Promise<void> {
                const text = batch.map((entry) => entry.text).join("\n\n");
                const inProgress = batch.some((entry) => entry.inProgress);
                this.guard.beginUpdate();
                this.setStatus(`advisor: reviewing${inProgress ? " (turn in progress)" : ""}…`);
                const userMessage: AgentMessage = {
                        role: "user",
                        content: text,
                        timestamp: Date.now(),
                } as AgentMessage;
                this.advisorMessages.push(userMessage);
                // Context hygiene before the call.
                const maxTokens = Math.floor((this.model.contextWindow || 131072) * ADVISOR_CONTEXT_FRACTION);
                const trim = trimToBudget(this.advisorMessages, maxTokens);
                if (trim.trimmed > 0) {
                        this.advisorMessages = [
                                {
                                        role: "user",
                                        content: "[advisor context trimmed oldest-first]",
                                        timestamp: Date.now(),
                                } as AgentMessage,
                                ...trim.messages,
                        ];
                }
                try {
                        await this.runAdvisorLoop();
                        this.consecutiveFailures = 0;
                        this.usageTotals.reviews++;
                        this.lastActivity = new Date().toISOString();
                } catch (error) {
                        this.consecutiveFailures++;
                        this.log(`review failed: ${String(error)}`);
                        if (this.consecutiveFailures >= ADVISOR_MAX_CONSECUTIVE_FAILURES) {
                                this.halted = true;
                                this.setStatus("advisor: halted after repeated failures (/advisor status)");
                        }
                }
                if (this.immuneTurns > 0) this.immuneTurns--;
                this.setStatus(`advisor: watching (${this.usageSummary()})`);
        }

        /**
         * The bounded advisor turn loop: complete() → execute its tool calls
         * (advise is terminal-adjacent: the loop ends after the LAST advise in a
         * message, mirroring upstream's graceful stop) → repeat until the model
         * yields text without tool calls or the iteration bound trips.
         */
        private async runAdvisorLoop(): Promise<void> {
                const tools = [
                        { name: "advise", description: ADVISE_TOOL_DESCRIPTION, parameters: AdviseParams },
                        { name: this.readTool.name, description: this.readTool.description, parameters: this.readTool.parameters },
                        { name: this.grepTool.name, description: this.grepTool.description, parameters: this.grepTool.parameters },
                        { name: this.findTool.name, description: this.findTool.description, parameters: this.findTool.parameters },
                ];
                for (let iteration = 0; iteration < ADVISOR_MAX_TOOL_ITERATIONS; iteration++) {
                        const contextTokens = estimateContextTokens(this.systemPrompt, this.advisorMessages);
                        const assistant = await this.complete(
                                this.model,
                                { systemPrompt: this.systemPrompt, messages: this.advisorMessages, tools },
                                { reasoning: this.config.thinkingLevel },
                        );
                        const usage = (assistant as { usage?: { input?: number; output?: number } }).usage;
                        if (usage) {
                                this.usageTotals.input += usage.input ?? 0;
                                this.usageTotals.output += usage.output ?? 0;
                        }
                        const blocks = assistant.content ?? [];
                        const textBlocks = blocks.filter((block): block is { type: "text"; text: string } => block.type === "text");
                        const toolCalls = blocks.filter(
                                (block): block is { type: "toolCall"; name: string; id: string; arguments: Record<string, unknown> } =>
                                        block.type === "toolCall",
                        );
                        this.advisorMessages.push({
                                role: "assistant",
                                content: blocks as never,
                                api: "unknown",
                                provider: "advisor",
                                model: this.model.id,
                                timestamp: Date.now(),
                        } as unknown as AgentMessage);
                        if (assistant.stopReason === "error" || assistant.errorMessage) {
                                throw new Error(assistant.errorMessage ?? "advisor model error");
                        }
                        if (toolCalls.length === 0) {
                                // Pure text: the advisor chose silence or commentary — done.
                                return;
                        }
                        let sawAdvise = false;
                        for (const call of toolCalls) {
                                const result = await this.executeAdvisorTool(call.name, call.arguments, call.id);
                                if (call.name === "advise") sawAdvise = true;
                                this.advisorMessages.push({
                                        role: "toolResult",
                                        toolCallId: call.id,
                                        toolName: call.name,
                                        content: [{ type: "text", text: result }],
                                        timestamp: Date.now(),
                                } as AgentMessage);
                        }
                        // Graceful stop after the last advise call in this message.
                        if (sawAdvise && textBlocks.length === 0) return;
                        void contextTokens;
                }
        }

        private async executeAdvisorTool(name: string, args: Record<string, unknown>, toolCallId: string): Promise<string> {
                if (name === "advise") {
                        return this.handleAdvise(args);
                }
                const definition = name === "read" ? this.readTool : name === "grep" ? this.grepTool : name === "find" ? this.findTool : undefined;
                if (!definition) return `Tool ${name} not found`;
                try {
                        const result = await definition.execute(toolCallId, args as never, undefined, undefined, undefined as never);
                        const blocks = (result.content ?? []) as Array<{ type: string; text?: string }>;
                        return blocks
                                .filter((block) => block.type === "text")
                                .map((block) => block.text ?? "")
                                .join("\n")
                                .slice(0, 8192);
                } catch (error) {
                        return `Error: ${String(error)}`;
                }
        }

        // -- Advise delivery ----------------------------------------------------------

        private handleAdvise(args: Record<string, unknown>): string {
                const note = typeof args.note === "string" ? args.note.trim() : "";
                const rawSeverity = typeof args.severity === "string" ? args.severity.toLowerCase() : undefined;
                const severity: AdviseSeverity | undefined =
                        rawSeverity === "nit" || rawSeverity === "concern" || rawSeverity === "blocker" ? rawSeverity : undefined;
                const turnIndex = Math.max(0, this.turnCounter);
                const verdict = this.guard.evaluate(note, severity);
                if (verdict.verdict === "suppressed") {
                        switch (verdict.reason) {
                                case "noise":
                                        return "Dropped: nothing actionable.";
                                case "duplicate":
                                        return "Dropped: already raised.";
                                case "budget":
                                        return "Dropped: this update's advice budget is spent.";
                                default:
                                        return "Dropped: empty note.";
                        }
                }
                if (verdict.verdict === "displaced") {
                        // A higher-rank note took the pending slot of a lower one.
                        this.deferredNotes = this.deferredNotes.filter((entry) => entry.note !== note);
                }
                const advice: AdviseNote = { note, severity, turnIndex };
                this.usageTotals.advises++;
                const decision = decideDelivery(severity, this.immuneTurns);
                if (decision.channel === "steer") {
                        this.immuneTurns = this.config.immuneTurns;
                        this.onAdvise?.(advice, "steer");
                        this.deferredNotes = [];
                        return "Delivered.";
                }
                this.deferredNotes.push(advice);
                return "Queued for the end of the turn. Do not re-raise.";
        }

        /** One merged aside message at the turn boundary (upstream behavior). */
        flushDeferredAsides(): void {
                if (this.deferredNotes.length === 0) return;
                const notes = this.deferredNotes;
                this.deferredNotes = [];
                this.onAdvise?.(notes, "aside");
        }

        private setStatus(text: string): void {
                lastAdvisorStatus = text;
                this.onStatus?.(text);
        }

        private log(message: string): void {
                if (this.verbose) console.error(`[unown-addons/advisor] ${message}`);
        }
}

const ADVISE_TOOL_DESCRIPTION =
        "Watched agent: send 1 concrete, terse advice. Use sparingly; stay silent when nothing matters. Call to avert likely-wrong or materially wasteful work.";

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterAdvisorOptions {
        cwd: string;
        verbose?: boolean;
}

/** Resolve the advisor model from config ("provider/model" or bare id). */
function resolveAdvisorModel(config: AdvisorAddonConfig, ctx: ExtensionContext): Model<never> | undefined {
        const registry = ctx.modelRegistry;
        const spec = config.model?.trim();
        if (spec && registry) {
                const slash = spec.indexOf("/");
                if (slash > 0) {
                        const found = registry.find(spec.slice(0, slash), spec.slice(slash + 1));
                        if (found) return found as Model<never>;
                }
                for (const candidate of registry.getAll()) {
                        if (candidate.id === spec) return candidate as Model<never>;
                }
                // Unresolved: fall back to the session model (upstream behavior).
        }
        return (ctx.model as Model<never> | undefined) ?? (registry?.getAvailable?.()[0] as Model<never> | undefined);
}

function buildSystemPrompt(config: AdvisorAddonConfig, cwd: string): string {
        let prompt = ADVISOR_SYSTEM_PROMPT.replace("{{max_notes_per_update}}", String(config.maxNotesPerUpdate));
        const watchdog = readWatchdogGuidance(cwd);
        if (watchdog) prompt += `\n\n${watchdog}`;
        if (config.instructions?.trim()) {
                prompt += `\n\n<user instructions>\n${config.instructions.trim()}\n</user instructions>`;
        }
        return prompt;
}

function severityLabel(severity: AdviseSeverity | undefined): string {
        return severity === undefined ? "note" : severity;
}

/** The inline transcript card for advice batches (message renderer). */
function renderAdviceCard(message: { content?: unknown; details?: unknown }, theme: Theme): Text {
        const details = message.details as { notes?: AdviseNote[] } | undefined;
        const notes = details?.notes ?? [];
        if (notes.length === 0) {
                const text = typeof message.content === "string" ? message.content : "";
                return new Text(`${theme.fg("muted", "ⓘ Advisor")} ${theme.fg("dim", text.split("\n")[0] ?? "")}`, 0, 0);
        }
        const blockers = notes.filter((note) => note.severity === "blocker").length;
        const header = `ⓘ Advisor ${notes.length} note${notes.length > 1 ? "s" : ""}${blockers > 0 ? ` · ${blockers} blocker${blockers > 1 ? "s" : ""}` : ""}`;
        const lines = [theme.fg("muted", theme.bold(header))];
        for (const note of notes.slice(0, 5)) {
                const color = note.severity === "blocker" ? "error" : note.severity === "concern" ? "warning" : "dim";
                const badge = note.severity ? `[${note.severity}] ` : "";
                lines.push(`  ${theme.fg(color, `${badge}${note.note.split("\n")[0] ?? ""}`)}`);
        }
        if (notes.length > 5) {
                lines.push(theme.fg("dim", `  … +${notes.length - 5} more notes`));
        }
        return new Text(lines.join("\n"), 0, 0);
}

export function registerAdvisorAddon(pi: ExtensionAPI, config: AdvisorAddonConfig, opts: RegisterAdvisorOptions): void {
        let runtime: AdvisorRuntime | undefined;
        let resolveCtx: ExtensionContext | undefined;
        const verbose = opts.verbose ?? false;

        const ensureRuntime = (ctx: ExtensionContext): AdvisorRuntime | undefined => {
                if (runtime) return runtime;
                const model = resolveAdvisorModel(config, ctx);
                if (!model) {
                        lastAdvisorStatus = "advisor: no model resolved (configure addons.json advisor.model)";
                        return undefined;
                }
                const registry = ctx.modelRegistry;
                const complete = ((targetModel: Model<never>, context: { systemPrompt?: string; messages: AgentMessage[]; tools?: unknown[] }, options?: { reasoning?: string }) =>
                        registry.complete(targetModel as never, context as never, options as never)) as CompleteFn;
                const created = new AdvisorRuntime({
                        config,
                        cwd: opts.cwd,
                        complete,
                        model,
                        systemPrompt: buildSystemPrompt(config, opts.cwd),
                        verbose,
                });
                created.onAdvise = (noteOrNotes, channel) => {
                        const notes = Array.isArray(noteOrNotes) ? noteOrNotes : [noteOrNotes];
                        if (notes.length === 0) return;
                        const content = formatAdvisorBatchContent(notes);
                        const details = { notes, channel };
                        const message = {
                                customType: ADVISOR_CUSTOM_TYPE,
                                content,
                                display: true,
                                details,
                        };
                        if (channel === "steer") {
                                pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
                        } else {
                                pi.sendMessage(message, { deliverAs: "nextTurn" });
                        }
                };
                created.onStatus = (text: string) => {
                        if (config.showStatus) resolveCtx?.ui.setStatus("advisor", text);
                };
                runtime = created;
                lastAdvisorStatus = `advisor: watching (${created.usageSummary()})`;
                return created;
        };

        // -- transcript feed -----------------------------------------------------------

        pi.on("message_end", async (event, ctx) => {
                const typed = event as { message?: AgentMessage };
                if (!typed.message) return;
                resolveCtx = ctx;
                runtime?.observe(typed.message);
        });

        pi.on("turn_end", async (_event, ctx) => {
                resolveCtx = ctx;
                const instance = ensureRuntime(ctx);
                instance?.onTurnEnd(true);
        });

        pi.on("agent_end", async (_event, ctx) => {
                resolveCtx = ctx;
                const instance = ensureRuntime(ctx);
                instance?.onAgentEnd();
                if (config.showStatus) ctx.ui.setStatus("advisor", `advisor: watching (${instance?.usageSummary() ?? "0 reviews"})`);
        });

        pi.on("session_start", async () => {
                runtime?.reset();
        });

        pi.on("session_shutdown", async () => {
                runtime?.dispose();
                runtime = undefined;
                resolveCtx?.ui.setStatus("advisor", undefined);
        });

        // -- transcript card -------------------------------------------------------------

        pi.registerMessageRenderer(ADVISOR_CUSTOM_TYPE, (message, _options, theme) => {
                return renderAdviceCard(message as { content?: unknown; details?: unknown }, theme);
        });

        // -- /advisor command -------------------------------------------------------------

        pi.registerCommand("advisor", {
                description: "Advisor status and control: /advisor [status|on|off]",
                handler: async (args: string | undefined, ctx: ExtensionContext) => {
                        const sub = (args ?? "").trim().split(/\s+/)[0] ?? "status";
                        if (sub === "on" || sub === "off") {
                                const updated = sub === "on";
                                config.enabled = updated;
                                // Persist through the shared addons config (advisor section only).
                                const { loadAddonsConfig, saveAddonsConfig } = await import("./config.ts");
                                const fresh = loadAddonsConfig();
                                fresh.advisor.enabled = updated;
                                saveAddonsConfig(fresh);
                                ctx.ui.notify(`advisor ${updated ? "enabled" : "disabled"} — /reload applies it`, "info");
                                return;
                        }
                        const model = runtime ? resolveAdvisorModel(config, ctx) : resolveAdvisorModel(config, ctx);
                        const lines = [
                                `advisor: ${config.enabled ? "enabled" : "disabled"}${runtime ? " (active)" : ""}`,
                                `  model: ${model ? `${model.provider}/${model.id}` : config.model ?? "(session model)"}`,
                                `  cadence: ${config.reviewMode}${config.reviewMode === "turn" ? ` / every ${config.reviewInterval}` : ""}`,
                                `  notes/review: ${config.maxNotesPerUpdate} · thinking: ${config.thinkingLevel} · immune turns: ${config.immuneTurns}`,
                                `  status: ${lastAdvisorStatus}`,
                                runtime ? `  usage: ${runtime.usageSummary()} · last review: ${runtime.lastActivityAt()}` : "  usage: (no reviews yet)",
                                `  guidance: ${readWatchdogGuidance(opts.cwd) ? "WATCHDOG.md loaded" : "no WATCHDOG.md"}`,
                        ];
                        ctx.ui.notify(lines.join("\n"), "info");
                },
        });
}

export { escapeXmlText };
