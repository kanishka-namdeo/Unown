import assert from "node:assert/strict";
import { mean } from "./stats.mjs";

assert.equal(mean([1, 2, 3]), 2);
assert.equal(mean([5]), 5);
assert.equal(mean([2, 4, 6, 8]), 5);
assert.equal(mean([-2, 2]), 0);
assert.throws(() => mean([]), RangeError);
console.log("stats tests passed");
