/**
 * tasks.ts — seed task suite for the self-improving harness.
 *
 * Each task is a tiny code exercise: broken/missing implementation + tests.
 * The verify script (a) checks test-file integrity (agents must not tamper
 * with tests) and (b) runs the tests, emitting a final `VERIFY_RESULT:` line.
 */
import { createHash } from "node:crypto";
import { store } from "./store.ts";
import { swapIfElseSource, swapIfElseSolved, swapIfElseTest, swapIfElsePrompt } from "./tasks-swap.ts";

export interface TaskDef {
        id: string;
        name: string;
        description: string;
        category: string;
        difficulty: number; // 1..5
        prompt: string;
        files: Record<string, string>; // seeded into the sandbox
        verifyTestFile: string; // the file whose integrity is checked + executed
        /** The SOLVED form of the non-test source files — mint-time solvability proof (not persisted on tasks). */
        reference?: Record<string, string>;
}

/** Wraps a test file into a verify script with tamper detection. */
function _makeVerify(testFile: string, extraFiles: string[] = []): string {
        const files = [testFile, ...extraFiles];
        const hashes = files.map((f) => `  ${JSON.stringify(f)}: ${JSON.stringify(sha256Placeholder(f))}`).join(",\n");
        return `import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = {
${hashes}
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

// dynamically import the test file (it runs its own assertions)
await import("./${testFile}");
console.log("VERIFY_RESULT: " + JSON.stringify({ passed: true, summary: "all tests passed" }));
`;
}

// The hash of a file must be computed from the exact content we seed. We build
// verify scripts at seed time (content is static), so we compute hashes here.
function sha256(content: string): string {
        return createHash("sha256").update(content, "utf8").digest("hex");
}
function sha256Placeholder(_f: string): string {
        return ""; // replaced by buildVerify below
}

export function buildVerify(task: TaskDef): string {
        const files = [task.verifyTestFile, ...(task.files.__integrity ? [] : [])].filter((f, i, a) => a.indexOf(f) === i);
        const entries = files.map((f) => `  ${JSON.stringify(f)}: ${JSON.stringify(sha256(task.files[f]))}`).join(",\n");
        return `import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = {
${entries}
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

await import("./${task.verifyTestFile}");
console.log("VERIFY_RESULT: " + JSON.stringify({ passed: true, summary: "all tests passed" }));
`;
}

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------
const fizzbuzzSource = `// Returns the fizzbuzz answer for 1..n as an array of strings/numbers.
export function fizzbuzz(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    // BUG: multiples of 15 fall into the % 3 branch and never say "FizzBuzz"
    else out.push(i);
  }
  return out;
}
`;

const fizzbuzzTest = `import assert from "node:assert/strict";
import { fizzbuzz } from "./fizzbuzz.js";

const r16 = fizzbuzz(16);
assert.equal(r16.length, 16);
assert.deepEqual(r16.slice(0, 5), [1, 2, "Fizz", 4, "Buzz"]);
assert.equal(r16[14], "FizzBuzz", "15 must be FizzBuzz");
assert.equal(r16[2], "Fizz");
assert.equal(r16[4], "Buzz");
assert.equal(r16[9], "Buzz");
console.log("fizzbuzz tests passed");
`;

const dropRightSource = `// Returns a new array with the last n elements removed.
export function dropRight(arr, n = 1) {
  // BUG: off-by-one — removes one element too many
  return arr.slice(0, Math.max(0, arr.length - n - 1));
}
`;

const dropRightTest = `import assert from "node:assert/strict";
import { dropRight } from "./dropRight.js";

assert.deepEqual(dropRight([1, 2, 3, 4], 2), [1, 2]);
assert.deepEqual(dropRight([1, 2, 3, 4], 0), [1, 2, 3, 4]);
assert.deepEqual(dropRight([1, 2], 5), []);
assert.deepEqual(dropRight([1], 1), []);
assert.deepEqual(dropRight([], 1), []);
console.log("dropRight tests passed");
`;

const debounceSource = `// TODO: implement debounce.
// debounce(fn, delay, { now }) returns a debounced fn that:
//  - delays invoking fn until \`delay\` ms have elapsed since the last call
//  - \`now\` is an injectable clock: () => ms (defaults to Date.now)
//  - exposes .cancel() which prevents any pending invocation
//  - the debounced function returns undefined
export function debounce(fn, delay = 200, { now = Date.now } = {}) {
  throw new Error("not implemented");
}
`;

const debounceTest = `import assert from "node:assert/strict";
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
`;

const mapLimitSource = `// TODO: implement async map with a concurrency limit.
// mapLimit(items, limit, mapper) returns Promise<result[]> where result[i]
// awaits mapper(items[i], i) — but never runs more than \`limit\` mappers
// concurrently. Results keep the original order. mapper may reject: the
// whole promise rejects with that error.
export async function mapLimit(items, limit, mapper) {
  throw new Error("not implemented");
}
`;

const mapLimitTest = `import assert from "node:assert/strict";
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
`;

const csvSource = `// Parses a single line of CSV (comma-separated, with optional double-quoted
// fields that may contain commas and escaped quotes "") into an array of fields.
export function parseCsvLine(line) {
  // BUG: naive split breaks quoted fields
  return line.split(",");
}
`;

