/**
 * update-status.ts — the cached update state, user preferences, notice/footer
 * decisions and single-flight locks.
 *
 * Split out of update.ts so the TUI footer extension can read a status without
 * importing the git/binary update machinery. Nothing here performs network I/O
 * or spawns a process: the background child writes the cache, every interactive
 * surface reads it.
 *
 * State (all under UNOWN_HOME):
 *   update-check.json  schema 2 cache — disposable, 24h TTL
 *   update-prefs.json  schema 1 user prefs — skip/snooze and notice history
 *   update-check.lock  single-flight background check
 *   update-apply.lock  single-flight mutation
 *
 * The cache is deliberately separate from the prefs: deleting the cache must
 * never resurrect a version the user skipped, and a background refresh must
 * never clobber the notice history.
 */

import { randomBytes } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import {
	detectPlatform,
	inferBinaryLayout,
	RELEASE_PLATFORMS,
	type ReleasePlatform,
	readInstallMetadata,
} from "./install-layout.ts";
import { IS_COMPILED_BINARY } from "./packaging.ts";
import { compareSemver, parseSemver } from "./semver.ts";

export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_SECURITY_NOTICE_TTL_MS = 12 * 60 * 60 * 1000;
export const UPDATE_CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_LOCK_STALE_MS = 5 * 60 * 1000;
export const UPDATE_APPLY_LOCK_STALE_MS = 30 * 60 * 1000;

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const MAX_SNOOZE_MS = 365 * 24 * 60 * 60 * 1000;

export type InstallMode = "checkout" | "binary";

/** Structurally compatible with update.ts's InstallInfo; kept local to avoid a
 *  cycle when the footer extension imports this module. */
export interface UpdateInstall {
	mode: InstallMode;
	version: string;
	platform?: ReleasePlatform;
}

export interface UpdateAsset {
	name: string;
	sha256: string;
	size: number;
}

/** Schema 2 cache. A schema-1 file reads as null (stale) and is refreshed. */
export interface UpdateCheckCache {
	schema: 2;
	checkedAt: string;
	current: string;
	mode: InstallMode;
	platform?: ReleasePlatform;
	latest: string;
	applicable: boolean;
	reason?: string;
	severity?: "normal" | "security";
	releasedAt?: string;
	requiredMinimumVersion?: string | null;
	notesUrl?: string;
	asset?: UpdateAsset;
	signature?: "unsigned" | "legacy";
	manifestVersion?: string;
	remoteUrl?: string;
	error?: string;
	/** A schema-1 cache normalized for display. It never drives a notice or
	 *  a chip; the next background check replaces it with schema 2. */
	legacy?: boolean;
	/* Checkout-only state, recorded by the background check so boot never
	 * needs to run git. */
	headBranch?: string | null;
	headTag?: string | null;
	dirty?: boolean;
	ahead?: number | null;
}

export interface UpdatePrefs {
	schema: 1;
	skippedVersion?: string;
	snoozeUntil?: string;
	lastNoticeAt?: string;
	lastNoticeVersion?: string;
	lastSecurityNoticeAt?: string;
}

export function unownHome(env: NodeJS.ProcessEnv = process.env): string {
	return env.UNOWN_HOME || join(homedir(), ".unown");
}

export function updateCheckPath(home: string): string {
	return join(home, "update-check.json");
}
export function updatePrefsPath(home: string): string {
	return join(home, "update-prefs.json");
}
export function updateLockPath(home: string, kind: "check" | "apply"): string {
	return join(home, `update-${kind}.lock`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value: unknown): value is string {
	return typeof value === "string";
}
function isStableVersion(value: unknown): value is string {
	return typeof value === "string" && STABLE_VERSION.test(value) && parseSemver(value) !== null;
}
function isReleasePlatform(value: unknown): value is ReleasePlatform {
	return typeof value === "string" && (RELEASE_PLATFORMS as readonly string[]).includes(value);
}
function isIsoDate(value: unknown): value is string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	return isString(record[key]) ? record[key] : undefined;
}
function optionalIso(record: Record<string, unknown>, key: string): string | undefined {
	return isIsoDate(record[key]) ? record[key] : undefined;
}
function optionalVersion(record: Record<string, unknown>, key: string): string | undefined {
	return isStableVersion(record[key]) ? record[key] : undefined;
}
function optionalNullableVersion(record: Record<string, unknown>, key: string): string | null | undefined {
	if (record[key] === null) return null;
	return isStableVersion(record[key]) ? record[key] : undefined;
}
function optionalAsset(record: Record<string, unknown>): UpdateAsset | undefined {
	const value = record.asset;
	if (!isRecord(value)) return undefined;
	if (!isString(value.name) || !isString(value.sha256) || !/^[0-9a-f]{64}$/i.test(value.sha256)) return undefined;
	if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size <= 0) return undefined;
	return { name: value.name, sha256: value.sha256.toLowerCase(), size: value.size };
}

