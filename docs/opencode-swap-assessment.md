# Replacing our vendored pi with opencode: assessment and decision

> Purpose: decide whether Unown should swap its vendored pi base (`pi-repo/`,
> `@earendil-works/pi-*` 0.84.3) for **opencode** (`sst/opencode`, whose own
> `package.json` repository field says `github.com/anomalyco/opencode`) and keep
> working with our tiered memory system, and record the evidence so the decision
> survives AutoDream.
>
> Research and decision note, 2026-10-17, one day's distance from
> [oh-my-pi-swap-assessment](oh-my-pi-swap-assessment.md). Method: a `--depth 1`
> clone of the candidate plus eight parallel source-audit threads over both
> repositories, with every claim capable of flipping the verdict re-derived by the
> main agent at source. No code was changed by this assessment and no behavior
> changed.
>
> Verdict: **No as the engine substrate — and the reason is not the one that killed
> oh-my-pi.** opencode is the first candidate that *satisfies* our chokepoint
> invariant: execution is spawn-based, so the bubblewrap jail injects at a supported
> seam; instruction discovery walks every ancestor directory, so the DOX chain
> survives; injection supplements rather than replaces and re-diffs **per model
> step**; and it ships **no** competing memory pipeline, so AutoDream, the ship gate
> and the canary gate are duplicated by nothing. The blocker moved one layer out, to
> the artifact: opencode publishes **compiled platform binaries, not source**
> (`@opencode/cli` unpacks to 8,417 bytes; its `linux-x64` leaf is 202 MB), the v2
> line is six weeks old with **no semver policy and zero `### Breaking` changelog
> headings**, there is no `main` branch, and `SECURITY.md` states plainly that
> sandboxing is out of scope. Our product is versioned, attributable, gated learning
> state sitting on a harness we can pin and diff; opencode offers neither. Keep pi as
> the substrate. opencode is nonetheless admissible as an **optional second terminal
> harness** in a way oh-my-pi never was, and its MCP client plus tree-sitter
> command-permission model are the two ideas to port now. The one experiment that
> would change this verdict is in §10.

## Contents

