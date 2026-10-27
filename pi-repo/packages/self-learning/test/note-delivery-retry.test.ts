// note-delivery-retry.test.ts — H2 (2026-10-26 hardening round): the ONE
// bounded network retry a note POST gets before the outbox fallback.
//
// The engine-restart window (`unown engine restart`, an update's
// stop-then-start, the supervisor's crash backoff) is exactly long enough for
// a session-shutdown note to miss once — pre-hardening that note outboxed and
// waited for the 5-minute note-sync drain even though the engine came back
// 600ms later. The Letta client contract (bounded retries with backoff
// before the durable fallback) is the precedent.
//
// Conventions: globalThis.fetch is mocked (the outbox suite's delivery-test
// pattern); the probe POST to /api/overview is answered with a throw (the
// engine is "down" for the probe) while the /api/notes POST decides per call
// count — first refusal, then acceptance.
//
// Parallel-race hardening (2026-10-28): `bun test` runs files in parallel,
// and a foreign file's outbox write can land inside this test's ~600ms mock
// window — suite noise (background note-sync against a mocked or dead fetch)
// made the "no new outbox file" assertion fail three release/CI runs (the
// v0.0.32 ubuntu release, the live-preview round's ubuntu CI + release) on
// files this test never wrote. The outbox filename embeds the note's own
// project slug (writeOutboxNote: `<ts>-<uuid>-<slug>.md`), so every
// assertion and the cleanup key on THIS test's slug: the bug each test
// guards (its own note hitting the outbox) still fails it; a foreign
// parallel write never does, and the cleanup never deletes one.
import { describe, expect, test } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deliverTerminalNote, UNOWN_OUTBOX_DIR } from "../src/term.ts";
import "./_env.ts";

const MARKER = `retry-${Date.now()}`;

/** rm every outbox file that appeared since `before` FOR ONE PROJECT SLUG
 * (delivery tests clean up after themselves — scoped so a parallel file's
 * note is never another test's collateral). */
function cleanupNewOutboxFiles(before: string[], slug: string): void {
	const beforeSet = new Set(before);
	let names: string[] = [];
	try {
		names = readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.endsWith(`-${slug}.md`) && !beforeSet.has(f));
	} catch {
		/* no dir */
	}
	for (const n of names) rmSync(join(UNOWN_OUTBOX_DIR, n), { force: true });
}

function beforeOutboxFiles(): string[] {
	try {
		return readdirSync(UNOWN_OUTBOX_DIR);
	} catch {
		return [];
	}
}

describe("note delivery retry (H2)", () => {
	test("a NETWORK failure that heals within the retry window delivers to the engine — no outbox file", async () => {
		const realFetch = globalThis.fetch;
		const noteCalls: number[] = [];
		globalThis.fetch = (async (url: any, init: any) => {
			const u = String(url);
			if (u.endsWith("/api/overview")) throw new Error("probe: connection refused (engine restarting)");
			if (u.endsWith("/api/notes")) {
				noteCalls.push(Date.now());
				if (noteCalls.length === 1) throw new Error("post: connection refused (engine restarting)");
				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			throw new Error(`unexpected fetch: ${u}`);
		}) as any;
		const beforeFiles = beforeOutboxFiles();
		try {
			const result = await deliverTerminalNote({
				content: `retry probe ${MARKER}`,
				projectPath: "/tmp/retry-proj",
				ts: Date.now(),
			});
			expect(result.delivered).toBe(true);
			expect(result.via).toBe("engine");
			expect(result.detail).toBe("delivered on retry");
			expect(noteCalls.length).toBe(2); // exactly ONE retry — never a third attempt
			// The note never touched the outbox.
			// Slug-scoped: this note hitting the outbox fails the test; a
				// parallel file's write is not this test's verdict.
				const after = readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.endsWith("-retry-proj.md") && !new Set(beforeFiles).has(f));
			expect(after).toEqual([]);
		} finally {
			globalThis.fetch = realFetch;
			cleanupNewOutboxFiles(beforeFiles, "retry-proj");
		}
	});

	test("a network failure that STAYS down outboxes exactly once (the retry did not duplicate the durable write)", async () => {
		const realFetch = globalThis.fetch;
		let postCalls = 0;
		globalThis.fetch = (async (url: any) => {
			const u = String(url);
			if (u.endsWith("/api/overview")) throw new Error("probe: connection refused");
			if (u.endsWith("/api/notes")) {
				postCalls++;
				throw new Error("post: connection refused");
			}
			throw new Error(`unexpected fetch: ${u}`);
		}) as any;
		const beforeFiles = beforeOutboxFiles();
		try {
			const result = await deliverTerminalNote({
				content: `retry-stays-down probe ${MARKER}`,
				projectPath: "/tmp/retry-stays-down",
				ts: Date.now(),
			});
			expect(result.delivered).toBe(false);
			expect(result.via).toBe("outbox");
			expect(result.detail).toContain("retry");
			expect(postCalls).toBe(2); // initial + ONE retry
			// Slug-scoped: the durable write happened exactly once — this note's
				// file; a parallel file's write is not this test's verdict.
				const after = readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.endsWith("-retry-stays-down.md") && !new Set(beforeFiles).has(f));
			expect(after).toHaveLength(1); // the durable write happened exactly once
		} finally {
			globalThis.fetch = realFetch;
			cleanupNewOutboxFiles(beforeFiles, "retry-stays-down");
		}
	});

	test("an HTTP ERROR STATUS is never retried — an answering engine is a deliberate response", async () => {
		const realFetch = globalThis.fetch;
		let postCalls = 0;
		globalThis.fetch = (async (url: any) => {
			const u = String(url);
			if (u.endsWith("/api/overview")) return new Response("{}", { status: 200 });
			if (u.endsWith("/api/notes")) {
				postCalls++;
				return new Response(JSON.stringify({ error: "note rejected" }), { status: 413 });
			}
			throw new Error(`unexpected fetch: ${u}`);
		}) as any;
		const beforeFiles = beforeOutboxFiles();
		try {
			const result = await deliverTerminalNote({
				content: `status-no-retry probe ${MARKER}`,
				projectPath: "/tmp/status-no-retry",
				ts: Date.now(),
			});
			expect(result.delivered).toBe(false);
			expect(result.via).toBe("outbox");
			expect(result.detail).toBe("engine responded 413");
			expect(postCalls).toBe(1); // NO retry on an HTTP status
		} finally {
			globalThis.fetch = realFetch;
			cleanupNewOutboxFiles(beforeFiles, "status-no-retry");
		}
	});
});
