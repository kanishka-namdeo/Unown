// sessions-completion.test.ts — the 2026-10-25 completion round for the
// session lifecycle (the reverse-engineering sweep across Claude Code
// `claude --resume` + /export, Codex `codex resume|delete|rename` + exec
// --json, Gemini's /resume picker + x-delete, OpenCode/Crush session
// lifecycle): every competitor ships the bare `--resume` picker and a
// delete/rename lane; unown could only ever create sessions.
//
// Pins, in order:
//   1. parseArgs: bare `--resume` resolves to the __resume_picker__ sentinel
//      (TUI + print lanes), a query still resolves to __resume__:<q>, and the
//      --session/-c conflicts exit 2.
//   2. appendSessionInfoEntry (sessions.ts) — the offline rename primitive:
//      sanitized name, unique id, parentId = leaf, and the newest-wins
//      discovery that --resume/<name> + list ride on.
//   3. runSessionsCommand delete — by id, by name, ambiguity refuses with
//      candidates, the live-session guard refuses fresh mtimes, --force wins.
//   4. runSessionsCommand rename — by id and by name; the new name resolves
//      through resolveResumeQuery immediately (the whole point of the lane).
//   5. list surfaces the name column (a titled session is addressable).
//   6. export --format html — pi's own /export renderer over the offline
//      file, with the default redaction pass re-writing the page.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.ts";
import { resolveResumeQuery } from "../src/resume.ts";
import { appendSessionInfoEntry, listAllSessions } from "../src/sessions.ts";
import { runSessionsCommand } from "../src/sessions-cli.ts";
import { TEST_TMP } from "./_env.ts";

const LOADED: string[] = [];
function freshDir(prefix = "sc-"): string {
	const d = mkdtempSync(join(TEST_TMP, prefix));
	LOADED.push(d);
	return d;
}
afterAll(() => {
	for (const d of LOADED) rmSync(d, { recursive: true, force: true });
});

/** One session .jsonl fixture in a REAL session-store layout. JSON.stringify
 *  everywhere (raw interpolation breaks on Windows path backslashes — the
 *  v0.0.10 release-matrix lesson resume.test.ts documents). */
function writeSessionFixture(
	dir: string,
	opts: { id: string; cwd?: string; name?: string; ageMs?: number; extraLines?: Record<string, unknown>[] },
): string {
	const file = join(dir, `2026-10-25T00-00-00-000Z_${opts.id}.jsonl`);
	const header: Record<string, unknown> = {
		type: "session",
		version: 3,
		id: opts.id,
		timestamp: "2026-10-25T00:00:00.000Z",
	};
	if (opts.cwd) header.cwd = opts.cwd;
	const lines: string[] = [JSON.stringify(header)];
	if (opts.name) {
		lines.push(
			JSON.stringify({
				type: "session_info",
				id: `n-${opts.id}`,
				parentId: null,
				timestamp: "2026-10-25T00:00:01.000Z",
				name: opts.name,
			}),
		);
	}
	lines.push(
		JSON.stringify({
			type: "message",
			id: `m-${opts.id}`,
			parentId: null,
			timestamp: "2026-10-25T00:00:02.000Z",
			message: { role: "user", content: "hello" },
		}),
	);
	for (const extra of opts.extraLines ?? []) lines.push(JSON.stringify(extra));
	writeFileSync(file, `${lines.join("\n")}\n`);
	const t = new Date(Date.now() - (opts.ageMs ?? 600_000));
	utimesSync(file, t, t); // settled by default: the live-guard's "fresh" band is <30s
	return file;
}

/** UNOWN_HOME redirect: runSessionsCommand resolves the user store through
 *  resolveUserSessionDir() -> resolveUnownHome() (env read at CALL time), so
 *  pointing UNOWN_HOME at a temp dir makes the CLI's user lane hermetic.
 *  AWAIT-CORRECT: restores only after fn's promise settles — a sync `finally`
 *  fires when the async fn first suspends, restoring the env UNDER the still-
 *  running command (the exact bug this helper's first draft had). */
async function withUnownHome(home: string, fn: () => Promise<void> | void): Promise<void> {
	const saved = process.env.UNOWN_HOME;
	process.env.UNOWN_HOME = home;
	try {
		await fn();
	} finally {
		if (saved === undefined) delete process.env.UNOWN_HOME;
		else process.env.UNOWN_HOME = saved;
	}
}

// ---------------------------------------------------------------------------
// 1. parseArgs — the bare --resume sentinel
// ---------------------------------------------------------------------------

