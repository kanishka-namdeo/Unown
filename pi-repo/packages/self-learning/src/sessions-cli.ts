/**
 * sessions-cli.ts — `unown sessions <sub>` (Milestone 3.5).
 *
 * Three subcommands:
 *   unown sessions list                          list persisted sessions in cwd
 *   unown sessions export <session-id> [--out F] write the export JSON
 *   unown sessions import <file> [--from F]      rehydrate an export JSON — or
 *                                                 convert a Claude Code / Codex
 *                                                 session .jsonl (import-convert.ts)
 *
 * Pattern matches `automations-cli.ts` / `mcp-cli.ts`: returns an exit code,
 * writes to stdout/stderr directly. The actual export/import logic lives in
 * `sessions.ts` (pure); this module owns argv parsing + constructing a
 * minimal `SessionLike` from the JSONL file on disk.
 *
 * NO pi imports — `runSessionsCommand` reads the session .jsonl directly
 * (a header line + N entry lines, each a JSON object) and constructs a
 * `SessionLike` from the parsed entries. This is enough for `exportSession`,
 * which only needs `getSessionId` / `getCwd` / `getEntries` / `getHeader`.
 * The full SessionManager (with branch / append / tree traversal) is only
 * needed for live in-session operations — the CLI is offline (no live session
 * to mutate).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { exportFromFile } from "@earendil-works/pi-coding-agent";
import { redactSecretsCounted } from "./adversary.ts";
import { convertAndWriteSession, detectSessionFormat, type SessionFormat } from "./import-convert.ts";
import { type SessionCandidate, scanSessions } from "./resume.ts";
import {
	appendSessionInfoEntry,
	exportSession,
	exportSessionMarkdown,
	importSession,
	listAllSessions,
	listSessions,
	listUserSessions,
	type SessionEntryLike,
	type SessionLike,
} from "./sessions.ts";
import { resolveUnownHome, resolveUserSessionDir } from "./unown-home.ts";

export const SESSIONS_USAGE = `unown sessions — session resume / export / import / list / delete / rename

Usage:
  unown sessions resume [<id|name|path>]
                          resume interactively (TUI) — the noun-verb twin of
                          \`--resume <query>\`; bare = the interactive picker;
                          composes with -p "..." like the flag lane
  unown sessions list [--all]
  unown sessions export <session-id> [--format <md|json|html>] [--out <file>] [--raw]
  unown sessions import <file> [--from <auto|claude|codex|unown>]
  unown sessions delete <id|name> [--force]
  unown sessions rename <id|name> <new-name>

Sessions are found in BOTH stores: the project lane (<cwd>/.unown/sessions —
imports) and the user lane (~/.unown/agent/sessions — every real TUI / print
session, filtered to this project by the session header's cwd). --all drops
the project filter and lists every session on the machine.

The exported JSON contains { version, manifest, messages, todos, notes, skills,
files } — a single self-describing file you can rehydrate on another machine
with \`unown sessions import\`. The imported session appears in \`unown sessions
list\` with a fresh id (the original id is preserved in the manifest for
traceability). --format md renders the same data as a shareable markdown
transcript (the Codex /export and goose \`session export md\` lane): metadata
header, todos, notes, and the conversation with tool-call bullets and fenced
tool results. --format html runs pi's own themed, XSS-hardened /export
renderer (the Claude Code /export shape: a standalone self-styled page you
can open in any browser and archive).

\`sessions delete\` removes the resolved session .jsonl from disk (both
stores; \`--resume <query>\` resolution: id or id-prefix first, then the
latest session_info name — ambiguous names list the candidates and refuse).
\`sessions rename\` appends a session_info name entry to the resolved file
(the offline lane for what /name does live — \`unown --resume <new-name>\`
resolves it immediately; deleting a session a LIVE TUI still holds open is
refused without --force: the running session would re-create it on its next
append).

\`sessions resume\` (the sessions round, 2026-10-31) is NOT a management
subcommand — it rewrites onto the flag lane (\`--resume <query>\` / the bare
picker) and boots the TUI, or print mode when composed with \`-p "…"\`, with
the same path → id → name resolution ladder and both stores as
\`unown --resume\` itself.

\`sessions import\` also converts FOREIGN agent transcripts (the migration
path away from Claude Code / Codex CLI, which both ship /import themselves):
a Claude Code session (~/.claude/projects/<slug>/*.jsonl) or a Codex rollout
(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) is rewritten into a native
unown session .jsonl with fresh ids and a linear parent chain, landing in the
same .unown/sessions directory — \`--from\` names the source explicitly
(claude | codex | unown), the default \`auto\` sniffs the line shapes, and a
plain unown export JSON keeps flowing through the rehydrate path above.

Exports are REDACTED by default: known secret shapes (API keys, PATs, PEM
blocks, bearer tokens) become [REDACTED:<type>] markers, because a transfer
artifact routinely changes hands — the HTML lane redacts the rendered page
after generation (same secret shapes, same markers). --raw opts out for a
lossless self-transfer between machines you own.

Docs: docs/usage.md (sessions).`;

/** The `sessions resume` rewrite result (the dispatch in cli.ts consumes
 *  this; exported for the unit tests). */
