/**
 * Unit tests for src/engine-version.ts — the M8 agent↔engine version-skew
 * handshake: the pure compareEngineBuild classifier (every verdict), the
 * codeMtimeMs shape detection + fallbacks, the duration humanizer, and the
 * engine-side /api/version handler (via handleApi direct — the suite's
 * established pattern; the HTTP auth wrapper is pinned by engine-auth.test.ts).
 *
 * compareEngineBuild is PURE (clock injected), so the whole verdict table is
 * pinned without a live engine; the rule order (unknown → ahead/stale →
 * old-build → needrestart → ancient promotion) is the M8 design contract
 * every surface (footer, /engine, doctor, engine status) shares.
 */
import "./_env.ts"; // MUST be the first import
import { describe, expect, test } from "bun:test";
import {
	ANCIENT_BUILD_MS,
	agentVersion,
	codeMtimeMs,
	compareEngineBuild,
	engineVersionInfo,
	formatDuration,
	type EngineBuildAgent,
	type EngineBuildRef,
} from "../src/engine-version.ts";
import { handleApi } from "../src/server.ts";

const NOW = 1_800_000_000_000; // fixed clock — every case injects it

/** A matching agent/engine pair by default; each case overrides one axis. */
function agent(over: Partial<EngineBuildAgent> = {}): EngineBuildAgent {
	return { version: "2.1.0", gitSha: "abc1234", codeMtimeMs: NOW - 3600_000, ...over };
}
function engine(over: Partial<EngineBuildRef> = {}): EngineBuildRef {
	return { version: "2.1.0", gitSha: "abc1234", bootedAt: NOW - 1800_000, ...over };
}

// ---------------------------------------------------------------------------
// compareEngineBuild — the full verdict table (priority order)
// ---------------------------------------------------------------------------