describe("parseArgs: bare --resume (the launch picker lane)", () => {
	test("TUI lane: bare --resume carries the __resume_picker__ sentinel", () => {
		const origIn = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		const origOut = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
		try {
			const args = parseArgs(["--resume"]);
			expect(args.command).toBe("tui");
			expect(args.sessionFile).toBe("__resume_picker__");
			// The trailing flag does not become a prompt.
			expect(args.prompt).toBe("");
		} finally {
			if (origIn) Object.defineProperty(process.stdin, "isTTY", origIn);
			else delete (process.stdin as any).isTTY;
			if (origOut) Object.defineProperty(process.stdout, "isTTY", origOut);
			else delete (process.stdout as any).isTTY;
		}
	});

	test("print lane: the sentinel is carried too (resolveLaunchSession refuses it with exit 2 off-TTY)", () => {
		const args = parseArgs(["--resume", "-p", "hello"]);
		expect(args.command).toBe("print");
		expect(args.sessionFile).toBe("__resume_picker__");
		expect(args.prompt).toBe("hello");
	});

	test("--resume <query> keeps the existing __resume__:<query> spelling", () => {
		const args = parseArgs(["--resume", "fix-the-bug", "-p", "hello"]);
		expect(args.sessionFile).toBe("__resume__:fix-the-bug");
	});

	test("--session + bare --resume still exits 2 (both pick the session file)", () => {
		const origExit = process.exit;
		let exitCode: number | undefined;
		(process as any).exit = (c?: number) => {
			exitCode = c ?? 0;
			throw new Error("__exit__");
		};
		try {
			expect(() => parseArgs(["--session", "/tmp/x.jsonl", "--resume"])).toThrow("__exit__");
		} finally {
			(process as any).exit = origExit;
		}
		expect(exitCode).toBe(2);
	});

	test("-c + bare --resume still exits 2 (mutually exclusive)", () => {
		const origExit = process.exit;
		let exitCode: number | undefined;
		(process as any).exit = (c?: number) => {
			exitCode = c ?? 0;
			throw new Error("__exit__");
		};
		try {
			expect(() => parseArgs(["-c", "--resume"])).toThrow("__exit__");
		} finally {
			(process as any).exit = origExit;
		}
		expect(exitCode).toBe(2);
	});

	test("--resume followed by a single-dash flag is the picker, not a session named '-p' (the adjacency fix)", () => {
		// The 2026-10-25 fix: only "--" was excluded, so `--resume -p "hello"`
		// silently looked for a session named "-p".
		const args = parseArgs(["--resume", "-p", "hello"]);
		expect(args.sessionFile).toBe("__resume_picker__");
		expect(args.prompt).toBe("hello");
	});
});

// ---------------------------------------------------------------------------
// 2. appendSessionInfoEntry — the offline rename primitive
// ---------------------------------------------------------------------------

describe("appendSessionInfoEntry (sessions rename, offline)", () => {
	test("appends a session_info the resume lane resolves, with parentId = leaf", () => {
		const dir = freshDir("sc-rename-");
		const store = join(dir, ".unown", "sessions"); // the project import lane resolveResumeQuery scans
		mkdirSync(store, { recursive: true });
		const file = writeSessionFixture(store, { id: "11111111-1111-4111-8111-111111111111", cwd: dir });
		const appended = appendSessionInfoEntry(file, "the-refactor-session");
		expect(appended.name).toBe("the-refactor-session");
		const lines = readFileSync(file, "utf8").trim().split("\n");
		const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
		expect(last.type).toBe("session_info");
		expect(last.name).toBe("the-refactor-session");
		expect(last.parentId).toBe("m-11111111-1111-4111-8111-111111111111"); // the leaf message entry
		expect(last.id).not.toBe(`n-11111111-1111-4111-8111-111111111111`); // fresh, collision-free id
		// The newest-wins discovery picks it up immediately.
		const res = resolveResumeQuery(dir, dir, "the-refactor-session");
		expect(res.ok).toBeTrue();
	});

	test("newlines are sanitized out of the name; empty names are refused", () => {
		const dir = freshDir("sc-rename2-");
		const file = writeSessionFixture(dir, { id: "22222222-2222-4222-8222-222222222222", cwd: dir });
		const appended = appendSessionInfoEntry(file, "multi\r\nline name");
		expect(appended.name).toBe("multi line name");
		expect(() => appendSessionInfoEntry(file, "   ")).toThrow();
	});

	test("a non-session file is refused with the actionable error", () => {
		const dir = freshDir("sc-rename3-");
		const notSession = join(dir, "not-a-session.jsonl");
		writeFileSync(notSession, `${JSON.stringify({ type: "message", id: "x" })}\n`);
		expect(() => appendSessionInfoEntry(notSession, "name")).toThrow(/not a session file/);
	});
});

