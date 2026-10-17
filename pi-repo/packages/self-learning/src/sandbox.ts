/**
 * sandbox.ts — the sandbox library (deploy + test isolation).
 *
 * Every agent run (baseline, candidate, regression, interactive) executes
 * inside its own sandbox: a fresh directory under DATA/sandboxes/<id>/workspace
 * with a jailed path policy, a hardened bash deny-list, timeout- and
 * output-capped child processes, and per-run artifacts (seed manifest,
 * verify output, changed-file snapshot).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { osSandboxAvailable, resolveOsSandboxBackend, wrapCommand } from "./bwrap.ts";
import { DATA_DIR, store } from "./store.ts";

export const SANDBOXES_DIR = join(DATA_DIR, "sandboxes");

export interface Sandbox {
	id: string;
	root: string; // <sandboxes>/<id>
	workspace: string; // <root>/workspace
	createdAt: number;
}

export function createSandbox(label: string): Sandbox {
	const id = `${label
		.replace(/[^a-z0-9-]/gi, "-")
		.toLowerCase()
		.slice(0, 24)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	const root = join(SANDBOXES_DIR, id);
	const workspace = join(root, "workspace");
	mkdirSync(workspace, { recursive: true });
	const sandbox: Sandbox = { id, root, workspace, createdAt: Date.now() };
	writeFileSync(join(root, "sandbox.json"), JSON.stringify({ id, label, createdAt: sandbox.createdAt }, null, 2));
	return sandbox;
}

export function seedFiles(sandbox: Sandbox, files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		const target = resolve(sandbox.workspace, path);
		if (!target.startsWith(sandbox.workspace)) throw new Error(`seed path escapes sandbox: ${path}`);
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(target, content, "utf8");
	}
	writeFileSync(join(sandbox.root, "seed-manifest.json"), JSON.stringify(Object.keys(files), null, 2));
}

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	durationMs: number;
	/** Which OS sandbox the command ran under: "bwrap" (Linux), "seatbelt"
	 *  (macOS) or "process" when no OS sandbox was available (TS path jail
	 *  only — the transparent fallback). */
	isolation: "bwrap" | "seatbelt" | "process";
}

const MAX_OUTPUT = 60_000;

/** Child env for sandbox commands. HOME and USERPROFILE are BOTH pinned to
 *  the sandbox root — POSIX ignores USERPROFILE and Windows ignores HOME, so
 *  setting both is harmless everywhere and correct on each platform. The
 *  POSIX PATH fallback applies only on POSIX hosts with PATH unset; on win32
 *  a POSIX PATH string would poison the child, so there we omit PATH entirely
 *  (the child falls back to the OS default search). */
function buildSandboxChildEnv(sandboxRoot: string, extra?: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = { HOME: sandboxRoot, USERPROFILE: sandboxRoot };
	if (process.env.PATH) env.PATH = process.env.PATH;
	else if (process.platform !== "win32") env.PATH = "/usr/local/bin:/usr/bin:/bin";
	return { ...env, ...extra };
}

export async function execInSandbox(
	sandbox: Sandbox,
	command: string[],
	opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<ExecResult> {
	const started = Date.now();
	const timeoutMs = opts.timeoutMs ?? 30_000;
	let timedOut = false;
	// OS-level isolation when a backend is available (bubblewrap on Linux,
	// seatbelt on macOS; fs + net confinement around the TS path jail);
	// transparent fallback to plain exec.
	let isolation: ExecResult["isolation"] = "process";
	let cmd = command;
	if (await osSandboxAvailable()) {
		const wrapped = wrapCommand(command, sandbox.workspace);
		if (wrapped) {
			cmd = wrapped;
			isolation = resolveOsSandboxBackend() === "seatbelt" ? "seatbelt" : "bwrap";
		}
	}
	const proc = Bun.spawn(cmd, {
		cwd: sandbox.workspace,
		env: buildSandboxChildEnv(sandbox.root, opts.env),
		stdout: "pipe",
		stderr: "pipe",
	});
	const timer = setTimeout(() => {
		timedOut = true;
		// kill(9) is a hard kill. No tree-kill needed: verify/exec commands run
		// `bun` directly (no shell) and the minted verify scripts spawn nothing.
		// (Bun maps kill(9) to TerminateProcess on win32.)
		proc.kill(9);
	}, timeoutMs);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text().then((t) => t.slice(0, MAX_OUTPUT)),
		new Response(proc.stderr).text().then((t) => t.slice(0, MAX_OUTPUT)),
	]);
	const exitCode = await proc.exited;
	clearTimeout(timer);
	return { exitCode, stdout, stderr, timedOut, durationMs: Date.now() - started, isolation };
}

