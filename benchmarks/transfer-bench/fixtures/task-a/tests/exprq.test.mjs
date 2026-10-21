// exprq.test.mjs — the ground-truth suite for the exprq CLI (task A of the
// transfer benchmark). READ-ONLY during agent sessions: restored pristine
// before scoring. Each case is independent; the harness prints
// "case <n>: ok|FAIL" per case and exits 0 only if ALL cases pass.
//
// Run with: node exprq.test.mjs   (cwd = repo root)
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "exprq-"));
const dataPath = join(tmp, "data.json");
const arrPath = join(tmp, "arr.json");
writeFileSync(
  dataPath,
  JSON.stringify({
    a: { b: [10, 20, 30], c: "hello" },
    users: [
      { name: "ann", age: 31 },
      { name: "bob", age: 9 },
    ],
    empty: {},
    nums: [5],
    n: null,
  }),
);
writeFileSync(arrPath, JSON.stringify([{ x: 1 }, { x: 2 }]));

let pass = 0;
let fail = 0;
const failures = [];

function case_(name, query, file, expected) {
  const argv = ["src/cli.js", query];
  if (file !== undefined) argv.push(file);
  const r = spawnSync(process.execPath, argv, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
  });
  const got = { code: r.status, out: r.stdout, err: r.stderr };
  const want = { code: expected.code, out: expected.out ?? "", err: expected.err ?? "" };
  const ok = got.code === want.code && got.out === want.out && got.err === want.err;
  if (ok) pass++;
  else {
    fail++;
    failures.push({ name, want, got });
  }
  console.log(`case ${String(pass + fail).padStart(2, "0")}: ${ok ? "ok" : "FAIL"} — ${name}`);
}

// ---- success cases ----------------------------------------------------------
case_("field chain", ".a.b", dataPath, { code: 0, out: "[10,20,30]\n" });
case_("deep chain with index", ".a.b[1]", dataPath, { code: 0, out: "20\n" });
case_("pipe to length (array)", ".a.b | length()", dataPath, { code: 0, out: "3\n" });
case_("length of array", ".users | length()", dataPath, { code: 0, out: "2\n" });
case_("length of string is chars", ".a.c | length()", dataPath, { code: 0, out: "5\n" });
case_("length of null is 0", ".n | length()", dataPath, { code: 0, out: "0\n" });
case_("length of number is identity", ".nums[0] | length()", dataPath, { code: 0, out: "5\n" });
case_("keys sorted", ".a | keys()", dataPath, { code: 0, out: '["b","c"]\n' });
case_("keys of empty object", ".empty | keys()", dataPath, { code: 0, out: "[]\n" });
case_("negative index last", ".nums[-1]", dataPath, { code: 0, out: "5\n" });
case_("negative index second-to-last", ".a.b[-2]", dataPath, { code: 0, out: "20\n" });
case_("optional missing field yields null", ".a.zz?", dataPath, { code: 0, out: "null\n" });
case_("optional on non-object yields null", ".a.b[0] | .foo?", dataPath, { code: 0, out: "null\n" });
case_("pipe of paths", ".a | .c", dataPath, { code: 0, out: '"hello"\n' });
case_("array of objects chain", ".users[0].name", dataPath, { code: 0, out: '"ann"\n' });
case_("existing field holding null", ".n", dataPath, { code: 0, out: "null\n" });
case_("leading index on top-level array", ".[0]", arrPath, { code: 0, out: '{"x":1}\n' });
case_("leading index then field", ".[1].x", arrPath, { code: 0, out: "2\n" });
case_("leading index then call", ".[0] | keys()", arrPath, { code: 0, out: '["x"]\n' });
case_("index step after field then index again", ".users[1] | .name", dataPath, { code: 0, out: '"bob"\n' });
case_("spaces around pipe", ".a |   .c | length()", dataPath, { code: 0, out: "5\n" });

