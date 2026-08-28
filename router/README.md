# Router — GitHub events to headless Unown sessions

`dispatch.py` is the "laptop closed" layer: scheduled or event-driven tasks
arrive as payloads from GitHub Actions, get mapped to an intent prompt, and
are executed by a **headless** Claude Code session (`claude -p`) in the cloud.
Results come back as PR comments, issue replies, Slack pings — no workstation involved.

## Intent map

| Event | Intent | Output |
|-------|--------|--------|
| `pull_request` (opened) | `pr_review` | review summary posted on the PR |
| `issues` (opened) | `issue_triage` | triage comment: repro hints, area guess |
| `issue_comment` / PR review comment | `comment_reply` | direct reply thread |
| manual dispatch / schedule | `nightly_summary` | digest of recent activity |

## Usage

```bash
# What WOULD the agent be asked? (safe inspection)
./dispatch.py --intent pr_review --payload payload_samples/pr_opened.json --dry-run

# Real routed run (needs claude CLI + gh auth in CI)
./dispatch.py --intent pr_review --payload samples/pr_opened.json \
              --post-to pr        # pr | issue | slack | none
```

## Safety model (see docs/SECURITY.md for depth)

1. Payload content is **data, never instructions**: it is fenced inside the
   prompt and explicitly demoted ("untrusted transcript of an external
   event").
2. Headless sessions run with allowlisted tools only and read-only git usage;
   mutations happen via `gh` after human-readable review text is produced.
3. The PreToolUse gate still applies (hooks are loaded in `-p` mode too), so
   even a hijacked router cannot force-push or exfiltrate secret-shaped blobs.
4. Label gating in `event-router.yml` (issue must carry label `unown`) keeps
   strangers from spending your tokens.
