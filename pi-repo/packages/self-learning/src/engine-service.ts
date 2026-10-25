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
 *      task (and, when Task Scheduler is ACL-gated for a standard Windows
 *      account, a hidden Startup-folder launcher with the same restart
 *      policy) — uninstallable by the user alone.
 *   5. Compile-time refusal in binary installs (the engine stack is a
 *      source-install feature — docs/install.md): a clear error, not a
 *      half-working service.
 *   6. Auto lane (`--auto`, run by scripts/install.ts on install AND update):
 *      the service is the DEFAULT, not an opt-in command — skipping it in CI
 *      (no login session), after `unown engine uninstall` (a remembered
 *      opt-out marker), or under the `UNOWN_ENGINE_AUTOSTART=0` kill switch.
 *      Manual `unown engine install` always wins and clears the marker.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { autoStartDisabled, engineHealth, loadEnvValues } from "./engine-supervisor.ts";
import { IS_COMPILED_BINARY, unownHome } from "./packaging.ts";

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

/** Test seams for the resolved spec (the real call uses the process). */
export interface ServiceSpecInput {
	execPath?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	exists?: (p: string) => boolean;
}

/** Version managers put bun under a path that disappears on upgrade:
 *  Homebrew's `Cellar/bun/<version>/`, asdf/mise's `installs/bun/<version>/`,
 *  Scoop's `scoop/apps/bun/<version>/`, Nix store hashes, or any `<x.y.z>`
 *  directory. A long-lived service must never point there. */
const VERSIONED_BUN_PATH =
	/[\\/](?:Cellar|installs?|versions?|scoop[\\/]apps|nix[\\/]store)[\\/][^\\/]+[\\/]|[\\/]v?\d+\.\d+\.\d+[\\/]/i;

function firstBunOnPath(
	pathValue: string | undefined,
	platform: NodeJS.Platform,
	exists: (p: string) => boolean,
): string | null {
	if (!pathValue) return null;
	const name = platform === "win32" ? "bun.exe" : "bun";
	for (const raw of pathValue.split(platform === "win32" ? ";" : ":")) {
		const dir = raw.trim().replace(/^"(.*)"$/, "$1");
		if (!dir) continue;
		const candidate = join(dir, name);
		if (exists(candidate)) return candidate;
	}
	return null;
}

/** The bun path the generated service should own. `process.execPath` is
 *  correct for the official installer (`~/.bun/bin/bun`, replaced in place)
 *  but wrong for versioned managers — prefer the stable PATH shim (Homebrew's
 *  `bin/bun` symlink, asdf/mise shims, Scoop shims) or `BUN_INSTALL/bin/bun`
 *  when the running binary sits under a versioned directory. Pure-ish
 *  (injectable fs) so the rule is unit-tested. */
export function resolveServiceBunPath(input: ServiceSpecInput = {}): string {
	const env = input.env ?? process.env;
	const platform = input.platform ?? process.platform;
	const execPath = input.execPath ?? process.execPath;
	const exists = input.exists ?? existsSync;
	if (!VERSIONED_BUN_PATH.test(execPath)) return execPath;
	const fromPath = firstBunOnPath(env.PATH, platform, exists);
	if (fromPath) return fromPath;
	if (env.BUN_INSTALL) {
		const installed = join(env.BUN_INSTALL, "bin", platform === "win32" ? "bun.exe" : "bun");
		if (exists(installed)) return installed;
	}
	return execPath;
}

/** Resolve this checkout's service spec. Throws in compiled-binary installs —
 *  the engine stack needs the source install (rule 5). */
export function resolveServiceSpec(
	repoRoot: string,
	compiled: boolean = IS_COMPILED_BINARY,
	input: ServiceSpecInput = {},
): ServiceSpec {
	if (compiled) {
		throw new Error(
			"the self-learning engine stack (engine + bridge) is a source-install feature — " +
				"binary installs have no engine to keep alive (docs/install.md). " +
				"Reinstall with: curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --source",
		);
	}
	return {
		bunPath: resolveServiceBunPath(input),
		entryPath: join(repoRoot, "bin", "unown"),
		workDir: repoRoot,
		envFile: join(repoRoot, ".env"),
		logFile: join(repoRoot, ".run", "engine.log"),
		serveArgs: ["engine", "serve"],
	};
}

