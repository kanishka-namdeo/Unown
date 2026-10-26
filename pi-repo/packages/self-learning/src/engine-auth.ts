/**
 * engine-auth.ts — the engine API's authentication layer (M7).
 *
 * The engine is a detached HTTP server holding the learning surface: session
 * notes (transcript-derived text), memory versions, provider keys, scheduled
 * agent runs. Until M7 it was loopback-bound but COMPLETELY unauthenticated,
 * and CORS only gated what a browser could READ — never what it could SEND:
 * a `text/plain` POST is a CORS "simple request" (no preflight), and
 * `apiRequestBody()` parses any content-type, so any website the user visits
 * could drive `POST /api/automations` (arbitrary prompt execution),
 * `POST /api/notes` (memory poisoning), `POST /api/providers` (re-route LLM
 * traffic) or `POST /api/shutdown` through their own browser. Same-port DNS
 * rebinding (Host: evil.com → 127.0.0.1) additionally defeated CORS entirely
 * and allowed full reads. See docs/detached-engine-architecture.md
 * "Engine API authentication" for the design and the precedent trail
 * (Jupyter token files, Docker's socket, Vite's allowedHosts / CVE-2025-24010).
 *
 * The layer has three parts, all enforced in the Bun.serve fetch wrapper —
 * NEVER in handleApi (the unit suite calls handleApi directly with the body
 * already parsed; HTTP-level concerns must stay above it):
 *
 *   1. Host-header validation (Vite-style) — kills same-port DNS rebinding.
 *   2. Origin enforcement — a request that CARRIES an Origin header must be
 *      on the CORS allow-list or it is rejected before routing. Browsers
 *      always attach Origin to cross-origin POSTs, so the preflight-free
 *      `text/plain` blind-write hole closes in every browser, independent of
 *      the arriving PNA/LNA permission work. Non-browser clients (curl, the
 *      CLI, the bridge) send no Origin and are untouched.
 *   3. Bearer token (Jupyter-style) — a per-boot random token written to
 *      DATA_DIR/engine.token (0600) BEFORE the port is bound; same-user
 *      clients auto-discover it (engineFetch) so the default costs nothing.
 *      Mandatory when the bind is widened off loopback; `UNOWN_ENGINE_AUTH=off`
 *      is refused at boot for non-loopback binds (an Ollama-style accidental
 *      0.0.0.0-with-no-auth can never exist again).
 *
 * Honest threat model: the token protects against OTHER LOCAL USERS and
 * BROWSER confused-deputy attacks. It cannot protect against same-user
 * malware — that code can read the token file and the SQLite DB directly;
 * for that, the sandbox/policy layers are the answer. The one query-param
 * exception is `?token=` on `/api/events` only (EventSource cannot set
 * headers) — the Jupyter precedent, narrowed to a single endpoint.
 *
 * Purity: node:fs / node:path / node:crypto only (+ the DATA_DIR const from
 * store.ts, import-safe since M2). No pi imports, no LLM, fully unit-testable.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./store.ts";
import { resolveUnownHome } from "./unown-home.ts";

// ---------------------------------------------------------------------------
// Config resolution (server side)
// ---------------------------------------------------------------------------

export const ENGINE_TOKEN_FILE = "engine.token";

/** Where the per-boot token lives — inside the engine's data dir, which tests
 *  redirect via PI_SELFLEARNING_DATA and installs redirect via UNOWN_HOME. */
export function engineTokenPath(): string {
	return join(DATA_DIR, ENGINE_TOKEN_FILE);
}

/** The cross-install discovery path (2026-10-26 hardening round, H6 — the
 *  resilience.md R11 binary↔source token split). A source checkout keeps its
 *  engine state under <repo>/data/self-learning while a standalone binary
 *  keeps its under $UNOWN_HOME/data/self-learning — so a binary CLI probing a
 *  source-repo engine (or the reverse) reads its OWN data dir's token, gets
 *  401, and reports `blocked · token` forever even though the same user owns
 *  both installs. The engine now ALSO mirrors its per-boot token to this
 *  well-known shared location — $UNOWN_HOME/engine.token, one tree every
 *  install shape resolves identically — and engineToken() falls back to it
 *  when the own-data-dir token is absent or rejected. Two engines can never
 *  race on the file: one port, one single-instance lock per data dir means at
 *  most one engine answers, and the file carries the PORT OWNER's token
 *  (written at token-commit after bind, ownership-checked at drain — the same
 *  semantics as the DATA_DIR file). */
