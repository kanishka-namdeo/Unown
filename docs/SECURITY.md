# Security model

Unown is an autonomous-adjacent system: it edits memory about itself, runs on
schedules, and ingests untrusted GitHub events. These are the controls that
make that safe-ish, and the remaining risks you accept.

## 1. Secrets hygiene

- **No secrets in the repo.** CI reads `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`
  (workflow-scoped), and optional `SLACK_WEBHOOK_URL` from Actions secrets.
- **Pattern-based redaction at every write path.** `.claude/hooks/hooklib.py`
  and the router redact token-shaped strings (`github_pat_…`, `ghp_…`,
  `sk-ant-…`, AWS ids) before any file write or post.
- **Write-gate for secrets.** The PreToolUse hook denies writing
  secret-shaped content into files — even Claude cannot "helpfully" persist a
  token it was shown.
- **PAT policy:** use fine-grained PATs with minimal scopes (Contents: read+write,
  Workflows: write only if pushing workflow files). **Rotate any token that
  has ever appeared in a chat log, ticket, or screenshot** — treat chat
  transmission as disclosure.

## 2. Prompt-injection defense (routed sessions)

External payload content is adversarial by default:

1. **Data demotion:** dispatch.py fences payloads inside
   `<untrusted_event>` blocks and states explicitly that instruction-looking
   text inside must be ignored. This lowers success rates but is not a
   guarantee — model-level defenses remain probabilistic.
2. **Tool allowlists:** headless runs get `Read,Grep,Glob` plus narrowly
   wildcarded `gh`/read-only git Bash rules. No arbitrary shell.
3. **Deterministic backstop:** hooks still fire in headless mode. Even a
   fully hijacked routed session meets the same PreToolUse gate: no
   force-push, no interpreter-piped downloads, no secret exfiltration writes.
4. **Label gating + dry-run defaults:** strangers' issues do nothing unless
   labelled `unown`; manual dispatch defaults to prompt-printing only.

Residual risk injection chains through *content you read into context* (file
contents referencing remote URLs, etc.). Mitigate by keeping routed sessions
scoped to repository text and reviewing any newly added data sources.

## 3. Self-modification containment

The improvement loop can change behavior — so its blast radius is boxed:

| Control | Mechanism |
|---------|-----------|
| Bounded edit surface | `harness/EDITABLE_SURFACES` whitelist; anything else → verdict REJECT |
| Bounded diff size | ≤40 changed lines, machine-checked |
| Eval gate | promotion requires targets passing ≥2/3 re-runs; artifacts in `verdicts/` |
| Human merge point | nightly dreams open PRs; approved bullets reach CLAUDE.md only via review |
| Loop ceilings | `--max-iterations`, workflow `concurrency`, `timeout-minutes` |

What the loop can *never* touch by design: gate logic itself (`validate_fix.py`),
eval fixtures, workflows, hook decision code. A harness that could rewrite its
own referee would not be trustworthy.

## 4. Hook execution surface

Hook scripts run arbitrary shell only where unavoidable, stdlib-only, and
fail-open. Review them once (~200 lines total). In managed environments set
`disableAllHooks: true` to suspend the entire layer instantly. Prefer
scanning this repo's hooks like any other dependency: they execute with your
user privileges on every session edge.

## 5. Sandbox recommendations

For unattended/vm-scale deployments wrap headless runs in a filesystem jail
(container, macOS sandbox-exec profile, Linux namespaces) with:
- workspace write access only
- no outbound network except Anthropic API + your proxy
- secrets injected per-run, never baked into images

The repo's CI path already approximates this via ephemeral runners +
workflow-scoped tokens.

## 6. Known trade-offs

- Exit-code semantics mean a buggy PreToolUse script fails *open* — chosen
  deliberately over fail-closed brick risk, but audit hooks accordingly.
- Redaction is pattern-based; exotic token formats slip through. Add yours to
  `SECRET_PATTERNS`.
- Mechanical (offline) dream merges are labelled UNREFINED precisely because
  consolidation without model judgment still needs human curation before
  touching CLAUDE.md.