// ---------------------------------------------------------------------------
// Auto lane — should scripts/install.ts (install AND update) install the
// service without being asked? Pure (env + platform + marker injected) so the
// gate itself is unit-tested; the imperative layer only acts on the verdict.
// ---------------------------------------------------------------------------

/** Marker written by `unown engine uninstall`: a deliberate opt-out that the
 *  install/update lane must not silently undo. Lives in UNOWN_HOME (outside
 *  the checkout, so a moved repo keeps it), removed by a manual `install`. */
export function serviceDisabledMarker(env: NodeJS.ProcessEnv = process.env): string {
	return join(unownHome(env), "engine-service.disabled");
}

export type ServiceAutoSkipReason = "compiled" | "no-manager" | "ci" | "opt-out" | "autostart-off" | "uninstalled";

export interface ServiceAutoDecision {
	install: boolean;
	/** Why the auto lane skipped (undefined when `install` is true). */
	reason?: ServiceAutoSkipReason;
}

export interface ServiceAutoInput {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	compiled?: boolean;
	/** Override the on-disk marker probe (tests). */
	uninstalled?: boolean;
}

function envTruthy(raw: string | undefined): boolean {
	return /^(1|true|yes|on)$/i.test(raw ?? "");
}

/**
 * The install/update lane's gate. Order matters only for the reported reason:
 * every skip is safe, but the most specific one is the one a user can act on.
 * Fails OPEN (install) — the service is the default; every skip is explicit.
 */
export function decideAutoServiceInstall(input: ServiceAutoInput = {}): ServiceAutoDecision {
	const env = input.env ?? process.env;
	const platform = input.platform ?? process.platform;
	if (input.compiled ?? IS_COMPILED_BINARY) return { install: false, reason: "compiled" };
	if (detectServiceManager(platform) === "none") return { install: false, reason: "no-manager" };
	if (envTruthy(env.UNOWN_NO_ENGINE_SERVICE)) return { install: false, reason: "opt-out" };
	if (autoStartDisabled(env)) return { install: false, reason: "autostart-off" };
	if (input.uninstalled ?? existsSync(serviceDisabledMarker(env))) return { install: false, reason: "uninstalled" };
	// CI runners have no login session (and windows-latest would register a
	// real logon task): services are a desktop concern, never a build step.
	if (envTruthy(env.CI)) return { install: false, reason: "ci" };
	return { install: true };
}

/** One actionable line for an auto-lane skip. */
export function describeServiceAutoSkip(
	reason: ServiceAutoSkipReason,
	platform: NodeJS.Platform = process.platform,
): string {
	switch (reason) {
		case "compiled":
			return "engine service: skipped (binary installs have no engine — the source lane owns it)";
		case "no-manager":
			return `engine service: skipped (no supported service manager on ${platform})`;
		case "opt-out":
			return "engine service: skipped (UNOWN_NO_ENGINE_SERVICE=1)";
		case "autostart-off":
			return "engine service: skipped (UNOWN_ENGINE_AUTOSTART=0 — engine-off kill switch)";
		case "uninstalled":
			return "engine service: skipped (you ran unown engine uninstall — unown engine install re-enables it)";
		case "ci":
			return "engine service: skipped (CI run — logon services are a desktop concern)";
	}
}

/** Merge the two auto-lane knobs from the state root's .env, empty = unset
 *  (the repo convention). File values win, matching the engine's serve path. */
