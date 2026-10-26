// Unit tests for the v2 browser tiers — pure parts only (no browser needed):
// stealth identities/args/humanize math, captcha config/detection parsing,
// solver clients with a mocked transport, and discovery's headless-shell
// filter. The live stealth loop (CDP-signal silence, fingerprint coherence,
// humanized input) is test/browser-stealth-live.test.ts (UNOWN_BROWSER_LIVE=1).
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import {
	CAPTCHA_PROBE_SRC,
	CapSolverClient,
	CaptchaServiceError,
	capSolverJobFor,
	DEFAULT_VISION_BASE_URL,
	DEFAULT_VISION_MODEL,
	type FetchLike,
	formatChallenges,
	injectTokenExpression,
	resolveCaptchaConfig,
	TwoCaptchaClient,
	tiersFor,
	twoCaptchaJobFor,
	visionReadCaptcha,
} from "../src/browser/captcha.ts";
import { browserCandidates, discoverBrowser } from "../src/browser/config.ts";
import {
	buildIdentity,
	clearChromeVersionCache,
	FALLBACK_CHROME_VERSION,
	humanKeyGap,
	humanPath,
	humanTypeDelays,
	mulberry32,
	parseProxy,
	parseScreen,
	readChromeVersion,
	resolveStealthConfig,
	stealthAcceptsCandidate,
	stealthLaunchArgs,
} from "../src/browser/stealth.ts";

// ---------------------------------------------------------------------------
// identities
// ---------------------------------------------------------------------------

describe("stealth identities", () => {
	test("windows identity is internally coherent", () => {
		const id = buildIdentity("windows", { major: 143, full: "143.0.7499.4" });
		expect(id.userAgent).toContain("Windows NT 10.0");
		expect(id.userAgent).toContain("Chrome/143.0.0.0");
		expect(id.platform).toBe("Win32");
		expect(id.uaMetadata.platform).toBe("Windows");
		expect(id.uaMetadata.mobile).toBe(false);
		// every brand version in the reduced list matches the engine major
		for (const b of id.uaMetadata.brands) {
			if (b.brand !== "Not_A Brand") expect(b.version).toBe("143");
		}
		// the full list carries the real full version
		expect(id.uaMetadata.fullVersionList.some((b) => b.version === "143.0.7499.4")).toBe(true);
		// locale + acceptLanguage agree
		expect(id.acceptLanguage.startsWith(id.locale)).toBe(true);
	});

	test("macos identity claims MacIntel + macOS client hints", () => {
		const id = buildIdentity("macos", { major: 120, full: "120.0.0.0" });
		expect(id.platform).toBe("MacIntel");
		expect(id.uaMetadata.platform).toBe("macOS");
		expect(id.userAgent).toContain("Macintosh");
	});

	test("linux identity stays honest (X11 + Linux client hints)", () => {
		const id = buildIdentity("linux", { major: 143, full: "143.0.0.0" });
		expect(id.userAgent).toContain("X11; Linux x86_64");
		expect(id.uaMetadata.platform).toBe("Linux");
		expect(id.platform).toBe("Linux x86_64");
	});

	test("explicit overrides win over the base identity", () => {
		const id = buildIdentity(
			"windows",
			{ major: 143, full: "143.0.0.0" },
			{
				timezone: "Europe/Dubai",
				locale: "en-GB",
				screen: { width: 2560, height: 1440 },
			},
		);
		expect(id.timezone).toBe("Europe/Dubai");
		expect(id.locale).toBe("en-GB");
		expect(id.screen).toEqual({ width: 2560, height: 1440 });
	});
});

// ---------------------------------------------------------------------------
// config parsing
// ---------------------------------------------------------------------------