describe("compareEngineBuild (M8 skew classifier)", () => {
	test("fresh: same version, same sha, engine booted after the code landed", () => {
		const r = compareEngineBuild(agent(), engine(), NOW);
		expect(r.verdict).toBe("fresh");
		expect(r.detail).toContain("engine v2.1.0");
		expect(r.detail).toContain("agent v2.1.0");
	});

	test("fresh: both shas null (compiled/binary shape) with matching versions", () => {
		const r = compareEngineBuild(agent({ gitSha: null }), engine({ gitSha: null }), NOW);
		expect(r.verdict).toBe("fresh");
	});

	test("old-build: same semver, different shas (the multiple-pushes-per-day dev case)", () => {
		const r = compareEngineBuild(agent({ gitSha: "aaaaaaa" }), engine({ gitSha: "bbbbbbb" }), NOW);
		expect(r.verdict).toBe("old-build");
		expect(r.detail).toContain("same version");
		expect(r.detail).toContain("aaaaaaa");
		expect(r.detail).toContain("bbbbbbb");
		expect(r.detail).toContain("unown engine restart");
	});

	test("old-build does NOT fire when the agent's sha is unknown (hot-path shape)", () => {
		const r = compareEngineBuild(agent({ gitSha: null }), engine({ gitSha: "bbbbbbb" }), NOW);
		expect(r.verdict).toBe("fresh"); // falls through to the boot rule
	});

	test("stale: engine on an older semver (minor behind)", () => {
		const r = compareEngineBuild(agent({ version: "2.2.0" }), engine({ version: "2.1.0" }), NOW);
		expect(r.verdict).toBe("stale");
		expect(r.detail).toContain("engine v2.1.0 is older than agent v2.2.0");
		expect(r.detail).toContain("unown engine restart");
	});

	test("ahead: engine on a newer semver — the fix is on the agent side", () => {
		const r = compareEngineBuild(agent({ version: "2.1.0" }), engine({ version: "2.2.0" }), NOW);
		expect(r.verdict).toBe("ahead");
		expect(r.detail).toContain("unown update");
	});

	test("ancient: engine a whole major version behind", () => {
		const r = compareEngineBuild(agent({ version: "3.0.0" }), engine({ version: "2.1.0" }), NOW);
		expect(r.verdict).toBe("ancient");
	});

	test("ancient: booted more than 7 days before the current build (the days-old engine)", () => {
		const r = compareEngineBuild(
			agent({ version: "2.1.0", codeMtimeMs: NOW }),
			engine({ version: "2.1.0", bootedAt: NOW - ANCIENT_BUILD_MS - 1 }),
			NOW,
		);
		expect(r.verdict).toBe("ancient");
		expect(r.detail).toContain("far behind");
	});

	test("stale-not-ancient: booted before the build but inside the 7-day window", () => {
		const r = compareEngineBuild(
			agent({ version: "2.1.0", codeMtimeMs: NOW }),
			engine({ version: "2.1.0", bootedAt: NOW - 3 * 24 * 60 * 60 * 1000 }),
			NOW,
		);
		expect(r.verdict).toBe("stale");
	});

	test("unknown: engine missing entirely (no /api/version block)", () => {
		const r = compareEngineBuild(agent(), undefined, NOW);
		expect(r.verdict).toBe("unknown");
		expect(r.detail).toContain("predates version reporting");
		expect(r.detail).toContain("unown engine restart");
	});

	test("unknown: engine answers but reports no version (empty/absent field)", () => {
		expect(compareEngineBuild(agent(), {} as EngineBuildRef, NOW).verdict).toBe("unknown");
		expect(compareEngineBuild(agent(), { version: "" }, NOW).verdict).toBe("unknown");
	});

	test("needrestart rule: same strings + same sha but booted BEFORE the code landed → stale", () => {
		const r = compareEngineBuild(agent({ codeMtimeMs: NOW }), engine({ bootedAt: NOW - 1 }), NOW);
		expect(r.verdict).toBe("stale");
		expect(r.detail).toContain("booted before the current build");
		expect(r.detail).toContain("unown engine restart");
	});

	test("needrestart rule does not fire when the agent's code anchor is unknown (0)", () => {
		const r = compareEngineBuild(agent({ codeMtimeMs: 0 }), engine({ bootedAt: NOW - 90 * 24 * 60 * 60 * 1000 }), NOW);
		expect(r.verdict).toBe("fresh"); // no anchor, no rule — never guess skew
	});

	test("non-semver differing strings: any difference is stale (never ahead)", () => {
		const r = compareEngineBuild(agent({ version: "2.1.0" }), engine({ version: "unknown" }), NOW);
		expect(r.verdict).toBe("stale");
	});

	test("semver-equal but differently spelled versions (v-prefix) fall through to the sha rules", () => {
		const r = compareEngineBuild(agent({ version: "2.1.0" }), engine({ version: "v2.1.0" }), NOW);
		expect(r.verdict).toBe("fresh"); // not skew — same version, same sha, booted after the build
	});
});

// ---------------------------------------------------------------------------
// codeMtimeMs — shape detection + the 0 fallbacks
// ---------------------------------------------------------------------------

