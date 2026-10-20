// doctor.test.ts — the P1 SDLC-surface doctor checks (research R-c §2):
// `lsp-servers`, `mcp-config` (validation problems + the H2 project trust
// gate) and `unown-state` (checkpoint blobs / receipts / reviews disk usage).
//
// Spawn-level like test/cli/*: the REAL bin/unown, a private UNOWN_HOME per
// run, a private project cwd, the mock bridge for the chat path and the dead
// loopback engine URL — no live service is ever contacted.
//
// The doctor contract under test (docs/usage.md + AGENTS.md): the chat path
// is the ONLY hard fail — every new SDLC check is warn-class, so a broken or
// untrusted MCP/LSP/checkpoint surface never turns doctor's exit non-zero
// while chat works.
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockBridge, sweepTestRoots, unown, type UnownRunOptions } from "./cli/helpers.ts";

let bridge: ReturnType<typeof startMockBridge>;
const base = (extra: Partial<UnownRunOptions> = {}): UnownRunOptions => ({ bridge, ...extra });

beforeAll(() => {
        bridge = startMockBridge({ label: "doctor-sdlc" });
});
afterAll(() => {
        bridge?.close();
        sweepTestRoots();
});

/** A pre-created private root so fixtures can be written into projDir BEFORE
 * the run (runUnown re-mkdirs home/proj idempotently). */
function freshRoot(): { root: string; projDir: string } {
        const root = mkdtempSync(join(tmpdir(), "unown-doctor-test-"));
        const projDir = join(root, "proj");
        mkdirSync(projDir, { recursive: true });
        return { root, projDir };
}

function findCheck(stdout: string, id: string): { id: string; status: string; detail: string } {
        const parsed = JSON.parse(stdout) as { checks: Array<{ id: string; status: string; detail: string }> };
        const entry = parsed.checks.find((c) => c.id === id);
        expect(entry).toBeDefined();
        return entry!;
}

