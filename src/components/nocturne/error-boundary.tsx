"use client";

/**
 * NocturneViewBoundary — a React error boundary that wraps the
 * shell's active view render. A crash inside a single view (the F12
 * class: a detail lane that read an `undefined` field and threw)
 * unmounts only THAT view and shows an inline error card instead of
 * taking down the whole Nocturne tree — the resilience lane's
 * "zero blank screens" requirement. The boundary is stateful (class
 * component) so a fresh mount (e.g. switching tabs back and
 * forward) re-arms it.
 */
import { Component, type ReactNode, type ErrorInfo } from "react";

interface ViewBoundaryProps {
  /** The view id, used to key the boundary per-tab so switching
   *  tabs remounts it (a new boundary absorbs the next crash). */
  viewId: string;
  /** A recovery hint for the card's action. */
  onReset?: () => void;
  children: ReactNode;
}

interface ViewBoundaryState {
  error: Error | null;
}

export class NocturneViewBoundary extends Component<
  ViewBoundaryProps,
  ViewBoundaryState
> {
  state: ViewBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the error (console is enough for the demo lane; a
    // production build would report to the engine's telemetry).
    console.error("Nocturne view crash", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm"
        >
          <h2 className="text-base font-bold text-danger">
            This view hit an error
          </h2>
          <p className="mt-1 text-xs text-muted">
            {error.message}
          </p>
          {this.props.onReset ? (
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset?.();
              }}
              className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-1 text-xs hover:border-accent"
            >
              Try again
            </button>
          ) : (
            <p className="mt-2 text-xs text-muted">
              Switching to another tab and back will reload this view.
            </p>
          )}
        </div>
      );
    }
    // Key the boundary by `viewId` so a tab switch remounts it (the
    // "new boundary absorbs the next crash" behaviour).
    return (
      <div key={this.props.viewId} data-view-boundary={this.props.viewId}>
        {this.props.children}
      </div>
    );
  }
}
