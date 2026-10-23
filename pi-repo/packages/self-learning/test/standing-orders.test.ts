// Unit tests for src/standing-orders.ts + src/promote-cli.ts (M7): the
// OpenClaw standing-orders convention (parse → merge → digest → prompt
// injection) and the /promote pipeline's pure layers (distill prompt,
// draft parse, store append, schedule argv).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        parseStandingOrders,
        loadStandingOrders,
        standingOrdersPaths,
        renderOrdersDigest,
        appendStandingOrders,
        buildPromoteDistillPrompt,
        parseProgramDraft,
        renderProgramSection,
        appendOrderToStore,
        orderSlug,
        EXECUTE_VERIFY_REPORT,
        plainWordsSchedule,
        type StandingOrder,
} from "../src/standing-orders.ts";
import { promoteDraft, promoteShow, promoteSave, promoteDraftPath, runPromoteCommand } from "../src/promote-cli.ts";
import { buildAutomationPrompt, type AutomationRow } from "../src/automations.ts";

const SAMPLE = `# Standing orders

## Program: Nightly dependency report
**Authority:** Read package manifests, run the update check, write a summary note.
**Trigger:** Every weekday at 09:00 (enforced by the routine's schedule).
**Approval gate:** None for reports. Applying an update requires confirmation.
**Escalation:** If the update check fails twice, stop and leave a note.

### Execution steps
1. Read package.json + lockfile.
2. Run the update check.

### What NOT to do
- Do not apply updates without confirmation.
- Do not commit anything.

## Program: Weekly status report
**Authority:** Compile data, generate report, deliver to stakeholders.
**Trigger:** Every Friday at 16:00.
**Approval gate:** None for standard reports. Flag anomalies for human review.
**Escalation:** If metrics look unusual, escalate immediately.

### Execution steps
1. Pull metrics.

### What NOT to do
- Do not send reports to external parties.

## Program: Broken order
**Trigger:** Every day at noon.
`;

const automationRow = (over: Partial<AutomationRow> = {}): AutomationRow =>
        ({
                id: "auto-test",
                title: "Test routine",
                prompt: "Do the thing.",
                workspace: "/tmp/w",
                mode: "read-only",
        }) as unknown as AutomationRow;

describe("parseStandingOrders (pure)", () => {
        test("parses programs with all fields, steps, NOT-do lists; skips invalid with warnings", () => {
                const { orders, warnings } = parseStandingOrders(SAMPLE, "project");
                expect(orders).toHaveLength(2);
                expect(orders[0].id).toBe("nightly-dependency-report");
                expect(orders[0].authority).toContain("Read package manifests");
                expect(orders[0].trigger).toContain("09:00");
                expect(orders[0].approvalGate).toContain("Applying an update requires confirmation");
                expect(orders[0].escalation).toContain("fails twice");
                expect(orders[0].executionSteps).toEqual(["Read package.json + lockfile.", "Run the update check."]);
                expect(orders[0].notToDo).toEqual(["Do not apply updates without confirmation.", "Do not commit anything."]);
                // The broken one (no Authority) is skipped with a warning.
                expect(warnings.some((w) => w.includes("Broken order") && w.includes("Authority"))).toBe(true);
        });
        test("missing gate/escalation are warnings, never fatal", () => {
                const md = `## Program: Minimal order\n**Authority:** Do A.\n**Trigger:** Daily.\n`;
                const { orders, warnings } = parseStandingOrders(md, "global");
                expect(orders).toHaveLength(1);
                expect(warnings.some((w) => w.includes("no Approval gate"))).toBe(true);
                expect(warnings.some((w) => w.includes("no Escalation"))).toBe(true);
        });
        test("empty and garbage input yield empty orders", () => {
                expect(parseStandingOrders("", "project").orders).toEqual([]);
                expect(parseStandingOrders("# Other doc\n\nNo programs here.", "project").orders).toEqual([]);
        });
        test("orderSlug is stable and filesystem-safe", () => {
                expect(orderSlug("Nightly dependency report!")).toBe("nightly-dependency-report");
                expect(orderSlug("  --Weird--  ")).toBe("weird");
                expect(orderSlug("Ünïcode ïnput")).toBe("n-code-nput");
        });
});

