/**
 * bwrap.ts — OS-level sandbox (bubblewrap) for untrusted executions.
 *
 * Defense-in-depth beneath the TypeScript path jail: every command the
 * engine executes inside a sandbox (verify scripts, and — via the generated
 * shell wrapper — every agent bash-tool command) runs under bubblewrap:
 *
 *   - whole root filesystem read-only (child mounts /sys stay read-only,
 *     /proc and /dev are replaced with fresh instances)
 *   - /home, /run, /tmp, /var/tmp are private tmpfs — the engine's data,
 *     the repository (incl. .env) and ~/.unown are invisible
 *   - the sandbox workspace is bind-mounted at its REAL path (no path
 *     translation: engine and sandboxed process agree on paths)
 *   - network namespace killed (no egress, no bridge, no DNS)
 *   --unshare-ipc, --new-session, --cap-drop ALL, --die-with-parent
 *
 * Known residuals on this kernel (5.10 container): fresh procfs inside a
 * nested pid namespace is refused (EPERM), so there is no --unshare-pid;
 * host pids are listed in /proc but signals to them are refused by user-
 * namespace credentials (verified), and /sys is visible read-only. The
 * workspace bind creates its ancestor directory chain on the /home tmpfs —
 * those directory NAMES are visible, but their contents (repo, .env,
 * engine data) are not.
 *
 * Selection rationale (researched online, see worklog): bubblewrap is the
 * sandbox foundation of Flatpak (a decade of deployment), and is what both
 * Claude Code (Linux sandboxing) and OpenAI Codex's current Linux sandbox
 * build on. Landlock (the alternative) requires kernel >= 5.13 — this host
 * runs 5.10. microVM/gVisor/Kata options need KVM or a container runtime,
 * unavailable here.
 *
 * Environment knobs:
 *   UNOWN_OS_SANDBOX   0 disables the OS sandbox (default: enabled)
 *   UNOWN_SANDBOX_NET  1 keeps the network namespace shared (default: blocked)
 *   UNOWN_BWRAP        explicit path to the bwrap binary
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Resolve the bwrap binary: env override -> vendored copy -> system PATH.
 *  Linux-only by explicit gate: bubblewrap is a Linux ELF tool, and without
 *  the gate a Git-Bash /usr/bin/bwrap from a WSL mount could win on Windows
 *  by accident. Non-linux hosts always resolve null (-> TS path jail). */
export function resolveBwrapPath(): string | null {
	if (process.platform !== "linux") return null;
	const override = process.env.UNOWN_BWRAP;
	if (override && existsSync(override)) return override;
	const vendored = join(HERE, "..", "native", "bin", "bwrap");
	if (existsSync(vendored)) return vendored;
	for (const p of ["/usr/bin/bwrap", "/usr/local/bin/bwrap"]) {
		if (existsSync(p)) return p;
	}
	return null;
}

export function osSandboxConfigured(): boolean {
	return process.env.UNOWN_OS_SANDBOX !== "0";
}

export function netBlocked(): boolean {
	return process.env.UNOWN_SANDBOX_NET !== "1";
}

/** The validated bubblewrap profile (see scripts/bwrap_smoke.sh evidence). */
export function bwrapArgs(workspace: string, net = netBlocked()): string[] {
	const args: string[] = [
		"--ro-bind",
		"/",
		"/",
		"--proc",
		"/proc",
		"--dev",
		"/dev",
		"--tmpfs",
		"/home",
		"--tmpfs",
		"/run",
		"--tmpfs",
		"/tmp",
		"--tmpfs",
		"/var/tmp",
		"--bind",
		workspace,
		workspace,
		"--chdir",
		workspace,
		"--die-with-parent",
		"--new-session",
		"--cap-drop",
		"ALL",
		"--setenv",
		"HOME",
		"/tmp/home",
		"--setenv",
		"TMPDIR",
		"/tmp",
	];
	if (net) args.push("--unshare-net", "--unshare-ipc");
	return args;
}

/** Wrap a command argv with the sandbox profile; null when unavailable. */
export function wrapCommand(command: string[], workspace: string): string[] | null {
	const bin = resolveBwrapPath();
	if (!bin || !osSandboxConfigured()) return null;
	return [bin, ...bwrapArgs(workspace), "--", ...command];
}

let availabilityCache: boolean | null = null;

/** One-time smoke test: can the profile actually execute a command here?
 *  Non-linux hosts short-circuit to false — same explicit gate as
 *  resolveBwrapPath (Linux behavior unchanged). */
export async function osSandboxAvailable(): Promise<boolean> {
	if (process.platform !== "linux") return false;
	if (!osSandboxConfigured()) return false;
	if (availabilityCache !== null) return availabilityCache;
	const bin = resolveBwrapPath();
	if (!bin) {
		availabilityCache = false;
		return false;
	}
	let probeDir: string | null = null;
	try {
		probeDir = mkdtempSync(join(tmpdir(), "unown-bwrap-probe-"));
		const proc = Bun.spawn([bin, ...bwrapArgs(probeDir), "--", "/bin/sh", "-c", "exit 0"], {
			cwd: probeDir,
			stdout: "ignore",
			stderr: "pipe",
		});
		const timer = setTimeout(() => proc.kill(9), 10_000);
		const code = await proc.exited;
		clearTimeout(timer);
		availabilityCache = code === 0;
	} catch {
		availabilityCache = false;
	} finally {
		if (probeDir) {
			try {
				rmSync(probeDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}
	return availabilityCache;
}

/**
 * Generate the sandbox shell wrapper the pi bash tool will use as its shell
 * (SettingsManager.inMemory({ shellPath })). Invoked as `<wrapper> -c "<cmd>"`
 * with cwd = the sandbox workspace, it re-executes the command under bwrap.
 * The workspace is derived from the invocation cwd — no per-run state needed.
 */
export function writeSandboxShell(agentDir: string): string | null {
	// Linux-only by explicit gate (see resolveBwrapPath) — non-linux hosts
	// never generate a shell wrapper; the agent session runs un-wrapped.
	if (process.platform !== "linux") return null;
	const bin = resolveBwrapPath();
	if (!bin || !osSandboxConfigured()) return null;
	mkdirSync(agentDir, { recursive: true });
	const shellPath = join(agentDir, "unown-sandbox-shell");
	const netArgs = netBlocked() ? "--unshare-net \\\n  --unshare-ipc \\\n  " : "";
	const script = `#!/bin/sh
# Generated by unown (src/bwrap.ts) — sandbox shell for agent bash commands.
# Invoked as: unown-sandbox-shell -c "<command>"; cwd = sandbox workspace.
# Re-executes the command under bubblewrap with the validated profile.
WS=$(pwd -P)
exec '${bin}' \\
  --ro-bind / / \\
  --proc /proc \\
  --dev /dev \\
  --tmpfs /home \\
  --tmpfs /run \\
  --tmpfs /tmp \\
  --tmpfs /var/tmp \\
  --bind "$WS" "$WS" \\
  --chdir "$WS" \\
  ${netArgs}--die-with-parent \\
  --new-session \\
  --cap-drop ALL \\
  --setenv HOME /tmp/home \\
  --setenv TMPDIR /tmp \\
  -- /bin/bash "$@"
`;
	writeFileSync(shellPath, script, "utf8");
	chmodSync(shellPath, 0o755);
	return shellPath;
}