const csvTest = `import assert from "node:assert/strict";
import { parseCsvLine } from "./csv.js";

assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
assert.deepEqual(parseCsvLine('say "hi",world'), ['say "hi"', "world"]);
assert.deepEqual(parseCsvLine('"a,b",c'), ["a,b", "c"]);
assert.deepEqual(parseCsvLine('"he said ""run""",ok'), ['he said "run"', "ok"]);
assert.deepEqual(parseCsvLine("  a  ,  b  "), ["  a  ", "  b  "]);
assert.deepEqual(parseCsvLine(""), [""]);
console.log("csv tests passed");
`;

export const TASK_DEFS: TaskDef[] = [
        {
                id: "fix-fizzbuzz",
                name: "Fix FizzBuzz",
                description: "Classic FizzBuzz has a branch-ordering bug: multiples of 15 never print FizzBuzz.",
                category: "bugfix",
                difficulty: 1,
                prompt:
                        "The file fizzbuzz.js contains a buggy fizzbuzz implementation. The test file fizzbuzz.test.mjs describes the expected behavior. Fix fizzbuzz.js so all tests pass. Do not modify the test file.",
                files: { "fizzbuzz.js": fizzbuzzSource, "fizzbuzz.test.mjs": fizzbuzzTest },
                verifyTestFile: "fizzbuzz.test.mjs",
        },
        {
                id: "fix-drop-right",
                name: "Fix dropRight off-by-one",
                description: "dropRight removes one element too many; edge cases around empty results fail.",
                category: "bugfix",
                difficulty: 2,
                prompt:
                        "The file dropRight.js implements dropRight with an off-by-one bug. The test file dropRight.test.mjs describes the expected behavior. Fix dropRight.js so all tests pass. Do not modify the test file.",
                files: { "dropRight.js": dropRightSource, "dropRight.test.mjs": dropRightTest },
                verifyTestFile: "dropRight.test.mjs",
        },
        {
                id: "impl-debounce",
                name: "Implement debounce",
                description: "Implement a clock-injectable debounce with cancel(), probed at call boundaries.",
                category: "implementation",
                difficulty: 4,
                prompt:
                        "Implement the debounce function in debounce.js according to its doc comment. The test file debounce.test.mjs describes the exact semantics (including the injectable clock and lazy boundary flushing). Make all tests pass. Do not modify the test file.",
                files: { "debounce.js": debounceSource, "debounce.test.mjs": debounceTest },
                verifyTestFile: "debounce.test.mjs",
        },
        {
                id: "impl-map-limit",
                name: "Implement mapLimit",
                description: "Async map with bounded concurrency, ordered results, rejection propagation.",
                category: "implementation",
                difficulty: 4,
                prompt:
                        "Implement the mapLimit function in mapLimit.js according to its doc comment. The test file mapLimit.test.mjs verifies ordering, the concurrency bound and error propagation. Make all tests pass. Do not modify the test file.",
                files: { "mapLimit.js": mapLimitSource, "mapLimit.test.mjs": mapLimitTest },
                verifyTestFile: "mapLimit.test.mjs",
        },
        {
                id: "swap-if-else-messages",
                name: "Swap if/else branch bodies",
                description:
                        "A structural swap mutation (ported from edit-bench fixture structural-swap-if-else-006 — a measured agnes-3.0-flash failure: 12 edit calls, byte mismatch): the if/else branch bodies must trade places, byte-exact.",
                category: "bugfix",
                difficulty: 3,
                prompt: swapIfElsePrompt,
                files: { "messages.ts": swapIfElseSource, "swap.test.mjs": swapIfElseTest },
                verifyTestFile: "swap.test.mjs",
                reference: { "messages.ts": swapIfElseSolved },
        },
        {
                id: "fix-csv-parser",
                name: "Fix CSV parsing",
                description: "Naive comma split breaks on quoted fields and escaped quotes.",
                category: "bugfix",
                difficulty: 3,
                prompt:
                        "The file csv.js contains a naive CSV line parser that breaks on quoted fields. The test file csv.test.mjs describes the expected behavior (quoted fields may contain commas; a doubled double-quote inside a quoted field is an escaped quote). Fix csv.js so all tests pass. Do not modify the test file.",
                files: { "csv.js": csvSource, "csv.test.mjs": csvTest },
                verifyTestFile: "csv.test.mjs",
        },
];

export function seedTasks() {
        for (const def of TASK_DEFS) {
                const existing = store.get(`SELECT id FROM tasks WHERE id = ?`, [def.id]);
                if (existing) continue;
                store.run(
                        `INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                        [
                                def.id,
                                def.name,
                                def.description,
                                def.category,
                                def.difficulty,
                                def.prompt,
                                JSON.stringify(def.files),
                                buildVerify(def),
                                Date.now(),
                        ],
                );
        }
}

export function getTask(id: string) {
        const row = store.get<any>(`SELECT * FROM tasks WHERE id = ? AND active = 1`, [id]);
        if (!row) return undefined;
        return { ...row, files: JSON.parse(row.files) };
}

export function listTasks() {
        return store.query<any>(
                `SELECT t.id, t.name, t.description, t.category, t.difficulty, t.created_at, t.pass_count, t.fail_count,
                        t.origin, t.status, t.source_run_id,
                        (SELECT COUNT(*) FROM runs r WHERE r.task_id = t.id AND r.status = 'passed') AS passes,
                        (SELECT COUNT(*) FROM runs r WHERE r.task_id = t.id AND r.status = 'failed') AS fails,
                        (SELECT COUNT(*) FROM cycles c WHERE c.task_id = t.id AND c.status = 'improved') AS improvements
                 FROM tasks t WHERE t.active = 1 ORDER BY t.difficulty, t.id`,
        );
}
