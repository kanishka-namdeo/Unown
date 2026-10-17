import assert from "node:assert/strict";
import { search } from "./search.mjs";

const records = [
	{ id: 1, name: "Alpha", tags: ["x"] },
	{ id: 2, name: "beta", tags: ["gamma"] },
	{ id: 3, name: "Beta", tags: [] },
];
assert.deepEqual(search(records, "beta"), [records[1], records[2]]);
assert.deepEqual(search(records, "ALPHA"), [records[0]]);
assert.deepEqual(search(records, "gamma"), [records[1]]);
assert.deepEqual(search(records, "zzz"), []);
assert.equal(records.length, 3, "input must not be mutated");
assert.deepEqual(search(records, "a"), [records[0], records[1], records[2]]);
console.log("search tests passed");
