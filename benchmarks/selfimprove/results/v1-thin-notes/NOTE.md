# v1 — auto session notes only (negative result, kept for honesty)

With only the CLI's auto-generated session summaries as notes ("1 prompt(s),
4 tool call(s) ..."), AutoDream consolidated but extracted ZERO entries —
project memory stayed the 11-line template. The warm pass still showed
-25.6% input tokens / -47% wall time, but with an unchanged memory file those
gains are attributable to upstream prompt caching on identical prompts, NOT
to Unown memory. We therefore do not publish v1 as a memory effect.

v2 (the published numbers) asks the agent to actually use the note tool —
the product behavior the memory system is designed around.