export function sharedEngineTokenPath(): string {
	return join(resolveUnownHome(), ENGINE_TOKEN_FILE);
}

// ---------------------------------------------------------------------------
// The inbound-webhook capability (M2 event routines)
// ---------------------------------------------------------------------------

export const HOOKS_TOKEN_FILE = "hooks.token";

/** Where the per-install hook id lives — same data-dir resolution as the
 *  engine token, so redirects (tests, UNOWN_HOME installs) cover it too. */
export function hooksTokenPath(): string {
	return join(DATA_DIR, HOOKS_TOKEN_FILE);
}

/** The hook id for POST /api/hooks/<id>: 32 hex chars generated ONCE and
 *  persisted for the life of the data dir — unlike engine.token it must be
 *  STABLE across engine restarts or every configured sender (a GitHub
 *  webhook, a CI job) breaks on the next boot. Knowing the URL is the
 *  authorization (GitHub-webhook-URL semantics: unguessable path, no
 *  header secret to distribute), which is also why the file is 0600 and
 *  the comparison is timing-safe. Rotate by deleting the file and
 *  restarting — docs/routines.md "Event routines" documents the flow. */
export function ensureHooksToken(): string {
	try {
		const existing = readFileSync(hooksTokenPath(), "utf8").trim();
		if (/^[a-f0-9]{32}$/.test(existing)) return existing;
	} catch {
		/* missing or unreadable — generate below */
	}
	const token = randomBytes(16).toString("hex");
	try {
		mkdirSync(join(hooksTokenPath(), ".."), { recursive: true });
		writeFileSync(hooksTokenPath(), token, { mode: 0o600 });
	} catch {
		/* read-only fs — the in-memory id still serves this boot */
	}
	return token;
}

export interface AuthPolicy {
	/** "token" (default) or "off" — the UNOWN_ENGINE_AUTH mode. */
	mode: "token" | "off";
	/** The token to require, or null when mode is off / not pinned. */
	token: string | null;
	/** True when the bind host is non-loopback (token becomes mandatory). */
	widenedBind: boolean;
	/** Extra DNS hostnames allowed in the Host header (UNOWN_ENGINE_HOSTS). */
	hostsAllow: string[];
	/** Boot must be refused: non-loopback bind with auth disabled. */
	refuse: boolean;
	/** Human-readable reason when refuse is true. */
	refuseReason: string | null;
}

/** Is `host` an IP literal (v4 or v6, bare or bracketed)? */
function isIpLiteral(host: string): boolean {
	const bare = host.replace(/^\[|\]$/g, "");
	if (/^(\d{1,3}\.){3}\d{1,3}$/.test(bare)) return true; // IPv4
	return bare.includes(":"); // IPv6 (contains at least one colon)
}

/** Loopback hostname? (127/8, ::1, localhost — the bind's default family.) */
export function isLoopbackHost(host: string): boolean {
	const bare = host.replace(/^\[|\]$/g, "");
	if (bare === "localhost" || bare.endsWith(".localhost")) return true;
	if (bare === "::1") return true;
	if (/^127(\.\d{1,3}){3}$/.test(bare)) return true;
	return false;
}

/**
 * Resolve the auth policy from the environment. Pure (env injected) so the
 * refusal matrix is unit-testable without binding anything.
 *
 *   UNOWN_ENGINE_AUTH   "token" (default) | "off"
 *   UNOWN_ENGINE_TOKEN  pin the token instead of generating per-boot (also
 *                       the CLIENT-side override for remote engines)
 *   UNOWN_ENGINE_HOSTS  comma list of extra allowed Host header values
 *                       (DNS names — the Vite allowedHosts lane)
 *   UNOWN_ENGINE_HOST   the bind host (already consulted by startServer;
 *                       read here only to decide loopback-ness)
 */
