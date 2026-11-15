// permission-comment.test.ts — the permission-comment lane (Toccata round
// A11, src/permissions.ts handleAsk): Claude Code's "Tab to amend" contract.
// On a permission ask, the single-action options ("Allow once", "Deny") take
// a comment; the rule-saving option never does. A deny-with-comment rides
// the denial reason to the model; an allow-with-comment is sent to the model
// after the result (a followUp custom message — deferred to end-of-turn
// during the tool's execute).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPermissionGate } from "../src/permissions.ts";
import { TEST_TMP } from "./_env.ts";

const ROOT = join(TEST_TMP, "perm-comment");
mkdirSync(ROOT, { recursive: true });

interface Scope {
        cwd: string;
        agentDir: string;
        statePath: string;
}

function freshScope(): Scope {
        const dir = mkdtempSync(join(ROOT, "s-"));
        const cwd = join(dir, "proj");
        const agentDir = join(dir, "agent");
        mkdirSync(join(cwd, ".unown"), { recursive: true });
        mkdirSync(agentDir, { recursive: true });
        return { cwd, agentDir, statePath: join(agentDir, "trusted-configs.json") };
}

afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

interface AskProbe {
        selectCalls: Array<{ title: string; options: string[]; opts?: any }>;
        sentMessages: Array<{ message: any; options?: any }>;
}

function askContext(probe: AskProbe, picked: string | undefined, comment?: { option: string; text: string }) {
        return {
                hasUI: true,
                ui: {
                        select: async (_title: string, options: string[], opts?: any) => {
                                probe.selectCalls.push({ title: _title, options, opts });
                                if (comment && opts?.onComment) opts.onComment(comment.option, comment.text);
                                return picked;
                        },
                },
                sendMessage: (message: any, options?: any) => {
                        probe.sentMessages.push({ message, options });
                },
        };
}

function askGate(scope: Scope) {
        // The USER-level config (agentDir) — project-level .unown/permissions.json
        // is trust-gated; the user file always applies (same shape the existing
        // permissions suite's askGate uses).
        const file = join(scope.agentDir, "permissions.json");
        writeFileSync(
                file,
                `${JSON.stringify({ version: 1, rules: [{ tool: "bash", effect: "ask", pattern: "cargo *" }] }, null, 2)}\n`,
        );
        return createPermissionGate({ cwd: scope.cwd, agentDir: scope.agentDir, env: {}, statePath: scope.statePath });
}

describe("handleAsk comment lane (Toccata A11 — Tab to amend)", () => {
        test("the ask offers the comment lane on the single-action options only", async () => {
                const scope = freshScope();
                const gate = askGate(scope);
                const decision = gate.check("bash", { command: "cargo build" });
                expect(decision.needsAsk).toBe(true);
                const probe: AskProbe = { selectCalls: [], sentMessages: [] };
                await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, askContext(probe, "Allow once") as any);
                expect(probe.selectCalls).toHaveLength(1);
                const opts = probe.selectCalls[0]!.opts;
                expect(opts?.commentOn).toEqual(["Allow once", "Deny"]);
                expect(typeof opts?.onComment).toBe("function");
                // The legacy timeout still rides along.
                expect(typeof opts?.timeout).toBe("number");
        });

        test("a deny-with-comment rides the denial reason to the model", async () => {
                const scope = freshScope();
                const gate = askGate(scope);
                const decision = gate.check("bash", { command: "cargo build" });
                const probe: AskProbe = { selectCalls: [], sentMessages: [] };
                const ctx = askContext(probe, "Deny", { option: "Deny", text: " use the sandbox profile instead" });
                const out = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx as any);
                expect(out?.block).toBe(true);
                expect(out?.reason).toContain("denied at the confirmation prompt");
                expect(out?.reason).toContain("use the sandbox profile instead");
                // The comment is the REASON — no separate message is sent for a deny.
                expect(probe.sentMessages).toHaveLength(0);
        });

        test("an allow-with-comment is sent to the model after the result (followUp), and the allow stands", async () => {
                const scope = freshScope();
                const gate = askGate(scope);
                const decision = gate.check("bash", { command: "cargo build" });
                const probe: AskProbe = { selectCalls: [], sentMessages: [] };
                const ctx = askContext(probe, "Allow once", { option: "Allow once", text: "please keep it quiet" });
                const out = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx as any);
                expect(out).toBeUndefined(); // the allow stands
                expect(probe.sentMessages).toHaveLength(1);
                expect(probe.sentMessages[0]!.message.customType).toBe("unown-permission-comment");
                expect(probe.sentMessages[0]!.message.content).toContain("please keep it quiet");
                expect(probe.sentMessages[0]!.message.content).toContain("bash");
                expect(probe.sentMessages[0]!.message.display).toBe(true);
                expect(probe.sentMessages[0]!.options).toEqual({ deliverAs: "followUp" });
        });

        test("an allow without a comment sends nothing; a comment on the OTHER option never leaks", async () => {
                const scope = freshScope();
                const gate = askGate(scope);
                const decision = gate.check("bash", { command: "cargo build" });
                const probe: AskProbe = { selectCalls: [], sentMessages: [] };
                // The user commented on Deny but answered Allow once — the comment does not ride.
                const ctx = askContext(probe, "Allow once", { option: "Deny", text: "nope" });
                const out = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx as any);
                expect(out).toBeUndefined();
                expect(probe.sentMessages).toHaveLength(0);
        });

        test("no sendMessage seam: the allow still stands, the comment is dropped silently", async () => {
                const scope = freshScope();
                const gate = askGate(scope);
                const decision = gate.check("bash", { command: "cargo build" });
                const probe: AskProbe = { selectCalls: [], sentMessages: [] };
                const ctx = {
                        hasUI: true,
                        ui: {
                                select: async (_t: string, _o: string[], opts?: any) => {
                                        opts?.onComment?.("Allow once", "note");
                                        return "Allow once";
                                },
                        },
                        // sendMessage deliberately absent (older host)
                };
                const out = await gate.handleAsk("bash", { command: "cargo build" }, decision.evaluation!, ctx as any);
                expect(out).toBeUndefined();
                expect(probe.sentMessages).toHaveLength(0);
        });
});
