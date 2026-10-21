// Headless render tests for src/dashboard/dashboard-app.ts — the D6 suite.
// The real DashboardApp is mounted against a FakeTui (the minimal TUI surface
// the app consumes: terminal size, requestRender, overlay mounting) and the D6
// mock engine (test/dashboard-mock-engine.ts). Keys are driven through
// app.handleInput(<raw terminal data>) exactly as the TUI would deliver them,
// and assertions run on the rendered pane with ANSI styling stripped.
//
// The mock speaks named-event SSE frames (the format DashboardStore's
// handleFrame parses); the live engine's envelope-only frames are a known app
// bug — see the report filed with this harness and the note in
// test/dashboard-mock-engine.ts.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { initTheme, theme } from "@earendil-works/pi-coding-agent";
import { DashboardApp, SCREEN_SPECS } from "../src/dashboard/dashboard-app.ts";
import { DashboardStore, EngineClient } from "../src/dashboard/dashboard-data.ts";
import type { HooksResponse, OverviewResponse } from "../src/dashboard/dashboard-types.ts";
import { type MockEngine, startMockEngine } from "./dashboard-mock-engine.ts";

initTheme("dark");

/** The minimal TUI surface DashboardApp consumes (see dashboard-app.ts). */
class FakeTui {
	terminal = { rows: 30, columns: 120 };
	renderCount = 0;
	overlays: unknown[] = [];
	requestRender(): void {
		this.renderCount++;
	}
	setFocus(_c: unknown): void {}
	showOverlay(component: unknown, _opts?: unknown) {
		this.overlays.push(component);
		return {
			hide: (): void => {},
			setHidden: (): void => {},
			isHidden: (): boolean => false,
			focus: (): void => {},
			unfocus: (): void => {},
			isFocused: (): boolean => false,
		};
	}
	hideOverlay(): void {}
}

/** Strip ANSI SGR sequences and join a pane into one comparable string. */
const plain = (lines: string[]): string => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");

