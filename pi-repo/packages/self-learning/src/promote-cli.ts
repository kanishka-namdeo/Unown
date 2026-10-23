/**
 * promote-cli.ts — the `/promote` command (M7): OpenClaw's "promoting a
 * repeated job into an automation", made an explicit, user-initiated flow.
 *
 *   /promote [focus…]      distill the session into a standing-order Program
 *                          draft (one cheap LLM call), show it, park it in
 *                          .unown/promote-draft.md
 *   /promote show          reprint the parked draft
 *   /promote save [project|global]   append the draft to the standing-orders
 *                          store (project .unown/ or global ~/.unown/agent/)
 *   /promote schedule <spec…>        create a routine FROM the saved order
 *                          (the prompt references the order — "execute per
 *                          standing orders", never a copy), then immediately
 *                          test-run it once and report; a FAILED test run
 *                          auto-removes the routine (OpenClaw's contract:
 *                          never leave an unverified job enabled)
 *
 * The OpenClaw flow, preserved: promotion is preferred over building a job
 * from scratch because the draft inherits a session you already read; the
 * confirmation sentence is plain words, not a cron expression; the created
 * job is enabled and gets a visible test-run delivered to the asking
 * conversation. Deviation (documented): their "agent offers when it notices
 * repetition" is a community synthesis, not in the docs — Unown keeps
 * promotion explicit.
 *
 * Purity contract: the parse/validation layers are pure; the command body
 * takes injected chat/fs seams (tests drive hermetic fakes); the schedule
 * lane reuses `runAutomationsCommand` verbatim (engine REST, auto-spawn,
 * engine-down handling included — no bespoke engine client).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractBriefSource } from "./context-brief.ts";
import { buildPromoteDistillPrompt, parseProgramDraft, renderProgramSection, loadStandingOrders, appendOrderToStore } from "./standing-orders.ts";
import { runAutomationsCommand } from "./automations-cli.ts";

/** The parked-draft location (persists between the /promote steps). */
export function promoteDraftPath(cwd: string): string {
        return join(cwd, ".unown", "promote-draft.md");
}

/** The chat seam (llm.ts chatText's shape). */
export type PromoteChatFn = (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, opts?: { maxTokens?: number; timeoutMs?: number }) => Promise<string>;

export interface PromoteCommandDeps {
        cwd: string;
        /** The LLM seam — production passes llm.ts chatText. */
        chat: PromoteChatFn;
        /** Session entries (the pi sessionManager's array). */
        entries: unknown[];
        /** fs seams (tests). */
        readFile?: (p: string) => string | null;
        writeFile?: (p: string, content: string) => void;
}

export interface PromoteResult {
        message: string;
        level: "info" | "warning" | "error";
}

function readDraft(deps: PromoteCommandDeps): string | null {
        const read = deps.readFile ?? ((p: string) => {
                try {
                        return existsSync(p) ? readFileSync(p, "utf8") : null;
                } catch {
                        return null;
                }
        });
        return read(promoteDraftPath(deps.cwd));
}

function writeDraftFile(deps: PromoteCommandDeps, content: string): boolean {
        const write =
                deps.writeFile ??
                ((p: string, c: string) => {
                        mkdirSync(join(p, ".."), { recursive: true });
                        writeFileSync(p, c);
                });
        try {
                write(promoteDraftPath(deps.cwd), content);
                return true;
        } catch {
                return false;
        }
}

/** `/promote [focus…]` — distill the session into a Program draft. */
export async function promoteDraft(deps: PromoteCommandDeps, focus: string): Promise<PromoteResult> {
        const source = extractBriefSource(deps.entries);
        if (source.trim().length < 80) {
                return { message: "Nothing to promote yet — this session has no substantive history to distill.", level: "info" };
        }
        let raw: string;
        try {
                raw = await deps.chat([{ role: "user", content: buildPromoteDistillPrompt(source, focus) }], { maxTokens: 800, timeoutMs: 60_000 });
        } catch (err: any) {
                return { message: `The distillation call failed (${err instanceof Error ? err.message : String(err)}) — nothing was written.`, level: "error" };
        }
        const { order, issues } = parseProgramDraft(raw);
        if (!order) {
                writeDraftFile(deps, raw);
                return {
                        message: `The draft did not parse as a Program section:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nThe raw model output is parked at .unown/promote-draft.md — edit it into the template and re-run /promote save.`,
                        level: "warning",
                };
        }
        writeDraftFile(deps, raw);
        const issuesBlock = issues.length > 0 ? `\n⚠ Review before saving:\n${issues.map((i) => `- ${i}`).join("\n")}` : "";
        return {
                message:
                        `Draft distilled and parked at .unown/promote-draft.md${issuesBlock}\n\n${order.raw}\n\n` +
                                `Next: /promote save project (or global) to append it to standing orders, then /promote schedule <spec> — e.g. /promote schedule --every "1d at 09:00" — to create + test-run the routine.`,
                level: "info",
        };
}

