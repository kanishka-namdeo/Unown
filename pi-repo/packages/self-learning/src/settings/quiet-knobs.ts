/**
 * settings/quiet-knobs.ts — Calando Q4: the quiet knobs' precedence seam.
 *
 * Semplice inventory item 14 closed the class: quiet must not be env-only.
 * `UNOWN_FOOTER_CLASSIC`, `UNOWN_TURN_METER` and `UNOWN_MISSION_PANEL`
 * become hub-owned toggles (settings-hub.json) while the env vars stay
 * first-class overrides — a knob that cannot be turned off is not shipped,
 * and an explicit env var is the kill switch.
 *
 * Precedence: explicit env (set at boot) > hub pref > default.
 *
 * Mechanics: the boot seam (`ensureUnownAgentDirInfo`, right after
 * `seedHubPrefs()`) seeds any UNSET env var from the pref, so both layers
 * — self-learning (footer-mode/turn-meter/mission) AND the vendored
 * coding-agent footer, which cannot import this package without a cycle —
 * keep reading the one runtime source they always read: process.env.
 * A knob whose env var was ALREADY set at boot is env-locked: the hub
 * shows its state but a toggle write reports the lock instead of
 * silently losing to the env var. A live toggle write (registry `set`)
 * updates both the pref and process.env, so the change applies
 * immediately — every reader reads per call, never cached.
 */

import { loadHubPrefs, saveHubPrefs } from "./prefs.ts";
import type { HubPrefs } from "./types.ts";

/** The three quiet knobs: env var ↔ hub pref. */
export const QUIET_KNOBS = [
	{ env: "UNOWN_FOOTER_CLASSIC", pref: "footerClassic" },
	{ env: "UNOWN_TURN_METER", pref: "turnMeter" },
	{ env: "UNOWN_MISSION_PANEL", pref: "missionPanel" },
] as const;

export type QuietKnobEnv = (typeof QUIET_KNOBS)[number]["env"];

/** Env vars that were EXPLICITLY set when this module first seeded — locked. */
const envLocked = new Set<string>();

/** Boot seam: seed unset env vars from the hub prefs. Call once per process. */
export function seedQuietKnobEnv(): void {
	const prefs = loadHubPrefs();
	for (const knob of QUIET_KNOBS) {
		if (process.env[knob.env] !== undefined) {
			envLocked.add(knob.env);
			continue; // explicit env wins — kill switches stay king
		}
		process.env[knob.env] = prefs[knob.pref] ? "1" : "0";
	}
}

/** Is this knob pinned by an explicit env var set before boot seeding? */
export function quietKnobEnvLocked(env: QuietKnobEnv): boolean {
	return envLocked.has(env);
}

/**
 * Live toggle write: persist the pref and apply it to process.env unless
 * the knob is env-locked. Returns true when the runtime state changed.
 */
export function applyQuietKnobPref(env: QuietKnobEnv, value: boolean): boolean {
	if (envLocked.has(env)) return false;
	const knob = QUIET_KNOBS.find((k) => k.env === env);
	if (!knob) return false;
	const prefs: HubPrefs = loadHubPrefs();
	(prefs as unknown as Record<string, boolean>)[knob.pref] = value;
	saveHubPrefs(prefs);
	process.env[env] = value ? "1" : "0";
	return true;
}

/** Effective on/off for a knob (the env reader's verdict). */
export function quietKnobEffective(
	env: QuietKnobEnv,
	envSource: Record<string, string | undefined> = process.env,
): boolean {
	switch (env) {
		case "UNOWN_FOOTER_CLASSIC":
			return (envSource[env] ?? "") === "1";
		default:
			return (envSource[env] ?? "") !== "0";
	}
}
