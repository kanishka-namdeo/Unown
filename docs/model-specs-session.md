# The Model Specs Round — the session record

> The resumable checkpoint log for the model-spec detection mission
> (2026-10-30 →): automatically detect model specs (context window, max
> output tokens, pricing, input modalities) from verifiable sources once a
> model has been configured — and when nothing verifiable can be found,
> ask the user to input them before the model is usable. The specs drive
> Unown's processes directly: compaction triggers, the output cap,
> `unown usage` cost estimates and the turn-meter `~$` chip. A wrong spec
> is never cosmetic — it is either a silent capability cut (premature
> compaction, capped answers) or an overflow loop (compaction firing too
> late). Each checkpoint states what is done, what is verified, and what
> is next, so an interrupted session resumes from the last green state.

- [Checkpoint 0 — the mission opens: research, the landscape, the design](#checkpoint-0--the-mission-opens-research-the-landscape-the-design)
- [Checkpoint 1 — the core detection module (M2)](#checkpoint-1--the-core-detection-module-m2)
- [Checkpoint 2 — the gate wired (M3–M5)](#checkpoint-2--the-gate-wired-m3m5)
- [Checkpoint 3 — the CI red fixed, the port, the bridge + engine lanes, `unown models verify`](#checkpoint-3--the-ci-red-fixed-the-port-the-bridge--engine-lanes-unown-models-verify)

## The contract

The mission's requirement, verbatim: *"we want to automatically detect the
model specs from verifiable sources which are relevant for unown's processes
once the model has been configured. if we cannot find, we must ask the user
to input those before they can start using the model. understand how other
products do this and incorporate these workflows and edge cases into
Unown."*

Three binding readings:

1. **Detection is a first-class flow, not a table edit.** The cascade runs
   at configuration time (setup, providers add/refresh) and self-heals at
   session preflight for models registered before this round.
2. **The gate is real.** A model whose specs cannot be verified is not
   usable: the interactive wizard asks for the two numbers before writing
   the config; non-interactive `setup` fails with new flags
   (`--context-window`, `--max-tokens`) as the remediation; the session
   preflight asks once (interactive) or aborts with the remediation (print
   mode). `UNOWN_ALLOW_UNVERIFIED_SPECS=1` is the documented escape hatch.
3. **Provenance is part of the answer.** Every spec carries where it came
   from (curated catalog / models.dev / LiteLLM / the endpoint's own
   catalog / user-entered / learned from an upstream error) and is
   surfaced everywhere specs are shown. "Never guess" stays the law —
   detection replaces guessing with verifiable sources, and asks
   otherwise.

## Checkpoint 0 — the mission opens: research, the landscape, the design

**Done.**

- The landscape research: how eleven products and five spec registries
  detect (or ask for) model specs — [the decision record](model-spec-detection-research.md).
- The codebase audit: every spec consumer mapped
  (`model-specs.ts`, `providers.ts`, `setup.ts`, `runner.ts`, `term.ts`,
  the bridge's `usage.ts` + `usage-cli.ts` mirror, pi's
  `provider-composer.ts` fallbacks) — the seams where detection hooks in.
- The design fixed (see the decision record's "The design" section):
  the detection cascade order (curated → models.dev → LiteLLM → the
  endpoint's own catalog → user), the provenance sidecar
  (`~/.unown/agent/model-specs.json`), the per-model spec records on the
  provider upsert, the gate semantics, and the bridge's
  catalog-spec passthrough + error-message learning.

**Verified.** Nothing shipped yet — this checkpoint is research and
design only; the code paths named above were read at the pinned HEAD
(`2d9ac299`), and every claim in the decision record carries its
source (URL, `file:line`, or reproduced command).

**Next.** M2: the core detection module
(`pi-repo/packages/self-learning/src/model-spec-detect.ts`) — pure
matching/normalization/sanity logic, the registry cache, the sidecar —
and its unit tests.

## Checkpoint 1 — the core detection module (M2)

**Done.** `model-spec-detect.ts` (829 lines): the pure matching/
normalization/sanity core — `specIdCandidates` (the id ladder), `familyMatch`,
the models.dev / LiteLLM / endpoint-catalog parsers, the registry index +
24h disk cache with stale-while-error and probe-failure caching, the
field-wise `mergeSpecParts` (first verifiable hit per field, priority =
cascade order), the `detectModelSpec` orchestrator (endpoint → curated →
models.dev → LiteLLM; bounded per-source network, never throws), the
provenance sidecar (`readSpecSidecar`/`recordSpec`/`getRecordedSpec`,
`userSpec`), and the shared display helpers (`formatSpecLine`,
`specSourceLabel`). 63 unit tests against the real payload shapes of every
source (`test/model-spec-detect.test.ts`).

**Verified.** The suite green at the pinned commit; the registries are
hermetic in tests (dead loopback URLs; live registry shapes were captured
as fixtures first).

**Next.** M3–M5: the wiring — providers, setup, the gate, the preflight.

## Checkpoint 2 — the gate wired (M3–M5)

**Done.** `spec-gate.ts` — the ONE shared verdict every caller uses
(`resolveSpecGate`: sidecar record → hand-edited models.json values → the
detection cascade → unverified-with-remediation), `askSpecNumbers` (the
interactive ask: validation, clamp feedback, bounded retries), and
`allowUnverifiedSpecs` (the `UNOWN_ALLOW_UNVERIFIED_SPECS=1` escape).
Wired: `unown setup` (the wizard's ask step + `--context-window`/
`--max-tokens` flags + per-model `modelSpecs` stamping through the upsert),
`unown providers add` (the gate on registration), the session preflight
(self-heal, ask-once interactively, abort with the remediation in print
mode), `providers refresh` (per-id detection, never asks), the widened
probe (`EndpointProbe.modelEntries` — the catalog entries the cascade
reuses instead of re-fetching), and the provenance surfaces (`unown
models`, doctor, info). 30 new tests (22 unit + 8 subprocess golden).

**Verified.** The full self-learning suite green (5,071 pass at the
commit). The CI battery then caught what the local run could not: the
golden lanes hit the gate with unregistrarable model ids (below).

**Next.** The CI red, then the bridge lane (M6), the engine lane, and the
missing `unown models verify` surface.

## Checkpoint 3 — the CI red fixed, the port, the bridge + engine lanes, `unown models verify`

**Done.**

- *The CI red* (`57d93e09`): `providers add` non-interactive +
  unverifiable now WARNS (exit 0) instead of refusing — the registration
  itself succeeded, `providers add` is a registration action (the design
  record's bulk rule), and the HARD gate already fires at session start.
  The CLI test helpers and the unit `_env.ts` point the spec registries at
  dead loopback ports (a golden run must never depend on live models.dev /
  LiteLLM fetches — an air-gapped CI or a registry outage flipped
  verdicts); the two setup goldens that pin `--force`/merge semantics ride
  the documented escape for their unregistrarable ids. A pre-existing
  windows-only prune-test timeout got an explicit budget (`c3165f93`).
- *The port* (`308e45cd`): `ProviderEntry.modelSpecs` carries `cost`
  (USD/1M, written with all four ModelCostSchema fields) and `imageInput`
  (a positive modality report — only ever upgrades); `applyModelSpecs`
  patches cost + input alongside the two limits and never erases a cost it
  was not given; setup carries them on both lanes (`specToModelSpec`,
  `detectExtraSpecs`); the probe's `modelEntries` are TRIMMED to the
  spec-relevant fields (catalog noise — descriptions, pricing pages,
  logos — never rides the probe), still capped at 256.
- *The bridge lane (M6)* (`1d32ed7b`): `/v1/models` passes the upstream's
  spec fields through per entry (the DeepInfra precedent, in the shapes the
  agent's parser reads); `/health` reports `modelSpecs` + `learnedSpecs`;
  an upstream 400 that names the real context limit (OpenAI/OpenRouter/
  Mistral/DashScope/Kimi shapes) is learned into
  `model-specs-learned.json` — once per change, pass-through requests only,
  surfaced never auto-applied; pricing resolution gains the model-specs
  sidecar between env overrides and the estimate table (bridge + the
  `unown usage` CLI mirror, `pricing.sidecarPriced`, the `~` marker drops
  for sidecar-priced costs).
- *The engine lane* (`1d32ed7b`): the sandbox agent-dir seeds sidecar-first
  and runs ONE bounded fire-and-forget detection for uncurated/unrecorded
  models — best-effort, never gated.
- *`unown models verify`* (`b93f619a`): the explicit detection pass — the
  shared gate re-runs for the registered models (`--provider`, `--model`,
  `--json`), records provenance, heals models.json, and absorbs the
  bridge's learned limits with `learned` provenance; exits 1 when any
  model stays unverified. Live-verified against the real stack: both
  bridge models verify through the curated catalog with models.dev
  enriching cost/modalities — the sidecar records the field-wise
  contributors exactly as designed.
- *The reference docs*: `.env.example`, `docs/configuration.md`,
  `docs/providers.md` (the new "Model specs — detection, the gate, the
  sidecar" section), `docs/usage-tracking.md`, `docs/usage.md` — all
  check_docs green.

**Verified.** self-learning 5,088 pass / 0 fail (224 files); bridge 238
pass / 0 fail (243 tests incl. the new serving suite `specs.test.ts` — the
real spawned bridge against mock upstreams); `unown models verify` green
against the live Agnes stack; the docs gates green.

**Next.** The release: the CHANGELOG entry, the version bump, the
cross-platform build matrix.
