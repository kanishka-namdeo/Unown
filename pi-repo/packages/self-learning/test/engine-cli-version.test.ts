/**
 * Unit tests for the M8 additions to src/engine-cli.ts — the pure pieces of
 * `unown engine restart` and `unown engine status`:
 *
 *   parseRestartFlags    the --force / --wait <ms> grammar (parseUpdateFlags
 *                        pattern — errors are strings, never throws)
 *   engineStaleMarker    the status UP line's ` — STALE (…)` suffix
 *   busyRefusalMessage   the busy-gate refusal copy (pinned exactly)
 *   humanizeDbBytes      the retention line's size rendering
 *
 * The drain/spawn flow of cmdRestart itself is reuse (cmdStop's HTTP-first
 * path + cmdStart's force-spawn tail) and is verified LIVE end-to-end
 * against a real engine on an ephemeral port (see the M8 worklog receipts):
 * boot → restart → new pid + fresh /api/version, busy-gate refusal mid-job,
 * and restart-on-down behaving as start.
 */
import "./_env.ts"; // MUST be the first import
import { describe, expect, test } from "bun:test";
import {
	busyRefusalMessage,
	engineStaleMarker,
	describeJobHealth,
	humanizeDbBytes,
	parseRestartFlags,
} from "../src/engine-cli.ts";
import type { EngineBuildComparison } from "../src/engine-version.ts";

const cmp = (verdict: EngineBuildComparison["verdict"]): EngineBuildComparison => ({ verdict, detail: "test" });

// ---------------------------------------------------------------------------
// parseRestartFlags
// ---------------------------------------------------------------------------

describe("parseRestartFlags", () => {
	test("no flags → force false, wait 0 (busy engine refuses immediately)", () => {
		expect(parseRestartFlags([])).toEqual({ flags: { force: false, waitMs: 0 } });
	});

	test("--force", () => {
		expect(parseRestartFlags(["--force"])).toEqual({ flags: { force: true, waitMs: 0 } });
	});

	test("--wait <ms> and --wait=<ms> both parse (space + equals forms)", () => {
		expect(parseRestartFlags(["--wait", "30000"]).flags.waitMs).toBe(30_000);
		expect(parseRestartFlags(["--wait=5000"]).flags.waitMs).toBe(5_000);
		expect(parseRestartFlags(["--force", "--wait", "1"]).flags).toEqual({ force: true, waitMs: 1 });
	});

	test("--wait with a missing value is an error, not NaN", () => {
		const r = parseRestartFlags(["--wait"]);
		expect(r.error).toContain("--wait");
		expect(r.flags.waitMs).toBe(0);
	});

	test("--wait with a negative or non-numeric value is an error", () => {
		expect(parseRestartFlags(["--wait", "-5"]).error).toContain("--wait");
		expect(parseRestartFlags(["--wait=abc"]).error).toContain("--wait");
	});

	test("unknown arguments are errors (clig.dev: usage, not a silent wizard)", () => {
		const r = parseRestartFlags(["--bogus"]);
		expect(r.error).toContain("unknown argument");
		expect(r.error).toContain("--bogus");
	});

	test("--help / -h short-circuits to the usage text", () => {
		expect(parseRestartFlags(["--help"]).help).toBe(true);
		expect(parseRestartFlags(["-h"]).help).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// engineStaleMarker — the status UP line suffix
// ---------------------------------------------------------------------------

describe("engineStaleMarker", () => {
	test("old-build / stale / ancient append the actionable STALE suffix", () => {
		for (const v of ["old-build", "stale", "ancient"] as const) {
			expect(engineStaleMarker(cmp(v), "2.2.0")).toBe(` — STALE (agent v2.2.0; restart: unown engine restart)`);
		}
	});

	test("fresh / ahead / unknown / no handshake render nothing", () => {
		expect(engineStaleMarker(cmp("fresh"), "2.2.0")).toBe("");
		expect(engineStaleMarker(cmp("ahead"), "2.2.0")).toBe("");
		expect(engineStaleMarker(cmp("unknown"), "2.2.0")).toBe("");
		expect(engineStaleMarker(undefined, "2.2.0")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// busyRefusalMessage — pinned exactly (it is the busy gate's whole output)
// ---------------------------------------------------------------------------

describe("busyRefusalMessage", () => {
	test("names the job, the elapsed seconds, and both ways out", () => {
		expect(busyRefusalMessage("auto-dream", 45_000)).toBe(
			"engine is mid-job 'auto-dream' (45s elapsed) — retry when idle, or: unown engine restart --force",
		);
	});

	test("sub-second busy still renders whole seconds", () => {
		expect(busyRefusalMessage("cycle", 200)).toContain("(0s elapsed)");
	});
});

// ---------------------------------------------------------------------------
// humanizeDbBytes — the retention line
// ---------------------------------------------------------------------------

describe("humanizeDbBytes", () => {
	test.each([
		[0, "0 KB"],
		[512, "1 KB"], // sub-KB sizes round up to 1 KB, never "0 KB" for a real file
		[512 * 1024, "512 KB"],
		[12 * 1024 * 1024 + 300 * 1024, "12.3 MB"],
		[1.5 * 1024 * 1024, "1.5 MB"],
	] as Array<[number, string]>)("%d bytes → %s", (bytes, expected) => {
		expect(humanizeDbBytes(bytes)).toBe(expected);
	});

	test("garbage input (NaN/negative) renders 0 KB, never NaN", () => {
		expect(humanizeDbBytes(Number.NaN)).toBe("0 KB");
		expect(humanizeDbBytes(-5)).toBe("0 KB");
		expect(humanizeDbBytes(undefined as unknown as number)).toBe("0 KB");
	});
});

// ---------------------------------------------------------------------------
// describeJobHealth — the M11 per-job verdict line. The jobs table only grew an
// OUTCOME column in M11, so this is the point at which `engine status` can
// honestly answer the "jobs" promise its own HELP has always made.
// ---------------------------------------------------------------------------
describe("describeJobHealth (M11)", () => {
	const job = (id: string, last_ok: number | null, enabled = 1) => ({ id, last_ok, enabled });

	test("an all-green loop prints nothing — a passing schedule is not news", () => {
		expect(describeJobHealth([job("harness-cycle", 1), job("auto-dream", 1)])).toBeNull();
	});

	test("a failed last run is named by job id", () => {
		expect(describeJobHealth([job("harness-cycle", 1), job("auto-dream", 0)])).toBe(
			"  jobs: 2 scheduled · 1 FAILED (auto-dream)",
		);
	});

	test("a never-run enabled job is reported as NEVER RAN, never laundered into fine", () => {
		expect(describeJobHealth([job("task-mint", null)])).toBe("  jobs: 1 scheduled · 1 never ran (task-mint)");
	});

	test("a DISABLED job that has never run is not a finding", () => {
		expect(describeJobHealth([job("task-mint", null, 0)])).toBeNull();
	});

	test("both findings appear in one line, failures first", () => {
		const line = describeJobHealth([job("auto-dream", 0), job("db-retention", 0), job("task-mint", null)]);
		expect(line).toBe("  jobs: 3 scheduled · 2 FAILED (auto-dream, db-retention) · 1 never ran (task-mint)");
	});

	test("an empty job list is its own finding — never seeded is not 'all green'", () => {
		expect(describeJobHealth([])).toBe("  jobs: none scheduled (the router has not seeded)");
	});
});
