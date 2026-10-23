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
import type {
	HooksResponse,
	MemoryHistoryEntry,
	MemoryResponse,
	OverviewResponse,
	RunsResponse,
} from "../src/dashboard/dashboard-types.ts";
import { memoryVersionDiff } from "../src/dashboard/screens/memory-screen.ts";
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
			router: ["router jobs", "auto-dream", "sandboxes", "1 job(s) failed their last run", "✗ 47 runs"],
			gateway: ["requests", "latency"],
			automations: ["routines", "cron"],
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
		expect(pane).toContain("0 Routines");
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

	test("M11: an in-flight run renders its LIVE counters, not the finalize-time zeros", async () => {
		// The mock's running run has an all-zero DB row (counters are written at
		// finalize) and a live entry with 7 tool calls / 4 turns / 3m elapsed.
		// If the Lab ever reads the row again, this pane goes back to showing a
		// running run that appears to have done nothing — the exact defect M6-2
		// produced the live endpoint for.
		app.setScreen("lab");
		await waitFor(() => store.snapshot<RunsResponse>("runs").data != null, 2000, "runs data");
		await waitFor(() => store.snapshot("liveRuns").data != null, 2000, "liveRuns data");
		app.handleInput("\t"); // cycles → improvements
		app.handleInput("\t"); // → runs
		app.handleInput("G"); // shift+G → last row (the running run is appended last)
		app.handleInput("\r"); // drill into its detail
		await Bun.sleep(200); // the run detail fetch is async (same rule as the drill-in test)
		const pane = plain(app.render(120));
		expect(pane, "the detail carries the live block").toContain("live");
		expect(pane).toContain("7 tools");
		expect(pane).toContain("4 turns");
		// A run that has not finalized has no verify block yet.
		expect(pane, "no fake verify verdict for a running run").toContain("verify pending");
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

// ---------------------------------------------------------------------------
// M11 — the memory screen's VERSION DIFF. The engine stores every tier write
// with its full text, but the screen showed the current block plus a list of
// version rows, so "what did that dream change?" was a by-eye comparison of two
// dumps. memoryVersionDiff is the pure pairing rule; the render test walks the
// real keys into the diff view.
// ---------------------------------------------------------------------------
describe("memory version diff (M11)", () => {
	const entry = (version: number, content: string): MemoryHistoryEntry => ({
		id: version,
		tier: "project",
		version,
		content,
		changed_by: "autodream",
		note: null,
		created_at: Date.now() - version * 1000,
	});

	test("pairs by VERSION NUMBER, not by neighbouring slot (the API is newest-first)", () => {
		// Deliberately scrambled: a slot-based predecessor would diff v7 against v3.
		const entries = [entry(7, "a\nb\nc"), entry(3, "old"), entry(5, "a\nb"), entry(1, "first")];
		const d = memoryVersionDiff(entries, 7);
		expect(d!.prevVersion).toBe(5);
		// pi's generateDiffString prefixes each hunk line with its line number, so
		// the added line reads "+3 c" — marker first, then the number, then text.
		expect(d!.text).toContain("+3 c");
		expect(d!.text).not.toContain("old");
		expect(memoryVersionDiff(entries, 5)!.prevVersion).toBe(3);
	});

	test("the lowest version has NO predecessor (never diffed against an empty string)", () => {
		const entries = [entry(7, "x\ny"), entry(1, "first")];
		expect(memoryVersionDiff(entries, 1)!.prevVersion).toBeNull();
		// The v1 diff against itself is empty — the view renders the whole block
		// instead, and says so. An empty-string predecessor would print every line
		// as an addition, which is a lie about a consolidation that edited it.
		expect(memoryVersionDiff(entries, 1)!.text).toBe("");
	});

	test("a missing version returns null rather than a diff against nothing", () => {
		expect(memoryVersionDiff([entry(2, "b")], 9)).toBeNull();
	});

	test("enter on a version row walks into the diff pane", async () => {
		app.setScreen("memory");
		await waitFor(() => store.snapshot<MemoryResponse>("memory").data != null, 2000, "memory data");
		app.handleInput("\r"); // open the first tier → detail (content sub-mode)
		// The tier's history is an async drill-in fetch, and the "version history"
		// heading prints while it is still loading — poll for an actual row (the
		// mock serves v5/v4/v3 newest-first) before driving the keys.
		let pane = plain(app.render(120));
		for (let attempt = 0; attempt < 40 && !pane.includes("v5"); attempt++) {
			await Bun.sleep(25);
			pane = plain(app.render(120));
		}
		expect(pane, "the version rows arrived").toContain("v5");
		app.handleInput("\t"); // content → version history rows
		app.handleInput("\r"); // enter on the selected row → its diff
		const diff = plain(app.render(120));
		expect(diff, "the diff pane names the version and its predecessor").toContain("v5 vs v4");
		expect(diff, "the changed text is on screen, both sides").toContain("policy memory v5");
		expect(diff).toContain("policy memory v4");
		expect(diff, "the +N/−M tally line renders").toContain("+2 / −2");
		app.handleInput("\x1b"); // esc → back to the rows, not out to the tier list
		expect(plain(app.render(120))).toContain("version history");
	});
});

describe("routines screen (v2 interactions)", () => {
	test("detail shows the full spec — kind, timezone, misfire, streak", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		app.handleInput("\r"); // enter on the first routine → detail
		await Bun.sleep(150); // the runs fetch is drill-in async
		const pane = plain(app.render(120));
		expect(pane).toContain("routine · nightly repo health check");
		expect(pane).toContain("timezone");
		expect(pane).toContain("America/New_York");
		expect(pane).toContain("catch-up");
		expect(pane).toContain("last 10:");
		app.handleInput("\x1b"); // back
	});

	test("s skips the next occurrence (POST /skip)", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		app.handleInput("s");
		await waitFor(() => mock.calls.automationsSkipped.length === 1, 2000, "POST /api/automations/:id/skip executed");
		const pane = plain(app.render(120));
		expect(pane).toContain("skipped");
	});

	test("S snoozes by typed minutes (POST /snooze)", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		app.handleInput("S"); // opens the snooze input
		let pane = plain(app.render(120));
		expect(pane).toContain("snooze next occurrence");
		for (const ch of "15") app.handleInput(ch);
		app.handleInput("\r");
		await waitFor(
			() => mock.calls.automationsSnoozed.some((x) => x.minutes === 15),
			2000,
			"POST /api/automations/:id/snooze executed with minutes=15",
		);
		pane = plain(app.render(120));
		expect(pane).toContain("snoozed");
	});

	test("e opens the edit flow; a schedule edit PATCHes the new kind", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		app.handleInput("e"); // field picker
		let pane = plain(app.render(120));
		expect(pane).toContain("edit routine");
		app.handleInput("j"); // → prompt
		app.handleInput("j"); // → schedule
		app.handleInput("\r"); // open the schedule input
		pane = plain(app.render(120));
		expect(pane).toContain("edit · schedule");
		for (const ch of "every 2w at 08:30") app.handleInput(ch);
		app.handleInput("\r"); // apply
		await waitFor(
			() => mock.calls.automationsPatched.some((x) => x.id === "auto-e2e-1"),
			2000,
			"PATCH /api/automations/:id executed",
		);
		pane = plain(app.render(120));
		expect(pane).toContain("routine updated");
	});

	test("the wizard creates an every-routine with timezone + misfire + retries", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		app.handleInput("a"); // new routine wizard
		let pane = plain(app.render(120));
		expect(pane).toContain("new routine · title");
		for (const ch of "bi-weekly dependency audit") app.handleInput(ch);
		app.handleInput("\r");
		for (const ch of "Audit dependencies and report drift.") app.handleInput(ch);
		app.handleInput("\r");
		for (const ch of "every 2w at 09:00") app.handleInput(ch);
		app.handleInput("\r");
		for (const ch of "Europe/Berlin") app.handleInput(ch);
		app.handleInput("\r");
		app.handleInput("j"); // misfire → catch-up
		app.handleInput("\r");
		app.handleInput("\r"); // mode read-only
		app.handleInput("\r"); // model empty
		pane = plain(app.render(120));
		expect(pane).toContain("new routine · retries");
		for (const ch of "3 900") app.handleInput(ch);
		app.handleInput("\r");
		pane = plain(app.render(120));
		expect(pane).toContain("new routine · confirm");
		expect(pane).toContain("every 2w at 09:00");
		expect(pane).toContain("Europe/Berlin");
		expect(pane).toContain("catch-up");
		expect(pane, "the parsed retry policy is on the confirm card").toContain("3 on failure · first backoff 900s");
		app.handleInput("y"); // create
		await waitFor(() => mock.calls.automationsCreated >= 1, 2000, "POST /api/automations executed");
		const body = mock.calls.automationsCreateBodies.at(-1);
		expect(body?.retryMax, "the retry policy rode the create body").toBe(3);
		expect(body?.retryBackoffSecs, "the custom first backoff rode the create body").toBe(900);
		pane = plain(app.render(120));
		expect(pane).toContain("routine created");
	});

	test("an invalid retry spec is refused at its step, not at confirm", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b");
		app.handleInput("a");
		for (const ch of "retry spec guard") app.handleInput(ch);
		app.handleInput("\r");
		for (const ch of "Try, then fail, then retry.") app.handleInput(ch);
		app.handleInput("\r");
		for (const ch of "+90m") app.handleInput(ch);
		app.handleInput("\r");
		app.handleInput("\r"); // timezone empty
		app.handleInput("\r"); // misfire skip
		app.handleInput("\r"); // mode read-only
		app.handleInput("\r"); // model empty
		for (const ch of "99") app.handleInput(ch); // retry-max over the 0..10 cap
		app.handleInput("\r");
		const pane = plain(app.render(120));
		expect(pane).toContain("retry-max is 0..10");
		expect(pane).toContain("new routine · retries"); // still on the step
		app.handleInput("\x1b"); // cancel out
	});

	test("detail shows the retry policy, the armed chain, and retry runs", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		app.handleInput("\r"); // enter on the first routine → detail
		await Bun.sleep(150); // the runs fetch is drill-in async
		let pane = plain(app.render(120));
		if (!pane.includes("routine · nightly repo health check")) {
			// a previous test's created routine sorts first — step to the fixture row
			app.handleInput("\x1b");
			app.handleInput("j");
			app.handleInput("\r");
			await Bun.sleep(150);
			pane = plain(app.render(120));
		}
		expect(pane).toContain("routine · nightly repo health check");
		expect(pane).toContain("3 on failure (first 600s, doubling, cap 1h)");
		expect(pane, "the armed chain gets its own pending line").toContain("retry attempt 3 in ");
		expect(pane, "the pending line names the run it recovers").toContain("arun-e2e-0r");
		// the runs section sits below the 24-line fold — scroll to it
		for (let i = 0; i < 8; i++) app.handleInput("j");
		pane = plain(app.render(120));
		expect(pane, "a retry run renders with its attempt number").toContain("retry #2");
		app.handleInput("\x1b"); // back
	});

	test("the routines list marks a routine with an armed retry", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		const pane = plain(app.render(120));
		expect(pane, "the armed chain is visible from the index").toContain("⟳ retry in ");
	});

	test("e edits the retry policy — preloaded, patchable, clearable", async () => {
		app.setScreen("automations");
		app.handleInput("\x1b"); // close any overlay a previous test left open
		app.handleInput("e"); // field picker on the selected routine
		let pane = plain(app.render(120));
		if (!pane.includes("edit routine · nightly repo health check")) {
			// a previous test's created routine sorts first — step to the fixture row
			app.handleInput("\x1b");
			app.handleInput("j");
			app.handleInput("e");
			pane = plain(app.render(120));
		}
		expect(pane).toContain("edit routine · nightly repo health check");
		for (let i = 0; i < 9; i++) app.handleInput("j"); // → retries (the 10th field)
		app.handleInput("\r"); // open the retries input
		pane = plain(app.render(120));
		expect(pane).toContain("edit · retries");
		expect(pane, "the current policy is preloaded as max backoff").toContain("3 600");
		// clear it: the input cursor sits after the preloaded text — backspace it all away
		for (let i = 0; i < 5; i++) app.handleInput("\x7f");
		app.handleInput("\r"); // apply the clear
		await waitFor(
			() => mock.calls.automationsPatched.some((x) => x.id === "auto-e2e-1" && x.body?.retryMax === null),
			2000,
			"PATCH retryMax:null (the deliberate clear) executed",
		);
		pane = plain(app.render(120));
		expect(pane).toContain("routine updated");
	});
});
