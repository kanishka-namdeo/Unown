import assert from "node:assert/strict";
import { add } from "./calc.mjs";

assert.equal(add(2, 3), 5);
assert.equal(add(-1, 1), 0);
assert.equal(add(0, 0), 0);
assert.equal(add(41, 1), 42);
console.log("calc tests passed");