function parseCache(raw: unknown): UpdateCheckCache | null {
	// The pre-manifest cache had no schema field at all; schema 1 is the
	// explicit spelling some intermediate versions wrote.
	if (isRecord(raw) && (raw.schema === 1 || raw.schema === undefined)) {
		if (!isIsoDate(raw.checkedAt) || !isString(raw.latest)) return null;
		return {
			schema: 2,
			checkedAt: raw.checkedAt,
			current: "",
			mode: "checkout",
			latest: raw.latest,
			applicable: false,
			reason: "legacy-cache",
			legacy: true,
			...(isString(raw.remoteUrl) ? { remoteUrl: raw.remoteUrl } : {}),
			...(isString(raw.error) ? { error: raw.error } : {}),
		};
	}
	if (!isRecord(raw) || raw.schema !== 2) return null;
	if (!isIsoDate(raw.checkedAt) || !isString(raw.current) || !isString(raw.latest)) return null;
	if (raw.mode !== "checkout" && raw.mode !== "binary") return null;
	if (typeof raw.applicable !== "boolean") return null;
	const cache: UpdateCheckCache = {
		schema: 2,
		checkedAt: raw.checkedAt,
		current: raw.current,
		mode: raw.mode,
		latest: raw.latest,
		applicable: raw.applicable,
	};
	if (isReleasePlatform(raw.platform)) cache.platform = raw.platform;
	const reason = optionalString(raw, "reason");
	if (reason) cache.reason = reason;
	if (raw.severity === "normal" || raw.severity === "security") cache.severity = raw.severity;
	const releasedAt = optionalIso(raw, "releasedAt");
	if (releasedAt) cache.releasedAt = releasedAt;
	const required = optionalNullableVersion(raw, "requiredMinimumVersion");
	if (required !== undefined) cache.requiredMinimumVersion = required;
	const notesUrl = optionalString(raw, "notesUrl");
	if (notesUrl && /^https:\/\//i.test(notesUrl)) cache.notesUrl = notesUrl;
	const asset = optionalAsset(raw);
	if (asset) cache.asset = asset;
	if (raw.signature === "unsigned" || raw.signature === "legacy") cache.signature = raw.signature;
	const manifestVersion = optionalVersion(raw, "manifestVersion");
	if (manifestVersion) cache.manifestVersion = manifestVersion;
	const remoteUrl = optionalString(raw, "remoteUrl");
	if (remoteUrl) cache.remoteUrl = remoteUrl;
	const error = optionalString(raw, "error");
	if (error) cache.error = error;
	if (raw.headBranch === null || isString(raw.headBranch)) cache.headBranch = raw.headBranch;
	if (raw.headTag === null || isString(raw.headTag)) cache.headTag = raw.headTag;
	if (typeof raw.dirty === "boolean") cache.dirty = raw.dirty;
	if (raw.ahead === null || (typeof raw.ahead === "number" && Number.isFinite(raw.ahead))) cache.ahead = raw.ahead;
	return cache;
}

export function readUpdateCheckCache(home: string): UpdateCheckCache | null {
	return parseCache(readJson(updateCheckPath(home)));
}

export function writeUpdateCheckCache(home: string, cache: UpdateCheckCache): void {
	atomicWriteFileSync(updateCheckPath(home), `${JSON.stringify(cache, null, 2)}\n`);
}

function parsePrefs(raw: unknown): UpdatePrefs {
	const prefs: UpdatePrefs = { schema: 1 };
	if (!isRecord(raw) || raw.schema !== 1) return prefs;
	const skipped = optionalVersion(raw, "skippedVersion");
	if (skipped) prefs.skippedVersion = skipped;
	const snooze = optionalIso(raw, "snoozeUntil");
	if (snooze) prefs.snoozeUntil = snooze;
	const lastAt = optionalIso(raw, "lastNoticeAt");
	if (lastAt) prefs.lastNoticeAt = lastAt;
	const lastVersion = optionalVersion(raw, "lastNoticeVersion");
	if (lastVersion) prefs.lastNoticeVersion = lastVersion;
	const lastSecurityAt = optionalIso(raw, "lastSecurityNoticeAt");
	if (lastSecurityAt) prefs.lastSecurityNoticeAt = lastSecurityAt;
	return prefs;
}

export function readUpdatePrefs(home: string): UpdatePrefs {
	return parsePrefs(readJson(updatePrefsPath(home)));
}

export function writeUpdatePrefs(home: string, prefs: UpdatePrefs): void {
	atomicWriteFileSync(updatePrefsPath(home), `${JSON.stringify(prefs, null, 2)}\n`);
}

export function updatesHardDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return /^(1|true|yes)$/i.test(env.UNOWN_DISABLE_UPDATES ?? "");
}

