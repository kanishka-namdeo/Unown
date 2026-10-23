/**
 * browser/cdp.ts — a minimal Chrome DevTools Protocol client.
 *
 * Bun ships a native WebSocket, so driving a real Chromium needs no driver
 * dependency (D2 in docs/browser-research.md): launch the browser with
 * `--remote-debugging-port=0`, parse the endpoint it prints on stderr, and
 * speak the wire protocol documented at
 * https://chromedevtools.github.io/devtools-protocol/ (v1.3 flat session mode).
 *
 * Surface (deliberately small — everything else is plain CDP commands):
 *
 *   CdpConnection.launch({ executablePath, ... })   spawn + connect
 *   CdpConnection.attach(urlOrHttpEndpoint)          connect to a running browser
 *   conn.send(method, params?, sessionId?)          await one command
 *   conn.on(method, handler)                         subscribe to events
 *   conn.close()                                     Browser.close + kill
 *
 * The connection owns the child process when it launched the browser; attach
 * mode never kills the user's browser (only closes the socket).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export interface CdpEventHandler {
        (method: string, params: any, sessionId: string | undefined): void;
}

export interface LaunchOptions {
        executablePath: string;
        /** Persistent or temp profile directory. */
        userDataDir: string;
        headless: boolean;
        /** Extra chrome flags. */
        extraArgs?: string[];
        /** Initial window size for headed runs. */
        windowSize?: { width: number; height: number };
        /** Stderr is scanned for the DevTools endpoint (default 20s). */
        startupTimeoutMs?: number;
}

export class CdpError extends Error {
        constructor(
                message: string,
                public readonly code?: number,
                public readonly method?: string,
        ) {
                super(message);
                this.name = "CdpError";
        }
}

