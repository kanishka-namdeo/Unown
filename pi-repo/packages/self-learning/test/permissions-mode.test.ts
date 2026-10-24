// permissions-mode.test.ts — the session-scoped permission mode override
// (the 2026-10-24 trust round: /permissions mode, --permission-mode) plus
// the /add-dir command surface. The mode lifecycle, the strict-hook refusal,
// the status/notify rendering, and the extension launch-flag path.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { TEST_TMP } from "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    createPermissionGate,
    createPermissionsExtension,
    renderPermissionsStatus,
    type PermissionGate,
} from "../src/permissions.ts";
import { clearSessionWriteRoots, sessionWriteRoots } from "../src/write-roots.ts";

const CLEAN_ENV: Record<string, string | undefined> = {};

interface Scope {
    cwd: string;
    agentDir: string;
    statePath: string;
}
const LOADED: string[] = [];
function freshScope(): Scope {
    const dir = mkdtempSync(join(TEST_TMP, "pm-"));
    LOADED.push(dir);
    const cwd = join(dir, "proj");
    const agentDir = join(dir, "agent");
    mkdirSync(join(cwd, ".unown"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    return { cwd, agentDir, statePath: join(agentDir, "trusted-configs.json") };
}
afterAll(() => {
    clearSessionWriteRoots();
    for (const d of LOADED) rmSync(d, { recursive: true, force: true });
});

function writeUser(scope: Scope, doc: unknown): string {
    const file = join(scope.agentDir, "permissions.json");
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return file;
}

function writeProject(scope: Scope, doc: unknown): string {
    const file = join(scope.cwd, ".unown", "permissions.json");
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return file;
}

function attachCommand(scope: Scope, opts: { env?: Record<string, string | undefined>; gate?: PermissionGate } = {}) {
    const gate =
        opts.gate ??
        createPermissionGate({
            cwd: scope.cwd,
            agentDir: scope.agentDir,
            env: opts.env ?? CLEAN_ENV,
            statePath: scope.statePath,
        });
    const commands: Record<string, { description?: string; handler: (args: string, ctx: any) => Promise<void> }> = {};
    const ext = createPermissionsExtension({ cwd: scope.cwd, agentDir: scope.agentDir, statePath: scope.statePath, gate });
    ext.factory({
        registerCommand: (name: string, def: any) => {
            commands[name] = def;
        },
    });
    const notes: string[] = [];
    const ctx = { ui: { notify: (msg: string) => notes.push(msg) } };
    return { commands, ctx, notes, gate };
}

describe("gate.setSessionMode — the runtime override", () => {
    test("switching to acceptEdits auto-approves in-project edit asks that default mode would prompt on", () => {
        const s = freshScope();
        writeUser(s, { version: 1, rules: [{ tool: "edit", effect: "ask", pattern: "src/**" }] });
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        // default: the edit ask needs a prompt
        const before = gate.check("edit", { path: "src/a.ts" });
        expect(before.needsAsk).toBe(true);
        // switch mid-session
        const res = gate.setSessionMode("acceptEdits");
        expect(res.applied).toBe(true);
        expect(res.effectiveMode).toBe("acceptEdits");
        const after = gate.check("edit", { path: "src/a.ts" });
        expect(after.needsAsk).toBeUndefined();
        expect(after.blocked).toBe(false);
    });

    test("bypassPermissions turns ask into allow; reset restores the config mode", () => {
        const s = freshScope();
        writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "ask", pattern: "bun test*" }] });
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        expect(gate.check("bash", { command: "bun test src" }).needsAsk).toBe(true);
        gate.setSessionMode("bypassPermissions");
        expect(gate.check("bash", { command: "bun test src" }).blocked).toBe(false);
        const res = gate.setSessionMode(null);
        expect(res.effectiveMode).toBe("default");
        expect(gate.check("bash", { command: "bun test src" }).needsAsk).toBe(true);
    });

    test("the strict-hook refusal: bypassPermissions is refused, config default stays", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, strict: true, statePath: s.statePath });
        const res = gate.setSessionMode("bypassPermissions");
        expect(res.applied).toBe(false);
        expect(res.note).toContain("UNOWN_STRICT_HOOKS");
        expect(gate.status().mode).toBe("default");
        // acceptEdits is fine under strict
        expect(gate.setSessionMode("acceptEdits").applied).toBe(true);
    });

    test("unknown mode values are refused with the valid set", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        const res = gate.setSessionMode("yolo" as any);
        expect(res.applied).toBe(false);
        expect(res.note).toContain("acceptEdits");
    });

    test("status reports the effective mode and its source", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        expect(gate.status().modeSource).toBe("config");
        gate.setSessionMode("acceptEdits");
        const st = gate.status();
        expect(st.mode).toBe("acceptEdits");
        expect(st.modeSource).toBe("session");
    });

    test("a session override survives a reload (the files changed, the user's choice stands)", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        gate.setSessionMode("acceptEdits");
        writeUser(s, { version: 1, mode: "bypassPermissions", rules: [] });
        gate.reload();
        // config now says bypass; the session override (acceptEdits) still governs
        expect(gate.status().mode).toBe("acceptEdits");
        expect(gate.status().requestedMode).toBe("bypassPermissions");
    });

    test("deny rules still deny in every mode (the layer only ADDS restrictions)", () => {
        const s = freshScope();
        writeUser(s, { version: 1, rules: [{ tool: "bash", effect: "deny", pattern: "rm *" }] });
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        gate.setSessionMode("bypassPermissions");
        const d = gate.check("bash", { command: "rm -rf /" });
        expect(d.blocked).toBe(true);
    });
});

