/**
 * engine-probe.ts — the engine health taxonomy (P0).
 *
 * Before this module every engine client collapsed every non-2xx answer into
 * "down": a 401 from another install's engine, a 500 from a wedged engine, a
 * foreign process squatting the port and a genuinely refused connection were
 * all the same fact. The status loop then treated that "down" as licence to
 * spawn a second engine into the occupied port — five times per CLI, until the
 * crash-loop circuit gave up. The user saw "memory: paused" while a perfectly
 * healthy engine (with a different bearer token) was answering.
 *
 * This module answers the only question that decides a spawn:
 *
 *   ok            this CLI's engine answered and the build is compatible
 *   refused       nothing is listening (ECONNREFUSED) — a spawn is safe
 *   unauthorized  an engine answered but rejected this CLI's token — adopt or
 *                 fail; never spawn
 *   occupied      the port is held by something that is not this engine —
 *                 identify it; never spawn
 *   incompatible  an engine answered but its API/build is not usable —
 *                 restart/adopt; never spawn
 *   unreachable   no answer inside the timeout (a hung port) — never spawn
 *
 * The probe is deliberately read-only and never spawns. `engineHealth` remains
 * the boolean adapter for callers that only ask "is it usable right now";
 * callers that decide about spawning (supervisor, status loop, CLI, doctor)
 * use this module directly.
 *
 * Import discipline: this module is pulled into the terminal import graph by
 * engine-supervisor/engine-status, so it must not import store.ts or any
 * engine-only module. engine-auth/engine-version are already on that graph.
 */
import { spawnSync } from "node:child_process";
import { engineFetch } from "./engine-auth.ts";
import { ENGINE_API_VERSION } from "./engine-version.ts";

export type EngineProbeKind = "ok" | "refused" | "unauthorized" | "occupied" | "incompatible" | "unreachable";

/** The causes that are "an engine/port exists but is not ours to use" — the
 *  spawn gate refuses on every one of these. "refused" is the only spawnable
 *  kind. */
export type EngineBlockedKind = Exclude<EngineProbeKind, "ok" | "refused">;

export interface EngineOwner {
	pid?: number;
	installId?: string;
	installMode?: string;
	installRoot?: string;
	version?: string;
	/** Where the identity came from (diagnostics, never authority). */
	source: "headers" | "descriptor" | "pidfile" | "port" | "banner";
}

export interface EngineProbeVersion {
	version?: string;
	gitSha?: string | null;
	api?: number;
}

export interface EngineProbe {
	kind: EngineProbeKind;
	endpoint: string;
	/** HTTP status when a response arrived. */
	status?: number;
	/** True when GET / answered the engine's unauthenticated banner. */
	banner: boolean;
	detail: string;
	remediation?: string;
	owner?: EngineOwner;
	version?: EngineProbeVersion;
	/** Parsed /api/overview body when kind === "ok" (adapter payload). */
	body?: any;
}

/** A minimal fetch seam: engineFetch and the global fetch both fit. */
export type ProbeFetch = (
	url: string,
	init?: { signal?: AbortSignal; method?: string; headers?: HeadersInit },
) => Promise<Response>;

export interface ProbeEngineOptions {
	endpoint: string;
	timeoutMs?: number;
	/** Test seam: replaces engineFetch (the authenticated overview call). */
	fetchImpl?: ProbeFetch;
	/** Test seam: replaces the unauthenticated GET / banner call. */
	bannerFetch?: ProbeFetch;
	/** Test seam: replaces the OS port-owner lookup. */
	portOwner?: (port: number) => number | null;
}

const DEFAULT_TIMEOUT_MS = 1500;
const BANNER_TIMEOUT_MS = 750;
const BANNER = "pi self-learning agent service";

/** Parse the port from an HTTP endpoint (null when it is not an HTTP URL). */
export function endpointPort(endpoint: string): number | null {
	try {
		const u = new URL(endpoint);
		if (u.protocol !== "http:" && u.protocol !== "https:") return null;
		if (u.port) {
			const n = Number(u.port);
			return Number.isInteger(n) && n > 0 ? n : null;
		}
		return u.protocol === "https:" ? 443 : 80;
	} catch {
		return null;
	}
}

/**
 * Best-effort "which process owns this listening port?" — diagnostics only.
 * The precedent is scripts/stop.ts's netstat/lsof fallbacks. Never throws;
 * a missing tool or an unreadable table is null, not an error.
 */
