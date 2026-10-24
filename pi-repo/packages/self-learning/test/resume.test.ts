// resume.test.ts — the flow-round launch resume lane (src/resume.ts):
// --continue (latest-in-cwd) and --resume <id|name|path> resolution, plus
// the project-settings layer (src/project-settings.ts) merge contract.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { TEST_TMP } from "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
    describeResume,
    latestSessionForCwd,
    resolveResumeQuery,
    scanSessions,
} from "../src/resume.ts";
import {
    loadProjectSettings,
    parseProjectSettings,
    projectSettingsPath,
    renderProjectSettingsStatus,
    trustProjectSettings,
} from "../src/project-settings.ts";

const LOADED: string[] = [];
function freshDir(prefix = "rs-"): string {
    const d = mkdtempSync(join(TEST_TMP, prefix));
    LOADED.push(d);
    return d;
}
afterAll(() => {
    for (const d of LOADED) rmSync(d, { recursive: true, force: true });
});

/** Write one session JSONL fixture. */
function writeSession(
    dir: string,
    opts: { id: string; cwd?: string; name?: string; mtimeAgeMs?: number },
): string {
    const age = opts.mtimeAgeMs ?? 0;
    const file = join(dir, `2026-01-01T00-00-00-000Z_${opts.id}.jsonl`);
    const lines: string[] = [`{"type":"session","version":3,"id":"${opts.id}","timestamp":"2026-01-01T00:00:00.000Z"${opts.cwd ? `,"cwd":"${opts.cwd}"` : ""}}`];
    if (opts.name) lines.push(`{"type":"session_info","id":"n1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","name":"${opts.name}"}`);
    lines.push(`{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"user","content":"hi"}}`);
    writeFileSync(file, `${lines.join("\n")}\n`);
    // Deterministic mtime ordering (same-ms writes make "newest" ambiguous).
    const t = new Date(Date.now() - age);
    utimesSync(file, t, t);
    return file;
}

interface Scope {
    cwd: string;
    agentDir: string;
    sessionsDir: string;
    importsDir: string;
    statePath: string;
}
function freshScope(): Scope {
    const base = freshDir("rs-scope-");
    const cwd = join(base, "proj");
    const agentDir = join(base, "agent");
    const sessionsDir = join(agentDir, "sessions");
    const importsDir = join(cwd, ".unown", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(importsDir, { recursive: true });
    return { cwd, agentDir, sessionsDir, importsDir, statePath: join(agentDir, "trusted-configs.json") };
}

describe("latestSessionForCwd (--continue)", () => {
    test("the newest session whose header cwd is this directory, across both stores", () => {
        const s = freshScope();
        const other = freshDir("rs-other-");
        writeSession(s.sessionsDir, { id: "11111111-1111-1111-1111-111111111111", cwd: s.cwd, mtimeAgeMs: 3000 });
        writeSession(s.sessionsDir, { id: "22222222-2222-2222-2222-222222222222", cwd: other, mtimeAgeMs: 2000 });
        writeSession(s.importsDir, { id: "33333333-3333-3333-3333-333333333333", cwd: s.cwd, mtimeAgeMs: 1000 });
        // The import (created last, newest mtime) wins.
        const res = latestSessionForCwd(s.cwd, s.agentDir);
        expect(res.ok).toBe(true);
        if (res.ok) expect(basename(res.file)).toContain("33333333");
    });

    test("no session in this cwd → the actionable error", () => {
        const s = freshScope();
        const other = freshDir("rs-other2-");
        writeSession(s.sessionsDir, { id: "44444444-4444-4444-4444-444444444444", cwd: other });
        const res = latestSessionForCwd(s.cwd, s.agentDir);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.error).toContain("no previous session");
            expect(res.error).toContain("sessions list");
        }
    });

    test("a missing sessions dir is a clean no-session (fresh install)", () => {
        const s = freshScope();
        rmSync(s.sessionsDir, { recursive: true, force: true });
        rmSync(s.importsDir, { recursive: true, force: true });
        expect(latestSessionForCwd(s.cwd, s.agentDir).ok).toBe(false);
    });
});