describe("/permissions mode command", () => {
    test("mode switch notifies with the session-scoped caveat", async () => {
        const s = freshScope();
        const { commands, ctx, notes } = attachCommand(s);
        await commands["permissions"].handler("mode acceptEdits", ctx);
        expect(notes[0]).toContain("acceptEdits");
        expect(notes[0]).toContain("this session only");
    });

    test("bare 'mode' shows the current mode + usage", async () => {
        const s = freshScope();
        const { commands, ctx, notes } = attachCommand(s);
        await commands["permissions"].handler("mode", ctx);
        expect(notes[0]).toContain("current mode: default");
        expect(notes[0]).toContain("usage: /permissions mode");
    });

    test("invalid value notifies the error channel with the valid set", async () => {
        const s = freshScope();
        const { commands, ctx, notes } = attachCommand(s);
        await commands["permissions"].handler("mode fast", ctx);
        expect(notes[0]).toContain("unknown mode");
        expect(notes[0]).toContain("acceptEdits");
    });

    test("reset returns to the config files' mode", async () => {
        const s = freshScope();
        writeUser(s, { version: 1, mode: "acceptEdits", rules: [] });
        const { commands, ctx, notes, gate } = attachCommand(s);
        await commands["permissions"].handler("mode bypassPermissions", ctx);
        expect(gate.status().mode).toBe("bypassPermissions");
        await commands["permissions"].handler("mode reset", ctx);
        expect(gate.status().mode).toBe("acceptEdits");
        expect(notes[1]).toContain("config files");
    });

    test("the bare status render shows the session-override marker and the additional-dirs line", async () => {
        const s = freshScope();
        const { commands, ctx, notes, gate } = attachCommand(s);
        gate.setSessionMode("bypassPermissions");
        await commands["permissions"].handler("", ctx);
        const text = notes.join("\n");
        expect(text).toContain("mode: bypassPermissions");
        expect(text).toContain("session override");
        expect(text).toContain("additional dirs: none");
        expect(text).toContain("/add-dir <path>");
    });
});

describe("/add-dir command", () => {
    test("adding a directory grants the write jail and lists it", async () => {
        const s = freshScope();
        const sibling = join(s.cwd, "..", "sibling");
        mkdirSync(sibling, { recursive: true });
        const { commands, ctx, notes } = attachCommand(s);
        clearSessionWriteRoots();
        await commands["add-dir"].handler("../sibling", ctx);
        expect(notes[0]).toContain("added");
        expect(sessionWriteRoots()).toHaveLength(1);
        await commands["add-dir"].handler("", ctx);
        expect(notes[1]).toContain("(1)");
        expect(notes[1]).toContain("sibling");
        await commands["add-dir"].handler("clear", ctx);
        expect(sessionWriteRoots()).toHaveLength(0);
        expect(notes[2]).toContain("cleared");
    });

    test("a missing directory is refused with an actionable reason", async () => {
        const s = freshScope();
        const { commands, ctx, notes } = attachCommand(s);
        clearSessionWriteRoots();
        await commands["add-dir"].handler("/definitely/not/here", ctx);
        expect(notes[0]).toContain("does not exist");
        expect(sessionWriteRoots()).toHaveLength(0);
    });

    test("bare /add-dir with no roots prints the usage card", async () => {
        const s = freshScope();
        const { commands, ctx, notes } = attachCommand(s);
        clearSessionWriteRoots();
        await commands["add-dir"].handler("", ctx);
        expect(notes[0]).toContain("none");
        expect(notes[0]).toContain("usage: /add-dir");
    });
});

describe("extension launch flags (--permission-mode / --add-dir)", () => {
    test("initialMode applies a session override to the shared gate at construction", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        const commands: Record<string, any> = {};
        const ext = createPermissionsExtension({
            cwd: s.cwd,
            agentDir: s.agentDir,
            statePath: s.statePath,
            gate,
            initialMode: "acceptEdits",
        });
        ext.factory({ registerCommand: (n: string, d: any) => (commands[n] = d) });
        expect(gate.status().mode).toBe("acceptEdits");
        expect(gate.status().modeSource).toBe("session");
    });

    test("initialAddDirs lands the roots at construction (before any tool call)", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        const ext = createPermissionsExtension({
            cwd: s.cwd,
            agentDir: s.agentDir,
            statePath: s.statePath,
            gate,
            initialAddDirs: [s.cwd],
        });
        ext.factory({ registerCommand: () => {} });
        expect(sessionWriteRoots()).toHaveLength(1);
        clearSessionWriteRoots();
    });

    test("an invalid initialMode is refused loudly in the log, never fatal", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        const ext = createPermissionsExtension({
            cwd: s.cwd,
            agentDir: s.agentDir,
            statePath: s.statePath,
            gate,
            initialMode: "yolo" as any,
        });
        ext.factory({ registerCommand: () => {} });
        expect(gate.status().mode).toBe("default");
    });
});

describe("renderPermissionsStatus — trust-round additions", () => {
    test("session roots render as a list under additional dirs", () => {
        const s = freshScope();
        const gate = createPermissionGate({ cwd: s.cwd, agentDir: s.agentDir, env: CLEAN_ENV, statePath: s.statePath });
        const ext = createPermissionsExtension({
            cwd: s.cwd,
            agentDir: s.agentDir,
            statePath: s.statePath,
            gate,
            initialAddDirs: [s.cwd],
        });
        ext.factory({ registerCommand: () => {} });
        const text = renderPermissionsStatus(gate.status());
        expect(text).toContain("additional dirs (1)");
        expect(text).toContain("/add-dir clear");
        clearSessionWriteRoots();
    });
});
