---
name: run-chaconne-tests
description: Use when verifying the `apps/chaconne` test suite or debugging test count mismatches. Runs tests from both root and subdirectory to ensure context parity and identifies known pre-existing failures.
staged: true
---

# Run Chaconne Tests

1. From the project root (`/home/z/my-project/unown`), execute `bun test apps/chaconne`.
2. Navigate to the `apps/chaconne` subdirectory.
3. Execute `bun test` from within the subdirectory.
4. Compare the total test counts and pass/fail results from both executions. They must be identical (count parity).
5. If counts differ, check for environment or import resolution differences between contexts.
6. Filter out the 9 known pre-existing failures from unrelated test files when assessing new changes.
7. When debugging `chaconne-flow-cli.spec.ts`, verify that run-row DOM selectors match the actual element structure before modifying the test code.
8. Confirm `chaconne-flow.spec.ts` covers the K-1 flow lane if relevant to your changes.
