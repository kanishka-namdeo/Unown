// Unit tests for the sandbox seed-path jail (audit MEDIUM-LOW-1) and crash
// recovery (LOW-2).
//
// ML-1: seedFiles used a bare startsWith(workspace) prefix check —
// resolve("/s/workspace", "../workspace-evil/x") = "/s/workspace-evil/x"
// which DOES start with "/s/workspace", so a crafted path wrote into a
// SIBLING directory, outside the OS jail (bwrap/seatbelt confines
// sandbox.workspace only) and invisible to snapshotFiles. Currently
// unreachable through mint.ts (which blocks ".." upstream) — this is the
// defense-in-depth layer, pinned directly.
//
// LOW-2: recoverOrphans now also heals dreams stuck 'running' (phantom
// in-flight dream on the dashboard) and tasks stuck 'validating' (invisible:
// active=0 with source_run_id set — the lesson silently lost).
import "./_env.ts";
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSandbox, seedFiles } from "../src/sandbox.ts";
import { recoverOrphans } from "../src/server.ts";
import { store } from "../src/store.ts";

describe("seedFiles boundary-aware jail (ML-1)", () => {
	test("in-workspace paths seed normally", () => {
		const sb = createSandbox("jail-ok");
		try {
			expect(() => seedFiles(sb, { "a.js": "x", "nested/dir/b.js": "y" })).not.toThrow();
			expect(readFileSync(join(sb.workspace, "a.js"), "utf8")).toBe("x");
			expect(readFileSync(join(sb.workspace, "nested/dir/b.js"), "utf8")).toBe("y");
		} finally {
			rmSync(sb.root, { recursive: true, force: true });
		}
	});

	test("REJECTED: a sibling directory sharing the workspace prefix (the old bare startsWith let this through)", () => {
		// resolve(workspace, "../workspace-evil/x.js") lives OUTSIDE the workspace
		// but its path starts with the workspace string — the exact ML-1 escape.
		const sb = createSandbox("jail-prefix");
		const sibling = join(join(sb.root, ".."), `${join("/", "workspace").split("/").pop()}-evil`);
		try {
			expect(() => seedFiles(sb, { "../workspace-evil/x.js": "pwn" })).toThrow(/escapes sandbox/);
			// And nothing was written outside the sandbox.
			expect(existsSync(join(sibling, "x.js"))).toBe(false);
		} finally {
			rmSync(sb.root, { recursive: true, force: true });
			rmSync(sibling, { recursive: true, force: true });
		}
	});

	test("REJECTED: a plain parent traversal", () => {
		const sb = createSandbox("jail-parent");
		try {
			expect(() => seedFiles(sb, { "../escape.js": "pwn" })).toThrow(/escapes sandbox/);
			expect(existsSync(join(sb.root, "escape.js"))).toBe(false);
		} finally {
			rmSync(sb.root, { recursive: true, force: true });
		}
	});
});

describe("recoverOrphans (LOW-2)", () => {
	test("heals orphaned runs, cycles, dreams and unvalidated minted tasks", () => {
		const runId = randomUUID();
		const cycleId = randomUUID();
		const dreamId = `dream-${randomUUID()}`;
		const taskId = `task-${randomUUID().slice(0, 8)}`;
		store.run(
			`INSERT INTO runs (id, task_id, kind, status, started_at) VALUES (?, ?, 'baseline', 'running', ?)`,
			[runId, taskId, Date.now()],
		);
		store.run(
			`INSERT INTO cycles (id, task_id, status, iteration, created_at) VALUES (?, ?, 'running', 1, ?)`,
			[cycleId, taskId, Date.now()],
		);
		store.run(`INSERT INTO dreams (id, started_at, status, notes_in) VALUES (?, ?, 'running', 3)`, [dreamId, Date.now()]);
		store.run(
			`INSERT INTO tasks (id, name, description, prompt, files, verify, status, active, source_run_id, created_at) VALUES (?, 'n', 'd', 'p', '{}', 'v', 'validating', 0, ?, ?)`,
			[taskId, runId, Date.now()],
		);

		recoverOrphans();

		expect(store.get(`SELECT status FROM runs WHERE id = ?`, [runId])!.status).toBe("error");
		expect(store.get(`SELECT status FROM cycles WHERE id = ?`, [cycleId])!.status).toBe("no-fix");
		const dream = store.get(`SELECT status, note FROM dreams WHERE id = ?`, [dreamId])!;
		expect(dream.status).toBe("error");
		expect(String(dream.note)).toContain("orphaned by service restart");
		// A task that never finished validating is discarded — visible and
		// consistent, not stuck-invisible with its lesson lost.
		expect(store.get(`SELECT status FROM tasks WHERE id = ?`, [taskId])!.status).toBe("discarded");

		// Idempotent: a second pass changes nothing.
		recoverOrphans();
		expect(store.get(`SELECT status FROM dreams WHERE id = ?`, [dreamId])!.status).toBe("error");
	});

	test("does not touch completed rows", () => {
		const dreamId = `dream-${randomUUID()}`;
		store.run(`INSERT INTO dreams (id, started_at, ended_at, status, notes_in) VALUES (?, ?, ?, 'finished', 3)`, [
			dreamId,
			Date.now(),
			Date.now(),
		]);
		recoverOrphans();
		expect(store.get(`SELECT status FROM dreams WHERE id = ?`, [dreamId])!.status).toBe("finished");
	});
});

