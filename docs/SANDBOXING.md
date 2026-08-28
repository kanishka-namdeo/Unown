# Sandboxing Unown — pre-made options, evaluated

> Research sweep (August 2026) answering: *what existing sandbox libraries can
> we drop in instead of building our own enforcement?* The `sandbox/`
> directory shipped with Unown is a **logical test rig** — it proves behavior.
> It is **not a security boundary**. This document maps the ecosystem of real
> sandboxes onto the five places Unown executes things, and recommends one
> default per tier.

## 1. Where Unown actually needs a sandbox

Five distinct execution surfaces, five different threat models:

| # | Touchpoint | Runs | Trust level | What containment must give |
|---|------------|------|-------------|-----------------------------|
| 1 | Interactive coding session (`claude` in your repo) | Hooks, Bash tool, edits | Your code + model output | Filesystem walls around secrets; network allowlist |
| 2 | Harness loop (`run_evals`, `propose_fix`, `validate_fix`) | Generated patch application, eval scripts | Model-generated diffs | Write scoped to proposal paths; network off |
| 3 | Auto-dreaming (`dream.py`) | Read notes, one small-model call | Repo-internal | Reads only; egress to API host only |
| 4 | Router headless runs (`dispatch.py` → `claude -p`) | Untrusted GitHub payload analysis | **Hostile input** | Egress deny by default; payload fenced as data |
| 5 | CI / nightly workflows | Everything above on GitHub runners | Model output | Runner isolation is provided; add fs/network pins |

Claude Code's own docs draw exactly this distinction and advise picking
isolation per threat model — their taxonomy: built-in **sandboxed Bash tool**,
**sandbox runtime** (whole process), **dev container**, **custom container**,
**VM**, and hosted **Claude Code on the web**.

## 2. The candidates

### Tier A — OS-level process sandboxes (no containers)

| Tool | What it is | Platforms | License / status |
|------|-----------|-----------|------------------|
| **Claude Code sandboxed Bash** (`/sandbox`) | Built-in per-command filesystem+network isolation for Bash and children only | macOS (Seatbelt), Linux/WSL2 | Part of Claude Code |
| **Anthropic Sandbox Runtime (`srt`)** | Wraps *any* process — agent, MCP server, script — with FS read/write rules + network proxy allowlist. Same primitives that power Claude Code sandboxing (`sandbox-exec` / bubblewrap) | macOS, Linux, Windows | Open beta, `npm i -g @anthropic-ai/sandbox-runtime` |
| **OpenAI Codex CLI policies** (reference design) | Seatbelt/Landlock profiles layered with approval modes; good ideas to copy for read-scope restrictions | macOS, Linux | Open source |

`srt` config example that fits Unown's harness gate perfectly:

```json
{
  "filesystem": {
    "denyRead":  ["**/.env", "~/.ssh"],
    "allowWrite": ["harness/runs", "harness/proposals", "docs/RUNBOOK.md"],
    "denyWrite": ["CLAUDE.md"]
  },
  "network": { "allowedDomains": [], "deniedDomains": [] }
}
```

### Tier B — container isolation

| Tool | What it adds | Best for |
|------|-------------|----------|
| **Dev container** (Anthropic ships a preconfigured one) | Whole Claude Code process in Docker with sensible defaults; zero custom YAML needed | Standardizing team setups; unattended `--dangerously-skip-permissions` runs |
| **Dagger `container-use`** | One container **+ git worktree per agent attempt**, wired as an MCP server; parallel agents each get isolated envs and reviewable branches | Harness self-improvement: run N candidate fixes concurrently without them stepping on each other |
| **Docker + gVisor (runsc) / rootless Podman** | Kernel-interception defense-in-depth on top of plain Docker; your own images | Self-hosted runner fleets |

### Tier C — managed cloud sandboxes (API-first microVMs)

| Provider | Isolation | Notes relevant to Unown |
|----------|-----------|------------------------|
| **E2B** | Firecracker microVMs, ~150 ms cold start | De-facto default; open-source infra & SDKs (Python/JS), self-hostable; biggest community. Good fit if router tasks grow into long-lived sessions/browsers |
| **Vercel Sandbox** | Ephemeral Linux VMs, GA Jan 2026, ≤45 min executions | Ships an official **"Using Vercel Sandbox with Claude Agent SDK"** guide — closest documented precedent for our router use-case |
| **Cloudflare Sandbox SDK** | Containers on Workers/Durable Objects (+ Dynamic Worker isolates since Mar 2026) | Cheapest always-on edge tier; natural if you already deploy on CF |
| **Modal / Beam / Blaxel** | microVM platforms w/ GPU catalogs | Overkill here unless evals need GPUs |
| ⚠️ **Daytona** | Was the open-source darling (~90 ms creation); **production went closed-source June 2026, OSS repo archived** | Avoid as a dependency bet |

