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
import { TEST_TMP } from "./_env.ts";

// Under the shared TEST_TMP (realpath-resolved) like every other suite in
// this directory — NOT a bare tmpdir() sibling. Two reasons, both caught
// by macOS CI (bun's file execution order varies by platform/runner):
// this suite re-points the PROCESS env's UNOWN_HOME at its own tree for the
// duration of its tests, and a later file in the SAME bun process
// (models-catalog.test.ts) loads its module scope inside that window — its
// isolation tripwire compares UNOWN_HOME against TEST_TMP and rightfully
// refuses a foreign tree ("UNOWN_HOME resolved outside the test tree").
// Living under TEST_TMP keeps even the polluted window inside the test
// tree; the afterAll restore below closes the window for every order.
const TEST_ROOT = join(TEST_TMP, `settings-hub-tests-${process.pid}`);
const TEST_HOME = join(TEST_ROOT, "home");
const TEST_PROJECT = join(TEST_ROOT, "project");
const PRIOR_UNOWN_HOME = process.env.UNOWN_HOME;

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
        // Close the env-pollution window: bun runs test files in ONE
        // process, so every file loaded after this suite must see the
        // _env.ts redirect (engine-tests-b), not our tree — restore what
        // this file's import of _env.ts established. Same class as the
        // withKnownModels save/restore pattern in models-catalog.test.ts.
        if (PRIOR_UNOWN_HOME === undefined) delete process.env.UNOWN_HOME;
        else process.env.UNOWN_HOME = PRIOR_UNOWN_HOME;
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("settings registry", () => {
        test("integrity: unique ids, valid sections, well-formed items", async () => {
                const { registryIntegrity, SETTINGS_REGISTRY } = await import("../src/settings/registry.ts");
                const result = registryIntegrity();
                expect(result.ok).toBe(true);
                // The catalog must cover every intent-ordered section
                // (eleven since the Interface repair — S2-1's 32 orphaned
                // pi rows got their home in round 2 M3).
                const sections = new Set(SETTINGS_REGISTRY.map((i) => i.section));
                expect(sections.size).toBe(11);
                // Breadth: the inventory found ~410 entries; the hub catalogs the
                // decisions a user actually makes across all eleven sections.
                expect(SETTINGS_REGISTRY.length).toBeGreaterThanOrEqual(110);
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
        test("status covers all eleven sections with risk badges; search/diff/health/recent render text", async () => {
                const { renderStatus, renderSearch, renderHealth, renderRecent, renderHelp } = await import("../src/settings/render.ts");
                const status = await renderStatus();
                for (const title of ["Agent", "Interface", "Memory", "Learning", "Automation", "Safety", "Models & Cost", "Tools & Integrations", "Observability", "Recovery", "Advanced"]) {
                        expect(status).toContain(title);
                }
                expect(status).toContain("●"); // low badge present
                expect((await renderSearch("kill")).toLowerCase()).toContain("stop");
                expect(await renderHealth(TEST_PROJECT)).toContain("health");
                expect(renderRecent(5)).toContain("No settings changes recorded");
                expect(renderHelp()).toContain("/settings search");
        });
});

// ---------------------------------------------------------------------------
// The Interface section (round 2 M3 — the S2-1 repair)
// ---------------------------------------------------------------------------

describe("the interface section (S2-1: every pi selector row has a settable home)", () => {
        // The vendored pi settings-selector's 35 settings rows (the audit's
        // machine inventory; dialog chrome apply/single-mode excluded), each
        // mapped to the hub item that now owns it. This is the regression
        // gate BM-2's probes measure end-to-end: if a pi row loses its hub
        // home, this table says exactly which one.
        const PI_ROWS_TO_HUB: Array<[piRow: string, hubId: string]> = [
                ["theme", "interface.theme"],
                ["light-theme", "interface.theme-light"],
                ["dark-theme", "interface.theme-dark"],
                ["tui-mode", "interface.tui-mode"],
                ["steering-mode", "interface.steering"],
                ["follow-up-mode", "interface.follow-up"],
                ["transport", "interface.transport"],
                ["http-idle-timeout", "interface.http-idle-timeout"],
                ["hide-thinking", "interface.hide-thinking"],
                ["mermaid-rendering", "interface.mermaid"],
                ["cache-miss-notices", "interface.cache-miss"],
                ["collapse-changelog", "interface.collapse-changelog"],
                ["quiet-startup", "agent.quiet-startup"],
                ["install-telemetry", "interface.install-telemetry"],
                ["default-project-trust", "safety.default-project-trust"],
                ["double-escape-action", "interface.double-escape"],
                ["tree-filter-mode", "interface.tree-filter"],
                ["warnings", "interface.anthropic-extra-usage"],
                ["model-thinking", "interface.thinking-level"],
                ["anthropic-extra-usage", "interface.anthropic-extra-usage"],
                ["fullscreen-exit-output", "interface.fullscreen-exit-output"],
                ["fullscreen-scrollbar", "interface.fullscreen-scrollbar"],
                ["fullscreen-copy-on-select", "interface.copy-on-select"],
                ["show-images", "interface.show-images"],
                ["image-width-cells", "interface.image-width"],
                ["auto-resize-images", "interface.auto-resize-images"],
                ["block-images", "interface.block-images"],
                ["skill-commands", "interface.skill-commands"],
                ["show-hardware-cursor", "interface.hardware-cursor"],
                ["editor-padding", "interface.editor-padding"],
                ["output-padding", "interface.output-padding"],
                ["autocomplete-max-visible", "interface.autocomplete-height"],
                ["clear-on-shrink", "interface.clear-on-shrink"],
                ["terminal-progress", "interface.terminal-progress"],
                ["autocompact", "agent.autocompact"],
        ];

        test("every pi selector row maps to a hub item WITH a setter", async () => {
                const { itemById } = await import("../src/settings/registry.ts");
                for (const [piRow, hubId] of PI_ROWS_TO_HUB) {
                        const item = itemById(hubId);
                        expect(item, `${piRow} → ${hubId} must exist`).toBeDefined();
                        expect(typeof item!.set, `${hubId} must be settable (S2-1: reachable AND changeable)`).toBe("function");
                }
        });

        test("interface round-trips: toggle + select write through the owning manager", async () => {
                const { itemById, resetPiManagerCache } = await import("../src/settings/registry.ts");
                resetPiManagerCache();
                const hide = itemById("interface.hide-thinking")!;
                expect(hide.get!()).toBe(false);
                hide.set!(true);
                expect(hide.get!()).toBe(true);
                const steering = itemById("interface.steering")!;
                expect(steering.get!()).toBe("one-at-a-time");
                steering.set!("all");
                expect(steering.get!()).toBe("all");
                const timeout = itemById("interface.http-idle-timeout")!;
                timeout.set!(60000);
                expect(timeout.get!()).toBe(60000);
        });

        test("theme composite: light/dark items write the 'light/dark' encoding", async () => {
                const { itemById, resetPiManagerCache } = await import("../src/settings/registry.ts");
                resetPiManagerCache();
                const theme = itemById("interface.theme")!;
                theme.set!("dark");
                expect(theme.get!()).toBe("dark");
                const light = itemById("interface.theme-light")!;
                light.set!("papercolor-light");
                // single theme "dark" becomes the dark side; light side is the pick
                expect(light.get!()).toBe("papercolor-light");
                expect(itemById("interface.theme-dark")!.get!()).toBe("dark");
        });

        test("getChoices resolves from the live UI surface; afterSet rides it (the theme lane)", async () => {
                const { itemById, resetPiManagerCache } = await import("../src/settings/registry.ts");
                resetPiManagerCache();
                const theme = itemById("interface.theme")!;
                expect(typeof theme.getChoices).toBe("function");
                const applied: string[] = [];
                const fakeUi = {
                        getAllThemes: () => [{ name: "unown" }, { name: "dark" }, { name: "light" }],
                        setTheme: (name: string) => {
                                applied.push(name);
                                return { success: true };
                        },
                };
                const choices = theme.getChoices!(fakeUi as never);
                expect(choices.map((c) => c.value)).toEqual(["unown", "dark", "light"]);
                // persistence rides set; the live switch rides afterSet
                theme.set!("light");
                expect(applied).toEqual([]); // set alone must NOT live-switch
                theme.afterSet!(fakeUi as never, "light");
                expect(applied).toEqual(["light"]);
        });

        test("health reads the CALL-TIME home (S2-21: repointed UNOWN_HOME is honored)", async () => {
                const { runHealthChecks } = await import("../src/settings/health.ts");
                // A second home with NO models.json — if health read the
                // boot-time dir it would report the first home's provider ok.
                const otherHome = join(TEST_ROOT, "other-home");
                mkdirSync(join(otherHome, "agent"), { recursive: true });
                // seed the FIRST home with a models.json so the two differ
                writeFileSync(
                        join(TEST_HOME, "agent", "models.json"),
                        JSON.stringify({ providers: [{ name: "zai-bridge" }] }),
                );
                process.env.UNOWN_HOME = otherHome;
                const checks = await runHealthChecks(TEST_PROJECT);
                const provider = checks.find((c) => c.id === "health.provider");
                expect(provider?.status).toBe("fail"); // the new home has no models.json
                process.env.UNOWN_HOME = TEST_HOME;
        });

        test("status --verbose appends the capability map (S2-20: the documented flag, now real)", async () => {
                const { renderStatus } = await import("../src/settings/render.ts");
                const plain = await renderStatus();
                expect(plain).not.toContain("capability map");
                const verbose = await renderStatus({ verbose: true });
                expect(verbose).toContain("capability map");
        });
});
