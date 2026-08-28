# Unown Architecture

Five mechanisms, one control plane. Diagrams are GitHub-renderable mermaid.

## 1. System overview

```mermaid
flowchart TB
    subgraph Developer["Developer machine"]
        UI[claude interactive session]
    end

    subgraph Deterministic["Hooks - deterministic control plane"]
        SS[SessionStart<br/>memory digest] --> UPI[UserPromptSubmit<br/>orientation + secret hint]
        PRE[PreToolUse<br/>gate: deny/ask/pass]
        POST[PostToolUse<br/>format + audit log]
        STOP[Stop / SubagentStop<br/>session scribe]
    end

    subgraph Memory["Tiered memory"]
        T1[T1 managed policy<br/>/etc/claude-code]
        T2[T2 user ~/.claude]
        T3[T3 project CLAUDE.md]
        T4[T4 local CLAUDE.local.md]
    end

    subgraph Cloud["Cloud - laptop closed"]
        GHA[GitHub Actions]
        RT[router/dispatch.py]
        HC[headless claude -p<br/>allowlisted tools]
        SIM[self-improve loop]
        DREAM[dream.py nightly]
    end

    subgraph Artifacts
        NOTES[(dreams/sessions/*.md)]
        CONS[(dreams/consolidated/&lt;date&gt;.md)]
        EVALS[(harness/runs/*)]
        WEAK[(weaknesses.json)]
        PROP[(proposals/*.md)]
        VERD[(verdicts/*.json)]
    end

    UI --> SS --> UPI --> PRE --> POST
    UI -- stop --> STOP --> NOTES
    SS -.prints.-> T1 & T2 & T3 & T4

    GHA --> RT --> HC
    GHA -- cron --> DREAM --> NOTES
    DREAM --> CONS --> PR1[human-reviewed PR<br/>into CLAUDE.md]
    GHA -- cron --> SIM --> EVALS --> WEAK --> PROP --> VERD
    VERD -- PASS --> PR2[harness v2 PR]
```

## 2. Tiered memory resolution

Tiers **concatenate** into context at launch; specificity of instruction breaks
conflicts — not file shadowing. The digest makes the stack visible every session.

```mermaid
flowchart LR
    M["/etc/claude-code/CLAUDE.md<br/>managed policy"] --> S[Effective context<br/>concatenated in order]
    U("~/.claude/CLAUDE.md<br/>user prefs") --> S
    P("CLAUDE.md / .claude/CLAUDE.md<br/>team memory") --> S
    L("CLAUDE.local.md<br/>personal override, gitignored") --> S
    IM["@imports (max depth 4)<br/>pull topic files in"] -.-> P
```

## 3. Self-improving harness loop

Keep the model stable; make the harness editable; gate promotions on evals.

```mermaid
flowchart TD
    A[run_evals.py<br/>golden tasks via claude -p] --> B{all pass?}
    B -- yes --> Z[stable harness]
    B -- no --> C[mine_failures.py<br/>cluster by root cause]
    C --> D[propose_fix.py<br/>bounded diff &le;40 lines<br/>EDITABLE_SURFACES only]
    D --> E[validate_fix.py<br/>apply patch, re-run evals x3]
    E --> F{each target passes<br/>&ge; 2 of 3?}
    F -- no --> R[rollback patch<br/>loop again] --> A
    F -- yes --> G[PASS verdict<br/>leave applied, commit v2]
```

Hard guarantees:
- Proposals may only touch files whitelisted in `harness/EDITABLE_SURFACES`.
- Diff size is bounded and machine-enforced.
- Nothing promotes without `PASS` from the gate (`verdicts/*.json`).
- Offline mode makes all of this testable with zero API spend.

## 4. Routing data flow

```mermaid
sequenceDiagram
    participant GH as GitHub event
    participant WF as event-router.yml
    participant D as dispatch.py
    participant CC as claude -p (cloud)
    participant OUT as PR comment / Slack

    GH->>WF: pull_request.opened / issues.opened(label unown)
    WF->>D: intent + payload JSON
    D->>D: redact secrets, fence payload as UNTRUSTED data
    D->>CC: bounded prompt + tool allowlist
    CC-->>D: markdown report
    D->>OUT: gh pr comment / gh issue comment / slack webhook
```

The PreToolUse hook is active even in headless mode — a routed session that
tried a force-push would be denied deterministically.

## 5. Auto-dreaming pipeline

```mermaid
flowchart LR
    H1[Stop hook] --> N[(sessions notes)]
    H2[SubagentStop hook] --> N
    N --> B[dream.py batch<br/>cap = DREAM_MAX_NOTES]
    B --> R{refiner available?}
    R -- yes --> MR[model consolidation:<br/>dedupe, conflicts flagged,<br/>stale pruned]
    R -- no --> MU[UNREFINED mechanical merge]
    MR --> C[(consolidated/date.md)]
    MU --> C
    C --> HU[human review]
    HU --> CM[CLAUDE.md updated]
    C --> CI[nightly PR via Actions]
```

state.json marks consumed notes → runs are incremental, idempotent, cheap.

## 6. Failure/boundary behaviour

| Boundary | Behaviour |
|----------|-----------|
| Hook script raises | exits 0 with stderr warning — agent never bricks |
| Proposal targets non-whitelisted file | gate verdict `REJECT` |
| No claude CLI anywhere | offline/unrefined paths keep pipelines alive |
| Missing SLACK_WEBHOOK_URL | post skipped, result printed to logs |
| Stranger opens issue without label | router declines (cost guard) |
