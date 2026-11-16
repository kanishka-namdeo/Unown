/**
 * Da capo R2 — the statusline script contract (docs/tui-claude-code-parity-research-2.md).
 *
 * Claude Code's single largest community ecosystem is the statusline: a user-configured
 * command that receives a JSON payload on stdin and whose stdout renders as a row in the
 * chrome. This is the fork's form of that contract:
 *
 *   - settings `statusLine: { command, refreshMs? }` (GLOBAL scope only — a project repo
 *     can't run commands in your bar, the keybindings precedent);
 *   - the payload carries the fields Unown actually owns (session, cwd/project, model,
 *     thinking level, permission mode, context-window usage, tokens, turn count, queued
 *     messages, version, uptime);
 *   - stdout renders as ONE row above the quiet footer through the normal component
 *     pipeline — no raw writes, no whole-screen redraws (the flicker law);
 *   - ANSI passthrough (the script's own colors/attributes survive), max 2 lines, each
 *     padded/truncated to the viewport width;
 *   - 500 ms spawn timeout, failures keep the last good lines (no flicker, no spam);
 *   - refresh on turn end plus an optional `refreshMs` timer (minimum 1 s);
 *   - `UNOWN_STATUSLINE=0` is the kill switch.
 *
 * The footer's hint line is NOT hidden while a statusline is active (Claude Code hides
 * its footer hints — the fork keeps discoverability).
 */

import { spawn } from "node:child_process";
import { basename } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** The JSON payload a statusline script receives on stdin (UTF-8, single line). */
export interface StatusLinePayload {
	/** Session identity. */
	session: {
		id: string;
		name: string | undefined;
	};
	/** Current working directory and its basename (the project label). */
	cwd: string;
	project: string;
	/** The active model. */
	model: {
		id: string | undefined;
		provider: string | undefined;
	};
	/** Effort / thinking level (minimal | low | medium | high | xhigh). */
	thinkingLevel: string | undefined;
	/** Unown permission mode (default | acceptEdits | bypassPermissions); absent when the launcher provides none. */
	permissionMode: string | undefined;
	/** Context-window usage; nulls when unknown (e.g. first turn after compaction). */
	contextWindow: {
		usedPercent: number | null;
		tokens: number | null;
		window: number | null;
	};
	/** Cumulative session token usage. */
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	/** Completed assistant turns in this session. */
	turnCount: number;
	/** Messages queued while the agent works. */
	queuedMessages: number;
	/** The app version (e.g. "0.0.68"). */
	version: string;
	/** Milliseconds since the TUI booted. */
	uptimeMs: number;
}

/** The plain inputs the host collects to build the payload (testable without a session). */
export interface StatusLineInput {
	sessionId: string;
	sessionName?: string;
	cwd: string;
	modelId?: string;
	modelProvider?: string;
	thinkingLevel?: string;
	permissionMode?: string;
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	turnCount: number;
	queuedMessages: number;
	version: string;
	/** When the TUI booted (uptime source). */
	bootedAtMs: number;
	/** Test seam; defaults to Date.now(). */
	nowMs?: number;
}

/** Pure payload builder — the contract between the host and the script. */
export function buildStatusLinePayload(input: StatusLineInput): StatusLinePayload {
	const now = input.nowMs ?? Date.now();
	return {
		session: {
			id: input.sessionId,
			name: input.sessionName,
		},
		cwd: input.cwd,
		project: basename(input.cwd),
		model: {
			id: input.modelId,
			provider: input.modelProvider,
		},
		thinkingLevel: input.thinkingLevel,
		permissionMode: input.permissionMode,
		contextWindow: {
			usedPercent: input.contextUsage ? (input.contextUsage.percent === null ? null : round1(input.contextUsage.percent)) : null,
			tokens: input.contextUsage?.tokens ?? null,
			window: input.contextUsage?.contextWindow ?? null,
		},
		tokens: {
			input: input.tokens.input,
			output: input.tokens.output,
			cacheRead: input.tokens.cacheRead,
			cacheWrite: input.tokens.cacheWrite,
			total: input.tokens.total,
		},
		turnCount: input.turnCount,
		queuedMessages: input.queuedMessages,
		version: input.version,
		uptimeMs: Math.max(0, now - input.bootedAtMs),
	};
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

export type StatusLineRunResult = { ok: true; stdout: string } | { ok: false; reason: "timeout" | "error" | "nonzero" };

/** Injectable spawn seam (tests inject a fake; production uses child_process.spawn). */
export type StatusLineSpawnFn = (
	command: string,
	args: string[],
	options: { shell: boolean; stdio: ["pipe", "pipe", "ignore"] },
) => {
	stdin: { write(data: string): void; end(): void; on(event: "error", listener: (err: Error) => void): void };
	stdout: { on(event: "data", listener: (data: Buffer) => void): void };
	on(event: "error" | "close", listener: (...args: never[]) => void): void;
	kill(): void;
};

/**
 * Run the statusline command with the payload on stdin. Shell execution so
 * one-liners (`echo …`, pipes, quoted args) work — the command comes from the
 * user's own global settings, the same trust level as `externalEditor`.
 */
export async function runStatusLineCommand(
	command: string,
	payload: StatusLinePayload,
	options: { timeoutMs?: number; maxOutputBytes?: number; spawnFn?: StatusLineSpawnFn; env?: Record<string, string | undefined> } = {},
): Promise<StatusLineRunResult> {
	const timeoutMs = options.timeoutMs ?? 500;
	const maxOutputBytes = options.maxOutputBytes ?? 65536;
	const spawnFn = options.spawnFn ?? ((cmd, args, opts) => spawn(cmd, args, { ...opts, env: options.env ? { ...process.env, ...options.env } : process.env }) as never);

	return new Promise<StatusLineRunResult>((resolve) => {
		let settled = false;
		let stdout = "";
		const finish = (result: StatusLineRunResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};

		let proc: ReturnType<StatusLineSpawnFn>;
		try {
			proc = spawnFn(command, [], { shell: true, stdio: ["pipe", "pipe", "ignore"] });
		} catch {
			resolve({ ok: false, reason: "error" });
			return;
		}

		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {
				/* already gone */
			}
			finish({ ok: false, reason: "timeout" });
		}, timeoutMs);

		proc.stdin.on("error", () => {
			/* EPIPE when the script exits without reading stdin — the close handler decides. */
		});
		try {
			proc.stdin.write(JSON.stringify(payload));
			proc.stdin.end();
		} catch {
			/* the close/error handlers decide */
		}

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
			if (stdout.length > maxOutputBytes) {
				try {
					proc.kill();
				} catch {
					/* already gone */
				}
				finish({ ok: false, reason: "error" });
			}
		});

		proc.on("error", () => finish({ ok: false, reason: "error" }));
		proc.on("close", (code: number) => {
			if (code === 0) {
				finish({ ok: true, stdout });
			} else {
				finish({ ok: false, reason: "nonzero" });
			}
		});
	});
}

