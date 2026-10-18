// CLI tests for the doctor PATH-shadowing check (D4 audit gap 5) and the
// local crash record (gap 4). Multi-install shadowing is Unown's OWN
// observed failure mode (the E2E suite once re-pointed the shim at a
// throwaway clone and "unown" kept silently being that one) — doctor
// previously had no way to see it.
//
// The shadow is forced deterministically via UNOWN_BIN_DIR: findShims
// scans exactly that dir when set (uninstall.ts shimCandidateDirs).
import "../_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockBridge, sweepTestRoots, unown, type UnownRunOptions } from "./helpers.ts";
import { writeCrashRecord } from "../../src/crash.ts";

let bridge: ReturnType<typeof startMockBridge>;

/**
 * Write a FOREIGN shim into dir (the file name AND the target-reference
 * dialect must match the platform: Windows shims are unown.cmd/unown.ps1
 * with backslash paths, POSIX shims are `unown` with exec + forward
 * slashes — see uninstall.ts shimTarget).
 */
function writeForeignShim(dir: string): string {
	if (process.platform === "win32") {
		const p = join(dir, "unown.cmd");
		writeFileSync(p, '@"bun" "D:\\definitely\\another\\checkout\\bin\\unown" %*\r\n');
		return p;
	}
	const p = join(dir, "unown");
	writeFileSync(p, '#!/bin/sh\nexec "bun" "/definitely/another/checkout/bin/unown" "$@"\n', { mode: 0o755 });
	return p;
}

const base = (extra: Partial<UnownRunOptions> = {}): UnownRunOptions => ({ bridge, ...extra });

beforeAll(() => {
	bridge = startMockBridge({ label: "doctor-shadow" });
});
afterAll(() => {
	bridge?.close();
	sweepTestRoots();
});

describe("doctor PATH-shim shadowing check", () => {
	test("a FOREIGN shim first in the candidate dir is reported as shadowed (warn, chat unaffected)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "shadow-shim-"));
		try {
			writeForeignShim(dir);
			const run = await unown(["doctor"], base({ env: { UNOWN_BIN_DIR: dir } }));
			expect(run.exitCode).toBe(0); // warn-level: chat still works
			expect(run.stdout).toContain("shadowed:");
			expect(run.stdout).toContain("definitely"); // the foreign target's path appears
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("no shim at all is a PASS (running from the repo checkout directly)", async () => {
		const run = await unown(["doctor"], base({ env: { UNOWN_BIN_DIR: mkdtempSync(join(tmpdir(), "no-shim-")) } }));
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("PATH shim");
		expect(run.stdout).not.toContain("shadowed:");
	});

	test("--json carries the check id in the DoctorCheck[] schema", async () => {
		const dir = mkdtempSync(join(tmpdir(), "shadow-json-"));
		try {
			writeForeignShim(dir);
			const run = await unown(["doctor", "--json"], base({ env: { UNOWN_BIN_DIR: dir } }));
			expect(run.exitCode).toBe(0);
			const parsed = JSON.parse(run.stdout);
			const entry = parsed.checks.find((c: any) => c.id === "path-shim");
			expect(entry).toBeDefined();
			expect(entry.status).toBe("warn");
			expect(entry.detail).toContain("shadowed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("local crash record (zero-telemetry crash reporting)", () => {
	test("writeCrashRecord writes a sanitized record: version, platform, error — NO argv, NO env", () => {
		const home = mkdtempSync(join(tmpdir(), "crash-home-"));
		try {
			const p = writeCrashRecord(new Error("boom: the thing exploded"), { home });
			expect(p).toBeTruthy();
			const rec = JSON.parse(readFileSync(p!, "utf8"));
			expect(rec.error.message).toBe("boom: the thing exploded");
			expect(rec.version).toMatch(/^\d+\.\d+\.\d+$/);
			expect(rec.platform).toContain(process.platform);
			expect(rec.note).toContain("nothing was sent anywhere");
			// privacy contract: no argv, no environment in the record
			expect(rec.argv).toBeUndefined();
			expect(rec.env).toBeUndefined();
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("writeCrashRecord never throws (a crashing crash-logger must not mask the original error)", () => {
		// an unwritable home -> null, not a throw. A path UNDER a plain file
		// (ENOTDIR) fails identically on every platform — /proc/* is writable
		// on Windows runners (resolves to <drive>\proc\...), which the first
		// version of this test learned the hard way.
		const blocker = join(tmpdir(), `crash-blocker-${Date.now()}`);
		writeFileSync(blocker, "a file, not a dir");
		try {
			const p = writeCrashRecord(new Error("x"), { home: join(blocker, "sub") });
			expect(p).toBeNull();
		} finally {
			rmSync(blocker, { force: true });
		}
	});
});