/** `/promote show` — reprint the parked draft. */
export function promoteShow(deps: PromoteCommandDeps): PromoteResult {
        const draft = readDraft(deps);
        if (draft === null) return { message: "No parked draft — run /promote [focus…] first.", level: "info" };
        const { order, issues } = parseProgramDraft(draft);
        const issuesBlock = issues.length > 0 ? `\n⚠ ${issues.join("; ")}` : "";
        return { message: `${order?.raw ?? draft}${issuesBlock}`, level: "info" };
}

/** `/promote save [project|global]` — append the draft to a store. */
export function promoteSave(deps: PromoteCommandDeps, target: "project" | "global"): PromoteResult {
        const draft = readDraft(deps);
        if (draft === null) return { message: "No parked draft — run /promote [focus…] first.", level: "info" };
        const { order, issues } = parseProgramDraft(draft);
        if (!order) {
                return { message: `The parked draft is not a valid Program section:\n${issues.map((i) => `- ${i}`).join("\n")}\nEdit .unown/promote-draft.md and re-run /promote save.`, level: "error" };
        }
        const readLayer = { read: deps.readFile };
        const paths = loadStandingOrders(deps.cwd, readLayer).paths;
        const storePath = target === "global" ? paths.global : paths.project;
        const section = renderProgramSection(order);
        // OpenClaw's dedupe check: capture what already exists BEFORE the
        // append (after it, the just-saved order would always look like its
        // own duplicate — caught live in the M7 E2E).
        const existing = loadStandingOrders(deps.cwd, readLayer).orders;
        const appended = appendOrderToStore(storePath, section, { read: deps.readFile, write: deps.writeFile });
        if (!appended.ok) return { message: appended.error ?? "append failed", level: "error" };
        const duplicateRoutines = existing.filter((o) => o.id === order.id && o.raw !== order.raw);
        const dupNote = duplicateRoutines.length > 0 ? `\n⚠ An order with the same program id ("${order.id}") already existed — both are now loaded (edit the store to reconcile).` : "";
        return {
                message:
                        `Saved to ${storePath}.${dupNote}\n\n` +
                                `The order is now loaded into every routine run in this workspace. Next: /promote schedule --every "1d at 09:00" (or another schedule kind) to create + test-run the routine — its prompt will reference the order, never copy it.`,
                level: "info",
        };
}

/** `/promote schedule <spec…>` — create the routine from the saved order,
 * test-run it once, auto-remove on failure (OpenClaw's contract). The spec
 * tokens are the routines-create schedule grammar (--cron/--every/--after/
 * --delay-minutes/--on-event + any passthrough flags). */
