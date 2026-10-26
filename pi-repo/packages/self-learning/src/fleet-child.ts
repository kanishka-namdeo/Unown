/**
 * fleet-child.ts — the fleet extension loaded INTO spawned subagents.
 *
 * The parent-side half lives in fleet.ts (protocol) + fleet-runtime.ts
 * (manager). This module is the child's end of the pipe, injected by
 * cli.ts's bootRuntime whenever the parent set UNOWN_FLEET_CONTROL — i.e.
 * only for fleet children, never for ordinary sessions or sync-lane
 * subagents.
 *
 * Responsibilities (the pi-interactive-subagents subagent-done.ts port,
 * substrate-swapped):
 *
 *   1. STEERING — poll the control-file inbox every 250ms; a `steer`
 *      command is delivered through pi's native queue
 *      (sendUserMessage deliverAs:"steer"), so it is absorbed into the
 *      running turn or picked up at the next turn boundary. Newlines are
 *      flattened by the parent before they ever reach the file.
 *
 *   2. ANSWERS — an `answer` command (the parent replying to ask_question)
 *      is delivered the same way and also resolves the parked question.
 *
 *   3. STOP — a `stop` command shuts the session down cleanly (the runtime
 *      also kills the process tree on its own watchdog; this is the polite
 *      path).
 *
 *   4. ask_question — the child→parent question tool. Writes the ask file,
 *      then BLOCKS inside the tool call polling for the parent's answer
 *      (the substrate swap for "the child parks itself open in its pane":
 *      a headless child cannot stay alive after its turn chain ends, so
 *      the park happens inside the tool execution instead). Times out with
 *      honest guidance so an unattended parent never wedges the child.
 *
 * Cross-platform by construction: one interval, one file, no terminal
 * multiplexer, no signals.
 *
 * Standing invariant: no fork of the pi substrate; this is a factory
 * injected through cli.ts's extensionFactories seam.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Type } from "typebox";
import {
        consumeControlCommands,
        FLEET_ASK_TIMEOUT_MS,
        FLEET_CONTROL_ENV,
        FLEET_ID_ENV,
        type FleetLoadout,
} from "./fleet.ts";

/** The poll cadence for the control inbox (ms). Cheap: stat + short read. */
const CONTROL_POLL_MS = 250;

/** Heartbeat cadence: every 4th poll (~1s at the default cadence). The file
 * (fleet-reaper.ts reads it) is the crash sweeper's identity + liveness
 * signal — self-written by the child, so a stale or absent file can never be
 * mistaken for a live one. */
const HEARTBEAT_EVERY_POLLS = 4;

/** Prefix of the typed cancellation a stop delivers into a parked ask — the
 * ask tool returns that text VERBATIM (never prefixed as an answer: a
 * fabricated "answer" to a cancelled question is the exact anti-pattern
 * Claude Code ships as issue #87179). */
const STOP_PREFIX = "[stop requested by the orchestrator]";

/** The unpark-on-stop cancellation text (R3-F1, measured live 2026-10-26:
 * pre-fix the parked child consumed the stop but only steer/answer or the
 * 600s deadline could resolve the waiter, so the child lingered parked
 * until the parent's tree-kill backstop SIGTERM'd it mid-park — exit 143,
 * ask file rot, wrap-up never model-visible). */
const STOP_WHILE_PARKED_TEXT =
        `${STOP_PREFIX} No answer will come. Finish your current thought in one short sentence and stop — do not start new work.`;

export interface FleetChildOptions {
        /** Override the env source (tests). Defaults to process.env. */
        env?: Record<string, string | undefined>;
        /** Override the poll cadence (tests). */
        pollMs?: number;
        /** Override the ask timeout (tests). */
        askTimeoutMs?: number;
}

/**
 * Build the fleet child extension factory. Returns null when the fleet env
 * is absent (the caller then injects nothing — ordinary session).
 */
