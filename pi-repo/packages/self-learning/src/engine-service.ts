/**
 * engine-service.ts — `unown engine install|uninstall`: the OS service layer
 * that keeps the detached engine ALWAYS ON (the P0 gap in the routines
 * story — docs/routines.md "always-on" and docs/resilience.md §supervision).
 *
 * WHAT THIS CLOSES: the engine's own supervision (engine-supervisor.ts, the
 * Ollama pattern) only spawns on agent touchpoints — a note delivery, a live
 * session footer, `unown engine start`. After a reboot (or logout, or a
 * crash while nobody is using an agent) the engine stayed DOWN until a human
 * touched it, and routines silently waited (or were recorded as skipped).
 * An OS service closes that: RunAtLoad + restart-on-crash means the engine
 * boots with the login session and recovers from crashes unattended, with
 * the SAME bounded-loss semantics (misfire policy, 24 h catch-up horizon).
 *
 * Reverse-engineered patterns (research 2026-10, docs/detached-engine-research.md
 * §daemon supervision + the tools survey):
 *   - OpenClaw `gateway install` — one command, per-OS service generation
 *     (launchd / systemd user / schtasks), drift repair by re-running it;
 *   - pm2 `startup` + `save` — user-level service, no root, explicit
 *     "here is the exact command the supervisor owns";
 *   - systemd user units with `Restart=on-failure` + `RestartPreventExitStatus`
 *     (a clean exit — the lock loser, a graceful stop — must NOT restart);
 *   - launchd `KeepAlive = { Crashed = true; SuccessfulExit = false }` — the
 *     exact same semantics spelled the launchd way;
 *   - Windows Task Scheduler per-user logon tasks (Register-ScheduledTask,
 *     ExecutionTimeLimit disabled, RestartCount bounded) — per-user, not a
 *     service needing admin: an agent carries the user's credentials.
 *
 * DESIGN RULES (all pinned by tests):
 *   1. The service owns `unown engine serve` — the SAME foreground entry the
 *      docs already documented for supervisors; nothing new to keep alive.
 *   2. Declarative + idempotent: install rewrites the unit/plist/task from
 *      the CURRENT checkout (a moved repo repairs the drift on re-run).
 *   3. Graceful ownership handover: if a supervisor-spawned engine is up,
 *      install drains it (HTTP /api/shutdown) before the service starts one,
 *      so exactly one engine ever holds the lock.
 *   4. No root, no system-wide state: systemd --user + enable-linger
 *      (best-effort, warned), ~/Library/LaunchAgents, a per-user scheduled
 *      task — uninstallable by the user alone.
 *   5. Compile-time refusal in binary installs (the engine stack is a
 *      source-install feature — docs/install.md): a clear error, not a
 *      half-working service.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { engineHealth } from "./engine-supervisor.ts";
import { IS_COMPILED_BINARY } from "./packaging.ts";

/** The service name across platforms (systemd unit base, launchd label base,
 *  scheduled task name). One identity everywhere it can be queried. */
export const ENGINE_SERVICE_NAME = "unown-engine";
/** launchd label — reverse-DNS per LaunchAgent convention. */
export const LAUNCHD_LABEL = "ai.unown.engine";

export type ServiceManagerKind = "systemd-user" | "launchd" | "schtasks" | "none";

/**
 * Which service manager owns "run at login, restart on crash" on this
 * platform? Pure (platform + home injected) so the routing itself is
 * unit-tested; the imperative layer only acts on the verdict.
 */
export function detectServiceManager(platform: NodeJS.Platform = process.platform): ServiceManagerKind {
	if (platform === "darwin") return "launchd";
	if (platform === "win32") return "schtasks";
	if (platform === "linux") return "systemd-user";
	return "none";
}

/** Everything the generated service definition needs (pure data — the unit /
 *  plist / task builders below are total functions of this). */
export interface ServiceSpec {
	/** Absolute path of the bun runtime (or compiled binary) that runs the entry. */
	bunPath: string;
	/** Absolute path of the CLI entry script (…/bin/unown). */
	entryPath: string;
	/** Absolute working directory (the repo checkout — where .env lives). */
	workDir: string;
	/** The .env the serve path loads (informational in the unit comment). */
	envFile: string;
	/** Path where the service logs go (informational in the unit comment). */
	logFile: string;
	/** The subcommand argv the service runs (always ["engine", "serve"]). */
	serveArgs: string[];
}

