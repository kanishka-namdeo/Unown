// install-meta-readers.test.ts — one record, three readers, one acceptance rule.
//
// ~/.unown/install.json decides whether an installer may touch the machine (a
// mode change needs --force) and how `unown update` finds its own channel. It
// is read by three independent implementations — install-layout.ts (the
// runtime), public/install.sh (POSIX sh, where no bun is available) and
// public/install.ps1 (Windows) — and those readers had drifted: the shell
// readers accepted any schema and the runtime rejected the legacy `source`
// spelling both shells folded. That divergence is not cosmetic — a record one
// reader trusts and another refuses is an install that updates on one path and
// reports "cannot determine how this unown was installed" on another.
//
// So this file drives the SHIPPED artifacts, not a re-implementation of their
// logic. Each installer grew a read-only --inspect / -Inspect entry point
// precisely so the agreement could be tested instead of argued.
//
// Hermetic: a per-case tmp UNOWN_HOME; UNOWN_RELEASES_BASE_URL aimed at a dead
// port (the suite-wide convention from _env.ts) so no case can reach the
// network; UNOWN_INSTALL_ROOT / UNOWN_BIN_DIR aimed at the same tmpdir so a
// case that gets past the guard still cannot touch the real install.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InstallMetadata, readInstallMetadata, writeInstallMetadata } from "../src/install-layout.ts";

const INSTALL_SH = join(import.meta.dir, "..", "..", "..", "..", "public", "install.sh");
const INSTALL_PS1 = join(import.meta.dir, "..", "..", "..", "..", "public", "install.ps1");

let TMP = "";
function fresh(): string {
	TMP ||= mkdtempSync(join(tmpdir(), "unown-meta-readers-"));
	const d = join(TMP, `c-${Math.random().toString(36).slice(2)}`);
	mkdirSync(d, { recursive: true });
	return d;
}