/**
 * Parse script stdout into renderable lines: split on newlines, drop trailing
 * empties, keep at most `maxLines`. ANSI escapes pass through untouched.
 */
export function parseStatusLineLines(stdout: string, maxLines = 2): string[] {
	const lines = stdout.replace(/\r/g, "").split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	if (lines.length === 0) {
		return [];
	}
	return lines.slice(0, maxLines);
}

/** The dim notice rendered when a configured statusline never produced output. */
export function statusLineFailureNotice(command: string): string {
	const short = command.length > 40 ? `${command.slice(0, 39)}…` : command;
	return `statusline: ${short} produced no output (exit non-zero, timed out, or failed — see /statusline)`;
}

export interface StatusLineComponentOptions {
	/** The shell command from global settings. */
	command: string;
	/** Collects the payload inputs (called on every refresh; may throw — treated as a failed run). */
	payloadProvider: () => StatusLineInput;
	/** Optional periodic refresh (ms, already clamped >= 1000 by the settings layer). */
	refreshMs?: number;
	/** Requests a re-render after a successful run. */
	onRequestRender: () => void;
	/** Test seams. */
	spawnFn?: StatusLineSpawnFn;
	nowMs?: () => number;
}

/**
 * The statusline row: a docked component between the widgets-below container and the
 * quiet footer. Content is refreshed out-of-band (turn end + optional timer); render
 * itself is synchronous from the cache — the spawn never blocks the paint.
 */
export class StatusLineComponent implements Component {
	private readonly options: StatusLineComponentOptions;
	private lines: string[] = [];
	private showFailureNotice = true;
	private timer?: ReturnType<typeof setInterval>;
	private running = false;
	private stopped = false;

	constructor(options: StatusLineComponentOptions) {
		this.options = options;
	}

	/** First refresh + the optional periodic timer. Call after the TUI started. */
	start(): void {
		if (this.stopped) return;
		void this.refresh();
		if (this.options.refreshMs && this.options.refreshMs >= 1000) {
			this.timer = setInterval(() => void this.refresh(), this.options.refreshMs);
		}
	}

	/** Refresh now (turn end). Skipped while a run is in flight — the next event retries. */
	async refresh(): Promise<void> {
		if (this.stopped || this.running) return;
		this.running = true;
		try {
			let input: StatusLineInput;
			try {
				input = this.options.payloadProvider();
			} catch {
				this.handleFailure();
				return;
			}
			const payload = buildStatusLinePayload(
				this.options.nowMs ? { ...input, nowMs: this.options.nowMs() } : input,
			);
			const result = await runStatusLineCommand(this.options.command, payload, { spawnFn: this.options.spawnFn });
			if (this.stopped) return;
			if (result.ok) {
				const lines = parseStatusLineLines(result.stdout);
				if (lines.length > 0) {
					this.lines = lines;
					this.showFailureNotice = false;
					this.options.onRequestRender();
				}
				// Empty output is a legitimate statusline (a script that goes quiet) —
				// never treated as a failure, never wipes good lines.
			} else {
				this.handleFailure();
			}
		} finally {
			this.running = false;
		}
	}

	private handleFailure(): void {
		if (!this.showFailureNotice || this.lines.length > 0) return;
		// One-time, dim, and self-healing: the first successful run replaces it.
		this.lines = [statusLineFailureNotice(this.options.command)];
		this.showFailureNotice = false;
		this.options.onRequestRender();
	}

	/** Clears the timer; in-flight runs ignore their results. */
	stop(): void {
		this.stopped = true;
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	invalidate(): void {
		// No theme-cached state — the script's own bytes render verbatim.
	}

	render(width: number): string[] {
		return this.lines.map((line) => {
			if (visibleWidth(line) > width) {
				return truncateToWidth(line, width);
			}
			const gap = " ".repeat(Math.max(0, width - visibleWidth(line)));
			return line + gap;
		});
	}
}
