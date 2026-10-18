// UNOWN_HOME="" regression tests — the fresh-clone state-dir bug.
//
// Reproduction (fixed 2026-10-19): `cp .env.example .env` ships
// `UNOWN_HOME=` (empty). bun auto-loads the repo-root .env into every
// `bin/unown` run (and scripts/start.ts exports it to every child), so
// process.env.UNOWN_HOME was "" — NOT undefined. The old `?? join(homedir(),
// ".unown")` fallback only catches null/undefined, so the empty string won:
// `join("", "agent")` = "agent", a CWD-RELATIVE state dir. Symptom on a
// fresh clone: `unown setup` / `unown doctor` seeded ./agent/ and ./memory/
// into whatever directory the CLI happened to run from (observed live on a
// fresh clone; doctor printed "agent dir — agent" and "user memory —
// /memory/user.md").
//
// What is pinned here:
//   1. unit: resolveUnownHome (term.ts) + unownHome (update.ts) treat "" as
//      unset and fall back to the real home; a non-empty value still wins.
//   2. spawn: the REAL bin/unown doctor, run with UNOWN_HOME="" in its env
//      and a redirected HOME, seeds state under <fake-home>/.unown — and
//      creates NO agent/ dir in the process cwd.
//
// Spawn-level like golden.test.ts: real bin/unown, private temp root, mock
// bridge (doctor's endpoint probe must go somewhere healthy so the run
// exits 0 and the assertion is about WHERE state lives, not doctor
// semantics).
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveUnownHome } from "../../src/term.ts";
import { unownHome } from "../../src/update.ts";
import { startMockBridge, sweepTestRoots, unown, type MockBridge } from "./helpers.ts";

const LONG = { timeout: 120_000 } as const; // spawned CLI runs take seconds

let bridge: MockBridge;

beforeAll(() => {
	bridge = startMockBridge();
});

afterAll(() => {
	bridge?.close();
	sweepTestRoots();
});

describe("resolveUnownHome / unownHome — empty string means unset", () => {
	test("'' falls back to the real home (term.ts)", () => {
		expect(resolveUnownHome({ UNOWN_HOME: "" })).toBe(join(homedir(), ".unown"));
	});

	test("'' falls back to the real home (update.ts)", () => {
		expect(unownHome({ UNOWN_HOME: "" })).toBe(join(homedir(), ".unown"));
	});

	test("undefined falls back to the real home", () => {
		expect(resolveUnownHome({})).toBe(join(homedir(), ".unown"));
	});

	test("a real value wins (no behavior change for configured users)", () => {
		expect(resolveUnownHome({ UNOWN_HOME: "/tmp/my-state" })).toBe("/tmp/my-state");
		expect(unownHome({ UNOWN_HOME: "/tmp/my-state" })).toBe("/tmp/my-state");
	});
});

describe("bin/unown with UNOWN_HOME=\"\" (the fresh-clone .env shape)", () => {
	test(
		"doctor seeds state under the real home, not a cwd-relative agent/",
		async () => {
			// HOME is redirected so "the real home" is a private dir we own.
			// USERPROFILE covers win32 (node's homedir() reads it first there);
			// HOME covers POSIX. Both set = same behavior on all three CI legs.
			const fakeHome = join(realpathSync(tmpdir()), `unown-empty-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
			mkdirSync(join(fakeHome), { recursive: true });

			const run = await unown(["doctor"], {
				bridge,
				env: {
					UNOWN_HOME: "", // the .env.example value, verbatim
					HOME: fakeHome,
					USERPROFILE: fakeHome,
				},
			});

			// Doctor may exit 0 or 1 (engine warnings are non-fatal); the
			// assertion is about the state dir, not doctor classification.
			expect(run.exitCode).toBeGreaterThanOrEqual(0);

			// The bug: state landed in the PROCESS CWD (projDir/agent).
			expect(existsSync(join(run.projDir, "agent"))).toBe(false);
			expect(existsSync(join(run.projDir, "memory"))).toBe(false);

			// The fix: state landed under the (redirected) real home.
			expect(existsSync(join(fakeHome, ".unown", "agent", "models.json"))).toBe(true);
			// And doctor reported that path.
			expect(run.stdout).toContain(join(fakeHome, ".unown"));

			run.release();
		},
		LONG,
	);
});
