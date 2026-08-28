import assert from "node:assert/strict";
import { fizzbuzz } from "./fizzbuzz.js";

const r16 = fizzbuzz(16);
assert.equal(r16.length, 16);
assert.deepEqual(r16.slice(0, 5), [1, 2, "Fizz", 4, "Buzz"]);
assert.equal(r16[14], "FizzBuzz", "15 must be FizzBuzz");
assert.equal(r16[2], "Fizz");
assert.equal(r16[4], "Buzz");
assert.equal(r16[9], "Buzz");
console.log("fizzbuzz tests passed");