export function autoServiceEnv(env: NodeJS.ProcessEnv, envFile: string): NodeJS.ProcessEnv {
	const file = loadEnvValues(envFile);
	const merged = { ...env };
	for (const key of ["UNOWN_ENGINE_AUTOSTART", "UNOWN_NO_ENGINE_SERVICE"]) {
		const v = file[key];
		if (v !== undefined && v !== "") merged[key] = v;
	}
	return merged;
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
	// `%` is a SPECIFIER (e.g. %h = home) in every path-ish setting, and `$` is
	// env-expanded in ExecStart: both need doubling for a literal character.
	// WorkingDirectory performs specifier expansion only — `$$` there would
	// stay two literal dollars, so it gets the `%`-only form.
	const quote = (s: string, dollars: boolean) => {
		let v = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
		if (dollars) v = v.replace(/\$/g, "$$$$");
		return `"${v}"`;
	};
	const qPath = (s: string) => quote(s, false);
	const qExec = (s: string) => quote(s, true);
	return [
		"# unown engine service — generated by `unown engine install` (idempotent; re-run to repair drift)",
		"# The service owns `unown engine serve`: boot at login, restart on crash.",
		"# Graceful stops (unown engine stop, the lock loser) exit 0 and do NOT restart.",
		"[Unit]",
		"Description=unown self-learning engine (memory, harness, dream, routines)",
		"Documentation=https://github.com/kanishka-namdeo/Unown",
		// StartLimit* are [Unit] settings since systemd v229 (systemd.unit(5)).
		// In [Service] they are ignored, leaving a boot-crashing engine free to
		// restart-storm — this exact placement was shipped wrong until the
		// 2026-10-25 service review.
		"StartLimitBurst=5",
		"StartLimitIntervalSec=60",
		"",
		"[Service]",
		`Type=simple`,
		`WorkingDirectory=${qPath(spec.workDir)}`,
		`ExecStart=${qExec(spec.bunPath)} ${qExec(spec.entryPath)} ${spec.serveArgs.join(" ")}`,
		"# The serve entry loads .env itself (engine-cli cmdServe); env here is belt-and-braces.",
		`Environment=UNOWN_ENGINE_OWNED_BY_SERVICE=1`,
		"Restart=on-failure",
		"RestartSec=3",
		// Exit 0 = graceful stop or the single-instance lock loser — never restart over it.
		"RestartPreventExitStatus=0",
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
 *  as a single -Command string (executed via powershell.exe -NoProfile).
 *
 *  Two live-caught rules:
 *   - ONE statement per line — PowerShell has no implicit line continuation,
 *     so a `-Argument …` on its own line is parsed as a cmdlet and fails;
 *   - restart policy goes through the CMDLET parameters, never a direct
 *     `$settings.RestartInterval` assignment: the property serialises as
 *     `00:01:00`, which Task Scheduler's XML parser rejects as out of range.
 */
export function buildWindowsRegisterPs(spec: ServiceSpec): string {
	const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
	// The task's Argument string is parsed by CreateProcess, not PowerShell:
	// an unquoted entry path splits at its first space (`C:\Users\Jane Doe\…`)
	// and the task starts bun with a nonexistent script. Quote-wrap it exactly
	// like the Windows spawn path does (engine-supervisor).
	const argv = [`"${spec.entryPath}"`, ...spec.serveArgs].join(" ");
	return [
		`$action = New-ScheduledTaskAction -Execute ${sq(spec.bunPath)} -Argument ${sq(argv)} -WorkingDirectory ${sq(spec.workDir)}`,
		"$trigger = New-ScheduledTaskTrigger -AtLogOn",
		"$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)",
		"$settings.ExecutionTimeLimit = 'PT0S'",
		`Register-ScheduledTask -TaskName ${sq(ENGINE_SERVICE_NAME)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
	].join("\n");
}

/** Windows per-user Startup folder (`shell:startup`). Kept only to FIND the
 *  pre-2026-10-25 VBS launcher so an install/uninstall can clean it up. */
export function windowsStartupDir(env: NodeJS.ProcessEnv = process.env): string {
	const appData = env.APPDATA || join(homedir(), "AppData", "Roaming");
	return join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

/** The WSH launcher this module shipped before the VBScript retirement
 *  (Windows 11 24H2 is the last release with VBScript enabled by default;
 *  later releases make it an on-demand feature). Migration path only. */
export function windowsLegacyLauncherPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(windowsStartupDir(env), "unown-engine.vbs");
}

/** Per-user, non-roaming launcher directory (`%LOCALAPPDATA%\unown`). */
export function windowsLauncherDir(env: NodeJS.ProcessEnv = process.env): string {
	const local = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
	return join(local, "unown");
}

/** The WSH-free logon watchdog script the no-admin lane installs. */
export function windowsLauncherPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(windowsLauncherDir(env), "engine-service.ps1");
}

/** Per-user logon autostart WITHOUT admin or WSH: the classic HKCU Run key.
 *  Microsoft documents a 260-character cap on the command line (Run and
 *  RunOnce Registry Keys, learn.microsoft.com). */
export const WINDOWS_RUN_KEY = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const WINDOWS_RUN_VALUE = ENGINE_SERVICE_NAME;
export const WINDOWS_RUN_MAX_CHARS = 260;

/** The Windows PowerShell every supported release ships (PowerShell 7's pwsh
 *  is optional; Windows PowerShell 5.1 is the guaranteed binary). */
export function windowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
	const root = env.SystemRoot || env.windir || "C:\\Windows";
	return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Windows logon watchdog — the fallback when Task Scheduler refuses the
 *  registration (standard accounts; the scheduled task is ACL-gated even for
 *  per-user logon triggers), now WITHOUT WScript.Shell: VBScript is a retired
 *  feature and must not be load-bearing. Logs to the SAME .run/engine.log the
 *  other lanes write (a scheduled task has no console, so this is the only
 *  Windows service log), restarts after a NON-ZERO exit with a capped backoff,
 *  and ends on exit 0 (a graceful stop or the single-instance lock loser) —
 *  the systemd/launchd policy in PowerShell. */
export function buildWindowsLauncherPs(spec: ServiceSpec): string {
	const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
	// cmd /c + native redirection, NOT PowerShell's `*>>`: Windows PowerShell
	// 5.1 writes a redirection target as UTF-16, which would corrupt the
	// shared UTF-8 engine.log (measured: `[ r o u t e r ]` NUL-interleaved).
	// cmd forwards the child's own bytes untouched and propagates its exit code.
	const line = `$line = '"' + ${sq(spec.bunPath)} + '" "' + ${sq(spec.entryPath)} + '" ${spec.serveArgs.join(" ")} >> "' + $log + '" 2>&1'`;
	return [
		"# unown engine logon watchdog - generated by `unown engine install` (idempotent; re-run to repair)",
		"# Hidden + restart-on-failure; a clean exit (unown engine stop, the lock loser) ends the loop.",
		"$ErrorActionPreference = 'SilentlyContinue'",
		`Set-Location -LiteralPath ${sq(spec.workDir)}`,
		`$log = ${sq(spec.logFile)}`,
		"$delay = 3",
		"while ($true) {",
		`  ${line}`,
		"  & $env:ComSpec /d /c $line",
		"  if ($LASTEXITCODE -eq 0) { break }",
		"  Start-Sleep -Seconds $delay",
		"  if ($delay -lt 60) { $delay = [Math]::Min($delay * 2, 60) }",
		"}",
		"",
	].join("\r\n");
}

/** The HKCU Run command line, or null when a hostile-long path would blow the
 *  documented 260-character cap (a truncated autostart is worse than none). */
export function buildWindowsRunCommand(launcherPath: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const cmd = `"${windowsPowerShellPath(env)}" -NoProfile -EP Bypass -WindowStyle Hidden -File "${launcherPath}"`;
	return cmd.length <= WINDOWS_RUN_MAX_CHARS ? cmd : null;
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
		return {
			ok: false,
			stdout: String(err?.stdout ?? ""),
			// Parenthesized: `a ?? b ? c : d` parses as `(a ?? b) ? c : d`, which
			// threw away err.stderr whenever the captured stderr existed.
			stderr: String(err?.stderr ?? (err instanceof Error ? err.message : String(err))),
		};
	}
}

// ---------------------------------------------------------------------------
// Windows HKCU Run helpers — the no-admin, WSH-free lane. The value name is
// the service identity; the command points at the hidden PowerShell watchdog.
// ---------------------------------------------------------------------------

function registerWindowsRunValue(command: string): { ok: boolean; stderr: string } {
	const ps = [
		`$k = '${WINDOWS_RUN_KEY}'`,
		"if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }",
		`Set-ItemProperty -Path $k -Name '${WINDOWS_RUN_VALUE}' -Value '${command.replace(/'/g, "''")}' -Type String`,
	].join("; ");
	return runCaptured("powershell", ["-NoProfile", "-Command", ps], 15_000);
}