export function resolveAuthPolicy(env: NodeJS.ProcessEnv): AuthPolicy {
	const mode = (env.UNOWN_ENGINE_AUTH ?? "").trim() === "off" ? "off" : "token";
	const pinned = (env.UNOWN_ENGINE_TOKEN ?? "").trim() || null;
	const bindHost = (env.UNOWN_ENGINE_HOST ?? "").trim();
	const widenedBind = bindHost !== "" && !isLoopbackHost(bindHost);
	const hostsAllow = (env.UNOWN_ENGINE_HOSTS ?? "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const refuse = mode === "off" && widenedBind;
	return {
		mode,
		token: mode === "token" ? pinned : null,
		widenedBind,
		hostsAllow,
		refuse,
		refuseReason: refuse
			? `UNOWN_ENGINE_HOST=${bindHost} binds the engine off loopback, and UNOWN_ENGINE_AUTH=off would leave the whole learning surface (notes, memory, providers, automations) unauthenticated on the network. Either remove UNOWN_ENGINE_AUTH=off or require the token (default).`
			: null,
	};
}

// ---------------------------------------------------------------------------
// Token file lifecycle (server side)
// ---------------------------------------------------------------------------

/** Generate a per-boot token: 64 hex chars, no new deps (node:crypto). */
export function generateEngineToken(): string {
	return randomBytes(32).toString("hex");
}

/**
 * Write the token file BEFORE the port is bound (no torn reads: clients can
 * never observe a listening engine without a readable token on disk).
 *
 * Permissions: 0600 on POSIX. On Windows the mode bits are advisory — the
 * practical boundary is that DATA_DIR lives under the user profile
 * (%USERPROFILE%\.unown\...), whose ACL is per-user by default (the same
 * posture Jupyter's secure_write takes with its explicit DACL; see
 * docs/detached-engine-architecture.md for the Windows notes).
 */
export function writeEngineTokenFile(path: string, token: string): void {
	rmSync(path, { force: true }); // never resurrect a previous boot's token
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, token, { mode: 0o600 });
}

/** Remove the token file at drain time (mirrors Jupyter's runtime-file
 *  lifecycle). Ownership-checked (audit M5): a drain may overlap a newer
 *  boot in the same data dir — bun --hot reloads the entry on source change
 *  (e.g. `unown update`'s git pull), and the supervisor restart path can
 *  start the replacement before the old instance finishes draining. An
 *  unconditional rm here could delete the NEW boot's token, leaving an
 *  engine that answers 401 to everyone with no discoverable token. When
 *  `expected` is given, the file is only removed when it still contains
 *  THIS instance's token; a file with different content belongs to a newer
 *  boot and is left alone. */
export function removeEngineTokenFile(path: string, expected?: string): void {
	if (expected !== undefined) {
		try {
			const onDisk = readFileSync(path, "utf8").trim();
			if (onDisk !== expected) return; // a newer boot owns the file now
		} catch {
			/* unreadable/missing — the force-rm below is a no-op then */
		}
	}
	rmSync(path, { force: true });
}

/** Re-write the token file when it went missing under a live engine
 *  (audit M5 self-heal): the drain/new-boot overlap above is closed by the
 *  ownership check, but a stale drain from an OLD binary (pre-ownership
 *  check) or a user's stray `rm` can still leave a token-required engine
 *  with no discoverable token. Only a MISSING/unreadable file is rewritten —
 *  a file holding a DIFFERENT token belongs to a newer boot in the same data
 *  dir and is never clobbered. The maintenance tick calls this; rewriting is
 *  idempotent (same token, mode 0600 preserved). */
export function healEngineTokenFile(path: string, token: string): boolean {
	let present: string | null = null;
	try {
		present = readFileSync(path, "utf8").trim() || null;
	} catch {
		present = null; // missing/unreadable — the only case we rewrite
	}
	if (present === token) return false; // intact
	if (present !== null) return false; // a newer boot owns this file
	try {
		writeEngineTokenFile(path, token);
		return true;
	} catch {
		return false; // read-only fs etc. — the in-memory token still works for env-pinned clients
	}
}

// ---------------------------------------------------------------------------
// Request-level checks (server side) — pure, Request in / boolean out
// ---------------------------------------------------------------------------

/**
 * Host-header validation (Vite allowedHosts / CVE-2025-24010 lane): accept
 * localhost (+ *.localhost), IP literals (v4/v6 incl. brackets) and anything
 * on the UNOWN_ENGINE_HOSTS allow-list; reject DNS names otherwise. Kills
 * same-port DNS rebinding, where the page origin EQUALS the target origin and
 * CORS never applies at all.
 */
