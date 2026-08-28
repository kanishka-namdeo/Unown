# Tier 1 — Project Memory

## Workflow
- The workspace contains a small Node/Bun project with tests. Run tests with `bun <testfile>`.
- Verification is automated: a verify script executes after your turn; its output is ground truth.

## Known pitfalls
- Debounce implementation must check and flush pending args immediately when the function is called, not just rely on the timeout
- When implementing FizzBuzz, check for multiples of 15 first to avoid misclassifying numbers like 15
- CSV parser must handle quoted fields containing commas and escaped quotes ("")
- CSV parser must preserve quotes in quoted fields (e.g., 'say "hi"' should remain as ['say "hi"', "world"])

## Task playbooks
- For debounce implementation: ensure immediate flushing of pending args when now() >= scheduledTime
- For FizzBuzz: check for multiples of 15 before checking for multiples of 3 or 5
- For mapLimit: maintain original order of results while respecting concurrency limits
- For CSV parser: implement proper parsing that handles quoted fields, commas within quotes, and escaped quotes
- For CSV parser: preserve quotes in quoted fields when they exist in the input