- [1. Method and evidence tiers](#1-method-and-evidence-tiers)
- [2. The structural cause, retested](#2-the-structural-cause-retested)
- [3. Blast radius: what we would actually move](#3-blast-radius-what-we-would-actually-move)
- [4. Layer-by-layer assessment](#4-layer-by-layer-assessment)
- [5. What opencode buys us that pi does not](#5-what-opencode-buys-us-that-pi-does-not)
- [6. What stays broken at full effort](#6-what-stays-broken-at-full-effort)
- [7. Cost if pursued anyway](#7-cost-if-pursued-anyway)
- [8. The finding that mattered more than the question](#8-the-finding-that-mattered-more-than-the-question)
- [9. Decision and investment order](#9-decision-and-investment-order)
- [10. Revisit triggers and the go/no-go gate](#10-revisit-triggers-and-the-gono-go-gate)
- [11. Honest cost of staying](#11-honest-cost-of-staying)
- [12. Corrections register](#12-corrections-register)
- [Appendix A: opencode v2 integration surface map](#appendix-a-opencode-v2-integration-surface-map)
- [Appendix B: chokepoint evidence](#appendix-b-chokepoint-evidence)
- [Appendix C: hook and tool parity](#appendix-c-hook-and-tool-parity)
- [Appendix D: collision matrix](#appendix-d-collision-matrix)
- [Appendix E: artifact and supply-chain forensics](#appendix-e-artifact-and-supply-chain-forensics)
- [Appendix F: our pi coupling inventory](#appendix-f-our-pi-coupling-inventory)
- [Appendix G: reproduction commands](#appendix-g-reproduction-commands)

---

## 1. Method and evidence tiers

Two trees, read in full where it mattered:

| Tree | State |
|---|---|
| `D:/test_agent/Unown` | our repo, `main`, `pi-repo/` squashed copy at 0.84.3 |
| `D:/test_agent/opencode-probe` | `--depth 1` clone, HEAD `8c173a8` (2026-10-17), monorepo `2.0.32`, `packageManager bun@1.4.2`, default branch `dev` |

Eight concurrent threads over genuinely disjoint dimensions: integration shape,
execution/sandbox seam, context and memory injection, plugin/hook contract,
provider and bridge viability, our own coupling inventory, feature collisions, and
supply-chain/artifact reality. Registry facts came from `npm view` and GitHub API
reads, listed in Appendix G.

Every load-bearing claim carries a tier:

- **[V]** — verified in a file at a cited `path:line`, by a reproduced command, or by
  the main agent reading the source. Where the main agent read it personally the
  citation is quoted in full.
- **[C]** — reported by a research thread and not re-read. Correct in substance,
  one dereference from fact; re-check before building on one.
- **[U]** — unknown. What a spike must settle, listed in §10.

A negative claim ("feature X is absent") is only made where the search could have
found the counterexample. The two that matter — opencode has no memory pipeline, and
opencode has no working LSP — were swept across all of `packages/core/src` for
`consolidat|recall|knowledge_base` and `textDocument|vscode-languageserver|LanguageClient`
respectively, not skimmed from a barrel file, because a star-export hides the symbol
in a sibling module.

## 2. The structural cause, retested

The invariant the oh-my-pi record derived, and which this candidate is measured
against unchanged:

> **A harness that a governance layer wraps from the outside must expose an external
> chokepoint for execution and for context injection, and must keep them documented
> and stable.**

pi satisfies it. oh-my-pi closed both seams deliberately, which is why it was
rejected. **opencode satisfies both halves of the first clause, and is ambiguous on
the second.** That is the whole finding, and it inverts the previous verdict's
mechanism.

**Execution: the seam is open [V].** opencode's model-facing shell tool builds
`<shell> -c "<command>"` and spawns the shell binary as a real subprocess:

- `packages/core/src/shell/select.ts:164-168` — `args()` returns `["-c", command]` for
  POSIX shells (`/c` for `cmd`, `-Command` for PowerShell).
- `packages/core/src/shell/select.ts:172-188` — `resolve()` prefers the config `shell`
  value, else `$SHELL`, else a fallback; it re-resolves rather than caching a stale path.
- `packages/core/src/shell.ts:263-278` — the invocation draft `{command, cwd, timeout,
  shell, env}` is assembled, then `hooks.trigger("shell", "create.before", invocation)`
  fires against a **mutable** object (`packages/plugin/src/effect/shell.ts:3-12`),
  before any spawn.
- `packages/core/src/shell.ts:296-308` — `environment.spawner.spawn(ChildProcess.make
  (invocation.shell, args, {cwd, env, detached: true}))`.

So our generated wrapper injects four independent ways, ranked in Appendix B. Setting
the config `shell` key to the bwrap wrapper is **exact parity** with today's
`SettingsManager.inMemory({ shellPath })` at
[pi-repo/packages/self-learning/src/runner.ts:216](../pi-repo/packages/self-learning/src/runner.ts#L216)
— the wrapper receives `-c "<cmd>"` and re-execs under the jail. The same spawner also
carries ripgrep, git snapshotting, formatters and stdio MCP servers
(`packages/core/src/ripgrep.ts`, `git.ts`, `formatter.ts`, `mcp/stdio.ts` **[C]**), so
swapping the spawner layer jails *more* than our current shell-only jail does.

**Context: the seam is open and stronger than pi's [V].**

- `packages/core/src/config/plugin/instruction.ts:232-235` — `ancestorDirectories(start,
  stop)` recurses from cwd to the project root, and `:51-58` builds candidates from
  every one of them plus the global `AGENTS.md`. **Our nested DOX chain loads.**
- `instruction.ts:24-25` documents `config.instructions` as "a request, not discovery",
  and `:183` appends those files after global and project — supplement, not replace.
  `:211-217` exposes `discovery.transform(editor => editor.add(file))`, the same seam
  the internal plugin uses.
- `packages/core/src/session/runner/llm.ts:201-204` — `prepareContext` calls
  `InstructionState.prepare(db, bus, selected.instructions, sessionID)` on every step
  (`:168`, `:218`), so instruction content is hash-diffed and re-injected **per model
  step**. pi re-resolves per session; oh-my-pi per process.

**The clause opencode does not satisfy is "documented and stable".** The seams exist
in code at this commit; nothing promises them. `SECURITY.md` states: "OpenCode does
**not** sandbox the agent. The permission system exists as a UX feature … If you need
true isolation, run OpenCode inside a Docker container or VM," and lists *sandbox
escapes* as out of scope **[V]**. The jail is ours by design — fine, and already true
today — but the injection points we would stand on are not a supported API, on a
release line with no compatibility contract (§8, Appendix E).

**And a genuinely new result: no competing memory pipeline [V].** The full sweep of
`packages/core/src` for `consolidat|recall|knowledge_base` returns two files, both
non-memory: a code comment in `session/compaction.ts:76` and prose in
`workspace.ts:361`. `environment/memory.ts` is an in-memory filesystem driver, not
agent memory. The only summariser is within-session compaction, whose prompt at
`packages/core/src/session/compaction.ts:147` says, verbatim: *"Leave out instructions
and setup the assistant was given rather than told by the user: repository conventions,
instruction files such as AGENTS.md, and environment details like the session ID. The
next agent receives current versions of all of these separately."* opencode therefore
duplicates no part of the 4-tier stack, mints no competing project memory, and — as the
direct consequence — **our canary gate still has no analogue anywhere in opencode.**
That is the opposite of the oh-my-pi finding, where ~60% of `runProjectDream` was
duplicated and the two pipelines would have produced competing project memories.

## 3. Blast radius: what we would actually move

Re-measured at exactly the scope the oh-my-pi record §3 used
(`pi-repo/packages/self-learning/src/**/*.ts` + `bin/unown` +
`mini-services/{agent-service,llm-bridge}/*.ts` + `scripts/*.mjs`), with commands in
Appendix G **[V]**. The prior figures were taken in a different week and have drifted;
both sets are recorded in §12.

| Measure | 2026-10-17 | omp record §3 |
|---|---|---|
| Code in scope | **12,038** lines | 11,526 |
| Files naming pi | **5** | 7 |
| Identifier-bearing pi lines | **34** | 36 |
| `self-learning/src` alone | 27 files, **7,787** lines | not stated |

The five files, and the honest split: only **three are real importers** —
`cli.ts`, `runner.ts`, `tools.ts` — plus
[mini-services/agent-service/smoke.ts:4](../mini-services/agent-service/smoke.ts#L4),
which deep-imports `pi-repo/packages/coding-agent/dist/index.js` and bypasses the
declared workspace dependency. `src/index.ts` matches only inside a doc comment, at
line 2. Six import statements total.

The Next.js app and CI never import pi; the dashboard talks to the engine only over
HTTP/SSE on :3030.

So the code surface stays small — under 2% of our lines name the harness at all. The
real coupling is behavioral **[C]**, counted by the inventory thread: 39 `pi.<method>`
calls, 18 `pi.on()` subscriptions over 10 distinct events, 11 resource-loader option
keys, and ~35 pi tool-name string literals, concentrated in `cli.ts`, `runner.ts`,
`tools.ts`, `hooks.ts`, `termhooks.ts`. Five of our files author formats that pi *reads*
(`models.json`, `auth.json`, `settings.json`, the 51-token theme, SKILL.md limits) while
importing nothing from pi, which is the failure mode that matters: drift there is silent,
not a type error. Appendix F carries the table.

**Headline: the port was never the hard part.** For both candidates, the swap is
cheap in lines and expensive in ownership. Here the ownership question is different in
kind — see §8.

## 4. Layer-by-layer assessment

| Layer | Verdict | Evidence |
|---|---|---|
| Execution jail (bwrap) | **Ports, with broader coverage than today** | spawn-based `-c` shell `shell/select.ts:164-188` **[V]**; four seams, Appendix B; `SECURITY.md` disclaims sandboxing **[V]**, so the jail stays ours |
| Context injection | **Ports, and beats pi** | ancestor walk `instruction.ts:232-235` **[V]**; supplement-not-replace `:24-25,183` **[V]**; per-step re-diff `runner/llm.ts:201-204` **[V]**; caveat: ambient contents ride an `@parcel/watcher` cache **[C]**, fallback is the typed `instruction_entry` route **[V]** |
| Memory pipeline | **No duplication, no conflict** | negative sweep **[V]**; compaction prompt excludes conventions `compaction.ts:147` **[V]** |
| llm-bridge / providers | **Survives unchanged** | user-declared OpenAI-compatible provider, static bearer key, no catalog membership **[C]**; offline switches all real and upstream-used **[V]**, Appendix E |
| Hooks and custom tools | **Ports, with four named losses** | 18 hooks / 5 domains, 12 transform domains **[C]**; `tool.execute.before` veto + `Tool.Error` `promise/tool.ts:39,47,61` **[V]**; losses in §6 |
| Events and observability | **Partial — two events absent** | `session_tree` and `session_shutdown` have no equivalent **[C]**; `GET /api/event` is "volatile by contract", no resume **[C]** |
| Dashboard data | **Improves** | typed cost/tokens columns + committed OpenAPI + generated SDK **[C]**; our 11 tables are ours, pi writes no SQL **[V]** |
| Skills | **Portable in place** | SKILL.md + `skills: [".unown/skills"]` config **[C]**; opencode's validation is *looser* than ours (no ≤64 lowercase-hyphen rule) **[C]** |
| Subagents | **Model differs** | in-process child sessions, depth cap 1, background + completion notice **[C]**; our subprocess `--mode json` capture convention does not exist there |
| Plan mode | **Coexists, ours wins** | theirs is a `plan` primary agent with `edit: deny`, no numbered-plan extraction, no approve-to-execute **[C]**; disable via `agents: {plan: {disabled: true}}` **[C]** |
| TUI theme | **Breaks** | V2 theme vocabulary is hue-scale/semantic; `theme`/`themeMode` read-only to plugins **[C]** — our 51-token `unown.json` + `scripts/check_theme.mjs` lose their target |
| `.unown/agents/*.md` | **Silently dropped** | agent markdown is scanned only inside `.opencode`/`.claude`/`.agents`/global config dirs **[C]**, and a failed frontmatter decode hits `if (!agent) return` at `config/plugin/agent.ts:204` **[V]** — no error, no log |
| Artifact and install | **Blocks the swap** | 8,417 B CLI stub + 202 MB `linux-x64` leaf; 10.1 MB core `dist` **[V]**, Appendix E |
| Governance / churn | **Blocks the swap** | ~373 commits/wk, 5.5 v2 releases/wk, no semver policy, 0 `### Breaking` headings, one npm publisher, provenance off **[C]**, Appendix E |

## 5. What opencode buys us that pi does not

Steelman first, because the honest answer is "a lot", and it is why this candidate
deserves a second look rather than a dismissal.

1. **A complete MCP client.** Config-driven local and remote servers, OAuth with
   refresh coalescing, resources and templates, prompts, per-server and per-tool rules,
   and a CLI (`opencode mcp list|add|auth|logout`) **[C]**. Our own record called an MCP
   client "Unown's only genuine feature gap" for evaluator credibility. It is closed
   here, and it is the single most portable idea in this document.
2. **Command-level permissions from an AST, not a regex.** `tree-sitter-bash` and
   `tree-sitter-powershell` parse a command into subcommand tokens, and approval is
   per subcommand with `allow|ask|deny` over `action × resource` wildcards plus
   persistent `always` grants **[C]**. That is strictly stronger than our
   `isSafeCommand` allowlist, and it is the right shape for the deny list we maintain
   by hand in `hooks.ts`.
3. **CodeMode.** `@opencode/codemode` is a confined acorn-based JS interpreter over the
   schema-described tool catalog, so the model writes a script that fans out tool calls
   in parallel instead of one call per turn **[C]**.
4. **Resumable background subagents** with completion notifications, per-agent model
   and `steps` caps **[C]** — against our blocking 300 s subprocess with a 16 k output
   cap.
5. **Operational plumbing we would otherwise write**: tool-output bounding (2000 lines /
   50 KiB tail, full output spilled to file with retention) **[C]**, image decode and
   resize limits **[C]**, formatter auto-detection **[C]**, worktree and VCS snapshot
   undo/revert **[C]**, session export with a `--sanitize` path, `pair` links, and
   `serve` **[C]**, and a KV/Job/Inbox trio of session-state primitives **[C]** — the KV
   is a better backing store for our `todo` tool than pi session entries.
6. **One server, many clients** (web, app, desktop, mobile share it) **[C]** — a shape
   our engine's REST+SSE API has already chosen unilaterally, so the architecture is
   familiar rather than alien.

## 6. What stays broken at full effort

Things that do not port no matter how much work we spend:

1. **`session_tree` and `session_shutdown`.** No event exists; the closest are
   `session.forked`/`session.moved`, and shutdown is observable only as a plugin's
   `Cleanup` return value **[C]**. Our branch-aware todo reconstruction and our session
   lifecycle bookkeeping both read the tree today.
2. **The 51-token brand theme contract.** Themes are JSON files under a discovered
   `themes/` dir, but the V2 token vocabulary is hue-scale/semantic and plugins cannot
   set `theme` **[C]**. `scripts/check_theme.mjs` would have nothing to validate against.
   Same failure oh-my-pi gave us, without the "silently dropped" aggravator — here it is
   a schema we would have to re-author.
3. **`--plan` as a CLI flag, and CLI flags in general.** There is no plugin API for
   flags **[C]**; `--plan` degrades to switching agents. Our plan protocol (numbered
   `Plan:` extraction, approve-to-execute, `[DONE:n]` tracking) is a layer we would keep
   on top of their permission rules regardless.
4. **Our subagent capture convention.** opencode subagents are in-process child sessions;
   there is no subprocess emitting pi-shaped JSONL, so the `--mode json` parser in
   `tools.ts` and the `[subagent]` note tagging have no target **[C]**.
5. **A synchronous prompt→answer call.** `POST /api/session/:id/prompt` is durable
   admission that returns the inbox item, not the result; final text needs a message read
   or the event stream **[C]**. And that stream is "volatile by contract: a slow consumer
   overflows and fails the stream, and events during disconnection are missed" **[C]**.
   Our SSE feed to the dashboard would need a durable replay path or polling.
6. **Hook parity behind a remote server.** No HTTP route registers runtime code —
   plugins are imported values **[V]** (`sdk/src/internal/host.ts:50-53`,
   `sdk/README.md`). So our 6-layer hooks force either in-process embedding or publishing
   a plugin package. There is no "run the engine's governance over someone else's daemon"
   option.
7. **Hooks run unsandboxed, in a shared process.** Plugin code executes in the server
   process with full privileges, shared by all sessions **[C]**. A policy bug in our hook
   layer stops being a per-session fault and becomes an RCE surface in a process that
   hosts every session.
8. **`.unown/agents/*.md` cannot be discovered in place**, and a shape mismatch
   (our `tools: a,b` CSV vs their boolean map) makes the drop **silent** **[V]** — the
   same "compatibility that fails quietly" class that made the oh-my-pi shim dangerous.

## 7. Cost if pursued anyway

Ordered by what we would actually have to do, not by hours.

1. **Decide the consumption model, and accept that there is no good one.** Pin
   `@opencode/core` + `@opencode/sdk` + `@opencode/server` from npm as libraries
   (10.1 MB dist, published JS **[V]**) and inherit per-platform native leaves plus a
   module-scope native load; or ship instructions telling users to install the
   `@opencode/cli` binary (202 MB **[V]**); or fork-and-vendor a 150 MB Effect-4
   monorepo. pi by contrast is a 22 MB squashed copy that `bun` runs from `src/` with
   `build:offline`.
2. **Rewrite the harness glue.** `runner.ts` (`createAgentSessionServices` /
   `createAgentSessionFromServices`) becomes an `OpenCode.create()` + `sessions.create`
   call; `cli.ts`'s runtime construction and `as any` escapes at its TUI/print call
   sites become a client; `tools.ts`'s 39 ExtensionAPI calls become `ctx.tool`/
   `ctx.command` transforms; `hooks.ts`/`termhooks.ts` become `tool.execute.before` /
   `execute.after` / `permission.evaluate` / `shell.create.before`.
3. **Replace five on-disk formats we author for pi to read** with `opencode.json`
   equivalents — one config document instead of `models.json` + `auth.json` +
   `settings.json`, which is a *simplification*, plus a theme re-author and a SKILL.md
   loader we would delete in favour of `skills: [...]`.
4. **Re-pin provider behaviour.** Author per-model `body`/`variants` overlays so
   `qwen3.7-plus` actually gets thinking disabled (the built-in openai-compatible
   speller only emits `enable_thinking` for ids containing "deepseek" **[C]** — a
   silent-quality trap, not a cosmetic one), ship our own model limits and costs, and
   override the 300 s / 900 s provider timeouts so a dead bridge fails at
   `probe.ts` speed **[V]**.
5. **Own the jail and the update posture outright.** Pin an immutable tag, never track
   `dev`, set `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_MODELS_FETCH`,
   `OPENCODE_DISABLE_FILEWATCHER` as needed, and keep every `package`/plugin specifier
   builtin or `file://` — a non-builtin specifier triggers a runtime npm install
   (`core/src/provider.ts:176-183` **[C]**), which fails inside the jail.
6. **Then re-derive all of it every 5.5 releases**, because there is no contract to
   rely on.

## 8. The finding that mattered more than the question

The question was "can we swap". The answer that matters is **where the blocker moved.**

For oh-my-pi the blocker was architectural and permanent: the harness author closed our
two chokepoints as a design choice, so no amount of effort short of owning a fork would
have opened them. For opencode the blocker is **supply-chain and artifact**, and it is
contingent: the seams are open *in this commit*, but nothing promises them. That
difference changes what a future session should watch for — the oh-my-pi risk could only
be retired by them changing product direction; the opencode risk retires if they publish
a source-consumable, semver-honest v2 with a stated plugin-API stability policy.

Three findings underneath it:

1. **"Binaries, not source" is the whole story for a substrate.** The published v2 CLI
   unpacks to 8,417 bytes **[V]** — a stub whose `postinstall` fetches a platform leaf
   (`@opencode/cli-linux-x64` at 211,842,764 bytes **[V]**). An installer-shim that needs
   lifecycle scripts is, by our own rules, unvendorable and unpin-reviewable. The
   library packages *are* consumable JS, which is why this is a "substrate" verdict and
   not a "cannot be used at all" verdict.
2. **There are two products and the default branch is neither.** npm `opencode-ai`
   latest is **1.19.3** while the clone is **2.0.32**; `@opencode/*` v2 is roughly six
   weeks old (first `@opencode/plugin` publish 2026-09-07 **[C]**); branches `dev`, `v1`,
   `2.0` are release-isolated and `publish.yml` still builds
   `./packages/opencode/script/build.ts`, which does not exist on `dev` **[C]**. Choosing
   opencode today means choosing a migration that is still in flight.
3. **The pi freshness gap is still our real liability, and this pass confirms it a
   second time.** Upstream pi is **1.3.0** (published 2026-10-15) against our vendored
   **0.84.3** **[V]** — the same five-month hole the oh-my-pi record surfaced, and the
   second candidate in two days whose assessment does nothing to close it. `pi-repo/` has
   no upstream remote, so every sync is a manual file merge. **That is the highest-value
   harness-adjacent work available to us, and it is independent of this decision.**

## 9. Decision and investment order

**Do not swap the substrate.** Unown stays on vendored pi. Decision is not
"opencode is bad"; it is that a governance layer whose output is versioned, gated,
attributable state cannot sit on an artifact it can neither pin nor diff.

1. **Fix the dead event branch in our subagent parser** — §12 / Appendix F: `tools.ts:262`
   counts an event pi never emits, so subagent tool-call counts have always read 0. Cheap,
   live, and it invalidates a number the dashboard reports. **[V]**
2. **Pin our JSON-mode contract with a test.** Our parser's expected event names have
   never been checked against pi's emitted union; one grep would have caught #1. Add a
   test that asserts every event name we subscribe to exists in the producer's union.
3. **Make `pi-repo/` diffable and re-sync to pi 1.3.0** (upstream remote or subtree).
   Carried forward from the oh-my-pi record; now confirmed by a second candidate.
4. **Port the MCP client** into our stack — from opencode's design, not its code:
   `mcp.servers` local/remote shape, per-server rules, OAuth coalescing. This is the
   feature gap our own record names, and it closes it without adopting a substrate.
5. **Port the command-permission model**: replace `isSafeCommand`'s allowlist with
   subcommand-level `allow|ask|deny` rules. tree-sitter is optional for a first pass;
   the *rule shape* is the transferable idea.
6. **Keep opencode as the named optional second terminal harness.** It is the first
   candidate that could actually run our tiers: in-process `@opencode/sdk` embed,
   config-`shell` jail parity, ancestor-walking DOX load, `skills: [".unown/skills"]`.
   Gate it behind the experiment in §10 and never let a sandboxed learning run depend on
   it.
7. **Do not adopt opencode's memory model, because there is nothing to adopt** — and do
   not let anyone read its compaction as AutoDream. It is within-session summarisation
   that explicitly refuses to persist conventions.

## 10. Revisit triggers and the go/no-go gate

Reopen this decision if **any** of these becomes true:

- opencode publishes a **source-consumable** v2 (either `src` in the tarball, or a
  documented library-first embed path with pinned native versions) **and** states a
  compatibility policy for the plugin API and the `/api/*` surface.
- Breaking changes start landing under `### Breaking` with real semver, or a documented
  deprecation window appears anywhere in `CONTRIBUTING.md` / `V2_HTTP_API_AUDIT.md`.
- Upstream pi closes a chokepoint — an embedded in-process shell, or context discovery it
  owns and replaces rather than supplements. At that point the invariant stops favouring
  pi, and this candidate becomes the front-runner rather than the risky one.
- Our pi re-sync cost exceeds an opencode pin-and-patch cost, measured, not feared.
- A second surface needs the same agent (web/mobile/desktop over one server), where their
  server/SDK split is a head start rather than a liability.

**The gate.** One runtime experiment, and it must be able to say no:

> Build a spike that embeds `@opencode/sdk` **in-process in our engine** (replacing the
> `runner.ts:213-233` call pair), boots it inside our real bwrap profile with the network
> namespace unshared, and proves four things end to end:
>
> 1. **It boots.** `bun:sqlite`, `bun-ffi`/`bun-pty`, `@parcel/watcher`, the tree-sitter
>    WASM grammars, `photon-node` and `@ff-labs/fff-*` all load with no egress and no
>    writable cache outside the tmpfs — remembering that `SECURITY.md` says sandbox
>    escapes are out of scope, so nobody upstream will tell us when one of these stops
>    loading.
> 2. **The jail holds.** A plain shell tool call re-execs under bwrap through the config
>    `shell` wrapper, *and* the spawner-layer swap covers ripgrep, git, formatters and
>    stdio MCP. Prove escape, not intent: run `pkill`, a `/home` read, and an outbound
>    connect from inside a tool call.
> 3. **Memory is live.** Our 4-tier stack reaches the model, and an AutoDream write is
>    visible on the **next step** (per-step `InstructionState.prepare`), not just the next
>    process — including with `OPENCODE_DISABLE_FILEWATCHER=1`, where only the typed
>    `instruction_entry` route can carry it.
> 4. **The bridge fails fast.** With the bridge stopped, the run aborts at `probe.ts`
>    speed, proving the 300 s / 900 s defaults were really overridden.

Pass all four and a hybrid terminal harness becomes defensible and the substrate question
reopens honestly. Fail (1) or (2) and this verdict stands. Anything short of running the
actual published artifact is not evidence.

**[U] what the spike must settle, that reading did not:** whether the published `dist`
resolves the `#sqlite`/`#pty`/WASM import conditions under host bun without a bundler;
whether `settings.apiKey` is redacted at rest; whether nearest-first instruction ordering
(vs pi's root-first) is safe for a DOX chain whose contract says "read parents first";
whether the `/api/experimental/…/instructions/entries` route we would depend on survives
the next release; and whether `--tools`-style per-session tool restriction and a
per-session system-prompt override exist at all (agent-level only was found).

## 11. Honest cost of staying

Remaining on pi has a price, and part of it is now measurable rather than rhetorical:

- **No MCP client.** The most defensible criticism of our stack, and opencode proves the
  shape we should copy. §9.4.
- **No command-AST permissions.** Our `isSafeCommand` allowlist is regex-shaped where
  theirs is parse-shaped. §9.5.
- **No CodeMode-style parallel tool scripting**, no background/resumable subagents, no
  worktree snapshot undo, no session export or pairing.
- **Our `task` subagents stay blocking subprocesses** with an unvalidated JSON parse —
  and §12 shows that parser is currently wrong in a way we did not notice.
- **The jail is shell-only.** ripgrep, git and formatter calls inside a run are not
  jailed; opencode's spawner seam would jail them. Our own design has no equivalent seam.
- **Compaction is still absent** on our side and on 0.84.3, so long sessions lean entirely
  on the tiered memory stack.

None of these is answered by adopting a 202 MB binary artifact line that is six weeks old,
publishes no source, has no semver contract, one npm publisher with provenance disabled,
and a security posture that explicitly disclaims the isolation our product depends on.
Three of them are answered by porting ideas in §9.

## 12. Corrections register

Claims made during this investigation that the evidence later falsified, kept on purpose
because each is a trap a future session can fall into again.

| # | Initially asserted | Correction | Why the first pass was wrong |
|---|---|---|---|
| 1 | "All `@opencode-ai/*` names are now `0.0.0-reserved`" | `npm view @opencode-ai/plugin` and `@opencode-ai/sdk` both resolve at **1.19.3** **[V]** | A registry *search* result was read as a registry *state*; the scope migration is incomplete in the opposite direction, so v1 plugin knowledge is not worthless and both lines coexist |
| 2 | "17 `patchedDependencies`" | **18** by direct count of the `patches/` directory **[V]** | Quoting a count from memory of a file listing instead of running the count |
| 3 | "Our sandbox bun 1.3.14 cannot run opencode, so the toolchain floor is a blocker" | The floor (`packages/script/src/index.ts:16-17` throws unless `^1.4.2` **[V]`) gates **building from source**. Our engine runs on host bun **1.4.3** and would consume published `dist`, so it is a vendoring cost, not an adoption blocker **[V]** | Conflating the contributor toolchain with the consumer runtime |
| 4 | "Embedding opencode means the model loop moves into the jail, and the bridge becomes unreachable" | `@opencode/sdk` executes the assembled router **in-process** (`routes.ts:100-106` `password: Option.none()`; `sdk/src/internal/host.ts:30-66` in-memory `OwnedFetch`) **[V]**, so the loop stays in the engine exactly where pi's sits and the jail keeps its shape | Assuming a client/server architecture implies a separate server process |
| 5 | "opencode's own memory pipeline may duplicate AutoDream, like omp's did" | It has none: the sweep returns two non-memory hits and the compaction prompt explicitly refuses to persist AGENTS.md/conventions **[V]** | Two harnesses that both say "memory" in their docs are not doing the same job |
| 6 | "The oh-my-pi §3 blast-radius numbers still describe our tree" | Re-measured at that doc's own scope: **12,038** lines (doc: 11,526), **5** files naming pi (doc: 7), **34** identifier lines (doc: 36) **[V]** | A dated count was carried forward as a live one |
| 7 | "Our subagent parser tallies tool results" | `tools.ts:262` reads `tool_result_end`, which nothing emits — the string exists in our line and in upstream's own *example* that also only reads it **[V]**. `toolResults` has always been 0 | Copying an identifier from an example file instead of from the producer's type, exactly the "self-authored gate lies" failure |

Also retired from the previous record by this pass: its §9 revisit trigger "IDE-grade
tooling (LSP diagnostics)" is **not** satisfied by opencode. v2 parses `lsp` config in
exactly one place, `packages/core/src/config/normalize.ts:514` **[V]**, passes it nowhere,
and `packages/schema/src/lsp-event.ts:5` declares an `lsp.updated` event with an empty
schema and **zero emitters** **[V]**. A runtime grep for
`textDocument|vscode-languageserver|LanguageClient` across `core/src`, `tui/src`,
`cli/src` is empty **[V]**. That trigger stays open against pi.

---

## Appendix A: opencode v2 integration surface map

Topology **[C]**: `@opencode/schema` (domain + event shapes) → `@opencode/protocol`
(Effect `HttpApi` endpoint definitions, `packages/protocol/src/groups/*.ts`) →
`@opencode/server` (handlers, `packages/server/src/routes.ts:80-190`) → `@opencode/client`
**generated** from that HttpApi by `@opencode/httpapi-codegen` (`check:generated` script)
→ `@opencode/sdk` (in-process host). A committed `packages/protocol/openapi.json` carries
`info.version: "0.0.1"` labelled "Experimental HttpApi surface", 119 paths **[C]**; the
server serves it at `/openapi.json`.

| Capability | opencode entry point | our pi call-site |
|---|---|---|
| Embedded host | `packages/sdk/src/internal/host.ts:30-66` **[V]**, `sdk/README.md:3` **[V]** | `runner.ts:213` `createAgentSessionServices` |
| Session create with cwd | `protocol/src/groups/session.ts:142` `session.create`, `location.directory` **[C]** | `runner.ts:233` `createAgentSessionFromServices` |
| Prompt | `groups/session.ts:317`; client `promise/generated/client.ts:718` **[C]** | `runner.ts:301` `session.prompt` |
| Stream events | `groups/event.ts:44` SSE + `handlers/event.ts:22`; client `:1729` **[C]** | `runner.ts:241` `session.subscribe` |
| Idle barrier | `groups/session.ts:441` `experimental.session.wait` **[C]** | run-loop completion detection |
| One-shot text | `groups/session.ts:629` `generate` → `{text}` **[C]** | `bin/unown -p` |
| Abort | `groups/session.ts:667` `session.interrupt` **[C]** | pi abort |
| Final text, cost, tokens | `groups/message.ts:68`; `schema/src/session-message.ts:212-235` **[C]** | `runner.ts:268-271` usage accumulation |
| Memory injection | per-session `instruction_entry` route **[V]**, `config.instructions` **[V]**, `discovery.transform` **[V]** | `agentsFilesOverride` at `cli.ts:212`, `runner.ts:223` |
| Hooks | imported plugin values only **[V]** | `extensionFactories` at `runner.ts:218` |
| Service discovery | `client/src/effect/service.ts` registration file with `url/pid/version/password` **[C]** | `.run/*.pid` pidfile convention |

Startup modes **[C]**: `opencode serve` foreground; `--service` detached daemon on a fixed
port per channel with a 0600 registration file; `--stdio` private child with a one-time
random password and stdin EOF as the ownership lease. Embedded hosts get
`password: Option.none()` **[V]**; a loopback daemon is *never* unauthenticated by default
(random `randomBytes(32)`) even though `SECURITY.md` describes the env-var path **[C]**.
Concurrency is serialized per session and parallel across sessions, with isolation by
directory only — workspace endpoints were cut from V2 **[C]**.

## Appendix B: chokepoint evidence

**Execution seams, most to least robust [C on ranking, V on mechanism]:**

1. **Replace the spawner layer.** Embedders accept layer replacements
   (`sdk/src/internal/host.ts:26-28`, `util/src/effect/layer-node.ts`), so
   `CrossSpawnSpawner.node` can be swapped for a bwrap-prefixing spawner. Jails the shell
   tool *and* ripgrep, git, formatters, stdio MCP. Broadest; still a supported seam.
2. **`shell.create.before` plugin hook.** Mutable `{command, cwd, timeout, shell, env}`
   draft, triggered before every spawn at `shell.ts:263-278` **[V]**; covers the model
   shell path only.
3. **Config `shell` = our wrapper path.** Resolved at `select.ts:172-188` **[V]**, wired by
   `packages/core/src/config/plugin/shell.ts:9-19` **[V]**. Zero opencode-side code, exact
   pi parity. Caveat: unrecognised basenames are accepted, so a typo silently loses the jail.
4. **PATH shadowing** — `which()` searches `process.env.PATH` plus a cache bin dir **[C]**,
   so a PATH-fronted `bash` shim works. Strictly worse than 3.

**Kill path:** the spawner targets the detached process group (`detached: true`,
`shell.ts:305` **[V]**), so our wrapper must `exec` bwrap rather than fork it, exactly as
today, or `--die-with-parent` and group-kill diverge. **PTY** (`#pty` → `bun-pty` /
`@lydell/node-pty`) bypasses the spawner but serves only interactive terminals, which
engine runs never open **[C]**.

**Context seams:** `discovery.transform(editor => editor.add(file))` **[V]**,
`Instance.layer(ref, {discovery: false, replacements})` **[V]** to own the node outright,
per-session `instruction_entry` PUT (route confirmed in
`packages/protocol/src/groups/session.ts:571,590,611` and a server test at
`packages/server/test/fetch.test.ts:45` **[V]**, published in `openapi.json:3569,3647`
**[V]**) — entries are read from the DB per step, so this is the fork-free path when the
file watcher is off.

**Freshness caveat [C]:** ambient `AGENTS.md` contents come from an in-memory cache
refreshed by `@parcel/watcher` events with a 100 ms debounce. AutoDream writes from the
engine process, so on Linux inotify should fire — but if the jail or a Windows backend
breaks the watcher, ambient freshness silently degrades to stale-until-restart. The
watcher is disableable (`OPENCODE_DISABLE_FILEWATCHER`, read at
`packages/cli/src/server-process.ts:134` **[V]**), which makes the `instruction_entry`
route mandatory rather than optional.

## Appendix C: hook and tool parity

Plugin model **[C]**: a plugin is `{ id, setup(ctx) }`, not a hooks bag. It registers
imperatively per domain, `ctx.<domain>.hook(name, cb)` or
`ctx.<domain>.transform(editor => …)`; hooks mutate a draft in place. 18 runtime hooks over
5 domains, 12 transform domains, tool schemas accept Effect Schema **or** Standard Schema
**or** raw JSON Schema.

| Ours | opencode mechanism | gap |
|---|---|---|
| pre/post tool hooks | `tool.execute.before` / `execute.after`, `promise/tool.ts:39,47` **[V]** | none; both mutate |
| command deny (`pkill`) | `execute.before` failing with `Tool.Error` (`:61` **[V]**); `permission.evaluate` can force `deny` | a hard deny rule beats the plugin hook **[C]** |
| file access policy | agent `permissions` + `permission.evaluate` + `ctx.permission.assert` **[C]** | none |
| event observation | `ctx.event.subscribe`, an `AsyncIterable` over SSE **[C]** | no in-process bus; volatile stream |
| `session_start` / `agent_end` | `session.created`, `session.execution.*`, `session.idle` **[C]** | none |
| `tool_call` / `tool_result` | `session.tool.called/progress/success/failed` **[C]** | none |
| `input` | `session.hook("prompt")`, `session.inbox.delivered` **[C]** | none |
| `session_shutdown` | plugin `Cleanup` return only **[C]** | **absent as an event** |
| `session_tree` | `session.forked` / `session.moved` **[C]** | **absent** |
| `todo` / `note` / `fetch_url` tools | `ctx.tool.transform(e => e.add({…}))` **[C]** | no read-only flag; use `options.permission` |
| `task` subagent | `ctx.session.create` + `prompt` + agent `mode: "subagent"` **[C]** | subprocess JSON capture convention gone |
| `/todos` `/note` `/agents` `/learning` | `ctx.command.transform(e => e.add({…}))` **[C]** | none |
| `--plan`, `--tools`, `--append-system-prompt` | agent switch + agent `system` + entries **[C]** | **no plugin API for CLI flags** |
| 51-token brand theme | `themes/*.json` discovery, V1 auto-migration **[C]** | read-only to plugins; different vocabulary |
| `.unown/skills/` | `opencode.json "skills": [".unown/skills"]` **[C]** | pointable in place; validation looser than ours |
| `.unown/agents/*.md` | `{agent,agents}/**/*.md` inside **their** config dirs **[C]** | must move or `ctx.agent.transform`; bad frontmatter dropped **silently** **[V]** |

Loading **[C]**: auto-discovered from `<configDir>/plugin{s}/`, `.ts` and `.js` included, so
bun runs our TS directly; npm-registered plugins install at load (jail hazard); the host
injects its own `effect` and `@opencode/plugin` instances and hard-fails foreign copies, so
`effect` is a peer lock onto upstream's major; a failing transform disables the plugin
rather than the session.

## Appendix D: collision matrix

| Surface | Ours | Theirs | Severity | Resolution |
|---|---|---|---|---|
| Task list | `todo` on session entries | **none** — `todowrite` removed (`v1-migration.bun.ts:901` **[V]**); `@opencode/codemode` is a JS interpreter, not a list **[C]** | none | keep ours; back it with their KV shape |
| Notes / memory | `note` → engine → AutoDream | none **[V]** | none | ours is the only writer |
| Tool names | `todo`/`note`/`task`/`fetch_url` | `shell`/`read`/`write`/`edit`/`patch`/`glob`/`grep`/`question`/`skill`/`subagent`/`webfetch`/`websearch`/`execute` **[C]** | none | `bash→shell`, `task→subagent` are **v1 dead names** **[V]**; no renames needed, and plugins may shadow built-ins **[V]** |
| Subagent spawner | subprocess `unown --mode json -p --no-session` | in-process child session, depth cap 1, background + notice **[C]** | high | one spawner wins — theirs, if adopted |
| Agent defs | `name`/`description`/`tools` CSV | `mode`/`permissions`/`model`/`system`; `tools` is a boolean map **[C]** | high | translator required; failure is silent **[V]** |
| Plan mode | flag + `Plan:` extraction + approve-to-execute | `plan` primary agent, `edit: deny`, no approve **[C]** | medium | keep ours; disable theirs |
| Bash safety | `isSafeCommand` allowlist | per-subcommand AST `allow/ask/deny` + persistent grants **[C]** | low, superseded | port their rule shape |
| Skills | seeded + `.unown/skills` | `{root}/skill{s}` + `skills[]` + URL sources **[C]** | medium | two loaders; point theirs at ours, drop ours |
| Provider config | `.env` + bridge + `models.json` + `setup/models/doctor` | `providers{}` + models.dev + `auth login` + a `models` tool **[C]** | high | one source of truth; `doctor` becomes a thin `probe.ts` wrapper |
| MCP | **absent** | full client + CLI **[C]** | none — pure win | adopt the design |
| Theme | 51-token `unown.json` + gate | hue-scale/semantic, plugin-read-only **[C]** | low | re-author or skip |
| LSP | absent | **also absent in v2** **[V]** | none | stays an open trigger against both candidates |

## Appendix E: artifact and supply-chain forensics

**Two release lines, and neither publishes runnable source [V unless noted].**

| Package | Version | `dist.unpackedSize` | Nature |
|---|---|---|---|
| `opencode-ai` (v1, npm `latest`) | 1.19.3 | 7,852 B | installer stub + `postinstall` fetching `opencode-<os>-<arch>` **[C]** |
| `@opencode/cli` (v2 `latest`) | 2.0.32 | **8,417 B** | stub + 12 `@opencode/cli-<platform>` optionalDependencies |
| `@opencode/cli-linux-x64` | 2.0.32 | **211,842,764 B** | ~202 MB compiled platform binary |
| `@opencode/core` | 2.0.32 | 10,124,161 B | `files: ["dist"]`; `./src/*.ts` rewritten to `./dist/*.js` at publish **[C]** |
| `@opencode/sdk` | 2.0.32 | 52,064 B | thin in-process host |
| `@opencode-ai/plugin`, `@opencode-ai/sdk` | **1.19.3** | — | the old scope is *alive*, not reserved **[V]** — see §12.1 |

**Churn [C, from GitHub API and npm `time` data.** The clone is shallow, so no `git log` was
available — which is why these are registry reads rather than local counts, and the reason
the tier is [C] and not [V]:** 4,852 commits in
the last 13 weeks (~373/wk); 33 v2 stable releases in ~6 weeks (5.5/wk) against 36 v1
releases in 90 days; `@opencode/core` carries >1,000 published versions. **No stated semver
policy** — `CONTRIBUTING.md` has zero matches for `semver|breaking|major|minor|patch|compatib`
and `AGENTS.md` only notes "does not use Changesets"; `script/release.ts` defaults to
`patch`; `CHANGELOG.md` has **0** `### Breaking` headings while removals ship in patch bumps.

**Governance [C]:** top three human contributors ≈40.6% of commits, ~25% bot/CI-authored;
the whole `@opencode/*` scope has **one** npm maintainer; `NPM_CONFIG_PROVENANCE: false` with
plain `npm publish`, so provenance-based verification has to come from the git tag.
`sst` → `anomalyco` is a corporate rebrand with a forked pty repo, and the npm scope
migration is still incomplete (`@opencode-ai/pty` lives elsewhere **[C]**).

**Native and toolchain footprint [C on sizes, V on the gate]:** per-platform leaves for
`@lydell/node-pty` (pinned to a **1.2.0-beta prerelease**), `@opentui/core-*`,
`@parcel/watcher`, `@ff-labs/fff-bin-*`, `@opencode-ai/pty-*`, plus `photon-node` and
`web-tree-sitter` WASM loaded with Bun-only `import … with { type: "file" }`. Some load
eagerly at module scope — `core/src/pty/pty.node.ts:9` `createRequire(...)("@lydell/node-pty")`
throws at evaluation **[C]**, the same boot-outage class as oh-my-pi's natives — while
watcher and `fff` degrade gracefully. `18` patches **[V]**, `bunfig.toml
minimumReleaseAge = 259200` **[V]**, two non-npm URL deps, `packageManager bun@1.4.2` with a
hard `^1.4.2` throw in `packages/script/src/index.ts:16-17` **[V]**, and an Effect-4 rewrite
covering ~76% of `core/src` by file count **[C]**.

**Non-provider egress, all disableable [V for the switches, C for the timers]:** models.dev
catalog poll (bundled snapshot is the boot floor) `OPENCODE_DISABLE_MODELS_FETCH`;
`opencode.ai/update/api/…` updater `OPENCODE_DISABLE_AUTOUPDATE` or `update: "disable"`
(`packages/schema/src/config.ts:39` **[V]**); file watcher
`OPENCODE_DISABLE_FILEWATCHER`; OTLP only if `OTEL_*` is set; npm install only for a
non-builtin provider or plugin specifier. No telemetry client exists in the local runtime —
`packages/stats`, `packages/console`, `infra/` and the `salesforce/` directory are hosted-
product code, not the CLI. opencode's **own** `packages/cli/test/fixture/environment.ts`
boots hermetic with isolated `HOME`/XDG, `OPENCODE_DB`, `OPENCODE_CONFIG_CONTENT="{}"` and
both disable flags **[V]**, which is the strongest available evidence that a no-egress boot
is a supported configuration rather than a hopeful one.

**Licensing:** MIT at root and on every publishable package; natives spot-checked MIT; not
an exhaustive legal scan **[C]**.

## Appendix F: our pi coupling inventory

Scope note: the counts below marked **[C]** were tallied by the inventory thread over
`self-learning/src`; the file list, line totals and the defect are **[V]** by the main
agent. Re-derive before building on a `[C]` count.

Harness-agnostic and survivable untouched (import graph): `store.ts`, `server.ts`,
`router.ts`, `tasks.ts`, `mint.ts`, `dream.ts`, `notes.ts`, `outbox.ts`, `bus.ts`,
`llm.ts` (fetches the bridge directly), `index.ts`, `sandbox.ts`, `bwrap.ts`
(the profile itself is harness-free; only its *injection* is coupled).

Harness-bound: `runner.ts`, `cli.ts`, `term.ts`, `tools.ts`, `hooks.ts`, `termhooks.ts`.

Coupled-but-pi-free-import, where drift is silent: `memory.ts` (its `MemoryFile` shape is
consumed only at the `agentsFilesOverride` site), `harness.ts` (needs `runAgent` +
`RunResult`), `skills.ts` (mirrors pi's SKILL.md validator), `term.ts`, `setup.ts`,
`probe.ts`, `theme.ts`, `skill-seeds.ts` (all author formats pi reads).

Hardest five: `tools.ts` at ~1,201 lines of ExtensionAPI plus pi-tui renderers; the TUI/print
host boot in `cli.ts` with `as any` escapes (no types, so no compiler help); the two
`pi: any` extension declarations in `hooks.ts`/`termhooks.ts`; the bwrap `shellPath`
injection that the entire OS sandbox rests on; and the pi-read storage formats.

On-disk state a swap must not orphan: our `db/selflearning.db` with 11 tables — **pi writes
no SQL** **[V]**, so engine state is entirely ours — plus `data/self-learning/memory/*.md`
and `memory_versions`, `sandboxes/`, `~/.unown/notes/outbox|done`, `.unown/{memory,skills,agents}`,
`~/.unown/agent/{models,auth,settings}.json`, `themes/unown.json`. pi-owned: JSONL sessions
under `<agentDir>/sessions/<encoded-cwd>/` with a `type:"session"` header line.

**The live defect [V]:** `pi-repo/packages/self-learning/src/tools.ts:262` branches on
`event?.type === "tool_result_end"` to count subagent tool results. Repo-wide grep across
`pi-repo/packages` excluding tests finds that string in exactly two places — our line, and
`coding-agent/examples/extensions/subagent/index.ts:384`, which also only *reads* it. pi
emits `tool_execution_start` / `tool_execution_end`
([pi-repo/packages/agent/src/types.ts:441-443](../pi-repo/packages/agent/src/types.ts#L441))
and `message_end`
([pi-repo/packages/coding-agent/src/core/agent-session.ts:1505](../pi-repo/packages/coding-agent/src/core/agent-session.ts#L1505),
used correctly by our line 250). The JSON stream is a pass-through of that union
(`coding-agent/src/modes/json-event.ts:46-57`), so the branch can never fire and subagent
`toolResults` has always been reported as 0. Fix is one line; the durable lesson is §9.2 —
assert every event name we subscribe to against the producer's type.

## Appendix G: reproduction commands

```bash
# 1. The execution seam: shell is configurable and spawned as "-c <command>"
sed -n '160,190p' packages/core/src/shell/select.ts         # args() and resolve()
sed -n '254,312p' packages/core/src/shell.ts                 # create.before hook + ChildProcess.make
sed -n '1,20p'   packages/plugin/src/effect/shell.ts         # the mutable draft type

# 2. The context seam: ancestor walk, supplement-not-replace, per-step re-diff
sed -n '40,60p;225,240p' packages/core/src/config/plugin/instruction.ts
grep -n "InstructionState.prepare" packages/core/src/session/runner/llm.ts
grep -rn "instructions/entries" packages/protocol/src/groups/session.ts packages/protocol/openapi.json

# 3. Negative claims — searches that could have found the counterexample
grep -rliE "consolidat|recall|knowledge_base" packages/core/src          # memory pipeline: 2 non-hits
grep -rn "ConfigLSP" packages/core/src packages/server/src packages/cli/src   # LSP: 1 consumer, dead-ends
grep -rn "textDocument|vscode-languageserver|LanguageClient" packages/core/src packages/tui/src packages/cli/src
grep -n "REMOVED_TOOLS\|RENAMED_TOOLS" packages/core/src/database/v1-migration.bun.ts

# 4. Artifact and supply reality
npm view @opencode/cli version dist.unpackedSize
npm view @opencode/cli-linux-x64 version dist.unpackedSize
npm view @opencode/core version dist.unpackedSize
npm view @opencode-ai/plugin version        # 1.19.3 — the old scope is alive
sed -n '1,30p' SECURITY.md                  # "OpenCode does not sandbox the agent"
grep -n "semver\|breaking\|major\|minor" CONTRIBUTING.md   # no policy
grep -c "### Breaking" CHANGELOG.md                        # 0
ls patches | wc -l; grep -n minimumReleaseAge bunfig.toml

# 5. Our own blast radius, at the omp record's scope
{ find pi-repo/packages/self-learning/src -name '*.ts' -print0 | xargs -0 cat; cat bin/unown;
  find mini-services/agent-service mini-services/llm-bridge -maxdepth 1 -name '*.ts' -print0 | xargs -0 cat;
  find scripts -maxdepth 1 -name '*.mjs' -print0 | xargs -0 cat; } | wc -l        # 12,038
grep -rln "earendil-works/pi-\|coding-agent/dist" --include=*.ts \
  pi-repo/packages/self-learning/src mini-services                          # 5 files
grep -rn "tool_result_end" pi-repo/packages --include=*.ts | grep -v /test/     # 2 hits, no emitter

# 6. Version positions, unchanged from the previous record and still the real liability
npm view @earendil-works/pi-coding-agent version time.modified    # 1.3.0, 2026-10-15
grep -m2 '"version"' pi-repo/packages/coding-agent/package.json   # 0.84.3
```

---

## Related pages

- [oh-my-pi swap assessment](oh-my-pi-swap-assessment.md) — the previous harness verdict, and the source of the chokepoint invariant used here. Its §3 blast-radius numbers are corrected by §3; its §9 LSP trigger is corrected by §12.
- [Memory](memory.md) — the 4-tier stack, AutoDream, and the version/rollback model this assessment tests injection against.
- [Providers](providers.md) and [Configuration](configuration.md) — how the llm-bridge is wired today; §4 and Appendix E are the opencode-shaped equivalents.
- [Subagents](subagents.md) — the `task` tool contract, including the JSON-mode parser defect in Appendix F.
- [Skills](skills.md) — the SKILL.md contract dream-minted skills are written against, and the loader opencode would replace.
- [Testing strategy](testing-strategy.md) — where the event-name assertion from §9.2 belongs.
- [Usage](usage.md) — `--plan`, `--tools`, `--append-system-prompt`, and `/todos`/`/note`, the surfaces §6 shows do not survive a swap cleanly.