// ---------------------------------------------------------------------------
// 3 + 4. runSessionsCommand — delete / rename (both stores, name lane)
// ---------------------------------------------------------------------------

describe("runSessionsCommand delete/rename", () => {
	test("delete by id removes the file (user store); unknown ids exit 1", async () => {
		const home = freshDir("sc-del-home-");
		const store = join(home, "agent", "sessions");
		mkdirSync(store, { recursive: true });
		const file = writeSessionFixture(store, { id: "aaaaaaaa-0000-4000-8000-000000000001", cwd: "/work/proj" });
		await withUnownHome(home, async () => {
			const code = await runSessionsCommand(["delete", "aaaaaaaa-0000"]);
			expect(code).toBe(0);
			expect(existsSync(file)).toBeFalse();
			const missing = await runSessionsCommand(["delete", "aaaaaaaa-0000"]);
			expect(missing).toBe(1);
		});
	});

	test("delete by name; ambiguity refuses and lists candidates", async () => {
		const home = freshDir("sc-del-name-");
		const store = join(home, "agent", "sessions");
		mkdirSync(store, { recursive: true });
		const f1 = writeSessionFixture(store, {
			id: "bbbbbbbb-0000-4000-8000-000000000001",
			cwd: "/work/proj",
			name: "shared-name",
			ageMs: 700_000,
		});
		const f2 = writeSessionFixture(store, {
			id: "bbbbbbbb-0000-4000-8000-000000000002",
			cwd: "/work/proj",
			name: "shared-name",
			ageMs: 800_000,
		});
		await withUnownHome(home, async () => {
			const refused = await runSessionsCommand(["delete", "shared-name"]);
			expect(refused).toBe(1); // ambiguous — candidates listed, nothing deleted
			expect(existsSync(f1)).toBeTrue();
			expect(existsSync(f2)).toBeTrue();
			const ok = await runSessionsCommand(["delete", "bbbbbbbb-0000-4000-8000-000000000002"]);
			expect(ok).toBe(0);
			expect(existsSync(f2)).toBeFalse();
		});
	});

	test("the live-session guard refuses a fresh mtime without --force; --force deletes", async () => {
		const home = freshDir("sc-del-live-");
		const store = join(home, "agent", "sessions");
		mkdirSync(store, { recursive: true });
		const file = writeSessionFixture(store, {
			id: "cccccccc-0000-4000-8000-000000000003",
			cwd: "/work/proj",
			ageMs: 0,
		}); // just written
		await withUnownHome(home, async () => {
			const refused = await runSessionsCommand(["delete", "cccccccc-0000"]);
			expect(refused).toBe(1);
			expect(existsSync(file)).toBeTrue();
			const forced = await runSessionsCommand(["delete", "cccccccc-0000", "--force"]);
			expect(forced).toBe(0);
			expect(existsSync(file)).toBeFalse();
		});
	});

	test("rename by id makes the session addressable by the new name", async () => {
		const home = freshDir("sc-rn-");
		const store = join(home, "agent", "sessions");
		mkdirSync(store, { recursive: true });
		const file = writeSessionFixture(store, { id: "dddddddd-0000-4000-8000-000000000004", cwd: "/work/proj" });
		await withUnownHome(home, async () => {
			const code = await runSessionsCommand(["rename", "dddddddd-0000", "the-debugging-run"]);
			expect(code).toBe(0);
			// The new name resolves through the same lane --resume uses.
			const res = resolveResumeQuery("/work/proj", join(home, "agent"), "the-debugging-run");
			expect(res.ok).toBeTrue();
			if (res.ok) expect(res.file).toBe(file);
		});
	});

	test("rename with no new name exits 1 with usage", async () => {
		const home = freshDir("sc-rn2-");
		const store = join(home, "agent", "sessions");
		mkdirSync(store, { recursive: true });
		writeSessionFixture(store, { id: "eeeeeeee-0000-4000-8000-000000000005", cwd: "/work/proj" });
		await withUnownHome(home, async () => {
			expect(await runSessionsCommand(["rename", "eeeeeeee-0000"])).toBe(1);
		});
	});

	test("delete/rename resolve in the project import store too (both-stores rule)", async () => {
		const proj = freshDir("sc-proj-");
		mkdirSync(join(proj, ".unown", "sessions"), { recursive: true });
		const file = writeSessionFixture(join(proj, ".unown", "sessions"), {
			id: "ffffffff-0000-4000-8000-000000000006",
			cwd: proj,
			name: "imported-work",
		});
		const cwdSave = process.cwd();
		process.chdir(proj);
		try {
			await withUnownHome(join(proj, "home"), async () => {
				// rename first so delete-by-name has a second target shape
				expect(await runSessionsCommand(["rename", "imported-work", "imported-work-v2"])).toBe(0);
				// The rename just modified the file — settle it past the live-guard
				// band (deleting a session a running process JUST wrote to is
				// exactly what the guard exists to refuse).
				const settled = new Date(Date.now() - 60_000);
				utimesSync(file, settled, settled);
				expect(await runSessionsCommand(["delete", "imported-work-v2"])).toBe(0);
				expect(existsSync(file)).toBeFalse();
			});
		} finally {
			process.chdir(cwdSave);
		}
	});
});