describe("resolveResumeQuery (--resume <query>)", () => {
    test("a real file path passes through (the --session spelling)", () => {
        const s = freshScope();
        const f = writeSession(s.sessionsDir, { id: "aaaaaaaa-0000-0000-0000-000000000001", cwd: s.cwd });
        const res = resolveResumeQuery(s.cwd, s.agentDir, f);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.file).toBe(f);
            expect(res.via).toBe("path");
        }
    });

    test("a full or prefix id match resolves without reading bodies", () => {
        const s = freshScope();
        writeSession(s.sessionsDir, { id: "bbbbbbbb-1111-2222-3333-444444444444", cwd: s.cwd });
        const res = resolveResumeQuery(s.cwd, s.agentDir, "bbbbbbbb-1111");
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.via).toBe("id");
            expect(basename(res.file)).toContain("bbbbbbbb");
        }
    });

    test("a name match resolves newest-first (auto-titles and /name feed it)", () => {
        const s = freshScope();
        writeSession(s.sessionsDir, { id: "cccccccc-0000-0000-0000-000000000001", cwd: s.cwd, name: "Debug LLM bridge retry logic", mtimeAgeMs: 2000 });
        writeSession(s.sessionsDir, { id: "cccccccc-0000-0000-0000-000000000002", cwd: s.cwd, name: "Write the landing copy", mtimeAgeMs: 1000 });
        const res = resolveResumeQuery(s.cwd, s.agentDir, "landing");
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.via).toBe("name");
            expect(res.name).toBe("Write the landing copy");
        }
        const res2 = resolveResumeQuery(s.cwd, s.agentDir, "LANDING");
        expect(res2.ok).toBe(true); // case-insensitive
    });

    test("ambiguous name matches list the newest five candidates instead of guessing", () => {
        const s = freshScope();
        writeSession(s.sessionsDir, { id: "dddd0001-0000-0000-0000-000000000001", cwd: s.cwd, name: "fix tests alpha" });
        writeSession(s.sessionsDir, { id: "dddd0002-0000-0000-0000-000000000001", cwd: s.cwd, name: "fix tests beta" });
        const res = resolveResumeQuery(s.cwd, s.agentDir, "fix tests");
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.error).toContain("matches 2 sessions");
            expect(res.candidates?.length).toBe(2);
        }
    });

    test("no match → the actionable error naming both stores and -c", () => {
        const s = freshScope();
        writeSession(s.sessionsDir, { id: "eeee0001-0000-0000-0000-000000000001", cwd: s.cwd, name: "unrelated" });
        const res = resolveResumeQuery(s.cwd, s.agentDir, "zzz-nothing");
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toContain("no session matches");
    });

    test("scanSessions: header + latest name discovery", () => {
        const s = freshScope();
        writeSession(s.sessionsDir, { id: "ffff0001-0000-0000-0000-000000000001", cwd: s.cwd, name: "first name" });
        writeSession(s.sessionsDir, { id: "ffff0002-0000-0000-0000-000000000001", cwd: s.cwd });
        const list = scanSessions(s.cwd, s.agentDir);
        expect(list).toHaveLength(2);
        const withName = list.find((c) => c.id === "ffff0001-0000-0000-0000-000000000001");
        expect(withName?.name).toBe("first name");
    });

    test("describeResume renders the via note", () => {
        const s = freshScope();
        const f = writeSession(s.sessionsDir, { id: "ab12cd34-0000-0000-0000-000000000001", cwd: s.cwd });
        const res = resolveResumeQuery(s.cwd, s.agentDir, f);
        if (res.ok) expect(describeResume(res)).toContain("resumed from file");
    });
});

