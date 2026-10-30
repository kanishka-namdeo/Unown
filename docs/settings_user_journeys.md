# Settings User Journeys — Phase 3 of the Settings Evolution Round

**Date:** 2026-10-31 · **Method:** journey mapping over the real command
surface (`docs/settings_inventory.md`), the verified edge-case catalogue
(`docs/settings_edge_case_catalogue.md`), and a live dogfood run of the
v0.0.48 stack (setup → doctor → first session executed in this round).

Each journey records the touchpoint sequence, the friction/trust gaps found,
and the Settings-round fix that addresses it (traceable IDs `Jx-n` used by
the IA redesign and the benchmark suite).

---

## Journey A — First-Time User

**Persona:** developer, no Unown experience, heard "self-improving agent".

### A.1 Install → Configure Provider → Configure Model → First Session

| Step | What they meet | Friction / trust gap | Fix |
|---|---|---|---|
| Install | `install.sh` / `install.ps1` / git clone + `bun run agent:install` | Installer prints next steps but the *settings journey* starts blind: "configure credentials" is a file edit | J1-1 onboarding presets already exist (`unown setup`); Settings hub must make them discoverable |
| Configure provider | `unown setup --provider agnes --api-key …` or `/providers` | 8 presets hidden behind CLI help; no in-TUI equivalent of setup's guided flow | J1-2 Settings → Models & Cost hosts the provider wizard |
| Configure model | `PI_MODEL_ID` env / `models.json` / `--model` / `/model` | Model choice spans 8 surfaces with precedence nobody can state | J1-3 effective-value view: "your model is X, because <chain>" |
| First session | `unown` in a project | Splash + flights are good; but nothing answers "what is this agent ALLOWED to do right now?" | J1-4 Settings → Safety shows the effective permission envelope |
| **First error** | e.g. unverified model spec: "no verifiable record yet — detected or asked at the next session start" | The message proposes `unown setup --context-window/--max-tokens` — correct but isolating: an error a novice can't evaluate, in a surface they've never opened | J1-5 health-check card in Settings with FIX actions inline (doctor-lite) |
| **First learning event** | note → dream happens in the background; first visible artifact is a toast "AutoDream learned N rules" days later | "It learned WHAT? From what? Can I see it? Can I undo it?" — the six trust questions fire all at once, with no surface to answer them | J1-6 Settings → Learning: feed + inbox + rollback; the toast links there |

### A.2 The five-minute test (benchmark BM-1)

Today: a new user must find `unown setup` (CLI-only), pick a preset, paste a
key, then discover `/doctor`. Time-to-first-configuration measured in the
baseline run: **~11 minutes with docs open** (see
`benchmarks/settings-ux/receipts/baseline.md`). The success criterion
("configure safely in under five minutes") FAILS at baseline.

**Journey-A verdict:** install is solid; the trust cliff is between "it
works" and "I understand what I've allowed it to become."

---

## Journey B — Daily User

**Persona:** runs Unown most workdays on 2-3 projects.

| Touchpoint | Friction | Fix |
|---|---|---|
| Daily coding: model switching | `/model` is fine; remembering WHY last week's choice was right is not — no memory of settings decisions | J2-1 recently-changed ledger with provenance |
| Debugging: permission prompts | Denials say what was denied, not which rule/layer denied; five possible layers (mode, permissions.json, hooks strict, write-roots, sandbox) | J2-2 denial explanations name the layer + rule + "change it in Settings → Safety" |
| Project learning | `/learning` shows the stack (excellent); but tier edits mean hand-editing `.md` files; rollback lives in a different screen (dashboard Memory) | J2-3 Settings → Memory consolidates view/edit/rollback |
| Automation usage | Creating a routine is a CLI verb (`unown routines create`); knowing what it did overnight = reading run rows; **no cancel for a running job** (gap E7-1) | J2-4 Settings → Automation: runs list + stop-now + spend |
| Memory reuse | Cross-project recall works (`/memory search`); confidence in a recalled rule is all-or-nothing | J2-5 per-rule provenance shown in the memory browser |
| Compaction surprises | Two compaction systems (pi + unown) with different knobs; context bar advises but settings are scattered | J2-6 one compaction card in Settings → Agent |
| Cost anxiety | `/usage` exists but requires remembering it; no ceiling of their own | J2-7 cost card + session budget in Settings → Models & Cost |

**Journey-B verdict:** daily surfaces exist and are good; the gaps are
*connection* (denial→rule, run→stop, usage→budget) and *memory of decisions*
(recently-changed).

---

## Journey C — Power User

**Persona:** runs MCP servers, writes hooks, mints skills, sets goals,
delegates, benchmarks.

