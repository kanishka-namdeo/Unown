/**
 * dbg-stealth-probe2.ts — follow-ups from the first probe, against Chrome 143:
 *
 *   1. MODERN CDP-signal detector: Error.prepareStackTrace + the double
 *      error-name read (rebrowser's 2026 catalog) — does Runtime.enable fire
 *      it, and does it stay silent without Runtime.enable?
 *   2. navigator.userAgentData: exists at all in this build? before/after
 *      Network.setUserAgentOverride, with/without userAgentMetadata.
 *   3. Console capture options without Runtime.enable:
 *      a) Runtime.addBinding + Page.addScriptToEvaluateOnNewDocument tap
 *      b) Log.entryAdded with a console.log + a real network error
 *   4. window.screen / devicePixelRatio under setDeviceMetricsOverride.
 *
 * Run: bun scripts-dev/dbg-stealth-probe2.ts
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`;
const PROFILE = join(tmpdir(), `probe2-${process.pid}`);
mkdirSync(PROFILE, { recursive: true });

// modern detector (rebrowser-bot-detector, 2026): serialization triggers
// Error.prepareStackTrace; also count error 'name' reads.
const FIXTURE = `data:text/html,${encodeURIComponent(`<html><body><div id="status">pending</div><script>
  let viaPrepare = false, nameReads = 0;
  const origPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = function (e, s) { viaPrepare = true; return "x"; };
  const probe = new Error("probe");
  const nameDesc = Object.getOwnPropertyDescriptor(Error.prototype, "name");
  Object.defineProperty(probe, "name", { get() { nameReads++; return nameDesc.get.call(this); }, configurable: true });
  console.debug(probe);
  Error.prepareStackTrace = origPrepare;
  setTimeout(() => {
    document.getElementById("status").textContent =
      "modern-cdp-signal:" + (viaPrepare ? "FIRED(prepareStackTrace)" : (nameReads >= 2 ? "FIRED(name-reads=" + nameReads + ")" : "silent(name-reads=" + nameReads + ")"));
  }, 300);
  console.log("PROBE-CONSOLE-1");
  fetch("https://invalid.invalid/x").catch(() => {});
  console.log("PROBE-CONSOLE-2");
</script></body></html>`)}`;

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

const child = spawn(CHROME, [
	"--remote-debugging-port=0", `--user-data-dir=${PROFILE}`, "--no-first-run",
	"--no-default-browser-check", "--disable-blink-features=AutomationControlled",
	"--headless", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const endpoint = await new Promise<string>((resolve, reject) => {
	let buf = "";
	const timer = setTimeout(() => reject(new Error("no devtools endpoint")), 15_000);
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

const logs: string[] = [];
const bindings: string[] = [];
conn.on((method, params, sid) => {
	if (sid !== pageSession) return;
	if (method === "Log.entryAdded") logs.push(`LOG[${params?.entry?.source}/${params?.entry?.level}]: ${params?.entry?.text?.slice(0, 80)}`);
	if (method === "Runtime.bindingCalled") bindings.push(`BINDING[${params?.name}]: ${params?.payload?.slice(0, 80)}`);
});

console.log("== 1+3. stealth domains (NO Runtime.enable), modern detector ==");
await conn.send("Page.enable", {}, pageSession);
await conn.send("Network.enable", {}, pageSession);
await conn.send("Log.enable", {}, pageSession);
await conn.send("Page.addScriptToEvaluateOnNewDocument", {
	source: `(() => {
		const send = (level, parts) => { try { window.__unownConsole(level, parts.map(p => { try { return typeof p === "string" ? p : JSON.stringify(p); } catch { return String(p); } }).join(" ")); } catch {} };
		for (const lvl of ["log", "info", "warn", "error", "debug"]) {
			const orig = console[lvl].bind(console);
			console[lvl] = (...args) => { send(lvl, args); orig(...args); };
		}
	})()`,
}, pageSession);
await conn.send("Runtime.addBinding", { name: "__unownConsole" }, pageSession);
await sleep(200);
await conn.send("Page.navigate", { url: FIXTURE }, pageSession);
await sleep(1_500);
const s1 = await conn.send("Runtime.evaluate", { expression: "document.getElementById('status')?.textContent", returnByValue: true }, pageSession);
console.log("detector WITHOUT Runtime.enable:", s1.result?.value);
console.log("Log.entryAdded:", logs.length, logs.slice(0, 4));
console.log("bindingCalled:", bindings.length, bindings.slice(0, 4));

console.log("\n== 2. userAgentData before override ==");
const uad0 = await conn.send("Runtime.evaluate", { expression: `typeof navigator.userAgentData === "undefined" ? "absent" : JSON.stringify({platform: navigator.userAgentData.platform, mobile: navigator.userAgentData.mobile, brands: navigator.userAgentData.brands.length})`, returnByValue: true }, pageSession);
console.log("before:", uad0.result?.value);

console.log("\n== now Runtime.enable + reload (classic path) ==");
await conn.send("Runtime.enable", {}, pageSession);
await conn.send("Page.navigate", { url: FIXTURE }, pageSession);
await sleep(1_500);
const s2 = await conn.send("Runtime.evaluate", { expression: "document.getElementById('status')?.textContent", returnByValue: true }, pageSession);
console.log("detector WITH Runtime.enable:", s2.result?.value);

console.log("\n== 2b. userAgentData AFTER override w/ metadata ==");
await conn.send("Network.setUserAgentOverride", {
	userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
	platform: "Win32",
	acceptLanguage: "en-US,en;q=0.9",
	userAgentMetadata: {
		brands: [
			{ brand: "Not A(Brand", version: "99" },
			{ brand: "Chromium", version: "143" },
			{ brand: "Google Chrome", version: "143" },
		],
		fullVersionList: [
			{ brand: "Not A(Brand", version: "99.0.0.0" },
			{ brand: "Chromium", version: "143.0.7499.4" },
			{ brand: "Google Chrome", version: "143.0.7499.4" },
		],
		fullVersion: "143.0.7499.4",
		platform: "Windows",
		platformVersion: "15.0.0",
		architecture: "x86",
		model: "",
		mobile: false,
		bitness: "64",
		wow64: false,
	},
}, pageSession);
await sleep(300);
const uad1 = await conn.send("Runtime.evaluate", { expression: `typeof navigator.userAgentData === "undefined" ? "absent" : JSON.stringify({platform: navigator.userAgentData.platform, mobile: navigator.userAgentData.mobile, brands: navigator.userAgentData.brands.map(b=>b.brand+":"+b.version)})`, returnByValue: true }, pageSession);
console.log("after:", uad1.result?.value);
const hi = await conn.send("Runtime.evaluate", { expression: `navigator.userAgentData ? navigator.userAgentData.getHighEntropyValues(["platformVersion","architecture","fullVersionList"]).then(r => JSON.stringify(r)).catch(e => "hi-err:" + e.message) : "none"`, returnByValue: true, awaitPromise: true }, pageSession);
console.log("high-entropy:", hi.result?.value);

console.log("\n== 4. screen / viewport ==");
await conn.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, pageSession);
await sleep(200);
const scr = await conn.send("Runtime.evaluate", { expression: `JSON.stringify({inner:[innerWidth,innerHeight], screen:[screen.width,screen.height], avail:[screen.availWidth,screen.availHeight], dpr: devicePixelRatio})`, returnByValue: true }, pageSession);
console.log("screen:", scr.result?.value);

child.kill("SIGKILL");
process.exit(0);