export function portOwnerPid(port: number, platform: NodeJS.Platform = process.platform): number | null {
	if (!Number.isInteger(port) || port <= 0) return null;
	const opts = { encoding: "utf8" as const, windowsHide: true, timeout: 1500 };
	if (platform === "win32") {
		try {
			const r = spawnSync("netstat", ["-ano", "-p", "tcp"], opts);
			if (r.error || r.status !== 0 || !r.stdout) return null;
			for (const line of String(r.stdout).split(/\r?\n/)) {
				const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
				if (m && Number(m[1]) === port) {
					const pid = Number(m[2]);
					return Number.isInteger(pid) && pid > 0 ? pid : null;
				}
			}
		} catch {
			/* best effort */
		}
		return null;
	}
	if (platform === "darwin") {
		try {
			const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], opts);
			if (r.error || r.status !== 0 || !r.stdout) return null;
			for (const tok of String(r.stdout).split(/\s+/)) {
				const pid = Number(tok);
				if (Number.isInteger(pid) && pid > 0) return pid;
			}
		} catch {
			/* best effort */
		}
		return null;
	}
	// Linux (and other unices with ss/lsof). Prefer ss; it is the modern
	// /proc view and prints pid= only for processes this user can see.
	try {
		const ss = spawnSync("ss", ["-ltnp"], opts);
		if (!ss.error && ss.status === 0 && ss.stdout) {
			for (const line of String(ss.stdout).split(/\r?\n/)) {
				if (!new RegExp(`:${port}\\s`).test(line)) continue;
				const m = line.match(/pid=(\d+)/);
				if (m) {
					const pid = Number(m[1]);
					if (Number.isInteger(pid) && pid > 0) return pid;
				}
			}
		}
	} catch {
		/* fall through to lsof */
	}
	try {
		const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], opts);
		if (!r.error && r.status === 0 && r.stdout) {
			for (const tok of String(r.stdout).split(/\s+/)) {
				const pid = Number(tok);
				if (Number.isInteger(pid) && pid > 0) return pid;
			}
		}
	} catch {
		/* best effort */
	}
	return null;
}

function errorCode(err: unknown): string {
	const e = err as any;
	return String(e?.code ?? e?.cause?.code ?? e?.errno ?? "");
}

function errorText(err: unknown): string {
	if (err instanceof Error) {
		const cause = (err as any)?.cause;
		return `${err.name}: ${err.message}${cause instanceof Error ? ` (${cause.message})` : ""}`;
	}
	return String(err);
}

/** Classify a thrown fetch: only a loopback connection refusal is spawnable. */
function classifyFetchError(err: unknown, endpoint: string): "refused" | "unreachable" {
	const code = errorCode(err);
	const text = errorText(err);
	if (/ECONNREFUSED|ConnectionRefused/i.test(code) || /ECONNREFUSED|ConnectionRefused/i.test(text)) {
		return "refused";
	}
	// Bun's loopback refusal is a TypeError whose message is "Unable to
	// connect…" with no code. Restrict the message-only match to loopback
	// endpoints: a remote DNS/TLS failure must not authorise a spawn.
	let loopback = false;
	try {
		const host = new URL(endpoint).hostname;
		loopback = host === "localhost" || host === "::1" || /^127\./.test(host);
	} catch {
		/* not a URL — no message-only refusal */
	}
	if (loopback && /Unable to connect/i.test(text)) return "refused";
	return "unreachable";
}

function ownerFromHeaders(headers: Headers): EngineOwner | undefined {
	const rawPid = Number(headers.get("x-unown-pid") ?? "");
	const installId = headers.get("x-unown-install-id") ?? undefined;
	const installMode = headers.get("x-unown-install-mode") ?? undefined;
	const installRoot = headers.get("x-unown-install-root") ?? undefined;
	const version = headers.get("x-unown-version") ?? undefined;
	const pid = Number.isInteger(rawPid) && rawPid > 0 ? rawPid : undefined;
	if (!pid && !installId && !version) return undefined;
	return { pid, installId, installMode, installRoot, version, source: "headers" };
}

function versionFromBody(body: any): EngineProbeVersion | undefined {
	const v = body?.version;
	if (!v || typeof v !== "object") return undefined;
	const api = Number(v.api);
	return {
		version: typeof v.version === "string" ? v.version : undefined,
		gitSha: typeof v.gitSha === "string" ? v.gitSha : null,
		api: Number.isFinite(api) ? api : undefined,
	};
}

async function bannerAnswers(doFetch: ProbeFetch, endpoint: string, timeoutMs: number): Promise<boolean> {
	try {
		const res = await doFetch(`${endpoint}/`, {
			signal: AbortSignal.timeout(Math.min(timeoutMs, BANNER_TIMEOUT_MS)),
		});
		if (!res.ok) return false;
		const text = await res.text();
		return text.includes(BANNER);
	} catch {
		return false;
	}
}