describe("loadStandingOrders (merge)", () => {
        let home: string;
        let project: string;
        beforeEach(() => {
                home = mkdtempSync(join(tmpdir(), "unown-so-home-"));
                project = mkdtempSync(join(tmpdir(), "unown-so-proj-"));
        });
        afterEach(() => {
                rmSync(home, { recursive: true, force: true });
                rmSync(project, { recursive: true, force: true });
        });
        test("project overrides global per program id; both layers load; missing files fine", () => {
                mkdirSync(join(home, "agent"), { recursive: true });
                writeFileSync(join(home, "agent", "standing-orders.md"), SAMPLE);
                mkdirSync(join(project, ".unown"), { recursive: true });
                writeFileSync(
                        join(project, ".unown", "standing-orders.md"),
                        `## Program: Nightly dependency report\n**Authority:** PROJECT-scoped authority.\n**Trigger:** Different trigger.\n\n### What NOT to do\n- Project boundary.\n`,
                );
                const loaded = loadStandingOrders(project, { unownHome: home });
                // 2 unique ids: nightly (project's version wins) + weekly (global only).
                expect(loaded.orders).toHaveLength(2);
                const nightly = loaded.orders.find((o) => o.id === "nightly-dependency-report")!;
                expect(nightly.source).toBe("project");
                expect(nightly.authority).toBe("PROJECT-scoped authority.");
                expect(loaded.orders.some((o) => o.id === "weekly-status-report" && o.source === "global")).toBe(true);
                // Empty-tree case: no files anywhere → zero orders, no warnings.
                const empty = loadStandingOrders(mkdtempSync(join(tmpdir(), "unown-so-empty-")), { unownHome: mkdtempSync(join(tmpdir(), "unown-so-empty2-")) });
                expect(empty.orders).toEqual([]);
                expect(empty.warnings).toEqual([]);
        });
        test("paths resolve to the documented locations", () => {
                const p = standingOrdersPaths("/w", "/home/x/.unown");
                expect(p.global).toBe(join("/home/x/.unown", "agent", "standing-orders.md"));
                expect(p.project).toBe(join("/w", ".unown", "standing-orders.md"));
        });
});

describe("renderOrdersDigest + prompt injection (pure)", () => {
        const orders = parseStandingOrders(SAMPLE, "project").orders;
        test("digest carries the governing fields + the Execute-Verify-Report loop", () => {
                const digest = renderOrdersDigest(orders);
                expect(digest).toContain("### Nightly dependency report (project)");
                expect(digest).toContain("Authority: Read package manifests");
                expect(digest).toContain("Approval gate: None for reports");
                expect(digest).toContain("What NOT to do: Do not apply updates without confirmation");
                expect(digest).toContain("EXECUTE the work");
                expect(digest).toContain("3 attempts maximum");
                expect(EXECUTE_VERIFY_REPORT).toContain("VERIFY the result");
        });
        test("budgets: per-order truncation notice; total budget omits the rest visibly", () => {
                const one = renderOrdersDigest(orders, 100, 10_000);
                expect(one).toContain("truncated — read the full order");
                const total = renderOrdersDigest(orders, 2_000, 300);
                expect(total).toContain("digest budget was reached");
        });
        test("appendStandingOrders: the rider frames authority, empty digest is a no-op", () => {
                const withOrders = appendStandingOrders("Task: X", renderOrdersDigest(orders));
                expect(withOrders.startsWith("Task: X")).toBe(true);
                expect(withOrders).toContain("Standing orders for this workspace");
                expect(withOrders).toContain("execute per standing orders");
                expect(appendStandingOrders("Task: X", "")).toBe("Task: X");
        });
        test("buildAutomationPrompt composes standing orders + event payload in order", () => {
                const prompt = buildAutomationPrompt(automationRow(), {
                        standingOrdersDigest: renderOrdersDigest(orders),
                        eventPayload: '{"a":1}',
                });
                const taskIdx = prompt.indexOf("Task:");
                const ordersIdx = prompt.indexOf("Standing orders for this workspace");
                const payloadIdx = prompt.indexOf("Inbound event payload");
                expect(ordersIdx).toBeGreaterThan(taskIdx);
                expect(payloadIdx).toBeGreaterThan(ordersIdx);
                expect(prompt).toContain('"a":1');
                // Back-compat: no ctx fields → the exact pre-M7 prompt.
                const plain = buildAutomationPrompt(automationRow());
                expect(plain).not.toContain("Standing orders");
        });
});