afterAll(() => {
	if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function canRun(cmd: string, args: string[]): boolean {
	try {
		return spawnSync(cmd, args, { encoding: "utf8", timeout: 30_000 }).status === 0;
	} catch {
		return false;
	}
}

const HAS_SH = canRun("sh", ["-c", "exit 0"]);
const HAS_PS = canRun("powershell.exe", ["-NoProfile", "-Command", "exit 0"]);

function envFor(home: string, shell: "sh" | "ps"): NodeJS.ProcessEnv {
	// Git Bash maps C:\Users\… to /c/Users\…; install.sh's own leading-slash test
	// treats a Windows-shaped UNOWN_HOME as relative, so the sh probes must be
	// handed the POSIX spelling of the very same directory.
	const h =
		shell === "sh"
			? home.replace(/\\/g, "/").replace(/^([A-Za-z]):\//, (_m, d: string) => `/${d.toLowerCase()}/`)
			: home;
	return {
		...process.env,
		UNOWN_HOME: h,
		UNOWN_RELEASES_BASE_URL: "http://127.0.0.1:9",
		UNOWN_INSTALL_ROOT: join(h, "install-root"),
		UNOWN_BIN_DIR: join(h, "bin-dir"),
	};
}

/** PowerShell wraps a long message across console lines, so substring asserts on
 *  its output compare against collapsed whitespace. */
function flat(text: string): string {
	return text.replace(/\s+/g, " ");
}

/** The record through the shipped POSIX installer's own reader. */
function shInspect(home: string): { text: string; status: number | null } {
	const run = spawnSync("sh", [INSTALL_SH, "--inspect"], {
		encoding: "utf8",
		timeout: 60_000,
		env: envFor(home, "sh"),
	});
	return { text: `${run.stdout ?? ""}${run.stderr ?? ""}`, status: run.status };
}

/** The record through the shipped Windows installer's own reader. */
function psInspect(home: string): { text: string; status: number | null } {
	const run = spawnSync(
		"powershell.exe",
		["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1, "-Inspect"],
		{
			encoding: "utf8",
			timeout: 120_000,
			env: envFor(home, "ps"),
		},
	);
	return { text: `${run.stdout ?? ""}${run.stderr ?? ""}`, status: run.status };
}

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

/** A record written as raw bytes (what the other two installers emit). */
function rawRecord(fields: Record<string, unknown>): string {
	return JSON.stringify(fields, null, 2);
}

describe("sh --inspect agrees with the runtime reader", () => {
	test.skipIf(!HAS_SH)("reads a record the runtime wrote", () => {
		const home = fresh();
		const meta = sample({ previousVersion: "0.0.15" });
		writeInstallMetadata(home, meta);
		const { text, status } = shInspect(home);
		expect(text).toContain("status: ok");
		expect(text).toContain("mode: binary");
		expect(text).toContain("version: 0.0.16");
		expect(text).toContain("previousVersion: 0.0.15");
		expect(text).toContain("shim: /home/ann/.local/bin/unown");
		expect(status).toBe(0);
		// The same bytes, the same answer, through the runtime reader.
		expect(readInstallMetadata(home)).toEqual(meta);
	});

	test.skipIf(!HAS_SH)("a drive-letter colon is not the key/value separator", () => {
		// The shape PowerShell's ConvertTo-Json writes, which the POSIX reader
		// may have to parse on a mixed machine (WSL, or a shared UNOWN_HOME).
		const home = fresh();
		writeInstallMetadata(
			home,
			sample({
				platform: "win32-x64",
				root: "C:\\Users\\ann smith\\AppData\\Local\\unown",
				bin: "C:\\Users\\ann smith\\AppData\\Local\\unown\\versions\\0.0.16\\unown.exe",
				shim: "C:\\Users\\ann smith\\.local\\bin\\unown.cmd",
			}),
		);
		const { text } = shInspect(home);
		expect(text).toContain("status: ok");
		expect(text).toContain("ann smith");
		expect(text).not.toContain("shim: none");
	});

	test.skipIf(!HAS_SH)("minified and split-line records both read", () => {
		const bodies = [
			'{"schema":1,"mode":"checkout","version":"0.0.9","root":"/r","bin":"/r/b","shim":"/s","installedAt":"2026-10-25T09:00:00.000Z"}',
			'{\n  "schema":\n    1,\n  "mode":\n    "checkout",\n  "version": "0.0.9",\n  "root": "/r",\n  "bin": "/r/b",\n  "shim": "/s",\n  "installedAt": "x"\n}',
		];
		for (const body of bodies) {
			const home = fresh();
			writeFileSync(join(home, "install.json"), body, "utf8");
			const { text } = shInspect(home);
			expect(text).toContain("status: ok");
			expect(text).toContain("mode: checkout");
			expect(text).toContain("version: 0.0.9");
		}
	});

	test.skipIf(!HAS_SH)("the legacy `source` spelling resolves as checkout for both readers", () => {
		const home = fresh();
		writeFileSync(join(home, "install.json"), rawRecord({ ...sample(), mode: "source" }), "utf8");
		expect(shInspect(home).text).toContain("mode: checkout");
		// The runtime reader used to return null here — an old install then had
		// no mode for `unown update` to act on.
		expect(readInstallMetadata(home)?.mode).toBe("checkout");
	});

	test.skipIf(!HAS_SH)("a foreign schema is refused by both readers", () => {
		const home = fresh();
		writeFileSync(join(home, "install.json"), rawRecord({ ...sample(), schema: 2 }), "utf8");
		const { text, status } = shInspect(home);
		expect(text).toContain("status: foreign");
		expect(status).toBe(2);
		expect(readInstallMetadata(home)).toBeNull();
	});

	test.skipIf(!HAS_SH)("garbage is refused, and no record is a quiet answer", () => {
		const junk = fresh();
		writeFileSync(join(junk, "install.json"), "not json at all\n", "utf8");
		expect(shInspect(junk).text).toContain("status: foreign");

		const empty = fresh();
		const { text, status } = shInspect(empty);
		expect(text).toContain("status: none");
		expect(status).toBe(0);
	});
});

describe("powershell -Inspect agrees with the runtime reader", () => {
	test.skipIf(!HAS_PS)("reads a record the runtime wrote", () => {
		const home = fresh();
		writeInstallMetadata(home, sample({ previousVersion: "0.0.15", platform: "win32-x64" }));
		const { text, status } = psInspect(home);
		expect(text).toContain("status: ok");
		expect(text).toContain("mode: binary");
		expect(text).toContain("version: 0.0.16");
		expect(text).toContain("previousVersion: 0.0.15");
		expect(status).toBe(0);
	});

	test.skipIf(!HAS_PS)("refuses a foreign schema, folds the legacy spelling", () => {
		const foreign = fresh();
		writeFileSync(join(foreign, "install.json"), rawRecord({ ...sample(), schema: 2 }), "utf8");
		const foreignRun = psInspect(foreign);
		expect(foreignRun.text).toContain("status: foreign");
		expect(foreignRun.status).toBe(2);

		const legacy = fresh();
		writeFileSync(join(legacy, "install.json"), rawRecord({ ...sample(), mode: "source" }), "utf8");
		expect(psInspect(legacy).text).toContain("mode: checkout");
	});

	test.skipIf(!HAS_PS)("no record is a quiet answer", () => {
		const { text, status } = psInspect(fresh());
		expect(text).toContain("status: none");
		expect(status).toBe(0);
	});
});

describe("the mode-change guard reads through the shared loader", () => {
	// check_install_meta now depends on load_install_meta having filled the
	// globals; a refactor that forgot the call leaves every install skipping the
	// guard. That is only observable on the shipped artifact, so it is tested
	// there — with the release base on a dead port, a case that got past the
	// guard fails harmlessly instead of installing anything.
	test.skipIf(!HAS_SH)("sh refuses the other mode over a recorded checkout", () => {
		const home = fresh();
		writeInstallMetadata(home, sample({ mode: "checkout", root: "/srv/Unown", bin: "/srv/Unown/bin/unown" }));
		const run = spawnSync("sh", [INSTALL_SH], { encoding: "utf8", timeout: 60_000, env: envFor(home, "sh") });
		expect(flat(`${run.stdout ?? ""}${run.stderr ?? ""}`)).toContain("refusing to install the binary mode over it");
		expect(run.status).not.toBe(0);
	});

	test.skipIf(!HAS_SH)("sh does not refuse the recorded mode", () => {
		const home = fresh();
		writeInstallMetadata(home, sample());
		const run = spawnSync("sh", [INSTALL_SH], { encoding: "utf8", timeout: 60_000, env: envFor(home, "sh") });
		expect(flat(`${run.stdout ?? ""}${run.stderr ?? ""}`)).not.toContain("refusing to install");
	});

	test.skipIf(!HAS_PS)("powershell refuses the other mode over a recorded checkout", () => {
		const home = fresh();
		writeInstallMetadata(
			home,
			sample({ mode: "checkout", root: "C:\\srv\\Unown", bin: "C:\\srv\\Unown\\bin\\unown" }),
		);
		const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1], {
			encoding: "utf8",
			timeout: 120_000,
			env: envFor(home, "ps"),
		});
		expect(flat(`${run.stdout ?? ""}${run.stderr ?? ""}`)).toContain("refusing to install the binary mode over it");
	});
});