function removeWindowsRunValue(): void {
	runCaptured(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			`Remove-ItemProperty -Path '${WINDOWS_RUN_KEY}' -Name '${WINDOWS_RUN_VALUE}' -ErrorAction SilentlyContinue`,
		],
		10_000,
	);
}

/** The registered Run command, or null when the value is absent. */
function readWindowsRunValue(): string | null {
	const r = runCaptured(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			`(Get-ItemProperty -Path '${WINDOWS_RUN_KEY}' -Name '${WINDOWS_RUN_VALUE}' -ErrorAction SilentlyContinue).'${WINDOWS_RUN_VALUE}'`,
		],
		8_000,
	);
	const value = r.stdout.trim();
	return r.ok && value !== "" ? value : null;
}

function startWindowsWatchdog(launcher: string): { ok: boolean; stderr: string } {
	const argList = `-NoProfile -EP Bypass -WindowStyle Hidden -File "${launcher}"`;
	const ps = `Start-Process -WindowStyle Hidden -FilePath '${windowsPowerShellPath().replace(/'/g, "''")}' -ArgumentList '${argList.replace(/'/g, "''")}'`;
	return runCaptured("powershell", ["-NoProfile", "-Command", ps], 15_000);
}

/** Remove every no-admin Windows lane artifact (Run value + watchdog script +
 *  the retired VBS). Used when the scheduled-task lane wins, so the two lanes
 *  can never double-start. */