export function hostHeaderAllowed(req: Request, policy: Pick<AuthPolicy, "hostsAllow">): boolean {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (host === "") return false;
	const hostname = host.replace(/:\d+$/, "").trim(); // strip port (no IPv6 colon damage: [::1]:3030 → [::1])
	if (hostname === "") return false;
	if (isLoopbackHost(hostname)) return true;
	if (isIpLiteral(hostname)) return true;
	return policy.hostsAllow.includes(hostname);
}

/**
 * Origin enforcement: a request that CARRIES an Origin header (i.e. comes
 * from a browser) must be on the CORS allow-list. Non-browser clients send
 * no Origin. This closes the preflight-free `text/plain` POST hole in every
 * browser regardless of the arriving Private/Local Network Access work.
 * Takes the already-computed `allowedOrigin` so the allow-list has exactly
 * one definition (allowedCorsOrigin in server.ts).
 */
export function originAllowed(req: Request, allowedOrigin: string | null): boolean {
	const origin = req.headers.get("origin");
	if (!origin) return true; // non-browser client
	if (origin === "null") return false; // sandboxed iframe / opaque origin — no legitimate engine client
	return allowedOrigin !== null;
}

/** Extract the presented token: `Authorization: Bearer <t>`, plus the narrow
 *  `?token=` exception for `/api/events` ONLY (EventSource cannot set headers). */
export function requestToken(req: Request, url: URL): string | null {
	const auth = req.headers.get("authorization") ?? "";
	const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
	if (m) return m[1].trim();
	if (url.pathname === "/api/events") {
		const q = url.searchParams.get("token");
		if (q) return q.trim();
	}
	return null;
}

/** Constant-time token comparison (length mismatch short-circuits — the only
 *  leak is the token LENGTH, which is public knowledge: 64 hex). */