export class CdpConnection {
        private ws: WebSocket | null = null;
        private nextId = 1;
        private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string; timer: ReturnType<typeof setTimeout> }>();
        private handlers = new Map<string, Set<CdpEventHandler>>();
        private anyHandlers = new Set<CdpEventHandler>();
        private child: ChildProcess | null = null;
        private closed = false;
        /** Resolved when the socket or browser dies. */
        onDisconnected: Promise<void>;
        private disconnectedResolve!: () => void;

        private constructor(public readonly mode: "launch" | "attach", public readonly wsUrl: string) {
                this.onDisconnected = new Promise((resolve) => {
                        this.disconnectedResolve = resolve;
                });
        }

        get isClosed(): boolean {
                return this.closed;
        }

        // ------------------------------------------------------------------ launch

        static async launch(opts: LaunchOptions): Promise<CdpConnection> {
                const args = [
                        "--remote-debugging-port=0", // ephemeral port, printed on stderr
                        `--user-data-dir=${opts.userDataDir}`,
                        "--no-first-run",
                        "--no-default-browser-check",
                        "--disable-session-crashed-bubble",
                        "--disable-infobars",
                        // a real fingerprint, not stealth theater (D16): never pass
                        // --enable-automation (it sets navigator.webdriver=true) and drop
                        // the AutomationControlled blink feature.
                        "--disable-blink-features=AutomationControlled",
                        ...(opts.headless ? ["--headless", "--hide-scrollbars"] : []),
                        ...(opts.windowSize && !opts.headless
                                ? [`--window-size=${opts.windowSize.width},${opts.windowSize.height}`]
                                : []),
                        ...(opts.extraArgs ?? []),
                        "about:blank",
                ];
                const child = spawn(opts.executablePath, args, {
                        stdio: ["ignore", "ignore", "pipe"],
                        detached: false,
                });

                const endpoint = await new Promise<string>((resolve, reject) => {
                        const timer = setTimeout(
                                () => reject(new Error(`browser did not print a DevTools endpoint within ${opts.startupTimeoutMs ?? 20_000}ms — is the executable a Chromium-family browser? (path: ${opts.executablePath})`)),
                                opts.startupTimeoutMs ?? 20_000,
                        );
                        let buf = "";
                        const onData = (chunk: Buffer) => {
                                buf += chunk.toString("utf8");
                                const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
                                if (m) {
                                        clearTimeout(timer);
                                        resolve(m[1]);
                                }
                        };
                        child.stderr!.on("data", onData);
                        child.once("exit", (code, signal) => {
                                clearTimeout(timer);
                                reject(new Error(`browser exited during startup (code=${code} signal=${signal}) — try UNOWN_BROWSER_HEADLESS=1 or a different executable`));
                        });
                }).catch((err) => {
                        try {
                                child.kill();
                        } catch {
                                /* already gone */
                        }
                        throw err;
                });

                const conn = new CdpConnection("launch", endpoint);
                conn.child = child;
                // A dead child must fail pending commands, not hang them.
                child.once("exit", () => {
                        conn.failPending(new CdpError("browser process exited"));
                        conn.markClosed();
                });
                await conn.connect();
                return conn;
        }

        // ------------------------------------------------------------------ attach

        /**
         * Attach to a running browser. Accepts a ws:// endpoint, an http(s)://
         * host:port (the /json/version discovery endpoint), or host:port.
         */
        static async attach(input: string, fetchTimeoutMs = 5_000): Promise<CdpConnection> {
                let wsUrl = input.trim();
                if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
                        const httpUrl = wsUrl.startsWith("http") ? wsUrl.replace(/\/$/, "") : `http://${wsUrl}`;
                        const versionUrl = httpUrl.endsWith("/json/version") ? httpUrl : `${httpUrl}/json/version`;
                        const res = await fetch(versionUrl, { signal: AbortSignal.timeout(fetchTimeoutMs) });
                        if (!res.ok) throw new Error(`CDP attach: ${versionUrl} responded ${res.status}`);
                        const info = (await res.json()) as { webSocketDebuggerUrl?: string };
                        if (!info.webSocketDebuggerUrl) throw new Error(`CDP attach: ${versionUrl} returned no webSocketDebuggerUrl`);
                        wsUrl = info.webSocketDebuggerUrl;
                }
                const conn = new CdpConnection("attach", wsUrl);
                await conn.connect();
                return conn;
        }

        // ------------------------------------------------------------------ socket

        private connect(): Promise<void> {
                return new Promise((resolve, reject) => {
                        let ws: WebSocket;
                        try {
                                ws = new WebSocket(this.wsUrl);
                        } catch (err: any) {
                                reject(new CdpError(`cannot open CDP websocket (${err instanceof Error ? err.message : String(err)})`));
                                return;
                        }
                        this.ws = ws;
                        const fail = (why: string) => {
                                if (this.closed) return resolve(); // close() raced the handshake
                                this.markClosed();
                                this.failPending(new CdpError(why));
                                reject(new CdpError(why));
                        };
                        ws.addEventListener("open", () => resolve(), { once: true });
                        ws.addEventListener("error", () => fail(`CDP websocket failed to connect (${this.wsUrl})`), { once: true });
                        ws.addEventListener("close", () => {
                                this.failPending(new CdpError("CDP websocket closed"));
                                this.markClosed();
                        }, { once: true });
                        ws.addEventListener("message", (ev: MessageEvent) => {
                                this.handleMessage(typeof ev.data === "string" ? ev.data : "");
                        });
                });
        }

        private handleMessage(raw: string) {
                let msg: any;
                try {
                        msg = JSON.parse(raw);
                } catch {
                        return;
                }
                if (typeof msg.id === "number") {
                        const entry = this.pending.get(msg.id);
                        if (!entry) return;
                        this.pending.delete(msg.id);
                        clearTimeout(entry.timer);
                        if (msg.error) {
                                entry.reject(new CdpError(`${msg.error.message || "CDP error"}${msg.error.data ? ` — ${msg.error.data}` : ""}`, msg.error.code, entry.method));
                        } else {
                                entry.resolve(msg.result ?? {});
                        }
                        return;
                }
                // event
                const { method, params, sessionId } = msg;
                if (typeof method !== "string") return;
                const set = this.handlers.get(method);
                if (set) for (const h of set) h(method, params, sessionId);
                for (const h of this.anyHandlers) h(method, params, sessionId);
        }

        // ------------------------------------------------------------------ commands

        /** Send one CDP command and await its response. */
        send(method: string, params: Record<string, unknown> = {}, opts: { sessionId?: string; timeoutMs?: number } = {}): Promise<any> {
                if (this.closed) return Promise.reject(new CdpError("CDP connection is closed", undefined, method));
                const id = this.nextId++;
                const timeoutMs = opts.timeoutMs ?? 30_000;
                return new Promise((resolve, reject) => {
                        const timer = setTimeout(() => {
                                this.pending.delete(id);
                                reject(new CdpError(`CDP command timed out after ${timeoutMs}ms: ${method}`, -32603, method));
                        }, timeoutMs);
                        timer.unref?.();
                        this.pending.set(id, { resolve, reject, method, timer });
                        const payload: Record<string, unknown> = { id, method, params };
                        if (opts.sessionId) payload.sessionId = opts.sessionId;
                        try {
                                this.ws!.send(JSON.stringify(payload));
                        } catch (err: any) {
                                this.pending.delete(id);
                                clearTimeout(timer);
                                reject(new CdpError(`CDP send failed (${err instanceof Error ? err.message : String(err)})`, undefined, method));
                        }
                });
        }

        /** Subscribe to an event. Returns an unsubscribe function. */
        on(method: string, handler: CdpEventHandler): () => void {
                let set = this.handlers.get(method);
                if (!set) {
                        set = new Set();
                        this.handlers.set(method, set);
                }
                set.add(handler);
                return () => set!.delete(handler);
        }

        /** Subscribe to every event (browser taps). */
        onAny(handler: CdpEventHandler): () => void {
                this.anyHandlers.add(handler);
                return () => this.anyHandlers.delete(handler);
        }

        // ------------------------------------------------------------------ teardown

        /** Graceful close: Browser.close when we own the process, then socket. */
        async close(): Promise<void> {
                if (this.closed) return;
                this.closed = true;
                try {
                        if (this.mode === "launch" && this.ws && this.ws.readyState === WebSocket.OPEN) {
                                // Browser.close makes Chrome shut down its children and exit.
                                await Promise.race([
                                        this.send("Browser.close", {}, { timeoutMs: 3_000 }).catch(() => undefined),
                                        sleep(3_000),
                                ]);
                        }
                } finally {
                        try {
                                this.ws?.close();
                        } catch {
                                /* already closed */
                        }
                        if (this.child) {
                                // belt + suspenders: Chrome may ignore Browser.close while a
                                // modal is up. SIGTERM the process, then SIGKILL after a grace.
                                try {
                                        this.child.kill("SIGTERM");
                                } catch {
                                        /* already gone */
                                }
                                const child = this.child;
                                setTimeout(() => {
                                        try {
                                                if (child.exitCode === null) child.kill("SIGKILL");
                                        } catch {
                                                /* already gone */
                                        }
                                }, 2_000).unref?.();
                        }
                        this.failPending(new CdpError("CDP connection closed"));
                        this.disconnectedResolve();
                }
        }

        private markClosed() {
                if (this.closed) return;
                this.closed = true;
                try {
                        this.ws?.close();
                } catch {
                        /* ignore */
                }
                this.disconnectedResolve();
        }

        private failPending(err: Error) {
                for (const [, entry] of this.pending) {
                        clearTimeout(entry.timer);
                        entry.reject(err);
                }
                this.pending.clear();
        }
}