export type SessionsResumeRewrite = { kind: "help" } | { kind: "rewrite"; argv: string[] };

/** Rewrite `unown sessions resume …` onto the flag lane — the noun-verb
 *  twin of `--resume …` (Codex `codex resume` muscle memory; the sessions
 *  family's central verb). EVERYTHING after `resume` flows exactly as it
 *  would after `--resume`: bare = the picker, `<query>` resolves through
 *  the path → id → name ladder, and later flags/positional prompt text
 *  compose identically (`-p "…"`, a starting prompt, routing flags) — one
 *  grammar, two spellings, zero divergence. */
export function rewriteSessionsResume(argv: string[]): SessionsResumeRewrite {
	// argv is the full CLI argv starting at "sessions".
	if (argv[2] === "-h" || argv[2] === "--help") return { kind: "help" };
	return { kind: "rewrite", argv: ["--resume", ...argv.slice(2)] };
}

function flagValue(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
	return argv.includes(name);
}

/** First positional (non-flag) argument in `argv`, skipping flags and the
 *  values of value-taking flags — so `import <file> --from <fmt>` and
 *  `import --from <fmt> <file>` both find <file>. */
function positionalArg(argv: string[], valueFlags: string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("-")) {
			if (valueFlags.includes(arg) && i + 1 < argv.length) i++; // skip the flag's value
			continue;
		}
		return arg;
	}
	return undefined;
}

/**
 * Try the foreign-format conversion path for `unown sessions import` (the
 * `--from` flag / .jsonl transcripts from Claude Code or Codex). Returns the
 * exit code when the file was handled — converted successfully, or skipped
 * with a reason — and null when the caller should fall through to the
 * portable-JSON `importSession` path (missing file, or an unknown shape
 * under `auto` that may still be an export JSON).
 *
 * Writes into the SAME directory `importSession` uses
 * (`<cwd>/.unown/sessions`) so the converted session shows up in `unown
 * sessions list` and /resume immediately.
 */
function importForeignSession(file: string, from: string, cwd: string): number | null {
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return null; // missing/unreadable — importSession reports the error
	}
	const lines = raw.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length === 0) return null;
	const format: SessionFormat = from === "auto" ? detectSessionFormat(lines) : (from as SessionFormat);
	if (format === "unknown") return null;
	const result = convertAndWriteSession(lines, {
		format,
		targetDir: join(cwd, ".unown", "sessions"),
		fallbackCwd: cwd,
	});
	const { path: convertedPath, bytes } = result;
	if (result.skipped || convertedPath === undefined || bytes === undefined) {
		process.stderr.write(`unown sessions import: ${result.reason ?? "conversion produced no session"}\n`);
		return 1;
	}
	// Re-read the written file for the summary line (fresh id + message
	// count) — convertAndWriteSession's return stays deliberately minimal.
	const written = readFileSync(convertedPath, "utf8")
		.split("\n")
		.filter((l) => l.trim().length > 0);
	let newId = "";
	let messages = 0;
	try {
		const header = JSON.parse(written[0]) as Record<string, unknown>;
		if (typeof header.id === "string") newId = header.id;
	} catch {
		// unreachable — writeConvertedSession just serialized this file
	}
	for (const line of written.slice(1)) {
		try {
			if ((JSON.parse(line) as Record<string, unknown>).type === "message") messages++;
		} catch {}
	}
	process.stdout.write(
		`✓ Imported ${format} session → new id ${newId} (${messages} messages, ${bytes} bytes) — /resume or unown sessions list will show it\n`,
	);
	return 0;
}

