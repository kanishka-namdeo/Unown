// Reference implementation of the FINAL exprq spec (2026-10-22). Used only to
// validate that tests/exprq.test.mjs expected outputs are derivable from
// spec.md — the agent under test never sees this file.
function jsonType(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "object";
}

const IDENT_RE = /^[a-z][a-z0-9_]*/;
const INT_RE = /^-?[0-9]+/;

export function parseQuery(query) {
  const n = query.length;
  let i = 0;
  const err = (detail, col) => ({ error: { kind: "parse", col, detail } });
  // Spaces legal only around '|'. Between segments: skip them.
  const skipSegSpaces = () => {
    while (i < n && query[i] === " ") i++;
  };

  // empty check (spaces-only included) — always col 1
  skipSegSpaces();
  if (i >= n) return err("query is empty", 1);

  const segments = [];
  for (;;) {
    // segment start: at i, no spaces skipped here (spaces were consumed around |)
    if (i >= n) return err("expected '.' at start of segment", i + 1);
    const c = query[i];
    if (c === ".") {
      i++;
      const steps = [];
      // first step: field or [index]
      for (;;) {
        if (i >= n) return err("invalid field name", i + 1);
        const m = IDENT_RE.exec(query.slice(i));
        if (m) {
          i += m[0].length;
          const optional = i < n && query[i] === "?";
          if (optional) i++;
          steps.push({ type: "field", name: m[0], optional });
          break;
        } else if (query[i] === "[") {
          i++;
          const im = INT_RE.exec(query.slice(i));
          if (!im) return err("expected integer in brackets", i + 1);
          i += im[0].length;
          if (i >= n || query[i] !== "]") return err("expected ']' after index", i + 1);
          i++;
          steps.push({ type: "index", index: parseInt(im[0], 10) });
          break;
        } else {
          return err("invalid field name", i + 1);
        }
      }
      // subsequent steps
      for (;;) {
        if (i >= n) break;
        const nx = query[i];
        if (nx === "|") break;
        if (nx === " ") {
          let j = i;
          while (j < n && query[j] === " ") j++;
          if (j < n && query[j] === "|") break; // pipe-padding spaces: boundary
          const last = steps[steps.length - 1];
          return err(
            last.type === "field"
              ? `expected '.' or '[' after field '${last.name}'`
              : "expected '.' or '[' after index",
            i + 1,
          );
        }
        if (nx === ".") {
          i++;
          if (i >= n) return err("invalid field name", i + 1);
          const m = IDENT_RE.exec(query.slice(i));
          if (!m) return err("invalid field name", i + 1);
          i += m[0].length;
          const optional = i < n && query[i] === "?";
          if (optional) i++;
          steps.push({ type: "field", name: m[0], optional });
          continue;
        }
        if (nx === "[") {
          i++;
          const im = INT_RE.exec(query.slice(i));
          if (!im) return err("expected integer in brackets", i + 1);
          i += im[0].length;
          if (i >= n || query[i] !== "]") return err("expected ']' after index", i + 1);
          i++;
          steps.push({ type: "index", index: parseInt(im[0], 10) });
          continue;
        }
        const last = steps[steps.length - 1];
        return err(
          last.type === "field"
            ? `expected '.' or '[' after field '${last.name}'`
            : "expected '.' or '[' after index",
          i + 1,
        );
      }
      segments.push({ type: "path", steps });
    } else {
      const m = IDENT_RE.exec(query.slice(i));
      if (!m) return err("expected '.' at start of segment", i + 1);
      const nameStart = i;
      const name = m[0];
      i += name.length;
      if (i >= n || query[i] !== "(") return err(`expected '(' after function name '${name}'`, i + 1);
      if (name !== "length" && name !== "keys")
        return err(`unknown function '${name}'`, nameStart + 1);
      i++; // (
      if (i >= n || query[i] !== ")") return err("expected ')' closing the call", i + 1);
      i++;
      segments.push({ type: "call", name });
    }
    // after segment: end, '|', pipe-padding spaces then '|'. A space NOT
    // followed by '|' is an offending char (spaces are legal only around '|').
    if (i >= n) break;
    if (query[i] === "|") {
      i++;
      skipSegSpaces();
      continue;
    }
    if (query[i] === " ") {
      let j = i;
      while (j < n && query[j] === " ") j++;
      if (j < n && query[j] === "|") {
        i = j + 1;
        skipSegSpaces();
        continue;
      }
      return err("expected '|' after segment", i + 1);
    }
    return err("expected '|' after segment", i + 1);
  }
  return { segments };
}

export function evalSegment(seg, value) {
  const err = (detail) => ({ error: { kind: "eval", detail } });
  if (seg.type === "call") {
    if (seg.name === "length") {
      if (value === null || value === undefined) return { value: 0 };
      if (Array.isArray(value)) return { value: value.length };
      if (typeof value === "string") return { value: value.length };
      if (typeof value === "object") return { value: Object.keys(value).length };
      return { value };
    }
    // keys()
    if (value !== null && typeof value === "object" && !Array.isArray(value))
      return { value: Object.keys(value).sort() };
    return err(`expected object, got ${jsonType(value)}`);
  }
  let v = value;
  for (const step of seg.steps) {
    if (step.type === "field") {
      const isObj = v !== null && typeof v === "object" && !Array.isArray(v);
      if (!isObj) {
        if (step.optional) {
          v = null;
          continue;
        }
        return err(`expected object, got ${jsonType(v)}`);
      }
      if (!(step.name in v)) {
        if (step.optional) {
          v = null;
          continue;
        }
        return err(`missing field '${step.name}'`);
      }
      v = v[step.name];
    } else {
      if (!Array.isArray(v)) return err(`expected array, got ${jsonType(v)}`);
      const len = v.length;
      const idx = step.index < 0 ? len + step.index : step.index;
      if (idx < 0 || idx >= len) return err(`index ${step.index} out of bounds (length ${len})`);
      v = v[idx];
    }
  }
  return { value: v };
}

export function evaluate(query, data) {
  const parsed = parseQuery(query);
  if (parsed.error) return parsed;
  let value = data;
  for (const seg of parsed.segments) {
    const r = evalSegment(seg, value);
    if (r.error) return r;
    value = r.value;
  }
  return { value: value === undefined ? null : value };
}
