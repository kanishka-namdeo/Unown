/**
 * browser/captcha.ts — the CAPTCHA tier (v2 browser automation).
 *
 * A detect → classify → solve → verify pipeline, reverse-engineered from how
 * the shipping products handle it (Steel's documented pipeline; Browser Use's
 * auto-solve default; Skyvern's prevention-first ladder) and from the
 * October-2026 vendor landscape (verified live during research):
 *
 *   - 2Captcha (in.php/res.php REST): reCAPTCHA v2, Turnstile, DataDome,
 *     AWS WAF, image-to-text. hCaptcha: DROPPED by every major vendor
 *     (2captcha's hCaptcha page 404s as of 2026-10) — we say so instead of
 *     pretending.
 *   - CapSolver (createTask/getTaskResult JSON): RecaptchaV2TaskProxyLess,
 *     AntiTurnstileTaskProxyLess, AntiAwsWafTaskProxyLess, ImageToTextTask.
 *   - Vision OCR: any OpenAI-compatible image-capable endpoint (the default
 *     preset is Agnes AI's agnes-3.0-flash) reads image CAPTCHAs off a
 *     clipped screenshot — the free tier of the pipeline.
 *
 * Detection runs in the ISOLATED world (works identically in stealth and
 * classic modes, never touching page JS state). Solvers are transport-
 * injectable for hermetic unit tests; live keys are only read from env.
 */

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

export interface CaptchaConfig {
	solver: "2captcha" | "capsolver" | "none";
	twoCaptchaKey?: string;
	capSolverKey?: string;
	/** auto-attempt solving after navigate */
	auto: boolean;
	/** vision OCR tier on (needs a vision key) */
	vision: boolean;
	visionBaseUrl?: string;
	visionApiKey?: string;
	visionModel?: string;
}

/** Default vision endpoint: the Agnes AI preset this repo ships with. */
export const DEFAULT_VISION_BASE_URL = "https://apihub.agnes-ai.com/v1";
export const DEFAULT_VISION_MODEL = "agnes-3.0-flash";

/** Resolve the captcha config from a browserEnv-shaped object. */
export function resolveCaptchaConfig(env: {
	captchaSolver?: string;
	twoCaptchaKey?: string;
	capSolverKey?: string;
	captchaAuto: boolean;
	captchaVision?: string;
	visionBaseUrl?: string;
	visionApiKey?: string;
	visionModel?: string;
}): CaptchaConfig {
	const explicit = (env.captchaSolver ?? "").toLowerCase();
	let solver: CaptchaConfig["solver"];
	if (explicit === "none") solver = "none";
	else if (explicit === "2captcha" || explicit === "2captcha" || explicit === "twocaptcha") solver = "2captcha";
	else if (explicit === "capsolver") solver = "capsolver";
	// auto: pick whichever service has a key (2captcha first — broadest type
	// coverage incl. DataDome)
	else if (env.twoCaptchaKey) solver = "2captcha";
	else if (env.capSolverKey) solver = "capsolver";
	else solver = "none";
	const visionKey = env.visionApiKey?.trim() || undefined;
	return {
		solver,
		twoCaptchaKey: env.twoCaptchaKey?.trim() || undefined,
		capSolverKey: env.capSolverKey?.trim() || undefined,
		auto: env.captchaAuto,
		vision: env.captchaVision !== "0" && !!visionKey,
		visionBaseUrl: env.visionBaseUrl?.trim() || (visionKey ? DEFAULT_VISION_BASE_URL : undefined),
		visionApiKey: visionKey,
		visionModel: env.visionModel?.trim() || DEFAULT_VISION_MODEL,
	};
}

// ---------------------------------------------------------------------------
// detection — the in-page probe (plain JS, .toString()'d into the page)
// ---------------------------------------------------------------------------