| Touchpoint | Friction / discoverability gap | Fix |
|---|---|---|
| MCP | `unown mcp add` + `/mcp` + trust flow — capable, but elicitation policy per server is a config-file edit | J3-1 Settings → Tools & Integrations: server cards (health, tools, elicitation, trust) |
| Hooks | hooks.json authoring is manual; **no loop breaker** (gap E4-2); terminal hook decisions leave no log (E4-5) | J3-2 hook editor + per-hook status + loop breaker + audit feed |
| Skills | Staging exists (SA-B2) but promotion is `mv`; last-use invisible (E3-3) | J3-3 staged inbox + skill health |
| Automation | cron/every/after/once/event + active-hours + misfire — powerful, spread across CLI + dashboard | J3-4 unified automation editor |
| Goals | `/goal` verbs fine; no ceiling (E6-4); evidence gate is regex-honest (E6-5) | J3-5 goal budget + optional verify command |
| Standing orders | `/promote` drafts programs — then what? digest budgets fixed, no cadence control | J3-6 standing-orders card (list/pause/remove) |
| Subagents | Catalog + routing + fleet caps all env-only (E8-1) | J3-7 delegation defaults panel |
| Benchmarking | Harness/benchmarks exist for capabilities; **no settings UX benchmarks** | J3-8 this round's benchmark suite |

**Journey-C verdict:** the power surface is deep but dark — every one of
these journeys ends in a file edit or an env var, not a control.

---

## Journey D — Enterprise User

**Persona:** platform engineer evaluating Unown for a regulated team.

| Concern | State today | Gap | Fix |
|---|---|---|---|
| Security | Sandbox, strict hooks, injection shield/scanner, adversary, instruction guard — a strong defense stack, all env-gated | No single view proving the posture; some toggles disable defenses with no warning | J4-1 Security posture card (defense stack states, warnings on disable) |
| Compliance / policy | Memory tier 0 = `policy.md` (seeded, never clobbered) | Policy tier exists but no enterprise "managed settings" tier; env can be overridden by user env | J4-2 managed-settings precedence (deny-wins) — documented limitation this round, full tier proposed |
| Auditability | hook_log (engine), receipts, delegation ledger, PLM telemetry, session exports | Terminal-side gaps (hook decisions unlogged); no settings-change audit trail | J4-3 settings change ledger + terminal hook feed |
| Permissions | 5-layer precedence, trust gates per project config | Precedence invisible; no org-locked deny | J4-4 effective-permission view + org lock concept |
| Recovery | checkpoints/undo/restore, dream rollback, update rollback, dead-letter lane | Reset-to-defaults absent; retention deletes are permanent | J4-5 scoped reset + pre-reset backups |
| Cost governance | Governor ceilings (engine jobs only), usage log, price pins | **Automations + terminal spend ungoverned** (E7-2) | J4-6 global budget card incl. automation spend |

**Journey-D verdict:** the primitives are surprisingly complete; the
*surfaces* (posture view, audit trail, managed tier) are the gap.

---

## The six mission questions mapped to journeys

| Question | Journey where it bites | Current answer surface | After this round |
|---|---|---|---|
| What can Unown do? | A (first 5 min) | docs + `--help` | Settings → Agent capability map |
| What is it allowed to do? | A, D | `/permissions status` (partial) | Settings → Safety effective envelope + trust manifest |
| What does it remember? | A, B | `/learning` | Settings → Memory (view/edit/rollback) |
| What has it learned? | A, B | `/feed` + dashboard | Settings → Learning feed + approval inbox |
| What could it change automatically? | B, C, D | invisible (env gates) | Settings → Learning/Automation autonomy cards |
| How do I recover? | all | `/undo` `/restore` `/recovery` (if known) | Settings → Recovery one surface + coverage badges |

## Friction inventory feeding the IA (top 12, ranked by journey frequency × severity)

1. Settings decisions leave no trace (no recently-changed, no revert) — B daily.
2. Denials don't name their rule/layer — B daily.
3. No cancel for running automations — B/C.
4. Memory review is post-hoc only — A/B trust cliff.
5. Model/provider effective value opaque (8 surfaces) — A/B.
6. Env-only knobs for everything autonomy-related — C/D.
7. No settings search over ~410 entries — all.
8. Reset-to-defaults absent; retention deletes permanent — D.
9. Automation spend ungoverned — D.
10. Trust gates duplicated ×5 with no manifest — A/D.
11. Hook authoring manual + no loop breaker — C.
12. Terminal hook decisions unlogged — D audit.

These map 1:1 to the IA redesign's section contents and the Phase 7
implementation list.
