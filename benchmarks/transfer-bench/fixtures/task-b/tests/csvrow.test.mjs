// csvrow.test.mjs — the ground-truth suite for the csvrow CLI (task B of the
// transfer benchmark). READ-ONLY during agent sessions: restored pristine
// before scoring. Each case is independent; the runner prints
// "case <n>: ok|FAIL" per case and exits 0 only if ALL cases pass.
//
// Run with: node csvrow.test.mjs   (cwd = repo root)
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "csvrow-"));
const csvPath = (name, text) => {
  const p = join(tmp, name);
  writeFileSync(p, text);
  return p;
};

const BASIC = csvPath(
  "basic.csv",
  'name,age,city\nann,31,Berlin\nbob,9,"Hamburg, Altona"\ncal,45.5,Munich\n,"0",x\n',
);
const EMPTY = csvPath("empty.csv", "");
const CRLF = csvPath("crlf.csv", "a,b\r\n1,2\r\n3,4\r\n");
const QUOTED = csvPath("quoted.csv", '"a""b",2\nplain,3\n');

let pass = 0;
let fail = 0;
const failures = [];

function case_(name, expr, file, expected) {
  const argv = ["src/cli.js", expr];
  if (file !== undefined) argv.push(file);
  const r = spawnSync(process.execPath, argv, { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 });
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

// ---- success: filtering --------------------------------------------------------
case_("string equality match", '$2 == 31', BASIC, { code: 0, out: "ann,31,Berlin\n" });
case_("string equality no match", '$2 == "31"', BASIC, { code: 0, out: "ann,31,Berlin\n" });
case_("numeric equality 5.0 vs 5", '$2 == 45.5', BASIC, { code: 0, out: "cal,45.5,Munich\n" });
case_("numeric not-equal", '$2 != 31', BASIC, { code: 0, out: 'name,age,city\nbob,9,"Hamburg, Altona"\ncal,45.5,Munich\n,0,x\n' });
case_("string not-equal on non-numeric", '$1 != "ann"', BASIC, { code: 0, out: 'name,age,city\nbob,9,"Hamburg, Altona"\ncal,45.5,Munich\n,0,x\n' });
case_("greater than (or-guard skips header)", '$1 == "name" or $2 > 9', BASIC, { code: 0, out: "name,age,city\nann,31,Berlin\ncal,45.5,Munich\n" });
case_("greater or equal", '$1 == "name" or $2 >= 31', BASIC, { code: 0, out: "name,age,city\nann,31,Berlin\ncal,45.5,Munich\n" });
case_("less than", '$1 == "name" or $2 < 31', BASIC, { code: 0, out: 'name,age,city\nbob,9,"Hamburg, Altona"\n,0,x\n' });
case_("zero is numeric", '$2 == 0', BASIC, { code: 0, out: ",0,x\n" });
case_("and precedence over or", '$2 == 9 or $2 == 31 and $3 == "Nowhere"', BASIC, { code: 0, out: 'bob,9,"Hamburg, Altona"\n' });
case_("not binds tightest", 'not $2 == 31 and $2 == 9', BASIC, { code: 0, out: 'bob,9,"Hamburg, Altona"\n' });
case_("parens change grouping", '($2 == 31 or $2 == 9) and $3 == "Berlin"', BASIC, { code: 0, out: "ann,31,Berlin\n" });
case_("double not", 'not not $2 == 31', BASIC, { code: 0, out: "ann,31,Berlin\n" });
case_("short-circuit or still errors on right when left false", '$2 == 99 or $99 > 1', BASIC, { code: 1, err: "csvrow: error: column 99 out of range (row has 3 columns)\n" });
case_("empty file zero rows", "$1 == \"x\"", EMPTY, { code: 0, out: "" });
case_("crlf input rows", '$1 == "3"', CRLF, { code: 0, out: "3,4\n" });
case_("quoted field with comma matches", '$3 == "Hamburg, Altona"', BASIC, { code: 0, out: 'bob,9,"Hamburg, Altona"\n' });
case_("output re-quotes when needed", '$2 == 9', BASIC, { code: 0, out: 'bob,9,"Hamburg, Altona"\n' });
case_("escaped quotes in data match", '$1 == "a\\"b"', QUOTED, { code: 0, out: '"a""b",2\n' });
case_("newline escape in expression string", '$3 == "Mu\\nnich"', BASIC, { code: 0, out: "" });

// ---- eval errors --------------------------------------------------------------
case_("column out of range", "$4 == 1", BASIC, { code: 1, err: "csvrow: error: column 4 out of range (row has 3 columns)\n" });
case_("comparison needs numbers (left)", '$1 > "ann"', BASIC, { code: 1, err: "csvrow: error: not a number: 'name'\n" });
case_("comparison needs numbers (right)", "$3 > 9", BASIC, { code: 1, err: "csvrow: error: not a number: 'city'\n" });
case_("left checked first", '$1 > $3', BASIC, { code: 1, err: "csvrow: error: not a number: 'name'\n" });

// ---- parse errors (byte-exact cols) -------------------------------------------
case_("bare colref is not a comparison", "$1", BASIC, { code: 2, err: "csvrow: error: expected a comparison at col 1\n" });
case_("bare string is not a comparison", '"x"', BASIC, { code: 2, err: "csvrow: error: expected a comparison at col 1\n" });
case_("bare under not", "not $1", BASIC, { code: 2, err: "csvrow: error: expected a comparison at col 5\n" });
case_("bare under double not", "not not $1", BASIC, { code: 2, err: "csvrow: error: expected a comparison at col 9\n" });
case_("bare right of and", '$1 == "a" and $2', BASIC, { code: 2, err: "csvrow: error: expected a comparison at col 15\n" });
case_("first bare in or", "$1 or $2", BASIC, { code: 2, err: "csvrow: error: expected a comparison at col 1\n" });
case_("$0 is invalid column number", '$0 == "a"', BASIC, { code: 2, err: "csvrow: error: invalid column number at col 2\n" });
case_("unterminated string", '$1 == "abc', BASIC, { code: 2, err: "csvrow: error: unterminated string at col 7\n" });
case_("invalid escape", '$1 == "a\\qb"', BASIC, { code: 2, err: "csvrow: error: invalid escape at col 10\n" });
case_("unknown token", '$1 == #', BASIC, { code: 2, err: "csvrow: error: unknown token at col 7\n" });
case_("non-associative comparison", '$1 == "a" == "b"', BASIC, { code: 2, err: "csvrow: error: unexpected token after comparison at col 11\n" });
case_("starts with and", 'and $1 == 1', BASIC, { code: 2, err: "csvrow: error: expected an operand at col 1\n" });
case_("operator where operand expected", '$1 == and 2', BASIC, { code: 2, err: "csvrow: error: expected an operand at col 7\n" });
case_("dangling operator at end", '$1 == 1 and', BASIC, { code: 2, err: "csvrow: error: expected an operand at col 12\n" });
case_("trailing junk", '$1 == 1 #', BASIC, { code: 2, err: "csvrow: error: expected an operator at col 9\n" });
case_("unclosed paren group", '($1 == 1', BASIC, { code: 2, err: "csvrow: error: expected ')' at col 9\n" });
case_("close paren without open", '$1 == 1)', BASIC, { code: 2, err: "csvrow: error: expected an operator at col 8\n" });

// ---- usage / malformed CSV ------------------------------------------------------
case_("missing file", "$1 == 1", undefined, { code: 2, err: "usage: cli.js '<expr>' <data.csv>\n" });
case_("unreadable file", "$1 == 1", join(tmp, "nope.csv"), { code: 2, err: "usage: cli.js '<expr>' <data.csv>\n" });
case_("malformed csv unterminated quote", '$1 == 1', csvPath("bad.csv", 'a,"b\n'), { code: 2, err: "usage: cli.js '<expr>' <data.csv>\n" });

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures.slice(0, 6)) {
    console.log(`FAIL ${f.name}: want ${JSON.stringify(f.want)} got ${JSON.stringify(f.got)}`);
  }
  process.exit(1);
}