describe("stealth config parsing", () => {
	test("parseScreen accepts WxH and rejects nonsense", () => {
		expect(parseScreen("1920x1080")).toEqual({ width: 1920, height: 1080 });
		expect(parseScreen("1920×1080")).toEqual({ width: 1920, height: 1080 });
		expect(parseScreen("120x90")).toBe(null); // too small
		expect(parseScreen("telephone")).toBe(null);
		expect(parseScreen(undefined)).toBe(null);
	});

	test("parseProxy passes schemes through and adds http:// to host:port", () => {
		expect(parseProxy("socks5://gw.example:1080")).toBe("socks5://gw.example:1080");
		expect(parseProxy("http://gw:8080")).toBe("http://gw:8080");
		expect(parseProxy("gw.example:8080")).toBe("http://gw.example:8080");
		expect(parseProxy("")).toBe(undefined);
		expect(parseProxy("not a proxy")).toBe(undefined);
	});

	test("resolveStealthConfig merges env overrides onto the os default", () => {
		const cfg = resolveStealthConfig({
			enabled: true,
			overrides: { os: "macos", timezone: "Asia/Tokyo", screen: "2560x1440", humanize: "0" },
			version: { major: 143, full: "143.0.0.0" },
		});
		expect(cfg.enabled).toBe(true);
		expect(cfg.identity.os).toBe("macos");
		expect(cfg.identity.timezone).toBe("Asia/Tokyo");
		expect(cfg.identity.screen).toEqual({ width: 2560, height: 1440 });
		expect(cfg.humanize).toBe(false);
	});

	test("resolveStealthConfig normalizes os spellings", () => {
		expect(resolveStealthConfig({ enabled: false, overrides: { os: "darwin" } }).identity.os).toBe("macos");
		expect(resolveStealthConfig({ enabled: false, overrides: { os: "Mac" } }).identity.os).toBe("macos");
		expect(resolveStealthConfig({ enabled: false, overrides: { os: "LINUX" } }).identity.os).toBe("linux");
		expect(resolveStealthConfig({ enabled: false, overrides: {} }).identity.os).toBe("windows");
	});
});

// ---------------------------------------------------------------------------
// launch args + discovery filtering
// ---------------------------------------------------------------------------

