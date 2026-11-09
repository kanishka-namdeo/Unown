// setup-catalog.test.ts — the 2026-11-09 catalog fix's pin. The non-interactive
// setup lane (`unown setup --provider P --model M --api-key K …`) used to write
// models.json with EXACTLY ONE model while its own success output listed the
// endpoint's full catalog ("endpoint reachable — serves a, b, c…"). /model,
// --model, subagent fallbackModels and --plan-model could never resolve a
// sibling model without a manual models.json edit — the interactive wizard
// registered the discovered list (setup.ts "dialog &&" guard), the flag lane
// did not.
//
// Pin: the flag lane probes the endpoint and registers the discovered catalog
// alongside the chosen model (chosen first), with best-effort specs for the
// extras — same contract the bridge preset has had since M4.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNOWN_AGENT_DIR } from "../src/term.ts";
import { runSetupCommand } from "../src/setup.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-setup-catalog-"));

afterAll(() => {
        try {
                rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

/** Snapshot + restore every file the setup command may touch in the shared
 * test agent dir — the suite's UNOWN_HOME is shared, so a lane test must
 * never leak its provider records into the neighbors' view. */
const STATE_FILES = ["models.json", "settings.json", "auth.json"] as const;
let snapshots: Array<{ path: string; bytes: Buffer | null }> = [];

beforeAll(() => {
        mkdirSync(UNOWN_AGENT_DIR, { recursive: true });
        snapshots = STATE_FILES.map((name) => {
                const path = join(UNOWN_AGENT_DIR, name);
                return { path, bytes: existsSync(path) ? readFileSync(path) : null };
        });
});

afterAll(() => {
        for (const snap of snapshots) {
                if (snap.bytes === null) {
                        try {
                                rmSync(snap.path, { force: true });
                        } catch {
                                /* absent already */
                        }
                } else {
                        writeFileSync(snap.path, snap.bytes);
                }
        }
});

function discoveryServer(ids: string[], key = "cpk-test-1"): { port: number; stop: () => void } {
        const server = Bun.serve({
                port: 0,
                fetch(req) {
                        if (req.headers.get("authorization") !== `Bearer ${key}`) {
                                return new Response("nope", { status: 401 });
                        }
                        return Response.json({ data: ids.map((id) => ({ id })) });
                },
        });
        return { port: server.port, stop: () => server.stop(true) };
}

describe("non-interactive setup registers the discovered catalog", () => {
        test("the flag lane writes the chosen model plus every discovered sibling", async () => {
                const srv = discoveryServer(["m-a", "m-b", "m-c", "embed-1"]);
                try {
                        const code = await runSetupCommand([
                                "--provider",
                                "agnes",
                                "--base-url",
                                `http://127.0.0.1:${srv.port}/v1`,
                                "--api-key",
                                "cpk-test-1",
                                "--model",
                                "m-a",
                                "--context-window",
                                "262144",
                                "--max-tokens",
                                "16384",
                        ]);
                        expect(code).toBe(0);

                        const modelsPath = join(UNOWN_AGENT_DIR, "models.json");
                        expect(existsSync(modelsPath)).toBe(true);
                        const parsed = JSON.parse(readFileSync(modelsPath, "utf-8"));
                        const provider = parsed.providers?.agnes;
                        expect(provider).toBeDefined();
                        const ids = provider.models.map((m: any) => m.id);
                        // chosen model first, discovered chat-model extras after it; the
                        // embed-class id is filtered like the wizard's own list
                        expect(ids[0]).toBe("m-a");
                        expect(ids).toContain("m-b");
                        expect(ids).toContain("m-c");
                        // the chosen model keeps the user's explicit specs
                        expect(provider.models[0]).toMatchObject({ contextWindow: 262144, maxTokens: 16384 });
                        // the extras get the conservative default spec (best-effort lane)
                        const extra = provider.models.find((m: any) => m.id === "m-b");
                        expect(extra).toMatchObject({ contextWindow: 131072, maxTokens: 8192 });
                        // settings defaults point at the chosen model
                        const settings = JSON.parse(readFileSync(join(UNOWN_AGENT_DIR, "settings.json"), "utf-8"));
                        expect(settings.defaultProvider).toBe("agnes");
                        expect(settings.defaultModel).toBe("m-a");
                } finally {
                        srv.stop();
                }
        });

        test("an unreachable endpoint still writes the single chosen model (keyless-local shape)", async () => {
                // --force: the previous test's merged records must not leak into this
                // pin's view (setup MERGES by default — the deterministic single-model
                // shape needs the reset lane).
                const code = await runSetupCommand([
                        "--provider",
                        "agnes",
                        "--base-url",
                        "http://127.0.0.1:9/v1", // nothing listens here
                        "--api-key",
                        "cpk-test-1",
                        "--model",
                        "solo-model",
                        "--context-window",
                        "131072",
                        "--max-tokens",
                        "8192",
                        "--force",
                ]);
                expect(code).toBe(0);
                const parsed = JSON.parse(readFileSync(join(UNOWN_AGENT_DIR, "models.json"), "utf-8"));
                const ids = parsed.providers.agnes.models.map((m: any) => m.id);
                expect(ids).toEqual(["solo-model"]);
        });
});
