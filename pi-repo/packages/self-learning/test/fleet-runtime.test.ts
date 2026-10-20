// Unit tests for src/fleet-runtime.ts — the fleet manager + surface, driven
// through a FAKE spawn seam (no real unown subprocess, no network).
//
// The fake proc is an EventEmitter pair (stdout/stderr) + kill(): tests emit
// the same JSONL event lines a real fleet child produces on stdout, then fire
// "close" — the manager's parsing, watcher, ask polling, steer/stop, registry
// and delivery paths all run for real against temp fleet dirs.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseControlCommands } from "../src/fleet.ts";
import { FleetManager, registerFleetSurface } from "../src/fleet-runtime.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-fleet-rt-"));
afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

/** Recorded spawn calls + fake procs keyed by spawn order. */
class SpawnHarness {
        calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
        procs: FakeProc[] = [];
        spawn: any = (command: string, args: string[], opts: any) => {
                this.calls.push({ command, args, env: opts.env });
                const proc = new FakeProc();
                this.procs.push(proc);
                return proc;
        };
}

class FakeProc extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        pid = 42_000 + Math.floor(Math.random() * 1000);
        killed = false;
        kill() {
                this.killed = true;
                return true;
        }
        /** Emit one JSONL event line on stdout. */
        emitLine(event: unknown) {
                this.stdout.emit("data", Buffer.from(JSON.stringify(event) + "\n", "utf8"));
        }
}

function makeManager(harness: SpawnHarness, dir: string) {
        const manager = new FleetManager({
                cwd: TMP,
                fleetDir: dir,
                invocation: (args) => ({ command: "fake-unown", args }),
                spawnProc: harness.spawn as any,
        });
        const delivered: Array<{ content: string; kind: string }> = [];
        const widgets: Array<string[] | undefined> = [];
        const statuses: Array<string | undefined> = [];
        manager.bind(
                {
                        setWidget: (_key: string, lines: string[] | undefined) => widgets.push(lines),
                        setStatus: (_key: string, text: string | undefined) => statuses.push(text),
                },
                (content, _details, kind) => delivered.push({ content, kind }),
        );
        return { manager, delivered, widgets, statuses };
}

const REQUEST = {
        agent: "scout",
        task: "map the repo",
        routing: { model: "qwen3.7-plus" as const },
        tools: ["read", "grep"],
        systemPrompt: "You are a scout.",
};

let seq = 0;
function freshDir(): string {
        const dir = join(TMP, `fleet-${seq++}`);
        rmSync(dir, { recursive: true, force: true });
        return dir;
}

beforeEach(() => {
        // Real intervals in the manager unref themselves; nothing to reset.
});