/**
 * Read a session .jsonl file and construct a minimal `SessionLike` for
 * `exportSession`. The first line is the session header; subsequent lines
 * are entries (messages, model_changes, etc.). Malformed lines are skipped
 * (mirrors `loadEntriesFromFile`'s tolerant parsing in pi-coding-agent).
 *
 * Used by the CLI to avoid a hard dependency on the pi `SessionManager`
 * (which would require spawning pi / opening the agent dir). The CLI is
 * offline — no live session to mutate, so we don't need branch/append.
 */
class FileSessionLike implements SessionLike {
	private readonly sessionId: string;
	private readonly cwd: string;
	private readonly entries: SessionEntryLike[];
	private readonly headerTimestamp: string;
	constructor(file: string) {
		const content = readFileSync(file, "utf8");
		const lines = content.split("\n").filter((l) => l.trim().length > 0);
		if (lines.length === 0) throw new Error(`empty session file: ${file}`);
		const header = JSON.parse(lines[0]);
		if (header.type !== "session" || typeof header.id !== "string") {
			throw new Error(`not a session file (first line is not a session header): ${file}`);
		}
		this.sessionId = header.id;
		this.cwd = typeof header.cwd === "string" ? header.cwd : process.cwd();
		this.headerTimestamp = typeof header.timestamp === "string" ? header.timestamp : new Date().toISOString();
		const entries: SessionEntryLike[] = [];
		for (let i = 1; i < lines.length; i++) {
			try {
				const entry = JSON.parse(lines[i]);
				if (entry && typeof entry.type === "string" && typeof entry.id === "string") {
					entries.push(entry as SessionEntryLike);
				}
			} catch {}
		}
		this.entries = entries;
	}
	getSessionId(): string {
		return this.sessionId;
	}
	getCwd(): string {
		return this.cwd;
	}
	getEntries(): SessionEntryLike[] {
		return this.entries;
	}
	getHeader() {
		return { id: this.sessionId, timestamp: this.headerTimestamp, cwd: this.cwd };
	}
}

/** Strict multi-match resolution for the destructive session commands
 *  (delete/rename): the --resume grammar (existing file path -> id or id
 *  prefix/substring -> latest session_info name, case-insensitive) but EVERY
 *  match is returned — never the resume lane's newest-wins guess for
 *  same-named duplicates (forks/clones). The caller refuses >1. */
function findSessionTargets(cwd: string, agentDir: string, query: string): SessionCandidate[] {
	const q = query.trim();
	if (!q) return [];
	// 1. An existing session file (the --session spelling).
	const asPath = isAbsolute(q) ? q : resolve(cwd, q);
	if (existsSync(asPath) && asPath.endsWith(".jsonl")) {
		return [{ file: asPath, id: basename(asPath, ".jsonl"), mtime: 0 }];
	}
	// 2. Id lane (full, prefix or substring — ids live in the filename stem).
	const qLower = q.toLowerCase();
	const candidates = scanSessions(cwd, agentDir);
	const idHits = candidates.filter(
		(c) => c.id.toLowerCase().includes(qLower) || basename(c.file, ".jsonl").toLowerCase().includes(qLower),
	);
	if (idHits.length > 0) return idHits;
	// 3. Name lane (latest session_info, case-insensitive substring).
	return candidates.filter((c) => c.name?.toLowerCase().includes(qLower));
}

