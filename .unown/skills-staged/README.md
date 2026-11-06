# Staged skills — the review queue

Skills in this directory are NEVER auto-loaded (the 2026-10-22
hardening). Promotion is a human decision:

    mv .unown/skills-staged/<name> .unown/skills/<name>

## browser-resilience (staged 2026-11-06, the twenty-fourth lineage)

- **Status**: the H-10 augmentation candidate, at PROPOSE in
  [the registry](../../docs/a1-augmentation-registry.md) — staged
  pending the WITH/WITHOUT paired gate (the gate design is pre-registered
  in the registry row; the paired runs execute on the frozen post-C-7
  tree at the teardown window).
- **Evidence base**: [a2h8.md](../../benchmarks/rondo-round/receipts/a2h8.md)
  (the #43 iframe-race probe) + the two upstream comments on issue #43.
- **Promotion condition**: the paired gate passes (flake-rate and
  turns-to-green, WITH vs WITHOUT, ≥3 paired runs per arm on the frozen
  tree, the 2–6 pp noise band respected — 6 runs/arm if the delta lands
  inside 2–3 pp) AND the regression arm (the a11y/stability lane) is
  neutral-or-better.