// ---------------------------------------------------------------------------
// key name → CDP key events (browser key strings: "Enter", "Control+a", ...)
// ---------------------------------------------------------------------------

const KEY_NAMES: Record<string, { key: string; code: string; vk: number; text?: string }> = {
        // `text` is not decoration: Blink runs a key's DEFAULT ACTION (form
        // submit on Enter, button activation on Space) only when the keyDown
        // carries its char event — a rawKeyDown Enter does nothing on a form
        // (measured against news.ycombinator.com's plain search form:
        // rawKeyDown → no navigation; keyDown with text "\r" → submits).
        enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
        tab: { key: "Tab", code: "Tab", vk: 9 },
        escape: { key: "Escape", code: "Escape", vk: 27 },
        backspace: { key: "Backspace", code: "Backspace", vk: 8 },
        delete: { key: "Delete", code: "Delete", vk: 46 },
        space: { key: " ", code: "Space", vk: 32, text: " " },
        arrowup: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
        arrowdown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
        arrowleft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
        arrowright: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
        home: { key: "Home", code: "Home", vk: 36 },
        end: { key: "End", code: "End", vk: 35 },
        pageup: { key: "PageUp", code: "PageUp", vk: 33 },
        pagedown: { key: "PageDown", code: "PageDown", vk: 34 },
        f1: { key: "F1", code: "F1", vk: 112 },
        f2: { key: "F2", code: "F2", vk: 113 },
        f3: { key: "F3", code: "F3", vk: 114 },
        f4: { key: "F4", code: "F4", vk: 115 },
        f5: { key: "F5", code: "F5", vk: 116 },
        f6: { key: "F6", code: "F6", vk: 117 },
        f7: { key: "F7", code: "F7", vk: 118 },
        f8: { key: "F8", code: "F8", vk: 119 },
        f9: { key: "F9", code: "F9", vk: 120 },
        f10: { key: "F10", code: "F10", vk: 121 },
        f11: { key: "F11", code: "F11", vk: 122 },
        f12: { key: "F12", code: "F12", vk: 123 },
};

