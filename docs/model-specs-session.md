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
- [Checkpoint 1 — M2 shipped: the detection core](#checkpoint-1--m2-shipped-the-detection-core)
- [Checkpoint 2 — the gate wired through every surface and v0 0 46](#checkpoint-2--the-gate-wired-through-every-surface-and-v0-0-46)
- [Checkpoint 3 — the port: cost and modality ride the specs](#checkpoint-3--the-port-cost-and-modality-ride-the-specs)
- [Checkpoint 4 — the remaining gap: the bridge (M5)](#checkpoint-4--the-remaining-gap-the-bridge-m5)

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


## Checkpoint 1 — M2 shipped: the detection core

**Done.** `model-spec-detect.ts` (commit `df7ab5e2`): the cascade
(endpoint → curated → models.dev → LiteLLM), the id-normalization ladder,
the sanity bounds (context ∈ [1 024, 100 000 000], output ∈ [1, context],
clamps recorded), the 24 h registry cache with stale-while-error +
per-provider failure caching, the provenance sidecar
(`~/.unown/agent/model-specs.json`), and the field-zoo parsers for every
source's real payload shape (vLLM `max_model_len`, LM Studio
`loaded_context_length`, llama.cpp `meta.n_ctx`, DeepInfra `metadata.*`,
OpenRouter `top_provider.*`, models.dev `limit.*`, LiteLLM
`max_input_tokens`/`max_output_tokens`).

**Verified.** 63 unit tests against the real payload shapes of every
source.

## Checkpoint 2 — the gate wired through every surface and v0 0 46

**Done.** (commit `60f47338`, on top of the delegation round's release
`5644791b` = v0.0.46; CI reds fixed by `f16e8fda` + `57d93e09`.)

- `spec-gate.ts`: the shared verdict — sidecar > hand-edit > cascade >
  ask/remediate, with `UNOWN_ALLOW_UNVERIFIED_SPECS=1` as the documented
  escape. `askSpecNumbers` (validated numeric prompts, 3 tries, clamps
  surfaced), `recordUserSpec`, `resolveActiveModelId`.
- Session preflight (`cli.ts`): runs after the endpoint probe; reuses the
  probe's `/models` catalog (`endpointCatalog` — no new request) +
  `stopWhenComplete` (hot path adds nothing when the registries are not
  needed); self-heals models.json seed stamps (never hand edits) and
  reports; interactive ask-once (TUI), print mode aborts with the
  remediation (exit 1).
- `providers add`: flags → cascade → interactive ask → escape hatch →
  warn-and-continue (registration is not the wall; the wall is first
  use). `providers refresh`/`--all-models`: bulk detection, never asks —
  unverified ids stay unverified until activated.
- `setup` (both lanes): the wizard asks before writing anything; scripts
  get `--context-window`/`--max-tokens` or exit 1 with the remediation.
- Surfaces: doctor (default model, verified → the spec + source, else
  warn), `unown models` (every model's provenance line), the setup
  summary's specs row, `info`.
- Probe keeps the raw `/models` entries (`modelEntries`), tests go
  hermetic (registries at dead loopback ports).
- 30 new tests (22 unit + 8 subprocess golden) pin every lane.

**Verified.** Full suite green at each commit (5 079 → 5 121 tests).

## Checkpoint 3 — the port: cost and modality ride the specs

**Done.** (commit `308e45cd`.) `ProviderEntry.modelSpecs` grows optional
`cost` (USD/1M, pi's ModelCost vocabulary) and `imageInput`;
`newModelRecord` writes priced records and UPGRADES input modalities when
a source positively reported image; `applyModelSpecs` (the self-heal
write) patches cost + input alongside the two limits and never erases an
existing cost it was not given. Setup carries cost/imageInput through on
both lanes; heterogeneous catalogs get priced, modality-correct records.
The probe's `modelEntries` are trimmed to id + the spec fields the
parsers read (catalog noise never rides). A partial catalog (context-only
shape) stamps NOTHING — a partial stamp would write a guessed maxTokens
beside a verified context.

**Verified.** Full suite green (5 186 tests at this HEAD).

## Checkpoint 4 — the remaining gap: the bridge (M5)

**The state.** The self-learning side is done (detection, gate, heal,
surfaces, tests). The BRIDGE side of the design is untouched
(`mini-services/llm-bridge/` last changed in the stress round):

1. `parseModelCatalog` (pure.ts) collapses the upstream catalog to bare
   ids — every spec field the upstream publishes is discarded before it
   can reach the probe.
2. `/health` carries no `modelSpecs`; `/v1/models` synthesizes id-only
   entries (no spec fields per entry — the DeepInfra precedent).
3. No upstream-400 learning: `model-specs-learned.json` does not exist,
   `SpecSource: "learned"` has no producer (the vocabulary slot exists).
4. Pricing resolution (bridge `usage.ts` + the `usage-cli.ts` mirror)
   knows only env overrides → the estimate table — the sidecar source
   (between them, by design) is not read, even though the sidecar
   already carries `cost` records.

**Next.** M5 in the order above, then the polish items (the
`specRemediation` DRY — three hand-written copies; doctor's
batch-verify; the print footer's escape-hint), the docs round
(providers.md, usage-tracking.md, configuration.md, usage.md, README,
the landing page, the blog, the DOX tree), the live Agnes AI end-to-end
pass, and the release (v0.0.47).

## Checkpoint 5 — M5 shipped twice, merged once + `unown models verify`

**Done.** (commits `1d32ed7b` + `b93f619a` on main; the parser widened by
`99707fdf`; a parallel local M5 implementation was reconciled — its
parser enhancements survive, its duplicate wiring was dropped in favor
of main's PASS-THROUGH-only learning rule.)

- The bridge passthrough: `/v1/models` entries carry the upstream's
  spec fields (context/output/vision — the shapes the agent's catalog
  parser reads); `/health` reports `modelSpecs` by id once the catalog
  probe lands. Catalog noise never rides.
- Context-limit learning: an upstream 400 that names the real limit is
  parsed (OpenAI/OpenRouter/Mistral/DashScope/Kimi/DS4 + xAI/Bedrock +
  the output caps `max_tokens must be at most X`) and recorded into
  `model-specs-learned.json` — once per change, never per retry;
  PASS-THROUGH requests only (a routed id's 400 describes the default
  model, not the asked id); surfaced in `/health` as `learnedSpecs`,
  never auto-applied.
- Pricing gains the sidecar source between env overrides and the
  estimate table on BOTH mirrors (bridge `usage.ts` + the CLI's
  `usage-cli.ts`): `sidecarModelPrice` reads the detection sidecar's
  verified cost records; `pricing.sidecarPriced` lists the models so
  priced.
- The engine seed: the runner's first-boot seeding consults the sidecar
  before the catalog guesses (sidecar-first seeding).
- `unown models verify [--provider P] [--model M] [--json]`: the
  explicit detection pass — re-runs the shared gate for the registered
  models, records provenance, heals models.json, records a loopback
  bridge's LEARNED specs with learned provenance; never asks; exits 1
  with per-model remediation when anything stays unverified.
- The parser widened: xAI's "maximum prompt length is X", Bedrock's
  "input is too long … max tokens is X", and the output caps join the
  context patterns; a 400 naming BOTH limits teaches both fields.

**Verified.** 24 new tests on main's lane (12 pure + 5 serving against
the real spawned bridge + 5 bridge usage + 2 CLI mirror) + the runner
seeding pin; suites: self-learning 5 088 pass / 0 fail, bridge 238 →
243 pass / 0 fail after the parser widening.

**Next.** The live Agnes AI end-to-end pass (real endpoint, real
detection, real gate), then the docs round (providers.md,
usage-tracking.md, configuration.md, usage.md, README, the landing
page, the blog, the DOX tree), then the release (v0.0.47).

## Checkpoint 4 — the release: v0.0.47

**Done.** (commit `c781e1c3` on main; the tag `v0.0.47` follows it; the
release workflow builds the six per-OS artifacts + installers + manifest
+ SBOM and publishes the GitHub release.)

- CHANGELOG: the 0.0.47 entry (the round's Added / Fixed / Agent
  Behavior, incl. the in-round learning-parser extension — the xAI and
  Bedrock shapes + the output caps — and the CI-red + windows-timeout
  fixes).
- `package.json` 0.0.46 → 0.0.47; `bun bin/unown --version` asserts
  equal.
- The scroll budget's amendment (3,800 → 3,820w) carries the rail's 46th
  stop; the round's own changelog titles compressed first; the AGENTS.md
  ceiling text synced (catching the delegation round's 3,780 straggle).
- The blog post (`content/blog/2026-10-30-the-model-specs-round.md`),
  the README's connect-a-model + command-block copy, the quickstart's
  wizard beats, the troubleshooting gate row — the whole docs round.

**Verified.** Locally: `bun bin/unown --version` = 0.0.47;
`check:changelog` (45 stops) and `check:blog` (29 posts) green; bridge
248 pass / 0 fail; self-learning 5,189 pass / 0 fail (at 56fa3a28, the
release's parent content). The release workflow's own assertion jobs
(three-OS install + full suites + the six-platform build) are the
canonical verdict.

**Live end-to-end (the Agnes AI stack, this session):** setup detected
`agnes-3.0-flash` (curated 524,288 / 65,536 + models.dev cost/modality/
reasoning), the gate refused an unverifiable id (exit 1 + remediation),
the flag lane stamped user specs (exit 0), a real chat round-tripped,
`unown models verify` verified the catalog, doctor showed the
`model specs verified` row.
