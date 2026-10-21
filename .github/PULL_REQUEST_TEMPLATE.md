## Summary

What this PR changes, and why. One paragraph; name the surfaces touched (agent CLI / engine / TUI dashboard / bridge / landing / docs / benchmarks / scripts).

## Verification run

Commands you ran and their receipts. Measured claims cite their artifact paths (`docs/testing-strategy.md`, `benchmarks/memory-eval/*/RESULTS.md`); suite runs state pass/fail counts.

```
<paste commands and output tails here>
```

## Checklist

- [ ] All suites green (landing `bun run test:unit`, engine + TUI dashboard `pi-repo/packages/self-learning`, bridge `mini-services/llm-bridge`); tests pin any new behavior
- [ ] DOX pass: nearest AGENTS.md updated (parents too, if structure changed); stale or contradictory text removed
- [ ] CHANGELOG.md updated for user-visible changes; an "Agent Behavior" entry if prompts, models, routing, guard rules, hooks or memory injection changed (policy: docs/BEHAVIOR.md)
- [ ] Staged with explicit paths (`git add <paths>`, never `git add -A`) — `git status` reviewed for engine auto-commits
- [ ] Secrets clean: keys only in `.env`, PAT only in the remote URL — nothing in tracked files, docs, logs, or commit messages
