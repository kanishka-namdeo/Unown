/**
 * semplice-round.test.ts — the Semplice round's unit pins (v0.0.70).
 *
 * The round's mission: make the TUI less overwhelming for a first-time
 * user, study-backed (docs/tui-overwhelm-research.md). These pins hold the
 * CP1 surfaces in place:
 *
 *   W3  the fresh-install settings seed carries quietStartup:true (the boot
 *       pane opens on the editor, not the resource listing) — and the seed
 *       never clobbers an existing settings.json (the user's choice wins).
 *       Pinned in a SUBPROCESS with a pristine UNOWN_HOME (term.ts snapshots
 *       the home at first import — same rationale as
 *       settings-defaults-drift.test.ts).
 *   W3  the splash gate no longer knows about quietStartup: the quiet seed
 *       must not kill the brand moment (the wordmark is also the capture
 *       lane's readiness anchor).
 *   W15 the confidence chip reads in plain words, not private shorthand.
 */
import "./_env.ts"; // MUST be first: store-binding imports land in the redirected DB
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { TEST_TMP } from "./_env.ts";

const ROOT = join(TEST_TMP, `semplice-${process.pid}`);
const HOME = join(ROOT, "home");
const UNOWN_HOME = join(HOME, ".unown");

/** One pristine-home subprocess run of the seed probe. */
function seedProbe(mode: "fresh" | "preserve"): { ok: boolean; out: string } {
    mkdirSync(HOME, { recursive: true });
    if (mode === "preserve") {
        const agentDir = join(UNOWN_HOME, "agent");
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(
            join(agentDir, "settings.json"),
            `${JSON.stringify({ quietStartup: false }, null, 2)}\n`,
            "utf8",
        );
    }
    const termModule = JSON.stringify(join(import.meta.dir, "..", "src", "term.ts"));
    const script = `
import { ensureUnownAgentDirInfo } from ${termModule};
import { readFileSync } from "node:fs";
import { join } from "node:path";
ensureUnownAgentDirInfo();
const settings = JSON.parse(readFileSync(join(process.env.UNOWN_HOME!, "agent", "settings.json"), "utf8"));
console.log(JSON.stringify({ quietStartup: settings.quietStartup, tuiMode: settings.tuiMode, theme: typeof settings.theme }));
`;
    const proc = spawnSync("bun", ["-e", script], {
        env: { ...process.env, HOME, UNOWN_HOME, UNOWN_NO_ENGINE_SERVICE: "1", UNOWN_ENGINE_AUTOSTART: "0" },
        encoding: "utf8",
        timeout: 60_000,
    });
    return { ok: proc.status === 0, out: (proc.stdout || "") + (proc.stderr || "") };
}

describe("semplice W3 — the fresh-install quiet seed", () => {
    test("a fresh agent dir seeds settings.json with quietStartup:true", () => {
        const { ok, out } = seedProbe("fresh");
        expect(ok).toBe(true);
        const probe = JSON.parse(out.trim().split("\n").pop()!);
        expect(probe.quietStartup).toBe(true);
        // The pre-Semplice seeds survive alongside (never removed).
        expect(probe.tuiMode).toBe("fullscreen");
        expect(probe.theme).toBe("string");
    });

    test("an existing settings.json is never clobbered by the quiet seed", () => {
        rmSync(ROOT, { recursive: true, force: true });
        const { ok, out } = seedProbe("preserve");
        expect(ok).toBe(true);
        const probe = JSON.parse(out.trim().split("\n").pop()!);
        expect(probe.quietStartup).toBe(false); // the user's saved choice wins
    });
});

describe("semplice W3 — the splash/quiet decoupling", () => {
    test("the gate input has no quietStartup field (decoupled by construction)", async () => {
        const mod = await import("../src/splash.ts");
        const reason = mod.splashBlockReason({
            mode: "tui",
            plainColor: false,
            envDisabled: false,
            alreadyShown: false,
        });
        expect(reason).toBeNull();
    });
    test("the kill switches still name themselves", async () => {
        const mod = await import("../src/splash.ts");
        expect(mod.splashEnvDisabled({ UNOWN_NO_SPLASH: "1" })).toBe(true);
        expect(mod.splashEnvDisabled({})).toBe(false);
    });
});

describe("semplice W15 — plain-language chips", () => {
    test("the confidence chip says what it means", async () => {
        const { renderConfidenceChip } = await import("../src/mission.ts");
        expect(renderConfidenceChip({ level: "high", drivers: [] })).toBe("on track ✓");
        expect(renderConfidenceChip({ level: "medium", drivers: ["x"] })).toBe("on track ◐");
        expect(renderConfidenceChip({ level: "low", drivers: ["x"] })).toBe("on track ✗");
    });
});

afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
});
