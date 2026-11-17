import "./_env.ts"; // MUST be first: the suite's UNOWN_HOME redirect is process-wide and load-bearing
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Calando Q4 — the quiet knobs' precedence seam.
 *
 * env (explicit, set before seeding) > hub pref > default. The boot seam
 * seeds UNSET env vars from the prefs so both reader layers see one
 * runtime source; a live toggle write updates pref + env unless the knob
 * is env-locked. Tests point UNOWN_HOME at a temp dir per case.
 *
 * HYGIENE (the 2026-10-22 incident class): the shared redirect that _env.ts
 * installs is captured at load and RESTORED after every case — deleting
 * UNOWN_HOME here would repoint every later file's per-call resolvers at
 * the developer's real ~/.unown (setup-catalog's write lane learned this
 * the hard way in this round's first full-suite run).
 */

const cases = join(tmpdir(), `quiet-knobs-${process.pid}`);
const prefsPath = join(cases, "agent", "settings-hub.json");

const ENV_VARS = ["UNOWN_FOOTER_CLASSIC", "UNOWN_TURN_METER", "UNOWN_MISSION_PANEL"] as const;

/** Everything this file may touch, snapshotted after _env.ts ran. */
const SAVED_ENV: Record<string, string | undefined> = Object.fromEntries(
        [...ENV_VARS, "UNOWN_HOME"].map((k) => [k, process.env[k]]),
);

function freshHome(prefs: Record<string, unknown> | null): void {
        rmSync(cases, { recursive: true, force: true });
        if (prefs) {
                mkdirSync(join(cases, "agent"), { recursive: true });
                writeFileSync(prefsPath, JSON.stringify(prefs), "utf8");
        }
        process.env.UNOWN_HOME = cases;
}

async function importSeam() {
        const mod = await import("../src/settings/quiet-knobs.ts");
        return mod;
}

afterEach(() => {
        for (const [k, v] of Object.entries(SAVED_ENV)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
        }
        rmSync(cases, { recursive: true, force: true });
});

describe("quiet-knobs — Calando Q4 precedence", () => {
        test("boot seeding: unset env takes the pref's value", async () => {
                freshHome({ footerClassic: true, turnMeter: false, missionPanel: true });
                for (const v of ENV_VARS) delete process.env[v];
                const seam = await importSeam();
                seam.resetQuietKnobSeamForTests();
                seam.seedQuietKnobEnv();
                expect(process.env.UNOWN_FOOTER_CLASSIC).toBe("1");
                expect(process.env.UNOWN_TURN_METER).toBe("0");
                expect(process.env.UNOWN_MISSION_PANEL).toBe("1");
        });

        test("idempotent seeding: a second ensure pass never locks (the live Q4 receipt's bug)", async () => {
                // The boot seam is an ENSURE — it fires again on dashboard boot
                // or reload. The second pass used to see the first pass's OWN
                // seeded env vars as "explicit" and lock every knob: the hub
                // then printed Saved over a write that never landed.
                freshHome({ footerClassic: true });
                for (const v of ENV_VARS) delete process.env[v];
                const seam = await importSeam();
                seam.resetQuietKnobSeamForTests();
                seam.seedQuietKnobEnv();
                seam.seedQuietKnobEnv(); // the ensure seam fires again
                expect(seam.quietKnobEnvLocked("UNOWN_FOOTER_CLASSIC")).toBe(false); // own seeding is not explicit env
                expect(seam.applyQuietKnobPref("UNOWN_FOOTER_CLASSIC", false)).toBe(true); // the write lands
        });

        test("explicit env wins and locks the knob", async () => {
                freshHome({ footerClassic: true });
                process.env.UNOWN_FOOTER_CLASSIC = "0"; // explicit, opposes the pref
                const seam = await importSeam();
                seam.resetQuietKnobSeamForTests();
                seam.seedQuietKnobEnv();
                expect(process.env.UNOWN_FOOTER_CLASSIC).toBe("0"); // untouched
                expect(seam.quietKnobEnvLocked("UNOWN_FOOTER_CLASSIC")).toBe(true);
                expect(seam.applyQuietKnobPref("UNOWN_FOOTER_CLASSIC", true)).toBe(false); // refused
                expect(process.env.UNOWN_FOOTER_CLASSIC).toBe("0"); // still the env's value
        });

        test("live toggle write: pref persists AND env updates (unlocked)", async () => {
                freshHome({});
                for (const v of ENV_VARS) delete process.env[v];
                const seam = await importSeam();
                seam.resetQuietKnobSeamForTests();
                seam.seedQuietKnobEnv();
                expect(seam.applyQuietKnobPref("UNOWN_TURN_METER", false)).toBe(true);
                expect(process.env.UNOWN_TURN_METER).toBe("0");
                expect(seam.quietKnobEffective("UNOWN_TURN_METER")).toBe(false);
                const onDisk = JSON.parse((await import("node:fs")).readFileSync(prefsPath, "utf8"));
                expect(onDisk.turnMeter).toBe(false);
                // and back on
                expect(seam.applyQuietKnobPref("UNOWN_TURN_METER", true)).toBe(true);
                expect(seam.quietKnobEffective("UNOWN_TURN_METER")).toBe(true);
        });

        test("effective readers: footer classic is ===1, the others are !==0", async () => {
                const seam = await importSeam();
                expect(seam.quietKnobEffective("UNOWN_FOOTER_CLASSIC", { UNOWN_FOOTER_CLASSIC: "0" })).toBe(false);
                expect(seam.quietKnobEffective("UNOWN_FOOTER_CLASSIC", {})).toBe(false);
                expect(seam.quietKnobEffective("UNOWN_FOOTER_CLASSIC", { UNOWN_FOOTER_CLASSIC: "1" })).toBe(true);
                expect(seam.quietKnobEffective("UNOWN_TURN_METER", {})).toBe(true);
                expect(seam.quietKnobEffective("UNOWN_TURN_METER", { UNOWN_TURN_METER: "0" })).toBe(false);
                expect(seam.quietKnobEffective("UNOWN_MISSION_PANEL", { UNOWN_MISSION_PANEL: "0" })).toBe(false);
        });
});
