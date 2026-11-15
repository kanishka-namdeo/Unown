import { type Component, Container } from "@earendil-works/pi-tui";
import { keyText } from "./keybinding-hints.ts";
import { theme } from "../theme/theme.ts";
import type { DiffLineCounts } from "./session-diff-stats.ts";
import { ToolExecutionComponent } from "./tool-execution.ts";

/**
 * Tool-call aggregation (Toccata round A10) — the Claude Code collapsed-run
 * contract: a run of consecutive calls to the SAME tool renders as one dim
 * chip (`⋯ called bash ×3 · ctrl+o`) while tool output is collapsed, and
 * expands to the individual blocks on the expand key. A different tool call
 * in between splits the run (the container-level rule); present tense while
 * the run is still executing, past tense when complete.
 *
 * The group wraps even single calls (count 1 delegates to the child
 * untouched) so no container reflow is ever needed when a run grows.
 */
export class ToolCallGroupComponent extends Container {
        private readonly calls: ToolExecutionComponent[] = [];
        private expanded = false;

        constructor(firstCall: ToolExecutionComponent) {
                super();
                this.calls.push(firstCall);
        }

        getToolName(): string {
                return this.calls[0]?.getToolName() ?? "";
        }

        get callCount(): number {
                return this.calls.length;
        }

        /** Add a consecutive same-tool call to this run. */
        adopt(component: ToolExecutionComponent): void {
                this.calls.push(component);
        }

        /** Remove a call from the run; returns true when the call belonged to this group. */
        removeCall(component: ToolExecutionComponent): boolean {
                const index = this.calls.indexOf(component);
                if (index === -1) return false;
                this.calls.splice(index, 1);
                return true;
        }

        setExpanded(expanded: boolean): void {
                this.expanded = expanded;
                for (const call of this.calls) call.setExpanded(expanded);
        }

        /** The group's contribution to the footer's session diff-stat chip: the sum over the run. */
        diffLineCounts(): DiffLineCounts | undefined {
                let added = 0;
                let removed = 0;
                let seen = false;
                for (const call of this.calls) {
                        const counts = call.diffLineCounts();
                        if (!counts) continue;
                        seen = true;
                        added += counts.added;
                        removed += counts.removed;
                }
                return seen ? { added, removed } : undefined;
        }

        override invalidate(): void {
                for (const call of this.calls) call.invalidate?.();
        }

        override render(width: number): string[] {
                if (this.calls.length === 0) return [];
                if (this.calls.length === 1 || this.expanded) {
                        const lines: string[] = [];
                        for (const call of this.calls) {
                                lines.push(...call.render(width));
                        }
                        return lines;
                }
                return [this.renderSummaryLine()];
        }

        private renderSummaryLine(): string {
                const running = this.calls.some((call) => call.isExecutionPartial());
                const verb = running ? "calling" : "called";
                const trailing = running ? "…" : "";
                const label = theme.fg("dim", `⋯ ${verb} ${this.getToolName()} ×${this.calls.length}${trailing}`);
                const expandKey = keyText("app.tools.expand");
                const hint = expandKey ? theme.fg("dim", " · ") + theme.fg("muted", expandKey) : "";
                return `${label}${hint}`;
        }
}

/**
 * The chat transcript container with run-aware adoption: consecutive
 * ToolExecutionComponents for the same tool name join the previous run's
 * group; any other component (an assistant text block, a user message, a
 * status entry) breaks the run. Grouping is purely a rendering concern —
 * per-call routing (pendingTools, updateResult, diff folding) still
 * addresses the individual ToolExecutionComponent instances.
 */
export class ChatTranscriptContainer extends Container {
        private trailingGroup?: ToolCallGroupComponent;

        override addChild(component: Component): void {
                if (component instanceof ToolExecutionComponent) {
                        const name = component.getToolName();
                        if (this.trailingGroup && this.trailingGroup.getToolName() === name) {
                                this.trailingGroup.adopt(component);
                                return;
                        }
                        const group = new ToolCallGroupComponent(component);
                        this.trailingGroup = group;
                        super.addChild(group);
                        return;
                }
                this.trailingGroup = undefined;
                super.addChild(component);
        }

        override removeChild(component: Component): void {
                if (component instanceof ToolExecutionComponent) {
                        // A bare call removal unwraps from its group; the group stays
                        // as long as it still holds calls.
                        for (const child of this.children) {
                                if (child instanceof ToolCallGroupComponent && child.removeCall(component)) {
                                        if (child.callCount === 0) super.removeChild(child);
                                        return;
                                }
                        }
                        return;
                }
                if (component === this.trailingGroup) this.trailingGroup = undefined;
                super.removeChild(component);
        }

        override clear(): void {
                this.trailingGroup = undefined;
                super.clear();
        }
}
