/**
 * browser/tools.ts — the `browser` session tool (docs/browser.md).
 *
 * One tool, one action enum (D1 in docs/browser-research.md): models route
 * reliably on enums, and the session tool list stays readable. Every action
 * auto-starts the browser on first use (D8); screenshots come back as image
 * content blocks the model can see directly (D6); mutations return a fresh
 * a11y snapshot so the next decision is grounded (Playwright MCP's contract).
 *
 * Registered from tools.ts (the unown-tools extension) — see the wiring note
 * in the session-shutdown hook at the bottom.
 */

import { isAbsolute, join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getBrowserSession } from "./session.ts";
import { discoverBrowser } from "./config.ts";

const BrowserAction = StringEnum(
        [
                "start",
                "stop",
                "status",
                "navigate",
                "back",
                "forward",
                "reload",
                "snapshot",
                "find",
                "text",
                "html",
                "click",
                "hover",
                "type",
                "press_key",
                "fill_form",
                "select_option",
                "scroll",
                "drag",
                "screenshot",
                "eval",
                "tabs",
                "wait",
                "resize",
                "console",
                "requests",
                "cookies",
                "upload",
                "pdf",
                "storage",
        ] as const,
        { description: "Which browser operation to run" },
);

const BrowserParams = Type.Object({
        action: BrowserAction,
        url: Type.Optional(Type.String({ description: "navigate: URL to open (bare hosts get https://)" })),
        ref: Type.Optional(Type.String({ description: "Element ref from the last snapshot, e.g. e12 (preferred for clicks/typing)" })),
        selector: Type.Optional(Type.String({ description: "CSS selector as an alternative to ref (e.g. #submit, a[href='/login'])" })),
        x: Type.Optional(Type.Number({ description: "x coordinate (CSS px) for coordinate clicks — the vision tier" })),
        y: Type.Optional(Type.Number({ description: "y coordinate (CSS px) for coordinate clicks — the vision tier" })),
        text: Type.Optional(Type.String({ description: "type: text to enter; wait: text to wait for; find: substring to search the snapshot for" })),
        textGone: Type.Optional(Type.String({ description: "wait: text that must disappear" })),
        submit: Type.Optional(Type.Boolean({ description: "type: press Enter after typing" })),
        clear: Type.Optional(Type.Boolean({ description: "type: clear the field first" })),
        key: Type.Optional(Type.String({ description: "press_key: key or combo, e.g. Enter, Control+a, cmd+shift+p" })),
        button: Type.Optional(StringEnum(["left", "right", "middle"] as const, { description: "click: mouse button (default left)" })),
        doubleClick: Type.Optional(Type.Boolean({ description: "click: double-click" })),
        modifiers: Type.Optional(Type.Array(StringEnum(["Alt", "Control", "Meta", "Shift"] as const), { description: "click: modifier keys held" })),
        fields: Type.Optional(
                Type.Array(
                        Type.Object({
                                ref: Type.Optional(Type.String({ description: "field element ref from the snapshot" })),
                                selector: Type.Optional(Type.String({ description: "field CSS selector" })),
                                value: Type.String({ description: "value to fill" }),
                        }),
                        { description: "fill_form: fields to fill in one go" },
                ),
        ),
        values: Type.Optional(Type.Array(Type.String({ description: "select_option: option values/labels to select" }))),
        direction: Type.Optional(StringEnum(["up", "down", "left", "right"] as const, { description: "scroll: direction (default down)" })),
        amount: Type.Optional(Type.Number({ description: "scroll: pixels (default 600)" })),
        startRef: Type.Optional(Type.String({ description: "drag: ref to drag from" })),
        startSelector: Type.Optional(Type.String({ description: "drag: selector to drag from" })),
        endRef: Type.Optional(Type.String({ description: "drag: ref to drag to" })),
        endSelector: Type.Optional(Type.String({ description: "drag: selector to drag to" })),
        fullPage: Type.Optional(Type.Boolean({ description: "screenshot: capture the full scrollable page" })),
        format: Type.Optional(StringEnum(["png", "jpeg"] as const, { description: "screenshot: format (default jpeg — smaller)" })),
        quality: Type.Optional(Type.Number({ description: "screenshot: jpeg quality 20-100 (default 70)" })),
        filename: Type.Optional(Type.String({ description: "screenshot/pdf: save path (cwd-relative ok); screenshot also returns the image inline" })),
        code: Type.Optional(Type.String({ description: "eval: JS expression or function body to run in the page" })),
        tabsAction: Type.Optional(StringEnum(["list", "new", "select", "close"] as const, { description: "tabs: sub-action (default list)" })),
        index: Type.Optional(Type.Number({ description: "tabs select/close: tab index (default last)" })),
        time: Type.Optional(Type.Number({ description: "wait: seconds to sleep (max 30)" })),
        timeoutMs: Type.Optional(Type.Number({ description: "wait: per-condition timeout in ms (default 10000)" })),
        waitDownload: Type.Optional(Type.Boolean({ description: "wait: wait for the current download to complete" })),
        width: Type.Optional(Type.Number({ description: "resize/start: viewport width" })),
        height: Type.Optional(Type.Number({ description: "resize/start: viewport height" })),
        level: Type.Optional(Type.String({ description: "console: filter by level (error, warning, log, info…)" })),
        headless: Type.Optional(Type.Boolean({ description: "start: run headless (default from UNOWN_BROWSER_HEADLESS, 1)" })),
        cookiesAction: Type.Optional(StringEnum(["list", "set", "clear"] as const, { description: "cookies: sub-action (default list)" })),
        name: Type.Optional(Type.String({ description: "cookies set: cookie name" })),
        value: Type.Optional(Type.String({ description: "cookies set: cookie value; select_option alias not used" })),
        paths: Type.Optional(Type.Array(Type.String({ description: "upload: file paths to set on the file input (project root or tmp only)" }))),
        landscape: Type.Optional(Type.Boolean({ description: "pdf: landscape orientation" })),
        storageAction: Type.Optional(StringEnum(["save", "load"] as const, { description: "storage: sub-action" })),
        path: Type.Optional(Type.String({ description: "storage: JSON state file path (cwd-relative ok)" })),
        includeBoxes: Type.Optional(Type.Boolean({ description: "snapshot: include [x,y,w,h] boxes for visual grounding" })),
});

