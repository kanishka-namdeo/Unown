import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = {
  "csv.test.mjs": "c5c019156d973e5c8f44192a984ee011d66dae01db74aed8603fc06ed5232852"
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

await import("./csv.test.mjs");
console.log("VERIFY_RESULT: " + JSON.stringify({ passed: true, summary: "all tests passed" }));