describe("FleetManager.spawnFleetChild", () => {
        test("immediate ack; args carry --session (never --no-session) + fleet env", () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager } = makeManager(harness, dir);
                const ack = manager.spawnFleetChild({ ...REQUEST, name: "scout" });
                expect(ack.ok).toBe(true);
                if (!ack.ok) return;
                expect(ack.name).toBe("scout");
                const call = harness.calls[0];
                expect(call.args).not.toContain("--no-session");
                const sessionIdx = call.args.indexOf("--session");
                expect(sessionIdx).toBeGreaterThan(-1);
                expect(call.args[sessionIdx + 1]).toContain(ack.name);
                expect(call.args).toContain("qwen3.7-plus");
                expect(call.args.join(" ")).toContain("Task: map the repo");
                expect(call.env.UNOWN_FLEET_CONTROL).toContain(dir);
                expect(call.env.UNOWN_SUBAGENT).toBe("1");
                manager.dispose();
        });

        test("a restricted --tools list still carries ask_question (the ask channel is fleet infrastructure)", () => {
                // Regression (measured live in the s9-fleet capture): pi's --tools
                // allowlist filters extension tools too, so an explore/scout child
                // (read,grep,find,ls) lost ask_question and could only reply BLOCKED.
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager } = makeManager(harness, dir);
                const ack = manager.spawnFleetChild({ ...REQUEST, name: "scout" });
                expect(ack.ok).toBe(true);
                const call = harness.calls[0];
                const toolsIdx = call.args.indexOf("--tools");
                expect(toolsIdx).toBeGreaterThan(-1);
                const tools = String(call.args[toolsIdx + 1]).split(",").map((s) => s.trim());
                expect(tools).toContain("ask_question");
                expect(tools).toContain("read"); // the agent's own surface survives
                // No restriction → no injected flag (the tool registers anyway).
                const ack2 = manager.spawnFleetChild({ ...REQUEST, name: "free", tools: undefined });
                expect(ack2.ok).toBe(true);
                expect(harness.calls[1].args).not.toContain("--tools");
                manager.dispose();
        });

        test("names dedupe against running children + the registry", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, freshDir());
                const a = manager.spawnFleetChild({ ...REQUEST, name: "scout" });
                const b = manager.spawnFleetChild({ ...REQUEST, name: "scout" });
                expect(a.ok && b.ok && a.name !== b.name).toBe(true);
                if (a.ok && b.ok) expect(b.name).toBe("scout-2");
                manager.dispose();
        });

        test("stdout events update live state (usage, turns, currentTool)", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, freshDir());
                const ack = manager.spawnFleetChild(REQUEST)!;
                const proc = harness.procs[0];
                proc.emitLine({ type: "message_end", message: { role: "assistant", usage: { input: 500, output: 50 }, content: [{ type: "text", text: "working…" }] } });
                proc.emitLine({ type: "tool_execution_start", toolName: "grep", args: {} });
                const state = manager.children.get((ack as { id: string }).id)!;
                expect(state.status).toBe("running-tool");
                expect(state.currentTool).toBe("grep");
                expect(state.turns).toBe(1);
                expect(state.usage.input).toBe(500);
                proc.emitLine({ type: "tool_execution_end", toolCallId: "t1", toolName: "grep" });
                expect(state.status).toBe("active");
                expect(state.toolCount).toBe(1);
                manager.dispose();
        });

        test("close 0 + final text ⇒ done, result delivered (batched), registry updated", async () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager, delivered } = makeManager(harness, dir);
                const ack = manager.spawnFleetChild({ ...REQUEST, name: "mapper" });
                expect(ack.ok).toBe(true);
                const proc = harness.procs[0];
                proc.emitLine({ type: "message_end", message: { role: "assistant", usage: { input: 100, output: 20 }, content: [{ type: "text", text: "The repo has 3 modules." }] } });
                proc.emit("close", 0);
                const state = [...manager.children.values()][0];
                expect(state.status).toBe("done");
                expect(state.lastText).toContain("3 modules");
                // Successes ride the 150ms completion batch.
                await new Promise((r) => setTimeout(r, 250));
                expect(delivered.length).toBe(1);
                expect(delivered[0].kind).toBe("result");
                expect(delivered[0].content).toContain("mapper (scout) finished");
                expect(delivered[0].content).toContain("3 modules");
                // Registry: name → session for resume.
                const registry = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8"));
                expect(registry.names.mapper.status).toBe("done");
                expect(registry.names.mapper.sessionFile).toContain("mapper");
                manager.dispose();
        });

        test("two near-simultaneous successes batch into ONE delivered message", async () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager, delivered } = makeManager(harness, dir);
                manager.spawnFleetChild({ ...REQUEST, name: "a" });
                manager.spawnFleetChild({ ...REQUEST, name: "b" });
                harness.procs[0].emitLine({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "result A" }] } });
                harness.procs[1].emitLine({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "result B" }] } });
                harness.procs[0].emit("close", 0);
                harness.procs[1].emit("close", 0);
                await new Promise((r) => setTimeout(r, 250));
                expect(delivered.length).toBe(1);
                expect(delivered[0].content).toContain("2 subagents finished:");
                expect(delivered[0].content).toContain("result A");
                expect(delivered[0].content).toContain("result B");
                manager.dispose();
        });

        test("a failure flushes the pending batch and races alone", () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager, delivered } = makeManager(harness, dir);
                manager.spawnFleetChild({ ...REQUEST, name: "ok" });
                manager.spawnFleetChild({ ...REQUEST, name: "bad" });
                harness.procs[0].emitLine({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "fine" }] } });
                harness.procs[0].emit("close", 0); // buffered success
                // The failure arrives within the batch window: it must flush the
                // buffered success first, then deliver itself immediately.
                harness.procs[1].emitLine({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "429", content: [] } });
                harness.procs[1].emit("close", 1);
                expect(delivered.length).toBe(2);
                expect(delivered[0].content).toContain("Subagent ok");
                expect(delivered[1].content).toContain("FAILED");
                manager.dispose();
        });

        test("BLOCKED final reply ⇒ blocked status with the reason", () => {
                const harness = new SpawnHarness();
                const { manager, delivered } = makeManager(harness, freshDir());
                manager.spawnFleetChild(REQUEST);
                const proc = harness.procs[0];
                proc.emitLine({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "BLOCKED: the target directory does not exist" }] } });
                proc.emit("close", 0);
                const state = [...manager.children.values()][0];
                expect(state.status).toBe("blocked");
                expect(state.blockReason).toBe("the target directory does not exist");
                expect(delivered[0].content).toContain("BLOCKED");
                manager.dispose();
        });

        test("provider error message ⇒ failed", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, freshDir());
                manager.spawnFleetChild(REQUEST);
                const proc = harness.procs[0];
                proc.emitLine({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "429 Too Many Requests", content: [] } });
                proc.emit("close", 1);
                const state = [...manager.children.values()][0];
                expect(state.status).toBe("failed");
                expect(state.stderr).toContain("429");
                manager.dispose();
        });
});

