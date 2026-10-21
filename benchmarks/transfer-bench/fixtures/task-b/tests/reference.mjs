// Reference implementation of the FINAL csvrow spec (2026-10-22). Used only to
// validate tests/csvrow.test.mjs against spec.md — the agent never sees this.
function isNum(s) {
  return /^-?[0-9]+(\.[0-9]+)?$/.test(s);
}

export function parseExpr(expr) {
  const n = expr.length;
  let i = 0;
  const err = (detail, col) => ({ error: { kind: "parse", detail, col } });
  let firstBareCol = null;

  function skipWs() {
    while (i < n && (expr[i] === " " || expr[i] === "\t")) i++;
  }
  function wordAt(pos) {
    const m = /^[a-z_][a-z0-9_]*/.exec(expr.slice(pos));
    return m ? m[0] : null;
  }
  function isWordEnd(pos) {
    return pos >= n || !/[a-z0-9_]/i.test(expr[pos]);
  }

  function parseOperand() {
    if (i >= n) return err("expected an operand", i + 1);
    const w = wordAt(i);
    if ((w === "and" || w === "or" || w === "not") && isWordEnd(i + w.length))
      return err("expected an operand", i + 1);
    const c = expr[i];
    if (c === "$") {
      const m = /^[0-9]+/.exec(expr.slice(i + 1));
      if (!m || m[0] === "0") return err("invalid column number", i + 2);
      i += 1 + m[0].length;
      return { node: { type: "col", col: parseInt(m[0], 10), start: i + 1 - 1 - m[0].length } };
    }
    if (c === '"') {
      const start = i;
      i++;
      let s = "";
      for (;;) {
        if (i >= n) return err("unterminated string", start + 1);
        const ch = expr[i];
        if (ch === '"') {
          i++;
          return { node: { type: "str", value: s, start: start + 1 } };
        }
        if (ch === "\\") {
          const nx = expr[i + 1];
          if (nx === '"' || nx === "\\" || nx === "n" || nx === "t") {
            s += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
            i += 2;
            continue;
          }
          return err("invalid escape", i + 2); // 1-based col of the char after the backslash
        }
        s += ch;
        i++;
      }
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(expr.slice(i));
      if (!m) return err("unknown token", i + 1);
      i += m[0].length;
      return { node: { type: "num", value: m[0], start: i + 1 - m[0].length } };
    }
    return err("unknown token", i + 1);
  }

  function parseCmp() {
    const o1 = parseOperand();
    if (o1.error) return o1;
    skipWs();
    const opm = /^(==|!=|>=|<=|>|<)/.exec(expr.slice(i));
    if (!opm) {
      if (firstBareCol === null) firstBareCol = o1.node.start;
      return { node: { type: "bare", operand: o1.node } };
    }
    // non-associative: a comparison operator may not follow a complete cmp
    const op = opm[0];
    i += op.length;
    skipWs();
    const o2 = parseOperand();
    if (o2.error) return o2;
    return { node: { type: "cmp", op, left: o1.node, right: o2.node } };
  }

  function parseNot() {
    skipWs();
    if (expr[i] === "(") {
      i++;
      const inner = parseOr();
      if (inner.error) return inner;
      skipWs();
      if (i >= n || expr[i] !== ")") return err("expected ')'", i + 1);
      i++;
      return inner; // parens are transparent: grouping only
    }
    const w = wordAt(i);
    if (w === "not" && isWordEnd(i + 3)) {
      i += 3;
      const inner = parseNot();
      if (inner.error) return inner;
      return { node: { type: "not", inner: inner.node } };
    }
    return parseCmp();
  }

  function parseAnd() {
    let left = parseNot();
    if (left.error) return left;
    for (;;) {
      skipWs();
      const w = wordAt(i);
      if (w !== "and" || !isWordEnd(i + 3)) return { node: left.node };
      i += 3;
      const right = parseNot();
      if (right.error) return right;
      left = { node: { type: "and", left: left.node, right: right.node } };
    }
  }

  function parseOr() {
    let left = parseAnd();
    if (left.error) return left;
    for (;;) {
      skipWs();
      const w = wordAt(i);
      if (w !== "or" || !isWordEnd(i + 2)) return { node: left.node };
      i += 2;
      const right = parseAnd();
      if (right.error) return right;
      left = { node: { type: "or", left: left.node, right: right.node } };
    }
  }

  const top = parseOr();
  if (top.error) return top;
  skipWs();
  if (i < n) {
    // trailing junk after the full expression
    const w = wordAt(i);
    if (w === "and" || w === "or") return err("expected an operand", i + 1);
    if (/^(==|!=|>=|<=|>|<)/.test(expr.slice(i))) return err("unexpected token after comparison", i + 1);
    return err("expected an operator", i + 1);
  }
  if (firstBareCol !== null) return err("expected a comparison", firstBareCol);
  return { ast: top.node };
}