/** Notice + background-check opt-outs. Manual `unown update` still works. */
export function noticeSuppressed(env: NodeJS.ProcessEnv = process.env): boolean {
	return (
		updatesHardDisabled(env) ||
		/^(1|true|yes)$/i.test(env.UNOWN_DISABLE_AUTOUPDATE ?? "") ||
		env.NO_UPDATE_NOTIFIER !== undefined ||
		/^(1|true|yes)$/i.test(env.DO_NOT_TRACK ?? "")
	);
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" for an ISO timestamp. */
export function describeAge(iso: string, now = Date.now()): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "unknown";
	const seconds = Math.max(0, Math.floor((now - t) / 1000));
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatUpdateSize(bytes: number | undefined): string {
	if (!bytes || bytes <= 0) return "size unknown";
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
	return `${Math.ceil(bytes / 1024)} KiB`;
}

export function parseSnoozeDuration(
	value: string,
	now = Date.now(),
): { ok: true; until: string } | { ok: false; error: string } {
	const m = /^(\d+)(m|h|d)$/.exec(value.trim());
	if (!m) return { ok: false, error: "snooze duration must look like 30m, 12h or 7d" };
	const n = Number(m[1]);
	const unit = m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000;
	const ms = n * unit;
	if (!Number.isSafeInteger(ms) || ms <= 0) return { ok: false, error: "snooze duration must be positive" };
	if (ms > MAX_SNOOZE_MS) return { ok: false, error: "snooze duration may not exceed 365d" };
	return { ok: true, until: new Date(now + ms).toISOString() };
}

/** Binary installs are the only ones with a footer chip; no git probe here. */
export function cheapInstallStatus(env: NodeJS.ProcessEnv = process.env, execPath = process.execPath): UpdateInstall {
	const meta = readInstallMetadata(unownHome(env));
	const inferred = inferBinaryLayout(execPath);
	if (inferred || IS_COMPILED_BINARY || env.UNOWN_INSTALL_ROOT || meta?.mode === "binary") {
		// Prefer the metadata platform: on macOS x64 detectPlatform() may spawn
		// sysctl for the Rosetta probe, and this runs on the footer poller.
		const detected =
			meta?.mode === "binary" && isReleasePlatform(meta.platform) ? meta.platform : (detectPlatform() ?? undefined);
		return {
			mode: "binary",
			version: inferred?.version ?? (meta?.mode === "binary" ? meta.version : "unknown"),
			...(detected ? { platform: detected } : {}),
		};
	}
	return { mode: "checkout", version: meta?.mode === "checkout" ? meta.version : "unknown" };
}

export interface DerivedUpdateStatus {
	cache: UpdateCheckCache | null;
	prefs: UpdatePrefs;
	mode: InstallMode;
	current: string;
	latest: string | null;
	newer: boolean;
	applicable: boolean;
	skipped: boolean;
	snoozed: boolean;
	stale: boolean;
	security: boolean;
	required: boolean;
	reason?: string;
	asset?: UpdateAsset;
}

export function deriveUpdateStatus(input: {
	cache: UpdateCheckCache | null;
	prefs: UpdatePrefs;
	install: UpdateInstall;
	now?: number;
}): DerivedUpdateStatus {
	const now = input.now ?? Date.now();
	const { cache, prefs, install } = input;
	const latest = cache?.latest && parseSemver(cache.latest) ? cache.latest : null;
	const newer = Boolean(latest && (install.version === "unknown" || compareSemver(latest, install.version) > 0));
	const age = cache ? now - Date.parse(cache.checkedAt) : Number.POSITIVE_INFINITY;
	const stale = Boolean(
		!cache ||
			cache.legacy === true ||
			!Number.isFinite(age) ||
			age > UPDATE_CACHE_STALE_MS ||
			cache.mode !== install.mode ||
			(cache.current !== "" && install.version !== "unknown" && cache.current !== install.version) ||
			(install.mode === "binary" &&
				cache.platform !== undefined &&
				install.platform !== undefined &&
				cache.platform !== install.platform),
	);
	const applicable = Boolean(cache && !cache.error && cache.applicable && newer);
	const skipped = Boolean(latest && prefs.skippedVersion === latest);
	const snoozed = Boolean(prefs.snoozeUntil && Date.parse(prefs.snoozeUntil) > now);
	const required = Boolean(
		cache?.requiredMinimumVersion &&
			install.version !== "unknown" &&
			compareSemver(cache.requiredMinimumVersion, install.version) > 0,
	);
	return {
		cache,
		prefs,
		mode: install.mode,
		current: install.version,
		latest,
		newer,
		applicable,
		skipped,
		snoozed,
		stale,
		security: cache?.severity === "security" || required,
		required,
		...(cache?.reason ? { reason: cache.reason } : {}),
		...(cache?.asset ? { asset: cache.asset } : {}),
	};
}

function notesUrlFor(status: DerivedUpdateStatus): string {
	if (status.cache?.notesUrl) return status.cache.notesUrl;
	const latest = status.latest ?? "";
	const remote = status.cache?.remoteUrl ?? "";
	const github = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/releases)?\/?$/.exec(remote);
	if (github) return `https://github.com/${github[1]}/${github[2]}/releases/tag/v${latest}`;
	return `https://github.com/kanishka-namdeo/Unown/releases/tag/v${latest}`;
}