/**
 * Probe once and classify. Never throws, never spawns.
 *
 * `fetchImpl` is the authenticated overview fetch (engineFetch by default);
 * `bannerFetch` is the unauthenticated GET / identity check (global fetch by
 * default — it must not attach the bearer).
 */
export async function probeEngine(opts: ProbeEngineOptions): Promise<EngineProbe> {
	const endpoint = opts.endpoint.replace(/\/+$/, "");
	const timeoutMs =
		Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) >= 100
			? Math.floor(opts.timeoutMs as number)
			: DEFAULT_TIMEOUT_MS;
	const doFetch: ProbeFetch = opts.fetchImpl ?? engineFetch;
	const doBanner: ProbeFetch = opts.bannerFetch ?? ((url, init) => fetch(url, init as RequestInit));
	const port = endpointPort(endpoint);
	const portPid = () => {
		if (!port) return undefined;
		const pid = (opts.portOwner ?? portOwnerPid)(port);
		return Number.isInteger(pid) && (pid as number) > 0 ? (pid as number) : undefined;
	};
	const ownerFromPort = (): EngineOwner | undefined => {
		const pid = portPid();
		return pid ? { pid, source: "port" } : undefined;
	};

	let res: Response;
	try {
		res = await doFetch(`${endpoint}/api/overview`, { signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		const kind = classifyFetchError(err, endpoint);
		if (kind === "refused") {
			return {
				kind,
				endpoint,
				banner: false,
				detail: `nothing is listening on ${endpoint}`,
				remediation: "unown engine start (auto-start is allowed only for a refused port)",
			};
		}
		return {
			kind,
			endpoint,
			banner: false,
			detail: `no answer from ${endpoint} within ${timeoutMs}ms (${errorText(err)})`,
			remediation: "do not spawn while the port may be hung; inspect .run/engine.log and the port owner",
		};
	}

	const status = res.status;
	const headersOwner = ownerFromHeaders(res.headers);
	const banner = await bannerAnswers(doBanner, endpoint, timeoutMs);
	const owner = headersOwner ?? ownerFromPort() ?? (banner ? { source: "banner" as const } : undefined);
	// A non-2xx engine still tells us WHY in its JSON error body. Keep it:
	// "HTTP 500" alone sent users to the wrong place (the old doctor read
	// the body only on the res.ok path and printed empty stats).
	let errorDetail = "";
	if (!res.ok) {
		try {
			const b: any = await res.clone().json();
			if (b?.error) errorDetail = `: ${String(b.error).slice(0, 120)}`;
		} catch {
			/* non-JSON error page — status only */
		}
	}

	if (status === 401 || status === 403) {
		return {
			kind: "unauthorized",
			endpoint,
			status,
			banner,
			owner,
			detail: `an engine answered but rejected this CLI's token (HTTP ${status})`,
			remediation:
				"use the owning install's CLI, or set UNOWN_ENGINE_TOKEN to the engine's token; no engine was started",
		};
	}

	if (res.ok) {
		let body: any = undefined;
		try {
			body = await res.json();
		} catch {
			body = undefined;
		}
		if (body && body.ok === true) {
			const version = versionFromBody(body);
			if (version?.api !== undefined && version.api > ENGINE_API_VERSION) {
				return {
					kind: "incompatible",
					endpoint,
					status,
					banner,
					owner,
					version,
					detail: `engine speaks API ${version.api}; this CLI speaks API ${ENGINE_API_VERSION}`,
					remediation: "restart the engine from its owning install, or update this CLI",
				};
			}
			return {
				kind: "ok",
				endpoint,
				status,
				banner,
				owner,
				version,
				body,
				detail: "engine answered with a compatible overview",
			};
		}
	}

	const why = banner
		? "an Unown engine answered but not with the expected API shape"
		: "the port is held by a process that is not the Unown engine";
	return {
		kind: banner ? "incompatible" : "occupied",
		endpoint,
		status,
		banner,
		owner,
		detail: `${why} (HTTP ${status}${errorDetail})`,
		remediation: banner
			? "restart that engine from its owning install; do not spawn a second one"
			: "identify and stop the port owner, or point UNOWN_ENGINE_URL/PI_AGENT_PORT elsewhere",
	};
}

/** One-line owner description shared by status/doctor copy. */
export function describeEngineOwner(owner: EngineOwner | undefined): string {
	if (!owner) return "owner unknown";
	const bits: string[] = [];
	if (owner.pid) bits.push(`pid ${owner.pid}`);
	if (owner.version) bits.push(`v${owner.version}`);
	if (owner.installId) bits.push(`install ${owner.installId}`);
	if (owner.installRoot) bits.push(owner.installRoot);
	return bits.length > 0 ? bits.join(" · ") : `owner via ${owner.source}`;
}
