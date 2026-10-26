// outbox-deadletter.test.ts — H1 (2026-10-26 hardening round): the outbox's
// bounded-retry dead-letter lane.
//
// Pre-hardening, a note file whose ingest kept failing was retried every
// drain pass forever, silently — readOutboxNotes() SKIPPED unparseable
// entries entirely, and a throwing ingest left the file queued with no
// counter and no record. The hardening adds: per-file attempt tracking in
// notes/outbox-state.json, a notes/dead/ terminal lane with a .reason.txt
// sidecar (files are NEVER deleted — manual recovery is an `mv` back), and
// the dead count in outboxStats().
//
// Conventions: the file-lane helpers are pure fs operations tested in-process
// (the _env.ts preload isolates UNOWN_HOME); the ingest-THROWS lane runs in a
// fresh subprocess (the store singleton is closed to poison the lane — the
// same fresh-process-probe pattern outbox.test.ts uses for the cap).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { syncNoteOutbox } from "../src/outbox.ts";
import {
	clearOutboxAttempts,
	deadLetterOutboxNote,
	OUTBOX_MAX_ATTEMPTS,
	outboxStats,
	recordOutboxAttempt,
	UNOWN_NOTES_DEAD_DIR,
	UNOWN_NOTES_DIR,
	UNOWN_OUTBOX_DIR,
	writeOutboxNote,
} from "../src/term.ts";
import "./_env.ts";

const MARKER = `dl-${Date.now()}`;

/** Clean scratch under the (already test-redirected) notes dir. */
function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "unown-deadletter-"));
	return dir;
}