export function tokenMatches(presented: string | null, expected: string): boolean {
	if (!presented) return false;
	const a = Buffer.from(presented, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** Should this request skip the token gate? The plain-text liveness root
 *  (reveals only engine presence — gives third-party probes something to
 *  ping) and CORS preflights (cannot carry credentials by design).
 *
 *  M2 event routines add the inbound-webhook lane: POST /api/hooks/<hookId>
 *  authenticates by KNOWING the URL — the 32-hex hook id IS the capability
 *  (GitHub-webhook-URL semantics), and external senders cannot read
 *  engine.token, so requiring the bearer would defeat the endpoint entirely.
 *  The literal `info` segment is NOT exempt (it is GET-only and reveals the
 *  hook id, so it stays behind the engine token). Everything else under
 *  /api/hooks/ answers 404 before touching any state. */
export function tokenExempt(method: string, pathname: string): boolean {
	if (method === "OPTIONS") return true;
	if (pathname === "/") return true;
	if (method === "POST" && /^\/api\/hooks\/(?!info$)[^/]+$/.test(pathname)) return true;
	return false;
}

// ---------------------------------------------------------------------------
// Client side — same-user discovery + the shared fetch helper
// ---------------------------------------------------------------------------

/** The two discoverable token files, read as a pair so the 401-retry lane can
 *  tell "the engine rebooted" (either file changed) from "genuine reject"
 *  (neither changed). Env pin beats both (remote engines / CI pins). */
interface TokenPair {
	own: string | null;
	shared: string | null;
}

let cachedPair: TokenPair | undefined;

function readTokenPair(): TokenPair {
	let own: string | null = null;
	try {
		own = readFileSync(engineTokenPath(), "utf8").trim() || null;
	} catch {
		own = null; // never booted / remote engine / different install shape
	}
	let shared: string | null = null;
	try {
		shared = readFileSync(sharedEngineTokenPath(), "utf8").trim() || null;
	} catch {
		shared = null; // no cross-install mirror (engine predates H6, or never wrote one)
	}
	return { own, shared };
}

/** The token this process should present: UNOWN_ENGINE_TOKEN (remote engines /
 *  CI pins) beats the discoverable pair. Own data dir first, then the shared
 *  cross-install mirror (H6). Cached; re-read via invalidate. */
export function engineToken(): string | null {
	const env = (process.env.UNOWN_ENGINE_TOKEN ?? "").trim();
	if (env) return env;
	if (cachedPair === undefined) cachedPair = readTokenPair();
	return cachedPair.own ?? cachedPair.shared;
}

/** Which file a presented token came from — the 401-retry lane diffs the pair
 *  and re-presents whichever side CHANGED (own-file rotation = same-install
 *  reboot; shared-file rotation = the other install shape's engine took the
 *  port, e.g. a binary CLI talking to a source-repo engine). Exported for
 *  engine-cli's status diagnostics. */
export function engineTokenSource(): "env" | "own" | "shared" | null {
	const env = (process.env.UNOWN_ENGINE_TOKEN ?? "").trim();
	if (env) return "env";
	if (cachedPair === undefined) cachedPair = readTokenPair();
	if (cachedPair.own) return "own";
	if (cachedPair.shared) return "shared";
	return null;
}

/** Forget the cached pair (called after a 401 — the engine may have rebooted
 *  with a fresh per-boot token, or the running engine belongs to the other
 *  install shape and only the shared mirror carries its token). One re-read,
 *  then one retry. */
export function invalidateEngineToken(): void {
	cachedPair = undefined;
}

export interface EngineFetchInit extends Omit<RequestInit, "headers"> {
	headers?: HeadersInit;
	/** Internal: guards the single 401 retry (per-boot rotation). */
	__engineAuthRetry?: boolean;
	/** Internal: the token the retry should present (the 401 lane's pick —
	 *  the rotated file's fresh value, or the OTHER install's mirror token).
	 *  Callers never set this. */
	__engineAuthToken?: string;
}

/**
 * engineFetch — every in-tree engine client goes through here (term.ts probe
 * + note delivery, supervisor, engine-cli, automations-cli, tools, doctor).
 * Attaches `Authorization: Bearer` when a token is discoverable; on a 401 it
 * invalidates the cache, re-reads the token file once and retries once (the
 * engine rotates the token each boot; a live agent crossing an engine
 * restart heals on the next request). Never throws for auth reasons — the
 * Response is returned and callers degrade exactly as they do today (M6:
 * the agent works engine-down).
 */
export async function engineFetch(url: string, init: EngineFetchInit = {}): Promise<Response> {
	const headers = new Headers(init.headers ?? undefined);
	const tok = init.__engineAuthToken ?? engineToken();
	if (tok && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${tok}`);
	const res = await fetch(url, { ...init, headers });
	if (res.status !== 401 || init.__engineAuthRetry) return res;
	// The 401 heal, two cases, ONE retry:
	//   1. per-boot rotation — the engine we were talking to rebooted and
	//      either token file CHANGED on re-read; present the changed side;
	//   2. cross-install ownership (H6, the R11 binary↔source split) — nothing
	//      rotated, but the engine on the port belongs to the OTHER install
	//      shape and only the side we did NOT present carries its token; a
	//      binary CLI holding a stale own-data-dir token re-presents the
	//      shared mirror's CURRENT token and heals instead of reporting
	//      `blocked · token` forever.
	// Neither case yields a new token (or the env pin is set) = genuine
	// reject, and the 401 flows back to the caller's engine-down handling.
	const envPinned = (process.env.UNOWN_ENGINE_TOKEN ?? "").trim() !== "";
	if (envPinned) return res;
	const oldPair: TokenPair = cachedPair ?? readTokenPair();
	const presentedOwn = oldPair.own !== null && oldPair.own === tok;
	invalidateEngineToken();
	const freshPair: TokenPair = readTokenPair();
	let fresh: string | null;
	if (freshPair.own !== oldPair.own)
		fresh = freshPair.own; // own file rotated (or appeared)
	else if (freshPair.shared !== oldPair.shared)
		fresh = freshPair.shared; // shared file rotated
	else if (presentedOwn && freshPair.shared !== null && freshPair.shared !== tok)
		fresh = freshPair.shared; // foreign install's engine
	else if (!presentedOwn && freshPair.own !== null && freshPair.own !== tok)
		fresh = freshPair.own; // our engine took the port back
	else fresh = null;
	if (fresh === null || fresh === tok) return res; // nothing new to present — genuine reject
	return engineFetch(url, { ...init, __engineAuthToken: fresh, __engineAuthRetry: true });
}