function checkoutNoticeAllowed(status: DerivedUpdateStatus): boolean {
	const cache = status.cache;
	if (!cache) return false;
	// The background child records this state; boot never runs git. A
	// checkout on a feature branch or with local work is not a safe place
	// to suggest a rebuild.
	if (cache.dirty === true) return false;
	if ((cache.ahead ?? 0) > 0) return false;
	return cache.headTag !== null && cache.headTag !== undefined ? true : cache.headBranch === "main";
}

export interface NoticeInput {
	status: DerivedUpdateStatus;
	env?: NodeJS.ProcessEnv;
	outputIsTty: boolean;
	mode?: "tui" | "print";
	now?: number;
}

/** Pure decision — exactly two lines to stderr, or null. */
export function updateNoticeLines(input: NoticeInput): string[] | null {
	const env = input.env ?? process.env;
	const now = input.now ?? Date.now();
	if (input.mode === "print") return null;
	if (noticeSuppressed(env) || env.CI !== undefined || env.UNOWN_SUBAGENT === "1" || !input.outputIsTty) return null;
	const status = input.status;
	if (status.current === "unknown") return null;
	if (!status.latest || !status.newer || !status.applicable || status.skipped || status.snoozed || status.stale)
		return null;
	if (status.cache?.error) return null;
	if (status.mode === "checkout" && !checkoutNoticeAllowed(status)) return null;

	const lastAt = Date.parse(status.prefs.lastNoticeAt ?? "");
	const sameVersion = status.prefs.lastNoticeVersion === status.latest;
	const window = status.security ? UPDATE_SECURITY_NOTICE_TTL_MS : UPDATE_NOTICE_TTL_MS;
	if (sameVersion) {
		if (status.mode === "checkout") return null;
		if (Number.isFinite(lastAt) && now - lastAt < window) return null;
	}

	const notes = notesUrlFor(status);
	const size = status.mode === "binary" ? `, ${formatUpdateSize(status.asset?.size)}` : "";
	const platform =
		status.mode === "binary" ? ` (${status.cache?.platform ?? "unknown"}${size})` : " (source checkout)";
	const label = status.security ? "security update" : "update available";
	const first = `⚠ ${label}: unown ${status.current} → ${status.latest}${platform}`;
	const second =
		status.mode === "binary"
			? `  run \`unown update\` · notes: ${notes}`
			: `  exit this session, then run \`unown update\` · notes: ${notes}`;
	return [first, second];
}

