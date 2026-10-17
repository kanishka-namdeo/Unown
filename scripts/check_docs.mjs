// Verify every relative link and anchor in a Markdown file resolves.
// Rules (docs/AGENTS.md):
//   - split on /\r?\n/ before heading scans; `.` does not match `\r`, so a naive
//     split makes every anchor look broken;
//   - GitHub slugs: lowercase, punctuation dropped, EACH space -> one hyphen, so
//     a heading containing " - " yields a DOUBLE hyphen;
//   - links are either `file.md` (must exist) or `#slug` (must match a heading).
// Usage: node scripts/check_docs.mjs docs/*.md
// Exit 1 with a report on any unresolved target.
//
// Note: the first line is a `//` comment, not `#`. Some node builds (this
// workspace's included) refuse to parse a module whose first byte is `#`.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function slug(heading) {
	return heading
		.replace(/`/g, "")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

function headings(text) {
	const out = new Set();
	for (const line of text.split(/\r?\n/)) {
		const m = /^(#{1,6})\s+(.*)$/.exec(line);
		if (m) out.add(slug(m[2]));
	}
	return out;
}

function check(file) {
	const text = readFileSync(file, "utf8");
	const anchors = headings(text);
	const problems = [];
	const seen = new Set();

	const link = /\[([^\]]*)\]\(([^)\s]+)\)/g;
	let m;
	while ((m = link.exec(text)) !== null) {
		const [, label, target] = m;
		if (/^(https?:|mailto:)/.test(target)) continue;
		const line = text.slice(0, m.index).split(/\r?\n/).length;
		if (seen.has(target)) continue;
		seen.add(target);

		if (target.startsWith("#")) {
			// Contract files cite example labels in prose; only their file links
			// are load-bearing.
			if (!anchors.has(target.slice(1)) && !/AGENTS\.md$/.test(file)) {
				problems.push(`${file}:${line}  unresolved anchor ${target}  ("${label}")`);
			}
			continue;
		}
		const [path, hash] = target.split("#");
		const abs = resolve(dirname(file), path);
		if (!existsSync(abs)) {
			problems.push(`${file}:${line}  missing file ${target}  ("${label}")`);
			continue;
		}
		if (hash && path.endsWith(".md") && !headings(readFileSync(abs, "utf8")).has(hash)) {
			problems.push(`${file}:${line}  unresolved anchor ${target}`);
		}
	}

	// Real link corruption in this workspace renders as a bare "emory](" label,
	// where the `[memory]` label lost its leading `[mem`. Contract files
	// (AGENTS.md) are excluded: they quote the artifact in prose, so both the
	// string and example labels inside them are intentional.
	if (!/AGENTS\.md$/.test(file) && /(^|[^A-Za-z])emory\]\(/.test(text)) {
		problems.push(`${file}  possible link corruption: bare "emory](" label`);
	}

	return problems;
}

let failed = 0;
for (const file of process.argv.slice(2)) {
	const problems = check(file);
	if (problems.length) {
		failed += problems.length;
		for (const p of problems) console.log(`::error::${p}`);
	} else {
		console.log(`ok  ${file}`);
	}
}
process.exit(failed ? 1 : 0);