describe("FleetManager steer / stop / ask", () => {
        test("steer writes a control command the child can consume", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, freshDir());
                const ack = manager.spawnFleetChild({ ...REQUEST, name: "scout" }) as { ok: true; id: string; name: string };
                const result = manager.steer("scout", "focus on the auth module\nthen stop");
                expect(result).toEqual({ ok: true, delivered: "steer" });
                const controlFile = join(manager.fleetDirPath(), `${ack.id}.control.json`);
                const commands = parseControlCommands(readFileSync(controlFile, "utf8"));
                expect(commands).toHaveLength(1);
                expect(commands[0].kind).toBe("steer");
                expect(commands[0].text).toBe("focus on the auth module then stop"); // flattened
                const state = manager.children.get(ack.id)!;
                expect(state.steerCount).toBe(1);
                expect(state.status).toBe("active"); // not stalled after the steer
                manager.dispose();
        });

        test("ask file polling delivers the question and parks the child", () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager, delivered } = makeManager(harness, dir);
                const ack = manager.spawnFleetChild({ ...REQUEST, name: "worker" }) as { ok: true; id: string; name: string };
                // The child writes its ask file (as fleet-child.ts would).
                const askFile = join(dir, `${ack.id}.ask.json`);
                writeFileSync(askFile, JSON.stringify({ id: ack.id, question: "Which branch should I target?", ts: Date.now() }));
                manager.tick();
                const state = manager.children.get(ack.id)!;
                expect(state.status).toBe("waiting-for-answer");
                expect(state.pendingQuestion).toContain("Which branch");
                expect(delivered[0].kind).toBe("question");
                expect(delivered[0].content).toContain("Which branch should I target?");
                // Answering steers the reply back and un-parks.
                const steer = manager.steer("worker", "target main");
                expect(steer.ok).toBe(true);
                manager.tick();
                expect(["waiting-for-answer", "active"]).toContain(manager.children.get(ack.id)!.status);
                manager.dispose();
        });

        test("stop marks stopped, delivers, and schedules the tree kill", () => {
                const harness = new SpawnHarness();
                const { manager, delivered } = makeManager(harness, freshDir());
                manager.spawnFleetChild({ ...REQUEST, name: "scout" });
                const result = manager.stop("scout");
                expect(result.ok).toBe(true);
                const state = [...manager.children.values()][0];
                expect(state.status).toBe("stopped");
                expect(delivered[0].content).toContain("stopped");
                manager.dispose();
        });

        test("stall classification runs on tick", () => {
                const harness = new SpawnHarness();
                const { manager } = makeManager(harness, freshDir());
                const ack = manager.spawnFleetChild(REQUEST) as { ok: true; id: string };
                const state = manager.children.get(ack.id)!;
                state.lastActivityAt = Date.now() - 200_000; // beyond the stall window
                manager.tick();
                expect(state.status).toBe("stalled");
                manager.dispose();
        });
});

describe("FleetManager resume", () => {
        test("a finished child resumes by name through its loadout + session file", () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager } = makeManager(harness, dir);
                const first = manager.spawnFleetChild({ ...REQUEST, name: "mapper" }) as { ok: true; id: string; name: string };
                const proc = harness.procs[0];
                proc.emitLine({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
                // The real child writes its session file; the fake spawn does not —
                // create it so resume's existsSync check passes.
                const sessionOnDisk = manager.children.get(first.id)!.sessionFile;
                writeFileSync(sessionOnDisk, "", { flag: "w" });
                proc.emit("close", 0);
                expect([...manager.children.values()][0].status).toBe("done");
                // Steer by name after completion ⇒ resume (a second spawn).
                const result = manager.steer("mapper", "now map the tests too");
                expect(result.ok && result.delivered).toBe("resume");
                expect(harness.calls.length).toBe(2);
                const secondCall = harness.calls[1];
                expect(secondCall.args).not.toContain("--no-session");
                const sessionIdx = secondCall.args.indexOf("--session");
                // SAME session file as the original run (context carries over).
                expect(secondCall.args[sessionIdx + 1]).toBe(sessionOnDisk);
                manager.dispose();
        });
});

