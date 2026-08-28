import assert from "node:assert/strict";
import { parseCsvLine } from "./csv.js";

assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
assert.deepEqual(parseCsvLine('say "hi",world'), ['say "hi"', "world"]);
assert.deepEqual(parseCsvLine('"a,b",c'), ["a,b", "c"]);
assert.deepEqual(parseCsvLine('"he said ""run""",ok'), ['he said "run"', "ok"]);
assert.deepEqual(parseCsvLine("  a  ,  b  "), ["  a  ", "  b  "]);
assert.deepEqual(parseCsvLine(""), [""]);
console.log("csv tests passed");