export interface VerifyResult {
	passed: boolean;
	summary: string;
	log: string;
	exitCode: number;
	timedOut: boolean;
}

/**
 * Runs a task's verify script inside the sandbox. The script prints a final
 * `VERIFY_RESULT: {json}` line which we parse as ground truth.
 */
export async function verifyInSandbox(sandbox: Sandbox, verifyScript: string): Promise<VerifyResult> {
	const verifyPath = join(sandbox.workspace, "__verify.mjs");
	writeFileSync(verifyPath, verifyScript, "utf8");
	const res = await execInSandbox(sandbox, ["bun", "run", "__verify.mjs"], { timeoutMs: 60_000 });
	let summary = "";
	let passed = res.exitCode === 0;
	const marker = res.stdout.lastIndexOf("VERIFY_RESULT:");
	if (marker !== -1) {
		try {
			const line = res.stdout
				.slice(marker + "VERIFY_RESULT:".length)
				.split("\n")[0]
				.trim();
			const parsed = JSON.parse(line);
			passed = Boolean(parsed.passed);
			summary = typeof parsed.summary === "string" ? parsed.summary : "";
		} catch {
			/* fall back to exit code */
		}
	}
	const log = [
		res.timedOut ? `!! verify timed out after 60s` : "",
		`$ bun run __verify.mjs  (exit=${res.exitCode})`,
		res.stdout.slice(0, 8000),
		res.stderr ? `--- stderr ---\n${res.stderr.slice(0, 4000)}` : "",
	]
		.filter(Boolean)
		.join("\n");
	return { passed, summary, log, exitCode: res.exitCode, timedOut: res.timedOut };
}

export interface ChangedFile {
	path: string;
	bytes: number;
}

/** Snapshot of workspace files (excluding verify script), capped at 200 files. */
export function snapshotFiles(sandbox: Sandbox): ChangedFile[] {
	const out: ChangedFile[] = [];
	const walk = (dir: string) => {
		if (out.length > 200) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "__verify.mjs" || entry.name === "node_modules") continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else {
				try {
					out.push({ path: relative(sandbox.workspace, full), bytes: statSync(full).size });
				} catch {
					/* ignore */
				}
			}
		}
	};
	walk(sandbox.workspace);
	return out;
}

export function listSandboxes(limit = 60): { id: string; createdAt: number; label: string; files: number }[] {
	if (!existsSync(SANDBOXES_DIR)) return [];
	const out: { id: string; createdAt: number; label: string; files: number }[] = [];
	for (const entry of readdirSync(SANDBOXES_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const root = join(SANDBOXES_DIR, entry.name);
		const meta = join(root, "sandbox.json");
		let createdAt = 0;
		let label = "";
		try {
			const m = JSON.parse(readFileSync(meta, "utf8"));
			createdAt = m.createdAt ?? 0;
			label = m.label ?? "";
		} catch {
			continue;
		}
		let files = 0;
		try {
			files = snapshotFiles({
				id: entry.name,
				root,
				workspace: join(root, "workspace"),
				createdAt,
			} as Sandbox).length;
		} catch {
			/* ignore */
		}
		out.push({ id: entry.name, createdAt, label, files });
	}
	return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** Retention: keep the newest N sandboxes, delete the rest. */
export function gcSandboxes(keep = 40): number {
	if (!existsSync(SANDBOXES_DIR)) return 0;
	const dirs = readdirSync(SANDBOXES_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => ({ name: d.name, mtime: statSync(join(SANDBOXES_DIR, d.name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	let removed = 0;
	for (const d of dirs.slice(keep)) {
		try {
			rmSync(join(SANDBOXES_DIR, d.name), { recursive: true, force: true });
			removed++;
		} catch {
			/* ignore */
		}
	}
	return removed;
}

export function sandboxRunCount(): number {
	const row = store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM runs`);
	return row?.c ?? 0;
}