describe("registerFleetSurface", () => {
        function makeFakePi() {
                const tools = new Map<string, any>();
                const commands = new Map<string, any>();
                const renderers = new Map<string, any>();
                const handlers = new Map<string, Array<(event: any, ctx?: any) => any>>();
                const sent: any[] = [];
                const pi: any = {
                        registerTool: (t: any) => tools.set(t.name, t),
                        registerCommand: (name: string, def: any) => commands.set(name, def),
                        registerMessageRenderer: (type: string, fn: any) => renderers.set(type, fn),
                        on: (event: string, fn: any) => {
                                if (!handlers.has(event)) handlers.set(event, []);
                                handlers.get(event)!.push(fn);
                        },
                        sendMessage: (msg: any, opts: any) => sent.push({ msg, opts }),
                };
                const emit = async (event: string, payload: any, ctx?: any) => {
                        let last: any;
                        for (const h of handlers.get(event) ?? []) {
                                const r = await h(payload, ctx);
                                if (r !== undefined) last = r;
                        }
                        return last;
                };
                return { pi, tools, commands, renderers, emit, sent };
        }

        test("registers task_control, /tasks, renderers; session_start binds delivery to sendMessage", async () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager, delivered } = makeManager(harness, dir);
                const fake = makeFakePi();
                registerFleetSurface(fake.pi, manager, { cwd: TMP });
                expect(fake.tools.has("task_control")).toBe(true);
                expect(fake.commands.has("tasks")).toBe(true);
                expect(fake.renderers.has("unown-subagent-result")).toBe(true);
                expect(fake.renderers.has("unown-subagent-question")).toBe(true);

                // Bind via session_start, then a finished child must sendMessage
                // with triggerTurn (the steer-back that wakes the parent). NOTE:
                // session_start REBINDS the manager's deliver to the sendMessage
                // path, so the harness's first recorder is replaced — assert on
                // the fake pi's sent messages.
                await fake.emit("session_start", {}, { ui: { setWidget: () => {}, setStatus: () => {} } });
                manager.spawnFleetChild({ ...REQUEST, name: "scout" });
                harness.procs[0].emit("close", 0);
                await new Promise((r) => setTimeout(r, 250)); // success rides the batch
                expect(fake.sent.length).toBe(1);
                expect(fake.sent[0].msg.customType).toBe("unown-subagent-result");
                expect(fake.sent[0].opts).toEqual({ triggerTurn: true, deliverAs: "steer" });
                manager.dispose();
        });

        test("task_control list + steer + unknown-id errors", async () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager } = makeManager(harness, dir);
                const fake = makeFakePi();
                registerFleetSurface(fake.pi, manager, { cwd: TMP });
                const tool = fake.tools.get("task_control");

                const listed = await tool.execute("t1", { action: "list" });
                expect(listed.content[0].text).toContain("No subagents running");

                const missing = await tool.execute("t2", { action: "steer", id: "ghost", message: "hi" });
                expect(missing.content[0].text).toContain("Error");

                const noMessage = await tool.execute("t3", { action: "steer", id: "x" });
                expect(noMessage.content[0].text).toContain("Error");

                manager.spawnFleetChild({ ...REQUEST, name: "scout" });
                const status = await tool.execute("t4", { action: "status", id: "scout" });
                expect(status.content[0].text).toContain("scout (scout) — starting");
                const steer = await tool.execute("t5", { action: "steer", id: "scout", message: "go faster" });
                expect(steer.content[0].text).toContain("delivered to scout");
                const stop = await tool.execute("t6", { action: "stop", id: "scout" });
                expect(stop.content[0].text).toContain("Stop signal sent");
                manager.dispose();
        });
});

describe("ask delivery is once-per-question (live-regression: the re-ask loop)", () => {
        test("a steer does not re-deliver the standing question; a NEW question does deliver", () => {
                const harness = new SpawnHarness();
                const dir = freshDir();
                const { manager, delivered } = makeManager(harness, dir);
                const ack = manager.spawnFleetChild({ ...REQUEST, name: "worker" }) as { ok: true; id: string; name: string };
                const askFile = join(dir, `${ack.id}.ask.json`);
                writeFileSync(askFile, JSON.stringify({ id: ack.id, question: "Which branch?", ts: Date.now() }));
                manager.tick();
                expect(delivered.filter((d) => d.kind === "question")).toHaveLength(1);
                // Steer (the parent answering) flips status away from
                // waiting-for-answer — the standing question must NOT re-deliver.
                manager.steer("worker", "target main");
                manager.tick();
                manager.tick();
                expect(delivered.filter((d) => d.kind === "question")).toHaveLength(1);
                expect(manager.children.get(ack.id)!.pendingQuestion).toBe("Which branch?");
                // The child resolves + deletes the ask file → pendingQuestion clears.
                rmSync(askFile, { force: true });
                manager.tick();
                expect(manager.children.get(ack.id)!.pendingQuestion).toBeUndefined();
                // A NEW (different) question delivers again.
                writeFileSync(askFile, JSON.stringify({ id: ack.id, question: "And the runner?", ts: Date.now() }));
                manager.tick();
                expect(delivered.filter((d) => d.kind === "question")).toHaveLength(2);
                manager.dispose();
        });
});
