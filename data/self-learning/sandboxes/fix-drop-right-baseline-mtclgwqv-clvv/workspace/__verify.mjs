import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = {
  "dropRight.test.mjs": "a28949773a88499f0b1b016d0167f8c7291b5dd4000535683cfde0c0255603da"
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

await import("./dropRight.test.mjs");
console.log("VERIFY_RESULT: " + JSON.stringify({ passed: true, summary: "all tests passed" }));
