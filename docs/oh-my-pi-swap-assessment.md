# Replacing our vendored pi with oh-my-pi: assessment and decision

> Purpose: decide whether Unown should swap its vendored pi base (`pi-repo/`,
> `@earendil-works/pi-*` 0.84.3) for the oh-my-pi fork (`can1357/oh-my-pi`,
> `@oh-my-pi/*` 18.11.3) and keep working with our tiered memory system, and
> record the evidence so the decision survives AutoDream.
>
> Research and decision note, 2026-10-17. Method: seven parallel source-audit
> threads over both repositories plus direct artifact/npm/GitHub-API forensics.
> No code was changed by this assessment and no behavior changed.
>
> Verdict: **No — keep pi as the substrate.** The blocker is *not* API
> compatibility: oh-my-pi ships a deliberate legacy shim and our entire coupling
> is three import specifiers. The blocker is that oh-my-pi closes the two
> chokepoints Unown wraps through — execution and context injection — and makes
> mandatory a native runtime we cannot build, prune, or jail. Revisit only if
> IDE-grade tooling (LSP/DAP/debugger) becomes a product requirement, and then
> only as an external harness over `--mode rpc`, never as the substrate our
> sandboxed learning runs depend on. The single experiment that would change
> this verdict is in §9.

- [1. Method and evidence tiers](#1-method-and-evidence-tiers)
- [2. The structural cause](#2-the-structural-cause)
- [3. Blast radius: what we would actually move](#3-blast-radius-what-we-would-actually-move)
- [4. Layer-by-layer assessment](#4-layer-by-layer-assessment)
- [5. What stays broken at full effort](#5-what-stays-broken-at-full-effort)
- [6. Cost if pursued anyway](#6-cost-if-pursued-anyway)
- [7. The finding that mattered more than the question](#7-the-finding-that-mattered-more-than-the-question)
- [8. Decision and investment order](#8-decision-and-investment-order)
- [9. Revisit triggers and the go/no-go gate](#9-revisit-triggers-and-the-gono-go-gate)
- [10. Honest cost of staying](#10-honest-cost-of-staying)
- [11. Corrections register](#11-corrections-register)
- [Appendix A — our pi API dependency inventory](#appendix-a--our-pi-api-dependency-inventory)
- [Appendix B — oh-my-pi embedding and extension contract map](#appendix-b--oh-my-pi-embedding-and-extension-contract-map)
- [Appendix C — AutoDream versus oh-my-pi memory](#appendix-c--autodream-versus-oh-my-pi-memory)
- [Appendix D — published artifact forensics](#appendix-d--published-artifact-forensics)
- [Appendix E — governance and churn metrics](#appendix-e--governance-and-churn-metrics)
- [Appendix F — reproduction commands](#appendix-f--reproduction-commands)
- [Related pages](#related-pages)

---

## 1. Method and evidence tiers

Both repositories were read at source, not summarized from README copy. Our side
was audited from `pi-repo/packages/self-learning/src/`, `mini-services/`, `bin/`,
`scripts/`; the candidate from `raw.githubusercontent.com/can1357/oh-my-pi/main`,
its `docs/` set, and the npm registry.

Every load-bearing claim carries one of:

- **[V]** — verified by direct read at a cited `file:line`, an npm/GitHub API
  field, or a command output reproduced in Appendix F. Where the check was run
  twice by different agents or by hand, it says **[V-vendor]** for our tree and
  **[V-cand]** for the candidate tree.
- **[C]** — claimed by upstream documentation or by one audit pass that was not
  independently re-derived. Treat as actionable but unconfirmed.
- **[U]** — UNKNOWN: the audits could not settle it. These are the items a spike
  would have to settle, and they are the reason §9 exists.

Numbers stated as counts always say what scope they include. Two agents reported
slightly different totals for our own code because they swept different file
sets; §3 states the set used.

---

## 2. The structural cause

The defects found are symptoms of one missing invariant in the candidate:

> **A harness that a governance layer wraps from the outside must expose an
> external chokepoint for execution and for context injection, and must keep
> them documented and stable.**

pi satisfies it. Unown is built on exactly two of its seams:

| Seam | How Unown uses it | Why it is load-bearing |
|---|---|---|
| `SettingsManager.inMemory({ shellPath })` | the generated bubblewrap wrapper is injected as the agent's shell, so **every** bash-tool call re-execs under the jail — `pi-repo/packages/self-learning/src/runner.ts:216`, wrapper written by `pi-repo/packages/self-learning/src/bwrap.ts:152` | the OS sandbox under which the harness finds and fixes its own weaknesses is the thing that makes autonomous learning safe to run unattended |
| `resourceLoaderOptions.agentsFilesOverride` | the resolved 4-tier memory stack is **supplemented** into the agent's context chain and re-resolved every session — `pi-repo/packages/self-learning/src/cli.ts:212` | it is how AutoDream's writes become visible to a live session without a restart, and how the engine (not the CLI) stays authoritative over memory |

oh-my-pi closes both, deliberately and as a feature:

- **Execution moved in-process.** Its bash tool runs commands in an embedded Rust
  *brush* shell with patched coreutils; `shellPath` now only fronts named
  services, terminals, and interactive `!` — `docs/tools/bash.md:36` **[V-cand]**,
  verified by hand. `grep -c child_process src/tools/bash.ts` returns 0, and no
  file in `src/tools/` imports `child_process` **[V-cand]**. The compatibility
  shim's own `SettingsManager.inMemory()` takes **no arguments**, so
  `inMemory({ shellPath })` silently discards the override
  (`legacy-pi-coding-agent-shim.ts:795-803`) **[V-cand]**. Silent, not loud: the
  jail would simply stop existing.
- **Context moved inside the harness.** oh-my-pi owns its own discovery chain
  (`~/.omp/agent/AGENTS.md` plus the **nearest non-empty** `.omp/AGENTS.md`
  climbing toward the repo root), and `options.contextFiles` **replaces**
  discovery rather than supplementing it (`docs/context-files.md:19-59`,
  `sdk.ts:747,1849-1852`) **[V-cand]**. There is no `agentsFilesOverride` outside
  the shim **[U]**.

That single difference generates the whole defect class. Memory is not broken by
the swap — it is *duplicated* by it, because oh-my-pi ships its own consolidation
pipeline that owns the same territory from inside the harness, with no external
trigger, no versioning, and no gate (Appendix C).

Consequences follow mechanically: adopting oh-my-pi means reimplementing the
sandbox jail and the tier injector **inside a fork we would then own**, which
converts Unown from a harness-agnostic learning layer into "an oh-my-pi fork."
The product identity is the thing at risk, not the typecheck.

---

## 3. Blast radius: what we would actually move

Scope swept: `pi-repo/packages/self-learning/src/**/*.ts` + `bin/unown` +
`mini-services/agent-service/*.ts` + `mini-services/llm-bridge/*.ts` +
`scripts/*.mjs`.

| Measure | Value | Tier |
|---|---|---|
| Our own code in scope | 11,526 lines | [V-vendor] |
| Files that name pi at all | 7 | [V-vendor] |
| Identifier-bearing pi lines (imports, `modelRuntime`, `SessionManager`, …) | 36 | [V-vendor] |
| Behavioral coupling (event handlers, `ctx.*`, tool names, file formats, JSON parsing) | ~200 lines in 5 files | [V-vendor] by audit, not re-counted |
| pi packages imported | 3 specifiers (`pi-coding-agent`, `pi-ai`, `pi-tui`) | [V-vendor] |
| Anything outside those files that would need moving | engine memory/dream/harness/mint/router/server/notes/store, dashboard `src/`, llm-bridge | 0 pi references — pi-free | 

The Next.js app and CI never import pi; the dashboard talks to the engine only
over HTTP/SSE on :3030. `src/components/landing/mechanisms.tsx:6` and
`.github/workflows/ci.yml:82` mention pi as **documentation URLs and a script
path**, not as a dependency **[V-vendor]**.

So the honest headline: the port is small. Under 2% of our code touches the
harness, and the candidate keeps the event names we subscribe to verbatim
(Appendix B). The verdict in §2 is therefore *not* an estimate of diff size —
it is about which layers we would end up owning.

---

## 4. Layer-by-layer assessment

| Layer | Verdict | Evidence |
|---|---|---|
| **OS sandbox / bwrap jail** | **BLOCKER** | brush shell executes in-process; `shellPath` no longer fronts bash-tool calls **[V-cand]**. Nearest seams are the legacy `createBashTool(cwd, {operations, spawnHook})` (shim:497-558) or rewriting `tool_call.input.command` — whether either yields a *complete* jail is **[U]**. `tool_call` rewriting is not a jail: an escaped `!`-terminal or `eval` path is not covered, and oh-my-pi's own docs state a `bash.patterns` deny rule does nothing when the same command goes through `eval` (`docs/bash-tool-runtime.md:50`) **[V-cand]** |
| **4-tier memory injection** | Feasible, degraded | `agentsFilesOverride` exists only in the shim and is forwarded as `contextFiles` (shim:972 → 1158-1162 → 1432-1434) **[V-cand]**. Natively we must call `discoverContextFiles` and merge ourselves (`sdk.ts:1247`) **[V-cand]**. Live re-resolution per session survives **only** for on-disk files: with supplied `contextFiles` the prompt is frozen and we must recreate the session per run **[V-cand]** |
| **DOX rail (nested AGENTS.md)** | **Regression** | oh-my-pi reads the *nearest non-empty* `.omp/AGENTS.md` and stops; it does not walk every directory like pi **[V-cand]**. Our root→child contract chain would load differently, silently |
| **AutoDream** | Ours stays, theirs off | No versioning, no attribution, no rollback, no verification gate anywhere in their memory; consolidation runs only at CLI startup over their own session files and is skipped for subagents and non-persisted sessions (Appendix C) **[V-cand]**. Nothing of ours is replaced; ~60% of `runProjectDream` + `mintSkillsForProject` is duplicated if we enable theirs |
| **Model routing via llm-bridge** | **Survives** | Loopback OpenAI-compatible base URL + static key + no OAuth is a documented first-class path; `models.json` is auto-migrated when both YAML files are missing (`docs/models.md:32`); all non-provider network is background/opt-in with a bundled offline catalog **[V-cand]**. Work is mechanical (Appendix B) |
| **Terminal CLI surface** | Survives | `-p/--print`, `--mode json\|text\|rpc\|acp`, `--no-session`, `--tools`, `--append-system-prompt <text\|file>` all exist **[V-cand]**. Two collisions: their `--plan <id>` selects a *plan model*, ours is a boolean flag **[V-cand]**; and `--mode json` emits a session header plus `AgentSessionEvent` records with **no** pi-style `{"type":"message"}` record, so our subagent parser retargets **[V-cand]** |
| **Boot / install** | **Severe** | `@oh-my-pi/pi-natives` is a hard dependency of `pi-coding-agent` **and** `pi-agent-core` **[V-cand]**; its root entry calls `loadNative()` at module evaluation and re-exports every symbol eagerly (`packages/natives/native/index.js:23`) **[V-cand]**; the loader throws on unsupported platform and there is no disable switch (`PI_NO_NATIVE` grep = 0) **[V-cand]**. Floor ≈ 330 MB (linux-x64 leaf 230,632,785 unpacked; two 109.5 MB ISA variants) versus our 22 MB `pi-repo`. `engines` is `bun >= 1.3.14` with no node engine |
| **Brand theme** | **Lost** | The shim drops themes silently — "OMP has no session-level themes surface" (shim:921-923) **[V-cand]**. `scripts/check_theme.mjs` gates the AA-verified palette against pi's `theme-schema.json`; under the shim the palette has no home and the gate loses its target |

---

## 5. What stays broken at full effort

Three items are not solved by writing more code:

1. **The jail.** Restoring it means either forking oh-my-pi's bash runtime or
   accepting process-granularity sandboxing (run the *whole* `omp` process inside
   bwrap). The latter is defensible for engine runs and is the shape §9 tests,
   but it changes the guarantee: per-command path jail and the deny-list become
   coarse-grained, and `eval`/`!`/services escape the same surface today.
2. **The native runtime.** We cannot build it (nightly Rust 2026-10-06 + Bazel
   9.2 + hermetic cc + Nix), cannot prune it (hard dependency, eager load), and
   have not proven it loads inside our jail, which hides `/home` on tmpfs, gives a
   fresh `/proc`, and needs a writable `$XDG_DATA_HOME/omp` for DLL/`.node`
   staging **[U]**. The sandbox's bun is pinned at exactly the 1.3.14 floor while
   the host runs 1.4.x.
3. **Telemetry against a network jail.** `docs/install-id.md` documents a
   persistent `~/.omp/install-id` sent as `x-omp-install-id` / `x-omp-hostname` to
   a gateway, plus auth-broker attribution and `report-tool-issue`; 134 telemetry
   code hits **[V-cand]**. Our engine deliberately unshares network
   (`UNOWN_SANDBOX_NET=0`). Every egress path would need auditing and disabling
   before we could claim the agent is jailed.

---

## 6. Cost if pursued anyway

Rough, for a first shippable swap:

| Work item | Effort |
|---|---|
| Rewrite both boot paths to `createAgentSession` (`cli.ts:187-236`, `runner.ts:213-238`) | days |
| `writeModelsJson` array → `models.yml` provider map; split `settings.json` into `config.yml` + `models.yml`; keep `~/.unown/agent` via `PI_CODING_AGENT_DIR` + `PI_CONFIG_DIR` | days |
| Retarget subagent JSON parser and `runner.ts` session-event parsing | days |
| Resolve `todo` / `task` / `/agents` name collisions and the `--plan` semantics clash; retire our plan-mode block in favour of theirs | days |
| Re-derive the theme contract, or accept losing the brand theme | days, outcome unknown |
| **Re-engineer the OS sandbox with no `shellPath` seam** | **unscoped — this is the estimate that decides the verdict** |
| Install story: 330 MB, per-platform `.node` prebakes, offline vendoring, `PI_NATIVES_DIR` bind mount, addon/ABI match | weeks |
| Standing cost: pin 18.11.3 and triage ~3 releases/day where breaking changes ship in patch and minor bumps | ~0.2 FTE ongoing |

---

## 7. The finding that mattered more than the question

Answering "should we switch forks" exposed a worse problem in our own setup:

- Upstream pi is at **1.3.0, published 2026-10-15** **[V]** (npm). We vendor
  **0.84.3** **[V-vendor]**. oh-my-pi last synced upstream at
  `b21b42d0, 2026-03-22` **[V-cand]**, roughly the pi 0.61-0.62 line **[C]**.
  **Switching to oh-my-pi moves us about five months *backwards* in the pi
  lineage** while upstream pi keeps moving. That is the opposite of the reason
  people usually switch forks.
- Our vendor is a **squashed copy, not a tracked fork**: no `.gitmodules`, the
  remote is only `kanishka-namdeo/Unown`, and `pi-repo/package.json` first appears
  in `79f3e18` (2026-08-28) **[V-vendor]**. There is no upstream ref to diff
  against, so every future pi sync is a manual file-copy merge. That, plus the
  documented local-patch list in
  [`pi-repo/packages/self-learning/AGENTS.md`](../pi-repo/packages/self-learning/AGENTS.md),
  is our actual liability — and it is cheap to fix precisely because our coupling
  is three import specifiers.
- Upstream pi packages are near-pristine: grepping `unown|UNOWN|bwrap|zai-bridge`
  across `pi-repo/packages/*` excluding `self-learning` yields one hit,
  `packages/ai/scripts/generate-models.ts` **[V-vendor]**. Our exit ramp today is
  extremely cheap, which is worth protecting.

---

## 8. Decision and investment order

**Decision: do not swap. Keep `pi-repo/` at the pi line and re-sync it.**

Invest in this order:

1. **Make the vendor diffable.** Add an `upstream` remote (or subtree) for
   `earendil-works/pi` and re-sync toward 1.3.0, re-applying the documented patch
   list. This buys freshness, security fixes, and upstream features without
   changing our substrate or our 3-specifier coupling.
2. **Port ideas, not code**, from oh-my-pi where they are genuinely better:
   deterministic compaction that costs no summarizer tokens (their *snapcompact*),
   plan-model→cheap-executor handoff routing (their *prewalk*), a second-model
   reviewer (their *advisor/watchdog*), and an MCP client — our only real feature
   gap. Each is a bounded, independent change on top of pi.
3. **Fix the memory-system asymmetry** their design exposes: their pipeline is
   CLI-startup-only and cannot be driven externally. Ours is engine-driven, which
   is the differentiator — so lean into it (external `POST /api/notes` ingest,
   cross-project queue, canary gate) rather than converging on their shape.
4. Only then consider a second harness, and only under the trigger in §9.

## 9. Revisit triggers and the go/no-go gate

Reopen this decision if **any** of these becomes true:

- IDE-grade tooling (LSP diagnostics, DAP debugging, worktree subagents) becomes a
  stated product requirement rather than a nice-to-have.
- Upstream pi ships an embedded-shell or in-process execution model, closing our
  `shellPath` seam too — at which point the chokepoint argument no longer favours
  pi.
- Our own maintenance cost of the pi re-sync exceeds the churn cost of a fork.

**The gate.** One experiment, and it must be able to say no:

> Drive `omp` as an **external CLI over `--mode rpc`**, run the whole process
> inside our existing bwrap profile, and prove three things end to end:
> (1) the native addon loads under the jail (`/proc` readable, writable
> `PI_NATIVES_DIR` / `$XDG_DATA_HOME`, glibc and ISA variant satisfied — the
> `linux-x64-baseline` variant needs x86-64-v2 on a kernel-5.10 host);
> (2) a 4-tier memory stack passed as `contextFiles` reaches the model and updates
> from AutoDream are picked up on the next run;
> (3) **no command escapes the jail** — including `eval`, `!`, named services, and
> the WebAssembly tree-sitter grammars oh-my-pi downloads on first use.

Pass all three and a hybrid terminal harness becomes defensible. Fail (1) or (3)
and this verdict stands indefinitely. Anything short of running the actual binary
is not evidence.

## 10. Honest cost of staying

Not switching has a price, and it should be recorded plainly:

- **No MCP client.** oh-my-pi ships a full one (OAuth, deferred/cached tools,
  multi-source discovery). This is the most defensible criticism of our stack and
  the cheapest of their ideas to port.
- **No LSP diagnostics or debugger integration.** Our post-edit gate is a
  bun-transpiler syntax check — strictly weaker than language-server diagnostics.
- **No native Windows support** for the terminal agent; oh-my-pi runs PowerShell
  and Win32 paths first-class.
- **Our `task` subagents stay blocking subprocesses** with no schema-validated
  results, no steering, no worktree isolation, and no roster UI.
- **Compaction is absent** on both our side and pi 0.84.3; long sessions lean
  entirely on the tiered memory stack.

None of these is answered by accepting 330 MB of mandatory Rust, a fork five
months behind our current base, and ownership of someone else's bash runtime.

## 11. Corrections register

Claims made earlier in this investigation that the evidence later falsified. Kept
deliberately, because each one is a trap a future session could fall into again.

| # | Initially asserted | Correction | Why the first pass was wrong |
|---|---|---|---|
| 1 | "oh-my-pi is a fork of pi at a similar vintage to ours" | Its sync marker is 2026-03-22 (~pi 0.61); **our 0.84.3 is newer** | README copy says "fork of Pi" with no version; only `docs/porting-from-pi-mono.md` records the marker |
| 2 | "Consume it from npm and the Rust toolchain problem disappears" | The core tarball contains **zero** `.node` files; natives arrive via per-platform optionalDependencies totalling ~330 MB and load eagerly at module evaluation | `files`/`exports` looked self-contained; the loader's `createRequire` chain is what reveals it |
| 3 | "The legacy shim makes the port cheap, including the sandbox" | The shim's `SettingsManager.inMemory()` accepts no arguments and **silently drops** `shellPath`, and it silently drops themes | An API-name-preserving shim is not an executable-equivalent one |
| 4 | "Adopt their `learn` tool as a richer note source" | For the `local` backend only `learn` exists — `retain`/`recall`/`reflect`/`memory_edit` are gated to `hindsight`/`mnemopi` — and `pi-mnemopi` is a hard dependency of coding-agent | The marketing README lists all four tools without scoping them per backend |
| 5 | "Their memory could replace AutoDream" | No versioning, attribution, rollback, or verification gate, and consolidation cannot be triggered externally; our canary gate has **no analogue** | Both look like "consolidate sessions into memory" at the feature level |
| 6 | "Our coupling is ~200 lines, so this is risky" | The identifier-level surface is 3 specifiers across 7 files; ~200 lines is *behavioral* surface, and the risk lives in the two chokepoints, not the line count | Conflating LOC with blast radius |

---

## Appendix A — our pi API dependency inventory

Scope: files outside the upstream pi packages that reference pi. Re-derived by
`grep` **[V-vendor]**.

| File | pi-naming lines | What it uses |
|---|---|---|
| `pi-repo/packages/self-learning/src/cli.ts` | 12 | all five factories + `InteractiveMode` / `runPrintMode`, `agentsFilesOverride`, `additionalSkillPaths`, `appendSystemPrompt`, `extensionFlagValues` |
| `pi-repo/packages/self-learning/src/runner.ts` | 10 | `createAgentSessionServices` / `FromServices`, `SettingsManager.inMemory({shellPath})`, `modelRuntime.getModel`, `agentsFilesOverride` (replace) |
| `mini-services/agent-service/smoke.ts` | 7 | **the only compiled-dist importer**: `pi-repo/packages/coding-agent/dist/index.js` |
| `pi-repo/packages/self-learning/src/tools.ts` | 4 | `StringEnum` (pi-ai), `ExtensionAPI` + `parseFrontmatter` (coding-agent), `Key`/`Text` (tui) |
| `pi-repo/packages/self-learning/src/index.ts` | 1 | re-export |
| `scripts/check_theme.mjs` | 1 | reads `coding-agent/src/modes/interactive/theme/theme-schema.json`, consumes `SCHEMA.properties.colors.required` — a **src**, not dist, path |
| `pi-repo/packages/self-learning/src/bwrap.ts` | 7 | writes the wrapper consumed by the `shellPath` option |

Extension surface we depend on **[V-vendor]**:

- Events subscribed: `session_start`, `input`, `tool_call`, `tool_result`,
  `agent_end`, `session_tree`, `session_shutdown` (gated on
  `event.reason === "quit"`), `context`, `before_agent_start`, `turn_end`.
- `pi.*`: `registerTool` (`todo`, `note`, `task`, `fetch_url`), `registerCommand`
  (`/plan`, `/todos`, `/note`, `/agents`, `/learning`), `registerFlag("plan")`,
  `registerShortcut(Key.ctrlAlt("p"))`, `getFlag`, `getActiveTools`,
  `setActiveTools`, `appendEntry`, `sendMessage`, `sendUserMessage`.
- `ctx.*`: `sessionManager.getBranch()`, `sessionManager.getEntries()`,
  `ui.setStatus`, `ui.setWidget`, `ui.notify`, `ui.select`, `ui.editor`,
  `ui.theme.fg(...)`, `ctx.hasUI`.
- Custom session entries persisted: `unown-plan-mode` (read back at
  `tools.ts:1172`), `unown-plan-context`, `unown-plan-echo`, `unown-plan-execute`.
- Hook return contracts pi must honour: `{block, reason, terminate}` and
  `{content, isError}` (`hooks.ts:237`, `hooks.ts:247-252`).

pi-owned files we read or write **[V-vendor]**: `models.json` (full rewrite per
engine run; write-if-missing for the terminal agent), `auth.json` (0600),
`settings.json` (`defaultProvider` / `defaultModel` / `theme`),
`themes/unown.json`, `skills/<name>/SKILL.md` seeds, `sessions/`, and the
generated `pi-agent-dir/unown-sandbox-shell`.

Silent-break risks we already carry **[V-vendor]**: `pi: any` factory parameters
and `extensionFactories: [x as any]` mean **no** event name or `ctx` member is
typechecked; `runtime as any` at `cli.ts:509,526`; hardcoded pi built-in tool
names (`bash`, `powershell`, `read`, `write`, `edit`); theme token names
(`accent`, `success`, `muted`, `warning`, `error`, `dim`, `toolTitle`); and
`runner.ts:223` deliberately **drops** pi's own AGENTS.md chain. A rename of any
of these fails behaviorally, not at typecheck.

## Appendix B — oh-my-pi embedding and extension contract map

| pi surface we use | oh-my-pi equivalent | Status |
|---|---|---|
| `createAgentSessionServices` + `createAgentSessionFromServices` + `createAgentSessionRuntime` | single `createAgentSession(options)` (`sdk.ts:540-948`) | rewrite; the three-step services/runtime factory shape is **absent** from the candidate (GitHub code search, 0 results) |
| `SessionManager.create/inMemory` | exists, plus `continueRecent/list/open` | compatible |
| `SettingsManager.create(cwd, agentDir)` / `.inMemory({shellPath})` | `Settings.init({cwd, agentDir})`; shim `SettingsManager` with **no-arg** `inMemory()` | degraded — override dropped |
| `resourceLoaderOptions.extensionFactories` | `extensions: ExtensionFactory[]` (`sdk.ts:674`) + shim support | compatible |
| `resourceLoaderOptions.additionalSkillPaths` | `skills` option, `skills.customDirectories`, or `resources_discover.skillPaths`; shim path warns on missing instead of throwing | compatible, different ergonomics |
| `resourceLoaderOptions.appendSystemPrompt` | `appendSystemPrompt` (`sdk.ts:649`) | compatible |
| `resourceLoaderOptions.agentsFilesOverride` | shim-only (972 → forwarded as `contextFiles`); natively call `discoverContextFiles` and merge | shim-dependent |
| `noSkills/noPromptTemplates/noContextFiles` | shim flags honored | compatible |
| `noThemes` | **silently dropped** in the shim | lost |
| `InteractiveMode` | present (`modes/interactive-mode.ts:1187`) | compatible |
| `runPrintMode` | **not** in the root barrel; subpath `modes/print-mode` (`print-mode.ts:112`) | import path change |
| `parseFrontmatter`, `Type`/`StringEnum`, `Key`/`Text` | shim exports `parseFrontmatter` (445), `Type` via `legacy-typebox` (1610), pi-ai `StringEnum` **[U]** | mostly compatible |
| `pi.on(...)` event names | **all seven verbatim** (`extensibility/extensions/types.ts:1623-1693`) | no translation needed |
| `ctx.sessionManager.getEntries()`, `appendEntry` | native `SessionManager.appendCustomEntry()` (3591) / `getEntries()` (3813) exposed as `ReadonlySessionManager` | compatible |
| `--mode json` records | JSONL: `SessionHeader` line then `AgentSessionEvent`s; `message_update` strips `partial`; completion via `agent_end.isTerminal` | parser retarget |
| `models.json` provider array | `models.yml` provider **map**; `models.json` auto-migrated when both YAML files are absent | assume migration, verify array→map **[U]** |
| `modelRuntime.getModel/getAvailableSnapshot` | `ModelRegistry.find()` / `getAvailable()` / `getProviderModels()` | rename |
| `thinkingLevel: "off"` | `createAgentSession({thinkingLevel})`, `--thinking off`, plus per-model `reasoning:false` / `requiresEffort:false` | compatible |

Bash-tool jail seams that *might* work, unproven: legacy
`createBashTool(cwd, {operations, spawnHook})` (shim:497-558) is honored, and
`tool_call` input rewriting is possible — neither is evidenced as a complete
replacement for an external shell wrapper **[U]**.

## Appendix C — AutoDream versus oh-my-pi memory

Their `local` backend: root `<agentDir>/memories/--<encoded-cwd>--/` holding
`MEMORY.md`, `memory_summary.md`, `skills/<name>/SKILL.md`, `learned.md`, with a
shared SQLite `agent.db` (`threads`, `stage1_outputs`, `jobs`). Two phases at
session start: per-session extraction (role `default`, lease 120 s, concurrency 8,
skips age > 30 d, idle < 12 h, > 64/startup, non-CLI sourceKind, subagents,
non-persisted sessions) then consolidation (role `smol`, lease 180 s + 30 s
heartbeat) writing `MEMORY.md` / `memory_summary.md` / `skills/`. Injection is a
Memory Guidance block capped at 5000 tokens shared with lessons, pinned per
session. Pattern redaction both ways. `/memory sync` only bumps a watermark — the
work happens **next startup** **[V-cand]**.

| Dimension | Unown AutoDream | oh-my-pi `local` |
|---|---|---|
| Ingest | HTTP `POST /api/notes` + on-disk outbox fallback | its own session `.jsonl` only, no ingest API |
| Trigger | engine router, any time | CLI startup only |
| Scope | 4 tiers: policy / project / user / local | one project root + `learned.md` |
| Versioning | `memory_versions` tier/version/changed_by, rollback | none — plain overwrite |
| Gate | canary re-run of last-passing task, auto-rollback | none |
| Skills | minted with DB provenance + rollback + retirement | generated `skills/`, overwritten and pruned |
| Cross-project | one queue groups per-project dreams | per-cwd jobs executed only by that project's own process |
| External drive | designed for it | **[V-cand]** not possible except by hand-editing their SQLite or using `mnemopi`'s MCP/CLI |
| Capture tools | `note` tool + session capture | `learn` only for `local`; `retain`/`recall`/`reflect`/`memory_edit` gated to `hindsight`/`mnemopi` |

Running both double-LLMs the same sessions and yields two competing project
memories. Overlap is ~60% of `runProjectDream` + `mintSkillsForProject`, and the
overlap covers only the part we already do with more governance.

## Appendix D — published artifact forensics

`@oh-my-pi/pi-coding-agent@18.11.3` **[V-cand]** unless marked:

| Field | Value |
|---|---|
| `engines` | `bun >= 1.3.14`; **no** node engine |
| `bin` | `omp → dist/cli.js`, shebang `#!/usr/bin/env bun`, `// @bun`, `import.meta.require` |
| `dist.unpackedSize` | 47,541,199 (measured 53 MB); tgz 14.7 MB; 3,286 files |
| ships `src/` | yes — 2,889 `.ts` files, runs from source under bun, no build step |
| `.node` in core tarball | **0** **[V]** |
| `dependencies` | includes `@oh-my-pi/pi-natives`, `pi-catalog`, **`pi-mnemopi`**, `pi-tui`, `pi-utils`, `pi-agent-core`, `pi-ai`, `pi-wire`, `snapcompact`, `omptype`; plus `puppeteer-core`, `axe-core`, 11 `@opentelemetry/*` **[V]** for natives being a hard dep |
| `optionalDependencies` | `@huggingface/transformers ^4.2.0`, `sherpa-onnx-node 1.13.2` |
| native leaves | 6 per-platform packages; `pi-natives-linux-x64` unpacked **230,632,785** (two 109.5 MB ISA variants); win32-x64 115,890,641; darwin-arm64 99,614,855 |
| forced floor | **≈ 330 MB** versus our 22 MB `pi-repo/` |
| ML transitive | `onnxruntime-node 1.24.3` ≈ 301 MB unpacked via transformers; `fastembed` is a *peer* of mnemopi with a documented runtime install plan (network) |
| source build | 9,964 files; TypeScript 74 MB, **Rust 10.55 MB** across 13 crates (incl. vendored `brush-core`); `rust-toolchain.toml` = `nightly-2026-10-06`; `.bazelversion` 9.2.0; every release addon built by Bazel, Windows addons cross-built from Linux |
| runtime network | catalog `catalog.stencil.so/models.json.zstd` (background; bundled baseline; `refresh("offline")` available); update check `build.stencil.so` **only for compiled-binary installs**; OTLP telemetry only when configured; tree-sitter grammars beyond common ones are **downloaded on first use** |
| bun-only surface | `Bun.file` 316, `Bun.spawn` 49, `bun:sqlite` 20, `bun:ffi` 9, `Bun.serve` 9, `import.meta.require`, `with { type: "text" }` imports — Node execution is effectively impossible |

## Appendix E — governance and churn metrics

| Metric | Value |
|---|---|
| license | MIT, © 2026 Stencil Labs, Inc.; `THIRD-PARTY-NOTICES.txt` copyleft scan found LGPL-3.0 sharp-libvips, MPL-2.0 lightningcss, CDDL-1.0 inferno; `deny.toml` allowlist contains **no** GPL/AGPL (crate-level check **[U]**) |
| scale | 35,734 stars, 3,922 forks, 3,806 open issues, 31,331 commits, 405 contributors, 911 tags |
| cadence | 741-1,368 commits/week over 13 weeks (mean ~1,013); releases Aug 20 / Sep 46 / Oct 34 (partial); **683** npm versions, single `latest` dist-tag |
| stability | 52 changelog releases, **6** with `### Breaking`, and they ship in **minor and patch** bumps; no semver section in `CONTRIBUTING.md`; policy "only the latest release is supported", security report = email one person |
| breaking examples | `ui.approve()` returns strings not booleans; `SessionStorage.claimSessionFile` → `claimSession(sessionId, path)`; `task.completionProbeMs` → `completionProbe`; task `complexity` → `solutionSpace`; `hub` tool deprecated for `proc://`; `irc.timeoutMs` removed; edit wire syntax `SM:` → `*** Edit File:`; bash `env` param **removed**; `createAgentSession` now throws on unrestorable models |
| supply hygiene | good: SLSA v1 provenance + registry signatures, OIDC trusted publisher for native leaves, committed `Cargo.lock`, `cargo-deny`, Bazel + Nix. bad: **no** dependabot/renovate, 3 workflows total, 1 npm maintainer holding 42% of commits |
| upstream position | last pi-mono sync 2026-03-22 (~pi 0.61-0.62 **[C]**); upstream pi at 1.3.0 (2026-10-15) → **~6.8 months stale**, and *older than our 0.84.3* |
| exit ramp today | 3 import specifiers, 1 modified upstream script, no binaries — extremely cheap. Post-swap pins: Rust `.node` per platform, Bazel/Cargo/Nix, `~/.omp` config + install-id, YAML settings split, mnemopi SQLite banks, session-claim API, omptype schemas, `proc://`, edit wire syntax |

## Appendix F — reproduction commands

The checks that flip the verdict, reproducible without cloning either repo:

```bash
# 1. Natives are a hard dependency and load eagerly at module evaluation
curl -sL https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/package.json | grep -B2 -A2 pi-natives
curl -sL https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/natives/native/index.js | sed -n '18,30p'

# 2. The bash tool does not honour shellPath for plain tool calls
curl -sL https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/tools/bash.md | sed -n '36p'

# 3. Prove an API is absent without cloning (negative claim needs a search that could find it)
gh api "search/code?q=createAgentSessionServices+repo:can1357/oh-my-pi" --jq .total_count   # 0
gh api "search/code?q=agentsFilesOverride+repo:can1357/oh-my-pi" --jq .items[].path         # the shim only

# 4. Artifact forensics: sizes, platform leaves, file counts, .node presence
npm view @oh-my-pi/pi-coding-agent dist.unpackedSize engines optionalDependencies
cd /tmp && npm pack @oh-my-pi/pi-coding-agent@18.11.3 && tar tzf oh-my-pi-pi-coding-agent-*.tgz | grep -c '\.node$'

# 5. Version positions: our base vs upstream pi vs the candidate's sync marker
grep '"version"' pi-repo/packages/coding-agent/package.json
npm view @earendil-works/pi-coding-agent version time.modified
curl -sL https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/porting-from-pi-mono.md | sed -n '1,12p'

# 6. Our own blast radius
grep -rnE "@earendil-works/pi-|coding-agent/dist|modelRuntime|SessionManager|SettingsManager|createAgentSession" \
  pi-repo/packages/self-learning/src bin/unown mini-services scripts --include=*.ts --include=*.mjs | cut -d: -f1 | sort | uniq -c | sort -rn
git log --oneline -- pi-repo | wc -l
```

Two discipline notes worth keeping. First, a negative claim ("X does not exist in
that repo") is only legitimate as a code-search that would have found it — the
first grep of a barrel file showing zero hits was *misleading* here, because the
candidate's `index.ts` star-exports and the symbol lived in a sibling shim.
Second, an API-name-preserving shim is not a behavior-preserving one: the two
most dangerous findings in this assessment were both silent argument drops, not
errors.

## Related pages

- [memory.md](memory.md) — the 4-tier stack and AutoDream this record compares against
- [subagents.md](subagents.md) — the `task` tool whose `--mode json` grammar would retarget
- [providers.md](providers.md) — `models.json` / `auth.json` / `settings.json` wiring the bridge, and its `models.yml` counterpart in the candidate
- [skills.md](skills.md) — AutoDream-minted skills versus generated `skills/`
- [testing-strategy.md](testing-strategy.md) — the gate discipline §9 applies
- [benchmark-research.md](benchmark-research.md) — sibling research record
- [`pi-repo/packages/self-learning/AGENTS.md`](../pi-repo/packages/self-learning/AGENTS.md) — the authoritative local-patch list a pi re-sync must re-apply
- [`pi-repo/AGENTS.md`](../pi-repo/AGENTS.md) — upstream development rules for the vendored tree
