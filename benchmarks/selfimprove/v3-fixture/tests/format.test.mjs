import assert from "node:assert/strict";
import { formatReport } from "./format.mjs";

assert.equal(formatReport([{ label: "a", value: 1 }]), "a: 1");
assert.equal(
	formatReport([
		{ label: "a", value: 1 },
		{ label: "b", value: 2 },
	]),
	"a: 1 | b: 2",
);
assert.equal(formatReport([]), "");
assert.equal(
	formatReport([
		{ label: "x", value: "y" },
		{ label: "z", value: 0 },
	]),
	"x: y | z: 0",
);
console.log("format tests passed");
