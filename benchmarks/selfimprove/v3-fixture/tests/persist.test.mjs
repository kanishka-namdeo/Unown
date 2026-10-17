import assert from "node:assert/strict";
import { save, load } from "./persist.mjs";
import { rmSync, readFileSync } from "node:fs";

rmSync("persist-fixture.json", { force: true });
const records = [
	{ id: 1, name: "alpha", tags: ["x", "y"] },
	{ id: 2, name: "beta", tags: [] },
];
save("persist-fixture.json", records);
const raw = readFileSync("persist-fixture.json", "utf8");
assert.ok(raw.endsWith("\n"), "file must end with a newline");
assert.equal(JSON.parse(raw).length, 2);
assert.deepEqual(load("persist-fixture.json"), records);
save("persist-fixture.json", []);
assert.deepEqual(load("persist-fixture.json"), []);
rmSync("persist-fixture.json", { force: true });
console.log("persist tests passed");