describe("the /promote pipeline (pure layers)", () => {
        test("buildPromoteDistillPrompt embeds the session source + focus + the template", () => {
                const p = buildPromoteDistillPrompt("USER: do the thing\nASSISTANT: did it", "the nightly check");
                expect(p).toContain("=== SESSION (newest last) ===");
                expect(p).toContain("USER: do the thing");
                expect(p).toContain("Focus the draft on: the nightly check");
                expect(p).toContain("## Program: <short title>");
                expect(p).toContain("What NOT to do");
        });
        test("parseProgramDraft: valid draft → order; issues for missing boundaries; garbage → null", () => {
                const good = `## Program: Daily sweep\n**Authority:** Sweep the logs.\n**Trigger:** Daily at 08:00.\n**Approval gate:** None.\n**Escalation:** Stop after 3 tries.\n\n### What NOT to do\n- Do not delete logs.`;
                const parsed = parseProgramDraft(good);
                expect(parsed.order).not.toBeNull();
                expect(parsed.order!.id).toBe("daily-sweep");
                expect(parsed.order!.notToDo).toEqual(["Do not delete logs."]);
                expect(parsed.issues).toEqual([]);
                // No NOT-do items → issue (boundaries required).
                const boundaryless = `## Program: X\n**Authority:** A.\n**Trigger:** T.\n`;
                expect(parseProgramDraft(boundaryless).issues.some((i) => i.includes("What NOT to do"))).toBe(true);
                // Garbage → null + actionable issue.
                expect(parseProgramDraft("I cannot do that.").order).toBeNull();
        });
        test("renderProgramSection round-trips through the parser (defaults made explicit)", () => {
                const draft = `## Program: Daily sweep\n**Authority:** Sweep the logs.\n**Trigger:** Daily at 08:00.\n\n### Execution steps\n1. Look.\n\n### What NOT to do\n- Do not delete.`;
                const { order } = parseProgramDraft(draft);
                const section = renderProgramSection(order!);
                const reparsed = parseStandingOrders(section, "project");
                expect(reparsed.orders).toHaveLength(1);
                expect(reparsed.orders[0].authority).toBe("Sweep the logs.");
                expect(reparsed.orders[0].approvalGate).toContain("risky");
                expect(reparsed.orders[0].escalation).toContain("3 attempts");
                expect(reparsed.orders[0].executionSteps).toEqual(["Look."]);
        });
        test("appendOrderToStore: creates the file with a header; appends atomically; injectable fs", () => {
                let written: Record<string, string> = {};
                const files: Record<string, string> = {};
                const read = (p: string) => files[p] ?? null;
                const write = (p: string, c: string) => {
                        files[p] = c;
                        written[p] = c;
                };
                const r1 = appendOrderToStore("/w/.unown/standing-orders.md", "## Program: A\n**Authority:** x.\n**Trigger:** y.", { read, write });
                expect(r1.ok).toBe(true);
                expect(files["/w/.unown/standing-orders.md"]).toContain("# Standing orders");
                const r2 = appendOrderToStore("/w/.unown/standing-orders.md", "## Program: B\n**Authority:** z.\n**Trigger:** w.", { read, write });
                expect(r2.ok).toBe(true);
                const parsed = parseStandingOrders(files["/w/.unown/standing-orders.md"], "project");
                expect(parsed.orders.map((o) => o.id)).toEqual(["a", "b"]);
        });
        test("plainWordsSchedule confirms the SENTENCE, not the cron", () => {
                const s = plainWordsSchedule({ cadence: "weekday at 09:00", action: "summarize overnight updates", delivery: "post them here" });
                expect(s).toContain("Every weekday at 09:00, I will summarize overnight updates, and post them here.");
                expect(s).toContain("confirm");
        });
});

