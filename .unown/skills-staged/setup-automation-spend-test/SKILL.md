---
name: setup-automation-spend-test
description: Use when modifying or debugging `pi-repo/packages/self-learning/test/automation-spend.test.ts`. Ensures the schema initialization order is correct to prevent test failures caused by premature DELETE statements.
staged: true
---

# Setup Automation Spend Test

1. Open `pi-repo/packages/self-learning/test/automation-spend.test.ts`.
2. Locate the `beforeAll` hook definition.
3. Ensure the call to `ensureAutomationsSchema` is the **first** statement inside `beforeAll`.
4. Verify that no database `DELETE FROM` statements appear before `ensureAutomationsSchema` has resolved.
5. Run the test file in isolation to confirm the schema initialization prevents downstream failures.
6. If failures persist, check that the test file imports are correctly applied and that no recent edits were missed in the import block.
