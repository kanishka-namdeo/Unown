/**
 * settings-hub.test.ts — the Settings Evolution round's unit suite.
 *
 * Covers: registry integrity + catalog breadth, hub prefs (parse/seed/
 * never-clobber), the change ledger (record/recent/revert/cap), search
 * scoring + rendering, health checks, diff-vs-defaults, transfer
 * (export/import/backups/scoped reset), the staged-skills inbox, and the
 * pending-dream lane (park/list/diff). The TUI flows and the vendored
 * override patch are covered by the PTY lane
 * (scripts/tui-capture/verify_settings_hub.py).
 */

import "./_env.ts"; // MUST be first: any store-binding import must land in the suite's redirected DB
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_ROOT = join(tmpdir(), `settings-hub-tests-${process.pid}`);
const TEST_HOME = join(TEST_ROOT, "home");
const TEST_PROJECT = join(TEST_ROOT, "project");

function freshEnv(): void {
        process.env.UNOWN_HOME = TEST_HOME;
        mkdirSync(join(TEST_HOME, "agent"), { recursive: true });
        mkdirSync(TEST_PROJECT, { recursive: true });
}

beforeEach(() => {
        rmSync(TEST_ROOT, { recursive: true, force: true });
        freshEnv();
});

afterAll(() => {
        rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("settings registry", () => {
        test("integrity: unique ids, valid sections, well-formed items", async () => {
                const { registryIntegrity, SETTINGS_REGISTRY } = await import("../src/settings/registry.ts");
                const result = registryIntegrity();
                expect(result.ok).toBe(true);
                // The catalog must cover every intent-ordered section.
                const sections = new Set(SETTINGS_REGISTRY.map((i) => i.section));
                expect(sections.size).toBe(10);
                // Breadth: the inventory found ~410 entries; the hub catalogs the
                // decisions a user actually makes across all ten sections.
                expect(SETTINGS_REGISTRY.length).toBeGreaterThanOrEqual(80);
        });

        test("the six mission questions each have a home", async () => {
                const { SETTINGS_REGISTRY } = await import("../src/settings/registry.ts");
                const ids = new Set(SETTINGS_REGISTRY.map((i) => i.id));
                // What can it do / allowed / remember / learned / auto-change / recover.
                expect(ids.has("agent.capabilities")).toBe(true);
                expect(ids.has("safety.envelope")).toBe(true);
                expect(ids.has("memory.stack")).toBe(true);
                expect(ids.has("learning.feed")).toBe(true);
                expect(ids.has("automation.list")).toBe(true);
                expect(ids.has("rec.undo")).toBe(true);
        });

        test("every high-risk item documents its persistence + risk honestly", async () => {
                const { SETTINGS_REGISTRY } = await import("../src/settings/registry.ts");
                const high = SETTINGS_REGISTRY.filter((i) => i.risk === "high");
                expect(high.length).toBeGreaterThanOrEqual(10);
                for (const item of high) {
                        expect(item.help.length).toBeGreaterThan(20);
                }
        });

        test("items with setters also declare where they persist", async () => {
                const { SETTINGS_REGISTRY } = await import("../src/settings/registry.ts");
                for (const item of SETTINGS_REGISTRY) {
                        if (item.set) expect(item.persistedIn).toBeTruthy();
                }
        });
});

// ---------------------------------------------------------------------------
// Hub prefs
// ---------------------------------------------------------------------------

describe("hub prefs (settings-hub.json)", () => {
        test("defaults when absent; malformed degrades, never crashes", async () => {
                const { loadHubPrefs, parseHubPrefs } = await import("../src/settings/prefs.ts");
                const { DEFAULT_HUB_PREFS } = await import("../src/settings/types.ts");
                expect(loadHubPrefs()).toEqual(DEFAULT_HUB_PREFS);
                expect(parseHubPrefs({ garbage: true })).toEqual(DEFAULT_HUB_PREFS);
                expect(parseHubPrefs("not-an-object")).toEqual(DEFAULT_HUB_PREFS);
        });

        test("clamping: goal budget 0..10000, hook depth 1..10, history cap 50..5000", async () => {
                const { parseHubPrefs } = await import("../src/settings/prefs.ts");
                const prefs = parseHubPrefs({ goalBudgetTurns: 999999, hookMaxDepth: 0, historyCap: 1 });
                expect(prefs.goalBudgetTurns).toBe(10000);
                expect(prefs.hookMaxDepth).toBe(1);
                expect(prefs.historyCap).toBe(50);
        });

        test("seed never clobbers user edits", async () => {
                const { seedHubPrefs, loadHubPrefs, saveHubPrefs, hubPrefsPath } = await import("../src/settings/prefs.ts");
                saveHubPrefs({ learningReviewMode: true, goalBudgetTurns: 40, hookMaxDepth: 2, showAdvanced: true, historyCap: 100 });
                seedHubPrefs();
                expect(loadHubPrefs().learningReviewMode).toBe(true);
                expect(loadHubPrefs().goalBudgetTurns).toBe(40);
                expect(hubPrefsPath()).toContain("settings-hub.json");
        });
});

// ---------------------------------------------------------------------------
// Change ledger
// ---------------------------------------------------------------------------

describe("the change ledger (settings-history.jsonl)", () => {
        test("record → recent (newest first) → revert through the item setter", async () => {
                const { recordChange, recentChanges, revertChange, readLedger } = await import("../src/settings/history.ts");
                const first = recordChange({
                        actor: "user",
                        itemId: "agent.goal-budget",
                        itemName: "Goal budget (turns)",
                        section: "agent",
                        before: 0,
                        after: 40,
                        via: "test",
                });
                recordChange({
                        actor: "user",
                        itemId: "tools.hook-depth",
                        itemName: "Hook loop breaker (max depth)",
                        section: "tools",
                        before: 3,
                        after: 5,
                        via: "test",
                });
                const recent = recentChanges(10);
                expect(recent.length).toBe(2);
                expect(recent[0].itemId).toBe("tools.hook-depth"); // newest first
                expect(readLedger().length).toBe(2);

                let setCalls: unknown[] = [];
                const result = await revertChange(first.id, () => ({
                        set: (value) => {
                                setCalls.push(value);
                        },
                        get: () => 40,
                }));
                expect(result.ok).toBe(true);
                expect(setCalls).toEqual([0]);
                // The revert itself is recorded.
                expect(readLedger().length).toBe(3);
                expect(recentChanges(1)[0].actor).toBe("revert");
        });

        test("revert of an unknown entry fails honestly", async () => {
                const { revertChange } = await import("../src/settings/history.ts");
                const result = await revertChange("nope", () => undefined);
                expect(result.ok).toBe(false);
        });

        test("malformed ledger lines are skipped, never crash", async () => {
                const { historyPath, readLedger } = await import("../src/settings/history.ts");
                writeFileSync(historyPath(), "not json\n{broken\n\n", "utf8");
                expect(readLedger()).toEqual([]);
        });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe("settings search", () => {
        test("finds by name, section purpose, env var and tags; ranks exact > prefix > scattered", async () => {
                const { searchSettings } = await import("../src/settings/search.ts");
                const byName = searchSettings("kill switch");
                expect(byName.length).toBeGreaterThan(0);
                expect(byName[0].item.id).toBe("automation.stop");
                const byPurpose = searchSettings("unattended");
                expect(byPurpose.some((h) => h.item.section === "automation")).toBe(true);
                const byEnv = searchSettings("UNOWN_STRICT_HOOKS");
                expect(byEnv.some((h) => h.item.env === "UNOWN_STRICT_HOOKS")).toBe(true);
                const exact = searchSettings("stop")[0].score;
                const scattered = searchSettings("stxoep")[0]?.score ?? 0;
                expect(exact).toBeGreaterThan(scattered);
        });

        test("empty query returns nothing; results are capped", async () => {
                const { searchSettings } = await import("../src/settings/search.ts");
                expect(searchSettings("")).toEqual([]);
                expect(searchSettings("e", 3).length).toBeLessThanOrEqual(3);
        });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe("health checks", () => {
        test("fails hard on trust bypass; recommends fixable warns", async () => {
                const { runHealthChecks, recommendedItems } = await import("../src/settings/health.ts");
                process.env.UNOWN_TRUST_PROJECT_CONFIG = "1";
                try {
                        const checks = await runHealthChecks(TEST_PROJECT);
                        const bypass = checks.find((c) => c.id === "health.trust-bypass");
                        expect(bypass?.status).toBe("fail");
                        expect(bypass?.fixItemId).toBe("safety.trust-bypass");
                        const recommended = await recommendedItems(TEST_PROJECT);
                        expect(recommended.some((c) => c.fixItemId)).toBe(true);
                } finally {
                        delete process.env.UNOWN_TRUST_PROJECT_CONFIG;
                }
        });

        test("defense-stack disables surface as warns with fix links", async () => {
                const { runHealthChecks } = await import("../src/settings/health.ts");
                const saved = process.env.PI_DREAM_GATE;
                process.env.PI_DREAM_GATE = "0";
                try {
                        const checks = await runHealthChecks(TEST_PROJECT);
                        const gate = checks.find((c) => c.id === "health.dream-gate");
                        expect(gate?.status).toBe("warn");
                        expect(gate?.fixItemId).toBe("learning.dream-gate");
                } finally {
                        if (saved === undefined) delete process.env.PI_DREAM_GATE;
                        else process.env.PI_DREAM_GATE = saved;
                }
        });
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

describe("diff vs defaults", () => {
        test("a drifted hub pref shows as a diff row and resets through the setter", async () => {
                const { diffAgainstDefaults, resetItemToDefault } = await import("../src/settings/diff.ts");
                const { saveHubPrefs, loadHubPrefs } = await import("../src/settings/prefs.ts");
                const prefs = loadHubPrefs();
                prefs.goalBudgetTurns = 40;
                saveHubPrefs(prefs);
                let rows = await diffAgainstDefaults();
                expect(rows.some((r) => r.itemId === "agent.goal-budget")).toBe(true);
                const result = await resetItemToDefault("agent.goal-budget");
                expect(result.ok).toBe(true);
                rows = await diffAgainstDefaults();
                expect(rows.some((r) => r.itemId === "agent.goal-budget")).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

describe("transfer: export / import / backups / reset", () => {
        test("export bundle has schema 1 and never contains secrets", async () => {
                const { buildExportBundle } = await import("../src/settings/transfer.ts");
                const bundle = buildExportBundle("0.0.49-test");
                expect(bundle.schema).toBe(1);
                expect(bundle.kind).toBe("export");
                expect(bundle.unownVersion).toBe("0.0.49-test");
                const serialized = JSON.stringify(bundle);
                expect(serialized).not.toContain("apiKey");
                expect(serialized).not.toContain("BRIDGE_UPSTREAM_KEY");
        });

        test("import validates schema, backs up, merges — and refuses garbage", async () => {
                const { importSettings, exportSettings, listBackups } = await import("../src/settings/transfer.ts");
                const { loadHubPrefs, saveHubPrefs } = await import("../src/settings/prefs.ts");
                // Drift current state so the import has something to change.
                const prefs = loadHubPrefs();
                prefs.goalBudgetTurns = 7;
                saveHubPrefs(prefs);
                const path = join(TEST_ROOT, "bundle.json");
                exportSettings(path, "0.0.49-test");
                // Tamper the bundle to a different value, then import.
                const raw = JSON.parse(await Bun.file(path).text());
                raw.hubPrefs.goalBudgetTurns = 55;
                writeFileSync(path, JSON.stringify(raw), "utf8");
                const result = importSettings(path, "test");
                expect(result.ok).toBe(true);
                expect(result.applied).toContain("hub preferences");
                expect(loadHubPrefs().goalBudgetTurns).toBe(55);
                expect(listBackups().length).toBe(1); // the pre-import backup

                const badPath = join(TEST_ROOT, "bad.json");
                writeFileSync(badPath, JSON.stringify({ schema: 999, kind: "export", createdAt: 1 }), "utf8");
                const bad = importSettings(badPath, "test");
                expect(bad.ok).toBe(false);
                expect(bad.error).toContain("schema");
        });

        test("scoped reset: hub only — addons/pi survive; backup written", async () => {
                const { resetSettings, listBackups } = await import("../src/settings/transfer.ts");
                const { loadHubPrefs } = await import("../src/settings/prefs.ts");
                const { loadAddonsConfig, saveAddonsConfig } = await import("../src/addons/config.ts");
                const addons = loadAddonsConfig();
                addons.todo.maxWidgetLines = 33;
                saveAddonsConfig(addons);
                const result = resetSettings("hub", "test");
                expect(result.ok).toBe(true);
                expect(loadHubPrefs().goalBudgetTurns).toBe(0);
                expect(loadAddonsConfig().todo.maxWidgetLines).toBe(33); // untouched
                expect(listBackups().length).toBeGreaterThanOrEqual(1);
        });

        test("backups keep only the last 5", async () => {
                const { writeBackup, listBackups } = await import("../src/settings/transfer.ts");
                for (let i = 0; i < 8; i++) writeBackup("reset");
                expect(listBackups().length).toBe(5);
        });
});

// ---------------------------------------------------------------------------
// Staged skills inbox
// ---------------------------------------------------------------------------

describe("staged-skills inbox (SA-B2 minus the raw mv)", () => {
        test("list / promote / discard against a staged dir", async () => {
                const { listStagedSkills, promoteStagedSkill, discardStagedSkill } = await import("../src/settings/registry.ts");
                const stagedDir = join(TEST_PROJECT, ".unown", "skills-staged", "demo-skill");
                mkdirSync(stagedDir, { recursive: true });
                writeFileSync(join(stagedDir, "SKILL.md"), "---\nname: demo-skill\n---\nBody\n", "utf8");
                expect(listStagedSkills(TEST_PROJECT).map((s) => s.name)).toEqual(["demo-skill"]);

                const promoted = promoteStagedSkill(TEST_PROJECT, "demo-skill");
                expect(promoted.ok).toBe(true);
                expect(listStagedSkills(TEST_PROJECT)).toEqual([]);
                const { existsSync } = await import("node:fs");
                expect(existsSync(join(TEST_PROJECT, ".unown", "skills", "demo-skill", "SKILL.md"))).toBe(true);

                // Promote refuses to overwrite an existing shipped skill.
                const stagedAgain = join(TEST_PROJECT, ".unown", "skills-staged", "demo-skill");
                mkdirSync(stagedAgain, { recursive: true });
                writeFileSync(join(stagedAgain, "SKILL.md"), "again", "utf8");
                expect(promoteStagedSkill(TEST_PROJECT, "demo-skill").ok).toBe(false);
                expect(discardStagedSkill(TEST_PROJECT, "demo-skill").ok).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// Pending dreams (the review lane's data model)
// ---------------------------------------------------------------------------

describe("pending dreams (dream-review.ts)", () => {
        test("park → list → hasPending → diff → remove", async () => {
                const { parkPendingDream, listPendingDreams, hasPendingDream, removePendingDream, renderPendingDiff } =
                        await import("../src/dream-review.ts");
                expect(hasPendingDream(TEST_PROJECT)).toBe(false);
                parkPendingDream({
                        id: "dream-1",
                        slug: "demo",
                        projectPath: TEST_PROJECT,
                        createdAt: Date.now(),
                        notesIn: 3,
                        toWrite: "# Tier 1 — Project Memory\n\n- New learned rule\n",
                        current: "# Tier 1 — Project Memory\n",
                        events: [{ kind: "ADD", id: "m1", text: "New learned rule" }],
                        summary: "added 1",
                        note: "test dream",
                });
                expect(hasPendingDream(TEST_PROJECT)).toBe(true);
                const pending = listPendingDreams(TEST_PROJECT);
                expect(pending.length).toBe(1);
                expect(pending[0].events.length).toBe(1);

                const diff = renderPendingDiff(pending[0]);
                expect(diff).toContain("+ - New learned rule");

                removePendingDream(TEST_PROJECT, "dream-1");
                expect(hasPendingDream(TEST_PROJECT)).toBe(false);
        });

        test("malformed pending files are skipped", async () => {
                const { parkPendingDream, listPendingDreams } = await import("../src/dream-review.ts");
                const dir = join(TEST_PROJECT, ".unown", "memory", "pending-dreams");
                parkPendingDream({
                        id: "good",
                        slug: "s",
                        projectPath: TEST_PROJECT,
                        createdAt: 1,
                        notesIn: 1,
                        toWrite: "x",
                        current: "y",
                        events: [],
                        summary: "",
                        note: "",
                });
                writeFileSync(join(dir, "junk.json"), "{broken", "utf8");
                const list = listPendingDreams(TEST_PROJECT);
                expect(list.length).toBe(1);
                expect(list[0].id).toBe("good");
        });
});

// ---------------------------------------------------------------------------
// Headless renders
// ---------------------------------------------------------------------------

describe("headless renders (print/RPC parity)", () => {
        test("status covers all ten sections with risk badges; search/diff/health/recent render text", async () => {
                const { renderStatus, renderSearch, renderHealth, renderRecent, renderHelp } = await import("../src/settings/render.ts");
                const status = await renderStatus();
                for (const title of ["Agent", "Memory", "Learning", "Automation", "Safety", "Models & Cost", "Tools & Integrations", "Observability", "Recovery", "Advanced"]) {
                        expect(status).toContain(title);
                }
                expect(status).toContain("●"); // low badge present
                expect((await renderSearch("kill")).toLowerCase()).toContain("stop");
                expect(await renderHealth(TEST_PROJECT)).toContain("health");
                expect(renderRecent(5)).toContain("No settings changes recorded");
                expect(renderHelp()).toContain("/settings search");
        });
});
