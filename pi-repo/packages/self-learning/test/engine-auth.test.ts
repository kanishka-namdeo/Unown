// engine-auth.test.ts — the M7 authentication layer: policy resolution, the
// three request-level checks (Host / Origin / bearer token), token-file
// lifecycle, the engineFetch client (discovery + 401 retry), and the REAL
// HTTP gate in a fresh process (the wiring inside startServer's fetch
// wrapper — the unit suite calls handleApi directly and cannot see it).
//
// Conventions: pure functions take injected env/Request (governor.test.ts's
// withEnv); the fetch-wrapper tests run against an in-process Bun.serve
// echo endpoint; the boot-gate tests spawn fresh bun subprocesses exactly
// like store-quickcheck.test.ts (startServer boots the whole engine —
// router, automations, store — side effects the in-process suite must not
// grow).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
        engineFetch,
        engineToken,
        engineTokenPath,
        generateEngineToken,
        hostHeaderAllowed,
        invalidateEngineToken,
        isLoopbackHost,
        originAllowed,
        healEngineTokenFile,
        removeEngineTokenFile,
        requestToken,
        resolveAuthPolicy,
        tokenExempt,
        tokenMatches,
        writeEngineTokenFile,
} from "../src/engine-auth.ts";

const ROOT = mkdtempSync(join(tmpdir(), "unown-engine-auth-"));

afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

/** Save/restore the auth-relevant env around a case (governor.test.ts pattern). */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
        const keys = ["UNOWN_ENGINE_AUTH", "UNOWN_ENGINE_TOKEN", "UNOWN_ENGINE_HOST", "UNOWN_ENGINE_HOSTS"];
        const saved: Record<string, string | undefined> = {};
        for (const k of keys) saved[k] = process.env[k];
        try {
                for (const k of keys) delete process.env[k];
                for (const [k, v] of Object.entries(overrides)) {
                        if (v === undefined) delete process.env[k];
                        else process.env[k] = v;
                }
                fn();
        } finally {
                for (const k of keys) {
                        if (saved[k] === undefined) delete process.env[k];
                        else process.env[k] = saved[k];
                }
        }
}

function req(headers: Record<string, string>, url = "http://127.0.0.1:3030/api/overview"): Request {
        return new Request(url, { method: "GET", headers });
}

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

describe("resolveAuthPolicy (M7)", () => {
        test("default: token mode, loopback bind, no refusal", () => {
                withEnv({}, () => {
                        const p = resolveAuthPolicy(process.env);
                        expect(p.mode).toBe("token");
                        expect(p.token).toBeNull(); // generated per boot, not pinned
                        expect(p.widenedBind).toBe(false);
                        expect(p.refuse).toBe(false);
                        expect(p.hostsAllow).toEqual([]);
                });
        });

        test("UNOWN_ENGINE_AUTH=off is honored on a loopback bind", () => {
                withEnv({ UNOWN_ENGINE_AUTH: "off" }, () => {
                        const p = resolveAuthPolicy(process.env);
                        expect(p.mode).toBe("off");
                        expect(p.token).toBeNull();
                        expect(p.refuse).toBe(false);
                });
        });

        test("UNOWN_ENGINE_AUTH=off + widened bind (0.0.0.0) REFUSES to boot", () => {
                withEnv({ UNOWN_ENGINE_AUTH: "off", UNOWN_ENGINE_HOST: "0.0.0.0" }, () => {
                        const p = resolveAuthPolicy(process.env);
                        expect(p.refuse).toBe(true);
                        expect(p.refuseReason).toContain("UNOWN_ENGINE_HOST=0.0.0.0");
                        expect(p.refuseReason).toContain("UNOWN_ENGINE_AUTH=off");
                });
        });

        test("UNOWN_ENGINE_AUTH=off + LAN IP REFUSES; token mode on the same bind does not", () => {
                withEnv({ UNOWN_ENGINE_AUTH: "off", UNOWN_ENGINE_HOST: "192.168.1.5" }, () => {
                        expect(resolveAuthPolicy(process.env).refuse).toBe(true);
                });
                withEnv({ UNOWN_ENGINE_HOST: "192.168.1.5" }, () => {
                        const p = resolveAuthPolicy(process.env);
                        expect(p.refuse).toBe(false);
                        expect(p.widenedBind).toBe(true);
                });
        });

        test("loopback spellings stay loopback (localhost / 127.x / ::1 / sub.localhost)", () => {
                for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "app.localhost"]) {
                        withEnv({ UNOWN_ENGINE_HOST: host }, () => {
                                expect(resolveAuthPolicy(process.env).widenedBind).toBe(false);
                        });
                }
        });

        test("UNOWN_ENGINE_TOKEN pins the token instead of generating", () => {
                withEnv({ UNOWN_ENGINE_TOKEN: "tok-123" }, () => {
                        expect(resolveAuthPolicy(process.env).token).toBe("tok-123");
                });
        });

        test("UNOWN_ENGINE_HOSTS parses the allow-list (comma, case, blanks)", () => {
                withEnv({ UNOWN_ENGINE_HOSTS: "Dash.Example.COM, , other.example" }, () => {
                        expect(resolveAuthPolicy(process.env).hostsAllow).toEqual(["dash.example.com", "other.example"]);
                });
        });
});