### Tier D — platform-grade

**Kubernetes SIG Apps `agent-sandbox`** — `Sandbox` CRD + controller (+
`SandboxTemplate`, `SandboxClaim`), Apache-2.0, Helm-installable. Purpose:
"isolated, stateful, singleton workloads … AI agent runtimes." This is the
right answer only when you operate a k8s fleet of many Unowns.

## 3. Recommendation for Unown (default → scale path)

| Touchpoint | Default (today, keyless, $0) | When you need more |
|------------|------------------------------|--------------------|
| 1 Interactive | Enable `/sandbox` (sandboxed Bash) — one command, no deps | Wrap whole session with `srt claude` to include file-tools/MCP/hooks inside the wall |
| 2 Harness loop | `srt` around `validate_fix.py`: writes whitelisted to proposal/run dirs, network denied outright | Parallel candidate fixes via `container-use` worktrees |
| 3 Dreamer | Nothing extra — offline mode makes zero calls; live mode needs only the API domain in `allowedDomains` | Nightly batch stays in GitHub Actions |
| 4 Router | Keep routing on GitHub Actions runners (already ephemeral VMs); keep `--dry-run` fencing in CI | Long-lived/browser tasks → **E2B**; if you deploy on Vercel anyway, follow their Claude Agent SDK pattern |
| 5 CI | Current offline `sandbox.yml` suite | Add gVisor to self-hosted runners if you route untrusted repos at scale |

**Concrete first step** (no architecture change): install `srt` and wrap the
two highest-risk entry points —

```bash
npm i -g @anthropic-ai/sandbox-runtime
# validation gate: patch may write only its own artifacts, network dead:
srt python3 harness/validate_fix.py --proposal proposals/demo-t003-known-good.md --offline
# interactive: full-session wall (macOS/Linux)
srt claude
```

Budget check: everything recommended as *default* is $0/mo beyond Claude
itself; even adding E2B later at hobby scale (a few nightlies/hour) stays an
order of magnitude under the $50/mo cap in `docs/COST.md`.

## 4. Why not just these from day one?

The `sandbox/` rig stays necessary regardless of enforcement layer: none of
the tools above **test** Unown's behaviors (gate decisions, dedupe semantics,
gate promotion logic) — they confine them. Enforcement confines; tests prove.
Both layers compose: S-scenarios assert what happens *inside* whatever jail
you point them at.

Also note what sandboxing does **not** buy you (per Anthropic's security
notes): it changes nothing about what is sent to the model provider, and any
config allowing network egress or writable project mounts still leaks/modifies
data. Layer with the hooks gate and untrusted-fencing already in this repo.

## Sources

- Choose a sandbox environment — Claude Code docs:
  https://code.claude.com/docs/en/sandbox-environments (+ `/en/sandboxing`)
- Making Claude Code more secure and autonomous with sandboxing — Anthropic
  engineering blog, Oct 20 2025:
  https://www.anthropic.com/engineering/claude-code-sandboxing
- anthropic-experimental/sandbox-runtime (README):
  https://github.com/anthropic-experimental/sandbox-runtime
- dagger/container-use: https://github.com/dagger/container-use
- kubernetes-sigs/agent-sandbox + K8s blog (Mar 20 2026):
  https://github.com/kubernetes-sigs/agent-sandbox ,
  https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox
- E2B: https://e2b.dev , https://github.com/e2b-dev/e2b
- Vercel Sandbox (GA + Claude Agent SDK guide):
  https://vercel.com/blog/vercel-sandbox-is-now-generally-available ,
  https://vercel.com/kb/guide/using-vercel-sandbox-claude-agent-sdk
- Cloudflare Sandbox SDK / Dynamic Workers:
  https://developers.cloudflare.com/sandbox ,
  https://blog.cloudflare.com/dynamic-workers
- Microsandbox (local libkrun microVMs):
  https://github.com/superradcompany/microsandbox
- Daytona closed-source notice: https://northflank.com/blog/top-daytona-io-alternatives-for-running-ai-code-in-secure-sandboxed-environments
- Cross-provider benchmarks: https://www.superagent.sh ,
  https://blog.logrocket.com (agent sandbox platform comparisons, Aug 2026)