function removeWindowsFallback(): void {
	removeWindowsRunValue();
	rmSync(windowsLauncherPath(), { force: true });
	rmSync(windowsLegacyLauncherPath(), { force: true });
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
		if (q.ok) return { installed: true, kind, detail: "registered (logon task)" };
		if (readWindowsRunValue() !== null) {
			return { installed: true, kind, detail: "logon watchdog (HKCU Run, restart on failure)" };
		}
		if (existsSync(windowsLauncherPath()) || existsSync(windowsLegacyLauncherPath())) {
			return { installed: true, kind, detail: "launcher installed (not registered)" };
		}
		return { installed: false, kind, detail: "not installed" };
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

export interface InstallEngineServiceOptions {
	/** The install/update lane (scripts/install.ts): honor decideAutoServiceInstall. */
	auto?: boolean;
	/** Env for the auto gate (defaults to process.env). */
	env?: NodeJS.ProcessEnv;
}

/** Remember a deliberate `unown engine uninstall` so the installer never
 *  silently re-adds the service the user just removed. Best-effort. */
export function markServiceUninstalled(env: NodeJS.ProcessEnv = process.env): void {
	try {
		const marker = serviceDisabledMarker(env);
		mkdirSync(dirname(marker), { recursive: true });
		writeFileSync(
			marker,
			JSON.stringify({ disabledAt: new Date().toISOString(), platform: process.platform }) + "\n",
			{ mode: 0o644 },
		);
	} catch {
		/* a read-only home keeps the uninstall itself successful */
	}
}

/** `unown engine install [--auto]` — install + enable + start the OS service.
 *  `--auto` is the installer lane: skip (returning 0) whenever the gate says
 *  the service is not wanted on this machine. */
export async function installEngineService(
	repoRoot: string,
	out: (s: string) => void,
	opts: InstallEngineServiceOptions = {},
): Promise<number> {
	const env = opts.env ?? process.env;
	if (opts.auto) {
		const decision = decideAutoServiceInstall({ env });
		if (!decision.install) {
			out(describeServiceAutoSkip(decision.reason ?? "ci"));
			return 0;
		}
	}
	// A manual install is the explicit "turn it back on" after an uninstall.
	try {
		rmSync(serviceDisabledMarker(env), { force: true });
	} catch {
		/* best effort — the install below reports its own failures */
	}
	let spec: ServiceSpec;
	try {
		spec = resolveServiceSpec(repoRoot);
	} catch (err: any) {
		out(`engine service: ${err.message}`);
		return 2;
	}
	const kind = detectServiceManager();
	out(`engine service: installing (${kind}) — the engine will boot at login and restart on crash`);
	/** Headless macOS: loaded into this session only; the plist takes over at the next GUI login. */
	let sessionOnlyLaunch = false;

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
		let started = false;
		let sessionOnly = false;
		if (uid.ok) {
			const domain = `gui/${uid.stdout.trim()}`;
			// The gui/<uid> domain exists ONLY with an active desktop session;
			// over SSH/headless `bootstrap` fails with "Could not find domain"
			// (the OpenClaw gateway install hits the same wall). The plist in
			// ~/Library/LaunchAgents still loads at the next desktop login.
			const hasGui = runCaptured("launchctl", ["print", domain], 5000).ok;
			if (hasGui) {
				started = runCaptured("launchctl", ["bootstrap", domain, plist], 15_000).ok;
				if (!started) {
					// Already-bootstrapped agents: bootout then bootstrap again (idempotent re-run).
					runCaptured("launchctl", ["bootout", `${domain}/${LAUNCHD_LABEL}`], 8000);
					started = runCaptured("launchctl", ["bootstrap", domain, plist], 15_000).ok;
				}
			}
			if (!started) {
				// Start it for THIS session only; the durable part is the plist.
				started = runCaptured("launchctl", ["load", "-w", plist], 15_000).ok;
				sessionOnly = started;
				sessionOnlyLaunch = sessionOnly;
			}
		}
		if (!started) {
			out(`  launchctl failed to load the agent — load it manually: launchctl load -w ${plist}`);
			return 1;
		}
		out(
			sessionOnly
				? "  installed: starts at your next desktop login (no GUI session found — started in this session only)"
				: "  started: launchctl " + LAUNCHD_LABEL,
		);
	} else if (kind === "schtasks") {
		const ps = buildWindowsRegisterPs(spec);
		const reg = runCaptured("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], 30_000);
		if (reg.ok) {
			await drainRunningEngine();
			// A fallback from an earlier no-admin install would double-start.
			removeWindowsFallback();
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
			// Task Scheduler's root folder is ACL-gated for standard accounts
			// (live-caught: Register-ScheduledTask and schtasks /Create both
			// answer "Access is denied" unelevated). The HKCU Run key needs no
			// admin; a hidden PowerShell watchdog supplies the restart policy,
			// logging and the WSH-free shape VBScript's retirement requires.
			const launcher = windowsLauncherPath();
			const runCmd = buildWindowsRunCommand(launcher);
			if (!runCmd) {
				out(`  Register-ScheduledTask failed: ${reg.stderr.trim().split("\n")[0]}`);
				out(
					`  no-admin fallback unavailable: the launcher path exceeds the Run key's ${WINDOWS_RUN_MAX_CHARS}-char limit`,
				);
				out("  the agent-side auto-start still spawns the engine on the next note/session touchpoint");
				return 1;
			}
			try {
				mkdirSync(windowsLauncherDir(), { recursive: true });
				mkdirSync(dirname(spec.logFile), { recursive: true });
				// UTF-8 + BOM: Windows PowerShell 5.1 reads a BOM-less UTF-8
				// script as ANSI, mojibaking a non-ASCII user path (José, 张三).
				writeFileSync(launcher, "\uFEFF" + buildWindowsLauncherPs(spec), "utf8");
			} catch (err: any) {
				out(`  Register-ScheduledTask failed: ${reg.stderr.trim()}`);
				out(`  logon watchdog fallback also failed: ${err instanceof Error ? err.message : String(err)}`);
				return 1;
			}
			// Migrate off the pre-retirement VBS launcher (WSH may be gone).
			rmSync(windowsLegacyLauncherPath(), { force: true });
			const registered = registerWindowsRunValue(runCmd);
			if (!registered.ok) {
				out(`  Run-key registration failed: ${registered.stderr.trim()}`);
				return 1;
			}
			await drainRunningEngine();
			const startRes = startWindowsWatchdog(launcher);
			if (!startRes.ok) {
				out(`  Register-ScheduledTask failed: ${reg.stderr.trim().split("\n")[0]}`);
				out(`  logon watchdog written but could not start now: ${startRes.stderr.trim()}`);
				out(`  it will run at the next logon: ${launcher}`);
				return 1;
			}
			out(`  task registration refused (${reg.stderr.trim().split("\n")[0]})`);
			out(`  logon watchdog: ${launcher} (HKCU Run, hidden, restart on failure - no admin, no WSH)`);
		}
	} else {
		out(`engine service: no supported service manager on ${process.platform}`);
		out("  the agent-side auto-start still spawns the engine on the next note/session touchpoint");
		return 2;
	}

	// Receipt: the engine answering HTTP after the service started it.
	const up = await waitEngineHealthy(25_000);
	if (up) {
		out(
			sessionOnlyLaunch
				? "engine: UP for this session only — the agent starts at your next desktop login (no GUI session now)"
				: "engine: UP under the OS service — routines now fire even with no agent in use",
		);
	} else {
		out("engine: service installed, but the engine is not healthy yet (it may still be booting)");
		out(`  check: ${spec.logFile}`);
		return 1;
	}
	out("  routines tip: for slots that MUST survive downtime, create them with --misfire catch-up");
	return 0;
}

/** `unown engine uninstall` — stop + remove the OS service (idempotent).
 *  Records the opt-out so the next install/update does not re-add it. */
export async function uninstallEngineService(
	out: (s: string) => void,
	env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
	const kind = detectServiceManager();
	if (kind === "systemd-user") {
		const unit = systemdUnitPath();
		if (!existsSync(unit)) {
			out("engine service: not installed (nothing to remove)");
			markServiceUninstalled(env);
			out("  noted: the installer will not add it back (unown engine install re-enables it)");
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
			markServiceUninstalled(env);
			out("  noted: the installer will not add it back (unown engine install re-enables it)");
			return 0;
		}
		rmSync(plist, { force: true });
		out("engine service: stopped and removed (launchd agent)");
	} else if (kind === "schtasks") {
		const launcher = windowsLauncherPath();
		const legacy = windowsLegacyLauncherPath();
		const hadLauncher = existsSync(launcher) || existsSync(legacy);
		const hadRunValue = readWindowsRunValue() !== null;
		const taskQuery = runCaptured("schtasks", ["/Query", "/TN", ENGINE_SERVICE_NAME], 5000);
		if (!taskQuery.ok && !hadLauncher && !hadRunValue) {
			out("engine service: not installed (nothing to remove)");
			markServiceUninstalled(env);
			out("  noted: the installer will not add it back (unown engine install re-enables it)");
			return 0;
		}
		let ok = true;
		if (taskQuery.ok) {
			// Stop-ScheduledTask is a hard terminate; drain first so the WAL
			// checkpoints and the single-instance lock releases cleanly.
			await drainRunningEngine();
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
			if (!un.ok) {
				out(`  Unregister-ScheduledTask failed: ${un.stderr.trim()}`);
				ok = false;
			}
		}
		if (hadRunValue || hadLauncher) {
			// The hidden watchdog waits on the engine: the HTTP drain exits its
			// loop cleanly, then the registration and the script may go.
			await drainRunningEngine();
			removeWindowsFallback();
		}
		if (!ok) return 1;
		out("engine service: stopped and removed (scheduled task / logon watchdog)");
	} else {
		out(`engine service: no service manager on ${process.platform} — nothing installed`);
		return 0;
	}
	markServiceUninstalled(env);
	out("  noted: install/update will not add it back (unown engine install re-enables it)");
	out("  the engine stays down until: unown engine start  (or the next note/session touchpoint)");
	return 0;
}
