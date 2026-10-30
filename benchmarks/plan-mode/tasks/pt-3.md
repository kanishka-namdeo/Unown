# PT-3 — the slow-resume investigation (bugfix planning)

Prompt (fixed, verbatim):

```
Sessions with very long transcripts take multiple seconds to resume; plan the investigation and the fix. Produce the implementation plan.
```

Run contract: same as pt-1 (`unown --plan --max-turns <cap> -p "<prompt>"`, agnes-3.0-flash via the bridge). An investigation task — the plan should profile first, hypothesize, then fix.
