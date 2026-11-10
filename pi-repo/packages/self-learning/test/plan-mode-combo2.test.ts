// plan-mode-combo2.test.ts — the 2026-11-10 combination round 2's pins.
//
// Two defects found driving the EXPANDED plan-mode × TUI matrix live:
//
//   L3 (the approve-each-edit promise): "Execute — approve each edit" maps to
//   permission mode `default`, but `default` alone only triggers ask RULES —
//   a default-config session has none. Measured live: a ZERO-dialog census
//   while the plan executed freely (2 file mutations, 0 prompts). The fix:
//   the manual approval lane seeds session-scoped ask rules for edit/write
//   through the new seedSessionAsk seam (cli.ts wires it to the shared gate).
//
//   L4 (the main TUI boot lane dropped the plan flags): `unown --plan
//   --plan-model <id> --max-turns <n>` silently ran the session model with
//   no budget — the worktree lane and the print lane delivered both values,
//   the MAIN boot lane dropped them at the cmdTui call site (measured live:
//   0/11 planning turns on the sibling, no not-found warning either). The
//   fix: the same field set as the worktree lane, pinned here as a
//   source-contract so the three TUI boots can never drift again.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPermissionGate } from "../src/permissions.ts";
import { createUnownToolsExtension } from "../src/tools.ts";
import { TEST_TMP } from "./_env.ts";

const CLEAN_ENV: Record<string, string | undefined> = {};

// ---------------------------------------------------------------------------
// Gate-level: seedSessionAsk semantics (permissions.ts)
// ---------------------------------------------------------------------------

const LOADED: string[] = [];
function freshScope() {
        const dir = mkdtempSync(join(TEST_TMP, "combo2-"));
        LOADED.push(dir);
        const cwd = join(dir, "proj");
        const agentDir = join(dir, "agent");
        mkdirSync(join(cwd, ".unown"), { recursive: true });
        mkdirSync(agentDir, { recursive: true });
        return { cwd, agentDir, statePath: join(agentDir, "trusted-configs.json") };
}
afterAll(() => {
        for (const d of LOADED) rmSync(d, { recursive: true, force: true });
        const holders = globalThis as unknown as Record<symbol, { lastAt: number; turnActive: boolean }>;
        const key = Symbol.for("unown-fleet-activity");
        if (holders[key]) holders[key].turnActive = false;
});

function writeUser(scope: ReturnType<typeof freshScope>, doc: unknown): string {
        const file = join(scope.agentDir, "permissions.json");
        writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
        return file;
}

describe("gate.seedSessionAsk — the approve-each-edit session rules", () => {
        test("the measured defect: a default-config session never prompts on edit (mode alone is not a rule)", () => {
                const s = freshScope();
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                gate.setSessionMode("default");
                const res = gate.check("edit", { path: "app.py" });
                expect(res.blocked).toBe(false);
                expect((res as { needsAsk?: boolean }).needsAsk).toBeFalsy(); // the zero-dialog census
        });

        test("seeding turns every edit/write call into a prompt; other tools stay free", () => {
                const s = freshScope();
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                gate.setSessionMode("default");
                gate.seedSessionAsk(["edit", "write"]);
                const edit = gate.check("edit", { path: "app.py" }) as { blocked: boolean; needsAsk?: boolean };
                const write = gate.check("write", { path: "new.py" }) as { blocked: boolean; needsAsk?: boolean };
                const read = gate.check("read", { path: "app.py" }) as { blocked: boolean; needsAsk?: boolean };
                expect(edit.needsAsk).toBe(true);
                expect(write.needsAsk).toBe(true);
                expect(read.needsAsk).toBeFalsy();
        });

        test("repeat seeding dedupes — a re-approved plan never stacks rules", () => {
                const s = freshScope();
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                gate.seedSessionAsk(["edit", "write"]);
                gate.seedSessionAsk(["edit", "write"]);
                gate.seedSessionAsk(["edit", "write"]);
                expect(gate.status().sessionRuleCount).toBe(2);
        });

        test("a MORE SPECIFIC config allow still wins on its own subject (the user's own carve-out stands)", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "edit", effect: "allow", pattern: "app.py" }] });
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                gate.setSessionMode("default");
                gate.seedSessionAsk(["edit", "write"]);
                const carved = gate.check("edit", { path: "app.py" }) as { blocked: boolean; needsAsk?: boolean };
                const other = gate.check("edit", { path: "other.py" }) as { blocked: boolean; needsAsk?: boolean };
                expect(carved.needsAsk).toBeFalsy(); // specificity beats the pattern-less session ask
                expect(other.needsAsk).toBe(true);
        });

        test("a config deny still beats the session ask — the safety floor holds", () => {
                const s = freshScope();
                writeUser(s, { version: 1, rules: [{ tool: "edit", effect: "deny" }] });
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                gate.setSessionMode("default");
                gate.seedSessionAsk(["edit", "write"]);
                const res = gate.check("edit", { path: "app.py" });
                expect(res.blocked).toBe(true);
        });

        test("acceptEdits auto-approves the seeded asks for in-project paths (the mode adjustment contract)", () => {
                const s = freshScope();
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                gate.seedSessionAsk(["edit", "write"]);
                gate.setSessionMode("acceptEdits");
                const inProject = gate.check("edit", { path: "src/a.ts" }) as { blocked: boolean; needsAsk?: boolean };
                const outProject = gate.check("edit", { path: "../outside.ts" }) as { blocked: boolean; needsAsk?: boolean };
                expect(inProject.needsAsk).toBeFalsy();
                expect(outProject.needsAsk).toBe(true);
        });

        test("the seeded rules die with the gate — nothing is written to disk", () => {
                const s = freshScope();
                const userFile = writeUser(s, { version: 1, rules: [] });
                const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
                gate.seedSessionAsk(["edit", "write"]);
                expect(readFileSync(userFile, "utf-8")).toBe(`${JSON.stringify({ version: 1, rules: [] }, null, 2)}\n`);
        });
});

