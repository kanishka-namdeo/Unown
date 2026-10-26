// engine-pid-recovery.test.ts — H5 (2026-10-26 hardening round): the Windows
// spawn lane's pidfile recovery poll.
//
// The win32 detach lane (`cmd /c start /b`, the bun#31603 escape hatch) never
// learned the engine's pid: cmd.exe exits right after `start` returns, so the
// pidfile was never written on that branch and `engine status`/`engine stop`
// were Windows-blind. The recovery polls the engine (HTTP — the probe
// taxonomy's own source of truth) after the spawn and writes the pidfile from
// /api/overview's pid. The loop is injectable (probe/writePid/sleep seams) so
// the unit suite drives it without spawning anything — the same seam style as
// the spawn-circuit tests.
import { describe, expect, test } from "bun:test";
import type { EngineProbe } from "../src/engine-probe.ts";
import { recoverWindowsEnginePid } from "../src/engine-supervisor.ts";
import "./_env.ts";

function probeOf(kind: EngineProbe["kind"], pid?: number): EngineProbe {
	return {
		kind,
		endpoint: "http://127.0.0.1:3030",
		banner: false,
		detail: "unit stub",
		body: pid !== undefined ? { pid } : undefined,
	};
}

describe("recoverWindowsEnginePid (H5)", () => {
	test("writes the pidfile as soon as the engine answers ok with a pid", async () => {
		const written: number[] = [];
		const verdict = await recoverWindowsEnginePid({
			probe: async () => probeOf("ok", 4242),
			writePid: (pid) => written.push(pid),
			sleep: async () => {},
		});
		expect(verdict).toEqual({ wrotePid: true, pid: 4242, attempts: 1 });
		expect(written).toEqual([4242]);
	});

	test("retries refusals until the engine comes up (the restart window)", async () => {
		const written: number[] = [];
		const kinds: EngineProbe["kind"][] = ["refused", "refused", "refused", "ok"];
		let calls = 0;
		const sleeps: number[] = [];
		const verdict = await recoverWindowsEnginePid({
			probe: async () => probeOf(kinds[Math.min(calls++, kinds.length - 1)], calls >= 4 ? 777 : undefined),
			writePid: (pid) => written.push(pid),
			stepMs: 5,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
		});
		expect(verdict.wrotePid).toBe(true);
		expect(verdict.pid).toBe(777);
		expect(verdict.attempts).toBe(4);
		expect(written).toEqual([777]);
		expect(sleeps.length).toBe(3); // slept between the three refusals
	});

	test("gives up at the deadline without writing anything (a boot slower than the bound)", async () => {
		const written: number[] = [];
		const verdict = await recoverWindowsEnginePid({
			probe: async () => probeOf("refused"),
			writePid: (pid) => written.push(pid),
			stepMs: 5,
			deadlineMs: 20,
			sleep: async () => {},
		});
		expect(verdict.wrotePid).toBe(false);
		expect(written).toEqual([]);
	});

	test("stops polling on a foreign/occupied port (never waits on someone else's engine)", async () => {
		const written: number[] = [];
		let calls = 0;
		const verdict = await recoverWindowsEnginePid({
			probe: async () => {
				calls++;
				return probeOf("unauthorized");
			},
			writePid: (pid) => written.push(pid),
			sleep: async () => {},
		});
		expect(verdict.wrotePid).toBe(false);
		expect(calls).toBe(1); // unauthorized is terminal — no further polls
		expect(written).toEqual([]);
	});

	test("a writePid throw never escapes (best effort — probing stays authoritative)", async () => {
		const verdict = await recoverWindowsEnginePid({
			probe: async () => probeOf("ok", 1234),
			writePid: () => {
				throw new Error("EBUSY: pidfile held");
			},
			sleep: async () => {},
		});
		expect(verdict.wrotePid).toBe(true); // the pid WAS recovered; only the write failed
	});

	test("ok WITHOUT a numeric pid keeps polling (a non-engine listener answered)", async () => {
		let calls = 0;
		const verdict = await recoverWindowsEnginePid({
			probe: async () => {
				calls++;
				return probeOf("ok", undefined);
			},
			writePid: () => {},
			stepMs: 1,
			deadlineMs: 10,
			sleep: async () => {},
		});
		expect(verdict.wrotePid).toBe(false);
		expect(calls).toBeGreaterThan(1);
	});
});