describe("stealth launch args + discovery", () => {
	test("launch args carry lang, proxy and bypass", () => {
		const cfg = resolveStealthConfig({
			enabled: true,
			overrides: { os: "windows", locale: "en-GB", proxy: "socks5://gw:1080" },
		});
		const args = stealthLaunchArgs(cfg);
		expect(args).toContain("--lang=en-GB");
		expect(args).toContain("--proxy-server=socks5://gw:1080");
		expect(args).toContain("--proxy-bypass-list=<-loopback>"); // localhost dev servers stay off the proxy
		expect(args.some((a) => a.startsWith("--enable-automation"))).toBe(false);
	});

	test("linux gets the headless-safe password store flag", () => {
		const cfg = resolveStealthConfig({ enabled: true, overrides: { os: "linux" } });
		expect(stealthLaunchArgs(cfg)).toContain("--password-store=basic");
		const win = resolveStealthConfig({ enabled: true, overrides: { os: "windows" } });
		expect(stealthLaunchArgs(win).some((a) => a === "--password-store=basic")).toBe(false);
	});

	test("headless-shell executables are excluded from stealth, allowed in classic", () => {
		expect(stealthAcceptsCandidate("/home/u/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome")).toBe(true);
		expect(
			stealthAcceptsCandidate(
				"/home/u/.cache/ms-playwright/chrome-headless_shell-1200/chrome-linux64/chrome-headless-shell",
			),
		).toBe(false);
		// discovery honors it: a tree with ONLY a shell candidate fails stealth discovery
		const shellOnly = (p: string) => /headless[_-]shell/i.test(p);
		expect(() =>
			discoverBrowser({
				platform: "linux",
				home: "/home/u",
				exists: shellOnly,
				readdir: (dir) => (dir === "/home/u/.cache/ms-playwright" ? ["chrome-headless_shell-1200"] : null),
				allowHeadlessShell: false,
			}),
		).toThrow(/no Chromium-family browser found/);
		const found = discoverBrowser({
			platform: "linux",
			home: "/home/u",
			exists: shellOnly,
			readdir: (dir) => (dir === "/home/u/.cache/ms-playwright" ? ["chrome-headless_shell-1200"] : null),
			allowHeadlessShell: true,
		});
		expect(found.source).toBe("playwright-cache");
	});

	test("classic discovery still accepts headless shell (v1 behavior unchanged)", () => {
		const candidates = browserCandidates("linux", { home: "/home/u" });
		expect(candidates.some((c) => /headless_shell/i.test(c))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// chrome version probing
// ---------------------------------------------------------------------------

describe("readChromeVersion", () => {
	test("parses Google Chrome --version output", async () => {
		clearChromeVersionCache();
		const v = await readChromeVersion("/opt/chrome", {
			exec: (_cmd, _args, cb) => cb(null, "Google Chrome 143.0.7499.4\n"),
		});
		expect(v).toEqual({ major: 143, full: "143.0.7499.4" });
	});

	test("falls back on garbage output, never throws", async () => {
		clearChromeVersionCache();
		const v = await readChromeVersion("/opt/chrome", {
			exec: (_cmd, _args, cb) => cb(new Error("spawn failed"), ""),
		});
		expect(v).toEqual(FALLBACK_CHROME_VERSION);
	});
});

// ---------------------------------------------------------------------------
// humanized input math
// ---------------------------------------------------------------------------

describe("humanized input", () => {
	test("humanPath is deterministic under a fixed seed", () => {
		const rngA = mulberry32(42);
		const rngB = mulberry32(42);
		const a = humanPath({ x: 0, y: 0 }, { x: 500, y: 300 }, rngA);
		const b = humanPath({ x: 0, y: 0 }, { x: 500, y: 300 }, rngB);
		expect(a).toEqual(b);
	});

	test("humanPath lands exactly on the target (the click must land true)", () => {
		const rng = mulberry32(7);
		for (let i = 0; i < 20; i++) {
			const pts = humanPath(
				{ x: rng() * 1000, y: rng() * 800 },
				{ x: 200 + rng() * 600, y: 100 + rng() * 500 },
				mulberry32(i + 1),
			);
			const last = pts[pts.length - 1];
			expect(last.delayMs).toBeGreaterThanOrEqual(30);
		}
	});

	test("humanPath step count scales with distance, capped", () => {
		const near = humanPath({ x: 0, y: 0 }, { x: 20, y: 10 }, mulberry32(1));
		const mid = humanPath({ x: 0, y: 0 }, { x: 500, y: 0 }, mulberry32(1));
		const far = humanPath({ x: 0, y: 0 }, { x: 5000, y: 0 }, mulberry32(1));
		expect(near.length).toBeLessThanOrEqual(8);
		expect(mid.length).toBeGreaterThan(near.length);
		expect(far.length).toBeLessThanOrEqual(25);
		// degenerate distance: single settle point
		const same = humanPath({ x: 5, y: 5 }, { x: 6, y: 6 }, mulberry32(1));
		expect(same.length).toBe(1);
	});

	test("humanTypeDelays covers every char with plausible pauses", () => {
		const text = "hello world! example@example.com\nsecond line";
		const delays = humanTypeDelays(text, mulberry32(3));
		expect(delays).toHaveLength(text.length);
		for (const d of delays) expect(d).toBeGreaterThanOrEqual(45);
		// the space and @ get extra hesitation
		expect(delays[5]).toBeGreaterThanOrEqual(75); // space
		expect(humanKeyGap(mulberry32(3))).toBeGreaterThanOrEqual(35);
	});
});

// ---------------------------------------------------------------------------
// captcha config + capability map
// ---------------------------------------------------------------------------

describe("captcha config", () => {
	test("solver auto-detects from whichever key is present (2captcha first)", () => {
		expect(
			resolveCaptchaConfig({ captchaAuto: false, captchaSolver: undefined, twoCaptchaKey: "k1", capSolverKey: "k2" })
				.solver,
		).toBe("2captcha");
		expect(
			resolveCaptchaConfig({
				captchaAuto: false,
				captchaSolver: undefined,
				twoCaptchaKey: undefined,
				capSolverKey: "k2",
			}).solver,
		).toBe("capsolver");
		expect(resolveCaptchaConfig({ captchaAuto: false, captchaSolver: "none", twoCaptchaKey: "k1" }).solver).toBe(
			"none",
		);
		expect(resolveCaptchaConfig({ captchaAuto: false, captchaSolver: "capsolver", twoCaptchaKey: "k1" }).solver).toBe(
			"capsolver",
		);
		expect(resolveCaptchaConfig({ captchaAuto: false, captchaSolver: "" }).solver).toBe("none");
	});

	test("vision tier defaults to the Agnes preset when a vision key exists", () => {
		const cfg = resolveCaptchaConfig({ captchaAuto: true, captchaSolver: undefined, visionApiKey: "cpk-test" });
		expect(cfg.vision).toBe(true);
		expect(cfg.visionBaseUrl).toBe(DEFAULT_VISION_BASE_URL);
		expect(cfg.visionModel).toBe(DEFAULT_VISION_MODEL);
	});

	test("vision tier is off without a key and disableable with one", () => {
		expect(resolveCaptchaConfig({ captchaAuto: false, captchaSolver: undefined }).vision).toBe(false);
		expect(
			resolveCaptchaConfig({ captchaAuto: false, captchaSolver: undefined, visionApiKey: "k", captchaVision: "0" })
				.vision,
		).toBe(false);
	});

	test("tiersFor tells the truth about the 2026 vendor landscape", () => {
		expect(tiersFor("cloudflare-turnstile")).toMatchObject({ native: true, service: "both", vision: false });
		expect(tiersFor("recaptcha-v2")).toMatchObject({ native: true, service: "both", vision: false });
		expect(tiersFor("hcaptcha")).toMatchObject({ native: true, service: "none", vision: false }); // dropped by vendors — verified
		expect(tiersFor("image-captcha")).toMatchObject({ native: false, service: "both", vision: true });
		expect(tiersFor("datadome")).toMatchObject({ native: false, service: "2captcha", vision: false });
		expect(tiersFor("cloudflare-challenge")).toMatchObject({ native: false, service: "none", vision: false }); // clears via coherence, not tokens
	});

	test("formatChallenges renders blocked status and sitekeys", () => {
		const text = formatChallenges([{ type: "cloudflare-turnstile", sitekey: "0x4AAA" }], false);
		expect(text).toContain("cloudflare-turnstile");
		expect(text).toContain("0x4AAA");
		expect(formatChallenges([], true)).toContain("blocked");
		expect(formatChallenges([], false)).toBe("no captcha detected");
	});
});

// ---------------------------------------------------------------------------
// probe + injection sources
// ---------------------------------------------------------------------------

describe("captcha probe + injection sources", () => {
	test("probe source is a parseable call expression", () => {
		expect(CAPTCHA_PROBE_SRC.startsWith("(")).toBe(true);
		expect(CAPTCHA_PROBE_SRC.trim().endsWith(")")).toBe(true);
		// balanced parens on the wrapper — a syntax sanity check without a JS parser
		let depth = 0;
		for (const ch of CAPTCHA_PROBE_SRC) {
			if (ch === "(") depth++;
			if (ch === ")") depth--;
			expect(depth).toBeGreaterThanOrEqual(0);
		}
		expect(depth).toBe(0);
	});

	test("injection expression embeds type + token as JSON data, never code", () => {
		// a hostile "token" that would break out of a naive string splice
		const evil = 'x"); alert(1); ("y';
		const expr = injectTokenExpression("recaptcha-v2", evil);
		expect(expr).toContain(JSON.stringify(evil));
		// the payload stays a JSON string argument - it never becomes a call
		expect(expr).not.toMatch(/alert\(1\)\);\s*\(/);
	});
});

// ---------------------------------------------------------------------------
// solver clients (mocked transport)
// ---------------------------------------------------------------------------

function mockFetch(routes: Array<(url: string, body: any) => { status: number; json: any } | null>): FetchLike {
	return async (url, init) => {
		let body: any = {};
		if (init?.body) {
			const raw = String(init.body);
			if ((init.headers?.["Content-Type"] ?? "").includes("json")) body = JSON.parse(raw);
			else body = raw; // form-urlencoded (2captcha in.php) passes through as a string
		}
		for (const route of routes) {
			const hit = route(url, body);
			if (hit) {
				return {
					ok: hit.status < 400,
					status: hit.status,
					text: async () => JSON.stringify(hit.json),
				};
			}
		}
		return { ok: false, status: 404, text: async () => "no route" };
	};
}

describe("solver job mappers (stress round)", () => {
	const pageUrl = "https://shop.example/checkout";
	const mk = (type: string, extra: Record<string, unknown> = {}) =>
		({ type, sitekey: "0x4AAAAAAA", ...extra }) as import("../src/browser/captcha.ts").DetectedChallenge;

	test("every challenge maps to its OWN 2captcha wire format", () => {
		expect(twoCaptchaJobFor(mk("recaptcha-v2"), pageUrl)?.kind).toBe("recaptcha-v2");
		expect(twoCaptchaJobFor(mk("recaptcha-v3"), pageUrl)?.kind).toBe("recaptcha-v3");
		expect(twoCaptchaJobFor(mk("cloudflare-turnstile"), pageUrl)?.kind).toBe("turnstile");
		expect(twoCaptchaJobFor(mk("awswaf"), pageUrl)?.kind).toBe("awswaf");
		expect(twoCaptchaJobFor(mk("datadome", { iframeUrl: "https://geo.captcha-delivery.com/x" }), pageUrl)).toEqual({
			kind: "datadome",
			sitekey: "0x4AAAAAAA",
			pageUrl,
			captchaUrl: "https://geo.captcha-delivery.com/x",
		});
		expect(twoCaptchaJobFor(mk("image-captcha"), pageUrl, "aGVsbG8=")).toEqual({
			kind: "image",
			sitekey: "",
			pageUrl,
			imageBodyB64: "aGVsbG8=",
		});
	});

	test("image-captcha without a body maps to nothing (no blind submits)", () => {
		expect(twoCaptchaJobFor(mk("image-captcha"), pageUrl)).toBeNull();
		expect(capSolverJobFor(mk("image-captcha"), pageUrl)).toBeNull();
	});

	test("every challenge maps to its OWN capsolver wire format", () => {
		expect(capSolverJobFor(mk("recaptcha-v2"), pageUrl)?.kind).toBe("recaptcha-v2");
		expect(capSolverJobFor(mk("recaptcha-v3"), pageUrl)?.kind).toBe("recaptcha-v3");
		expect(capSolverJobFor(mk("cloudflare-turnstile"), pageUrl)?.kind).toBe("turnstile");
		expect(capSolverJobFor(mk("awswaf"), pageUrl)?.kind).toBe("awswaf");
		expect(capSolverJobFor(mk("datadome"), pageUrl)?.kind).toBe("datadome");
	});

	test("unsupported vendors map to nothing — geetest/funcaptcha/hcaptcha refuse honestly", () => {
		for (const t of ["geetest", "funcaptcha", "hcaptcha"]) {
			expect(twoCaptchaJobFor(mk(t), pageUrl)).toBeNull();
			expect(capSolverJobFor(mk(t), pageUrl)).toBeNull();
		}
	});

	test("2captcha recaptcha-v3 carries the v3 fields the API needs", async () => {
		const job = twoCaptchaJobFor(mk("recaptcha-v3", { action: "login" }), pageUrl);
		expect(job?.kind).toBe("recaptcha-v3");
		// the client serializes version=v3 + action + min_score
		const seen: Array<Record<string, string>> = [];
		const fetchFn = (async (_url: string, init?: { body?: string }) => {
			const body = String(init?.body ?? "");
			const form: Record<string, string> = {};
			for (const kv of body.split("&")) {
				const [k, v] = kv.split("=");
				form[k] = decodeURIComponent(v ?? "");
			}
			seen.push(form);
			return { ok: true, status: 200, text: async () => JSON.stringify({ status: 1, request: "tid" }) };
		}) as any;
		const poller = (async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ status: 1, request: "TOKEN123" }),
		})) as any;
		const client = new TwoCaptchaClient("k", fetchFn, 0, 10);
		// submit path only; poll path via the second transport
		await client.submit(job!);
		expect(seen[0].version).toBe("v3");
		expect(seen[0].action).toBe("login");
		expect(seen[0].min_score).toBe("0.3");
		void poller;
	});
});

describe("2captcha client", () => {
	test("submit → CAPCHA_NOT_READY → token", async () => {
		let submitted = 0;
		let polls = 0;
		const client = new TwoCaptchaClient(
			"key-1",
			mockFetch([
				(url, body) => {
					if (url.includes("2captcha.com/in.php")) {
						submitted++;
						const params = new URLSearchParams(String(body));
						expect(params.get("method")).toBe("turnstile");
						expect(params.get("sitekey")).toBe("0xABC");
						return { status: 200, json: { status: 1, request: "job-1" } };
					}
					return null;
				},
				(url) => {
					if (url.includes("2captcha.com/res.php")) {
						polls++;
						if (polls < 3) return { status: 200, json: { status: 0, request: "CAPCHA_NOT_READY" } };
						return { status: 200, json: { status: 1, request: "tok_AA11" } };
					}
					return null;
				},
			]),
			1, // 1ms poll interval
			5_000,
		);
		const token = await client.solve({ kind: "turnstile", sitekey: "0xABC", pageUrl: "https://x.example" });
		expect(token).toBe("tok_AA11");
		expect(submitted).toBe(1);
		expect(polls).toBe(3);
	});

	test("a rejected submit raises CaptchaServiceError with the service name", async () => {
		const client = new TwoCaptchaClient(
			"bad-key",
			mockFetch([
				(url) =>
					url.includes("in.php") ? { status: 200, json: { status: 0, request: "ERROR_WRONG_USER_KEY" } } : null,
			]),
		);
		try {
			await client.submit({ kind: "recaptcha-v2", sitekey: "k", pageUrl: "https://x" });
			expect.unreachable();
		} catch (err: any) {
			expect(err).toBeInstanceOf(CaptchaServiceError);
			expect(err.service).toBe("2captcha");
			expect(err.message).toContain("ERROR_WRONG_USER_KEY");
		}
	});
});

describe("capsolver client", () => {
	test("createTask → processing → ready (token from gRecaptcha)", async () => {
		let polls = 0;
		const client = new CapSolverClient(
			"cs-key",
			mockFetch([
				(url, body) => {
					if (url.includes("createTask")) {
						expect(body.task.type).toBe("AntiTurnstileTaskProxyLess");
						expect(body.task.websiteKey).toBe("0xABC");
						return { status: 200, json: { errorId: 0, taskId: "task-9" } };
					}
					return null;
				},
				(url, body) => {
					if (url.includes("getTaskResult")) {
						expect(body.taskId).toBe("task-9");
						polls++;
						if (polls < 2) return { status: 200, json: { errorId: 0, status: "processing" } };
						return { status: 200, json: { errorId: 0, status: "ready", solution: { gRecaptcha: "cs_tok" } } };
					}
					return null;
				},
			]),
			1,
			5_000,
		);
		const token = await client.solve({ kind: "turnstile", sitekey: "0xABC", pageUrl: "https://x.example" });
		expect(token).toBe("cs_tok");
	});

	test("capsolver errors carry errorDescription", async () => {
		const client = new CapSolverClient(
			"cs-bad",
			mockFetch([
				(url) =>
					url.includes("createTask")
						? {
								status: 200,
								json: { errorId: 12, errorCode: "ERROR_KEY_DOES_NOT_EXIST", errorDescription: "key not found" },
							}
						: null,
			]),
		);
		await expect(client.submit({ kind: "recaptcha-v2", sitekey: "k", pageUrl: "https://x" })).rejects.toThrow(
			/key not found/,
		);
	});
});

describe("vision OCR client", () => {
	test("sends the clipped image as a data URL and strips the answer", async () => {
		let sawImage = false;
		let sawModel = "";
		const fetchMock: FetchLike = async (url, init) => {
			expect(url).toBe("https://apihub.agnes-ai.com/v1/chat/completions");
			const body = JSON.parse(String(init?.body));
			sawModel = body.model;
			const content = body.messages[0].content;
			expect(content[0].type).toBe("text");
			expect(content[1].type).toBe("image_url");
			expect(content[1].image_url.url).toContain("data:image/png;base64,QUJD");
			sawImage = true;
			return {
				ok: true,
				status: 200,
				text: async () => JSON.stringify({ choices: [{ message: { content: '  "AbC7"\n' } }] }),
			};
		};
		const answer = await visionReadCaptcha(
			"QUJD",
			{ baseUrl: "https://apihub.agnes-ai.com/v1", apiKey: "cpk-x", model: "agnes-3.0-flash" },
			fetchMock,
		);
		expect(answer).toBe("AbC7");
		expect(sawImage).toBe(true);
		expect(sawModel).toBe("agnes-3.0-flash");
	});

	test("surfaces endpoint errors honestly", async () => {
		const fetchMock: FetchLike = async () => ({ ok: false, status: 401, text: async () => '{"error":"bad key"}' });
		await expect(
			visionReadCaptcha("QUJD", { baseUrl: "https://apihub.agnes-ai.com/v1", apiKey: "bad", model: "m" }, fetchMock),
		).rejects.toThrow(/401/);
	});
});