// ---------------------------------------------------------------------------
// Factory-level: the approval dialog routes the manual lane through the seam
// ---------------------------------------------------------------------------

const GOOD_PLAN = `# Plan: Add the clamp helper

## Context
The app needs a clamp(x, lo, hi) helper next to add() (files: app.py).

## Approach
Add the helper and a stdlib unittest suite, then run the tests.

## Steps
1. Add clamp(x, lo, hi) to app.py (files: app.py)
2. Create test_app.py with unittest cases (files: test_app.py)
3. Run python -m unittest to confirm all tests pass (files: test_app.py)

## Risks
- None — pure stdlib, no new dependencies.

## Verification
- python -m unittest -v exits 0.
`;

type Handler = (event: any, ctx?: any) => any;

/** A fake pi in the shape plan-mode-flags.test.ts established. */
function makeFakePi(flags: Record<string, boolean | string> = {}) {
        const handlers = new Map<string, Handler[]>();
        const commands = new Map<string, { description: string; handler: Handler }>();
        const tools = new Map<string, any>();
        const activeTools: string[] = ["read", "bash", "edit", "write", "todo", "task"];
        const pi: any = {
                on: (event: string, handler: Handler) => {
                        if (!handlers.has(event)) handlers.set(event, []);
                        handlers.get(event)!.push(handler);
                },
                registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
                registerFlag: () => {},
                registerTool: (tool: any) => tools.set(tool.name, tool),
                registerShortcut: () => {},
                appendEntry: () => {},
                getFlag: (name: string) => flags[name],
                getActiveTools: () => [...activeTools],
                setActiveTools: (next: string[]) => {
                        activeTools.length = 0;
                        activeTools.push(...next);
                },
                sendMessage: () => {},
                sendUserMessage: () => {},
                setModel: async () => true,
                setSessionName: () => {},
        };
        const emit = async (event: string, payload: any, ctx?: any) => {
                let result: any;
                for (const h of handlers.get(event) ?? []) {
                        const r = await h(payload, ctx);
                        if (r !== undefined) result = r;
                }
                return result;
        };
        const entries: any[] = [];
        const ctx = {
                hasUI: true,
                ui: {
                        notify: () => {},
                        setStatus: () => {},
                        setWidget: () => {},
                        theme: { fg: (_n: string, t: string) => t },
                },
                sessionManager: { getEntries: () => entries, getSessionId: () => "s1", getBranch: () => [...entries] },
        };
        return { pi, emit, commands, tools, ctx };
}

