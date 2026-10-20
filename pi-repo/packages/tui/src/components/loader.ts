import type { TUI } from "../tui.ts";
import { Text } from "./text.ts";

export interface LoaderIndicatorOptions {
	/** Animation frames. Use an empty array to hide the indicator. */
	frames?: string[];
	/** Frame interval in milliseconds for animated indicators. */
	intervalMs?: number;
}

const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL_MS = 80;

/**
 * Loader component that updates with an optional spinning animation.
 */
export class Loader extends Text {
	private frames = [...DEFAULT_FRAMES];
	private intervalMs = DEFAULT_INTERVAL_MS;
	private currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private ui: TUI | null = null;
	private renderIndicatorVerbatim = false;
	private spinnerColorFn: (str: string) => string;
	private messageColorFn: (str: string) => string;
	private message: string = "Loading...";
	/** Optional suffix appended after the message (e.g. an elapsed-time chip). */
	private suffixProvider: (() => string) | undefined;
	/** Optional per-phase message colorizer (e.g. a shimmer sweep). When set
	 *  it supersedes messageColorFn; the caller advances the phase on its own
	 *  tick lane — the loader adds no timer for it. */
	private messageShimmer: ((phase: number, text: string) => string) | undefined;
	private shimmerPhase = 0;

	constructor(
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string = "Loading...",
		indicator?: LoaderIndicatorOptions,
	) {
		super("", 1, 0);
		this.ui = ui;
		this.spinnerColorFn = spinnerColorFn;
		this.messageColorFn = messageColorFn;
		this.message = message;
		this.setIndicator(indicator);
	}

	render(width: number): string[] {
		return ["", ...super.render(width)];
	}

	start(): void {
		this.updateDisplay();
		this.restartAnimation();
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	setMessage(message: string): void {
		this.message = message;
		this.updateDisplay();
	}

	setIndicator(indicator?: LoaderIndicatorOptions): void {
		this.renderIndicatorVerbatim = indicator !== undefined;
		this.frames = indicator?.frames !== undefined ? [...indicator.frames] : [...DEFAULT_FRAMES];
		this.intervalMs = indicator?.intervalMs && indicator.intervalMs > 0 ? indicator.intervalMs : DEFAULT_INTERVAL_MS;
		this.currentFrame = 0;
		this.start();
	}

	/**
	 * Set (or clear) a suffix provider whose output is appended after the
	 * message on every display update. Pass undefined to remove the suffix.
	 */
	setSuffixProvider(fn?: () => string): void {
		this.suffixProvider = fn;
		this.updateDisplay();
	}

	/**
	 * Set (or clear) a per-phase message colorizer — e.g. a shimmer sweep
	 * whose band position advances with advanceShimmerPhase(). While set it
	 * supersedes messageColorFn; pass undefined to fall back to it.
	 */
	setMessageShimmer(fn?: (phase: number, text: string) => string): void {
		this.messageShimmer = fn;
		this.updateDisplay();
	}

	/** Advance the shimmer band one step; the caller then refresh()es. */
	advanceShimmerPhase(): void {
		this.shimmerPhase++;
	}

	/** Re-render the display; lets callers refresh dynamic suffixes on a timer. */
	refresh(): void {
		this.updateDisplay();
	}

	private restartAnimation(): void {
		this.stop();
		if (this.frames.length <= 1) {
			return;
		}
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, this.intervalMs);
	}

	private updateDisplay(): void {
		const frame = this.frames[this.currentFrame] ?? "";
		const renderedFrame = this.renderIndicatorVerbatim ? frame : this.spinnerColorFn(frame);
		const indicator = frame.length > 0 ? `${renderedFrame} ` : "";
		const message = this.messageShimmer
			? this.messageShimmer(this.shimmerPhase, this.message)
			: this.messageColorFn(this.message);
		this.setText(`${indicator}${message}${this.suffixProvider?.() ?? ""}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
