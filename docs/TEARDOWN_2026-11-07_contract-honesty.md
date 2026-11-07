# TEARDOWN 2026-11-07 — the contract-honesty class: consumer-driven contracts meet the agent world

> The Sonata round's §7 competition-cycle teardown (due at the round
> close — the queue complete, the teardown duties standing). Filed by
> the 28th lineage. Sweep: **10 source-reads** (2 full pages fetched,
> 8 search-snippet reads — depths marked honestly per the
> source-citation law). Pick: **the contract-honesty class** — the
> industry's answer to the exact findings this round receipted as
> V-24 (the fixture pinned a FICTION of the engine wire — four
> instances in one ticket), V-25 (the live-scale verification law),
> V-15 (the live-verified round-trip law + the slower-machine oracle),
> and V-26 (the runs-route render link).

## The sweep table (10 reads, 2026-11-07)

| # | Source | Depth | What moved | Unown-relevant? |
|---|---|---|---|---|
| 1 | KushoAI — mock testing vs contract testing | **full page** | The **false-confidence problem** named exactly: "mocks are written by the consumer team, based on their understanding… When the real backend changes and the mock isn't updated, tests pass. The integration is broken." A fintech VP: "Despite all our unit and contract tests passing, we're seeing a lot of broken flows in staging." | **Highest — V-24 stated verbatim in industry form** |
| 2 | totalshiftleft — Pact, Specmatic & the contract-testing landscape | **full page** | The consumer-driven four-step: consumer tests → the pact FILE (the contract generated from actual usage) → the broker → **provider verification by REPLAYING each interaction against a RUNNING instance**; `can-i-deploy` as the release gate; bi-directional (OpenAPI spec × pacts, no replay); Specmatic/Schemathesis/Dredd/Prism/Microcks — the schema-first fleet | **Highest — V-15's law IS Pact's provider-verification step, rediscovered** |
| 3 | theneo.io — MCP contract testing (Oct 2026) | snippets (deep) | The agent-native form: **`tools/list` IS the contract**; the 2026-07-28 spec revision lets servers attach a cache lifetime to tool lists; the **block/review/allow change-classification policy** (tool removed/renamed/required-added/type-narrowed → block; description rewritten/annotation changed → review; additive → allow); the **quiet change**: a rewritten description changes which tool the model picks with ZERO schema error — "No error is raised. The task simply stops completing." | **Highest — the V-24 shape in agent-native form + the policy ladder Unown's binary drift pins lack** |
| 4 | Tian Pan — prompt contract testing (May 2026) | snippets | The 2025 failure-taxonomy study (1,600 production traces): **41.8% specification failures, 36.9% coordination, 21.3% verification gaps** — "the system works in isolation but breaks at the seams"; prompt contracts as "OpenAPI for inter-agent communication"; JSON Schema as the enforcement layer; the consumer-driven inversion (the consumer is authoritative) | High — the taxonomy frames W2/W5-class gaps as industry-measured classes |
| 5 | Signadot — contract testing tools & types (Sep 2026) | snippet | "An integration test runs multiple real services together along an actual call chain. A contract test can pass at the exact moment the same integration is broken" — the two-lane split (contract ≠ integration) | High — the lane-split Unown's fixture lane vs live probe already implements |
| 6 | PactFlow — Drift ("Schemas Can Be Contracts") | snippet | Deterministic automated checks whether the implementation conforms to its OpenAPI definition — the spec itself gets verified (the spec can lie too) | Medium-High — the bi-directional duty: Unown's contract pins are the spec-side; the live probe is the implementation-side |
| 7 | toolcontract (GitHub, Divyansh2202) | snippet | "When a provider ships a new model version, an agent's tool-calling behavior can silently change — invented or dropped arguments, a different tool chosen" — contract testing for LLM agents against model-version drift | Medium — the model-velocity lane (A2's ~4 releases/day kin at the model layer) |
| 8 | MCP replay-testing tool (Apr 2026) | snippet | "Schema changes on upstream servers break your agent silently" — record live traffic, replay against new code | **Highest for the augmentation — the fixture-refresh mechanism** |
| 9 | Reddit r/AI_Agents — MCP capability drift | snippet | "Importing an MCP server is easy to review once. The harder case is the next update, when a familiar server adds a write tool, widens an input schema" — the recurring-review problem | Medium — the #46-prune kin: recurring drift vs one-time review |
| 10 | Playwright — component testing docs | snippet | Components in a real browser, the app stubbed at its edges — the mock/real spectrum positioned per layer | Medium — the lane taxonomy Unown's fixture/live split mirrors |

## The pick, torn down: what the contract-honesty class actually shows

1. **The claim (two industries, one convergence).** The microservices
   world hit V-24 a decade early and built the cure: a mock written
   from the consumer's memory is a **hypothesis, not a contract**; the
   contract is a formal artifact GENERATED from the consumer's actual
   usage (the pact file), VERIFIED by replay against the running
   provider, and GATED at deploy (`can-i-deploy`). The agent world is
   now hitting the same wall and converging on the same cure in
   agent-native form: MCP contract testing diffs `tools/list` in CI
   under a block/review/allow policy; prompt contracts pin
   inter-agent output schemas; replay tools record live traffic and
   re-run it against new code. **The Sonata round's V-15 law ("every
   pinned contract gets one live-verified round-trip before the
   building ticket closes") is Pact's provider-verification step,
   independently rediscovered** — and the round's probe harness
   (H-23, 11 boundaries) is a hand-built can-i-deploy.
2. **The mechanism they share.** Three moves, always together:
   (a) the artifact (the contract exists as a file, generated from
   real usage, never hand-canned from memory); (b) the replay (the
   provider side proves the contract against a RUNNING instance —
   fixtures alone can never do this); (c) the gate (the check fires at
   the boundary — deploy, CI, the ticket close — not ad hoc). Unown's
   round earned all three empirically: the contract pins (a), the
   live-contract smoke + probe (b), the close-gate laws (c).
3. **The caveats — what the industry knows that the round has NOT
   yet mechanized.** (i) **The quiet-change class**: the MCP guide's
   sharpest finding — a rewritten DESCRIPTION changes which tool the
   model picks with zero schema error; binary drift pins pass while
   behavior shifts. The block/review/allow LADDER sorts breaking from
   review-worthy from safe; Unown's drift pins are binary.
   (ii) **The fixture-refresh lane**: recorded live traffic as the
   fixture source (the replay tools' core move) — the fixture
   REGENERATES from live responses, so it can never fossilize into
   the V-24 fiction; Unown's fixtures are still hand-canned from
   one-shot live reads. (iii) **The spec can lie too** (PactFlow
   Drift's reason for existing): the contract pins themselves need
   implementation-side verification — which is exactly the live
   probe's duty, already standing.
4. **The verdict for Unown.** The round's hardest-won laws are not
   idiosyncratic — they are the industry's converged practice,
   arrived at from the agent side. What remains genuinely missing is
   mechanization: the change-classification ladder and the
   live-traffic fixture refresh.

## The augmentation hypothesis filed (the registry's next PROPOSE)

- **H-24 — the live-traffic fixture refresh**: the fixture server's
  canned JSON regenerates from RECORDED live engine responses (a
  record mode on the probe harness; the fixtures become derived
  artifacts with provenance, never hand-edited). The V-15 law
  mechanized: the fixture cannot fossilize because its source is the
  live wire. Pairs with H-23 (the probe): record mode + replay mode
  on the same instrument.
- **H-25 — the drift-pin classification ladder**: the contract
  pins gain the block/review/allow classes (breaking → the ticket
  gate reddens; review-worthy → the receipt notes it; additive →
  green) — the MCP policy shape applied to the engine's ~4-releases/
  day velocity. (Anti-scope note: H-25 touches the app's contract
  lane, post-round — a next-round candidate, not a this-round
  retrofit.)

## Sources

- [KushoAI — What Is Mock Testing vs Contract Testing](https://dev.to/kushoai/what-is-mock-testing-vs-contract-testing-when-to-use-each-2fho) (fetched full)
- [totalshiftleft — Contract Testing for Microservices: Pact, Specmatic & More](https://totalshiftleft.ai/blog/contract-testing-for-microservices) (fetched full)
- [theneo.io — MCP Contract Testing: How to Catch Breaking Tool Changes](https://www.theneo.io/blog/mcp-contract-testing)
- [Tian Pan — Prompt Contract Testing](https://tianpan.co/blog/2026/05/05/prompt-contract-testing-multi-agent-coordination)
- [Signadot — Contract Testing: Tools, Types, and Best Practices](https://www.signadot.com/contract-testing)
- [PactFlow — Schemas Can Be Contracts: Introducing Drift](https://www.google.com/goto?url=CAESbwHEIkXXO8jy2UwWWejo8EkK19_Gu03R5xwQOL7B7UOjx-2hy6yG0ePRr44iEsJxw1HTZWLpHJ-Uy_fx1kDwJuEkvCBVF3F4VG7B7IzTBjehcMopUpButB6-HJP3LTCrJiEOUM-_8lNTc7oIOwoyhDw)
- [toolcontract — contract testing for LLM agents](https://www.google.com/goto?url=CAESaQHEIkXXGyX90KO6765rZpnDtbGt_cYtRSf02RpLptvFCZLsh7xRIQukob5QpkxQQlVRSeTWqPGziqQRXZu7m7valO4SRPY7eIAXdxHu0KIx_PslJFUkt2Enx8pTTB0edYVJenTCpavq3a)
- [The MCP replay-testing tool](https://www.google.com/goto?url=CAESsgEBxCJF1yzCF5MhVOefS0u4ByQzvF2rAJrVoQYobi9gKvkFuagL1oRlOBX2a2cVqCgaOWQsQjfE1eKh9Fac-mg2OXb8b4WUG43vl6FkqtSUfy4IkfXqSsh3Z9JQJaq7Oo7hPNv0lS0f2cE%3D) (Apr 2026)
- [Reddit r/AI_Agents — MCP capability drift](https://www.reddit.com/r/AI_Agents/comments/1wgu5l1/how_do_you_detect_capability_drift_when_an_mcp)
- [Playwright — Component Testing](https://playwright.dev/docs/test-components)