describe("codeMtimeMs (the needrestart anchor)", () => {
	test("checkout shape: the ROOT package.json's mtime", () => {
		const mtime = codeMtimeMs({ compiled: false, packageJson: "/no/such/file-anywhere" }); // missing → 0
		expect(mtime).toBe(0);
		const stat = (p: string) => ({ mtimeMs: p.length * 1000 }); // injectable, content-derived
		expect(codeMtimeMs({ compiled: false, packageJson: "/tmp/pkg.json", stat })).toBe("/tmp/pkg.json".length * 1000);
	});

	test("compiled shape: process.execPath's mtime", () => {
		const stat = (p: string) => ({ mtimeMs: p === "/opt/unown" ? 12345 : 0 });
		expect(codeMtimeMs({ compiled: true, execPath: "/opt/unown", stat })).toBe(12345);
	});

	test("a throwing stat is 0, never a crash (missing file, permissions, exotic fs)", () => {
		const boom = () => {
			throw new Error("ENOENT");
		};
		expect(codeMtimeMs({ compiled: false, packageJson: "/gone", stat: boom })).toBe(0);
		expect(codeMtimeMs({ compiled: true, execPath: "/gone", stat: boom })).toBe(0);
	});

	test("the real default anchors on the actual checkout (non-zero in this repo)", () => {
		// The suite runs from a real checkout — the root package.json exists.
		expect(codeMtimeMs()).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// formatDuration — the uptime/booted-age humanizer (6 days must not be 8640m)
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
	test.each([
		[0, "0m0s"],
		[45_000, "0m45s"],
		[90_000, "1m30s"],
		[59 * 60_000 + 59_000, "59m59s"],
		[3 * 3600_000 + 12 * 60_000, "3h 12m"],
		[23 * 3600_000 + 59 * 60_000, "23h 59m"],
		[6 * 86400_000, "6d 0h 0m"], // the live bug: this used to render as 8640m0s
		[6 * 86400_000 + 4 * 3600_000 + 20 * 60_000, "6d 4h 20m"],
	] as Array<[number, string]>)("%d ms → %s", (ms, expected) => {
		expect(formatDuration(ms)).toBe(expected);
	});

	test("negative durations clamp to zero (clock skew must not print -5m)", () => {
		expect(formatDuration(-5_000)).toBe("0m0s");
	});
});

// ---------------------------------------------------------------------------
// agentVersion / engineVersionInfo — the shared version source of truth
// ---------------------------------------------------------------------------

describe("agentVersion + engineVersionInfo", () => {
	test("agentVersion never returns a literal (packaging.ts contract)", () => {
		const v = agentVersion();
		expect(typeof v).toBe("string");
		expect(v.length).toBeGreaterThan(0);
		expect(v).not.toBe("0.1");
	});

	test("engineVersionInfo exposes the handshake block shape", () => {
		const info = engineVersionInfo();
		expect(typeof info.version).toBe("string");
		expect(info.version).toBe(agentVersion()); // same source of truth — no drift
		expect(info.api).toBe(1);
		expect(typeof info.bootedAt).toBe("number");
		expect(info.bootedAt).toBeGreaterThan(0);
		expect(typeof info.pid).toBe("number");
		expect(info.uptimeMs).toBeGreaterThanOrEqual(0);
		// gitSha is a short sha or null — never a full hash, never a garbage string
		expect(info.gitSha === null || /^[0-9a-f]{7,12}$/.test(info.gitSha)).toBe(true);
	});

	test("engineVersionInfo's bootedAt is stable across calls (one boot stamp)", () => {
		const a = engineVersionInfo();
		const b = engineVersionInfo();
		expect(b.bootedAt).toBe(a.bootedAt);
		expect(b.uptimeMs).toBeGreaterThanOrEqual(a.uptimeMs);
	});
});

// ---------------------------------------------------------------------------
// /api/version — the endpoint (handleApi direct; the M7 gate is above it)
// ---------------------------------------------------------------------------

describe("GET/HEAD /api/version (handleApi)", () => {
	async function getVersion(method: "GET" | "HEAD") {
		const res = await handleApi({ method, path: "/api/version", query: new URLSearchParams(), body: null });
		return { status: res.status, body: method === "HEAD" ? null : await res.json() };
	}

	test("GET returns the handshake block: ok, version, api 1", async () => {
		const { status, body } = await getVersion("GET");
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.api).toBe(1);
		expect(body.version).toBe(agentVersion());
		expect(typeof body.bootedAt).toBe("number");
		expect(body.pid).toBe(process.pid);
		expect(typeof body.uptimeMs).toBe("number");
	});

	test("HEAD answers too (a bare liveness/version poll needs no body)", async () => {
		const { status } = await getVersion("HEAD");
		expect(status).toBe(200);
	});

	test("the version block agrees with /api/overview's (one source of truth)", async () => {
		const version = await getVersion("GET");
		const overview = await handleApi({ method: "GET", path: "/api/overview", query: new URLSearchParams(), body: null });
		const ob = await overview.json();
		expect(overview.status).toBe(200);
		expect(ob.version.version).toBe(version.body.version);
		expect(ob.version.bootedAt).toBe(version.body.bootedAt);
		expect(ob.retention).toBeDefined();
		expect(typeof ob.retention.dbBytes).toBe("number");
		expect(ob.retention.dbBytes).toBeGreaterThanOrEqual(0);
		// the layer literal is gone — the agent block renders the real version
		expect(ob.agent.layer).toBe(`self-learning v${agentVersion()}`);
	});
});