// ---- eval errors ------------------------------------------------------------
case_("missing field", ".missing", dataPath, { code: 1, err: "eval error: missing field 'missing'\n" });
case_("index out of bounds positive", ".a.b[3]", dataPath, { code: 1, err: "eval error: index 3 out of bounds (length 3)\n" });
case_("index out of bounds negative", ".a.b[-4]", dataPath, { code: 1, err: "eval error: index -4 out of bounds (length 3)\n" });
case_("field on array", ".nums.x", dataPath, { code: 1, err: "eval error: expected object, got array\n" });
case_("index on object", ".a[0]", dataPath, { code: 1, err: "eval error: expected array, got object\n" });
case_("keys on array", ".a.b | keys()", dataPath, { code: 1, err: "eval error: expected object, got array\n" });
case_("keys on string", ".a.c | keys()", dataPath, { code: 1, err: "eval error: expected object, got string\n" });
case_("keys on null", ".n | keys()", dataPath, { code: 1, err: "eval error: expected object, got null\n" });
case_("null input to field", ".n.c", dataPath, { code: 1, err: "eval error: expected object, got null\n" });

// ---- parse errors (byte-exact cols) -----------------------------------------
case_("empty query", "", dataPath, { code: 2, err: "parse error: line 1, col 1: query is empty\n" });
case_("spaces-only query", "   ", dataPath, { code: 2, err: "parse error: line 1, col 1: query is empty\n" });
case_("bare ident is a call without parens", "a.b", dataPath, { code: 2, err: "parse error: line 1, col 2: expected '(' after function name 'a'\n" });
case_("digit at segment start", "5.x", dataPath, { code: 2, err: "parse error: line 1, col 1: expected '.' at start of segment\n" });
case_("lone dot", ".", dataPath, { code: 2, err: "parse error: line 1, col 2: invalid field name\n" });
case_("trailing dot", ".a.", dataPath, { code: 2, err: "parse error: line 1, col 4: invalid field name\n" });
case_("digit-first field", ".1a", dataPath, { code: 2, err: "parse error: line 1, col 2: invalid field name\n" });
case_("space inside path", ".a b", dataPath, { code: 2, err: "parse error: line 1, col 3: expected '.' or '[' after field 'a'\n" });
case_("unclosed bracket", ".a[1", dataPath, { code: 2, err: "parse error: line 1, col 5: expected ']' after index\n" });
case_("non-integer index", ".a[x]", dataPath, { code: 2, err: "parse error: line 1, col 4: expected integer in brackets\n" });
case_("empty brackets", ".a[]", dataPath, { code: 2, err: "parse error: line 1, col 4: expected integer in brackets\n" });
case_("unknown function", "foo()", dataPath, { code: 2, err: "parse error: line 1, col 1: unknown function 'foo'\n" });
case_("bare length without parens", "length", dataPath, { code: 2, err: "parse error: line 1, col 7: expected '(' after function name 'length'\n" });
case_("dangling pipe", ".a |", dataPath, { code: 2, err: "parse error: line 1, col 5: expected '.' at start of segment\n" });
case_("digit after pipe", ".a | 9", dataPath, { code: 2, err: "parse error: line 1, col 6: expected '.' at start of segment\n" });
case_("char after optional", ".a?b", dataPath, { code: 2, err: "parse error: line 1, col 4: expected '.' or '[' after field 'a'\n" });
case_("optional on index is a parse error", ".a[0]?", dataPath, { code: 2, err: "parse error: line 1, col 6: expected '.' or '[' after index\n" });
case_("uppercase start", "A.b", dataPath, { code: 2, err: "parse error: line 1, col 1: expected '.' at start of segment\n" });
case_("space between function and paren", "length ()", dataPath, { code: 2, err: "parse error: line 1, col 7: expected '(' after function name 'length'\n" });

case_("junk after call segment", ".a | length() x", dataPath, { code: 2, err: "parse error: line 1, col 14: expected '|' after segment\n" });
case_("trailing space without pipe", ".a ", dataPath, { code: 2, err: "parse error: line 1, col 3: expected '.' or '[' after field 'a'\n" });

// ---- usage errors -------------------------------------------------------------
case_("missing file arg", ".a", undefined, { code: 2, err: "usage: cli.js '<query>' <data.json>\n" });
case_("unreadable file", ".a", join(tmp, "nope.json"), { code: 2, err: "usage: cli.js '<query>' <data.json>\n" });
{
  const bad = join(tmp, "bad.json");
  writeFileSync(bad, "{not json");
  case_("invalid json file", ".a", bad, { code: 2, err: "usage: cli.js '<query>' <data.json>\n" });
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures.slice(0, 5)) {
    console.log(`FAIL ${f.name}: want ${JSON.stringify(f.want)} got ${JSON.stringify(f.got)}`);
  }
  process.exit(1);
}
