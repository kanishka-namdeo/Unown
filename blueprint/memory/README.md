# Tiered memory in Unown

Unown mirrors Claude Code's native CLAUDE.md hierarchy and makes it observable.

## The four tiers

| Tier | File (Linux/macOS example) | Scope | Committed? |
|------|---------------------------|-------|------------|
| 1 — Managed policy | `/etc/claude-code/CLAUDE.md` · macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md` | Organization-wide mandates (IT/DevOps) | n/a (machine-local) |
| 2 — User | `~/.claude/CLAUDE.md` | Personal preferences across all projects | no |
| 3 — Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team conventions, shared via git | yes |
| 4 — Local override | `./CLAUDE.local.md` | Personal per-project prefs | **no (gitignored)** |

## Resolution semantics (the part most people get wrong)

Claude Code **concatenates** tiers into context; it does not shadow files like
a config cascade. Effective precedence therefore comes from *specificity of
instruction*: later-loading, more-specific guidance wins on conflicts, and the
managed tier additionally feeds policy settings honored above everything.

Two consequences Unown exploits:

1. `CLAUDE.local.md` is a legitimate override lane for personal rules without
   forking team memory.
2. Long-term memory hygiene is about **editing project CLAUDE.md** to remove
   stale/duplicated bullets — which is exactly what the auto-dreamer proposes
   nightly (`dreams/dream.py` → PR).

## Imports

Any tier can pull in more files with `@path/to/file` (relative to the file
containing the import; max recursion depth 4 hops). Wrap in backticks to
mention without importing. Use imports for big topic files, not as an excuse
to stuff everything into context at launch.

## Observability: digest.py

```bash
python3 memory/digest.py            # human-readable stack for cwd
python3 memory/digest.py --json     # machine-readable
```

The SessionStart hook runs this automatically and prints the stack into every
session so both you and Claude know which memories are in play.
