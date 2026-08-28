import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = {
  "mapLimit.test.mjs": "1f608588f4ad7eeb7c0f15455d0219bd5ada93db8d2283fd50b5bded383cdab3"
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

await import("./mapLimit.test.mjs");
console.log("VERIFY_RESULT: " + JSON.stringify({ passed: true, summary: "all tests passed" }));