function evalNode(node, row) {
  const err = (detail) => ({ error: { kind: "eval", detail } });
  const val = (o) => (o.type === "col" ? row[o.col - 1] : o.type === "str" ? o.value : o.value);
  switch (node.type) {
    case "cmp": {
      const l = val(node.left);
      const r = val(node.right);
      const ln = isNum(l);
      const rn = isNum(r);
      if (["==", "!="].includes(node.op)) {
        const eq = ln && rn ? Number(l) === Number(r) : l === r;
        return { value: node.op === "==" ? eq : !eq };
      }
      if (!ln) return err(`not a number: '${l}'`);
      if (!rn) return err(`not a number: '${r}'`);
      const a = Number(l);
      const b = Number(r);
      const res =
        node.op === ">" ? a > b : node.op === ">=" ? a >= b : node.op === "<" ? a < b : a <= b;
      return { value: res };
    }
    case "not": {
      const inner = evalNode(node.inner, row);
      if (inner.error) return inner;
      return { value: !inner.value };
    }
    case "and": {
      const l = evalNode(node.left, row);
      if (l.error) return l;
      if (!l.value) return { value: false };
      const r = evalNode(node.right, row);
      if (r.error) return r;
      return { value: r.value };
    }
    case "or": {
      const l = evalNode(node.left, row);
      if (l.error) return l;
      if (l.value) return { value: true };
      const r = evalNode(node.right, row);
      if (r.error) return r;
      return { value: r.value };
    }
    default:
      return err("bare operand");
  }
}

export function evalRow(ast, row, width) {
  // column range check happens before evaluating comparisons
  const check = (node) => {
    if (node.type === "col" && node.col > width)
      return `column ${node.col} out of range (row has ${width} columns)`;
    if (node.type === "cmp") {
      const a = check(node.left) ?? check(node.right);
      if (a) return a;
    }
    if (node.type === "not") return check(node.inner);
    if (node.type === "and" || node.type === "or")
      return check(node.left) ?? check(node.right);
    return null;
  };
  const r = check(ast);
  if (r) return { error: { kind: "eval", detail: r } };
  return evalNode(ast, row);
}

/** Parse one CSV line into fields (""-escape quoting; unterminated quote -> null). */
export function parseCsvLine(line) {
  const out = [];
  let i = 0;
  let cur = "";
  let inQ = false;
  let anyQ = false;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"' && cur === "" && !anyQ) {
      inQ = true;
      anyQ = true;
      i++;
      continue;
    }
    if (c === ",") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (c === '"' && cur !== "") return null; // quote mid-field = malformed
    cur += c;
    i++;
  }
  if (inQ) return null; // unterminated quote
  out.push(cur);
  return out;
}

export function csvQuote(field) {
  if (/[",\r\n]/.test(field)) return '"' + field.replace(/"/g, '""') + '"';
  return field;
}

export function filterRows(expr, csvText) {
  const parsed = parseExpr(expr);
  if (parsed.error) return parsed;
  const ast = parsed.ast;
  // A file ending in "\n" terminates its last row — it does not add an empty
  // row. Empty lines elsewhere are one row with a single empty field.
  let rawLines = csvText.length === 0 ? [] : csvText.split("\n");
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === "") rawLines.pop();
  const rows = [];
  for (const raw of rawLines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const fields = parseCsvLine(line);
    if (fields === null) return { error: { kind: "usage" } };
    rows.push(fields);
  }
  const outLines = [];
  for (const row of rows) {
    const r = evalRow(ast, row, row.length);
    if (r.error) return r;
    if (r.value === true) outLines.push(row.map(csvQuote).join(","));
  }
  return { value: outLines };
}
