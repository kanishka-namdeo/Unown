/**
 * dbg-stealth-probe3.ts — third round, resolving:
 *
 *   1. navigator.userAgentData on a REAL https page (data: may be an
 *      insecure-context artifact) — before + after a full metadata override.
 *   2. Do Runtime.addBinding calls actually fire Runtime.bindingCalled
 *      events without Runtime.enable? (probe2 showed zero — disambiguate
 *      "init script never ran" from "events need enable")
 *   3. screen.width/height: does Emulation.setDeviceMetricsOverride accept
 *      screenWidth/screenHeight in Chrome 143? does --window-size fix the
 *      800x600 headless default?
 *
 * Run: bun scripts-dev/dbg-stealth-probe3.ts
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`;
const PROFILE = join(tmpdir(), `probe3-${process.pid}`);
mkdirSync(PROFILE, { recursive: true });

function connect(wsUrl: string) {
	const ws = new WebSocket(wsUrl);
	const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
	const handlers: Array<(m: string, p: any, sid?: string) => void> = [];
	let nextId = 1;
	const conn = {
		send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
			return new Promise<any>((resolve, reject) => {
				const id = nextId++;
				pending.set(id, { resolve, reject });
				const payload: any = { id, method, params };
				if (sessionId) payload.sessionId = sessionId;
				ws.send(JSON.stringify(payload));
			});
		},
		on(h: (m: string, p: any, sid?: string) => void) { handlers.push(h); },
	};
	return new Promise<typeof conn>((resolve, reject) => {
		ws.addEventListener("open", () => resolve(conn), { once: true });
		ws.addEventListener("error", () => reject(new Error("ws failed")), { once: true });
		ws.addEventListener("message", (ev: MessageEvent) => {
			const msg = JSON.parse(String(ev.data));
			if (typeof msg.id === "number") {
				const entry = pending.get(msg.id);
				if (entry) {
					pending.delete(msg.id);
					msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result ?? {});
				}
			} else {
				for (const h of handlers) h(msg.method, msg.params, msg.sessionId);
			}
		});
	});
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot(extraArgs: string[] = []) {
	const child = spawn(CHROME, [
		"--remote-debugging-port=0", `--user-data-dir=${join(PROFILE, String(Math.random()))}`,
		"--no-first-run", "--no-default-browser-check",
		"--disable-blink-features=AutomationControlled", "--headless",
		...extraArgs, "about:blank",
	], { stdio: ["ignore", "ignore", "pipe"] });
	const endpoint = await new Promise<string>((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(() => reject(new Error("no endpoint")), 15_000);
		child.stderr!.on("data", (c: Buffer) => {
			buf += c.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
			if (m) { clearTimeout(timer); resolve(m[1]); }
		});
	});
	const conn = await connect(endpoint);
	let pageSession: string | undefined;
	conn.on((method, params) => {
		if (method === "Target.attachedToTarget" && params?.targetInfo?.type === "page" && !pageSession) pageSession = params.sessionId;
	});
	await conn.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
	for (let i = 0; i < 50 && !pageSession; i++) await sleep(100);
	return { child, conn, pageSession };
}

// ---------------------------------------------------------------------------
console.log("== A. https page: userAgentData + binding behavior ==");
{
	const { child, conn, pageSession } = await boot();
	await conn.send("Page.enable", {}, pageSession);
	await conn.send("Network.enable", {}, pageSession);
	const bindings: string[] = [];
	conn.on((method, params, sid) => {
		if (sid !== pageSession) return;
		if (method === "Runtime.bindingCalled") bindings.push(`${params?.name}: ${params?.payload}`);
	});
	await conn.send("Runtime.addBinding", { name: "__unownConsole" }, pageSession);
	await conn.send("Page.addScriptToEvaluateOnNewDocument", {
		source: `window.__unownTap = (l, s) => { try { window.__unownConsole(l + "|" + s); } catch {} };`,
	}, pageSession);
	await conn.send("Page.navigate", { url: "https://example.com" }, pageSession);
	await sleep(2_500);
	const uadBefore = await conn.send("Runtime.evaluate", { expression: `typeof navigator.userAgentData === "undefined" ? "absent" : JSON.stringify({platform: navigator.userAgentData.platform, brands: navigator.userAgentData.brands.length})`, returnByValue: true }, pageSession);
	console.log("userAgentData on https BEFORE override:", uadBefore.result?.value);

	await conn.send("Network.setUserAgentOverride", {
		userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
		platform: "Win32", acceptLanguage: "en-US,en;q=0.9",
		userAgentMetadata: {
			brands: [{ brand: "Not A(Brand", version: "99" }, { brand: "Chromium", version: "143" }, { brand: "Google Chrome", version: "143" }],
			fullVersionList: [{ brand: "Not A(Brand", version: "99.0.0.0" }, { brand: "Chromium", version: "143.0.7499.4" }, { brand: "Google Chrome", version: "143.0.7499.4" }],
			fullVersion: "143.0.7499.4", platform: "Windows", platformVersion: "15.0.0",
			architecture: "x86", model: "", mobile: false, bitness: "64", wow64: false,
		},
	}, pageSession);
	await sleep(300);
	const uadAfter = await conn.send("Runtime.evaluate", { expression: `typeof navigator.userAgentData === "undefined" ? "absent" : JSON.stringify({platform: navigator.userAgentData.platform, mobile: navigator.userAgentData.mobile, brands: navigator.userAgentData.brands.map(b=>b.brand).join(","), platformVersion: navigator.userAgentData.platformVersion})`, returnByValue: true }, pageSession);
	console.log("userAgentData on https AFTER override:", uadAfter.result?.value);

	// binding: does the init script exist, and does calling it deliver events
	// without Runtime.enable?
	const tapType = await conn.send("Runtime.evaluate", { expression: "typeof window.__unownTap", returnByValue: true }, pageSession);
	console.log("init script ran (__unownTap):", tapType.result?.value);
	await conn.send("Runtime.evaluate", { expression: "window.__unownTap('info','hello-from-main-world')", returnByValue: true }, pageSession);
	await sleep(600);
	console.log("bindingCalled events (no Runtime.enable):", bindings.length, bindings);
	child.kill("SIGKILL");
}

// ---------------------------------------------------------------------------
console.log("\n== B. screen dims: --window-size vs setDeviceMetricsOverride screen params ==");
{
	const { child, conn, pageSession } = await boot(["--window-size=1920,1080"]);
	await conn.send("Page.enable", {}, pageSession);
	await sleep(300);
	const s1 = await conn.send("Runtime.evaluate", { expression: `JSON.stringify({inner:[innerWidth,innerHeight], screen:[screen.width,screen.height]})`, returnByValue: true }, pageSession);
	console.log("with --window-size=1920,1080:", s1.result?.value);
	try {
		await conn.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080, screenOrientation: { angle: 0, type: "landscapePrimary" } }, pageSession);
		await sleep(300);
		const s2 = await conn.send("Runtime.evaluate", { expression: `JSON.stringify({inner:[innerWidth,innerHeight], screen:[screen.width,screen.height]})`, returnByValue: true }, pageSession);
		console.log("after override with screenWidth/Height:", s2.result?.value, "(params ACCEPTED)");
	} catch (e: any) {
		console.log("setDeviceMetricsOverride with screen params REJECTED:", e.message);
	}
	child.kill("SIGKILL");
}

process.exit(0);
