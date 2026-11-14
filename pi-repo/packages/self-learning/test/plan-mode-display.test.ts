// plan-mode-display.test.ts — the plan-visibility round's pins.
//
// The reported defect: "user cannot see plan mode's created plan by default."
// Root cause (docs/plan-visibility-round-session.md): the plan existed in the
// plan file, the plan_write result and the exit_plan_mode result — and the
// TUI rendered none of them. Both renderers truncated to one capped line and
// ignored the `expanded` render option (Ctrl+O was a functional no-op), and
// the approval dialog showed only a score summary. No test anywhere pinned
// what the plan renderers display — the display lane was the unpinned lane.
//
// The contract (the seven-product field consensus, every claim sourced in the
// round doc): the plan is shown, in full, at the moment it is ready — never
// hidden by default; progressive disclosure (compact preview + expand key)
// applies only AFTER first presentation; the expand key renders through the
// live keybinding machinery, never a hardcoded "ctrl+o".
//
// Pins:
//   D1  plan_write's result carries the plan on the UI-only `details` channel
//       (never serialized to the provider) and the compact render shows the
//       objective + steps + score by default — not a bare score line
//   D2  the collapsed preview caps at PLAN_PREVIEW_STEPS_COLLAPSED steps with
//       a `⋯ N more` tail; the expand hint names the live expand key
//   D3  expanded (ctrl+o) renders the FULL plan markdown
//   D4  exit_plan_mode's approved result carries details and renders the
//       approval headline + the step checklist by default (the `n. ☐` glyph
//       format the todo-unification round pinned for the approved-plan echo)
//   D5  the rejected result renders the rejection + the user's feedback
//   D6  a stayed turn keeps the single-line render (nothing changed)
//   D7  the approval dialog's title carries the plan itself under the
//       unchanged `Plan ready — <score>` headline (the PTY anchor), capped,
//       with the byte-identical four options (the keyboard round's constants)
//   D8  legacy results (no details payload) recover the plan from the result
//       text markers — a resumed session never loses the approved plan
//   D9  the retrospective result renders the closed plan compactly
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { resetTodoAddonBridges } from "../src/addons/todo.ts";
import { EMPTY_PLAN_DOC, parsePlanMarkdown, scorePlanDoc } from "../src/plan.ts";
import {
        PLAN_DIALOG_PREVIEW_STEPS,
        PLAN_PREVIEW_STEPS_COLLAPSED,
        planApprovedLines,
        planDialogPreviewTitle,
        planExpandHintSuffix,
        planRejectedLines,
        planResultDetails,
        planRetrospectiveLines,
        planWritePreviewLines,
} from "../src/plan-display.ts";
import { createUnownToolsExtension } from "../src/tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-plan-display-test-"));
afterAll(() => {
        try {
                rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

// The renderers under test style the Markdown component through the app
// theme — the same global the real TUI initializes at boot. (The keybinding
// registry is deliberately NOT faked here: the expand-hint pairing is pinned
// by the PTY matrix lane on the real TUI; see D2.)
initTheme();

/** A V2-shaped plan that scores above the default threshold. */
const PLAN = `# Plan: Ship the export button

## Context
The dashboard needs an export button next to the filter bar.

## Approach
Add a button component wired to the existing export API endpoint.

## Steps
1. Add the button component (files: src/button.tsx)
2. Wire the click handler to the export API (files: src/dashboard.tsx)
3. Add the integration test (files: test/export.test.ts)
4. Document the button (files: docs/usage.md)

## Risks
- API rate limits under large exports.

## Verification
- bun test src
`;

const PLAN_12_STEPS = `# Plan: The long road

## Context
Twelve steps so the caps are exercised.

## Approach
One step at a time.

## Steps
${Array.from({ length: 12 }, (_, i) => `${i + 1}. Step number ${i + 1} does a distinct unit of work (files: f${i + 1}.ts)`).join("\n")}

## Risks
- Fatigue.

## Verification
- bun test src
`;

type Handler = (event: any, ctx?: any) => any;

function makeFakePi() {
        const handlers = new Map<string, Handler[]>();
        const commands = new Map<string, { description: string; handler: Handler }>();
        const shortcuts = new Map<string, { description?: string; handler: Handler }>();
        const tools = new Map<string, any>();
        const appended: Array<{ customType: string; data: any }> = [];
        const activeTools: string[] = ["read", "bash", "edit", "write", "todo", "task"];
        const pi: any = {
                on: (event: string, handler: Handler) => {
                        if (!handlers.has(event)) handlers.set(event, []);
                        handlers.get(event)!.push(handler);
                },
                registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
                registerFlag: () => {},
                registerTool: (tool: any) => tools.set(tool.name, tool),
                registerShortcut: (key: string, def: { description?: string; handler: Handler }) => shortcuts.set(key, def),
                appendEntry: (customType: string, data: unknown) => appended.push({ customType, data }),
                getFlag: () => undefined,
                getActiveTools: () => [...activeTools],
                setActiveTools: (next: string[]) => {
                        activeTools.length = 0;
                        activeTools.push(...next);
                },
                sendMessage: () => {},
                setModel: async () => true,
                setSessionName: () => {},
        };
        const emit = async (event: string, payload: any, ctx?: any) => {
                let result: any;
                for (const h of handlers.get(event) ?? []) {
                        const r = await h(payload, ctx);
                        if (r !== undefined) result = r;
                }
                return result;
        };
        const runTool = async (name: string, params: any, ctx: any) =>
                tools.get(name)!.execute("t", params, undefined, undefined, ctx);
        return { pi, emit, runTool, commands, shortcuts, tools, appended, activeTools };
}

/** A capture ctx with a scripted select and every dialog/notify recorded. */
function makeCaptureCtx(script: Array<string | undefined> = [], entries: any[] = []) {
        const widgets: Array<{ key: string; value: unknown }> = [];
        const statuses: Array<[string, string | undefined]> = [];
        const notices: Array<{ text: string; level: string }> = [];
        const selects: Array<{ title: string; options: string[] }> = [];
        let call = 0;
        const ctx = {
                hasUI: true,
                ui: {
                        select: async (title: string, options: string[]) => {
                                selects.push({ title, options });
                                return script[call++];
                        },
                        editor: async () => "",
                        input: async () => "",
                        notify: (text: string, level: string = "info") => notices.push({ text, level }),
                        setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
                        setWidget: (key: string, value: unknown) => widgets.push({ key, value }),
                        theme: { fg: (_name: string, text: string) => text },
                },
                sessionManager: { getEntries: () => entries, getSessionId: () => "s1", getBranch: () => entries },
        };
        return { ctx, widgets, statuses, notices, selects };
}

async function wire() {
        const dir = join(tmpRoot, `ext-${Math.random().toString(36).slice(2)}`);
        const toolsExt = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:9" });
        const fake = makeFakePi();
        toolsExt.factory(fake.pi);
        return fake;
}

/** Drive: enter plan mode → plan_write → (optional) exit_plan_mode. */
async function planSession(fake: any, plan: string, choice?: string) {
        const cap = makeCaptureCtx(choice !== undefined ? [choice] : []);
        await fake.emit("session_start", {}, cap.ctx);
        await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode ON
        const writeResult = await fake.runTool("plan_write", { content: plan }, cap.ctx);
        let exitResult: any;
        if (choice !== undefined) {
                exitResult = await fake.runTool("exit_plan_mode", {}, cap.ctx);
        }
        return { cap, writeResult, exitResult };
}

/** Render a tool's renderResult into plain text lines (theme = passthrough). */
function renderPlain(tool: any, result: any, options: { expanded?: boolean } = {}): string {
        const component = tool.renderResult(result, options, { fg: (_n: string, t: string) => t, bold: (t: string) => t });
        // Text and Markdown both implement Component.render(width) -> string[]
        const lines = component.render(80);
        return lines.map((l: string) => l).join("\n");
}

describe("the plan-mode display lane (the plan the user can finally see)", () => {
        beforeEach(() => {
                resetTodoAddonBridges();
        });

        test("D1: plan_write carries the plan on the UI-only details channel and the compact render shows it", async () => {
                const fake = await wire();
                const { writeResult } = await planSession(fake, PLAN);
                // The details payload rides the result (never serialized to the provider).
                expect(writeResult.details.outcome).toBe("written");
                expect(writeResult.details.plan).toContain("# Plan: Ship the export button");
                expect(writeResult.details.steps.length).toBe(4);
                // The model-facing text is unchanged (the critique advice lane).
                expect(writeResult.content[0].text).toContain("Plan written to");
                // The RENDER now shows the plan, not a bare score line.
                const rendered = renderPlain(fake.tools.get("plan_write"), writeResult);
                expect(rendered).toContain("Ship the export button");
                expect(rendered).toContain("Add the button component");
                expect(rendered).toContain("Wire the click handler");
        });

        test("D2: the collapsed preview caps steps; the hint degrades honestly without a registry", async () => {
                const fake = await wire();
                const { writeResult } = await planSession(fake, PLAN_12_STEPS);
                const rendered = renderPlain(fake.tools.get("plan_write"), writeResult);
                const stepLines = rendered.split("\n").filter((l) => /^\d+\. ☐ /.test(l.replace(/\u001b\[[0-9;]*m/g, "")));
                expect(stepLines.length).toBe(PLAN_PREVIEW_STEPS_COLLAPSED);
                expect(rendered).toContain(`⋯ ${12 - PLAN_PREVIEW_STEPS_COLLAPSED} more steps`);
                // In this process the coding-agent keybinding registry never boots
                // (that is the interactive-mode constructor's job) — the renderer
                // must degrade honestly: no hint, no crash. The live pairing
                // (registry set → hint names the key) is pinned by the PTY matrix
                // lane on the real TUI.
                expect(rendered).not.toContain("to expand");
                // The hint format itself is a pure contract — never a hardcoded
                // "ctrl+o": empty key → no hint, resolved key → the chip.
                expect(planExpandHintSuffix("")).toBe("");
                expect(planExpandHintSuffix("ctrl+o")).toBe(" · ctrl+o to expand");
        });

        test("D3: expanded renders the FULL plan markdown", async () => {
                const fake = await wire();
                const { writeResult } = await planSession(fake, PLAN);
                const rendered = renderPlain(fake.tools.get("plan_write"), writeResult, { expanded: true });
                // The Markdown component renders headings as underlined text
                // (no raw ## markers) — assert the rendered form.
                expect(rendered).toContain("Approach");
                expect(rendered).toContain("Risks");
                expect(rendered).toContain("API rate limits under large exports.");
                expect(rendered).toContain("Verification");
                expect(rendered).toContain("1. Add the button component (files: src/button.tsx)");
        });

        test("D4: the approved result renders the headline + step checklist by default", async () => {
                const fake = await wire();
                const { exitResult } = await planSession(fake, PLAN, "Execute — auto-accept edits");
                expect(exitResult.details.outcome).toBe("approved");
                const rendered = renderPlain(fake.tools.get("exit_plan_mode"), exitResult);
                expect(rendered).toContain("User has approved your plan");
                expect(rendered).toContain("Ship the export button");
                // The todo-unification round's echo glyph format (`n. ☐ text`).
                expect(rendered).toMatch(/1\. ☐ Add the button component/);
                expect(rendered).toMatch(/2\. ☐ Wire the click handler/);
                // Expanded shows the full markdown (rendered headings, no raw
                // markers — the Markdown component's form).
                const expanded = renderPlain(fake.tools.get("exit_plan_mode"), exitResult, { expanded: true });
                expect(expanded).toContain("Approach");
                expect(expanded).toContain("Plan: Ship the export button");
        });

        test("D5: the rejected result renders the rejection + the user's feedback", async () => {
                const fake = await wire();
                // Option 4 (keep planning) then non-empty feedback → rejected.
                const cap = makeCaptureCtx(["Keep planning (send feedback)"]);
                await fake.emit("session_start", {}, cap.ctx);
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx);
                await fake.runTool("plan_write", { content: PLAN }, cap.ctx);
                cap.ctx.ui.input = async () => "make step 3 safer";
                const exitResult = await fake.runTool("exit_plan_mode", {}, cap.ctx);
                expect(exitResult.details.outcome).toBe("rejected");
                const rendered = renderPlain(fake.tools.get("exit_plan_mode"), exitResult);
                expect(rendered).toContain("NOT approved");
                expect(rendered).toContain("make step 3 safer");
        });

        test("D6: a stayed turn keeps the single-line render (nothing changed)", async () => {
                const fake = await wire();
                const cap = makeCaptureCtx([undefined]); // dialog dismissed
                await fake.emit("session_start", {}, cap.ctx);
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx);
                await fake.runTool("plan_write", { content: PLAN }, cap.ctx);
                const exitResult = await fake.runTool("exit_plan_mode", {}, cap.ctx);
                expect(exitResult.details).toBeUndefined();
                const rendered = renderPlain(fake.tools.get("exit_plan_mode"), exitResult);
                expect(rendered).toContain("keep planning");
                expect(rendered).not.toContain("☐");
        });

        test("D7: the approval dialog's title carries the plan under the unchanged headline", async () => {
                const fake = await wire();
                const { cap } = await planSession(fake, PLAN_12_STEPS, "Execute — auto-accept edits");
                expect(cap.selects.length).toBeGreaterThanOrEqual(1);
                const { title, options } = cap.selects[0];
                // The headline is the PTY matrix's GATE_TITLE anchor, byte-stable.
                expect(title.startsWith("Plan ready — ")).toBe(true);
                // The plan itself rides the title: objective + first steps + the cap line.
                expect(title).toContain("The long road");
                expect(title).toContain("1. Step number 1");
                expect(title).toContain(`⋯ ${12 - PLAN_DIALOG_PREVIEW_STEPS} more steps`);
                // The options are the keyboard round's stable constants, byte-identical.
                expect(options).toEqual([
                        "Execute — auto-accept edits",
                        "Execute — approve each edit",
                        "Edit the plan",
                        "Keep planning (send feedback)",
                ]);
        });

        test("D8: legacy results without details recover the plan from the text markers", async () => {
                const fake = await wire();
                // A pre-round approved result: full markdown in the text, no details.
                const legacy = {
                        content: [
                                {
                                        type: "text",
                                        text: `User has approved your plan. You can now start coding.\n\nYour plan has been saved to: .unown/plans/x.md\n\n## Approved Plan\n\n# Plan: Ship the export button\n\n## Steps\n\n1. Add the button component\n2. Wire the click handler\n`,
                                },
                        ],
                };
                const rendered = renderPlain(fake.tools.get("exit_plan_mode"), legacy);
                expect(rendered).toContain("approved your plan");
                // The embedded plan is rendered, not truncated to 90 chars.
                expect(rendered).toContain("Wire the click handler");
                // And a stayed-shaped legacy text stays the single line.
                const legacyStayed = {
                        content: [
                                {
                                        type: "text",
                                        text: "The user chose to keep planning without feedback. Stay in plan mode and end your turn now.",
                                },
                        ],
                };
                const stayed = renderPlain(fake.tools.get("exit_plan_mode"), legacyStayed);
                expect(stayed).toContain("keep planning");
                expect(stayed).not.toContain("☐");
        });

        test("D9: the retrospective result renders the closed plan compactly", async () => {
                const doc = parsePlanMarkdown(PLAN);
                const details = {
                        ...planResultDetails("retrospective", doc, scorePlanDoc(doc), ".unown/plans/x.md"),
                };
                const lines = planRetrospectiveLines(details, "Retrospective recorded in .unown/plans/x.md.");
                expect(lines.join("\n")).toContain("Ship the export button");
        });

        test("pure builders: the compact caps and glyph formats are deterministic", () => {
                const doc = parsePlanMarkdown(PLAN_12_STEPS);
                const score = scorePlanDoc(doc);
                expect(score.score).toBeGreaterThanOrEqual(70);
                const written = planWritePreviewLines(planResultDetails("written", doc, score, ".unown/plans/the-long-road.md"));
                expect(written[0]).toBe("Plan: The long road");
                expect(written[1]).toBe(`${score.score}/100 · 12 steps`);
                expect(written.filter((l) => l.startsWith("⋯")).length).toBe(1);
                expect(written[written.length - 1]).toBe(".unown/plans/the-long-road.md");
                const approved = planApprovedLines(
                        planResultDetails("approved", doc, score, "f"),
                        "User has approved your plan.",
                );
                expect(approved[0]).toBe("User has approved your plan.");
                // parsePlanMarkdown lifts the (files: …) annotations onto step.files —
                // the checklist line carries the step text itself, untruncated here.
                expect(approved[2]).toBe("1. ☐ Step number 1 does a distinct unit of work");
                const rejected = planRejectedLines(
                        planResultDetails("rejected", doc, score, "f", { feedback: "narrow the scope" }),
                        "The plan was NOT approved — the user chose to keep planning.",
                );
                expect(rejected.join("\n")).toContain("Feedback: narrow the scope");
                // The dialog title: headline first line, capped steps, cap line, empty-doc honesty.
                const title = planDialogPreviewTitle(doc, score);
                const titleLines = title.split("\n");
                expect(titleLines[0]).toBe(`Plan ready — ${score.summary}`);
                expect(titleLines[1]).toBe("");
                expect(titleLines[2]).toBe("The long road");
                expect(titleLines.filter((l) => /^\d+\. /.test(l)).length).toBe(PLAN_DIALOG_PREVIEW_STEPS);
                expect(title).toContain("Edit the plan shows the full markdown");
                const emptyTitle = planDialogPreviewTitle(EMPTY_PLAN_DOC, scorePlanDoc(EMPTY_PLAN_DOC));
                expect(emptyTitle.split("\n")[2]).toBe("Untitled plan");
        });
});