export function createFleetChildExtension(opts: FleetChildOptions = {}) {
        const env = opts.env ?? process.env;
        const controlFile = env[FLEET_CONTROL_ENV];
        if (!controlFile) return null;

        const askFile = env.UNOWN_FLEET_ASK;
        const childId = env[FLEET_ID_ENV] ?? "unknown";
        const pollMs = opts.pollMs ?? CONTROL_POLL_MS;
        const askTimeoutMs = opts.askTimeoutMs ?? FLEET_ASK_TIMEOUT_MS;

        return {
                name: "unown-fleet-child",
                factory(pi: any) {
                        let disposed = false;
                        // Parked ask_question waiters, FIFO (R3-F2 follow-up, live
                        // 2026-10-26): the runtime can execute two ask_question
                        // calls from ONE assistant message CONCURRENTLY — a single
                        // answerWaiter was CLOBBERED by the second park (the first
                        // tool's waiter was lost forever: it parked 600s, its
                        // question already answered to somebody else). A queue + a
                        // parked-ask refcount for the shared ask file (the file is
                        // the LATEST question; it must outlive every answer but the
                        // last) makes the concurrent shape behave like the
                        // sequential one.
                        const parkedWaiters: Array<{ question: string; accept: (text: string) => void }> = [];
                        /** The standing ask file's question (the latest park) — what
                         *  the parent actually sees and answers. */
                        let standingQuestion: string | null = null;
                        let parkedAsks = 0;
                        let shutdownRequested = false;
                        // Monotonic per-ask counter (R3-F2): the ask payload's
                        // (ts, seq) pair identifies the ask INSTANCE — the
                        // parent dedups on it, never on question text.
                        let askSeq = 0;
                        let pollCount = 0;
                        // Heartbeat file: <id>.hb.json beside the control file.
                        const hbFile = controlFile.replace(/\.control\.json$/, ".hb.json");

                        const deliver = (text: string) => {
                                try {
                                        pi.sendUserMessage(text, { deliverAs: "steer" });
                                } catch {
                                        // sendUserMessage during shutdown races — never fatal.
                                }
                        };

                        const handleCommands = () => {
                                if (disposed) return;
                                let commands: ReturnType<typeof consumeControlCommands>;
                                try {
                                        commands = consumeControlCommands(controlFile);
                                } catch {
                                        return;
                                }
                                for (const command of commands) {
                                        if (command.kind === "steer" || command.kind === "answer") {
                                                if (parkedWaiters.length > 0) {
                                                        // A steer/answer while parked on ask_question IS the
                                                        // answer — the question message tells the parent to
                                                        // answer via task_control steer, so the parked tool
                                                        // must consume it (measured live: otherwise the child
                                                        // deadlocks inside the tool call while steers pile up
                                                        // unconsumed). The answer satisfies the asker(s) of
                                                        // the STANDING question (the one the parent saw):
                                                        // identical-text concurrent siblings all resolve —
                                                        // an answer to a question answers every copy of it —
                                                        // while a different-text waiter keeps its turn (the
                                                        // parent has not seen THAT question yet).
                                                        const targets =
                                                                standingQuestion !== null
                                                                        ? parkedWaiters.filter((w) => w.question === standingQuestion)
                                                                        : [];
                                                        const resolved = targets.length > 0 ? targets : [parkedWaiters.shift()!];
                                                        for (const t of resolved) {
                                                                const idx = parkedWaiters.indexOf(t);
                                                                if (idx !== -1) parkedWaiters.splice(idx, 1);
                                                        }
                                                        for (const t of resolved) t.accept(command.text);
                                                } else {
                                                        deliver(
                                                                command.kind === "steer"
                                                                        ? `[steer from the orchestrator] ${command.text}`
                                                                        : `[answer from the orchestrator] ${command.text}`,
                                                        );
                                                }
                                        } else if (command.kind === "stop") {
                                                shutdownRequested = true;
                                                try {
                                                        pi.appendEntry?.("unown-fleet-child-stopped", { id: childId, ts: Date.now() });
                                                } catch {
                                                        /* best effort */
                                                }
                                                if (parkedWaiters.length > 0) {
                                                        // Round 3 (R3-F1, live 2026-10-26): a stop while parked
                                                        // on ask_question UN-PARKS with an honest cancellation.
                                                        // Pre-fix the waiter resolved only via steer/answer or
                                                        // the 600s deadline — the queued wrap-up steer landed in
                                                        // a turn that could never start (the tool's await held
                                                        // it), so the child sat parked until the parent's
                                                        // tree-kill backstop SIGTERM'd it (exit 143) and the ask
                                                        // file rotted on disk. A stop cancels EVERY parked ask
                                                        // (concurrent askers all learn no answer will come).
                                                        while (parkedWaiters.length > 0) {
                                                                const w = parkedWaiters.shift()!;
                                                                w.accept(STOP_WHILE_PARKED_TEXT);
                                                        }
                                                        standingQuestion = null;
                                                } else {
                                                        try {
                                                                // ctx is not reachable here; the extension API
                                                                // exposes no shutdown directly — emulate by
                                                                // delivering a terminal instruction and letting
                                                                // the parent's process kill close us out.
                                                                deliver(
                                                                        "[stop requested by the orchestrator] Finish your current thought in one short sentence and stop — do not start new work.",
                                                                );
                                                        } catch {
                                                                /* best effort */
                                                        }
                                                }
                                        }
                                }
                        };

                        const timer = setInterval(() => {
                                pollCount++;
                                handleCommands();
                                // Round 3 heartbeat (~1x/s): the crash sweeper's identity +
                                // liveness signal (fleet-reaper.ts). A parked orphan keeps
                                // beating — the poller runs while the ask deadline holds the
                                // loop open — so the next boot can tell "our child, alive"
                                // (fresh hb + self-reported pid) from "already dead" (stale
                                // hb) and never guess from a bare pid.
                                if (pollCount % HEARTBEAT_EVERY_POLLS === 1) {
                                        try {
                                                writeFileSync(
                                                        hbFile,
                                                        JSON.stringify({ pid: process.pid, ts: Date.now() }),
                                                        { encoding: "utf8", mode: 0o600 },
                                                );
                                        } catch {
                                                /* best effort */
                                        }
                                }
                        }, pollMs);
                        // Never hold the process open just for the inbox.
                        if (typeof timer.unref === "function") timer.unref();

                        // ---- ask_question: the child→parent question tool.
                        pi.registerTool({
                                name: "ask_question",
                                label: "Ask the orchestrator",
                                description:
                                        "Ask the orchestrating agent (not the human user) ONE clarifying question when the task cannot proceed safely without more information. Blocks until the orchestrator answers (or times out) — the answer arrives as your next instruction. Use sparingly: prefer completing the task with stated assumptions when you can.",
                                parameters: Type.Object({
                                        question: Type.String({
                                                description: "The single question, self-contained, answerable in a sentence or two",
                                        }),
                                        context: Type.Optional(
                                                Type.String({
                                                        description: "One line of context: what you have tried or why the answer changes your next step",
                                                }),
                                        ),
                                }),
                                async execute(_toolCallId: string, params: { question: string; context?: string }) {
                                        if (!askFile) {
                                                return {
                                                        content: [
                                                                {
                                                                        type: "text",
                                                                        text: "ask_question is unavailable in this run (no ask channel) — proceed with your best judgment and state your assumptions in the final report.",
                                                                },
                                                        ],
                                                };
                                        }
                                        const question = params.question?.trim().slice(0, 4000) ?? "";
                                        if (!question) {
                                                return { content: [{ type: "text", text: "Error: provide a non-empty question" }] };
                                        }
                                        // Park: write the ask file, then block on the answer.
                                        // seq (R3-F2): the ask INSTANCE id — the parent dedups
                                        // on (ts, seq), so an identical-text re-ask is a NEW
                                        // question (live 2026-10-26: a same-message double-ask
                                        // was swallowed whole by the text-keyed dedup and the
                                        // child parked the full 600s on a question the parent
                                        // never saw). Concurrent parks each write the file — it
                                        // always shows the LATEST pending question.
                                        askSeq += 1;
                                        parkedAsks += 1;
                                        standingQuestion = question;
                                        const payload = JSON.stringify(
                                                {
                                                        id: childId,
                                                        question,
                                                        context: (params.context ?? "").slice(0, 1000),
                                                        ts: Date.now(),
                                                        seq: askSeq,
                                                },
                                                null,
                                                2,
                                        );
                                        try {
                                                writeFileSync(askFile, payload, { encoding: "utf8", mode: 0o600 });
                                        } catch {
                                                return {
                                                        content: [{ type: "text", text: "ask_question failed to write its channel — proceed with your best judgment." }],
                                                };
                                        }
                                        const answer = await new Promise<string | null>((resolve) => {
                                                const accept = (text: string) => {
                                                        clearTimeout(deadline);
                                                        resolve(text);
                                                };
                                                const deadline = setTimeout(() => {
                                                        // Timed out: withdraw from the parked queue wherever
                                                        // we sit (FIFO may have moved on) and resolve honestly.
                                                        const idx = parkedWaiters.indexOf(entry);
                                                        if (idx !== -1) parkedWaiters.splice(idx, 1);
                                                        resolve(null);
                                                }, askTimeoutMs);
                                                const entry = { question, accept };
                                                parkedWaiters.push(entry);
                                        });
                                        parkedAsks -= 1;
                                        if (parkedAsks <= 0) standingQuestion = null;
                                        try {
                                                // The ask file outlives every answer but the LAST parked
                                                // ask (refcount): a concurrent sibling still parked needs
                                                // the channel to stay open for its own answer.
                                                if (parkedAsks <= 0 && existsSync(askFile)) rmSync(askFile, { force: true });
                                        } catch {
                                                /* best effort */
                                        }
                                        if (answer === null) {
                                                return {
                                                        content: [
                                                                {
                                                                        type: "text",
                                                                        text: "No answer arrived in time. Proceed with your best judgment, clearly state the assumption you made in the final report, or reply BLOCKED: <reason> if the task cannot be completed safely without the answer.",
                                                                },
                                                        ],
                                                };
                                        }
                                        // A stop that un-parked us: the text is the typed
                                        // cancellation, not an answer — return it VERBATIM so
                                        // the model reads "no answer will come" instead of a
                                        // fabricated "[orchestrator's answer]" (the #87179
                                        // anti-pattern: an interrupted question must never
                                        // materialize an answer).
                                        if (answer.startsWith(STOP_PREFIX)) {
                                                return { content: [{ type: "text", text: answer }] };
                                        }
                                        return {
                                                content: [{ type: "text", text: `[orchestrator's answer] ${answer}` }],
                                        };
                                },
                        });

                        pi.on("session_shutdown", () => {
                                disposed = true;
                                clearInterval(timer);
                                // A cleanly exiting child leaves no heartbeat behind — a
                                // fresh-looking orphan file is exactly what the sweeper
                                // would misread next boot.
                                try {
                                        if (existsSync(hbFile)) rmSync(hbFile, { force: true });
                                } catch {
                                        /* best effort */
                                }
                        });
                },
        };
}

/** Read a loadout from an env-specified session file (used by tests + resume). */
export function loadoutFromEnv(env: Record<string, string | undefined> = process.env): FleetLoadout | null {
        const sessionFile = env.UNOWN_FLEET_SESSION;
        if (!sessionFile || !existsSync(`${sessionFile}.loadout.json`)) return null;
        try {
                return JSON.parse(readFileSync(`${sessionFile}.loadout.json`, "utf8")) as FleetLoadout;
        } catch {
                return null;
        }
}