// ---------------------------------------------------------------------------
// Host / Origin / token checks
// ---------------------------------------------------------------------------

describe("hostHeaderAllowed (DNS-rebinding lane, M7)", () => {
        const policy = { hostsAllow: ["dash.example.com"] };
        test("accepts loopback and IP literals with and without ports", () => {
                for (const h of ["localhost", "localhost:3030", "127.0.0.1:3030", "[::1]:3030", "192.168.1.5:3030", "app.localhost"]) {
                        expect(hostHeaderAllowed(req({ host: h }), policy)).toBe(true);
                }
        });
        test("rejects DNS names not on the allow-list (the rebinding attack)", () => {
                expect(hostHeaderAllowed(req({ host: "evil.com" }), policy)).toBe(false);
                expect(hostHeaderAllowed(req({ host: "evil.com:3030" }), policy)).toBe(false);
        });
        test("accepts allow-listed DNS names and rejects empty", () => {
                expect(hostHeaderAllowed(req({ host: "dash.example.com" }), policy)).toBe(true);
                expect(hostHeaderAllowed(req({ host: "" }), policy)).toBe(false);
                expect(hostHeaderAllowed(req({}), policy)).toBe(false);
        });
});

describe("originAllowed (browser CSRF lane, M7)", () => {
        test("no Origin header (curl / CLI / bridge) always passes", () => {
                expect(originAllowed(req({}), null)).toBe(true);
        });
        test("an Origin on the CORS allow-list passes", () => {
                expect(originAllowed(req({ origin: "http://localhost:3000" }), "http://localhost:3000")).toBe(true);
        });
        test("an Origin off the allow-list is rejected BEFORE routing (the preflight-free POST hole)", () => {
                expect(originAllowed(req({ origin: "http://evil.com" }), null)).toBe(false);
        });
        test("the opaque origin 'null' is rejected", () => {
                expect(originAllowed(req({ origin: "null" }), null)).toBe(false);
        });
});

