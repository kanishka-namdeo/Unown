import assert from "node:assert/strict";
import { mapLimit } from "./mapLimit.js";

let active = 0;
let maxActive = 0;
const track = async (x) => {
  active++; maxActive = Math.max(maxActive, active);
  await new Promise((r) => setTimeout(r, 10 + (x % 3) * 7));
  active--;
  return x * 10;
};

const res = await mapLimit([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3, track);
assert.deepEqual(res, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
assert.ok(maxActive <= 3, "concurrency exceeded limit: " + maxActive);
assert.ok(maxActive >= 2, "no parallelism happened: " + maxActive);

// rejection propagates
await assert.rejects(
  mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error("boom"); return x; }),
  /boom/,
);
console.log("mapLimit tests passed");