describe("runPromoteCommand routing (hermetic deps)", () => {
        let dir: string;
        beforeEach(() => {
                dir = mkdtempSync(join(tmpdir(), "unown-promote-"));
        });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));

        const goodDraft = `## Program: Daily sweep\n**Authority:** Sweep the logs.\n**Trigger:** Daily at 08:00.\n**Approval gate:** None.\n**Escalation:** Stop after 3 tries.\n\n### What NOT to do\n- Do not delete logs.`;

        test("draft flow: distills via the injected chat, parks the draft, prints next steps", async () => {
                const files: Record<string, string> = {};
                const deps = {
                        cwd: dir,
                        chat: async () => goodDraft,
                        entries: [
                                { message: { role: "user", content: "please sweep the logs every morning before standup and post the summary to the channel" } },
                                { message: { role: "assistant", content: "swept the logs once and posted the summary as requested" } },
                        ],
                        readFile: (p: string) => files[p] ?? null,
                        writeFile: (p: string, c: string) => {
                                files[p] = c;
                        },
                };
                const r = await runPromoteCommand("", deps);
                expect(r.level).toBe("info");
                expect(files[promoteDraftPath(dir)]).toBe(goodDraft);
                expect(r.message).toContain("/promote save");
        });
        test("thin session → nothing-to-promote; no draft written", async () => {
                const files: Record<string, string> = {};
                const deps = { cwd: dir, chat: async () => goodDraft, entries: [], readFile: (p: string) => files[p] ?? null, writeFile: (p: string, c: string) => (files[p] = c) };
                const r = await runPromoteCommand("", deps);
                expect(r.message).toContain("Nothing to promote");
                expect(files[promoteDraftPath(dir)]).toBeUndefined();
        });
        test("unparsable model output parks the raw text for hand-editing", async () => {
                const files: Record<string, string> = {};
                const deps = { cwd: dir, chat: async () => "no markdown here", entries: [{ message: { role: "user", content: "x".repeat(100) } }], readFile: (p: string) => files[p] ?? null, writeFile: (p: string, c: string) => (files[p] = c) };
                const r = await runPromoteCommand("", deps);
                expect(r.level).toBe("warning");
                expect(files[promoteDraftPath(dir)]).toBe("no markdown here");
        });
        test("save: appends to the PROJECT store by default; the dup note only fires for a genuine duplicate", async () => {
                const home = mkdtempSync(join(tmpdir(), "unown-promote-home-"));
                try {
                        const files: Record<string, string> = {};
                        files[promoteDraftPath(dir)] = goodDraft;
                        const deps = { cwd: dir, chat: async () => "", entries: [], readFile: (p: string) => files[p] ?? null, writeFile: (p: string, c: string) => (files[p] = c) };
                        const r = await promoteSave(deps as any, "project");
                        expect(r.level).toBe("info");
                        expect(files[join(dir, ".unown", "standing-orders.md")]).toContain("## Program: Daily sweep");
                        expect(files[join(home, "agent", "standing-orders.md")]).toBeUndefined();
                        // First save on a fresh store: NO self-duplicate note (the
                        // M7 E2E bug — the check used to run after its own append).
                        expect(r.message).not.toContain("already existed");
                        // Saving the SAME draft again (same id, different raw) → dup note.
                        // Same program id, EDITED authority — the genuine-duplicate shape.
                        files[promoteDraftPath(dir)] = goodDraft.replace("Sweep the logs.", "Sweep the logs twice.");
                        const again = await promoteSave(deps as any, "project");
                        expect(again.message).toContain("already existed");
                } finally {
                        rmSync(home, { recursive: true, force: true });
                }
        });
        test("show: reprints the parked draft; none parked → hint", () => {
                const deps = { cwd: dir, chat: async () => "", entries: [], readFile: () => null, writeFile: () => {} };
                expect(promoteShow(deps as any).message).toContain("No parked draft");
        });
});