/** A detected challenge. */
export interface DetectedChallenge {
	type:
		| "cloudflare-turnstile"
		| "cloudflare-challenge"
		| "recaptcha-v2"
		| "recaptcha-v3"
		| "hcaptcha"
		| "datadome"
		| "awswaf"
		| "geetest"
		| "funcaptcha"
		| "image-captcha";
	/** vendor sitekey where derivable */
	sitekey?: string;
	/** extra human hints (iframe count, heuristic basis) */
	note?: string;
	/** for image-captcha: a CSS selector for the image element */
	imageSelector?: string;
	/** for datadome: the captcha-delivery iframe URL the service needs */
	iframeUrl?: string;
	/** for recaptcha-v3: the site's action name (grecaptcha.render action) */
	action?: string;
	/** for image-captcha: a CSS selector for the answer input */
	inputSelector?: string;
}

/**
 * The detector. Must stay plain ES2019 JS — it is serialized into the page
 * (isolated world) via `captchaProbe.toString()`. Reads only DOM + location.
 */
function captchaProbe(): any {
	const doc = (globalThis as any).document;
	const out: any[] = [];
	const push = (o: any) => out.push(o);

	// --- Cloudflare Turnstile (widget) ---
	let ts: any = doc.querySelector(".cf-turnstile[data-sitekey], [data-sitekey].cf-turnstile");
	if (!ts) {
		for (const el of doc.querySelectorAll(".cf-turnstile")) {
			ts = el;
			break;
		}
	}
	const tsIframe = doc.querySelector('iframe[src*="challenges.cloudflare.com"]');
	const tsInput = doc.querySelector('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]');
	if (ts || tsIframe || tsInput) {
		const key = ts?.getAttribute("data-sitekey") || "";
		if (key) push({ type: "cloudflare-turnstile", sitekey: key });
		else push({ type: "cloudflare-turnstile", note: "sitekey not in DOM (managed/invisible)" });
	}

	// --- Cloudflare full-page challenge / WAF block ---
	const cfChallenge = doc.querySelector(
		"#challenge-running, #challenge-stage, #cf-challenge-running, [class*='cf-browser-verification']",
	);
	const justAMoment = /just a moment|checking your browser|verify you are human/i.test(
		`${doc.title} ${doc.body ? doc.body.innerText.slice(0, 800) : ""}`,
	);
	if (cfChallenge || (justAMoment && (tsIframe || tsInput))) {
		push({
			type: "cloudflare-challenge",
			note: "full-page interstitial — usually clears itself when the fingerprint is coherent; wait, then re-check",
		});
	}

	// --- reCAPTCHA v2 (checkbox/invisible widget) ---
	const gWidget = doc.querySelector(".g-recaptcha[data-sitekey], #recaptcha[data-sitekey]");
	const gResponse = doc.querySelector("#g-recaptcha-response, textarea.g-recaptcha-response");
	const gAnchor = doc.querySelector(
		'iframe[src*="google.com/recaptcha/api2/anchor"], iframe[src*="google.com/recaptcha/"], iframe[title="reCAPTCHA"]',
	);
	if (gWidget || gResponse || gAnchor) {
		const key = gWidget?.getAttribute("data-sitekey") || "";
		if (key) push({ type: "recaptcha-v2", sitekey: key });
		else push({ type: "recaptcha-v2", note: "sitekey not found in widget attributes" });
	}

	// --- reCAPTCHA v3 (score-based, script-only) ---
	const g3 = doc.querySelector('script[src*="recaptcha/api.js"][src*="render="]');
	if (g3 && !gWidget && !gAnchor) {
		const m = /render=([0-9A-Za-z_-]{20,})/.exec(g3.getAttribute("src") || "");
		push(
			m
				? {
						type: "recaptcha-v3",
						sitekey: m[1],
						note: "score-based — no widget; token comes from a solver service",
					}
				: { type: "recaptcha-v3", note: "score-based" },
		);
	}

	// --- hCaptcha ---
	const hWidget = doc.querySelector(".h-captcha[data-sitekey], [data-hcaptcha-widget-id]");
	const hIframe = doc.querySelector('iframe[src*="hcaptcha.com"]');
	if (hWidget || hIframe) {
		const key = hWidget?.getAttribute("data-sitekey") || "";
		push({
			type: "hcaptcha",
			sitekey: key,
			note: "major solving services dropped hCaptcha in 2026 — native click or human takeover only",
		});
	}

	// --- DataDome ---
	const ddFrame = doc.querySelector('iframe[src*="captcha-delivery.com"]');
	if (ddFrame || doc.querySelector('script[src*="captcha-delivery.com"]')) {
		push({
			type: "datadome",
			note: "service tier needs the captcha-delivery URL",
			iframeUrl: ddFrame ? ddFrame.src : location.href,
		});
	}

	// --- AWS WAF ---
	if (doc.querySelector('iframe[src*=".awswaf.com"], script[src*=".awswaf.com"]')) {
		push({ type: "awswaf", note: "token injection into the awswaf JS challenge" });
	}

	// --- GeeTest ---
	if (doc.querySelector(".geetest_holder, .geetest_box, script[src*='geetest']")) {
		push({ type: "geetest", note: "slider challenge — service support varies" });
	}

	// --- Arkose / FunCaptcha ---
	if (doc.querySelector('iframe[src*="funcaptcha"], iframe[src*="arkoselabs"], script[src*="arkoselabs"]')) {
		push({ type: "funcaptcha", note: "Arkose Labs — service support varies (2captcha/capsolver have paid tiers)" });
	}

	// --- plain image-captcha heuristic: an <img> with captcha-ish naming
	// next to a text input inside a form ---
	const forms = doc.querySelectorAll("form");
	for (const form of forms) {
		const img = form.querySelector("img");
		if (!img) continue;
		const sig = (
			(img.id || "") +
			" " +
			(img.className || "") +
			" " +
			(img.getAttribute("name") || "") +
			" " +
			(img.getAttribute("src") || "") +
			" " +
			(img.alt || "")
		).toLowerCase();
		if (!/captcha|verif|secur|kode|kaptcha|challenge/.test(sig)) continue;
		const input = form.querySelector('input[type="text"], input:not([type])');
		if (!input) continue;
		const mk = (el: any) => {
			if (el.id) return `#${el.id}`;
			if (el.getAttribute("name")) return `[name="${el.getAttribute("name")}"]`;
			return null;
		};
		const imageSelector = mk(img);
		const inputSelector = mk(input);
		if (imageSelector && inputSelector) {
			push({
				type: "image-captcha",
				imageSelector,
				inputSelector,
				note: "heuristic match — vision OCR or solver image-to-text tier applies",
			});
		}
		break;
	}

	const blocked = !!cfChallenge || !!doc.querySelector('iframe[src*="captcha-delivery.com"]');
	return { challenges: out, blocked };
}

