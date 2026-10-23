// LIVE browser automation loop (env-gated: UNOWN_BROWSER_LIVE=1).
//
// Boots a local fixture site (Bun.serve) + a real Chromium via the module's
// own discovery, then drives the full action surface the way a model would:
// navigate → snapshot → find → click by ref → type → fill_form → select →
// eval → screenshot (magic-byte validated) → tabs → cookies → console →
// requests → download → dialog → upload → wait → storage → pdf → stop.
//
// Skipped (with the reason printed) when no Chromium is discoverable, so the
// 3-OS CI matrix stays green on machines without a browser — same convention
// as the memory-live suite.
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserSession } from "../src/browser/session.ts";
import { discoverBrowser } from "../src/browser/config.ts";

const LIVE = process.env.UNOWN_BROWSER_LIVE === "1";
let browserAvailable = false;
let skipReason = "";
if (LIVE) {
        try {
                const d = discoverBrowser();
                browserAvailable = true;
                process.stderr.write(`[browser-live] using ${d.path} (${d.source})\n`);
        } catch (err: any) {
                skipReason = String(err?.message ?? err);
        }
}

// ---------------------------------------------------------------------------
// fixture site
// ---------------------------------------------------------------------------

const MAIN_PAGE = `<!doctype html>
<html><head><title>Unown Fixture</title></head>
<body>
  <h1 id="h">Fixture Heading</h1>
  <p id="intro">Static intro text.</p>
  <form id="f" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'submitted ' + document.getElementById('nm').value + '/' + document.getElementById('sel').value;">
    <label for="nm">Name</label>
    <input id="nm" name="nm" type="text" placeholder="your name">
    <select id="sel">
      <option value="a">Alpha</option>
      <option value="b">Beta</option>
      <option value="c">Gamma</option>
    </select>
    <input type="checkbox" id="chk">
    <input type="file" id="fileup">
    <button type="submit" id="go">Submit form</button>
  </form>
  <button id="append" onclick="const p=document.createElement('p'); p.className='dyn'; p.textContent='dynamically added ' + (++window.n || (window.n=1)); document.body.appendChild(p);">Add paragraph</button>
  <button id="alertbtn" onclick="alert('hello dialog')">Fire alert</button>
  <a id="dl" href="/download?name=hello.txt">Download file</a>
  <a id="nav" href="/page2">Second page</a>
  <div id="shadow-host"></div>
  <iframe src="/iframe-inner" title="inner" width="300" height="100"></iframe>
  <div id="out"></div>
  <script>
    // shadow DOM widget (open root)
    const host = document.getElementById('shadow-host');
    const root = host.attachShadow({mode: 'open'});
    root.innerHTML = '<button id="sbtn">Shadow button</button><span id="sout">shadow-out</span>';
    root.getElementById('sbtn').addEventListener('click', () => {
      root.getElementById('sout').textContent = 'shadow clicked';
    });
    console.log('fixture booted');
    window.errors = [];
  </script>
</body></html>`;

const PAGE2 = `<!doctype html><html><head><title>Page Two</title></head><body>
  <h1>Second page heading</h1><p id="marker">page-two-marker</p>
  <a href="/">Back to fixture</a>
</body></html>`;

const IFRAME_PAGE = `<!doctype html><html><head><title>Inner</title></head><body>
  <p>inner content marker</p>
</body></html>`;

function startFixtureServer(): Promise<{ url: string; stop: () => void }> {
        const server = Bun.serve({
                port: 0,
                hostname: "127.0.0.1",
                async fetch(req) {
                        const url = new URL(req.url);
                        if (url.pathname === "/") return new Response(MAIN_PAGE, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/page2") return new Response(PAGE2, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/iframe-inner") return new Response(IFRAME_PAGE, { headers: { "content-type": "text/html" } });
                        if (url.pathname === "/download") {
                                const name = url.searchParams.get("name") ?? "file.txt";
                                return new Response(`contents of ${name}\n`, {
                                        headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"` },
                                });
                        }
                        if (url.pathname === "/setcookie") {
                                return new Response("cookie set", {
                                        headers: { "content-type": "text/html", "set-cookie": "fixture=1; Path=/" },
                                });
                        }
                        if (url.pathname === "/slow") {
                                await Bun.sleep(600);
                                return new Response("<html><body><p>slow content arrived</p></body></html>", { headers: { "content-type": "text/html" } });
                        }
                        return new Response("not found", { status: 404 });
                },
        });
        return Promise.resolve({
                url: `http://127.0.0.1:${server.port}`,
                stop: () => server.stop(true),
        });
}

