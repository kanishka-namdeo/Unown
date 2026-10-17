import { formatHeader, formatNote } from "./format.ts";
import { formatNoteTable } from "./format-table.ts";
import { Notebook } from "./notebook.ts";
import { findMatches } from "./search.ts";
import { authorStats, totalWords } from "./stats.ts";
import { UserDirectory } from "./users.ts";

/** Dependencies injected by callers (tests) so state is explicit. */
export interface CliDeps {
	notebook: Notebook;
	users: UserDirectory;
}

function flagValue(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/**
 * Run one CLI invocation and return its output text.
 *
 *   clippad add <title> --body <text> --author <name> [--tags a,b]
 *   clippad list
 *   clippad table
 *   clippad stats
 *   clippad find <query>
 *   clippad author <id>
 */
export function runCli(argv: string[], deps: CliDeps): string {
	const { notebook, users } = deps;
	const [cmd, ...rest] = argv;

	switch (cmd ?? "") {
		case "add": {
			const title = rest[0] ?? "";
			const body = flagValue(rest, "--body") ?? "";
			const authorName = flagValue(rest, "--author") ?? "anonymous";
			const tags = (flagValue(rest, "--tags") ?? "")
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
			const author = users.ensure(authorName);
			const note = notebook.add({ title, body, createdBy: author, tags });
			return `added ${note.id}`;
		}
		case "list": {
			const all = notebook.all();
			if (all.length === 0) return "no notes";
			return [formatHeader("All notes", all.length), ...all.map(formatNote)].join("\n");
		}
		case "table": {
			const all = notebook.all();
			if (all.length === 0) return "no notes";
			return formatNoteTable(all);
		}
		case "stats": {
			const rows = authorStats(notebook.all());
			if (rows.length === 0) return "no stats";
			return rows.map((r) => `${r.name} (${r.id}): ${r.count} notes, ${r.words} words`).join("\n");
		}
		case "find": {
			const hits = findMatches(notebook.all(), rest[0] ?? "");
			if (hits.length === 0) return "no matches";
			return [formatHeader("Matches", hits.length), ...hits.map(formatNote)].join("\n");
		}
		case "author": {
			const hits = notebook.byAuthor(rest[0] ?? "");
			if (hits.length === 0) return "no notes";
			return [formatHeader(`Author ${rest[0] ?? ""}`, hits.length), ...hits.map(formatNote)].join("\n");
		}
		case "total": {
			return `total ${totalWords(notebook.all())} words`;
		}
		default:
			return "usage: clippad add|list|table|stats|find|author|total <args>";
	}
}

/** Fresh deps bundle: an empty notebook and an empty user directory. */
export function freshDeps(): CliDeps {
	return { notebook: new Notebook(), users: new UserDirectory() };
}