/** Poll cond() until true; throws on timeout (keeps failures actionable). */
async function waitFor(cond: () => boolean, timeoutMs = 5000, label = ""): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms${label ? `: ${label}` : ""}`);
		await Bun.sleep(25);
	}
}

let mock: MockEngine;
let store: DashboardStore;
let fake: FakeTui;
let app: DashboardApp;
let exited: boolean;
const exitSpy = (): void => {
	exited = true;
};

beforeAll(async () => {
	mock = await startMockEngine();
	store = new DashboardStore(new EngineClient(mock.url));
	fake = new FakeTui();
	exited = false;
	app = new DashboardApp(fake as never, {
		theme,
		store,
		embedded: false,
		onExit: exitSpy,
		initialScreen: "overview",
	});
	store.start();
	app.start();
	await waitFor(() => store.snapshot<OverviewResponse>("overview").data != null, 5000, "overview data");
	// Let the canned SSE burst (300/550ms after connect) and its invalidation
	// refetches settle before the render assertions.
	await Bun.sleep(800);
});

afterAll(async () => {
	app.dispose();
	store.stop();
	await mock.close();
});

describe("DashboardApp headless render", () => {
	test("every screen renders its vocabulary", () => {
		// Per-screen anchors (the PTY pane-truth vocabulary, headless edition).
		// The skills fixture keeps "recover-failed-cycle" on screen — "minted"
		// only appears in the skills screen's EMPTY state.
		const anchors: Record<string, string[]> = {
			overview: ["benchmark tasks", "pass rate"],
			memory: ["engine tiers", "injection budget", "project memories"],
			dreams: ["autodream"],
			notes: ["filter"],
			skills: ["skills", "recover-failed-cycle"],
			lab: ["learning lab", "cycles", "improvements", "runs"],
			hooks: ["events", "filter", "f filter"],
			router: ["router jobs", "auto-dream", "sandboxes"],
			gateway: ["requests", "latency"],
			automations: ["automations", "cron"],
			webcache: ["entries"],
		};
		for (const spec of SCREEN_SPECS) {
			app.setScreen(spec.id);
			const pane = plain(app.render(120));
			for (const anchor of anchors[spec.id] ?? []) {
				expect(pane, `${spec.id} pane contains "${anchor}"`).toContain(anchor);
			}
		}
	});

	test("sidebar lists all screens with accelerators", () => {
		app.setScreen("overview");
		const pane = plain(app.render(120));
		expect(pane).toContain("1 Overview");
		expect(pane).toContain("2 Memory");
		expect(pane).toContain("5 Skills");
		expect(pane).toContain("9 Gateway");
		expect(pane).toContain("0 Automations");
		expect(pane).toContain("· Web Cache");
		// Group headers and the loop-state foot.
		expect(pane).toContain("LEARNING");
		expect(pane).toContain("OPERATIONS");
		expect(pane).toContain("loop state");
	});

	test("drill-in and back", async () => {
		app.setScreen("overview");
		app.handleInput("\r"); // enter on the first task → detail drill-in
		await Bun.sleep(150); // the task detail fetch is async
		const detail = plain(app.render(120));
		expect(detail).toContain("description");
		expect(detail).toContain("seeded files");
		app.handleInput("\x1b"); // escape → back to the list
		const list = plain(app.render(120));
		expect(list).toContain("benchmark tasks");
	});

	test("hooks detail g/G jump to the ends (help-card truth)", async () => {
		app.setScreen("hooks");
		await waitFor(() => store.snapshot<HooksResponse>("hooks").data != null, 2000, "hooks data");
		app.handleInput("\r"); // enter on the first event → the detail view
		fake.terminal.rows = 8; // shrink the pane so the detail is taller than it
		let pane = plain(app.render(120));
		expect(pane).toContain("hook · PreToolUse");
		app.handleInput("G"); // shift+g → jump to the bottom
		pane = plain(app.render(120));
		expect(pane, "G lands on the detail's tail").toContain("cmd: cat /etc/passwd > out");
		expect(pane).not.toContain("hook · PreToolUse");
		app.handleInput("g"); // g → jump back to the top
		pane = plain(app.render(120));
		expect(pane, "g returns to the detail's head").toContain("hook · PreToolUse");
		app.handleInput("\x1b"); // back to the list, restore the pane height
		fake.terminal.rows = 30;
	});

	test("confirm bar gates destructive actions", () => {
		app.setScreen("overview");
		app.handleInput("m"); // mint is destructive → y/N confirm gate
		const gated = plain(app.render(120));
		expect(gated).toContain("mine the most recent failed run");
		expect(gated).toContain("y confirm · n cancel");
		app.handleInput("n");
		const dismissed = plain(app.render(120));
		expect(dismissed).not.toContain("y confirm · n cancel");
		expect(dismissed).not.toContain("mine the most recent failed run");
	});

	test("confirm y executes the gated action", async () => {
		app.setScreen("overview");
		app.handleInput("m");
		app.handleInput("y");
		await waitFor(() => mock.calls.mints === 1, 2000, "POST /api/tasks/mint executed");
		const pane = plain(app.render(120));
		expect(pane).toContain("mint minted"); // toast: mint minted · mined from run-e2e-10
	});

	test("palette overlay mounts", () => {
		app.handleInput(":");
		expect(fake.overlays.length).toBe(1);
	});

	test("? help card closes on esc/q only", () => {
		// The help overlay owns focus while open, so keys go to the card's
		// handleInput (driven directly here). Esc, q and ctrl+c close it;
		// any other key must leave it up — openHelp() re-mounts only after
		// a close, which is the observable difference.
		const n = fake.overlays.length;
		app.handleInput("?");
		expect(fake.overlays.length, "? mounts the help card").toBe(n + 1);
		const card = fake.overlays[n] as { handleInput: (data: string) => void };
		card.handleInput("x"); // not a closer
		app.handleInput("?");
		expect(fake.overlays.length, "a stray key does not close the card").toBe(n + 1);
		card.handleInput("\x1b"); // esc closes
		app.handleInput("?");
		expect(fake.overlays.length, "esc closed the card, so ? re-mounts").toBe(n + 2);
		const card2 = fake.overlays[n + 1] as { handleInput: (data: string) => void };
		card2.handleInput("q"); // q closes (the overlay owns focus, so q never quits)
		app.handleInput("?");
		expect(fake.overlays.length, "q closed the card too").toBe(n + 3);
	});

	test("text-input hatch forwards shell keys", () => {
		app.setScreen("notes");
		app.handleInput("c"); // compose → the screen's inline field captures
		let pane = plain(app.render(120));
		expect(pane).toContain("compose note");
		// "q" types into the composer instead of quitting the dashboard.
		app.handleInput("q");
		expect(exited, "q must not exit while the composer captures").toBe(false);
		pane = plain(app.render(120));
		expect(pane).toContain("q‸"); // the field shows the typed character
		expect(pane).toContain("1/20000"); // …and the counter moved
		app.handleInput("\x1b"); // escape cancels the composer
		pane = plain(app.render(120));
		expect(pane).not.toContain("compose note");
		expect(exited).toBe(false);
	});

	test("embedded esc-esc exits, single esc does not", () => {
		const embeddedFake = new FakeTui();
		let embeddedExited = false;
		const embeddedApp = new DashboardApp(embeddedFake as never, {
			theme,
			store,
			embedded: true,
			onExit: () => {
				embeddedExited = true;
			},
			initialScreen: "overview",
		});
		embeddedApp.start();
		embeddedApp.handleInput("\x1b");
		expect(embeddedExited, "a single esc only drills out").toBe(false);
		embeddedApp.handleInput("\x1b"); // back-to-back: inside the 600ms window
		expect(embeddedExited, "esc-esc exits the embedded mount").toBe(true);
	});

	test("degraded banner on engine down", async () => {
		// A store pointed at the suite's dead-port convention — nothing listens
		// there; the app must render the error state, never throw.
		const deadStore = new DashboardStore(new EngineClient("http://127.0.0.1:9", 1500));
		const deadFake = new FakeTui();
		const deadApp = new DashboardApp(deadFake as never, {
			theme,
			store: deadStore,
			embedded: false,
			onExit: () => {},
			initialScreen: "overview",
		});
		try {
			deadApp.start();
			await waitFor(
				() => deadStore.snapshot<OverviewResponse>("overview").error !== null,
				5000,
				"overview error state",
			);
			let pane = "";
			expect(() => {
				pane = plain(deadApp.render(120));
			}, "render must not throw while the engine is unreachable").not.toThrow();
			expect(pane).toContain("engine unreachable");
			expect(pane).toContain("keeps its last snapshot");
		} finally {
			deadApp.dispose();
			deadStore.stop();
		}
	});

	test("render never throws on narrow widths", () => {
		for (const id of ["overview", "memory", "automations"]) {
			app.setScreen(id);
			for (const w of [40, 80, 120]) {
				let lines: string[] = [];
				expect(() => {
					lines = app.render(w);
				}, `${id} renders at width ${w}`).not.toThrow();
				expect(Array.isArray(lines), `${id} at ${w} returns string[]`).toBe(true);
				for (const line of lines) expect(typeof line, `${id} at ${w} line type`).toBe("string");
			}
		}
	});
});
