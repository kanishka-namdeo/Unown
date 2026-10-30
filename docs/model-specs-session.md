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
