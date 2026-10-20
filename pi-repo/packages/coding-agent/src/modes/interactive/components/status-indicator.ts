import { type Component, Loader, type TUI } from "@earendil-works/pi-tui";
import type { WorkingIndicatorOptions } from "../../../core/extensions/index.ts";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { keyText } from "./keybinding-hints.ts";
import { workingLabelShimmer } from "./shimmer-label.ts";

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

/**
 * Move 7 (verb-first labels): name the activity, not a generic "Working...".
 * Maps the registered core tool names onto a short verb-first phrase built
 * from the tool's primary argument; unknown tools get a title-cased verb.
 * Returns undefined for transient reads that should not disturb the label.
 */
export function describeToolActivity(toolName: string, args: unknown): string | undefined {
	const a = (args ?? {}) as Record<string, unknown>;
	const filePath = typeof a.file_path === "string" ? a.file_path : typeof a.path === "string" ? a.path : undefined;
	const base = filePath?.split(/[\\/]/).pop();
	switch (toolName) {
		case "edit":
			return base ? `Editing ${base}...` : "Editing files...";
		case "write":
			return base ? `Writing ${base}...` : "Writing files...";
		case "read":
			return base ? `Reading ${base}...` : "Reading files...";
		case "bash":
		case "powershell": {
			const command = typeof a.command === "string" ? a.command.trim().split(/\s+/)[0] : undefined;
			return command ? `Running ${command}...` : "Running command...";
		}
		case "grep":
			return "Searching files...";
		case "find":
			return "Finding files...";
		case "ls":
			return "Listing directory...";
		default:
			// Internal read-backs (e.g. bash_output) keep the current label.
			return toolName.endsWith("_output") ? undefined : `${toolName.charAt(0).toUpperCase()}${toolName.slice(1)}...`;
	}
}

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;
	private uiRef: TUI;
	private baseMessage: string;
	private readonly startedAt: number = Date.now();
	private elapsedTimerId: NodeJS.Timeout | null = null;
	private beatTimerId: NodeJS.Timeout | null = null;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
		this.uiRef = ui;
		this.baseMessage = message;
	}

	/** Track the label so the completion beat can resolve against the latest verb. */
	override setMessage(message: string): void {
		this.baseMessage = message;
		super.setMessage(message);
	}

	/**
	 * The elapsed-time chip (move 7): `mm:ss` in dim, ticking once a second on
	 * the loader's suffix lane. Long tool runs read as live progress without
	 * touching the label itself.
	 */
	showElapsedChip(): void {
		this.hideElapsedChip();
		this.setSuffixProvider(() => {
			const seconds = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
			const mm = Math.floor(seconds / 60);
			const ss = String(seconds % 60).padStart(2, "0");
			return theme.fg("dim", ` ${mm}:${ss}`);
		});
		// The same 1s tick advances the shimmer's phase (beauty-4) — one timer,
		// two lanes: the mm:ss chip and the label's gradient sweep.
		this.elapsedTimerId = setInterval(() => {
			this.advanceShimmerPhase();
			this.refresh();
		}, 1000);
	}

	hideElapsedChip(): void {
		if (this.elapsedTimerId) {
			clearInterval(this.elapsedTimerId);
			this.elapsedTimerId = null;
		}
		this.setSuffixProvider(undefined);
	}

	/**
	 * The completion beat (move 7): the spinner morphs to a ✓ in the success
	 * color and the line lingers ~600 ms before the caller clears it — motion
	 * resolves instead of a binary jump into the next block.
	 */
	completeBeat(onDone: () => void): void {
		this.stop();
		this.hideElapsedChip();
		const label = this.baseMessage.trim() || "done";
		this.setText(`${theme.fg("success", "✓")} ${theme.fg("muted", label)}`);
		this.uiRef.requestRender();
		this.beatTimerId = setTimeout(() => {
			this.beatTimerId = null;
			onDone();
		}, 600);
	}

	dispose(): void {
		this.hideElapsedChip();
		if (this.beatTimerId) {
			clearTimeout(this.beatTimerId);
			this.beatTimerId = null;
		}
		this.stop();
	}
}

export class WorkingStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, message: string, indicator?: WorkingIndicatorOptions) {
		super(
			"working",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			message,
			indicator,
		);
		// Beauty-4: the verb label shimmers while the turn runs — the sweep steps
		// on the elapsed chip's 1s tick and degrades per the color-mode ladder
		// (2-3 step ramp in 256-color, solid in plain mode).
		this.setMessageShimmer(workingLabelShimmer(theme));
		this.showElapsedChip();
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		const emptyLine = " ".repeat(width);
		return [emptyLine, emptyLine];
	}
}