async function wireApproval() {
        const dir = mkdtempSync(join(tmpdir(), "unown-combo2-ext-"));
        const modeCalls: string[] = [];
        const seeded: string[][] = [];
        const ext = createUnownToolsExtension({
                cwd: dir,
                engineUrl: "http://127.0.0.1:9",
                setPermissionMode: (mode) => {
                        modeCalls.push(mode);
                        return { applied: true, effectiveMode: mode };
                },
                seedSessionAsk: (tools) => seeded.push([...tools]),
        });
        const fake = makeFakePi();
        ext.factory(fake.pi as any);

        // enter plan mode with a description (seeds the plan file identity)
        await fake.commands.get("plan")!.handler("add the clamp helper", fake.ctx);
        // write a plan that clears the score threshold through the real tool
        const planWrite = fake.tools.get("plan_write")!;
        await planWrite.execute("t1", { content: GOOD_PLAN }, undefined, undefined, fake.ctx);

        /** ctx whose ui.select answers a scripted option sequence. */
        const selecting = (script: Array<string | undefined>) => {
                const selects: Array<{ title: string; options: string[] }> = [];
                let call = 0;
                return {
                        ctx: {
                                ...fake.ctx,
                                ui: {
                                        ...fake.ctx.ui,
                                        select: async (title: string, options: string[]) => {
                                                selects.push({ title, options });
                                                return script[call++];
                                        },
                                        editor: async () => GOOD_PLAN,
                                        input: async () => "",
                                },
                        },
                        selects,
                };
        };
        return { fake, dir, modeCalls, seeded, selecting };
}

describe("the approval dialog's manual lane (the 2026-11-10 fix)", () => {
        test("'Execute — approve each edit' switches to default AND seeds session ask rules for edit/write", async () => {
                const w = await wireApproval();
                const sel = w.selecting(["Execute — approve each edit"]);
                const exit = w.fake.tools.get("exit_plan_mode")!;
                await exit.execute("t2", {}, undefined, undefined, sel.ctx);
                expect(w.modeCalls).toContain("default");
                expect(w.seeded).toEqual([["edit", "write"]]);
                expect(sel.selects).toHaveLength(1); // approved — the dialog does not loop
        });

        test("'Execute — auto-accept edits' switches to acceptEdits and does NOT seed ask rules", async () => {
                const w = await wireApproval();
                const sel = w.selecting(["Execute — auto-accept edits"]);
                const exit = w.fake.tools.get("exit_plan_mode")!;
                await exit.execute("t3", {}, undefined, undefined, sel.ctx);
                expect(w.modeCalls).toContain("acceptEdits");
                expect(w.seeded).toEqual([]);
        });

        test("the edit lane (option 3) never seeds — only a real execution approval arms the per-edit prompts", async () => {
                const w = await wireApproval();
                const sel = w.selecting(["Edit the plan", "Execute — auto-accept edits"]);
                const exit = w.fake.tools.get("exit_plan_mode")!;
                await exit.execute("t4", {}, undefined, undefined, sel.ctx);
                expect(w.seeded).toEqual([]);
        });
});

// ---------------------------------------------------------------------------
// Source-contract: the three TUI boot lanes deliver the plan flags together
// ---------------------------------------------------------------------------

describe("the main TUI boot lane delivers --plan-model and --max-turns (L4)", () => {
        const src = readFileSync(join(import.meta.dir, "../src/cli.ts"), "utf-8");

        /** Every `cmdTui(args.prompt, args.verbose, { … })` call block in cli.ts,
         * extracted by BALANCED-BRACE matching (the worktree lane's call ends in
         * `}),` inside a callback — a naive "});" scan overruns it). */
        function cmdTuiCalls(): string[] {
                const calls: string[] = [];
                const marker = "cmdTui(args.prompt, args.verbose, {";
                let at = src.indexOf(marker);
                while (at !== -1) {
                        const open = src.indexOf("{", at + marker.length - 1);
                        let depth = 0;
                        let i = open;
                        for (; i < src.length; i++) {
                                if (src[i] === "{") depth++;
                                else if (src[i] === "}") {
                                        depth--;
                                        if (depth === 0) break;
                                }
                        }
                        calls.push(src.slice(at, i + 1));
                        at = src.indexOf(marker, i);
                }
                return calls;
        }

        test("the main boot lane carries planModel and maxTurns (the dropped-field regression)", () => {
                const calls = cmdTuiCalls();
                expect(calls.length).toBeGreaterThanOrEqual(2); // the worktree lane + the main lane
                const main = calls[calls.length - 1]; // the main lane follows the worktree branch
                expect(main).toContain("planModel: args.planModel");
                expect(main).toContain("maxTurns: args.maxTurns");
        });

        test("every cmdTui call site delivers both plan-mode flags — the boots cannot drift", () => {
                for (const call of cmdTuiCalls()) {
                        expect(call).toContain("planModel: args.planModel");
                        expect(call).toContain("maxTurns: args.maxTurns");
                }
        });
});