export interface BrowserToolsOptions {
        /** The user's real project directory — upload jail root + download dir. */
        cwd: string;
        verbose?: boolean;
}

/**
 * Register the browser tool on a pi ExtensionAPI. Called from tools.ts
 * (terminal sessions, incl. subagents — each process gets its own browser).
 */
export function registerBrowserTools(pi: ExtensionAPI, opts: BrowserToolsOptions): void {
        const verbose = opts.verbose ?? false;
        const log = (msg: string) => {
                if (verbose) console.error(`[unown-browser] ${msg}`);
        };

        // Teardown must not outlive the session (D15) — the process-wide singleton
        // has exit hooks of its own; this is the polite path for normal exits.
        pi.on("session_shutdown", () => {
                void getBrowserSession(opts.cwd)
                        .stop()
                        .catch(() => undefined);
        });

        pi.registerTool({
                name: "browser",
                label: "Browser",
                description:
                        "Drive a real Chromium browser over CDP for web automation: navigate, take accessibility snapshots (refs like [e12]), click/type by ref/selector/coordinates, fill forms, screenshots (returned as images the model can see — works with vision models like agnes-3.0-flash), tabs, downloads, cookies, console/network logs, JS eval, PDF export. The browser auto-starts on first use (headless by default; UNOWN_BROWSER_HEADLESS=0 to watch it). Work loop: navigate → snapshot → act on refs → repeat. Use it to test local dev servers, scrape JS-rendered pages, fill real forms, or visually verify a deploy.",
                parameters: BrowserParams,
                promptSnippet: "browser — drive a real browser (Chromium/CDP): navigate, snapshot+refs, click/type, screenshots (vision), forms, tabs, downloads, cookies, console/network, eval",
                promptGuidelines: [
                        "browser tool: after navigate/click/type the tool returns a fresh accessibility snapshot — pick element refs (like [e12]) from it; refs invalidate on navigation, so re-snapshot instead of reusing stale refs",
                        "browser screenshot returns the actual image — vision models can ground coordinate clicks (x/y) from it when the a11y tree lacks a target",
                        "fill forms with one fill_form call instead of many type calls; wait for text/url changes with the wait action instead of fixed sleeps",
                ],
                async execute(_toolCallId: string, params: any, signal: AbortSignal | undefined) {
                        const session = getBrowserSession(opts.cwd);
                        const started = Date.now();
                        try {
                                const report = await dispatch(session, params, { cwd: opts.cwd, signal });
                                log(`${params.action} ok in ${Date.now() - started}ms: ${report.summary}`);
                                const parts: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
                                const head = report.snapshot
                                        ? `${report.summary}\n\n${report.url ? `page: ${report.title || report.url}\n` : ""}`
                                        : report.summary + (report.url ? ` — ${report.title || report.url}` : "");
                                parts.push({ type: "text", text: head });
                                if (report.details?.length) {
                                        parts.push({ type: "text", text: report.details.join("\n") });
                                }
                                if ((report as any).image) {
                                        parts.push({ type: "image", data: (report as any).image.data, mimeType: (report as any).image.mimeType });
                                }
                                if (report.snapshot) {
                                        parts.push({ type: "text", text: `\n${report.snapshot}` });
                                }
                                return {
                                        content: parts,
                                        details: { action: params.action, summary: report.summary, ms: Date.now() - started },
                                };
                        } catch (err: any) {
                                const msg = err instanceof Error ? err.message : String(err);
                                log(`${params.action} failed: ${msg}`);
                                return {
                                        content: [{ type: "text", text: `browser ${params.action} failed: ${msg}` }],
                                        isError: true,
                                };
                        }
                },
                renderCall(args: any, theme: any) {
                        const what = [args?.url, args?.ref ? `[${args.ref}]` : undefined, args?.selector, args?.key, args?.text]
                                .filter(Boolean)
                                .map(String)
                                .slice(0, 2)
                                .join(" ");
                        return new Text(
                                theme.fg("toolTitle", theme.bold("web ")) + theme.fg("accent", `${args?.action ?? ""} ${what}`.trim().slice(0, 70)),
                                0,
                                0,
                        );
                },
                renderResult(result: any, _o: any, theme: any) {
                        const details = result?.details as { action?: string; summary?: string; ms?: number } | undefined;
                        if (result?.isError) {
                                const first = result.content?.[0];
                                const text = first?.type === "text" ? String(first.text).split("\n")[0] : "error";
                                return new Text(theme?.fg ? theme.fg("error", `✗ ${text.slice(0, 90)}`) : text.slice(0, 90), 0, 0);
                        }
                        const head = details?.summary ?? "ok";
                        const ms = details?.ms != null ? ` (${details.ms}ms)` : "";
                        return new Text(theme?.fg ? theme.fg("success", `✓ ${head.slice(0, 90)}${ms}`) : head, 0, 0);
                },
        } as any);
}

