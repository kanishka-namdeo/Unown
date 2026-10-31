/**
 * settings-defaults-drift.test.ts — the phantom-drift pin (the M6 minting
 * work's find, Phase 10 of the Settings Evolution round).
 *
 * The find: the registry's declared `default` fields had drifted from the
 * values a fresh install actually resolves — 8 interface items (tui-mode,
 * mermaid, image-width, editor-padding, clear-on-shrink, terminal-progress,
 * copy-on-select, fullscreen-exit-output), caught because the run-after
 * bm5-diff pane showed 8 phantom drift rows on a home nobody touched. The
 * diff view's promise ("which hub-visible settings differ from their
 * defaults") is only honest if every declared default equals the value the
 * item's getter resolves on an out-of-the-box home.
 *
 * The pin runs in a SUBPROCESS with a pristine UNOWN_HOME: some getters
 * resolve through term.ts's module-scope UNOWN_HOME snapshot (frozen at the
 * first import in this shared bun process — an earlier suite file's home),
 * so an in-process pin would read that home's leftovers, not the fresh
 * install it exists to measure. A fresh process gives every resolver —
 * call-time and snapshot — the same pristine home.
 *
 * Items whose getter cannot resolve in a unit-test home (live-UI-backed
 * getters) are SKIPPED with a count — the same contract the diff view
 * itself uses ("a failing getter never breaks the diff view"); the
 * end-to-end guard for those is BM-8's phantom-drift task in
 * benchmarks/settings-ux (the pane-truth pin: "No settings differ from
 * their defaults." on a fresh home).
 *
 * The negative control proves the pin reads the LIVE manager, not
 * constants: flip settings.json's tuiMode and the tui-mode item's getter
 * must report the flipped value.
 */

import "./_env.ts"; // MUST be first: any store-binding import must land in the suite's redirected DB
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_TMP } from "./_env.ts";

// Under the shared TEST_TMP (realpath-resolved) like every other suite in
// this directory — same isolation rationale as settings-hub.test.ts (the
// env-pollution window across files in one bun process).
const TEST_ROOT = join(TEST_TMP, `settings-defaults-drift-${process.pid}`);
const TEST_HOME = join(TEST_ROOT, "home");
const PRIOR_UNOWN_HOME = process.env.UNOWN_HOME;

const REGISTRY_MODULE = join(
        import.meta.dir,
        "../src/settings/registry.ts",
);

/** The out-of-the-box agent settings.json — term.ts's onboarding write. */
function writeOutOfBoxSettings(): void {
        writeFileSync(
                join(TEST_HOME, "agent", "settings.json"),
                `${JSON.stringify(
                        {
                                defaultProvider: "zai-bridge",
                                defaultModel: "agnes-3.0-flash",
                                theme: "unown",
                                // The split-view layout engine: onboarding deliberately
                                // writes fullscreen (term.ts) — the diff view's baseline
                                // for interface.tui-mode is the OUT-OF-BOX state.
                                tuiMode: "fullscreen",
                        },
                        null,
                        2,
                )}\n`,
                "utf8",
        );
}

beforeEach(() => {
        rmSync(TEST_ROOT, { recursive: true, force: true });
        process.env.UNOWN_HOME = TEST_HOME;
        delete process.env.PI_CLEAR_ON_SHRINK; // clear-on-shrink's env lane must not skew the pin
        mkdirSync(join(TEST_HOME, "agent"), { recursive: true });
        writeOutOfBoxSettings();
});

afterAll(() => {
        rmSync(TEST_ROOT, { recursive: true, force: true });
        // Close the env-pollution window (same class as settings-hub.test.ts).
        if (PRIOR_UNOWN_HOME === undefined) delete process.env.UNOWN_HOME;
        else process.env.UNOWN_HOME = PRIOR_UNOWN_HOME;
});

/** The pin body, executed in a fresh process (see the header for why). */
const PIN_SCRIPT = `
const { SETTINGS_REGISTRY, resetPiManagerCache } = await import(${JSON.stringify(REGISTRY_MODULE)});
resetPiManagerCache();
let checked = 0, skipped = 0;
const failures = [];
for (const item of SETTINGS_REGISTRY) {
        if (item.default === undefined || !item.get) continue;
        let current;
        try { current = await item.get(); } catch { skipped++; continue; }
        if (current === undefined) { skipped++; continue; }
        checked++;
        if (current !== item.default) {
                failures.push(item.id + ": get()=" + JSON.stringify(current) + " but declared default=" + JSON.stringify(item.default));
        }
}
console.log(JSON.stringify({ checked, skipped, failures }));
if (checked < 8 || failures.length > 0) process.exit(1);
`;

describe("settings defaults: the phantom-drift pin", () => {
        test("every declared default equals the value resolved on an out-of-the-box home", () => {
                const env = { ...process.env };
                env.UNOWN_HOME = TEST_HOME;
                delete env.PI_CLEAR_ON_SHRINK;
                const res = spawnSync(process.execPath, ["-e", PIN_SCRIPT], {
                        cwd: TEST_HOME,
                        env,
                        encoding: "utf8",
                        timeout: 60000,
                });
                if (res.status !== 0) {
                        throw new Error(
                                `phantom drift (subprocess exit ${res.status}):\n${res.stdout}\n${res.stderr}`.slice(0, 2000),
                        );
                }
                const verdict = JSON.parse(res.stdout.split("\n").filter(Boolean).pop()!);
                // The pin must have teeth: the interface batch alone is 8+ items.
                expect(verdict.checked).toBeGreaterThanOrEqual(8);
                expect(verdict.failures).toEqual([]);
                console.log(`[phantom-drift pin] checked=${verdict.checked} skipped=${verdict.skipped}`);
        });

        test("the negative control: the pin reads the live manager, not constants", async () => {
                const { SETTINGS_REGISTRY, resetPiManagerCache } = await import("../src/settings/registry.ts");
                const tuiMode = SETTINGS_REGISTRY.find((i) => i.id === "interface.tui-mode");
                expect(tuiMode).toBeDefined();
                resetPiManagerCache();
                expect(await tuiMode!.get()).toBe("fullscreen"); // the out-of-the-box write
                writeFileSync(
                        join(TEST_HOME, "agent", "settings.json"),
                        `${JSON.stringify({ tuiMode: "regular" }, null, 2)}\n`,
                        "utf8",
                );
                resetPiManagerCache();
                expect(await tuiMode!.get()).toBe("regular"); // the manager re-read settings.json
                expect(tuiMode!.default).toBe("fullscreen"); // the declared default is untouched
        });
});
