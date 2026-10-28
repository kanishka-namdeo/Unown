---
name: test-cadence-domain
description: Use when verifying, debugging, or extending the habit/streak tracker in src/lib/cadence/ after making changes to pure domain logic.
staged: true
---

# Run Cadence Domain Tests

Run tests for the cadence module to verify domain logic:

1. Execute the isolated cadence test suite:
   ```bash
   bun test src/lib/cadence
   ```
   - **Expected:** 62 tests across 5 files (seed, streaks, stats, validation, persistence) with 2343 expects.

2. If changes affect broader app logic or integration points, run the full app suite:
   ```bash
   bun test src
   ```
   - **Expected:** 304 tests across 32 files.

3. Verify tests use the required environment shims:
   - Confirm `happy-dom` preload is active via `bunfig`.
   - Confirm `localStorage` is shimmed correctly for persistence tests.
   - Ensure `src/lib/cadence/` remains pure domain code (no React/DOM imports) to maintain testability.