/** Resolve this checkout's service spec. Throws in compiled-binary installs —
 *  the engine stack needs the source install (rule 5). */
export function resolveServiceSpec(repoRoot: string, compiled: boolean = IS_COMPILED_BINARY): ServiceSpec {
	if (compiled) {
		throw new Error(
			"the self-learning engine stack (engine + bridge) is a source-install feature — " +
				"binary installs have no engine to keep alive (docs/install.md). " +
				"Reinstall with: curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --source",
		);
	}
	return {
		bunPath: process.execPath,
		entryPath: join(repoRoot, "bin", "unown"),
		workDir: repoRoot,
		envFile: join(repoRoot, ".env"),
		logFile: join(repoRoot, ".run", "engine.log"),
		serveArgs: ["engine", "serve"],
	};
}

// ---------------------------------------------------------------------------
// Pure builders — the generated definitions, one per platform. Every value is
// quoted for the manager's own parser (systemd's ExecStart quoting rules,
// launchd's argv-array "no quoting needed", PowerShell's nested quoting).
// ---------------------------------------------------------------------------

/** systemd --user unit (also used unchanged by WSL2's systemd). */
export function buildSystemdUnit(spec: ServiceSpec): string {
	// ExecStart quoting per systemd's rules: double-quoted, with `\` and `"`
	// escaped by a preceding backslash. Backslashes FIRST — escaping `"` alone
	// leaves a trailing `\` free to escape the CLOSING quote (`"C:\dir\"`
	// would re-open the literal; js/incomplete-sanitization).
	const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	return [
		"# unown engine service — generated by `unown engine install` (idempotent; re-run to repair drift)",
		"# The service owns `unown engine serve`: boot at login, restart on crash.",
		"# Graceful stops (unown engine stop, the lock loser) exit 0 and do NOT restart.",
		"[Unit]",
		"Description=unown self-learning engine (memory, harness, dream, routines)",
		"Documentation=https://github.com/kanishka-namdeo/Unown",
		"",
		"[Service]",
		`Type=simple`,
		`WorkingDirectory=${spec.workDir}`,
		`ExecStart=${q(spec.bunPath)} ${q(spec.entryPath)} ${spec.serveArgs.join(" ")}`,
		"# The serve entry loads .env itself (engine-cli cmdServe); env here is belt-and-braces.",
		`Environment=UNOWN_ENGINE_OWNED_BY_SERVICE=1`,
		"Restart=on-failure",
		"RestartSec=3",
		// Exit 0 = graceful stop or the single-instance lock loser — never restart over it.
		"RestartPreventExitStatus=0",
		"StartLimitBurst=5",
		"StartLimitIntervalSec=60",
		"# Draining in-flight requests + a WAL checkpoint can take a moment:",
		"TimeoutStopSec=30",
		"",
		"[Install]",
		"WantedBy=default.target",
		"",
	].join("\n");
}

/** launchd LaunchAgent plist (ProgramArguments array — paths need NO quoting,
 *  each element is one argv slot). */
export function buildLaunchdPlist(spec: ServiceSpec): string {
	const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const argv = [spec.bunPath, spec.entryPath, ...spec.serveArgs]
		.map((a) => `\t\t\t<string>${esc(a)}</string>`)
		.join("\n");
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		"<!-- unown engine service — generated by `unown engine install` (idempotent) -->",
		`<plist version="1.0">`,
		"<dict>",
		`\t<key>Label</key>`,
		`\t<string>${LAUNCHD_LABEL}</string>`,
		`\t<key>ProgramArguments</key>`,
		"\t<array>",
		argv,
		"\t</array>",
		`\t<key>WorkingDirectory</key>`,
		`\t<string>${esc(spec.workDir)}</string>`,
		// M6: without these keys a launchd-started engine logged to
		// NOWHERE (the supervisor's stdio redirect never runs on the
		// service lane). Both lanes write the SAME engine.log — one
		// file, one rotation policy (serve-boot copy-truncate).
		`\t<key>StandardOutPath</key>`,
		`\t<string>${esc(spec.logFile)}</string>`,
		`\t<key>StandardErrorPath</key>`,
		`\t<string>${esc(spec.logFile)}</string>`,
		"\t<key>RunAtLoad</key>",
		"\t<true/>",
		// Restart on crash; a clean exit (graceful stop / lock loser) stays down.
		"\t<key>KeepAlive</key>",
		"\t<dict>",
		"\t\t<key>Crashed</key>",
		"\t\t<true/>",
		"\t\t<key>SuccessfulExit</key>",
		"\t\t<false/>",
		"\t</dict>",
		"\t<key>ProcessType</key>",
		"\t<string>Adaptive</string>",
		`\t<key>EnvironmentVariables</key>`,
		"\t<dict>",
		`\t\t<key>UNOWN_ENGINE_OWNED_BY_SERVICE</key>`,
		`\t\t<string>1</string>`,
		"\t</dict>",
		"</dict>",
		"</plist>",
		"",
	].join("\n");
}

