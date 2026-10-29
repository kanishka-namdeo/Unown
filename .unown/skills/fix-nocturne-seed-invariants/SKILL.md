---
name: fix-nocturne-seed-invariants
description: Use when Nocturne domain tests fail due to seed data timeline violations (e.g., escalation timestamp after acknowledgment) or to validate that nc_seed_* constants satisfy engine preconditions before running the suite.

---

# Fix Nocturne Seed Invariants

Nocturne test failures often stem from seed data (`nc_seed_*` constants) violating temporal invariants enforced by the escalation engine.

1. **Identify the failing test**: Run `bunx biome check --write` and the specific test suite to isolate the assertion error.
2. **Inspect the invariant**: Check `src/lib/nocturne/escalation.ts`. The guard `if (!incident.acknowledgedAt)` means escalation timers only fire for unacked/snoozed incidents.
3. **Verify seed timestamps**: Open the seed file and compare `lastEscalatedAt` against `acknowledgedAt` for every `NocturneIncident`.
   - Rule: `lastEscalatedAt` must be **strictly before** `acknowledgedAt`.
   - If `lastEscalatedAt` is null, it is treated as `triggeredAt`, which is also acceptable but must precede any later events.
4. **Reorder the seed**: Edit the seed constant so the escalation event (`lastEscalatedAt`) fires before the acknowledgment event (`acknowledgedAt`). Do not modify the engine logic to accept invalid seeds.
5. **Validate tier consistency**: If the test uses multi-tier policies, ensure the number of ticks in the test matches `N-1` for an `N`-tier policy, where each tick waits the current tier's `waitMinutes`.
6. **Run the full suite**: Execute `bun test src/lib/nocturne` to confirm all 360+ tests pass.
7. **Typecheck**: Run `bunx tsc --noEmit` in `src/` to ensure no type regressions.
