import assert from "node:assert/strict";
import { debounce } from "./debounce.js";

let clock = 1000;
const now = () => clock;
const events = [];

const push = (x) => events.push(x);
const d = debounce(push, 300, { now });

d(1);        // t=1000, schedules fire at 1300
clock = 1200; d(2);   // reschedules: fire at 1500
clock = 1400; d(3);   // reschedules: fire at 1700
clock = 1700;
// time passes — flush happens lazily on next call boundary in this impl,
// so we probe with a no-op call to let the implementation fire.
assert.equal(events.length, 0, "nothing fired before delay elapsed");
d(4);        // t=1700: pending fires [3], then schedules fire at 2000
assert.deepEqual(events, [3], "only the last args before the boundary fired");
clock = 2100; d(5);   // fires [4] at boundary, schedules 2400
assert.deepEqual(events, [3, 4]);
clock = 2500;
d.cancel();          // drops the pending [5] (scheduled for 2400)
clock = 3000; d(7);  // boundary probe: nothing pending fires, schedules [7] -> 3300
assert.deepEqual(events, [3, 4], "cancel() dropped the pending call");
console.log("debounce tests passed");
