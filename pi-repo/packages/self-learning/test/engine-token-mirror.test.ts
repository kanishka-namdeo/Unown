// engine-token-mirror.test.ts — H6 (2026-10-26 hardening round): the
// cross-install token discovery pair (resilience.md R11, the binary↔source
// token split).
//
// A source checkout keeps its engine state under <repo>/data/self-learning;
// a standalone binary keeps its under $UNOWN_HOME/data/self-learning. A
// binary CLI probing a source-repo engine read its OWN data dir's token,
// got 401, and reported `blocked · token` forever. The fix: the engine
// mirrors its per-boot token to $UNOWN_HOME/engine.token (the one tree every
// install shape resolves identically), and the client resolves a PAIR — own
// data dir first, shared mirror as fallback — with the 401-retry lane
// re-presenting whichever side CHANGED.
//
// Conventions: the pair resolution is file-driven (write the two token files,
// invalidate, read — the engine-auth suite's existing pattern); engineFetch's
// retry is driven against an in-process Bun.serve endpoint that demands a
// chosen token.
import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        engineToken,
        engineTokenPath,
        engineTokenSource,
        invalidateEngineToken,
        sharedEngineTokenPath,
} from "../src/engine-auth.ts";
import { UNOWN_HOME } from "../src/term.ts";
import "./_env.ts";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

// H6 test hygiene (live-caught on the macOS CI leg): bun test runs every file
// in ONE process and the token cache/file pair is process-global state — a
// shared-mirror file left behind here makes LATER suites (dashboard-auth's
// "no token discoverable" case) see a discoverable token on platforms whose
// file order differs. Remove BOTH discovery sides when the file leaves.
afterAll(() => {
        rmSync(engineTokenPath(), { force: true });
        rmSync(sharedEngineTokenPath(), { force: true });
        invalidateEngineToken();
});

function writeOwn(token: string | null) {
        if (token === null) {
                rmSync(engineTokenPath(), { force: true });
        } else {
                mkdirSync(join(engineTokenPath(), ".."), { recursive: true });
                writeFileSync(engineTokenPath(), token, "utf8");
        }
}

function writeShared(token: string | null) {
        if (token === null) {
                rmSync(sharedEngineTokenPath(), { force: true });
        } else {
                mkdirSync(join(sharedEngineTokenPath(), ".."), { recursive: true });
                writeFileSync(sharedEngineTokenPath(), token, "utf8");
        }
}

describe("token pair resolution (H6)", () => {
        test("sharedEngineTokenPath resolves inside $UNOWN_HOME; engineTokenPath inside DATA_DIR — different install shapes agree on the shared one", () => {
                expect(sharedEngineTokenPath()).toBe(join(UNOWN_HOME, "engine.token"));
                expect(engineTokenPath()).not.toBe(sharedEngineTokenPath());
        });

        test("own data dir beats the shared mirror when both exist", () => {
                writeOwn(TOKEN_A);
                writeShared(TOKEN_B);
                invalidateEngineToken();
                expect(engineToken()).toBe(TOKEN_A);
                expect(engineTokenSource()).toBe("own");
        });

        test("the shared mirror serves discovery when the own data dir has no token (a binary CLI + source engine)", () => {
                writeOwn(null);
                writeShared(TOKEN_B);
                invalidateEngineToken();
                expect(engineToken()).toBe(TOKEN_B);
                expect(engineTokenSource()).toBe("shared");
        });

        test("no token anywhere resolves null (engine down, never booted)", () => {
                writeOwn(null);
                writeShared(null);
                invalidateEngineToken();
                expect(engineToken()).toBeNull();
                expect(engineTokenSource()).toBeNull();
        });

        test("a 401-retry re-read picks up a fresh own token (per-boot rotation — the pre-H6 behavior preserved)", () => {
                writeOwn(TOKEN_A);
                writeShared(null);
                invalidateEngineToken();
                expect(engineToken()).toBe(TOKEN_A);
                // Engine rebooted: own file rotated.
                writeOwn(TOKEN_B);
                invalidateEngineToken();
                expect(engineToken()).toBe(TOKEN_B);
        });
});

describe("engineFetch cross-install retry (H6)", () => {
        function serveWithRequiredToken(required: string): { port: number; close: () => Promise<void> } {
                const server = Bun.serve({
                        port: 0,
                        fetch(req) {
                                const auth = req.headers.get("authorization") ?? "";
                                if (auth !== `Bearer ${required}`) return new Response("no", { status: 401 });
                                return Response.json({ ok: true });
                        },
                });
                return { port: server.port, close: () => server.stop() };
        }

        test("own token STALE + shared mirror CURRENT: the 401 retry re-presents the shared token and succeeds (the R11 split healing)", async () => {
                // The running engine belongs to the OTHER install shape: it wrote the
                // shared mirror (TOKEN_B) but our own data dir still holds a stale
                // TOKEN_A from OUR engine's last boot.
                writeOwn(TOKEN_A);
                writeShared(TOKEN_B);
                invalidateEngineToken();
                const srv = serveWithRequiredToken(TOKEN_B);
                try {
                        const res = await (await import("../src/engine-auth.ts")).engineFetch(
                                `http://127.0.0.1:${srv.port}/api/overview`,
                        );
                        expect(res.status).toBe(200);
                        const body = await res.json();
                        expect(body.ok).toBe(true);
                } finally {
                        await srv.close();
                }
        });

        test("neither file changed: a second 401 is a genuine reject (the response flows back)", async () => {
                writeOwn(TOKEN_A);
                writeShared(null);
                invalidateEngineToken();
                const srv = serveWithRequiredToken(TOKEN_B); // demands a token we do not have
                try {
                        const res = await (await import("../src/engine-auth.ts")).engineFetch(
                                `http://127.0.0.1:${srv.port}/api/overview`,
                        );
                        expect(res.status).toBe(401);
                } finally {
                        await srv.close();
                }
        });
});