/** Serialized probe source (the pattern a11y.ts established). */
export const CAPTCHA_PROBE_SRC = `(${captchaProbe.toString()})()`;

// ---------------------------------------------------------------------------
// solver clients (transport-injectable)
// ---------------------------------------------------------------------------

export type FetchLike = (
	url: string,
	init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

// ---------------------------------------------------------------
// challenge → solver job mappers (pure — pinned by unit tests)
//
// The stress round's fix: every challenge type used to submit as a
// "turnstile" job (recaptcha-v3, datadome, awswaf and image-captcha
// included), so the documented service tiers never actually worked.
// These mappers are the ONE place the wire formats are decided.
// ---------------------------------------------------------------

/** Map a detected challenge onto a 2captcha submit job (null: no wire format). */
export function twoCaptchaJobFor(
	challenge: DetectedChallenge,
	pageUrl: string,
	imageBodyB64?: string,
): TwoCaptchaSubmit | null {
	switch (challenge.type) {
		case "recaptcha-v2":
			return { kind: "recaptcha-v2", sitekey: challenge.sitekey ?? "", pageUrl };
		case "recaptcha-v3":
			return { kind: "recaptcha-v3", sitekey: challenge.sitekey ?? "", pageUrl, action: challenge.action };
		case "cloudflare-turnstile":
			return { kind: "turnstile", sitekey: challenge.sitekey ?? "", pageUrl };
		case "awswaf":
			return { kind: "awswaf", sitekey: challenge.sitekey ?? "", pageUrl };
		case "datadome":
			return {
				kind: "datadome",
				sitekey: challenge.sitekey ?? "",
				pageUrl,
				captchaUrl: challenge.iframeUrl ?? pageUrl,
			};
		case "image-captcha":
			if (!imageBodyB64) return null;
			return { kind: "image", sitekey: "", pageUrl, imageBodyB64 };
		default:
			return null;
	}
}

/** Map a detected challenge onto a capsolver submit job (null: no wire format). */
export function capSolverJobFor(
	challenge: DetectedChallenge,
	pageUrl: string,
	imageBodyB64?: string,
): CapSolverSubmit | null {
	switch (challenge.type) {
		case "recaptcha-v2":
			return { kind: "recaptcha-v2", sitekey: challenge.sitekey ?? "", pageUrl };
		case "recaptcha-v3":
			return { kind: "recaptcha-v3", sitekey: challenge.sitekey ?? "", pageUrl, action: challenge.action };
		case "cloudflare-turnstile":
			return { kind: "turnstile", sitekey: challenge.sitekey ?? "", pageUrl };
		case "awswaf":
			return { kind: "awswaf", sitekey: challenge.sitekey ?? "", pageUrl };
		case "datadome":
			return {
				kind: "datadome",
				sitekey: challenge.sitekey ?? "",
				pageUrl,
				captchaUrl: challenge.iframeUrl ?? pageUrl,
			};
		case "image-captcha":
			if (!imageBodyB64) return null;
			return { kind: "image", sitekey: "", pageUrl, imageBodyB64 };
		default:
			return null;
	}
}

export class CaptchaServiceError extends Error {
	readonly service: string;
	constructor(message: string, service: string) {
		super(message);
		this.name = "CaptchaServiceError";
		this.service = service;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------- 2Captcha -------------------------------------

export interface TwoCaptchaSubmit {
	kind: "recaptcha-v2" | "recaptcha-v3" | "turnstile" | "image" | "datadome" | "awswaf";
	sitekey: string;
	pageUrl: string;
	/** base64 image body for kind=image */
	imageBodyB64?: string;
	/** the captcha-delivery URL for kind=datadome */
	captchaUrl?: string;
	/** the action for kind=recaptcha-v3 */
	action?: string;
	/** the score floor for kind=recaptcha-v3 (default 0.3) */
	minScore?: number;
}

/**
 * 2Captcha client: submit → poll. Docs: https://2captcha.com/2captcha-api
 * (verified pricing/type coverage during the 2026-10 research round).
 */
const DEFAULT_FETCH: FetchLike = (url, init) => fetch(url, init as any);

export class TwoCaptchaClient {
	private readonly apiKey: string;
	private readonly fetchFn: FetchLike;
	private readonly pollIntervalMs: number;
	private readonly deadlineMs: number;
	constructor(apiKey: string, fetchFn?: FetchLike, pollIntervalMs = 5_000, deadlineMs = 150_000) {
		this.apiKey = apiKey;
		this.fetchFn = fetchFn ?? DEFAULT_FETCH;
		this.pollIntervalMs = pollIntervalMs;
		this.deadlineMs = deadlineMs;
	}

	async submit(job: TwoCaptchaSubmit): Promise<string> {
		const form = new Map<string, string>([
			["key", this.apiKey],
			["json", "1"],
		]);
		switch (job.kind) {
			case "recaptcha-v2":
				form.set("method", "userrecaptcha");
				form.set("googlekey", job.sitekey);
				form.set("pageurl", job.pageUrl);
				break;
			case "recaptcha-v3":
				form.set("method", "userrecaptcha");
				form.set("googlekey", job.sitekey);
				form.set("pageurl", job.pageUrl);
				form.set("version", "v3");
				form.set("action", job.action ?? "");
				form.set("min_score", String(job.minScore ?? 0.3));
				break;
			case "turnstile":
				form.set("method", "turnstile");
				form.set("sitekey", job.sitekey);
				form.set("pageurl", job.pageUrl);
				break;
			case "image":
				form.set("method", "base64");
				form.set("body", job.imageBodyB64 ?? "");
				break;
			case "datadome":
				form.set("method", "datadome_captcha");
				form.set("captcha_url", job.captchaUrl ?? "");
				break;
			case "awswaf":
				form.set("method", "awswaf");
				form.set("sitekey", job.sitekey);
				form.set("pageurl", job.pageUrl);
				break;
		}
		const body = [...form.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
		const res = await this.fetchFn("https://2captcha.com/in.php", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		const text = await res.text();
		let json: any;
		try {
			json = JSON.parse(text);
		} catch {
			throw new CaptchaServiceError(
				`2captcha in.php returned non-JSON (${res.status}): ${text.slice(0, 160)}`,
				"2captcha",
			);
		}
		if (json.status !== 1) {
			throw new CaptchaServiceError(`2captcha submit rejected: ${json.request ?? text.slice(0, 160)}`, "2captcha");
		}
		return String(json.request);
	}

	/** Poll until the token is ready. Returns the token. */
	async poll(id: string, signal?: AbortSignal): Promise<string> {
		const deadline = Date.now() + this.deadlineMs;
		while (Date.now() < deadline) {
			if (signal?.aborted) throw new CaptchaServiceError("aborted", "2captcha");
			await sleep(this.pollIntervalMs);
			const res = await this.fetchFn(
				`https://2captcha.com/res.php?key=${encodeURIComponent(this.apiKey)}&action=get&id=${encodeURIComponent(id)}&json=1`,
			);
			const text = await res.text();
			let json: any;
			try {
				json = JSON.parse(text);
			} catch {
				throw new CaptchaServiceError(
					`2captcha res.php returned non-JSON (${res.status}): ${text.slice(0, 160)}`,
					"2captcha",
				);
			}
			if (json.status === 1) return String(json.request);
			if (json.request !== "CAPCHA_NOT_READY") {
				throw new CaptchaServiceError(`2captcha poll failed: ${json.request}`, "2captcha");
			}
		}
		throw new CaptchaServiceError(`2captcha: no solution within ${this.deadlineMs}ms (job ${id})`, "2captcha");
	}

	async solve(job: TwoCaptchaSubmit, signal?: AbortSignal): Promise<string> {
		return this.poll(await this.submit(job), signal);
	}
}

// ----------------------------- CapSolver ------------------------------------

export interface CapSolverSubmit {
	kind: "recaptcha-v2" | "recaptcha-v3" | "turnstile" | "image" | "awswaf" | "datadome";
	sitekey: string;
	pageUrl: string;
	imageBodyB64?: string;
	/** the captcha-delivery URL for kind=datadome */
	captchaUrl?: string;
	/** the action for kind=recaptcha-v3 */
	action?: string;
}

/** CapSolver client: createTask → getTaskResult. https://docs.capsolver.com */
export class CapSolverClient {
	private readonly apiKey: string;
	private readonly fetchFn: FetchLike;
	private readonly pollIntervalMs: number;
	private readonly deadlineMs: number;
	constructor(apiKey: string, fetchFn?: FetchLike, pollIntervalMs = 3_000, deadlineMs = 120_000) {
		this.apiKey = apiKey;
		this.fetchFn = fetchFn ?? DEFAULT_FETCH;
		this.pollIntervalMs = pollIntervalMs;
		this.deadlineMs = deadlineMs;
	}

	private async rpc(endpoint: string, payload: Record<string, unknown>): Promise<any> {
		const res = await this.fetchFn(`https://api.capsolver.com/${endpoint}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		const text = await res.text();
		let json: any;
		try {
			json = JSON.parse(text);
		} catch {
			throw new CaptchaServiceError(
				`capsolver ${endpoint} returned non-JSON (${res.status}): ${text.slice(0, 160)}`,
				"capsolver",
			);
		}
		if (json.errorId && json.errorId !== 0) {
			throw new CaptchaServiceError(
				`capsolver ${endpoint}: ${json.errorDescription ?? json.errorCode ?? "unknown error"}`,
				"capsolver",
			);
		}
		return json;
	}

	async submit(job: CapSolverSubmit): Promise<string> {
		const base = { websiteURL: job.pageUrl, websiteKey: job.sitekey };
		let task: Record<string, unknown>;
		switch (job.kind) {
			case "recaptcha-v2":
				task = { type: "RecaptchaV2TaskProxyLess", ...base };
				break;
			case "turnstile":
				task = { type: "AntiTurnstileTaskProxyLess", ...base };
				break;
			case "awswaf":
				task = { type: "AntiAwsWafTaskProxyLess", ...base };
				break;
			case "recaptcha-v3":
				task = { type: "RecaptchaV3TaskProxyLess", ...base, action: job.action ?? "" };
				break;
			case "datadome":
				task = { type: "DataDomeTaskProxyLess", ...base, captchaUrl: job.captchaUrl ?? job.pageUrl };
				break;
			case "image":
				task = { type: "ImageToTextTask", body: job.imageBodyB64 ?? "" };
				break;
		}
		const json = await this.rpc("createTask", { clientKey: this.apiKey, task });
		if (!json.taskId) throw new CaptchaServiceError("capsolver createTask returned no taskId", "capsolver");
		return String(json.taskId);
	}

	async poll(taskId: string, signal?: AbortSignal): Promise<string> {
		const deadline = Date.now() + this.deadlineMs;
		while (Date.now() < deadline) {
			if (signal?.aborted) throw new CaptchaServiceError("aborted", "capsolver");
			await sleep(this.pollIntervalMs);
			const json = await this.rpc("getTaskResult", { clientKey: this.apiKey, taskId });
			if (json.status === "ready") {
				const sol = json.solution ?? {};
				const token = sol.gRecaptcha ?? sol.token ?? sol.text ?? sol.userAgent;
				if (!token) throw new CaptchaServiceError("capsolver: ready but no token in solution", "capsolver");
				return String(token);
			}
			if (json.status !== "processing") {
				throw new CaptchaServiceError(`capsolver: unexpected status ${json.status}`, "capsolver");
			}
		}
		throw new CaptchaServiceError(`capsolver: no solution within ${this.deadlineMs}ms (task ${taskId})`, "capsolver");
	}

	async solve(job: CapSolverSubmit, signal?: AbortSignal): Promise<string> {
		return this.poll(await this.submit(job), signal);
	}
}

// ----------------------------- vision OCR ------------------------------------

/**
 * Read an image CAPTCHA through an OpenAI-compatible vision endpoint
 * (default preset: Agnes AI agnes-3.0-flash — image-capable, verified).
 * Sends ONLY the clipped captcha image, not the page.
 */
export async function visionReadCaptcha(
	base64Png: string,
	cfg: { baseUrl: string; apiKey: string; model: string },
	fetchFn: FetchLike,
	signal?: AbortSignal,
): Promise<string> {
	const res = await fetchFn(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
		body: JSON.stringify({
			model: cfg.model,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "This image contains a CAPTCHA challenge. Read the text or characters shown in the image. Reply with ONLY the characters, no explanation, no quotes. If there is a mathematical expression, reply with its result.",
						},
						{ type: "image_url", image_url: { url: `data:image/png;base64,${base64Png}` } },
					],
				},
			],
			max_tokens: 48,
			temperature: 0,
		}),
		signal,
	});
	const text = await res.text();
	if (!res.ok)
		throw new CaptchaServiceError(`vision endpoint responded ${res.status}: ${text.slice(0, 200)}`, "vision");
	let json: any;
	try {
		json = JSON.parse(text);
	} catch {
		throw new CaptchaServiceError(`vision endpoint returned non-JSON: ${text.slice(0, 160)}`, "vision");
	}
	const content = json?.choices?.[0]?.message?.content;
	if (!content) throw new CaptchaServiceError("vision endpoint returned no content", "vision");
	// strip to the plausible answer: the model is told to answer with only
	// the characters, but strip quotes/periods anyway
	return String(content)
		.replace(/^["'`\s]+|["'`.\s]+$/g, "")
		.trim();
}

// ---------------------------------------------------------------------------
// token injection — in-page (plain JS, isolated-world safe)
// ---------------------------------------------------------------------------

/**
 * Inject a solved token into the page's hidden response field(s) using
 * native setters + events (React/Vue-safe). Plain JS, serialized.
 */
function injectTokenFn(type: string, token: string): any {
	const doc = (globalThis as any).document;
	const fields: any[] = [];
	const collect = (sel: string) => fields.push(...doc.querySelectorAll(sel));
	if (type === "recaptcha-v2" || type === "recaptcha-v3") {
		collect("#g-recaptcha-response, textarea.g-recaptcha-response, [name='g-recaptcha-response']");
	}
	if (type === "cloudflare-turnstile") {
		collect(
			'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], [name="cf-turnstile-response"]',
		);
	}
	if (type === "hcaptcha") {
		collect('textarea[name="h-captcha-response"], [name="h-captcha-response"]');
	}
	let injected = 0;
	for (const el of fields) {
		const proto = (
			el.tagName === "TEXTAREA" ? (globalThis as any).HTMLTextAreaElement : (globalThis as any).HTMLInputElement
		).prototype;
		const desc = Object.getOwnPropertyDescriptor(proto, "value");
		try {
			el.value = token;
			if (desc?.set) desc.set.call(el, token);
		} catch {
			/* best effort */
		}
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
		injected++;
	}
	return { injected };
}

export const INJECT_TOKEN_SRC = `(${injectTokenFn.toString()})`;

/** Build the isolated-world injection expression for one (type, token). */
export function injectTokenExpression(type: string, token: string): string {
	return `${INJECT_TOKEN_SRC}(${JSON.stringify(type)}, ${JSON.stringify(token)})`;
}

// ---------------------------------------------------------------------------
// orchestration helpers (pure)
// ---------------------------------------------------------------------------

/** Which solver tiers apply to a challenge type — the honest capability map. */
export function tiersFor(type: DetectedChallenge["type"]): {
	native: boolean;
	service: "2captcha" | "capsolver" | "both" | "none";
	vision: boolean;
} {
	switch (type) {
		case "cloudflare-turnstile":
			return { native: true, service: "both", vision: false };
		case "cloudflare-challenge":
			// interstitials clear via coherent fingerprint, not token solving
			return { native: false, service: "none", vision: false };
		case "recaptcha-v2":
			return { native: true, service: "both", vision: false };
		case "recaptcha-v3":
			return { native: false, service: "both", vision: false };
		case "hcaptcha":
			// dropped by every major vendor as of 2026-10 (verified): native only
			return { native: true, service: "none", vision: false };
		case "datadome":
			return { native: false, service: "2captcha", vision: false };
		case "awswaf":
			return { native: false, service: "both", vision: false };
		case "geetest":
		case "funcaptcha":
			return { native: false, service: "none", vision: false };
		case "image-captcha":
			return { native: false, service: "both", vision: true };
	}
}

/** Render the challenge list for a tool result. */
export function formatChallenges(challenges: DetectedChallenge[], blocked: boolean): string {
	if (!challenges.length)
		return blocked ? "page looks blocked (challenge interstitial) but no widget matched" : "no captcha detected";
	const lines = challenges.map((c) => {
		const parts: string[] = [c.type];
		if (c.sitekey) parts.push(`sitekey=${c.sitekey}`);
		if (c.note) parts.push(c.note);
		return `- ${parts.join(" — ")}`;
	});
	return (blocked ? "PAGE IS BLOCKED by a challenge\n" : "") + lines.join("\n");
}
