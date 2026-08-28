import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = {
  "debounce.test.mjs": "1be7577875c9796ae5407e138c5226197c873b46bf2f12235576a3ebb3d0bbae"
};

let tampered = [];
for (const [file, hash] of Object.entries(expected)) {
  try {
    const actual = createHash("sha256").update(readFileSync(file, "utf8")).digest("hex");
    if (actual !== hash) tampered.push(file);
  } catch {
    tampered.push(file + " (missing)");
  }
}
if (tampered.length > 0) {
  console.log("TEST FILES WERE MODIFIED — this is forbidden: " + tampered.join(", "));
  console.log("VERIFY_RESULT: " + JSON.stringify({ passed: false, summary: "test tampering detected: " + tampered.join(", ") }));
  process.exit(1);
}

await import("./debounce.test.mjs");
console.log("VERIFY_RESULT: " + JSON.stringify({ passed: true, summary: "all tests passed" }));
