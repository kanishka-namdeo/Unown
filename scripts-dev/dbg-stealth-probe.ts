/**
 * dbg-stealth-probe.ts — empirical verification of the v2 stealth approach.
 *
 * Answers four questions against the real Chromium in the playwright cache,
 * before any production code is written on top of the assumptions:
 *
 *   1. CDP signal: does the classic `error.stack` getter + console.debug
 *      detector fire when Runtime.enable is called, and stay silent when it
 *      never is? (the whole stealth mode rests on this)
 *   2. Console capture: with Runtime.enable never called, do console messages
 *      still arrive via Log.entryAdded (source console-api)?
 *   3. Isolated worlds: does Page.createIsolatedWorld + Runtime.evaluate
 *      {contextId} work without Runtime.enable, and is the main-world console
 *      tap invisible to the page?
 *   4. Fingerprint overrides: do Network.setUserAgentOverride (with
 *      userAgentMetadata), Emulation.setLocaleOverride and
 *      Emulation.setTimezoneOverride land coherently in the page?
 *
 * Run: bun scripts-dev/dbg-stealth-probe.ts
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`;
const PROFILE = join(tmpdir(), `probe-${process.pid}`);
mkdirSync(PROFILE, { recursive: true });

// --- fixture: the CDP-signal detector (Antoine Vastel / DataDome, June 2024) ---
const FIXTURE = `data:text/html,${encodeURIComponent(`<html><body>
<h1>probe fixture</h1>
<div id="status">pending</div>
<script>
  // the classic CDP-signal trap: a getter on error.stack that only runs when
  // DevTools serializes console arguments (Runtime.enable side effect).
  let leaked = false;
  const probe = new Error("x");
  Object.defineProperty(probe, "stack", {
    get() { leaked = true; return "leaked"; }
  });
  console.debug(probe);
  setTimeout(() => {
    document.getElementById("status").textContent =
      "cdp-signal:" + (leaked ? "FIRED" : "silent");
    window.__cdpLeak = leaked;
  }, 300);
  console.log("PROBE-CONSOLE-MESSAGE");
</script>
</body></html>`)}`;

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
                                const payload: Record<string, unknown> = { id, method, params };
                                if (sessionId) (payload as any).sessionId = sessionId;
                                ws.send(JSON.stringify(payload));
                        });
                },
                on(h: (m: string, p: any, sid?: string) => void) {
                        handlers.push(h);
                },
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
        "--remote-debugging-port=0",
        `--user-data-dir=${PROFILE}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--headless",
        "about:blank",
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
const logEntries: string[] = [];
conn.on((method, params) => {
        if (method === "Log.entryAdded") logEntries.push(`${params?.entry?.source}/${params?.entry?.level}: ${params?.entry?.text}`);
});

// flat-attach to the first page
let pageSession: string | undefined;
conn.on((method, params) => {
        if (method === "Target.attachedToTarget" && params?.targetInfo?.type === "page" && !pageSession) {
                pageSession = params.sessionId;
        }
});
await conn.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
for (let i = 0; i < 50 && !pageSession; i++) await sleep(100);
if (!pageSession) throw new Error("no page session");
const S = { sessionId: pageSession };

console.log("== A. WITHOUT Runtime.enable (stealth path) ==");
await conn.send("Page.enable", {}, S.sessionId);
await conn.send("Network.enable", {}, S.sessionId);
await conn.send("Log.enable", {}, S.sessionId);
await sleep(400); // fixture already loaded by chrome? navigate fresh:
await conn.send("Page.navigate", { url: FIXTURE }, S.sessionId);
await sleep(1_200);
const statusA = await conn.send("Runtime.evaluate", { expression: "document.getElementById('status')?.textContent ?? 'none'", returnByValue: true }, S.sessionId);
console.log("detector:", statusA.result?.value);
console.log("Log.entryAdded events captured:", logEntries.length);
console.log(logEntries.slice(0, 6));

console.log("\n== B. Isolated world WITHOUT Runtime.enable ==");
const frame = await conn.send("Page.getFrameTree", {}, S.sessionId);
const frameId = frame.frameTree.frame.id;
const world = await conn.send("Page.createIsolatedWorld", { frameId, worldName: "unown-probe", grantUniveralAccess: false }, S.sessionId);
const ctxId = world.executionContextId;
const isoProbe = await conn.send("Runtime.evaluate", {
        expression: "({ua: navigator.userAgent, wd: navigator.webdriver, hasWindow: typeof window !== 'undefined', domOk: !!document.body, secret: (typeof window.__cdpLeak)})",
        contextId: ctxId, returnByValue: true,
}, S.sessionId);
console.log("isolated-world probe:", JSON.stringify(isoProbe.result?.value));

console.log("\n== C. Fingerprint overrides ==");
await conn.send("Network.setUserAgentOverride", {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        platform: "Win32",
        acceptLanguage: "en-US",
        userAgentMetadata: {
                brands: [{ brand: "Chromium", version: "131" }, { brand: "Not_A Brand", version: "24" }],
                fullVersionList: [{ brand: "Chromium", version: "131.0.0" }, { brand: "Not_A Brand", version: "24.0.0" }],
                fullVersion: "131.0.0",
                platform: "Windows",
                platformVersion: "15.0.0",
                architecture: "x86",
                model: "",
                mobile: false,
                bitness: "64",
                wow64: false,
        },
}, S.sessionId);
await conn.send("Emulation.setLocaleOverride", { locale: "en-US" }, S.sessionId).catch((e: any) => console.log("locale override:", e.message));
await conn.send("Emulation.setTimezoneOverride", { timezoneId: "America/New_York" }, S.sessionId);
await sleep(300);
const fp = await conn.send("Runtime.evaluate", {
        expression: `({
                ua: navigator.userAgent,
                platform: navigator.platform,
                uadPlatform: navigator.userAgentData ? navigator.userAgentData.platform : 'none',
                uadMobile: navigator.userAgentData ? navigator.userAgentData.mobile : 'none',
                brands: navigator.userAgentData ? navigator.userAgentData.brands.map(b=>b.brand).join(',') : 'none',
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                locale: Intl.DateTimeFormat().resolvedOptions().locale,
                webdriver: navigator.webdriver,
                chrome: typeof window.chrome,
                plugins: navigator.plugins.length,
                notification: typeof Notification !== 'undefined' ? Notification.permission : 'none',
        })`,
        returnByValue: true,
}, S.sessionId);
console.log("fingerprint:", JSON.stringify(fp.result?.value, null, 2));

console.log("\n== D. NOW call Runtime.enable (classic path) and reload ==");
logEntries.length = 0;
await conn.send("Runtime.enable", {}, S.sessionId);
await conn.send("Page.navigate", { url: FIXTURE }, S.sessionId);
await sleep(1_200);
const statusD = await conn.send("Runtime.evaluate", { expression: "document.getElementById('status')?.textContent ?? 'none'", returnByValue: true }, S.sessionId);
console.log("detector after Runtime.enable:", statusD.result?.value);

console.log("\n== E. main-world JS-injection visibility check (init script mechanism) ==");
const scriptId = await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: "console.log('INIT-RAN')" }, S.sessionId);
console.log("addScriptToEvaluateOnNewDocument accepted, id:", scriptId.identifier ?? scriptId.scriptId ?? "?");
const pwInit = await conn.send("Runtime.evaluate", { expression: "typeof window.__pwInitScripts", returnByValue: true }, S.sessionId);
console.log("window.__pwInitScripts (playwright artifact):", pwInit.result?.value);

child.kill("SIGKILL");
process.exit(0);
