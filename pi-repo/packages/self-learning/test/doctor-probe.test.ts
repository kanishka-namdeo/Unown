/**
 * doctor-probe.test.ts — pins the composition the doctor/setup probe must
 * use: `resolveProviderKey` (auth.json > models.json > $ENV) feeding
 * `probeOpenAiEndpoint`. Regression: the doctor probed with models.json's
 * `apiKey` field alone, but setup stores keys in auth.json (mode 0600) —
 * the probe went out with NO Authorization header and healthy endpoints
 * were misreported as "credentials rejected (HTTP 401)" (found live:
 * doctor failed on a working Agnes install while real chat runs succeeded).
 *
 * The contract pinned here: for the ACTIVE provider, the key
 * `resolveProviderKey` returns is exactly the Authorization header an
 * endpoint demands — proving doctor/setup's new probe path authenticates.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveActiveProvider, probeOpenAiEndpoint } from "../src/probe.ts";
import { resolveProviderKey } from "../src/providers.ts";

const DIR = mkdtempSync(join(tmpdir(), "unown-doctor-probe-"));

// models.json WITHOUT apiKey (setup writes real keys to auth.json, 0600) —
// the exact shape that used to send a header-less probe.
writeFileSync(
        join(DIR, "models.json"),
        JSON.stringify({
                providers: {
                        agnes: { name: "Agnes AI", baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", models: [{ id: "agnes-3.0-flash" }] },
                },
        }),
);
// auth.json carries the key (the AuthStorage shape).
writeFileSync(join(DIR, "auth.json"), JSON.stringify({ agnes: { type: "api_key", key: "cpk-doctor-probe-secret" } }));

let server: ReturnType<typeof Bun.serve> | null = null;
let seenAuthorization: string | null = null;
let requests = 0;

beforeAll(() => {
        server = Bun.serve({
                port: 0,
                fetch(req) {
                        requests++;
                        seenAuthorization = req.headers.get("authorization");
                        if (seenAuthorization !== "Bearer cpk-doctor-probe-secret") {
                                return new Response(JSON.stringify({ error: "bad key" }), { status: 401 });
                        }
                        return Response.json({ data: [{ id: "agnes-3.0-flash" }] });
                },
        });
});

afterAll(() => {
        server?.stop(true);
        rmSync(DIR, { recursive: true, force: true });
});

describe("doctor/setup probe key composition (auth.json feeds the probe)", () => {
        test("the active provider resolves (agnes) even with no models.json apiKey", () => {
                const active = resolveActiveProvider(DIR);
                expect(active?.id).toBe("agnes");
                expect(active?.apiKey).toBeUndefined(); // the trap: models.json carries no key
        });

        test("resolveProviderKey returns the auth.json key — the single source", () => {
                const { key, source } = resolveProviderKey(DIR, "agnes");
                expect(key).toBe("cpk-doctor-probe-secret");
                expect(source).toBe("auth-json");
        });

        test("the composition authenticates: probe with the resolved key gets 200 + models", async () => {
                const active = resolveActiveProvider(DIR);
                expect(active).toBeTruthy();
                const base = `http://127.0.0.1:${server!.port}/v1`;
                // Exactly the doctor path: resolveProviderKey(...).key feeds the probe.
                const probe = await probeOpenAiEndpoint(base, resolveProviderKey(DIR, active!.id).key, 2000);
                expect(probe.ok).toBe(true);
                expect(probe.status).toBe(200);
                expect(probe.models).toEqual(["agnes-3.0-flash"]);
                expect(seenAuthorization).toBe("Bearer cpk-doctor-probe-secret");
        });

        test("the OLD path (models.json apiKey alone) would have sent no header — the bug, pinned", async () => {
                const active = resolveActiveProvider(DIR);
                const base = `http://127.0.0.1:${server!.port}/v1`;
                const probe = await probeOpenAiEndpoint(base, active!.apiKey ?? undefined, 2000);
                expect(probe.ok).toBe(false);
                expect(probe.problem).toBe("auth"); // 401 — what doctor used to report on a healthy endpoint
                expect(requests).toBeGreaterThanOrEqual(2);
        });
});