describe("requestToken + tokenMatches + tokenExempt (M7)", () => {
        test("reads the Bearer header", () => {
                const r = req({ authorization: "Bearer abc" });
                expect(requestToken(r, new URL(r.url))).toBe("abc");
        });
        test("accepts ?token= on /api/events ONLY (the EventSource exception)", () => {
                const events = req({}, "http://127.0.0.1:3030/api/events?token=q");
                expect(requestToken(events, new URL(events.url))).toBe("q");
                const notes = req({}, "http://127.0.0.1:3030/api/notes?token=q");
                expect(requestToken(notes, new URL(notes.url))).toBeNull();
        });
        test("no credentials anywhere → null", () => {
                const r = req({});
                expect(requestToken(r, new URL(r.url))).toBeNull();
        });
        test("tokenMatches: exact, wrong, missing, length-mismatch", () => {
                expect(tokenMatches("t".repeat(64), "t".repeat(64))).toBe(true);
                expect(tokenMatches("x".repeat(64), "t".repeat(64))).toBe(false);
                expect(tokenMatches(null, "t".repeat(64))).toBe(false);
                expect(tokenMatches("short", "t".repeat(64))).toBe(false);
        });
        test("exemptions: OPTIONS and GET / only", () => {
                expect(tokenExempt("OPTIONS", "/api/overview")).toBe(true);
                expect(tokenExempt("GET", "/")).toBe(true);
                expect(tokenExempt("GET", "/api/overview")).toBe(false);
                expect(tokenExempt("POST", "/api/notes")).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// Token file lifecycle
// ---------------------------------------------------------------------------

describe("token file lifecycle (M7)", () => {
        test("generateEngineToken: 64 hex chars, unique", () => {
                const a = generateEngineToken();
                const b = generateEngineToken();
                expect(a).toMatch(/^[0-9a-f]{64}$/);
                expect(b).toMatch(/^[0-9a-f]{64}$/);
                expect(a).not.toBe(b);
        });

        test("write → read back verbatim; POSIX 0600; rewrite replaces (no append); remove cleans up", () => {
                const path = join(ROOT, "engine.token");
                writeEngineTokenFile(path, "a".repeat(64));
                expect(readFileSync(path, "utf8")).toBe("a".repeat(64));
                if (process.platform !== "win32") {
                        expect(statSync(path).mode & 0o777).toBe(0o600);
                }
                // a second boot's token replaces the first — never concatenates
                writeEngineTokenFile(path, "b".repeat(64));
                expect(readFileSync(path, "utf8")).toBe("b".repeat(64));
                removeEngineTokenFile(path);
                expect(() => readFileSync(path)).toThrow();
                removeEngineTokenFile(path); // idempotent
        });

        test("removeEngineTokenFile ownership check (audit M5): a drain never deletes a newer boot's token", () => {
                const path = join(ROOT, "engine.token");
                const oldToken = "o".repeat(64);
                const newToken = "n".repeat(64);
                // the newer boot already wrote its token...
                writeEngineTokenFile(path, newToken);
                // ...when the old instance's drain runs:
                removeEngineTokenFile(path, oldToken); // content differs -> keep
                expect(readFileSync(path, "utf8")).toBe(newToken);
                // the owning instance's drain still removes it:
                removeEngineTokenFile(path, newToken);
                expect(() => readFileSync(path)).toThrow();
                // no-expected stays the unconditional legacy behavior:
                writeEngineTokenFile(path, newToken);
                removeEngineTokenFile(path);
                expect(() => readFileSync(path)).toThrow();
        });

        test("healEngineTokenFile (audit M5): rewrites only a MISSING file, never clobbers a newer boot", () => {
                const path = join(ROOT, "engine.token");
                const mine = "m".repeat(64);
                const newer = "x".repeat(64);
                // missing -> rewritten, returns true
                rmSync(path, { force: true });
                expect(healEngineTokenFile(path, mine)).toBe(true);
                expect(readFileSync(path, "utf8")).toBe(mine);
                // intact -> no-op, returns false
                expect(healEngineTokenFile(path, mine)).toBe(false);
                expect(readFileSync(path, "utf8")).toBe(mine);
                // a newer boot's token -> NEVER clobbered, returns false
                writeEngineTokenFile(path, newer);
                expect(healEngineTokenFile(path, mine)).toBe(false);
                expect(readFileSync(path, "utf8")).toBe(newer);
                rmSync(path, { force: true });
        });
});

// ---------------------------------------------------------------------------
// engineFetch (client discovery + 401 retry)
// ---------------------------------------------------------------------------

describe("engineFetch (M7 client)", () => {
        let echo: { port: number; stop: () => void; seen: Array<{ auth: string | null }> };
        let rewriteTo: string | null = null; // when set, the handler rewrites the token file and 401s once
        let rejectFirst: boolean = false;

        beforeEach(() => {
                invalidateEngineToken();
                rewriteTo = null;
                rejectFirst = false;
                const seen: Array<{ auth: string | null }> = [];
                const server = Bun.serve({
                        port: 0,
                        fetch(r) {
                                seen.push({ auth: r.headers.get("authorization") });
                                if (rejectFirst && seen.length === 1) {
                                        if (rewriteTo) writeEngineTokenFile(engineTokenPath(), rewriteTo);
                                        return new Response("no", { status: 401 });
                                }
                                return Response.json({ ok: true });
                        },
                });
                echo = { port: server.port, stop: () => server.stop(true), seen };
        });

        afterEach(() => {
                echo.stop();
                invalidateEngineToken();
                removeEngineTokenFile(engineTokenPath());
                delete process.env.UNOWN_ENGINE_TOKEN;
        });

        test("attaches the token from DATA_DIR/engine.token (same-user discovery)", async () => {
                writeEngineTokenFile(engineTokenPath(), "f".repeat(64));
                invalidateEngineToken();
                const res = await engineFetch(`http://127.0.0.1:${echo.port}/api/overview`);
                expect(res.status).toBe(200);
                expect(echo.seen[0].auth).toBe(`Bearer ${"f".repeat(64)}`);
        });

        test("no token file and no env → no header (plain fetch shape)", async () => {
                const res = await engineFetch(`http://127.0.0.1:${echo.port}/api/overview`);
                expect(res.status).toBe(200);
                expect(echo.seen[0].auth).toBeNull();
        });

        test("UNOWN_ENGINE_TOKEN (pin / remote engine) beats the file", async () => {
                writeEngineTokenFile(engineTokenPath(), "f".repeat(64));
                process.env.UNOWN_ENGINE_TOKEN = "pinned-tok";
                invalidateEngineToken();
                const res = await engineFetch(`http://127.0.0.1:${echo.port}/api/overview`);
                expect(echo.seen[0].auth).toBe("Bearer pinned-tok");
        });

        test("401 + token file rotated server-side → one re-read, one retry, 200", async () => {
                writeEngineTokenFile(engineTokenPath(), "old".padEnd(64, "0"));
                invalidateEngineToken();
                rejectFirst = true;
                rewriteTo = "new".padEnd(64, "1"); // the "engine rebooted" simulation
                const res = await engineFetch(`http://127.0.0.1:${echo.port}/api/overview`);
                expect(res.status).toBe(200);
                expect(echo.seen.length).toBe(2);
                expect(echo.seen[0].auth).toBe(`Bearer ${"old".padEnd(64, "0")}`);
                expect(echo.seen[1].auth).toBe(`Bearer ${"new".padEnd(64, "1")}`);
        });

        test("401 with a pinned (unchanging) token → genuine reject, no retry", async () => {
                process.env.UNOWN_ENGINE_TOKEN = "pinned-tok";
                invalidateEngineToken();
                rejectFirst = true;
                const res = await engineFetch(`http://127.0.0.1:${echo.port}/api/overview`);
                expect(res.status).toBe(401);
                expect(echo.seen.length).toBe(1);
        });

        test("a caller-provided Authorization is never overridden", async () => {
                writeEngineTokenFile(engineTokenPath(), "f".repeat(64));
                invalidateEngineToken();
                await engineFetch(`http://127.0.0.1:${echo.port}/api/overview`, {
                        headers: { Authorization: "Bearer custom" },
                });
                expect(echo.seen[0].auth).toBe("Bearer custom");
        });
});

// ---------------------------------------------------------------------------
// The real HTTP gate — fresh process, real startServer (the fetch-wrapper
// wiring; handleApi-direct tests cannot see it)
// ---------------------------------------------------------------------------

const PKG_ROOT = join(import.meta.dir, "..");

function gateProbe(env: NodeJS.ProcessEnv): { code: number; stdout: string; stderr: string } {
        const root = mkdtempSync(join(tmpdir(), "unown-auth-gate-"));
        // The token lives in the DATA DIR THE CALLER REDIRECTED THE ENGINE TO
        // (env.PI_SELFLEARNING_DATA) — not in this scratch root (probe script only).
        const tokenFile = join(env.PI_SELFLEARNING_DATA ?? join(root, "data"), "engine.token");
        // The probe boots the REAL engine on an ephemeral port, then plays
        // every attacker/legitimate-client role against it and prints a
        // verdict per line. The engine's token lands in <root>/data.
        const script = `
const { startServer } = await import(${JSON.stringify(join(PKG_ROOT, "src/server.ts"))});
const { readFileSync } = await import("node:fs");
const server = startServer(0);
if (!server) { console.log("BOOT=refused"); process.exit(0); }
const base = "http://127.0.0.1:" + server.port;
const tok = readFileSync(${JSON.stringify(tokenFile)}, "utf8").trim();
const lines = [];
const probe = async (label, path, init) => {
        try {
                const res = await fetch(base + path, init);
                let body = "";
                if (res.status >= 400) { try { body = await res.text(); } catch {} }
                else { try { await res.body?.cancel(); } catch {} }
                lines.push(label + " status=" + res.status + (body.includes("engine token") ? " authErr" : ""));
        } catch (e) {
                lines.push(label + " status=ERR");
        }
};
await probe("no-token-overview", "/api/overview", {});
await probe("token-overview", "/api/overview", { headers: { Authorization: "Bearer " + tok } });
await probe("wrong-token-overview", "/api/overview", { headers: { Authorization: "Bearer " + "x".repeat(64) } });
await probe("root-liveness", "/", {});
await probe("options-preflight", "/api/overview", { method: "OPTIONS" });
await probe("host-evil", "/api/overview", { headers: { Host: "evil.com", Authorization: "Bearer " + tok } });
await probe("host-allowed-dns", "/api/overview", { headers: { Host: "dash.example.com", Authorization: "Bearer " + tok } });
await probe("origin-evil-get", "/api/overview", { headers: { Origin: "http://evil.com", Authorization: "Bearer " + tok } });
await probe("origin-evil-plain-post", "/api/notes", { method: "POST", headers: { Origin: "http://evil.com", "Content-Type": "text/plain" }, body: "hi" });
await probe("origin-localhost-post", "/api/notes", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ content: "gate probe", project_path: "/tmp" }) });
await probe("events-query-token", "/api/events?token=" + encodeURIComponent(tok), {});
await probe("notes-query-token-rejected", "/api/notes?token=" + encodeURIComponent(tok), {});
console.log(lines.join("\\n"));
server.stop(true);
process.exit(0);
`;
        const probePath = join(root, "probe.ts");
        writeFileSync(probePath, script);
        const res = spawnSync(process.execPath, [probePath], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 90_000 });
        rmSync(root, { recursive: true, force: true });
        return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("startServer HTTP auth gate (M7, fresh process)", () => {
        test("default posture: token required, exemptions honored, browser lanes closed", () => {
                const root = mkdtempSync(join(tmpdir(), "unown-auth-env-"));
                const out = gateProbe({
                        PI_SELFLEARNING_DATA: join(root, "data"),
                        PI_SELFLEARNING_DB: join(root, "db", "selflearning.db"),
                        UNOWN_HOME: join(root, "unown-home"),
                        UNOWN_ENGINE_HOSTS: "dash.example.com",
                });
                rmSync(root, { recursive: true, force: true });
                const lines = out.stdout.trim().split("\n");
                const by = (label: string) => lines.find((l) => l.startsWith(label + " "));
                expect(out.code).toBe(0);
                // the drive-by lanes this milestone exists to close
                expect(by("no-token-overview")).toBe("no-token-overview status=401 authErr");
                expect(by("wrong-token-overview")).toBe("wrong-token-overview status=401 authErr");
                expect(by("host-evil")).toBe("host-evil status=403");
                expect(by("origin-evil-get")).toBe("origin-evil-get status=403");
                expect(by("origin-evil-plain-post")).toBe("origin-evil-plain-post status=403");
                expect(by("notes-query-token-rejected")).toBe("notes-query-token-rejected status=401 authErr");
                // legitimate clients keep working
                expect(by("token-overview")).toBe("token-overview status=200");
                expect(by("root-liveness")).toBe("root-liveness status=200");
                expect(by("options-preflight")).toBe("options-preflight status=204");
                expect(by("host-allowed-dns")).toBe("host-allowed-dns status=200");
                expect(by("events-query-token")).toBe("events-query-token status=200");
                // a loopback-origin browser POST (the dashboard's lane) with the token passes
                expect(by("origin-localhost-post")).toBe("origin-localhost-post status=200");
        }, 120_000);

        test("a LOSING engine (lock already held) must not clobber the winner's token file", () => {
                // The live-E2E bug this pins: during a kill/recovery window two
                // engines can race. The loser exits 0 at the single-instance
                // lock — if it wrote its token BEFORE that check it replaced
                // the RUNNING engine's token and every same-user client 401'd
                // until a manual restart. The write must happen only after the
                // lock is won (server.ts M7 note).
                const root = mkdtempSync(join(tmpdir(), "unown-auth-race-"));
                // The winner stays ALIVE in the background (spawn, not spawnSync —
                // a never-exiting engine cannot be run synchronously), holding the
                // lock and its token file. Script name matters: the Linux
                // lock-reuse guard matches /self-learning/ in the holder's cmdline.
                const winnerScript = `
const { startServer } = await import(${JSON.stringify(join(PKG_ROOT, "src/server.ts"))});
const a = startServer(0);
console.log("WINNER=up");
await new Promise(() => {});
`;
                const loserScript = `
const { readFileSync } = await import("node:fs");
const { startServer } = await import(${JSON.stringify(join(PKG_ROOT, "src/server.ts"))});
const before = readFileSync(${JSON.stringify(join(root, "data", "engine.token"))}, "utf8").trim();
const b = startServer(0); // must lose the lock and return null
const after = readFileSync(${JSON.stringify(join(root, "data", "engine.token"))}, "utf8").trim();
console.log("LOSER=" + (b === null ? "exited" : "BOOTED-BAD") + " TOKEN_INTACT=" + (before === after));
process.exit(0);
`;
                const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        PI_SELFLEARNING_DATA: join(root, "data"),
                        PI_SELFLEARNING_DB: join(root, "db", "selflearning.db"),
                        UNOWN_HOME: join(root, "unown-home"),
                };
                const wPath = join(root, "self-learning-winner.ts");
                const lPath = join(root, "loser.ts");
                writeFileSync(wPath, winnerScript);
                writeFileSync(lPath, loserScript);
                const winner = spawn(process.execPath, [wPath], { env });
                try {
                        // wait for the winner's lock + token (bounded)
                        const deadline = Date.now() + 30_000;
                        const tokenFile = join(root, "data", "engine.token");
                        while (Date.now() < deadline) {
                                if (existsSync(tokenFile) && existsSync(join(root, "data", "engine.lock"))) break;
                                sleepSync(200);
                        }
                        expect(existsSync(tokenFile)).toBe(true);
                        const loser = spawnSync(process.execPath, [lPath], { env, encoding: "utf8", timeout: 60_000 });
                        expect(loser.stdout).toContain("LOSER=exited");
                        expect(loser.stdout).toContain("TOKEN_INTACT=true");
                } finally {
                        winner.kill("SIGKILL");
                        rmSync(root, { recursive: true, force: true });
                }
        }, 120_000);

        test("a BIND-FAILED engine (lock free, port held) must not clobber the running winner's token file", async () => {
                // The second race the live PTY lane caught (the M7 loser fix was
                // necessary but not sufficient): a racing engine acquires the
                // (stale/stealable) lock, fails the PORT bind, and exits — if it
                // wrote its token at lock time it clobbered the RUNNING winner's
                // token and every client 401-locked-out until a manual restart.
                // The invariant: the token on disk always belongs to the process
                // HOLDING THE PORT — written only after Bun.serve succeeds.
                const root = mkdtempSync(join(tmpdir(), "unown-auth-bindrace-"));
                const port = 3199; // fixed port: the winner binds it; a dummy holder rebinds after the kill
                const winnerScript = `
const { writeFileSync } = await import("node:fs");
const { startServer } = await import(${JSON.stringify(join(PKG_ROOT, "src/server.ts"))});
const a = startServer(${port});
writeFileSync(${JSON.stringify(join(root, "winner.up"))}, "up");
await new Promise(() => {});
`;
                const victimScript = `
const { readFileSync } = await import("node:fs");
const { startServer } = await import(${JSON.stringify(join(PKG_ROOT, "src/server.ts"))});
const tokenFile = ${JSON.stringify(join(root, "data", "engine.token"))};
const before = readFileSync(tokenFile, "utf8").trim();
try {
        const b = startServer(${port}); // port held by the dummy listener → Bun.serve throws
        if (b) { console.log("VICTIM=BOOTED-UNEXPECTED"); b.stop(true); }
} catch {
        console.log("VICTIM=bind-failed");
}
const after = readFileSync(tokenFile, "utf8").trim();
console.log("TOKEN_INTACT=" + (before === after));
process.exit(0);
`;
                const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        PI_SELFLEARNING_DATA: join(root, "data"),
                        PI_SELFLEARNING_DB: join(root, "db", "selflearning.db"),
                        UNOWN_HOME: join(root, "unown-home"),
                };
                const tokenFile = join(root, "data", "engine.token");
                const upFile = join(root, "winner.up");
                let holder: ReturnType<typeof spawn> | null = null;
                try {
                        // 1. The winner: fixed port, writes the token (post-bind commit).
                        const wPath = join(root, "self-learning-winner.ts");
                        writeFileSync(wPath, winnerScript);
                        const winner = spawn(process.execPath, [wPath], { env: { ...env, PI_AGENT_PORT: String(port) } });
                        const d1 = Date.now() + 30_000;
                        while (Date.now() < d1 && !existsSync(upFile)) sleepSync(200);
                        expect(existsSync(upFile)).toBe(true);
                        const tokenBefore = readFileSync(tokenFile, "utf8").trim();
                        // 2. Kill the winner (flock released at exit) and immediately
                        //    rebind its port from a detached dummy holder. The kill is
                        //    AWAITED, not slept past: a SIGKILL'd-but-unreaped winner
                        //    still answers the pid-probe signal 0, so the victim would
                        //    see a LIVE lock holder and exit at the lock instead of ever
                        //    reaching the bind (measured red twice on macOS runners:
                        //    runs 39590930647 and 39603040411 — the fixed 500/700ms
                        //    sleeps were not enough under load). Awaiting the exit
                        //    event guarantees the reaping: the zombie is gone from the
                        //    process table before the victim reads the lock.
                        winner.kill("SIGKILL");
                        await new Promise<void>((resolve) => {
                                const deadline = setTimeout(resolve, 15_000); // never happen; belt and suspenders
                                winner.once("exit", () => {
                                        clearTimeout(deadline);
                                        resolve();
                                });
                        });
                        // The dummy holder is a plain node:net listener, NOT a second
                        // Bun.serve: bun sets SO_REUSEPORT on its listen sockets on
                        // macOS, so a second Bun.serve (the victim's engine boot)
                        // binds the SAME "held" port and boots — measured in release
                        // run 39607704033 (VICTIM=BOOTED-UNEXPECTED with holder.up
                        // present, i.e. the port genuinely held). A net.Server never
                        // sets SO_REUSEPORT, so the victim's bind fails with
                        // EADDRINUSE on every platform — the premise this test
                        // exists to exercise. Readiness is signalled via an up-file
                        // written from the 'listening' callback (post-bind, the
                        // winner's own pattern); a fixed sleep let the victim boot
                        // on macOS runners when the holder had not been scheduled
                        // yet (release run 39605199801).
                        const hPath = join(root, "holder.ts");
                        writeFileSync(hPath, `
const { writeFileSync } = await import("node:fs");
const net = await import("node:net");
const srv = net.createServer(() => {});
srv.listen(${port}, "127.0.0.1", () => {
        writeFileSync(${JSON.stringify(join(root, "holder.up"))}, "up");
});
`);
                        holder = spawn(process.execPath, [hPath], { stdio: "ignore" });
                        const d3 = Date.now() + 15_000;
                        while (Date.now() < d3 && !existsSync(join(root, "holder.up"))) sleepSync(100);
                        expect(existsSync(join(root, "holder.up"))).toBe(true);
                        // 3. The victim: lock stealable (winner dead), port held → the
                        //    bind fails; the token file must survive untouched.
                        const vPath = join(root, "victim.ts");
                        writeFileSync(vPath, victimScript);
                        const victim = spawnSync(process.execPath, [vPath], { env: { ...env, PI_AGENT_PORT: String(port) }, encoding: "utf8", timeout: 60_000 });
                        expect(victim.stdout).toContain("VICTIM=bind-failed");
                        expect(victim.stdout).toContain("TOKEN_INTACT=true");
                        expect(readFileSync(tokenFile, "utf8").trim()).toBe(tokenBefore);
                } finally {
                        holder?.kill("SIGKILL");
                        rmSync(root, { recursive: true, force: true });
                }
        }, 120_000);

        test("UNOWN_ENGINE_AUTH=off + widened bind refuses to boot", () => {
                const root = mkdtempSync(join(tmpdir(), "unown-auth-refuse-"));
                const script = `
const { startServer } = await import(${JSON.stringify(join(PKG_ROOT, "src/server.ts"))});
const server = startServer(0);
console.log("BOOT=" + (server === null ? "refused" : "booted"));
process.exit(0);
`;
                const probePath = join(root, "probe.ts");
                writeFileSync(probePath, script);
                const res = spawnSync(
                        process.execPath,
                        [probePath],
                        {
                                env: {
                                        ...process.env,
                                        PI_SELFLEARNING_DATA: join(root, "data"),
                                        PI_SELFLEARNING_DB: join(root, "db", "selflearning.db"),
                                        UNOWN_HOME: join(root, "unown-home"),
                                        UNOWN_ENGINE_AUTH: "off",
                                        UNOWN_ENGINE_HOST: "0.0.0.0",
                                },
                                encoding: "utf8",
                                timeout: 60_000,
                        },
                );
                const out = (res.stdout ?? "") + (res.stderr ?? "");
                expect(out).toContain("BOOT=refused");
                expect(out).toContain("UNOWN_ENGINE_AUTH=off");
                rmSync(root, { recursive: true, force: true });
        }, 90_000);
});
