// End-user combo round (2026-11-10) — the CLI craft pins.
//
// Pins the round's error-craft contracts, each the audit's finding:
//   B3  `unown models <typo>` exits 2 with a did-you-mean instead of the
//       silent overview fallthrough (a script could not detect the wrong lane).
//   B1  `unown note --help` prints the note page (the root HELP used to be
//       the only surface) and empty-note exits 2 (usage class, clig.dev).
//   B4  `unown -p` with no prompt exits 2 (usage class) — not the generic 1.
//   B2  `unown repomap <non-git>` exits 1 — a script can detect the missing
//       map (was exit 0, masking the failure).
//       `unown help models` / `unown help note` resolve to real pages.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startMockBridge, sweepTestRoots, unown, type MockBridge } from "./helpers.ts";

const LONG = { timeout: 120_000 } as const;

let bridge: MockBridge;

beforeAll(() => {
	bridge = startMockBridge();
});
afterAll(() => {
	bridge.close();
	sweepTestRoots();
});

describe("models subcommand typo guard", () => {
	test(
		"`models verifyn` exits 2 with a did-you-mean, never the overview",
		async () => {
			const run = await unown(["models", "verifyn"], { bridge, timeoutMs: 30_000 });
			try {
				expect(run.exitCode).toBe(2);
				expect(run.stderr).toContain('unown models: unknown subcommand "verifyn"');
				expect(run.stderr).toContain("did you mean: unown models verify?");
				expect(run.stderr).toContain("unown help models");
				// The old bug: the typo silently printed the models overview
				// (stdout full of provider lines) with exit 0.
				expect(run.stdout).not.toContain("Served right now");
			} finally {
				run.release();
			}
		},
		LONG,
	);

	test(
		"bare `models` still prints the overview (the default lane is untouched)",
		async () => {
			const run = await unown(["models"], { bridge, timeoutMs: 30_000 });
			try {
				expect(run.exitCode).toBe(0);
			} finally {
				run.release();
			}
		},
		LONG,
	);
});

describe("note lane help + usage exit", () => {
	test(
		"`note --help` prints the note page (exit 0)",
		async () => {
			const run = await unown(["note", "--help"], { bridge, timeoutMs: 30_000 });
			try {
				expect(run.exitCode).toBe(0);
				expect(run.stdout).toContain("unown note — hand a session note to the learning engine");
				expect(run.stdout).toContain('usage: unown note "something worth remembering"');
			} finally {
				run.release();
			}
		},
		LONG,
	);

	test(
		"`note` with no text exits 2 with the usage line",
		async () => {
			const run = await unown(["note"], { bridge, timeoutMs: 30_000 });
			try {
				expect(run.exitCode).toBe(2);
				expect(run.stderr).toContain("usage: unown note");
			} finally {
				run.release();
			}
		},
		LONG,
	);
});

describe("print-mode no-prompt exit class", () => {
	test(
		"`-p` with no prompt exits 2 (usage), not 1",
		async () => {
			const run = await unown(["-p"], { bridge, timeoutMs: 30_000 });
			try {
				expect(run.exitCode).toBe(2);
				expect(run.stderr).toContain("no prompt given");
			} finally {
				run.release();
			}
		},
		LONG,
	);
});

describe("repomap exit honesty", () => {
	test(
		"`repomap <non-git dir>` exits 1 — the missing map is detectable",
		async () => {
			const run = await unown(["repomap", "."], { bridge, timeoutMs: 30_000 });
			try {
				// The harness's private projDir is not a git repository.
				expect(run.exitCode).toBe(1);
				expect(run.stdout).toContain("Not a git repository");
			} finally {
				run.release();
			}
		},
		LONG,
	);
});

describe("help pages for the new surfaces", () => {
	test(
		"`help models` resolves the models page",
		async () => {
			const run = await unown(["help", "models"], { bridge, timeoutMs: 30_000 });
			try {
				expect(run.exitCode).toBe(0);
				expect(run.stdout).toContain("unown models — the registered models");
			} finally {
				run.release();
			}
		},
		LONG,
	);

	test(
		"`help note` resolves the note page",
		async () => {
			const run = await unown(["help", "note"], { bridge, timeoutMs: 30_000 });
			try {
				expect(run.exitCode).toBe(0);
				expect(run.stdout).toContain("unown note — hand a session note");
			} finally {
				run.release();
			}
		},
		LONG,
	);
});