describe("project-settings (the .unown/settings.json layer)", () => {
    test("parse: valid keys survive, unknown keys and wrong shapes warn and drop", () => {
        const { settings, warnings } = parseProjectSettings({
            version: 1,
            model: "agnes-2.5-flash",
            provider: "agnes",
            effort: "high",
            permissionMode: "acceptEdits",
            addDirs: ["../shared"],
            frobnicate: true,
            effort2: "nope",
        });
        expect(settings.model).toBe("agnes-2.5-flash");
        expect(settings.provider).toBe("agnes");
        expect(settings.effort).toBe("high");
        expect(settings.permissionMode).toBe("acceptEdits");
        expect(settings.addDirs).toEqual(["../shared"]);
        expect(warnings.some((w) => w.includes("frobnicate"))).toBe(true);
    });

    test("parse: bad shapes drop the key with a warning", () => {
        const { settings, warnings } = parseProjectSettings({ effort: "ultra", permissionMode: "yolo", addDirs: "nope", model: 42 });
        expect(settings.model).toBeUndefined();
        expect(settings.effort).toBeUndefined();
        expect(settings.permissionMode).toBeUndefined();
        expect(settings.addDirs).toBeUndefined();
        expect(warnings.length).toBeGreaterThanOrEqual(3);
    });

    test("load: absent file is a clean not-found; the project path is conventional", () => {
        const s = freshScope();
        expect(projectSettingsPath(s.cwd)).toBe(join(s.cwd, ".unown", "settings.json"));
        const status = loadProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath });
        expect(status.found).toBe(false);
    });

    test("load: an untrusted file's keys are ignored with the notice; trust flips it", () => {
        const s = freshScope();
        mkdirSync(join(s.cwd, ".unown"), { recursive: true });
        writeFileSync(projectSettingsPath(s.cwd), `${JSON.stringify({ model: "agnes-2.5-flash" })}\n`);
        const st = loadProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath });
        expect(st.found).toBe(true);
        expect(st.trusted).toBe(false);
        expect(st.ignored).toBe(true);
        expect(st.settings.model).toBeUndefined();
        expect(st.warnings.some((w) => w.includes("UNTRUSTED"))).toBe(true);
        const t = trustProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath });
        expect(t.ok).toBe(true);
        const st2 = loadProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath });
        expect(st2.trusted).toBe(true);
        expect(st2.settings.model).toBe("agnes-2.5-flash");
    });

    test("load: UNOWN_TRUST_PROJECT_CONFIG=1 bypasses the gate (CI lane)", () => {
        const s = freshScope();
        mkdirSync(join(s.cwd, ".unown"), { recursive: true });
        writeFileSync(projectSettingsPath(s.cwd), `${JSON.stringify({ effort: "low" })}\n`);
        const st = loadProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath, env: { UNOWN_TRUST_PROJECT_CONFIG: "1" } });
        expect(st.trusted).toBe(true);
        expect(st.settings.effort).toBe("low");
    });

    test("load: invalid JSON is a warning, never a crash", () => {
        const s = freshScope();
        mkdirSync(join(s.cwd, ".unown"), { recursive: true });
        writeFileSync(projectSettingsPath(s.cwd), "{not json");
        const st = loadProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath });
        expect(st.found).toBe(true);
        expect(st.warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
    });

    test("render: the status card names the file, trust state and keys", () => {
        const s = freshScope();
        mkdirSync(join(s.cwd, ".unown"), { recursive: true });
        writeFileSync(projectSettingsPath(s.cwd), `${JSON.stringify({ model: "agnes-2.5-flash", addDirs: ["../shared"] })}\n`);
        trustProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath });
        const st = loadProjectSettings(s.cwd, { agentDir: s.agentDir, statePath: s.statePath });
        const text = renderProjectSettingsStatus(st);
        expect(text).toContain("trusted");
        expect(text).toContain("model: agnes-2.5-flash");
        expect(text).toContain("addDirs: ../shared");
        expect(text).toContain("precedence");
        // The not-found card carries the key list.
        const none = renderProjectSettingsStatus(loadProjectSettings(freshDir("rs-none-"), {}));
        expect(none).toContain("not found");
    });
});
