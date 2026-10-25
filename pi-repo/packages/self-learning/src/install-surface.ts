/**
 * install-surface.ts — what the install receipt says inside a live session.
 *
 * `~/.unown/install.json` records the channel, version and paths of the install
 * the landing page's one-liner just performed. Until now nothing in the TUI read
 * it: the installer closed with a prose `next steps:` block, the first-run gate
 * asked once and then never re-asked (deliberate — see the `created` gate in
 * cli.ts), and the only lifecycle signal in a session was the update chip. A
 * user who answered `n` at the gate learned they had no model by being handed a
 * 401.
 *
 * Two surfaces, one reading the install record and the other the agent dir:
 *
 *  - the install card: one shot at the first session of an install, and again
 *    when the recorded version changes. It answers "did the thing I just
 *    installed become the thing I am running, and where does it live".
 *  - the model pill: a footer status that stays for as long as the agent dir
 *    has no provider — the recovery path named on the pill instead of a question
 *    that would have to be re-asked.
 *
 * Both are cosmetic: read-only, never throw, and never claim more than the
 * evidence. The card is skipped when there is no receipt (a dev run straight
 * from a clone writes one via scripts/link.ts, but a bare `bun bin/unown` may
 * not); the pill distinguishes "no provider" from "the bundled bridge is
 * answering" because saying "no model connected" over a working bridge is a lie.
 */
import { join } from "node:path";

import { type InstallMode, readInstallMetadata } from "./install-layout.ts";
import { readOnboardingState, writeOnboardingState } from "./onboarding-state.ts";
import { unownHome, unownVersion } from "./packaging.ts";
import { readAgentModelsFile } from "./probe.ts";

// ---------------------------------------------------------------------------
// The card (pure renderer over the receipt)
// ---------------------------------------------------------------------------

export interface InstallCardInput {
	mode: InstallMode;
	/** The version the install record carries. */
	version: string;
	platform?: string;
	/** Install root: the versioned binary root, or the checkout directory. */
	root: string;
	/** The PATH entry that launches it. */
	shim: string;
	previousVersion?: string;
	installedAt: string;
	/** The build this process is running, when it can be determined. */
	runningVersion?: string;
}

const CHANNEL_LINE: Record<InstallMode, string> = {
	binary: "standalone CLI — no bun, no repo. The engine and learning stack need the --source install.",
	checkout: "full stack from a git clone — CLI + engine + memory (bun run agent:start boots the services).",
};

/** "2026-10-25 09:00 UTC" from the record's ISO timestamp; the raw value when
 *  it does not parse, so a hand-edited record still prints something true. */
function formatInstalledAt(iso: string): string {
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return iso;
	return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Render the install card. Plain text, one fact per line — the notify pane is
 *  not a pager (same posture as renderStatusCard). */
export function renderInstallCard(input: InstallCardInput): string {
	const shown = input.runningVersion ?? input.version;
	const label = input.mode === "binary" ? "binary install" : "source checkout";
	const lines: string[] = [`unown v${shown} · ${label}${input.platform ? ` (${input.platform})` : ""}`];
	lines.push(`channel: ${CHANNEL_LINE[input.mode]}`);
	lines.push(`${input.mode === "binary" ? "binary" : "repo"}: ${input.root}`);
	lines.push(`on PATH: ${input.shim}`);
	const installed = `installed: ${formatInstalledAt(input.installedAt)}`;
	lines.push(input.previousVersion ? `${installed} · from v${input.previousVersion}` : installed);
	if (input.runningVersion && input.runningVersion !== input.version) {
		lines.push(
			`this process is v${input.runningVersion} — the record says v${input.version} (start a new session to run the installed build)`,
		);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The one-shot latch (onboarding.json, same file the tips and flights use)
// ---------------------------------------------------------------------------

/** The latch key: a new version of the same channel re-shows the card, so an
 *  update gets one line of acknowledgement instead of silence. */
export function installCardKey(mode: InstallMode, version: string): string {
	return `${mode}:${version}`;
}

export interface PendingInstallCardOptions {
	/** Test seam for UNOWN_HOME (the receipt and the latch both live here). */
	home?: string;
	/** Test seam for the running build's version. */
	runningVersion?: string;
}

export interface PendingInstallCard {
	key: string;
	card: string;
}

/**
 * The card to show now, or undefined when there is nothing new to say: no
 * receipt (a dev run), or this exact install was already shown. The caller marks
 * the key seen only AFTER the card reached the UI, so a session with no notify
 * seam does not silently consume the one-shot.
 */
export function pendingInstallCard(opts: PendingInstallCardOptions = {}): PendingInstallCard | undefined {
	const home = opts.home ?? unownHome();
	const meta = readInstallMetadata(home);
	if (!meta) return undefined;
	const key = installCardKey(meta.mode, meta.version);
	if (readOnboardingState(home).installCardSeenFor === key) return undefined;
	const runningVersion =
		opts.runningVersion ?? unownVersion(join(import.meta.dir, "..", "..", "..", "..", "package.json"));
	return {
		key,
		card: renderInstallCard({
			mode: meta.mode,
			version: meta.version,
			platform: meta.platform,
			root: meta.root,
			shim: meta.shim,
			previousVersion: meta.previousVersion,
			installedAt: meta.installedAt,
			runningVersion: runningVersion === "unknown" ? undefined : runningVersion,
		}),
	};
}

/** Latch the card as seen. Writes onboarding.json in the same shape the flights
 *  and tips already use; a failed write leaves the card to show next session.
 *  The home resolves through the SAME call-time reader as the receipt — the
 *  term.ts constant is fixed at module load, so mixing the two would write the
 *  latch somewhere the next boot never looks. */
export function markInstallCardSeen(key: string, home?: string): void {
	const root = home ?? unownHome();
	const state = readOnboardingState(root);
	if (state.installCardSeenFor === key) return;
	writeOnboardingState({ ...state, installCardSeenFor: key }, root);
}

// ---------------------------------------------------------------------------
// The footer pill (the never-re-asked question, made persistently visible)
// ---------------------------------------------------------------------------

export interface ModelPillInput {
	/** Providers configured in the agent dir (a count, so no config leaks out). */
	providers: number;
	/** models.json exists but did not parse. */
	modelsJsonError?: string;
	/** The bundled bridge answered. Undefined = not probed (treated as down). */
	bridgeUp?: boolean;
}

/**
 * The footer text for an install with no model of its own, or undefined when a
 * provider is configured (nothing to flag). Wording mirrors firstRunGateLines so
 * the gate and the pill cannot describe the same state two different ways — in
 * particular, never "no model connected" while the bridge is answering.
 */
export function modelPillLine(input: ModelPillInput): string | undefined {
	if (input.modelsJsonError) return "models.json unreadable · /setup to reconnect";
	if (input.providers > 0) return undefined;
	if (input.bridgeUp === true) return "model: the bundled bridge · /setup for your own provider";
	return "no model connected · /setup";
}

/** The pill for a live agent dir, read from disk only — no probe here, so the
 *  caller decides whether it can afford the (loopback, 1 s) bridge health check. */
export function modelPillFromAgentDir(agentDir: string, bridgeUp?: boolean): string | undefined {
	const file = readAgentModelsFile(agentDir);
	return modelPillLine({ providers: file.providers.length, modelsJsonError: file.error, bridgeUp });
}
