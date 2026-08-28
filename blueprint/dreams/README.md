# Dreams — memory consolidation pipeline

Hooks write session notes here (`sessions/`); `dream.py` folds them into a
single consolidation proposal per run (`consolidated/<date>.md`) that a human
reviews before anything touches `CLAUDE.md`.

```
Stop/SubagentStop hooks ──▶ dreams/sessions/*.md ──▶ dream.py (bounded batch)
                                                      │
                        ┌─────────────────────────────┤
                        ▼                             ▼
              headless auto-dreamer         offline mechanical merge
             (dedupe · flag conflicts      (exact-dup merge, marked
              · prune stale)                UNREFINED)
                        └──────────────┬──────────────┘
                                       ▼
                     dreams/consolidated/<date>.md  ──▶ human review
                                       │                    │
                                       ▼                    ▼
                         approved bullets → CLAUDE.md   nightly PR (CI)
```

## Operating

```bash
python3 dreams/dream.py --dry-run    # inspect the batch that would be sent
python3 dreams/dream.py --offline    # keyless mechanical merge
python3 dreams/dream.py              # one small-model headless call
DREAM_MAX_NOTES=20 python3 dreams/dream.py   # tighter input cap
```

State lives in `dreams/state.json` (already-consolidated note files), so runs
are incremental and idempotent. Delete it to force re-processing.

Design rules follow ACE-style itemized merging: never rewrite the whole memory
blob; produce bullets + explicit removals/conflicts, and let deterministic
tooling (and humans) do the promotion.