export function recordNotice(prefs: UpdatePrefs, status: DerivedUpdateStatus, now = Date.now()): UpdatePrefs {
	return {
		...prefs,
		lastNoticeAt: new Date(now).toISOString(),
		...(status.latest ? { lastNoticeVersion: status.latest } : {}),
		...(status.security ? { lastSecurityNoticeAt: new Date(now).toISOString() } : {}),
	};
}

/** The footer chip is a single short line; undefined clears the key. */
export function updateChipLine(status: DerivedUpdateStatus): string | undefined {
	if (status.mode !== "binary" || status.current === "unknown") return undefined;
	if (!status.applicable || status.skipped || status.snoozed || status.stale) return undefined;
	if (status.cache?.error) return undefined;
	return `update: ${status.latest}`;
}

export function shouldRefresh(cache: UpdateCheckCache | null, install: UpdateInstall, now = Date.now()): boolean {
	if (!cache) return true;
	if (cache.legacy) return true;
	const age = now - Date.parse(cache.checkedAt);
	if (!Number.isFinite(age) || age > UPDATE_CHECK_TTL_MS) return true;
	if (cache.mode !== install.mode) return true;
	if (cache.current !== "" && install.version !== "unknown" && cache.current !== install.version) return true;
	if (
		install.mode === "binary" &&
		cache.platform !== undefined &&
		install.platform !== undefined &&
		cache.platform !== install.platform
	) {
		return true;
	}
	return false;
}

interface LockFile {
	pid: number;
	startedAt: string;
	token: string;
	kind: "check" | "apply";
}

function readLock(path: string): LockFile | null {
	const raw = readJson(path);
	if (!isRecord(raw)) return null;
	if (typeof raw.pid !== "number" || !isString(raw.startedAt) || !isString(raw.token)) return null;
	if (raw.kind !== "check" && raw.kind !== "apply") return null;
	return { pid: raw.pid, startedAt: raw.startedAt, token: raw.token, kind: raw.kind };
}

export function isUpdateLocked(home: string, kind: "check" | "apply", now = Date.now()): boolean {
	const path = updateLockPath(home, kind);
	if (!existsSync(path)) return false;
	const lock = readLock(path);
	const ttl = kind === "check" ? UPDATE_CHECK_LOCK_STALE_MS : UPDATE_APPLY_LOCK_STALE_MS;
	if (!lock) {
		try {
			return now - statSync(path).mtimeMs < ttl;
		} catch {
			return false;
		}
	}
	const age = now - Date.parse(lock.startedAt);
	return Number.isFinite(age) ? age < ttl : true;
}

export type LockResult = { ok: true; release: () => void; path: string } | { ok: false; error: string };

/** Exclusive create lock. Stale locks are reclaimed once; a live lock refuses. */
export function acquireUpdateLock(home: string, kind: "check" | "apply", now = Date.now()): LockResult {
	mkdirSync(home, { recursive: true });
	const path = updateLockPath(home, kind);
	const ttl = kind === "check" ? UPDATE_CHECK_LOCK_STALE_MS : UPDATE_APPLY_LOCK_STALE_MS;
	const token = `${process.pid}-${now}-${randomBytes(4).toString("hex")}`;
	const body = `${JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString(), token, kind })}\n`;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = openSync(path, "wx", 0o600);
			try {
				writeFileSync(fd, body, "utf8");
			} finally {
				closeSync(fd);
			}
			return {
				ok: true,
				path,
				release: () => {
					try {
						if (readLock(path)?.token === token) unlinkSync(path);
					} catch {
						/* the lock is best effort; a stale file is reclaimed */
					}
				},
			};
		} catch (err) {
			const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
			if (code !== "EEXIST") {
				return {
					ok: false,
					error: `could not create ${path}: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
			const lock = readLock(path);
			let age: number;
			try {
				age = lock ? now - Date.parse(lock.startedAt) : now - statSync(path).mtimeMs;
			} catch {
				age = Number.POSITIVE_INFINITY;
			}
			if (!Number.isFinite(age) || age <= ttl) {
				return {
					ok: false,
					error: `another unown ${kind === "check" ? "update check" : "update"} is already running (${path})`,
				};
			}
			try {
				rmSync(path, { force: true });
			} catch {
				return { ok: false, error: `stale lock could not be reclaimed (${path})` };
			}
		}
	}
	return { ok: false, error: `could not acquire ${path}` };
}

/** A missing home is normal on a virgin install. */
export function ensureUpdateHome(home: string): void {
	mkdirSync(home, { recursive: true });
}
