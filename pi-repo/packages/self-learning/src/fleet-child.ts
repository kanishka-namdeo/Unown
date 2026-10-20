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

import { existsSync, readFileSync, rmSync } from "node:fs";
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
                        let answerWaiter: ((text: string) => void) | null = null;
                        let shutdownRequested = false;

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
                                        if (command.kind === "steer") {
                                                if (answerWaiter) {
                                                        // A steer while parked on ask_question IS the answer —
                                                        // the question message tells the parent to answer via
                                                        // task_control steer, so the parked tool must consume it
                                                        // (measured live: otherwise the child deadlocks inside
                                                        // the tool call while steers pile up unconsumed).
                                                        const w = answerWaiter;
                                                        answerWaiter = null;
                                                        w(command.text);
                                                } else {
                                                        deliver(`[steer from the orchestrator] ${command.text}`);
                                                }
                                        } else if (command.kind === "answer") {
                                                if (answerWaiter) {
                                                        const w = answerWaiter;
                                                        answerWaiter = null;
                                                        w(command.text);
                                                } else {
                                                        deliver(`[answer from the orchestrator] ${command.text}`);
                                                }
                                        } else if (command.kind === "stop") {
                                                shutdownRequested = true;
                                                try {
                                                        pi.appendEntry?.("unown-fleet-child-stopped", { id: childId, ts: Date.now() });
                                                } catch {
                                                        /* best effort */
                                                }
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
                        };

                        const timer = setInterval(handleCommands, pollMs);
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
                                        const payload = JSON.stringify(
                                                {
                                                        id: childId,
                                                        question,
                                                        context: (params.context ?? "").slice(0, 1000),
                                                        ts: Date.now(),
                                                },
                                                null,
                                                2,
                                        );
                                        try {
                                                const { writeFileSync } = require("node:fs") as typeof import("node:fs");
                                                writeFileSync(askFile, payload, { encoding: "utf8", mode: 0o600 });
                                        } catch {
                                                return {
                                                        content: [{ type: "text", text: "ask_question failed to write its channel — proceed with your best judgment." }],
                                                };
                                        }
                                        const answer = await new Promise<string | null>((resolve) => {
                                                const deadline = setTimeout(() => {
                                                        answerWaiter = null;
                                                        resolve(null);
                                                }, askTimeoutMs);
                                                answerWaiter = (text: string) => {
                                                        clearTimeout(deadline);
                                                        resolve(text);
                                                };
                                        });
                                        try {
                                                if (existsSync(askFile)) rmSync(askFile, { force: true });
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
                                        return {
                                                content: [{ type: "text", text: `[orchestrator's answer] ${answer}` }],
                                        };
                                },
                        });

                        pi.on("session_shutdown", () => {
                                disposed = true;
                                clearInterval(timer);
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
