The module src/daterange.ts in this directory has ONE bug: daysInclusive returns one day too few
for every range (a same-day range returns 0, a two-day range returns 1). The tests in
tests/daterange.test.ts are correct and must NOT be modified. Find the bug, fix src/daterange.ts only,
then run `bun test` in this directory and make every test pass.