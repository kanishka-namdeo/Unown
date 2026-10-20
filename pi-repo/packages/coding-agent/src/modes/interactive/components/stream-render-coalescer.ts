/**
 * Stream render coalescer — move 9 of docs/tui-beautification-plan.md
 * ("Arrival pacing (TuiMainScreen / streaming path)").
 *
 * Batches streaming line-appends to at most one render per `minIntervalMs`
 * (default 125ms, i.e. <=8 fps) so long outputs arrive in smooth chunks
 * instead of line-flicker. The capture harness already proved 8 fps looks
 * calm; this applies the same math live to the streaming path.
 *
 * Scope guard: the 8fps cap applies ONLY to streaming text arrival. Spinner
 * animation ticks (80ms) and the completion beat keep their own faster
 * cadence and must NOT be routed through this scheduler.
 *
 * Wiring into interactive-mode is intentionally a few lines:
 *
 * ```ts
 * const scheduler = createStreamRenderCoalescer(() => this.ui.requestRender());
 * // case "message_update":         scheduler.requestRender();  // was this.ui.requestRender()
 * // case "message_end"/"agent_end"/"tool_execution_start": scheduler.flush();
 * // shutdown/dispose:              scheduler.dispose();
 * ```
 */

/**
 * Handle returned by {@link createStreamRenderCoalescer}. Mirrors the subset
 * of the TUI render API the streaming path needs, so it can be swapped in
 * for a bare `this.ui.requestRender()` call.
 */
export interface StreamRenderScheduler {
	/**
	 * Request a render of the streaming component. When no coalesce window is
	 * open, renders immediately and opens a window; while a window is open,
	 * only marks pending (at most one render per window). The trailing update
	 * is never dropped: if anything was marked pending, closing the window
	 * renders exactly once more and opens the next window.
	 */
	requestRender(): void;

	/**
	 * Cancel any open coalesce window and render once if a request was
	 * suppressed. Call at stream boundaries (message_end / agent_end /
	 * tool_execution_start) so the final chunk never waits out the window.
	 * No-op when nothing is pending — flush() never invents a render.
	 */
	flush(): void;

	/**
	 * Terminal teardown: clears any open window and suppressed request.
	 * After dispose() the scheduler never renders again; later
	 * requestRender()/flush() calls are no-ops and schedule no timers.
	 */
	dispose(): void;
}

export interface StreamRenderCoalescerOptions {
	/**
	 * Minimum spacing between coalesced renders, in milliseconds.
	 * Default 125 (<=8 fps per move 9). Non-finite or non-positive values
	 * fall back to the default.
	 */
	minIntervalMs?: number;
}

/** Move 9's pacing budget: 125ms per window ≈ 8 renders/second. */
const DEFAULT_MIN_INTERVAL_MS = 125;

/**
 * Creates a render coalescer for the streaming path (move 9: arrival
 * pacing). Dependency-light by design: only `render` is captured, all
 * bookkeeping is plain locals, and timers go through setTimeout/clearTimeout
 * so the class works under Node and fake-timer test harnesses alike.
 *
 * Behavior contract:
 * - at most one `render()` per `minIntervalMs` window;
 * - the first request after an idle period renders immediately (leading edge
 *   is never delayed);
 * - the last pending request always renders (trailing edge is never dropped)
 *   — either at window close or early via {@link StreamRenderScheduler.flush};
 * - idle state leaves no timers running.
 *
 * @param render - performs the actual TUI render request (e.g.
 * `() => this.ui.requestRender()`).
 * @param opts - optional {@link StreamRenderCoalescerOptions}.
 */
export function createStreamRenderCoalescer(
	render: () => void,
	opts?: StreamRenderCoalescerOptions,
): StreamRenderScheduler {
	const requested = opts?.minIntervalMs;
	const minIntervalMs =
		requested !== undefined && Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_MIN_INTERVAL_MS;

	let windowTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingRender = false;
	let disposed = false;

	/** Open a coalesce window; at most one is ever armed. */
	const armWindow = () => {
		windowTimer = setTimeout(closeWindow, minIntervalMs);
	};

	/**
	 * Window elapsed. If a request was suppressed mid-window, render exactly
	 * once and open the next window; otherwise the pipeline is idle again
	 * and no timer is left running.
	 */
	const closeWindow = () => {
		windowTimer = undefined;
		if (pendingRender) {
			pendingRender = false;
			render();
			armWindow();
		}
	};

	return {
		requestRender() {
			if (disposed) return;
			if (windowTimer === undefined) {
				render();
				armWindow();
				return;
			}
			pendingRender = true;
		},
		flush() {
			if (disposed) return;
			const suppressed = pendingRender;
			pendingRender = false;
			if (windowTimer !== undefined) {
				clearTimeout(windowTimer);
				windowTimer = undefined;
			}
			if (suppressed) {
				render();
			}
		},
		dispose() {
			disposed = true;
			pendingRender = false;
			if (windowTimer !== undefined) {
				clearTimeout(windowTimer);
				windowTimer = undefined;
			}
		},
	};
}
