The module src/roman.ts in this directory has ONE bug: subtractive notation is not applied (IV
computes as 6, MCMXCIV far too large). The tests in tests/roman.test.ts are correct and must NOT be
modified. Fix src/roman.ts only, then run `bun test` in this directory and make every test pass.