/** Exit-code-returning entry point. `argv` is everything AFTER `unown sessions`
 *  (e.g. `["export", "<id>", "--out", "<path>"]`). */
export async function runSessionsCommand(argv: string[]): Promise<number> {
	const sub = argv[0] ?? "list";

	if (hasFlag(argv, "-h") || hasFlag(argv, "--help") || sub === "help") {
		process.stdout.write(SESSIONS_USAGE + "\n");
		return 0;
	}

	const cwd = process.cwd();

	if (sub === "list") {
		const userSessionDir = resolveUserSessionDir();
		const all = hasFlag(argv, "--all");
		// --all: every session in the user store regardless of project (the
		// Codex `resume --all` / Claude Ctrl+A lane), UNION the project imports.
		const sessions = all
			? listUserSessions({ userSessionDir, allProjects: true })
			: listAllSessions({ cwd, userSessionDir });
		if (sessions.length === 0) {
			process.stdout.write(
				all
					? "No sessions found on this machine.\n"
					: "No sessions found in this project. Run `unown` to start one.\n",
			);
			return 0;
		}
		const lines = sessions.map((s) => {
			const date = new Date(s.createdAt).toISOString().replace("T", " ").slice(0, 19);
			const fileCount = s.touchedFiles.length;
			const filesSuffix = fileCount > 0 ? ` · ${fileCount} file(s)` : "";
			// The name lane (2026-10-25): a titled session is addressable as
			// `unown --resume <name>` / `unown sessions delete <name>` — show
			// it so the workflow is discoverable from the list itself.
			const nameSuffix = s.name ? ` · "${s.name}"` : "";
			return `${s.id}  ${date}  · ${s.messageCount} msg(s)${filesSuffix}${nameSuffix}`;
		});
		// The sessions round: the resume hint — the list is the discovery
		// surface, so it names every resume spelling (flag + noun-verb +
		// in-session picker) right where the ids live.
		const hint =
			"\nresume: unown -c · unown sessions resume <id|name> · unown --resume <id|name|path> · /resume in-session\n";
		process.stdout.write(lines.join("\n") + hint);
		return 0;
	}

	if (sub === "export") {
		const sessionId = argv[1];
		if (!sessionId || sessionId.startsWith("--")) {
			process.stderr.write(
				"usage: unown sessions export <session-id> [--format <md|json|html>] [--out <file>] [--raw]\n",
			);
			return 1;
		}
		const out = flagValue(argv, "--out");
		const raw = hasFlag(argv, "--raw");
		const formatFlag = flagValue(argv, "--format");
		const format =
			formatFlag === "md" || formatFlag === "markdown"
				? "md"
				: formatFlag === "json"
					? "json"
					: formatFlag === "html"
						? "html"
						: undefined;
		if (format === undefined && formatFlag !== undefined) {
			process.stderr.write(`unown sessions export: invalid --format "${formatFlag}" (expected md, json or html)\n`);
			return 1;
		}
		const userSessionDir = resolveUserSessionDir();
		// Resolution matches delete/rename (the 2026-10-25 completion round):
		// id, id-prefix or the session NAME — a titled session is exportable
		// exactly the way it is resumable, deletable and renamable. Multi-match
		// refuses with the candidates (an export must never pick a file the
		// user could not name).
		const agentDir = join(resolveUnownHome(), "agent");
		const targets = findSessionTargets(cwd, agentDir, sessionId);
		if (targets.length === 0) {
			process.stderr.write(
				`unown sessions export: no session file matching "${sessionId}" (id or name) in either store — \`unown sessions list\` shows them\n`,
			);
			return 1;
		}
		if (targets.length > 1) {
			process.stderr.write(
				`unown sessions export: "${sessionId}" matches ${targets.length} sessions — use the id for an exact pick:\n`,
			);
			for (const t of targets.slice(0, 5)) {
				process.stderr.write(`  ${t.id}${t.name ? ` - ${t.name}` : ""}  (${basename(t.file)})\n`);
			}
			return 1;
		}
		const sessionFile = targets[0].file;
		try {
			if (format === "html") {
				// pi's own /export renderer over the offline file (the 2026-10-25
				// completion round — Claude Code's /export shape, from the session
				// the CLI can reach). REDACTION IS A PRE-PASS, not a post-pass:
				// the renderer syntax-highlights message text, so a secret can be
				// split across <span>s in the page and a post-render scrub would
				// miss it — instead the raw JSONL is redacted FIRST (the same
				// secret shapes, the same [REDACTED:*] markers as the md/json
				// lanes) and the renderer then renders the markers. --raw
				// renders the file verbatim.
				let redacted = 0;
				let sourceFile = sessionFile;
				let tmpRedacted: string | undefined;
				if (!raw) {
					const content = readFileSync(sessionFile, "utf8");
					const pass = redactSecretsCounted(content);
					if (pass.count > 0) {
						redacted = pass.count;
						tmpRedacted = `${sessionFile}.redacted-tmp`;
						writeFileSync(tmpRedacted, pass.text);
						sourceFile = tmpRedacted;
					}
				}
				const htmlOut = out ?? join(cwd, ".unown", "sessions", `export-${targets[0].id.slice(0, 8)}.html`);
				mkdirSync(dirname(htmlOut), { recursive: true }); // the md/json default lanes materialize it; html must too
				await exportFromFile(sourceFile, htmlOut);
				if (tmpRedacted) rmSync(tmpRedacted);
				const bytes = statSync(htmlOut).size;
				const redactionNote =
					redacted > 0
						? ` — ${redacted} secret${redacted === 1 ? "" : "s"} redacted ([REDACTED:*] markers; --raw keeps them verbatim)`
						: "";
				process.stdout.write(
					`✓ Exported session ${sessionId} → ${htmlOut} (${bytes} bytes, html)${redactionNote}\n`,
				);
				return 0;
			}
			let sm: SessionLike;
			try {
				sm = new FileSessionLike(sessionFile);
			} catch (err: any) {
				process.stderr.write(
					`unown sessions export: cannot open session: ${err instanceof Error ? err.message : String(err)}\n`,
				);
				return 1;
			}
			const result =
				format === "md"
					? await exportSessionMarkdown(sm.getSessionId(), {
							sessionManager: sm,
							outPath: out,
							redact: !raw,
						})
					: await exportSession(sm.getSessionId(), {
							sessionManager: sm,
							outPath: out,
							redact: !raw,
						});
			const redactionNote =
				result.redacted > 0
					? ` — ${result.redacted} secret${result.redacted === 1 ? "" : "s"} redacted ([REDACTED:*] markers; --raw keeps them verbatim)`
					: "";
			process.stdout.write(
				`✓ Exported session ${sm.getSessionId()} → ${result.path} (${result.bytes} bytes${format === "md" ? ", markdown" : ""})${redactionNote}\n`,
			);
			return 0;
		} catch (err: any) {
			process.stderr.write(`unown sessions export: ${err instanceof Error ? err.message : String(err)}\n`);
			return 1;
		}
	}

	if (sub === "import") {
		const file = positionalArg(argv.slice(1), ["--from"]);
		if (!file) {
			process.stderr.write("usage: unown sessions import <file> [--from <auto|claude|codex|unown>]\n");
			return 1;
		}
		const from = flagValue(argv, "--from") ?? "auto";
		if (from !== "auto" && from !== "claude" && from !== "codex" && from !== "unown") {
			process.stderr.write(
				`unown sessions import: invalid --from value "${from}" (expected auto, claude, codex or unown)\n`,
			);
			return 1;
		}
		// Foreign transcripts (Claude Code / Codex .jsonl) are CONVERTED into
		// a native unown session instead of rehydrating a portable export.
		if (file.endsWith(".jsonl") || from !== "auto") {
			const code = importForeignSession(file, from, cwd);
			if (code !== null) return code;
			// null: not a convertible foreign session — fall through to the
			// portable-JSON path below, which reports its own clear errors.
		}
		try {
			const result = await importSession(file);
			process.stdout.write(`✓ Imported session → new id ${result.sessionId} (${result.bytes} bytes written)\n`);
			return 0;
		} catch (err: any) {
			process.stderr.write(`unown sessions import: ${err instanceof Error ? err.message : String(err)}\n`);
			return 1;
		}
	}

	if (sub === "delete" || sub === "rename") {
		// The 2026-10-25 completion round: the missing half of the session
		// lifecycle. Every competitor ships it — Codex `codex delete|rename`,
		// OpenCode `session delete|rename`, Gemini's picker `x` — while a
		// unown session could only ever be CREATED (start/resume/import).
		//
		// Resolution is the --resume lane's grammar (path -> id/prefix ->
		// latest session_info name) but STRICTER: destructive commands
		// refuse every multi-match, including the same-named duplicates
		// resume intentionally resolves newest-wins (forks/clones) —
		// deleting "the newest of two" without saying which is how
		// sessions get lost.
		const positional = positionalArg(argv.slice(1), []);
		if (!positional) {
			process.stderr.write(
				sub === "delete"
					? "usage: unown sessions delete <id|name> [--force]\n"
					: "usage: unown sessions rename <id|name> <new-name>\n",
			);
			return 1;
		}
		const agentDir = join(resolveUnownHome(), "agent");
		const targets = findSessionTargets(cwd, agentDir, positional);
		if (targets.length === 0) {
			process.stderr.write(
				`unown sessions ${sub}: no session matches "${positional}" in either store — \`unown sessions list\` shows them\n`,
			);
			return 1;
		}
		if (targets.length > 1) {
			process.stderr.write(
				`unown sessions ${sub}: "${positional}" matches ${targets.length} sessions — use the id for an exact pick:\n`,
			);
			for (const t of targets.slice(0, 5)) {
				process.stderr.write(`  ${t.id}${t.name ? ` - ${t.name}` : ""}  (${basename(t.file)})\n`);
			}
			return 1;
		}
		const res = targets[0];
		if (sub === "delete") {
			// Live-session guard: a TUI/print session that is still running
			// holds the file as its append target — deleting it out from under
			// the process means its NEXT append recreates the file as a
			// header-less orphan. The mtime-based heuristic: modified within
			// the last 30 s means "probably live" (a settled session's mtime
			// is its last write). --force is the informed override.
			const force = hasFlag(argv, "--force");
			try {
				const mtime = statSync(res.file).mtimeMs;
				if (!force && Date.now() - mtime < 30_000) {
					process.stderr.write(
						`unown sessions delete: ${basename(res.file)} was modified ${((Date.now() - mtime) / 1000) | 0}s ago — it looks like a LIVE session.\n` +
							"  quit that session first, or pass --force if you are sure (its next append would recreate the file)\n",
					);
					return 1;
				}
			} catch {
				/* stat failed — rmSync below reports the real error */
			}
			try {
				rmSync(res.file);
			} catch (err: any) {
				process.stderr.write(`unown sessions delete: ${err instanceof Error ? err.message : String(err)}\n`);
				return 1;
			}
			process.stdout.write(`✓ Deleted session ${res.id}${res.name ? ` ("${res.name}")` : ""} — ${res.file}\n`);
			return 0;
		}
		// rename: positional = target, the NEXT positional = the new name.
		const args = argv.slice(1);
		const targetIdx = args.indexOf(positional);
		const newName = args[targetIdx + 1];
		if (!newName || newName.startsWith("-")) {
			process.stderr.write("usage: unown sessions rename <id|name> <new-name>\n");
			return 1;
		}
		try {
			const appended = appendSessionInfoEntry(res.file, newName);
			process.stdout.write(
				`✓ Renamed session ${res.id} → "${appended.name}" (unown --resume "${appended.name}" resolves it; /name in a live session stays the in-TUI lane)\n`,
			);
			return 0;
		} catch (err: any) {
			process.stderr.write(`unown sessions rename: ${err instanceof Error ? err.message : String(err)}\n`);
			return 1;
		}
	}

	process.stderr.write(`unown sessions: unknown subcommand "${sub}"\n\n${SESSIONS_USAGE}\n`);
	return 1;
}
