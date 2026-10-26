// Unit tests for src/fleet-child.ts — the child-side fleet extension (steer
// delivery + ask_question), driven through a fake pi + a real temp control
// file. No real subprocess, no network.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendControlCommand } from "../src/fleet.ts";
import { createFleetChildExtension } from "../src/fleet-child.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-fleet-child-"));
afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

function makeFakePi() {
        const userMessages: Array<{ text: string; options?: any }> = [];
        const tools = new Map<string, any>();
        const handlers = new Map<string, Array<(event: any) => any>>();
        const entries: any[] = [];
        const pi: any = {
                sendUserMessage: (text: string, options?: any) => userMessages.push({ text, options }),
                registerTool: (t: any) => tools.set(t.name, t),
                on: (event: string, fn: any) => {
                        if (!handlers.has(event)) handlers.set(event, []);
                        handlers.get(event)!.push(fn);
                },
                appendEntry: (type: string, data: any) => entries.push({ type, data }),
        };
        return { pi, userMessages, tools, handlers, entries };
}

function setup(pollMs = 10) {
        const dir = join(TMP, `run-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(dir, { recursive: true });
        const controlFile = join(dir, "c.control.json");
        const askFile = join(dir, "c.ask.json");
        writeFileSync(controlFile, "[]");
        const env = {
                UNOWN_FLEET_CONTROL: controlFile,
                UNOWN_FLEET_ASK: askFile,
                UNOWN_FLEET_ID: "child-1",
        };
        const extension = createFleetChildExtension({ env, pollMs, askTimeoutMs: 250 });
        expect(extension).not.toBeNull();
        return { extension: extension!, controlFile, askFile, env };
}

describe("createFleetChildExtension", () => {
        test("returns null without the fleet env (ordinary sessions get nothing)", () => {
                expect(createFleetChildExtension({ env: {} })).toBeNull();
                expect(createFleetChildExtension({ env: { UNOWN_FLEET_CONTROL: "" } })).toBeNull();
        });

        test("steer commands are delivered as user messages with deliverAs steer", async () => {
                const { extension, controlFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                appendControlCommand(controlFile, { kind: "steer", text: "focus on auth" });
                await new Promise((r) => setTimeout(r, 60));
                expect(fake.userMessages.length).toBe(1);
                expect(fake.userMessages[0].text).toContain("[steer from the orchestrator]");
                expect(fake.userMessages[0].text).toContain("focus on auth");
                expect(fake.userMessages[0].options).toEqual({ deliverAs: "steer" });
        });

        test("stop commands deliver a wrap-up instruction", async () => {
                const { extension, controlFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                appendControlCommand(controlFile, { kind: "stop" });
                await new Promise((r) => setTimeout(r, 60));
                expect(fake.userMessages.length).toBe(1);
                expect(fake.userMessages[0].text).toContain("[stop requested by the orchestrator]");
        });

        test("ask_question parks on the ask file and resolves when the parent answers", async () => {
                const { extension, controlFile, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                expect(tool).toBeDefined();

                const pending = tool.execute("t1", { question: "Which branch?", context: "before I edit" });
                // Give the tool a moment to write the ask file.
                await new Promise((r) => setTimeout(r, 40));
                expect(existsSync(askFile)).toBe(true);
                const payload = JSON.parse(readFileSync(askFile, "utf8"));
                expect(payload.question).toBe("Which branch?");
                expect(payload.context).toBe("before I edit");

                // The parent answers via the control inbox.
                appendControlCommand(controlFile, { kind: "answer", text: "target main" });
                const result = await pending;
                expect(result.content[0].text).toContain("[orchestrator's answer] target main");
                // The ask file is cleaned up.
                expect(existsSync(askFile)).toBe(false);
        });

        test("ask_question times out with honest guidance (unattended parent)", async () => {
                const { extension, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                const result = await tool.execute("t1", { question: "Anyone there?" });
                expect(result.content[0].text).toContain("No answer arrived in time");
                expect(result.content[0].text).toContain("best judgment");
        });

        test("empty question is rejected; missing ask channel degrades gracefully", async () => {
                const { extension } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                const empty = await tool.execute("t1", { question: "   " });
                expect(empty.content[0].text).toContain("Error");

                // No ask file channel: create an env without UNOWN_FLEET_ASK.
                const dir2 = join(TMP, `noask-${Math.random().toString(36).slice(2, 8)}`);
                mkdirSync(dir2, { recursive: true });
                writeFileSync(join(dir2, "c2.control.json"), "[]");
                const noAsk = createFleetChildExtension({
                        env: { UNOWN_FLEET_CONTROL: join(dir2, "c2.control.json"), UNOWN_FLEET_ID: "x" },
                })!;
                const fake2 = makeFakePi();
                noAsk.factory(fake2.pi);
                const tool2 = fake2.tools.get("ask_question");
                const degraded = await tool2.execute("t1", { question: "hello?" });
                expect(degraded.content[0].text).toContain("unavailable");
        });

        test("session_shutdown clears the poll timer", async () => {
                const { extension, controlFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                for (const h of fake.handlers.get("session_shutdown") ?? []) await h({});
                appendControlCommand(controlFile, { kind: "steer", text: "too late" });
                await new Promise((r) => setTimeout(r, 60));
                expect(fake.userMessages.length).toBe(0);
        });
});

describe("steer resolves a parked ask_question (live-regression: the child deadlocked)", () => {
        test("a steer while parked is consumed as the answer, not queued as a user message", async () => {
                const { extension, controlFile, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                const pending = tool.execute("t1", { question: "hello or hi?" });
                await new Promise((r) => setTimeout(r, 40));
                expect(existsSync(askFile)).toBe(true);
                // The parent answers via task_control steer (what the question
                // message tells it to do) — the steer must resolve the parked tool.
                appendControlCommand(controlFile, { kind: "steer", text: "use hi" });
                const result = await pending;
                expect(result.content[0].text).toContain("[orchestrator's answer] use hi");
                // No user message was delivered for this steer (the model was
                // blocked inside the tool; queuing would deadlock it).
                expect(fake.userMessages.length).toBe(0);
        });
});

// ---------------------------------------------------------------------------
// Round 3 (2026-10-26 stress round THREE) — the ask-park edges the chaos
// round's "not covered" section promised, now pinned at the child seam: a
// stop while parked UN-PARKS with a typed cancellation (R3-F1, live: the
// parked child used to linger until the parent's tree-kill backstop SIGTERM'd
// it, exit 143, ask file rot), and the ask payload carries the instance seq
// the parent dedups on (R3-F2).
// ---------------------------------------------------------------------------

describe("stop un-parks a parked ask_question (R3-F1, live 2026-10-26)", () => {
        test("a stop while parked resolves the waiter with a typed cancellation, verbatim — never a fabricated answer", async () => {
                const { extension, controlFile, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                const pending = tool.execute("t1", { question: "Which branch?" });
                await new Promise((r) => setTimeout(r, 40));
                expect(existsSync(askFile)).toBe(true);
                appendControlCommand(controlFile, { kind: "stop" });
                const result = await pending;
                // Verbatim cancellation: the model reads "no answer will come" —
                // NOT a fabricated "[orchestrator's answer]" (the interrupt-
                // fabricates-an-answer anti-pattern, Claude Code #87179).
                expect(result.content[0].text).toContain("[stop requested by the orchestrator]");
                expect(result.content[0].text).toContain("No answer will come");
                expect(result.content[0].text).not.toContain("[orchestrator's answer]");
                // The child un-parked itself and cleaned up its own ask file
                // (pre-fix: the file rotted until the tree-kill, and beyond).
                expect(existsSync(askFile)).toBe(false);
                // Nothing was queued as a user message — the parked tool result
                // IS the delivery (a queued steer could never drain mid-tool).
                expect(fake.userMessages.length).toBe(0);
        });

        test("an UN-parked child still gets the wrap-up instruction as a message", async () => {
                const { extension, controlFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                appendControlCommand(controlFile, { kind: "stop" });
                await new Promise((r) => setTimeout(r, 60));
                expect(fake.userMessages.length).toBe(1);
                expect(fake.userMessages[0].text).toContain("[stop requested by the orchestrator]");
        });
});

describe("ask instances carry a monotonic seq (R3-F2 — the identity the parent dedups on)", () => {
        test("an identical-text re-ask is a NEW instance: seq increments even at the same ms", async () => {
                const { extension, controlFile, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                const first = tool.execute("t1", { question: "Same question?" });
                await new Promise((r) => setTimeout(r, 40));
                const p1 = JSON.parse(readFileSync(askFile, "utf8"));
                expect(typeof p1.seq).toBe("number");
                appendControlCommand(controlFile, { kind: "answer", text: "one" });
                await first;
                // The re-ask: identical text, new instance.
                const second = tool.execute("t2", { question: "Same question?" });
                await new Promise((r) => setTimeout(r, 40));
                const p2 = JSON.parse(readFileSync(askFile, "utf8"));
                expect(p2.question).toBe(p1.question);
                expect(p2.seq).toBe(p1.seq + 1);
                appendControlCommand(controlFile, { kind: "answer", text: "two" });
                const result = await second;
                expect(result.content[0].text).toContain("[orchestrator's answer] two");
                expect(existsSync(askFile)).toBe(false);
        });
});

describe("fleet-child heartbeat (R3-F4 — the crash sweeper's identity signal)", () => {
        test("the poller self-writes <id>.hb.json with pid + fresh ts; session_shutdown removes it", async () => {
                const { extension, controlFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const hbFile = controlFile.replace(/\.control\.json$/, ".hb.json");
                // pollMs=10 in setup() → every 4th poll ≈ 40ms.
                await new Promise((r) => setTimeout(r, 200));
                expect(existsSync(hbFile)).toBe(true);
                const hb = JSON.parse(readFileSync(hbFile, "utf8"));
                expect(hb.pid).toBe(process.pid);
                expect(typeof hb.ts).toBe("number");
                expect(Date.now() - hb.ts).toBeLessThan(5_000);
                // Shutdown removes the heartbeat — a fresh-looking orphan file
                // is exactly what the next boot's sweeper would misread.
                for (const h of fake.handlers.get("session_shutdown") ?? []) await h({});
                expect(existsSync(hbFile)).toBe(false);
        });
});

describe("concurrent ask_question parks queue their waiters (R3-F2 follow-up, live 2026-10-26)", () => {
        test("concurrent asks with different texts: the STANDING asker is answered; the other keeps its turn", async () => {
                const { extension, controlFile, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                // The runtime executes both calls from ONE assistant message —
                // pre-fix the second park CLOBBERED the first waiter (lost
                // forever) and the first resolve deleted the file out from
                // under the still-parked sibling.
                const first = tool.execute("t1", { question: "First: which branch?" });
                const second = tool.execute("t2", { question: "Second: which runner?" });
                await new Promise((r) => setTimeout(r, 40));
                expect(existsSync(askFile)).toBe(true);
                // The file shows the LATEST pending question — the one the parent saw.
                expect(JSON.parse(readFileSync(askFile, "utf8")).question).toBe("Second: which runner?");
                // The answer satisfies the asker of the STANDING question…
                appendControlCommand(controlFile, { kind: "answer", text: "answer-the-standing" });
                const r2 = await second;
                expect(r2.content[0].text).toContain("[orchestrator's answer] answer-the-standing");
                // …and the ask file SURVIVES for the still-parked sibling.
                await new Promise((r) => setTimeout(r, 40));
                expect(existsSync(askFile)).toBe(true);
                // A second answer falls back to the remaining asker (FIFO); NOW
                // the file goes.
                appendControlCommand(controlFile, { kind: "answer", text: "answer-the-rest" });
                const r1 = await first;
                expect(r1.content[0].text).toContain("[orchestrator's answer] answer-the-rest");
                expect(existsSync(askFile)).toBe(false);
        });

        test("concurrent IDENTICAL asks: ONE answer resolves every sibling (an answer to a question answers all its copies)", async () => {
                const { extension, controlFile, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                // The live P2b shape: two ask_question calls with the SAME text
                // in one message — pre-fix one waiter was lost forever and the
                // child never completed.
                const first = tool.execute("t1", { question: "Same question?" });
                const second = tool.execute("t2", { question: "Same question?" });
                await new Promise((r) => setTimeout(r, 40));
                expect(existsSync(askFile)).toBe(true);
                appendControlCommand(controlFile, { kind: "answer", text: "one answer for both" });
                const [r1, r2] = await Promise.all([first, second]);
                expect(r1.content[0].text).toContain("[orchestrator's answer] one answer for both");
                expect(r2.content[0].text).toContain("[orchestrator's answer] one answer for both");
                expect(existsSync(askFile)).toBe(false);
        });

        test("a stop cancels EVERY parked ask, not just the loudest one", async () => {
                const { extension, controlFile, askFile } = setup();
                const fake = makeFakePi();
                extension.factory(fake.pi);
                const tool = fake.tools.get("ask_question");
                const first = tool.execute("t1", { question: "First?" });
                const second = tool.execute("t2", { question: "Second?" });
                await new Promise((r) => setTimeout(r, 40));
                appendControlCommand(controlFile, { kind: "stop" });
                const [r1, r2] = await Promise.all([first, second]);
                for (const r of [r1, r2]) {
                        expect(r.content[0].text).toContain("[stop requested by the orchestrator]");
                        expect(r.content[0].text).not.toContain("[orchestrator's answer]");
                }
                expect(existsSync(askFile)).toBe(false);
                expect(fake.userMessages.length).toBe(0);
        });
});
