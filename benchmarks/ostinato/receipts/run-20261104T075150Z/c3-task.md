The module src/luhn.ts in this directory has ONE bug: it never doubles alternating digits, so the
Luhn sum is computed without the doubling step and every valid card-like number fails validation.
The tests in tests/luhn.test.ts are correct and must NOT be modified. Fix src/luhn.ts only, then run
`bun test` in this directory and make every test pass.