describe("outbox dead-letter (H1): file-lane helpers", () => {
	test("OUTBOX_MAX_ATTEMPTS defaults to 5 and accepts the env override shape", () => {
		// The suite leaves UNOWN_OUTBOX_MAX_ATTEMPTS unset — the documented default.
		expect(OUTBOX_MAX_ATTEMPTS).toBe(5);
	});

	test("deadLetterOutboxNote moves the file to notes/dead/, writes the reason sidecar, counts it — and never deletes the note", () => {
		const dir = scratch();
		try {
			const notePath = join(UNOWN_OUTBOX_DIR, `1000-${MARKER}-probe.md`);
			writeFileSync(notePath, `---\nproject: /tmp/probe\nts: 1\n---\nnote body`, "utf8");
			const before = outboxStats();
			const ok = deadLetterOutboxNote(notePath, "ingest failed 5x: probe reason");
			expect(ok).toBe(true);
			// The file MOVED — the outbox no longer queues it...
			expect(readdirSync(UNOWN_OUTBOX_DIR).includes(basename(notePath))).toBe(false);
			// ...the dead dir holds BOTH the note and the reason sidecar...
			const deadNames = readdirSync(UNOWN_NOTES_DEAD_DIR);
			expect(deadNames.includes(basename(notePath))).toBe(true);
			expect(deadNames.includes(`${basename(notePath)}.reason.txt`)).toBe(true);
			// ...the note BODY survives verbatim (never deleted)...
			expect(readFileSync(join(UNOWN_NOTES_DEAD_DIR, basename(notePath)), "utf8")).toContain("note body");
			// ...and the reason sidecar carries the reason.
			expect(readFileSync(join(UNOWN_NOTES_DEAD_DIR, `${basename(notePath)}.reason.txt`), "utf8")).toContain(
				"probe reason",
			);
			// The stats count grew by exactly one dead file.
			expect(outboxStats().dead).toBe(before.dead + 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(join(UNOWN_NOTES_DEAD_DIR, `1000-${MARKER}-probe.md`), { force: true });
			rmSync(join(UNOWN_NOTES_DEAD_DIR, `1000-${MARKER}-probe.md.reason.txt`), { force: true });
		}
	});

	test("recordOutboxAttempt counts per file, carries the last error, and clearOutboxAttempts cleans the entry", () => {
		const dir = scratch();
		const stateFile = join(UNOWN_NOTES_DIR, "outbox-state.json");
		const name = `2000-${MARKER}-attempts.md`;
		try {
			const n1 = recordOutboxAttempt(join(UNOWN_OUTBOX_DIR, name), "boom one");
			const n2 = recordOutboxAttempt(join(UNOWN_OUTBOX_DIR, name), "boom two");
			expect(n1).toBe(1);
			expect(n2).toBe(2);
			const state = JSON.parse(readFileSync(stateFile, "utf8"));
			expect(state.attempts[name].n).toBe(2);
			expect(state.attempts[name].lastError).toBe("boom two");
			clearOutboxAttempts(join(UNOWN_OUTBOX_DIR, name));
			const after = JSON.parse(readFileSync(stateFile, "utf8"));
			expect(after.attempts[name]).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("outbox dead-letter (H1): the drain worklist sees unparseable files", () => {
	test("an unparseable outbox file is dead-lettered immediately (it can never succeed on retry)", () => {
		const dir = scratch();
		const name = `3000-${MARKER}-garbage.md`;
		const path = join(UNOWN_OUTBOX_DIR, name);
		try {
			// Valid .md extension, INVALID frontmatter — readOutboxNotes skips it,
			// the H1 worklist must still see it and dead-letter it on first sight.
			writeFileSync(path, "this is not a note: no frontmatter at all\n", "utf8");
			const before = outboxStats().dead;
			syncNoteOutbox();
			expect(readdirSync(UNOWN_OUTBOX_DIR).includes(name)).toBe(false);
			expect(readdirSync(UNOWN_NOTES_DEAD_DIR).includes(name)).toBe(true);
			expect(readFileSync(join(UNOWN_NOTES_DEAD_DIR, `${name}.reason.txt`), "utf8")).toContain(
				"unparseable outbox file",
			);
			expect(outboxStats().dead).toBe(before + 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(join(UNOWN_NOTES_DEAD_DIR, name), { force: true });
			rmSync(join(UNOWN_NOTES_DEAD_DIR, `${name}.reason.txt`), { force: true });
		}
	});

	test("a GOOD note next to a garbage one still ingests + archives in the same pass", () => {
		const dir = scratch();
		const goodName = `3100-${MARKER}-good.md`;
		const badName = `3101-${MARKER}-bad.md`;
		try {
			const beforeQueued = outboxStats().queued;
			writeOutboxNote({
				content: `good note ${MARKER} same-pass`,
				projectPath: "/tmp/deadletter-good",
				ts: Date.now(),
			});
			writeFileSync(join(UNOWN_OUTBOX_DIR, badName), "garbage without frontmatter", "utf8");
			const ingested = syncNoteOutbox();
			expect(ingested).toBeGreaterThanOrEqual(1);
			// The good note archived...
			expect(
				readdirSync(UNOWN_OUTBOX_DIR)
					.filter((n) => n.endsWith(".md"))
					.includes(badName),
			).toBe(false);
			expect(readdirSync(UNOWN_NOTES_DEAD_DIR).includes(badName)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(join(UNOWN_NOTES_DEAD_DIR, badName), { force: true });
			rmSync(join(UNOWN_NOTES_DEAD_DIR, `${badName}.reason.txt`), { force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// The ingest-THROWS lane: a fresh subprocess with a CLOSED store (the singleton
// cannot be closed in-process without breaking the rest of the suite).
// ---------------------------------------------------------------------------

function runPoisonedDrainProbe(maxAttempts: string): { code: number; out: any; stderr: string } {
	const root = mkdtempSync(join(tmpdir(), "unown-poison-drain-"));
	const script = `
import { closeSync, openSync, readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
// Fresh process → fresh module graph → fresh singleton store on a scratch DB.
process.env.PI_SELFLEARNING_DB ??= ${JSON.stringify(join(root, "db.sqlite"))};
process.env.PI_SELFLEARNING_DATA ??= ${JSON.stringify(join(root, "data"))};
process.env.UNOWN_HOME = ${JSON.stringify(join(root, "unown-home"))};
process.env.UNOWN_OUTBOX_MAX_ATTEMPTS = ${JSON.stringify(maxAttempts)};
process.env.UNOWN_ENGINE_URL = "http://127.0.0.1:9";
process.env.NO_UPDATE_NOTIFIER = "1";
const { store } = await import(${JSON.stringify(join(import.meta.dir.slice(0, -5), "src/store.ts"))});
const { writeOutboxNote, outboxStats, UNOWN_OUTBOX_DIR, UNOWN_NOTES_DEAD_DIR } = await import(${JSON.stringify(join(import.meta.dir.slice(0, -5), "src/term.ts"))});
const { syncNoteOutbox } = await import(${JSON.stringify(join(import.meta.dir.slice(0, -5), "src/outbox.ts"))});
// Seed the schema the same way the suite's _env does NOT need to (store opens
// the DB and migrations run on construction). Then write ONE note and CLOSE
// the store so every ingest attempt throws.
writeOutboxNote({ content: "poison probe note", projectPath: "/tmp/poison-proj", ts: Date.now() });
store.close();
let passes = 0;
for (;;) {
	syncNoteOutbox();
	passes++;
	const dead = existsSync(UNOWN_NOTES_DEAD_DIR) ? readdirSync(UNOWN_NOTES_DEAD_DIR).filter((n) => n.endsWith(".md")) : [];
	if (dead.length > 0 || passes > 20) break;
}
const dead = existsSync(UNOWN_NOTES_DEAD_DIR) ? readdirSync(UNOWN_NOTES_DEAD_DIR).filter((n) => n.endsWith(".md")) : [];
const queued = readdirSync(UNOWN_OUTBOX_DIR).filter((n) => n.endsWith(".md"));
const stats = outboxStats();
console.log("POISON_RESULT=" + JSON.stringify({ passes, deadCount: dead.length, deadNames: dead, queued: queued.length, stats }));
`;
	const probePath = join(root, "probe.ts");
	writeFileSync(probePath, script);
	const res = spawnSync(process.execPath, [probePath], { encoding: "utf8", timeout: 60_000 });
	rmSync(root, { recursive: true, force: true });
	const m = (res.stdout ?? "").match(/POISON_RESULT=(\{.*\})/s);
	return { code: res.status ?? -1, out: m ? JSON.parse(m[1]) : null, stderr: res.stderr ?? "" };
}

describe("outbox dead-letter (H1): a poisoned ingest lane dead-letters after the attempt budget", () => {
	test("UNOWN_OUTBOX_MAX_ATTEMPTS=3: the file moves to dead/ on the 3rd failing pass, reason records the failures", () => {
		const r = runPoisonedDrainProbe("3");
		expect(r.code).toBe(0);
		expect(r.out).not.toBeNull();
		expect(r.out.passes).toBe(3); // dead-lettered exactly on the budget pass
		expect(r.out.deadCount).toBe(1);
		expect(r.out.queued).toBe(0); // nothing left fighting in the outbox
		expect(r.out.stats.dead).toBe(1);
	}, 30_000);

	test("default budget (unset): 5 passes before the dead lane", () => {
		const r = runPoisonedDrainProbe("");
		expect(r.code).toBe(0);
		expect(r.out.passes).toBe(5);
		expect(r.out.deadCount).toBe(1);
	}, 30_000);
});
