// update-status.test.ts — the pure update-state layer: cache/prefs schemas,
// notice and footer decisions, stale/rate rules, and the single-flight locks.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireUpdateLock,
	type DerivedUpdateStatus,
	deriveUpdateStatus,
	describeAge,
	formatUpdateSize,
	isUpdateLocked,
	parseSnoozeDuration,
	readUpdateCheckCache,
	readUpdatePrefs,
	recordNotice,
	shouldRefresh,
	UPDATE_CHECK_TTL_MS,
	type UpdateCheckCache,
	type UpdatePrefs,
	updateCheckPath,
	updateChipLine,
	updateNoticeLines,
	updatePrefsPath,
	writeUpdateCheckCache,
	writeUpdatePrefs,
} from "../src/update-status.ts";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const TMP = mkdtempSync(join(tmpdir(), "unown-update-status-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function cache(overrides: Partial<UpdateCheckCache> = {}): UpdateCheckCache {
	return {
		schema: 2,
		checkedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
		current: "0.0.1",
		mode: "binary",
		platform: "linux-x64",
		latest: "0.0.2",
		applicable: true,
		severity: "normal",
		notesUrl: "https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.2",
		asset: { name: "unown-linux-x64.tar.gz", sha256: "a".repeat(64), size: 2 * 1024 * 1024 },
		signature: "verified",
		...overrides,
	};
}

function prefs(overrides: Partial<UpdatePrefs> = {}): UpdatePrefs {
	return { schema: 1, ...overrides };
}

function status(
	input: { cache?: UpdateCheckCache | null; prefs?: UpdatePrefs; mode?: "binary" | "checkout"; version?: string } = {},
): DerivedUpdateStatus {
	const mode = input.mode ?? "binary";
	const version = input.version ?? "0.0.1";
	return deriveUpdateStatus({
		cache: input.cache === undefined ? cache({ mode }) : input.cache,
		prefs: input.prefs ?? prefs(),
		install: { mode, version, ...(mode === "binary" ? { platform: "linux-x64" as const } : {}) },
		now: NOW,
	});
}

function notice(
	input: {
		cache?: UpdateCheckCache | null;
		prefs?: UpdatePrefs;
		mode?: "binary" | "checkout";
		version?: string;
		uiMode?: "tui" | "print";
		env?: NodeJS.ProcessEnv;
		outputIsTty?: boolean;
	} = {},
): string[] | null {
	const s = status(input);
	return updateNoticeLines({
		status: s,
		env: input.env ?? {},
		outputIsTty: input.outputIsTty ?? true,
		mode: input.uiMode,
		now: NOW,
	});
}

describe("deriveUpdateStatus", () => {
	test("a newer applicable binary release is live", () => {
		const s = status();
		expect(s.newer).toBe(true);
		expect(s.applicable).toBe(true);
		expect(s.stale).toBe(false);
		expect(s.skipped).toBe(false);
		expect(s.snoozed).toBe(false);
		expect(s.security).toBe(false);
	});

	test("a skipped version and a live snooze are separate states", () => {
		expect(status({ prefs: prefs({ skippedVersion: "0.0.2" }) }).skipped).toBe(true);
		expect(status({ prefs: prefs({ snoozeUntil: new Date(NOW + 60_000).toISOString() }) }).snoozed).toBe(true);
		expect(status({ prefs: prefs({ snoozeUntil: new Date(NOW - 60_000).toISOString() }) }).snoozed).toBe(false);
	});

	test("a current/mode/platform mismatch is stale", () => {
		expect(status({ cache: cache({ current: "0.0.0" }) }).stale).toBe(true);
		expect(status({ cache: cache({ mode: "checkout" }) }).stale).toBe(true);
		expect(status({ cache: cache({ platform: "windows-x64" }) }).stale).toBe(true);
	});

	test("an old cache is stale but a 1h cache is not", () => {
		expect(status({ cache: cache({ checkedAt: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() }) }).stale).toBe(
			true,
		);
		expect(status().stale).toBe(false);
	});

	test("an error is not applicable", () => {
		expect(status({ cache: cache({ error: "network" }) }).applicable).toBe(false);
	});

	test("security and required floors set security without blocking", () => {
		expect(status({ cache: cache({ severity: "security" }) }).security).toBe(true);
		const required = status({ cache: cache({ requiredMinimumVersion: "0.0.2" }) });
		expect(required.required).toBe(true);
		expect(required.security).toBe(true);
		expect(required.applicable).toBe(true);
	});
});

describe("updateNoticeLines", () => {
	test("binary notice is two lines and includes the platform/size", () => {
		const lines = notice();
		expect(lines).not.toBeNull();
		expect(lines?.[0]).toContain("update available: unown 0.0.1 → 0.0.2 (linux-x64, 2.0 MiB)");
		expect(lines?.[1]).toContain("run `unown update`");
		expect(lines?.[1]).toContain("/releases/tag/v0.0.2");
	});

	test("a new version shows immediately; the same version is capped at 24h", () => {
		expect(
			notice({ prefs: prefs({ lastNoticeVersion: "0.0.1", lastNoticeAt: new Date(NOW - 1000).toISOString() }) }),
		).not.toBeNull();
		expect(
			notice({
				prefs: prefs({
					lastNoticeVersion: "0.0.2",
					lastNoticeAt: new Date(NOW - 23 * 60 * 60 * 1000).toISOString(),
				}),
			}),
		).toBeNull();
		expect(
			notice({
				prefs: prefs({
					lastNoticeVersion: "0.0.2",
					lastNoticeAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(),
				}),
			}),
		).not.toBeNull();
	});

	test("security updates have a 12h window and a distinct label", () => {
		const security = status({ cache: cache({ severity: "security" }) });
		expect(updateNoticeLines({ status: security, env: {}, outputIsTty: true, now: NOW })?.[0]).toContain(
			"security update:",
		);
		const capped = updateNoticeLines({
			status: deriveUpdateStatus({
				cache: cache({
					severity: "security",
					checkedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
				}),
				prefs: prefs({
					lastNoticeVersion: "0.0.2",
					lastNoticeAt: new Date(NOW - 11 * 60 * 60 * 1000).toISOString(),
				}),
				install: { mode: "binary", version: "0.0.1", platform: "linux-x64" },
				now: NOW,
			}),
			env: {},
			outputIsTty: true,
			now: NOW,
		});
		expect(capped).toBeNull();
	});

	test("checkout shows once per version, only on a clean main checkout", () => {
		const checkout = (overrides: Partial<UpdateCheckCache> = {}) =>
			cache({
				mode: "checkout",
				platform: undefined,
				headBranch: "main",
				headTag: null,
				dirty: false,
				ahead: 0,
				...overrides,
			});
		const lines = notice({ cache: checkout(), mode: "checkout" });
		expect(lines?.[0]).toContain("(source checkout)");
		expect(lines?.[1]).toContain("exit this session");
		expect(notice({ cache: checkout(), mode: "checkout", prefs: prefs({ lastNoticeVersion: "0.0.2" }) })).toBeNull();
		expect(notice({ cache: checkout({ headBranch: "feature/x" }), mode: "checkout" })).toBeNull();
		expect(notice({ cache: checkout({ dirty: true }), mode: "checkout" })).toBeNull();
		expect(notice({ cache: checkout({ ahead: 2 }), mode: "checkout" })).toBeNull();
	});

	test("suppressions: print, non-TTY, CI, opt-outs, subagent", () => {
		expect(notice({ uiMode: "print" })).toBeNull();
		expect(notice({ outputIsTty: false })).toBeNull();
		expect(notice({ env: { CI: "true" } })).toBeNull();
		expect(notice({ env: { NO_UPDATE_NOTIFIER: "" } })).toBeNull();
		expect(notice({ env: { UNOWN_DISABLE_AUTOUPDATE: "1" } })).toBeNull();
		expect(notice({ env: { UNOWN_SUBAGENT: "1" } })).toBeNull();
	});

	test("skipped, snoozed, stale, unknown and errored states are silent", () => {
		expect(notice({ prefs: prefs({ skippedVersion: "0.0.2" }) })).toBeNull();
		expect(notice({ prefs: prefs({ snoozeUntil: new Date(NOW + 60_000).toISOString() }) })).toBeNull();
		expect(notice({ cache: cache({ checkedAt: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() }) })).toBeNull();
		expect(notice({ cache: cache({ current: "unknown" }), version: "unknown" })).toBeNull();
		expect(notice({ cache: cache({ error: "offline" }) })).toBeNull();
	});

	test("recordNotice advances the per-version window", () => {
		const s = status();
		const p = recordNotice(prefs(), s, NOW);
		expect(p.lastNoticeVersion).toBe("0.0.2");
		expect(p.lastNoticeAt).toBe(new Date(NOW).toISOString());
		expect(recordNotice(p, s, NOW + 1000).lastNoticeAt).toBe(new Date(NOW + 1000).toISOString());
	});
});

describe("updateChipLine", () => {
	test("binary shows a short chip; checkout and suppressed states clear it", () => {
		expect(updateChipLine(status())).toBe("update: 0.0.2");
		expect(updateChipLine(status({ mode: "checkout" }))).toBeUndefined();
		expect(updateChipLine(status({ prefs: prefs({ skippedVersion: "0.0.2" }) }))).toBeUndefined();
		expect(
			updateChipLine(status({ prefs: prefs({ snoozeUntil: new Date(NOW + 1000).toISOString() }) })),
		).toBeUndefined();
		expect(updateChipLine(status({ cache: cache({ current: "unknown" }), version: "unknown" }))).toBeUndefined();
		expect(updateChipLine(status({ cache: cache({ error: "offline" }) }))).toBeUndefined();
	});
});

describe("snooze parsing", () => {
	test("accepts minutes/hours/days and rejects junk or an absurd cap", () => {
		expect(parseSnoozeDuration("30m", NOW)).toEqual({ ok: true, until: new Date(NOW + 30 * 60_000).toISOString() });
		expect(parseSnoozeDuration("12h", NOW)).toEqual({
			ok: true,
			until: new Date(NOW + 12 * 3_600_000).toISOString(),
		});
		expect(parseSnoozeDuration("7d", NOW)).toEqual({ ok: true, until: new Date(NOW + 7 * 86_400_000).toISOString() });
		expect(parseSnoozeDuration("7w", NOW).ok).toBe(false);
		expect(parseSnoozeDuration("0d", NOW).ok).toBe(false);
		expect(parseSnoozeDuration("366d", NOW).ok).toBe(false);
	});
});

describe("cache and prefs persistence", () => {
	test("schema 2 caches round-trip; schema 1 and corrupt files read as null", () => {
		const home = mkdtempSync(join(TMP, "cache-"));
		const c = cache();
		writeUpdateCheckCache(home, c);
		expect(readUpdateCheckCache(home)).toEqual(c);

		writeFileSync(updateCheckPath(home), JSON.stringify({ schema: 1, checkedAt: c.checkedAt, latest: "0.0.2" }));
		expect(readUpdateCheckCache(home)).toMatchObject({
			schema: 2,
			latest: "0.0.2",
			legacy: true,
			applicable: false,
			reason: "legacy-cache",
		});

		writeFileSync(updateCheckPath(home), "{not json");
		expect(readUpdateCheckCache(home)).toBeNull();
	});

	test("prefs round-trip and corrupt files fall back to defaults", () => {
		const home = mkdtempSync(join(TMP, "prefs-"));
		const p = prefs({
			skippedVersion: "0.0.2",
			lastNoticeVersion: "0.0.2",
			lastNoticeAt: new Date(NOW).toISOString(),
		});
		writeUpdatePrefs(home, p);
		expect(readUpdatePrefs(home)).toEqual(p);

		writeFileSync(updatePrefsPath(home), "{broken");
		expect(readUpdatePrefs(home)).toEqual({ schema: 1 });
	});
});

describe("refresh and lock rules", () => {
	test("shouldRefresh covers age, mode, version and platform", () => {
		const install = { mode: "binary" as const, version: "0.0.1", platform: "linux-x64" as const };
		expect(shouldRefresh(null, install, NOW)).toBe(true);
		expect(shouldRefresh(cache(), install, NOW)).toBe(false);
		expect(
			shouldRefresh(cache({ checkedAt: new Date(NOW - UPDATE_CHECK_TTL_MS - 1).toISOString() }), install, NOW),
		).toBe(true);
		expect(shouldRefresh(cache({ current: "0.0.0" }), install, NOW)).toBe(true);
		expect(shouldRefresh(cache({ mode: "checkout" }), install, NOW)).toBe(true);
		expect(shouldRefresh(cache({ platform: "windows-x64" }), install, NOW)).toBe(true);
	});

	test("a lock is exclusive, released by its owner, and reclaims stale files", () => {
		const home = mkdtempSync(join(TMP, "lock-"));
		const first = acquireUpdateLock(home, "check", NOW);
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error(first.error);
		expect(isUpdateLocked(home, "check", NOW)).toBe(true);
		expect(acquireUpdateLock(home, "check", NOW).ok).toBe(false);
		first.release();
		expect(isUpdateLocked(home, "check", NOW)).toBe(false);

		// A different owner's fresh lock must not be removed by the old
		// owner's release (the token check).
		const owner = acquireUpdateLock(home, "check", NOW);
		if (!owner.ok) throw new Error(owner.error);
		writeFileSync(
			join(home, "update-check.lock"),
			JSON.stringify({ pid: 1, startedAt: new Date(NOW - 60_000).toISOString(), token: "other", kind: "check" }),
		);
		owner.release();
		expect(isUpdateLocked(home, "check", NOW)).toBe(true);
		rmSync(join(home, "update-check.lock"), { force: true });

		// A lock older than the stale window is reclaimed once.
		writeFileSync(
			join(home, "update-check.lock"),
			JSON.stringify({ pid: 1, startedAt: new Date(NOW - 6 * 60_000).toISOString(), token: "stale", kind: "check" }),
		);
		const reclaimed = acquireUpdateLock(home, "check", NOW);
		expect(reclaimed.ok).toBe(true);
		if (reclaimed.ok) reclaimed.release();
	});
});

describe("formatting", () => {
	test("describeAge and formatUpdateSize", () => {
		expect(describeAge(new Date(NOW - 30_000).toISOString(), NOW)).toBe("just now");
		expect(describeAge(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5m ago");
		expect(describeAge(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3h ago");
		expect(describeAge(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe("2d ago");
		expect(formatUpdateSize(2 * 1024 * 1024)).toBe("2.0 MiB");
		expect(formatUpdateSize(2048)).toBe("2 KiB");
		expect(formatUpdateSize(undefined)).toBe("size unknown");
	});
});