/** Windows: the PowerShell that registers the per-user logon task. Returned
 *  as a single -Command string (executed via powershell.exe -NoProfile). */
export function buildWindowsRegisterPs(spec: ServiceSpec): string {
	const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
	return [
		"$action = New-ScheduledTaskAction -Execute " + sq(spec.bunPath),
		"  -Argument " + sq(`${spec.entryPath} engine serve`) + " -WorkingDirectory " + sq(spec.workDir),
		"$trigger = New-ScheduledTaskTrigger -AtLogOn",
		"$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable",
		"$settings.ExecutionTimeLimit = 'PT0S'",
		"$settings.RestartCount = 3",
		"$settings.RestartInterval = (New-TimeSpan -Minutes 1)",
		"Register-ScheduledTask -TaskName " +
			sq(ENGINE_SERVICE_NAME) +
			" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Imperative layer — thin, every failure surfaced with an actionable message.
// execFileSync with a hard timeout: a hung systemctl must not hang the CLI.
// ---------------------------------------------------------------------------

function runCaptured(cmd: string, args: string[], timeoutMs = 15_000): { ok: boolean; stdout: string; stderr: string } {
	try {
		// stdio fully piped: systemctl/launchctl's own stderr chatter
		// (e.g. the missing user-bus notice inside containers) must be
		// CAPTURED for the structured verdict, never leak to the user's
		// terminal — the CLI prints its own actionable lines instead.
		const stdout = execFileSync(cmd, args, {
			timeout: timeoutMs,
			encoding: "utf8",
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		}).toString();
		return { ok: true, stdout, stderr: "" };
	} catch (err: any) {
		return { ok: false, stdout: String(err?.stdout ?? ""), stderr: String(err?.stderr ?? err?.message ?? err) };
	}
}

function systemdUnitPath(): string {
	return join(homedir(), ".config", "systemd", "user", `${ENGINE_SERVICE_NAME}.service`);
}
function launchdPlistPath(): string {
	return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

/** Probe the installed state (best-effort; used by `unown engine status`). */
export interface ServiceStatus {
	installed: boolean;
	kind: ServiceManagerKind;
	/** enabled/active verdict where the manager exposes one. */
	detail: string;
}

export async function serviceStatus(): Promise<ServiceStatus> {
	const kind = detectServiceManager();
	if (kind === "systemd-user") {
		if (!existsSync(systemdUnitPath())) return { installed: false, kind, detail: "not installed" };
		const enabled = runCaptured("systemctl", ["--user", "is-enabled", ENGINE_SERVICE_NAME], 5000);
		const active = runCaptured("systemctl", ["--user", "is-active", ENGINE_SERVICE_NAME], 5000);
		return {
			installed: true,
			kind,
			detail: `${(enabled.stdout || enabled.stderr).trim() || "unknown"} · ${(active.stdout || active.stderr).trim() || "unknown"}`,
		};
	}
	if (kind === "launchd") {
		if (!existsSync(launchdPlistPath())) return { installed: false, kind, detail: "not installed" };
		const listed = runCaptured("launchctl", ["list"], 5000);
		const loaded = listed.ok && listed.stdout.includes(LAUNCHD_LABEL);
		return { installed: true, kind, detail: loaded ? "loaded" : "installed (not loaded)" };
	}
	if (kind === "schtasks") {
		const q = runCaptured("schtasks", ["/Query", "/TN", ENGINE_SERVICE_NAME], 5000);
		if (!q.ok) return { installed: false, kind, detail: "not installed" };
		return { installed: true, kind, detail: "registered" };
	}
	return { installed: false, kind: "none", detail: `no service manager on ${process.platform}` };
}

/** Drain a running engine so the service can own the port/lock (rule 3).
 *  HTTP-first (cross-platform), signal fallback — cmdStop's shape, local. */
async function drainRunningEngine(): Promise<boolean> {
	const health = await engineHealth(1500);
	if (!health.up) return true;
	try {
		const { engineFetch } = await import("./engine-auth.ts");
		const { ENGINE_URL } = await import("./term.ts");
		await engineFetch(`${ENGINE_URL}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(3000) });
	} catch {
		/* fall through to the signal path */
	}
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 500));
		if (!(await engineHealth(600)).up) return true;
	}
	if (health.pid) {
		try {
			process.kill(health.pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	return true;
}

/** Wait for the service-started engine to answer HTTP (bounded, jittered). */
async function waitEngineHealthy(waitMs: number): Promise<boolean> {
	const deadline = Date.now() + waitMs;
	let delay = 400;
	for (;;) {
		await new Promise((r) => setTimeout(r, delay * (0.8 + Math.random() * 0.4)));
		if ((await engineHealth(1200)).up) return true;
		if (Date.now() >= deadline) return false;
		delay = Math.min(delay * 2, 2000);
	}
}

export interface ServiceCommandResult {
	exitCode: number;
	lines: string[];
}

/** `unown engine install` — install + enable + start the OS service. */
export async function installEngineService(repoRoot: string, out: (s: string) => void): Promise<number> {
	let spec: ServiceSpec;
	try {
		spec = resolveServiceSpec(repoRoot);
	} catch (err: any) {
		out(`engine service: ${err.message}`);
		return 2;
	}
	const kind = detectServiceManager();
	out(`engine service: installing (${kind}) — the engine will boot at login and restart on crash`);

	if (kind === "systemd-user") {
		// 1. Write the unit (declarative — a re-run after moving the repo repairs it).
		const unit = systemdUnitPath();
		mkdirSync(join(unit, ".."), { recursive: true });
		writeFileSync(unit, buildSystemdUnit(spec), { mode: 0o644 });
		out(`  unit: ${unit}`);
		// 2. Reload + enable.
		const reload = runCaptured("systemctl", ["--user", "daemon-reload"]);
		if (!reload.ok) {
			out(`  systemctl --user daemon-reload failed: ${reload.stderr.trim()}`);
			out("  (inside SSH/containers the user systemd session may be absent — run from a login session, or");
			out("   keep the agent-side auto-start instead: it spawns the engine on the next note/session)");
			return 1;
		}
		runCaptured("systemctl", ["--user", "enable", ENGINE_SERVICE_NAME]);
		// 3. Ownership handover: drain a supervisor-spawned engine first.
		await drainRunningEngine();
		// 4. Start (restart = idempotent when already running).
		const start = runCaptured("systemctl", ["--user", "restart", ENGINE_SERVICE_NAME]);
		if (!start.ok) {
			out(`  systemctl --user start failed: ${start.stderr.trim()}`);
			return 1;
		}
		// 5. Linger (best-effort): without it the unit stops at logout.
		const linger = runCaptured("loginctl", ["enable-linger", String(process.getuid?.() ?? "")], 8000);
		if (!linger.ok) {
			out("  ⚠ loginctl enable-linger failed — the engine will stop when you log out entirely.");
			out("    (enable it once with: sudo loginctl enable-linger $USER)");
		}
		out("  started: systemctl --user " + ENGINE_SERVICE_NAME);
	} else if (kind === "launchd") {
		const plist = launchdPlistPath();
		mkdirSync(join(plist, ".."), { recursive: true });
		// launchd does NOT mkdir parents for Standard*Path — the .run
		// dir must exist before the job first boots (M6).
		mkdirSync(join(spec.logFile, ".."), { recursive: true });
		writeFileSync(plist, buildLaunchdPlist(spec), { mode: 0o644 });
		out(`  agent: ${plist}`);
		await drainRunningEngine();
		const uid = runCaptured("id", ["-u"], 3000);
		const bootstrap = uid.ok
			? runCaptured("launchctl", ["bootstrap", `gui/${uid.stdout.trim()}`, plist])
			: { ok: false, stdout: "", stderr: "id -u failed" };
		let started = bootstrap.ok;
		if (!started && uid.ok) {
			// Already-bootstrapped agents: bootout then bootstrap again (idempotent re-run).
			runCaptured("launchctl", ["bootout", `gui/${uid.stdout.trim()}/${LAUNCHD_LABEL}`], 8000);
			started = runCaptured("launchctl", ["bootstrap", `gui/${uid.stdout.trim()}`, plist]).ok;
		}
		if (!started) {
			const legacy = runCaptured("launchctl", ["load", "-w", plist]);
			started = legacy.ok;
		}
		if (!started) {
			out(`  launchctl failed to load the agent — load it manually: launchctl load -w ${plist}`);
			return 1;
		}
		out("  started: launchctl " + LAUNCHD_LABEL);
	} else if (kind === "schtasks") {
		const ps = buildWindowsRegisterPs(spec);
		const reg = runCaptured("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], 30_000);
		if (!reg.ok) {
			out(`  Register-ScheduledTask failed: ${reg.stderr.trim()}`);
			return 1;
		}
		await drainRunningEngine();
		const startRes = runCaptured(
			"powershell",
			["-NoProfile", "-Command", `Start-ScheduledTask -TaskName '${ENGINE_SERVICE_NAME}'`],
			15_000,
		);
		if (!startRes.ok) {
			out(`  task registered but Start-ScheduledTask failed: ${startRes.stderr.trim()}`);
			return 1;
		}
		out(`  task: ${ENGINE_SERVICE_NAME} (logon trigger, restart on failure)`);
	} else {
		out(`engine service: no supported service manager on ${process.platform}`);
		out("  the agent-side auto-start still spawns the engine on the next note/session touchpoint");
		return 2;
	}

	// Receipt: the engine answering HTTP after the service started it.
	const up = await waitEngineHealthy(25_000);
	if (up) {
		out("engine: UP under the OS service — routines now fire even with no agent in use");
	} else {
		out("engine: service installed, but the engine is not healthy yet (it may still be booting)");
		out(`  check: ${spec.logFile}`);
		return 1;
	}
	out("  routines tip: for slots that MUST survive downtime, create them with --misfire catch-up");
	return 0;
}

/** `unown engine uninstall` — stop + remove the OS service (idempotent). */
export async function uninstallEngineService(out: (s: string) => void): Promise<number> {
	const kind = detectServiceManager();
	if (kind === "systemd-user") {
		const unit = systemdUnitPath();
		if (!existsSync(unit)) {
			out("engine service: not installed (nothing to remove)");
			return 0;
		}
		runCaptured("systemctl", ["--user", "stop", ENGINE_SERVICE_NAME], 20_000);
		runCaptured("systemctl", ["--user", "disable", ENGINE_SERVICE_NAME]);
		rmSync(unit, { force: true });
		runCaptured("systemctl", ["--user", "daemon-reload"]);
		runCaptured("systemctl", ["--user", "reset-failed", ENGINE_SERVICE_NAME], 5000);
		out("engine service: stopped, disabled and removed (systemd user unit)");
	} else if (kind === "launchd") {
		const plist = launchdPlistPath();
		const uid = runCaptured("id", ["-u"], 3000);
		if (uid.ok) runCaptured("launchctl", ["bootout", `gui/${uid.stdout.trim()}/${LAUNCHD_LABEL}`], 20_000);
		else runCaptured("launchctl", ["unload", "-w", plist], 20_000);
		if (!existsSync(plist)) {
			out("engine service: not installed (nothing to remove)");
			return 0;
		}
		rmSync(plist, { force: true });
		out("engine service: stopped and removed (launchd agent)");
	} else if (kind === "schtasks") {
		runCaptured(
			"powershell",
			["-NoProfile", "-Command", `Stop-ScheduledTask -TaskName '${ENGINE_SERVICE_NAME}'`],
			15_000,
		);
		const un = runCaptured(
			"powershell",
			["-NoProfile", "-Command", `Unregister-ScheduledTask -TaskName '${ENGINE_SERVICE_NAME}' -Confirm:$false`],
			15_000,
		);
		if (!un.ok && /cannot find|does not exist|not found/i.test(un.stderr)) {
			out("engine service: not installed (nothing to remove)");
			return 0;
		}
		out("engine service: stopped and removed (scheduled task)");
	} else {
		out(`engine service: no service manager on ${process.platform} — nothing installed`);
		return 0;
	}
	out("  the engine stays down until: unown engine start  (or the next note/session touchpoint)");
	return 0;
}
