/**
 * onboarding-state.ts — the persistent onboarding latch
 * (<UNOWN_HOME>/onboarding.json, schema 1).
 *
 * Lives at the UNOWN_HOME ROOT (not agent/) — the same convention as
 * install.json and update-prefs.json: this is unown-CLI state, not pi agent
 * config, so it survives agent-dir resets and never rides along with
 * models/auth/settings rewrites.
 *
 * Read posture: NEVER throws, NEVER blocks boot — a missing, corrupt or
 * foreign-schema file collapses to defaultOnboardingState() (the
 * update-status.ts parsePrefs posture: a schema gate first, then field-wise
 * normalization, so a single hand-mangled field cannot reset the latch
 * either). Any read error — a directory sitting in the path, odd bytes — is
 * the same "no state yet" answer.
 *
 * Write posture: the install-layout.ts discipline — mkdir -p the parent, temp
 * file in the SAME directory + renameSync (atomic vs partial content), and
 * the Windows remove+retry when the rename hits a briefly-locked target.
 * JSON is 2-space indented with a trailing newline, exactly like
 * install-layout.ts writes its metadata.
 *
 * `home` is injectable so tests get isolated state dirs; the default mirrors
 * src/recipes.ts — the UNOWN_HOME const from term.ts (resolved once at its
 * module load).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UNOWN_HOME } from "./term.ts";

export interface OnboardingState {
        schema: 1;
        /** User asked to never auto-show the First flights catalog. */
        flightsDismissed: boolean;
        /** ISO timestamp of the first interactive user message ("first flight flown"). */
        firstTaskAt?: string;
        /** One-time tip ids already shown (reserved for the next milestone — keep the field). */
        tipsSeen: string[];
}

/** The blank slate: catalog not dismissed, nothing flown, no tips shown. */
export function defaultOnboardingState(): OnboardingState {
        return { schema: 1, flightsDismissed: false, tipsSeen: [] };
}

/** The latch file: <home ?? UNOWN_HOME>/onboarding.json. */
export function onboardingStatePath(home?: string): string {
        return join(home ?? UNOWN_HOME, "onboarding.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Schema gate + field-wise normalization; null for anything not schema-1. */
function parseOnboardingState(raw: unknown): OnboardingState | null {
        if (!isRecord(raw) || raw.schema !== 1) return null;
        const state: OnboardingState = {
                schema: 1,
                flightsDismissed: raw.flightsDismissed === true,
                tipsSeen: Array.isArray(raw.tipsSeen)
                        ? raw.tipsSeen.filter((tip): tip is string => typeof tip === "string")
                        : [],
        };
        if (typeof raw.firstTaskAt === "string" && !Number.isNaN(Date.parse(raw.firstTaskAt))) {
                state.firstTaskAt = raw.firstTaskAt;
        }
        return state;
}

/**
 * Read the latch. Missing file, corrupt JSON, wrong-or-absent schema (and any
 * read error — a directory in the way, unreadable bytes) all collapse to
 * defaultOnboardingState(). NEVER throws: the boot path calls this on every
 * startup.
 */
export function readOnboardingState(home?: string): OnboardingState {
        try {
                return parseOnboardingState(JSON.parse(readFileSync(onboardingStatePath(home), "utf8"))) ?? defaultOnboardingState();
        } catch {
                return defaultOnboardingState();
        }
}

/**
 * Atomically persist the latch: temp file in the same directory + rename, so
 * a crash between the two leaves the previous file, never a partial one.
 */
export function writeOnboardingState(state: OnboardingState, home?: string): void {
        const target = onboardingStatePath(home);
        mkdirSync(dirname(target), { recursive: true });
        const tmp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
        try {
                renameSync(tmp, target);
        } catch (err) {
                // Windows can briefly refuse to replace a file another process
                // has open; one remove+retry is the whole fallback.
                try {
                        rmSync(target, { force: true });
                        renameSync(tmp, target);
                } catch {
                        rmSync(tmp, { force: true });
                        throw err;
                }
        }
}