export async function promoteSchedule(deps: PromoteCommandDeps, specTokens: string[]): Promise<PromoteResult> {
        const draft = readDraft(deps);
        if (draft === null) return { message: "No parked draft — run /promote [focus…] first (then save it).", level: "info" };
        const { order } = parseProgramDraft(draft);
        if (!order) return { message: "The parked draft is not a valid Program section — edit it and retry.", level: "error" };
        if (specTokens.length === 0) {
                return {
                        message:
                                'Usage: /promote schedule --every "1d at 09:00" (or --cron "0 9 * * 1-5", --after "3d", --delay-minutes 30, --on-event <name>)\nAdditional passthrough flags (--timezone, --mode, --deliver …) are forwarded verbatim.',
                        level: "info",
                };
        }
        // The reference-not-copy rule: the routine's prompt points at the order.
        const routinePrompt = `Execute per standing order "${order.id}" (${order.title}) — the standing orders in this workspace are your authority; the order's approval gates and What-NOT-to-do govern everything.`;
        const createArgv = ["create", "--title", order.title, "--prompt", routinePrompt, "--workspace", deps.cwd, ...specTokens];
        const created = await runAutomationsCommand(createArgv, { cwd: deps.cwd });
        if (created.exitCode !== 0) {
                return { message: `Routine creation failed:\n${created.stdout ?? ""}${created.stderr ?? ""}`, level: "error" };
        }
        // The id extraction: `Created auto-xxx ("title")` (the second pattern's
        // group 1 is the ANCHOR whitespace — the id is group 2; taking group 1
        // first sent a blank id to `run` and failed with "unknown automation" —
        // caught live in the M7 E2E).
        const idMatch = /\(id: ([^)\s]+)\)/.exec(created.stdout ?? "") ?? /(^|\s)(auto-[a-z0-9-]+)/.exec(created.stdout ?? "");
        const id = idMatch?.[1]?.trim() || idMatch?.[2];
        if (!id) {
                return { message: `Routine created, but the id could not be parsed from the output — check it with unown routines list:\n${created.stdout}`, level: "warning" };
        }
        // Test-run once (manual run-now; the result lands in the run row).
        const fired = await runAutomationsCommand(["run", id], { cwd: deps.cwd });
        if (fired.exitCode !== 0) {
                const removed = await runAutomationsCommand(["delete", id], { cwd: deps.cwd });
                return {
                        message: `The test-run could not start (${(fired.stderr || fired.stdout || "").trim()}) — the routine was ${removed.exitCode === 0 ? "removed" : "NOT removed (delete failed — clean up manually)"} (never leave an unverified job enabled).`,
                        level: "error",
                };
        }
        // Bounded poll for the test run's outcome (the visible verification).
        const deadline = Date.now() + 90_000;
        for (;;) {
                await new Promise((r) => setTimeout(r, 3_000));
                const hist = await runAutomationsCommand(["history", id, "--json", "--limit", "1"], { cwd: deps.cwd });
                let last: { status?: string; exit_code?: number; ended_at?: number } | null = null;
                try {
                        const parsed = JSON.parse((hist.stdout ?? "").trim());
                        const runs = Array.isArray(parsed) ? parsed : parsed.runs ?? parsed.history ?? [];
                        last = runs[0] ?? null;
                } catch {
                        last = null;
                }
                if (last && typeof last.ended_at === "number") {
                        if (last.status === "succeeded" || (typeof last.exit_code === "number" && last.exit_code === 0)) {
                                return { message: `Routine ${id} created, enabled, and its test run SUCCEEDED — the schedule takes it from here.\n${created.stdout?.trim() ?? ""}`, level: "info" };
                        }
                        const removed = await runAutomationsCommand(["delete", id], { cwd: deps.cwd });
                        return {
                                message: `The test run FAILED (status ${last.status ?? "?"}, exit ${last.exit_code ?? "?"}) — the routine was ${removed.exitCode === 0 ? "removed" : "NOT removed (delete failed)"}. OpenClaw's contract: never leave an unverified job enabled. The standing order stays saved; fix and re-run /promote schedule.`,
                                level: "error",
                        };
                }
                if (Date.now() > deadline) {
                        return { message: `Routine ${id} created and its test run is still going (90 s watch window elapsed) — check unown routines history ${id} for the outcome; delete it with unown routines delete ${id} if it failed.`, level: "warning" };
                }
        }
}

/** Route `/promote <args>` (the command body). */
export async function runPromoteCommand(args: string, deps: PromoteCommandDeps): Promise<PromoteResult> {
        const trimmed = (args ?? "").trim();
        const parts = trimmed.split(/\s+/).filter(Boolean);
        const sub = (parts[0] ?? "").toLowerCase();
        if (sub === "show") return promoteShow(deps);
        if (sub === "save") return promoteSave(deps, (parts[1] ?? "project").toLowerCase() === "global" ? "global" : "project");
        if (sub === "schedule") return promoteSchedule(deps, parts.slice(1));
        return promoteDraft(deps, trimmed);
}