describe("doctor — SDLC surface checks (P1)", () => {
        test(
                "fresh project: the three new check ids are present; mcp-config + unown-state pass",
                async () => {
                        const run = await unown(["doctor", "--json"], base());
                        expect(run.exitCode).toBe(0); // warnings never fail doctor
                        const mcp = findCheck(run.stdout, "mcp-config");
                        expect(mcp.status).toBe("pass");
                        expect(mcp.detail).toContain("no servers configured");
                        const state = findCheck(run.stdout, "unown-state");
                        expect(state.status).toBe("pass");
                        expect(state.detail).toContain("no .unown state yet");
                        // PATH-dependent (CI images vary) — presence + a valid class only:
                        const lsp = findCheck(run.stdout, "lsp-servers");
                        expect(["pass", "warn"]).toContain(lsp.status);
                        // the schema itself is unchanged (additive ids only):
                        const parsed = JSON.parse(run.stdout);
                        expect(parsed.ok).toBe(true);
                        expect(parsed.summary.hardFail).toBe(false);
                        for (const c of parsed.checks) {
                                expect(typeof c.id).toBe("string");
                                expect(["pass", "warn", "fail"]).toContain(c.status);
                                expect(typeof c.detail).toBe("string");
                        }
                },
                30_000,
        );

        test(
                "untrusted project .unown/mcp.json → mcp-config WARN naming /mcp trust; chat still ready (exit 0)",
                async () => {
                        const { root, projDir } = freshRoot();
                        try {
                                mkdirSync(join(projDir, ".unown"), { recursive: true });
                                writeFileSync(join(projDir, ".unown", "mcp.json"), JSON.stringify({ mcpServers: { demo: { command: "node" } } }));
                                const run = await unown(["doctor", "--json"], base({ root }));
                                expect(run.exitCode).toBe(0); // warn-class: chat works
                                const mcp = findCheck(run.stdout, "mcp-config");
                                expect(mcp.status).toBe("warn");
                                expect(mcp.detail).toContain("/mcp trust");
                                expect(mcp.detail).toContain("1 withheld");
                                // Text mode carries the same verdict + the ready-to-chat line:
                                const text = await unown(["doctor"], base({ root }));
                                expect(text.exitCode).toBe(0);
                                expect(text.stdout).toContain("⚠ MCP config");
                                expect(text.stdout).toContain("✓ unown is ready to chat");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                60_000,
        );

        test(
                "garbage + invalid-entry project configs surface as actionable warnings (never crashes)",
                async () => {
                        const { root, projDir } = freshRoot();
                        try {
                                mkdirSync(join(projDir, ".unown"), { recursive: true });
                                writeFileSync(join(projDir, ".unown", "mcp.json"), "{ not json");
                                const garbage = await unown(["doctor", "--json"], base({ root }));
                                expect(garbage.exitCode).toBe(0);
                                const bad = findCheck(garbage.stdout, "mcp-config");
                                expect(bad.status).toBe("warn");
                                expect(bad.detail).toContain("invalid JSON");

                                writeFileSync(join(projDir, ".unown", "mcp.json"), JSON.stringify({ mcpServers: { broken: { nope: true } } }));
                                const shape = await unown(["doctor", "--json"], base({ root }));
                                expect(shape.exitCode).toBe(0);
                                const badShape = findCheck(shape.stdout, "mcp-config");
                                expect(badShape.status).toBe("warn");
                                expect(badShape.detail).toContain("mcpServers.broken"); // exact key + file
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                60_000,
        );

        test(
                "unown-state reports blob size + receipt/review counts and warns past UNOWN_STATE_WARN_BYTES",
                async () => {
                        const { root, projDir } = freshRoot();
                        try {
                                // 2 KiB blob + one receipt ledger + one review artifact:
                                const blobDir = join(projDir, ".unown", "checkpoints", "files", "ab");
                                mkdirSync(blobDir, { recursive: true });
                                writeFileSync(join(blobDir, "a".repeat(64)), "x".repeat(2048));
                                mkdirSync(join(projDir, ".unown", "receipts"), { recursive: true });
                                writeFileSync(join(projDir, ".unown", "receipts", "boot-1.jsonl"), '{"t":"session_start"}\n');
                                mkdirSync(join(projDir, ".unown", "reviews"), { recursive: true });
                                writeFileSync(join(projDir, ".unown", "reviews", "r-1.md"), "# review\n");

                                const pass = await unown(["doctor", "--json"], base({ root }));
                                expect(pass.exitCode).toBe(0);
                                const state = findCheck(pass.stdout, "unown-state");
                                expect(state.status).toBe("pass");
                                expect(state.detail).toContain("2 KiB");
                                expect(state.detail).toContain("1 receipt file(s)");
                                expect(state.detail).toContain("1 review(s)");

                                // Same 2 KiB with a 1 KiB threshold → the pruning warning:
                                const warn = await unown(["doctor", "--json"], base({ root, env: { UNOWN_STATE_WARN_BYTES: "1024" } }));
                                expect(warn.exitCode).toBe(0); // still warn-class
                                const warned = findCheck(warn.stdout, "unown-state");
                                expect(warned.status).toBe("warn");
                                expect(warned.detail).toContain("consider pruning old checkpoints");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                60_000,
        );

        test(
                "doctor table (text mode) renders the new rows",
                async () => {
                        const run = await unown(["doctor"], base());
                        expect(run.exitCode).toBe(0);
                        expect(run.stdout).toContain("LSP servers");
                        expect(run.stdout).toContain("MCP config");
                        expect(run.stdout).toContain("unown state");
                },
                30_000,
        );
});

describe("doctor — bridge route-default coherence (M0)", () => {
        test(
                "coherent route default (in the allow-list) → no warning",
                async () => {
                        const run = await unown(["doctor", "--json"], base());
                        expect(run.exitCode).toBe(0);
                        const parsed = JSON.parse(run.stdout) as { checks: Array<{ id: string; status: string }> };
                        const entry = parsed.checks.find((c) => c.id === "bridge-route-default-coherent");
                        // absent OR pass — the check only materialises when it can see /health
                        if (entry) expect(entry.status).toBe("pass");
                },
                30_000,
        );

        test(
                "stale BRIDGE_ROUTE_DEFAULT outside the allow-list → warn naming the fix (chat still exit 0)",
                async () => {
                        const incoherent = startMockBridge({
                                label: "doctor-route-default-stale",
                                // simulate a .env where BRIDGE_UPSTREAM_URL changed to a new
                                // provider but BRIDGE_ROUTE_DEFAULT stayed hard-coded:
                                healthDefaultModel: "kimi-k2.5",
                                healthModels: ["agnes-3.0-flash", "agnes-2.5-flash"],
                        });
                        try {
                                const run = await unown(["doctor", "--json"], base({ bridge: incoherent }));
                                expect(run.exitCode).toBe(0); // warn-class: chat works
                                const entry = findCheck(run.stdout, "bridge-route-default-coherent");
                                expect(entry.status).toBe("warn");
                                expect(entry.detail).toContain("kimi-k2.5");
                                expect(entry.detail).toContain("not in the allow-list");
                                expect(entry.detail).toContain("BRIDGE_ROUTE_DEFAULT");
                        } finally {
                                incoherent.close();
                        }
                },
                60_000,
        );
});
