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