export interface ParsedKey {
        parts: Array<{ key: string; code: string; vk: number; text?: string }>;
}

/**
 * Parse a keyboard combo ("Control+a", "Enter", "cmd+shift+p") into the CDP
 * keyDown/keyUp sequence parts. Modifier keys are pressed for the duration of
 * the combo; the final non-modifier key gets a char event when printable.
 */
export function parseKeyCombo(input: string): ParsedKey {
        const parts: ParsedKey["parts"] = [];
        const segments = input.split("+").map((s) => s.trim()).filter(Boolean);
        const modifiers = segments.slice(0, -1);
        const final = segments[segments.length - 1] ?? "";
        const modMap: Record<string, { key: string; code: string; vk: number }> = {
                ctrl: { key: "Control", code: "ControlLeft", vk: 17 },
                control: { key: "Control", code: "ControlLeft", vk: 17 },
                alt: { key: "Alt", code: "AltLeft", vk: 18 },
                option: { key: "Alt", code: "AltLeft", vk: 18 },
                shift: { key: "Shift", code: "ShiftLeft", vk: 16 },
                meta: { key: "Meta", code: "MetaLeft", vk: 91 },
                cmd: { key: "Meta", code: "MetaLeft", vk: 91 },
                command: { key: "Meta", code: "MetaLeft", vk: 91 },
                super: { key: "Meta", code: "MetaLeft", vk: 91 },
        };
        for (const m of modifiers) {
                const def = modMap[m.toLowerCase()];
                if (def) parts.push(def);
        }
        const lower = final.toLowerCase();
        if (KEY_NAMES[lower]) {
                parts.push(KEY_NAMES[lower]);
        } else if (final.length === 1) {
                parts.push({
                        key: final,
                        code: final === final.toUpperCase() && final !== final.toLowerCase() ? `Key${final.toUpperCase()}` : `Key${final.toUpperCase()}`,
                        vk: final.toUpperCase().charCodeAt(0),
                        text: final,
                });
        } else {
                // unknown multi-char key — send it as text-ish single events
                for (const ch of final) parts.push({ key: ch, code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0), text: ch });
        }
        return { parts };
}

/** CDP modifier bitmask for the parsed combo (used on mouse events too). */
export function modifierBits(names: string[] | undefined): number {
        let bits = 0;
        for (const raw of names ?? []) {
                switch (raw.toLowerCase()) {
                        case "alt":
                        case "option":
                                bits |= 1;
                                break;
                        case "ctrl":
                        case "control":
                                bits |= 2;
                                break;
                        case "meta":
                        case "cmd":
                        case "command":
                        case "super":
                                bits |= 4;
                                break;
                        case "shift":
                                bits |= 8;
                                break;
                }
        }
        return bits;
}