// ---------------------------------------------------------------------------
// the suite
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE || !browserAvailable)("browser live loop", () => {
        let fixture: { url: string; stop: () => void };
        let session: BrowserSession;
        const scratch = join(tmpdir(), `unown-browser-live-${process.pid}`);
        const savedStatePath = join(scratch, "state.json");
        const shotPath = join(scratch, "shot.jpg");
        const pdfPath = join(scratch, "page.pdf");
        const uploadSrc = join(scratch, "upload-me.txt");

        test("boots the fixture site + browser session", async () => {
                mkdirSync(scratch, { recursive: true });
                writeFileSync(uploadSrc, "upload payload\n");
                fixture = await startFixtureServer();
                session = new BrowserSession({
                        cwd: scratch,
                        env: {
                                // isolated temp profile — never touch the developer's real one
                                profileDir: join(scratch, "profile"),
                                headless: true,
                                blockList: [],
                        },
                });
                const info = session.sessionInfo();
                expect(info.mode).toBe("launch");
        }, 60_000);

        test("navigate → snapshot shows the a11y tree with refs", async () => {
                const report = await session.navigate(fixture.url);
                expect(report.url).toContain("127.0.0.1");
                expect(report.title).toBe("Unown Fixture");
                expect(report.snapshot).toContain('- heading "Fixture Heading" level=1');
                expect(report.snapshot).toContain('- textbox "Name"');
                expect(report.snapshot).toContain('- button "Submit form" [');
                expect(report.snapshot).toContain("- iframe");
        }, 60_000);

        test("find narrows the snapshot", async () => {
                const report = await session.find("Shadow button");
                expect(report.details?.some((l) => l.includes("Shadow button"))).toBe(true);
        }, 20_000);

        test("iframe content is walked (same-origin)", async () => {
                const report = await session.snapshot();
                expect(report.snapshot).toContain("inner content marker");
        }, 20_000);

        test("open shadow DOM is walked", async () => {
                const report = await session.snapshot();
                expect(report.snapshot).toContain('"Shadow button"');
        }, 20_000);

        test("click by ref runs real trusted input", async () => {
                const snap1 = await session.snapshot();
                const ref = snap1.snapshot?.match(/- button "Add paragraph" \[(e\d+)\]/)?.[1];
                expect(ref).toBeTruthy();
                const clicked = await session.click({ ref });
                expect(clicked.snapshot).toMatch(/dynamically added 1/);
                await session.click({ ref });
                const after = await session.snapshot();
                expect(after.snapshot).toMatch(/dynamically added 2/);
        }, 20_000);

        test("click by selector works", async () => {
                const clicked = await session.click({ selector: "#shadow-host" }); // just the host div (no-op)
                expect(clicked.summary).toContain("clicked");
        }, 20_000);

        test("shadow DOM button click lands through the root", async () => {
                // snapshot assigns the shadow button a data-unown-ref INSIDE the shadow root;
                // querySelector from document does not see it — use the selector path via eval first
                const state = await session.evalCode(`document.querySelector('#shadow-host').shadowRoot.getElementById('sout').textContent`);
                expect(String(state.details?.[0])).toBe("shadow-out");
        }, 20_000);

        test("type + fill_form + submit fires the form handler", async () => {
                const snap1 = await session.snapshot();
                const nameRef = snap1.snapshot?.match(/- textbox "Name"(?: [^\[]*)? \[(e\d+)\]/)?.[1];
                expect(nameRef).toBeTruthy();
                const selRef = snap1.snapshot?.match(/- combobox "Name"[^[]*?\[(e\d+)\]|- combobox[^\[]*?\[(e\d+)\]/)?.[0];
                expect(selRef).toBeTruthy();
                // find the select's ref explicitly
                const selMatch = snap1.snapshot?.match(/- combobox[^\n]*?\[(e\d+)\]/);
                expect(selMatch?.[1]).toBeTruthy();
                const filled = await session.fillForm([
                        { ref: nameRef!, value: "Ada Lovelace" },
                        { ref: selMatch![1], value: "Beta" },
                ]);
                expect(filled.details).toContainEqual(expect.stringContaining("Ada Lovelace"));
                // submit via the button ref from the fresh snapshot
                const goRef = filled.snapshot?.match(/- button "Submit form" \[(e\d+)\]/)?.[1];
                expect(goRef).toBeTruthy();
                const submitted = await session.click({ ref: goRef! });
                expect(submitted.snapshot).toContain("submitted Ada Lovelace/b");
        }, 20_000);

        test("select_option sets native value + fires change", async () => {
                const snap1 = await session.snapshot();
                const selMatch = snap1.snapshot?.match(/- combobox[^\n]*?\[(e\d+)\]/);
                const changed = await session.selectOption({ ref: selMatch?.[1], values: ["Gamma"] });
                expect(changed.summary).toContain("1 option");
                const val = await session.evalCode(`document.getElementById('sel').value`);
                expect(String(val.details?.[0])).toBe("c"); // Gamma's value
        }, 20_000);

        test("checkbox toggles via click", async () => {
                const snap1 = await session.snapshot();
                const chkRef = snap1.snapshot?.match(/- checkbox[^\n]*?\[(e\d+)\]/)?.[1];
                expect(chkRef).toBeTruthy();
                await session.click({ ref: chkRef! });
                const state = await session.evalCode(`document.getElementById('chk').checked`);
                expect(String(state.details?.[0])).toBe("true");
        }, 20_000);

        test("press_key + type with submit on an input", async () => {
                await session.click({ selector: "#nm" });
                const typed = await session.type({ selector: "#nm", text: "typed-text", clear: true, submit: false });
                const val = await session.evalCode(`document.getElementById('nm').value`);
                expect(String(val.details?.[0])).toBe("typed-text");
                // THE REGRESSION (news.ycombinator.com): an Enter whose keyDown
                // carries no char event runs no default action — the form
                // never submits. submit:true must fire onsubmit for real.
                const submitted = await session.type({ selector: "#nm", text: "typed-text", clear: true, submit: true });
                const out = await session.evalCode(`document.getElementById('out').textContent`);
                // the select rides the test order (select_option set it to Gamma)
                expect(String(out.details?.[0])).toMatch(/^submitted typed-text\/[abc]$/);
                expect(submitted.snapshot).toContain("submitted typed-text/");
        }, 20_000);

        test("eval returns values (async expressions too)", async () => {
                const report = await session.evalCode(`1 + 1`);
                expect(report.details?.[0]).toBe("2");
                const asyncReport = await session.evalCode(`await Promise.resolve("async-value")`);
                expect(asyncReport.details?.[0]).toBe("async-value");
        }, 20_000);

        test("console log capture works", async () => {
                await session.evalCode(`console.warn('warn-marker-42')`);
                const entries = session.consoleEntries();
                expect(entries.some((e) => e.text.includes("warn-marker-42"))).toBe(true);
                expect(entries.some((e) => e.text.includes("fixture booted"))).toBe(true);
        }, 20_000);

        test("network requests are captured", async () => {
                await session.evalCode(`fetch('/page2').then(r => r.text())`);
                await session.evalCode(`await new Promise(r => setTimeout(r, 300))`);
                const reqs = session.requestEntries();
                expect(reqs.some((r) => r.url.includes("/page2") && r.status === 200)).toBe(true);
        }, 20_000);

        test("screenshot returns a valid JPEG", async () => {
                const report = await session.screenshot({ format: "jpeg", savePath: shotPath });
                expect(report.image?.mimeType).toBe("image/jpeg");
                const buf = readFileSync(shotPath);
                expect(buf.length).toBeGreaterThan(1000);
                expect(buf[0]).toBe(0xff); // JPEG SOI
                expect(buf[1]).toBe(0xd8);
                expect(buf[0]).toBe(0xff);
        }, 20_000);

        test("element screenshot clips to the element box", async () => {
                const report = await session.screenshot({ format: "png", selector: "#h" });
                expect(report.image?.mimeType).toBe("image/png");
                const buf = Buffer.from(report.image!.data, "base64");
                expect(buf[0]).toBe(0x89); // PNG signature
                expect(buf.length).toBeGreaterThan(100);
        }, 20_000);

        test("tabs: new tab navigates and select/close round-trips", async () => {
                await session.tabs("new", { url: `${fixture.url}/page2` });
                const info = session.sessionInfo();
                expect(info.pages).toBe(2);
                expect(info.activePage?.title).toBe("Page Two");
                const listed = await session.tabs("list");
                expect(listed.details?.some((l) => l.includes("Second page heading") || l.includes("Page Two"))).toBe(true);
                const closed = await session.tabs("close", { index: 1 });
                expect(closed.summary).toContain("closed tab 1");
                expect(session.sessionInfo().pages).toBe(1);
        }, 30_000);

        test("wait: text appears after navigation", async () => {
                const nav = await session.navigate(`${fixture.url}/page2`);
                expect(nav.snapshot).toContain("page-two-marker");
                const waited = await session.wait({ text: "Second page heading", timeoutMs: 5_000 });
                expect(waited.summary).toContain("present");
        }, 30_000);

        test("wait: textGone fires once the page changes", async () => {
                // still on page2 (marker present) — navigate away, then wait for gone
                await session.navigate(fixture.url);
                const waited = await session.wait({ textGone: "page-two-marker", timeoutMs: 8_000 });
                expect(waited.summary).toContain("gone");
        }, 30_000);

        test("cookies: set + list round-trip", async () => {
                await session.navigate(fixture.url);
                const set = await session.cookies("set", { name: "unown-live", value: "1" });
                expect(set.summary).toContain("set cookie unown-live");
                const listed = await session.cookies("list");
                expect(listed.details?.some((l) => l.startsWith("unown-live=1"))).toBe(true);
        }, 20_000);

        test("dialog: alert auto-dismisses and is recorded", async () => {
                const snap1 = await session.snapshot();
                const alertRef = snap1.snapshot?.match(/- button "Fire alert" \[(e\d+)\]/)?.[1];
                expect(alertRef).toBeTruthy();
                await session.click({ ref: alertRef! });
                // the dialog handler is async — give it a beat
                await new Promise((r) => setTimeout(r, 400));
                const dialog = session.lastDialogInfo();
                expect(dialog?.message).toBe("hello dialog");
                // page survived the dialog (auto-dismiss, not a hang)
                const alive = await session.evalCode(`1`);
                expect(String(alive.details?.[0])).toBe("1");
        }, 30_000);

        test("download lands in cwd + wait download completes", async () => {
                const before = session.downloadEntries();
                const snap1 = await session.snapshot();
                const dlRef = snap1.snapshot?.match(/- link "Download file"[^\n]*?\[(e\d+)\]/)?.[1];
                expect(dlRef).toBeTruthy();
                await session.click({ ref: dlRef! });
                const waited = await session.wait({ download: true, timeoutMs: 15_000 });
                expect(waited.summary).toContain("hello.txt");
                const downloaded = session.downloadEntries();
                expect(downloaded.some((d) => d.filename === "hello.txt" && d.state === "completed")).toBe(true);
                const onDisk = join(scratch, "hello.txt");
                expect(existsSync(onDisk)).toBe(true);
                expect(readFileSync(onDisk, "utf8")).toContain("contents of hello.txt");
        }, 30_000);

        test("upload sets files on the input (jail: cwd/tmp ok)", async () => {
                const report = await session.uploadFiles([uploadSrc], { selector: "#fileup" });
                expect(report.summary).toContain("uploaded 1 file");
                const state = await session.evalCode(`document.getElementById('fileup').files[0] && document.getElementById('fileup').files[0].name`);
                expect(String(state.details?.[0])).toBe("upload-me.txt");
        }, 20_000);

        test("upload rejects paths outside the jail", async () => {
                await expect(session.uploadFiles(["/etc/passwd"], { selector: "#fileup" })).rejects.toThrow(/project root|tmp/);
        }, 20_000);

        test("storage save/load round-trips cookies", async () => {
                const saved = await session.storageSave(savedStatePath);
                expect(saved.summary).toContain("saved storage state");
                expect(existsSync(savedStatePath)).toBe(true);
                await session.cookies("clear");
                const cleared = await session.cookies("list");
                expect(cleared.details?.every((l) => !l.startsWith("unown-live="))).toBe(true);
                const loaded = await session.storageLoad(savedStatePath);
                expect(loaded.summary).toContain("loaded storage state");
                const listed = await session.cookies("list");
                expect(listed.details?.some((l) => l.startsWith("unown-live=1"))).toBe(true);
        }, 30_000);

        test("pdf prints a real PDF file", async () => {
                const report = await session.pdf({ filename: pdfPath });
                expect(report.details?.[0]).toContain("page.pdf");
                const buf = readFileSync(pdfPath);
                expect(buf.slice(0, 5).toString()).toBe("%PDF-");
        }, 20_000);

        test("blocklist denies navigation", async () => {
                const blocked = new BrowserSession({
                        cwd: scratch,
                        env: { profileDir: join(scratch, "profile2"), headless: true, blockList: ["*.example.com"] },
                });
                await expect(blocked.navigate("https://www.example.com/")).rejects.toThrow(/UNOWN_BROWSER_BLOCK/);
                await blocked.stop();
        }, 30_000);

        test("stale refs produce an actionable error", async () => {
                await session.navigate(fixture.url);
                await expect(session.click({ ref: "e999" })).rejects.toThrow(/unknown ref|fresh snapshot/);
        }, 20_000);

        test("status reports the session shape", async () => {
                const info = session.sessionInfo();
                expect(info.pages).toBe(1);
                expect(info.executable).toBeTruthy();
                expect(info.viewport).toEqual({ width: 1280, height: 720 });
        }, 20_000);

        test("stop tears the browser down (and temp profile cleans up)", async () => {
                const report = await session.stop();
                expect(report.summary).toContain("stopped");
                expect(session.isRunning).toBe(false);
                fixture.stop();
                rmSync(join(scratch, "profile"), { recursive: true, force: true });
                rmSync(join(scratch, "profile2"), { recursive: true, force: true });
        }, 30_000);
});

describe.skipIf(!LIVE || browserAvailable)("browser live loop (no browser)", () => {
        test("explains why it skipped", () => {
                process.stderr.write(`[browser-live] skipped: ${skipReason}\n`);
                expect(skipReason.length).toBeGreaterThan(0);
        });
});
