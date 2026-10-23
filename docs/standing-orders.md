# Standing orders — durable authority for unattended runs

A standing order is a program the operator has authorized the agent to execute on its own trigger: **what it may do** (Authority), **when it runs** (Trigger — enforced by a routine's schedule, never by prose), **what needs sign-off** (Approval gate), **when to stop and ask** (Escalation), and — as important as the permissions — **what it must NOT do**. Reverse-engineered from [OpenClaw's standing-orders convention](https://docs.openclaw.ai/automation/standing-orders.md), with Unown's own two-layer twist.

```
## Program: Nightly dependency report
**Authority:** Read package manifests, run the update check, write a summary note.
**Trigger:** Every weekday at 09:00 (enforced by the routine's schedule).
**Approval gate:** None for reports. Applying an update requires confirmation.
**Escalation:** If the update check fails twice, stop and leave a note.

### Execution steps
1. Read package.json + lockfile.
2. Run the update check.

### What NOT to do
- Do not apply updates without confirmation.
- Do not commit anything.
```

## Where orders live

| layer | path | notes |
|-------|------|-------|
| global | `~/.unown/agent/standing-orders.md` | you-across-projects rules |
| project | `<repo>/.unown/standing-orders.md` | **overrides global per program id** |

Same `## Program:` title (slugified) in both layers = one program, the project's version wins. A routine's run loads the orders of **its own workspace** — an order about repo X never rides a run in repo Y.

## How orders reach a run

Every routine dispatch (scheduled, manual, event) appends a budgeted digest of the workspace's standing orders to the unattended-run prompt, framed as standing authority — plus the **Execute-Verify-Report** loop (OpenClaw's execution rules, kept verbatim in spirit):

- **EXECUTE** the work — acknowledging the instruction is not execution.
- **VERIFY** the result before calling it done — prove it.
- **REPORT** what was done and what was verified, with evidence.
- On failure: retry once with an adjusted approach. **3 attempts maximum, then stop and escalate** — never fail silently.

Digest budgets: 2 000 chars per order, 10 000 total, with a visible truncation notice (never a silent cut) — the orders are context, not the task. An unparsable order is a warning + skipped, never a failed run; a missing Approval gate means *treat anything risky as gated*.

## `/promote` — the promotion flow

[OpenClaw's "promoting a repeated job into an automation"](https://docs.openclaw.ai/automation/cron-jobs/how-it-works) as an explicit command — you noticed yourself repeating a request, and promotion is preferred over building a job from scratch because the draft inherits a session you already read:

```
/promote                    distill THIS session into a Program draft (one cheap
                            LLM call), park it at .unown/promote-draft.md
/promote show               reprint the parked draft
/promote save project       append it to .unown/standing-orders.md
/promote save global        append it to ~/.unown/agent/standing-orders.md
/promote schedule --every "1d at 09:00"
                            (or --cron / --after / --delay-minutes / --on-event)
                            create the routine FROM the order, then immediately
                            test-run it once and report
```

The contract, preserved from OpenClaw:

- **Reference, never copy** — the created routine's prompt points at the standing order (`Execute per standing order "<id>"`), so editing the order edits the behavior; the routine row stays a *when*, the order stays the *what*.
- **Confirm the sentence, not the cron expression** — the draft shows the Trigger in plain words; you read those, not a schedule spec.
- **Enabled + visibly test-run** — the created routine is enabled (not disabled-pending), gets an immediate manual run, and the outcome is reported in the conversation.
- **Never leave an unverified job enabled** — a failed test run auto-removes the routine and says so; the standing order stays saved (fix and re-run `/promote schedule`).
- **Dedupe visibility** — saving an order whose program id already exists says so (a second order for the same job is a visible decision, not an accident).

**Documented deviation**: OpenClaw's docs describe the agent *offering* promotion when it notices repetition ("when you ask for substantially the same job several times…") — the "asked twice → auto-offer" framing circulating in the community is a synthesis, not in their docs (there is no `/promote` command there either; the offer rides the agent's tool prompt). Unown keeps promotion **explicit**: the user runs `/promote` when they notice the repeat. The agent in your session can drive the same flow through its `routine_*` session tools when asked ("promote this to a routine").

## Safety posture (OpenClaw's guidance, kept)

- Start with **narrow authority**; expand as trust builds — a draft with no boundaries fails validation (What NOT to do is required).
- Approval gates are a first-class field: "all posts require owner review for the first 30 days, then standing approval" is the intended shape.
- Every program needs a "when to stop and ask" clause; the default without one is the 3-attempts rule.
- Orders are living documents — review them alongside the weekly routine log (`unown routines history`).
- `read-only` mode (the routine default) still bounds what any of this can touch; standing orders grant authority, not tools.

## Sources

- OpenClaw — [standing orders](https://docs.openclaw.ai/automation/standing-orders.md) (the Program structure: Authority / Trigger / Approval gate / Escalation, What NOT to do, Execute-Verify-Report), [agent workspace](https://docs.openclaw.ai/concepts/agent-workspace.md) (injection + the 20k/60k char budgets Unown scales down), [promoting a repeated job into an automation](https://docs.openclaw.ai/automation/cron-jobs/how-it-works) (create enabled + immediate visible test-run + remove on failure).
- Unown's automations engine — the digest rides `buildAutomationPrompt`'s existing security contract (payloads-as-data, read-only defaults, the no-recursion marker).
