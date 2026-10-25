// install-surface.test.ts — the install receipt's two in-session surfaces:
// the one-shot card and the "no model connected" footer pill.
//
// Hermetic: a per-case tmpdir stands in for UNOWN_HOME (receipt + latch) and
// another for the agent dir. No TUI, no network — the bridge probe lives in the
// caller, and this module receives only its answer.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InstallMetadata, writeInstallMetadata } from "../src/install-layout.ts";
import {
	installCardKey,
	markInstallCardSeen,
	modelPillFromAgentDir,
	modelPillLine,
	pendingInstallCard,
	renderInstallCard,
} from "../src/install-surface.ts";

let TMP = "";
function fresh(): string {
	TMP ||= mkdtempSync(join(tmpdir(), "unown-surface-"));
	const d = join(TMP, `c-${Math.random().toString(36).slice(2)}`);
	mkdirSync(d, { recursive: true });
	return d;
}

afterAll(() => {
	if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function sample(overrides: Partial<InstallMetadata> = {}): InstallMetadata {
	return {
		schema: 1,
		mode: "binary",
		version: "0.0.16",
		platform: "linux-x64",
		root: "/home/ann/.local/share/unown",
		bin: "/home/ann/.local/share/unown/versions/0.0.16/unown",
		shim: "/home/ann/.local/bin/unown",
		installedAt: "2026-10-25T09:00:00.000Z",
		...overrides,
	};
}

describe("renderInstallCard", () => {
	test("names the channel, the paths and the install time (binary)", () => {
		const card = renderInstallCard({
			mode: "binary",
			version: "0.0.16",
			platform: "linux-x64",
			root: "/home/ann/.local/share/unown",
			shim: "/home/ann/.local/bin/unown",
			installedAt: "2026-10-25T09:00:00.000Z",
			runningVersion: "0.0.16",
		});
		expect(card).toContain("unown v0.0.16 · binary install (linux-x64)");
		expect(card).toContain("channel: standalone CLI — no bun, no repo");
		expect(card).toContain("binary: /home/ann/.local/share/unown");
		expect(card).toContain("on PATH: /home/ann/.local/bin/unown");
		expect(card).toContain("installed: 2026-10-25 09:00 UTC");
		// The CLI-only limit is the point of the card on this channel, so the
		// checkout-only wording must not leak in.
		expect(card).not.toContain("git clone");
	});

	test("describes a checkout as the full stack", () => {
		const card = renderInstallCard({
			mode: "checkout",
			version: "0.0.16",
			root: "/home/ann/Unown",
			shim: "/home/ann/.local/bin/unown",
			installedAt: "2026-10-25T09:00:00.000Z",
		});
		expect(card).toContain("source checkout");
		expect(card).toContain("channel: full stack from a git clone");
		expect(card).toContain("repo: /home/ann/Unown");
		expect(card).not.toContain("binary:");
	});

	test("says which version the card came from on an upgrade", () => {
		const card = renderInstallCard({
			mode: "binary",
			version: "0.0.16",
			root: "/r",
			shim: "/s",
			previousVersion: "0.0.15",
			installedAt: "2026-10-25T09:00:00.000Z",
		});
		expect(card).toContain("installed: 2026-10-25 09:00 UTC · from v0.0.15");
	});

	test("flags a process still running the previous build", () => {
		const card = renderInstallCard({
			mode: "binary",
			version: "0.0.17",
			root: "/r",
			shim: "/s",
			installedAt: "2026-10-25T09:00:00.000Z",
			runningVersion: "0.0.16",
		});
		expect(card).toContain("unown v0.0.16 · binary install");
		expect(card).toContain("this process is v0.0.16 — the record says v0.0.17");
	});

	test("a timestamp that does not parse prints as written", () => {
		const card = renderInstallCard({
			mode: "binary",
			version: "0.0.16",
			root: "/r",
			shim: "/s",
			installedAt: "yesterday, i think",
		});
		expect(card).toContain("installed: yesterday, i think");
	});

	test("one fact per line, no line longer than a narrow terminal", () => {
		const card = renderInstallCard({
			mode: "binary",
			version: "0.0.16",
			platform: "linux-x64",
			root: "/r",
			shim: "/s",
			installedAt: "2026-10-25T09:00:00.000Z",
		});
		// The header and every label row stay inside 80 columns; the channel
		// sentence is the longest content line.
		expect(card.split("\n").every((l) => l.length <= 100)).toBe(true);
	});
});

describe("pendingInstallCard / markInstallCardSeen", () => {
	test("no receipt (a bare dev run) shows nothing", () => {
		expect(pendingInstallCard({ home: fresh(), runningVersion: "0.0.16" })).toBeUndefined();
	});

	test("shows once per recorded version, then stays quiet", () => {
		const home = fresh();
		writeInstallMetadata(home, sample());
		const first = pendingInstallCard({ home, runningVersion: "0.0.16" });
		expect(first?.card).toContain("unown v0.0.16 · binary install");
		expect(first?.key).toBe(installCardKey("binary", "0.0.16"));
		// Unshown cards are not consumed: the latch only moves on the mark.
		expect(pendingInstallCard({ home, runningVersion: "0.0.16" })).toBeDefined();
		markInstallCardSeen(first!.key, home);
		expect(pendingInstallCard({ home, runningVersion: "0.0.16" })).toBeUndefined();
	});

	test("an update to a new recorded version speaks again", () => {
		const home = fresh();
		writeInstallMetadata(home, sample());
		markInstallCardSeen(installCardKey("binary", "0.0.16"), home);
		writeInstallMetadata(home, sample({ version: "0.0.17" }));
		const next = pendingInstallCard({ home, runningVersion: "0.0.17" });
		expect(next?.card).toContain("v0.0.17");
	});

	test("the latch rides the shared onboarding file and keeps the other fields", () => {
		const home = fresh();
		writeInstallMetadata(home, sample());
		mkdirSync(join(home, "agent"), { recursive: true });
		writeFileSync(
			join(home, "onboarding.json"),
			JSON.stringify({
				schema: 1,
				flightsDismissed: true,
				tipsSeen: ["a"],
				firstTaskAt: "2026-10-01T00:00:00.000Z",
			}),
			"utf8",
		);
		const pending = pendingInstallCard({ home, runningVersion: "0.0.16" });
		markInstallCardSeen(pending!.key, home);
		const state = JSON.parse(readFileSync(join(home, "onboarding.json"), "utf8"));
		expect(state.flightsDismissed).toBe(true);
		expect(state.tipsSeen).toEqual(["a"]);
		expect(state.firstTaskAt).toBe("2026-10-01T00:00:00.000Z");
		expect(state.installCardSeenFor).toBe("binary:0.0.16");
	});

	test("a foreign-schema receipt shows nothing (the reader refuses it)", () => {
		const home = fresh();
		writeFileSync(join(home, "install.json"), JSON.stringify({ ...sample(), schema: 9 }), "utf8");
		expect(pendingInstallCard({ home, runningVersion: "0.0.16" })).toBeUndefined();
	});
});

describe("modelPillLine", () => {
	test("a configured provider gets no pill", () => {
		expect(modelPillLine({ providers: 2 })).toBeUndefined();
		expect(modelPillLine({ providers: 1, bridgeUp: false })).toBeUndefined();
	});

	test("nothing configured, nothing answering", () => {
		expect(modelPillLine({ providers: 0 })).toBe("no model connected · /setup");
		expect(modelPillLine({ providers: 0, bridgeUp: false })).toBe("no model connected · /setup");
	});

	test("never claims an absent model while the bridge is answering", () => {
		const line = modelPillLine({ providers: 0, bridgeUp: true });
		expect(line).toContain("bundled bridge");
		expect(line).not.toContain("no model connected");
	});

	test("a corrupt models.json is reported as corrupt, not as unconfigured", () => {
		const line = modelPillLine({ providers: 0, modelsJsonError: "Unexpected token }", bridgeUp: true });
		expect(line).toContain("models.json unreadable");
		expect(line).not.toContain("no model connected");
	});
});

describe("modelPillFromAgentDir", () => {
	function agentDirWithModels(content: string): string {
		const dir = fresh();
		const agent = join(dir, "agent");
		mkdirSync(agent, { recursive: true });
		writeFileSync(join(agent, "models.json"), content, "utf8");
		return agent;
	}

	test("undefined when a provider is configured", () => {
		const dir = agentDirWithModels(JSON.stringify({ providers: { agnes: { models: [{ id: "agnes-3.0-flash" }] } } }));
		expect(modelPillFromAgentDir(dir, false)).toBeUndefined();
	});

	test("the pill when the agent dir has no providers", () => {
		const dir = agentDirWithModels(JSON.stringify({ providers: {} }));
		expect(modelPillFromAgentDir(dir)).toBe("no model connected · /setup");
	});

	test("the pill when there is no agent dir at all", () => {
		expect(modelPillFromAgentDir(join(fresh(), "agent"))).toBe("no model connected · /setup");
	});

	test("a half-written models.json reads as unreadable, not as unconfigured", () => {
		const dir = agentDirWithModels('{"providers": { "agnes": ');
		expect(modelPillFromAgentDir(dir)).toContain("models.json unreadable");
	});
});