// ---------------------------------------------------------------------------
// action dispatch
// ---------------------------------------------------------------------------

async function dispatch(
        session: import("./session.ts").BrowserSession,
        p: any,
        ctx: { cwd: string; signal?: AbortSignal },
): Promise<import("./session.ts").ActionReport> {
        const abort = () => {
                if (ctx.signal?.aborted) throw new Error("aborted");
        };
        // long-poll actions check the signal between phases via wait loops in
        // session.ts; navigate-level checks happen here for snappy cancels.
        switch (p.action) {
                case "start": {
                        await session.ensureStarted({ headless: p.headless });
                        if (p.width && p.height) await session.resize(p.width, p.height);
                        const info = session.sessionInfo();
                        return {
                                summary:
                                        info.mode === "attach"
                                                ? `attached to browser (ws) — ${info.pages} tab(s)`
                                                : `browser started (${info.source}) headless=${info.headless} profile=${info.tempProfile ? "temp (persistent profile was locked — another unown owns it)" : info.profileDir}`,
                                details: [
                                        `executable: ${info.executable ?? "(attached)"}`,
                                        `viewport: ${info.viewport.width}x${info.viewport.height}`,
                                        `downloads land in: ${ctx.cwd}`,
                                ],
                        };
                }
                case "stop":
                        return session.stop();
                case "status": {
                        let discovery: string;
                        try {
                                const d = discoverBrowser();
                                discovery = `${d.path} (${d.source})`;
                        } catch (err: any) {
                                discovery = `not found: ${err?.message ?? err}`;
                        }
                        if (!session.isRunning) {
                                return { summary: "browser not running", details: [`discovered: ${discovery}`] };
                        }
                        const info = session.sessionInfo();
                        return {
                                summary: `running (${info.mode}) — ${info.pages} tab(s), active: ${info.activePage?.url ?? "none"}`,
                                details: [
                                        `executable: ${info.executable ?? "(attached)"}`,
                                        `profile: ${info.profileDir ?? "(attached browser)"}`,
                                        `viewport: ${info.viewport.width}x${info.viewport.height}`,
                                        `console: ${session.consoleEntries().length} entries, network: ${session.requestEntries().length} requests, downloads: ${session.downloadEntries().length}`,
                                ],
                        };
                }
                case "navigate":
                        abort();
                        if (!p.url) throw new Error("navigate needs url");
                        return session.navigate(p.url);
                case "back":
                        return session.goHistory("back");
                case "forward":
                        return session.goHistory("forward");
                case "reload":
                        return session.goHistory("reload");
                case "snapshot":
                        return session.snapshot({ includeBoxes: p.includeBoxes });
                case "find":
                        if (!p.text) throw new Error("find needs text");
                        return session.find(p.text);
                case "text":
                        return session.getText();
                case "html":
                        return session.getHtml(p.selector);
                case "click":
                        return session.click({
                                ref: p.ref,
                                selector: p.selector,
                                x: p.x,
                                y: p.y,
                                button: p.button,
                                doubleClick: p.doubleClick,
                                modifiers: p.modifiers,
                        });
                case "hover":
                        return session.hover({ ref: p.ref, selector: p.selector });
                case "type":
                        if (p.text === undefined) throw new Error("type needs text");
                        return session.type({ ref: p.ref, selector: p.selector, text: p.text, submit: p.submit, clear: p.clear });
                case "press_key":
                        if (!p.key) throw new Error("press_key needs key");
                        return session.pressKey(p.key);
                case "fill_form": {
                        const fields = (p.fields ?? []) as Array<{ ref?: string; selector?: string; value: string }>;
                        return session.fillForm(fields);
                }
                case "select_option": {
                        if (!p.values?.length) throw new Error("select_option needs values");
                        return session.selectOption({ ref: p.ref, selector: p.selector, values: p.values });
                }
                case "scroll":
                        return session.scroll({ direction: p.direction, amount: p.amount, ref: p.ref, selector: p.selector });
                case "drag":
                        return session.drag({ startRef: p.startRef, startSelector: p.startSelector, endRef: p.endRef, endSelector: p.endSelector });
                case "screenshot": {
                        let savePath: string | undefined;
                        if (p.filename) {
                                savePath = p.filename && isAbsolute(p.filename) ? p.filename : join(ctx.cwd, p.filename);
                        }
                        return session.screenshot({
                                fullPage: p.fullPage,
                                ref: p.ref,
                                selector: p.selector,
                                format: p.format,
                                quality: p.quality,
                                savePath,
                        });
                }
                case "eval":
                        if (!p.code) throw new Error("eval needs code");
                        return session.evalCode(p.code);
                case "tabs":
                        return session.tabs(p.tabsAction ?? "list", { index: p.index, url: p.url });
                case "wait":
                        return session.wait({
                                text: p.text,
                                textGone: p.textGone,
                                url: p.url,
                                time: p.time,
                                download: p.waitDownload,
                                timeoutMs: p.timeoutMs,
                        });
                case "resize":
                        if (!p.width || !p.height) throw new Error("resize needs width and height");
                        return session.resize(p.width, p.height);
                case "console": {
                        const entries = session.consoleEntries(p.level);
                        const tail = entries.slice(-40);
                        return {
                                summary: `${entries.length} console entr${entries.length === 1 ? "y" : "ies"}${p.level ? ` (level ${p.level})` : ""}`,
                                details: tail.length ? tail.map((e) => `[${e.level}] ${e.text}`) : ["(empty)"],
                        };
                }
                case "requests": {
                        const entries = session.requestEntries();
                        return {
                                summary: `${entries.length} network request(s)`,
                                details: entries.slice(-40).map((e) => `${e.method} ${e.status ?? (e.failed ? "FAILED" : "…")} ${e.resourceType} ${e.url.slice(0, 160)}`),
                        };
                }
                case "cookies":
                        return session.cookies(p.cookiesAction ?? "list", { url: p.url, name: p.name, value: p.value });
                case "upload": {
                        const paths = (p.paths ?? []) as string[];
                        if (!paths.length) throw new Error("upload needs paths");
                        // the upload jail (project root + system tmp, D11) is enforced
                        // inside session.uploadFiles — one enforcement point, every caller
                        return session.uploadFiles(paths, { ref: p.ref, selector: p.selector });
                }
                case "pdf":
                        return session.pdf({ filename: p.filename, landscape: p.landscape });
                case "storage": {
                        const action = p.storageAction ?? "save";
                        if (!p.path) throw new Error("storage needs path");
                        const abs = isAbsolute(p.path) ? p.path : join(ctx.cwd, p.path);
                        if (action === "save") return session.storageSave(abs);
                        return session.storageLoad(abs);
                }
                default:
                        throw new Error(`unknown browser action: ${p.action}`);
        }
}