// ---------------------------------------------------------------------------
// 5. list — the name column
// ---------------------------------------------------------------------------

describe("sessions list: the name column", () => {
	test("a titled session shows its name; listAllSessions carries it", async () => {
		const home = freshDir("sc-list-home-");
		const store = join(home, "agent", "sessions");
		mkdirSync(store, { recursive: true });
		const proj = freshDir("sc-list-proj-");
		writeSessionFixture(store, { id: "abababab-0000-4000-8000-000000000007", cwd: proj, name: "titled-run" });
		const summaries = listAllSessions({ cwd: proj, userSessionDir: store });
		expect(summaries.length).toBe(1);
		expect(summaries[0].name).toBe("titled-run");
		// And the CLI output line carries it.
		const cwdSave = process.cwd();
		process.chdir(proj);
		let out = "";
		const saveWrite = process.stdout.write.bind(process.stdout);
		(process.stdout as any).write = (chunk: any) => {
			out += String(chunk);
			return true;
		};
		try {
			await withUnownHome(home, async () => {
				expect(await runSessionsCommand(["list"])).toBe(0);
			});
		} finally {
			(process.stdout as any).write = saveWrite;
			process.chdir(cwdSave);
		}
		expect(out).toContain("titled-run");
		expect(out).toContain('"titled-run"');
	});
});

// ---------------------------------------------------------------------------
// 6. export --format html — pi's renderer + the redaction post-pass
// ---------------------------------------------------------------------------

describe("sessions export --format html", () => {
	test("renders the page next to the .jsonl and redacts secrets by default", async () => {
		const proj = freshDir("sc-html-");
		mkdirSync(join(proj, ".unown", "sessions"), { recursive: true });
		const secret = "sk-proj-abcdefghijklmnopqrstuv0123456789abcd";
		writeSessionFixture(join(proj, ".unown", "sessions"), {
			id: "cdcdcdcd-0000-4000-8000-000000000008",
			cwd: proj,
			extraLines: [
				{
					type: "message",
					id: "m-secret",
					parentId: null,
					timestamp: "2026-10-25T00:00:03.000Z",
					message: { role: "assistant", content: [{ type: "text", text: `use the key ${secret} carefully` }] },
				},
			],
		});
		const cwdSave = process.cwd();
		process.chdir(proj);
		try {
			await withUnownHome(join(proj, "home"), async () => {
				const code = await runSessionsCommand(["export", "cdcdcdcd-0000", "--format", "html"]);
				expect(code).toBe(0);
			});
			const htmlPath = join(proj, ".unown", "sessions", "export-cdcdcdcd.html"); // the md/json lanes' default dir
			expect(existsSync(htmlPath)).toBeTrue();
			const html = readFileSync(htmlPath, "utf8");
			expect(html).toContain("<html"); // pi's themed page
			expect(html).not.toContain(secret); // redacted away before rendering
			// pi's page embeds the session as base64 client-side JSON (template:
			// <script id="session-data">{{SESSION_DATA}}</script>) — the marker
			// lives INSIDE the encoded blob, so the assertion decodes it.
			const m = /<script id="session-data" type="application\/json">([^<]+)<\/script>/.exec(html);
			const decoded = m ? Buffer.from(m[1], "base64").toString("utf8") : "";
			expect(decoded).toContain("[REDACTED:");
			// --raw keeps the secret verbatim (a lossless self-transfer).
			await withUnownHome(join(proj, "home"), async () => {
				expect(
					await runSessionsCommand([
						"export",
						"cdcdcdcd-0000",
						"--format",
						"html",
						"--raw",
						"--out",
						join(proj, "raw.html"),
					]),
				).toBe(0);
			});
			const rawHtml = readFileSync(join(proj, "raw.html"), "utf8");
			const rawMatch = /<script id="session-data" type="application\/json">([^<]+)<\/script>/.exec(rawHtml);
			const rawDecoded = rawMatch ? Buffer.from(rawMatch[1], "base64").toString("utf8") : "";
			expect(rawDecoded).toContain(secret);
		} finally {
			process.chdir(cwdSave);
		}
	});
});
