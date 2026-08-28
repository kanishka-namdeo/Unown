import assert from "node:assert/strict";
import { dropRight } from "./dropRight.js";

assert.deepEqual(dropRight([1, 2, 3, 4], 2), [1, 2]);
assert.deepEqual(dropRight([1, 2, 3, 4], 0), [1, 2, 3, 4]);
assert.deepEqual(dropRight([1, 2], 5), []);
assert.deepEqual(dropRight([1], 1), []);
assert.deepEqual(dropRight([], 1), []);
console.log("dropRight tests passed");
