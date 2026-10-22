/**
 * hook-filter.ts — the tiny payload-filter language for event routines (the
 * fifth schedule kind, M2).
 *
 * Reverse-engineered from OpenHands Automations (webhook triggers with
 * JMESPath payload filters) and OpenClaw's event payload kinds, shrunk to
 * what an unattended trigger actually needs and NOTHING that could execute
 * code: no eval, no expressions beyond comparisons, no functions beyond
 * contains/exists, no property access beyond dotted paths. Total and
 * dependency-free so createAutomation can reject a bad filter at 400-time
 * and the scheduler can evaluate per webhook WITHOUT trusting the payload's
 * shape — the webhook endpoint is the one engine surface pointed at the
 * open internet.
 *
 * The language (whitespace between terms is AND; there is no OR — create a
 * second routine, the flood guard budgets per routine anyway):
 *
 *   payload.action == "opened"        equality against strings (single OR
 *   payload.state != 'closed'         double quotes), integers, true/false
 *   payload.attempt > 2               and null
 *   payload.attempt >= 2              ordering — INTEGER literals only
 *   contains(payload.title, "bug")    substring in a string, or membership
 *                                     in an array of primitives
 *   exists(payload.label)             the path resolves at all
 *   !exists(payload.draft)            prefix ! negation
 *   payload.action == "opened" contains(payload.title, "bug")
 *                                     juxtaposition = AND
 *
 * Paths are dot-joined identifiers evaluated against the webhook body:
 *   - `event` (top level) resolves to the event NAME string
 *   - `payload.<path>` descends into the payload object
 *   - any other path — a single identifier (`action == "opened"`) or a
 *     dotted one (`sender.login`) — is looked up INSIDE the payload
 *     (GitHub-webhook style: `sender.login` is `payload.sender.login`),
 *     so both spellings work for the common hook bodies.
 *
 * Totality contract (pinned by test/hook-filter.test.ts): a missing path
 * never throws and satisfies nothing — comparisons against it are false
 * (except `== null`, which reads missing as null), ordering and contains on
 * wrong types are false, and exists() is the only way to ask. A weird
 * payload (scalars where objects were expected, arrays, nulls) can only
 * make a filter return false, never error.
 */
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Max stored filter length — validated here AND at createAutomation (the
 *  row keeps the raw source; 256 chars is a condition, not a program). */
export const MAX_HOOK_FILTER_CHARS = 256;

/** The literal side of a comparison. Integers only — a webhook payload full
 *  of numbers never needs float semantics, and `1.0 == 1` ambiguity is not
 *  worth carrying. */
type FilterLiteral = { t: "str"; v: string } | { t: "int"; v: number } | { t: "bool"; v: boolean } | { t: "null" };

/** One conjunct of a filter; the top level is an AND of terms. */
export type HookFilterTerm =
        | { kind: "cmp"; path: string[]; op: "==" | "!=" | ">" | ">=" | "<" | "<="; value: FilterLiteral }
        | { kind: "contains"; path: string[]; needle: string }
        | { kind: "exists"; path: string[] }
        | { kind: "not"; term: HookFilterTerm };

/** A parsed filter (never empty — `parseHookFilter("")` errors). */
export interface HookFilterAst {
        terms: HookFilterTerm[];
}

/** What evalHookFilter evaluates against: the event name + the payload. */
export interface HookEventContext {
        event: string;
        payload: unknown;
}

export type HookFilterParseResult = { ok: true; ast: HookFilterAst } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type Tok =
        | { t: "path"; v: string[] }
        | { t: "op"; v: "==" | "!=" | ">" | ">=" | "<" | "<=" }
        | { t: "str"; v: string }
        | { t: "int"; v: number }
        | { t: "kw"; v: "true" | "false" | "null" }
        | { t: "punc"; v: "(" | ")" | "," | "!" }
        | { t: "ident"; v: string };

const OPERATORS = ["==", "!=", ">=", "<=", ">", "<"] as const;

function lex(src: string): { ok: true; toks: Tok[] } | { ok: false; error: string } {
        const toks: Tok[] = [];
        let i = 0;
        const at = (off = 0): string => src[i + off] ?? "";
        while (i < src.length) {
                const c = at();
                if (c === " " || c === "\t" || c === "\n" || c === "\r") {
                        i++;
                        continue;
                }
                if (c === "(" || c === ")" || c === ",") {
                        toks.push({ t: "punc", v: c as "(" | ")" | "," });
                        i++;
                        continue;
                }
                if (c === "!") {
                        // `!=` is an operator; a bare `!` is negation.
                        if (at(1) === "=") {
                                toks.push({ t: "op", v: "!=" });
                                i += 2;
                        } else {
                                toks.push({ t: "punc", v: "!" });
                                i++;
                        }
                        continue;
                }
                if (c === '"' || c === "'") {
                        const end = src.indexOf(c, i + 1);
                        if (end < 0) return { ok: false, error: `unterminated string (quote at offset ${i})` };
                        const v = src.slice(i + 1, end);
                        if (v.includes("\n")) return { ok: false, error: "string literals cannot span lines" };
                        toks.push({ t: "str", v });
                        i = end + 1;
                        continue;
                }
                if (c === "=" && at(1) === "=") {
                        toks.push({ t: "op", v: "==" });
                        i += 2;
                        continue;
                }
                if (c === ">" || c === "<") {
                        if (at(1) === "=") {
                                toks.push({ t: "op", v: (c + "=") as ">=" | "<=" });
                                i += 2;
                        } else {
                                toks.push({ t: "op", v: c as ">" | "<" });
                                i++;
                        }
                        continue;
                }
                if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(at(1)))) {
                        const m = /^-?[0-9]+/.exec(src.slice(i));
                        const raw = m![0];
                        toks.push({ t: "int", v: Number(raw) });
                        i += raw.length;
                        continue;
                }
                if (/[A-Za-z_]/.test(c)) {
                        // Identifier, possibly dotted into a path. A path must be complete:
                        // a trailing dot or a `..` is a syntax error, not a silent prefix
                        // (the afterDot flag catches both — the dot was consumed, and
                        // whatever follows it is not an identifier).
                        const seg = /^[A-Za-z_][A-Za-z0-9_]*/;
                        const segments: string[] = [];
                        let j = i;
                        let afterDot = false;
                        for (;;) {
                                const m = seg.exec(src.slice(j));
                                if (!m) {
                                        if (afterDot) return { ok: false, error: `dangling "." in path near offset ${j}` };
                                        break;
                                }
                                afterDot = false;
                                segments.push(m[0]);
                                j += m[0].length;
                                if (at(j - i) !== ".") break;
                                j++; // consume the dot; a following non-identifier is the error above
                                afterDot = true;
                        }
                        if (segments.length === 1 && (segments[0] === "true" || segments[0] === "false" || segments[0] === "null")) {
                                toks.push({ t: "kw", v: segments[0] });
                        } else if (segments.length > 1) {
                                toks.push({ t: "path", v: segments });
                        } else {
                                toks.push({ t: "ident", v: segments[0] });
                        }
                        i = j;
                        continue;
                }
                return { ok: false, error: `unexpected character "${c}" at offset ${i}` };
        }
        return { ok: true, toks };
}

// ---------------------------------------------------------------------------
// Parser (recursive descent — terms are ANDed by juxtaposition)
// ---------------------------------------------------------------------------

function parseTokens(toks: Tok[]): HookFilterParseResult {
        let pos = 0;
        const peek = (): Tok | undefined => toks[pos];
        const take = (): Tok | undefined => toks[pos++];

        /** A comparison literal: string, integer, true/false/null. */
        function literal(): { ok: true; value: FilterLiteral } | { ok: false; error: string } {
                const t = take();
                if (!t) return { ok: false, error: "comparison needs a right-hand literal (string, integer, true/false/null)" };
                if (t.t === "str") return { ok: true, value: { t: "str", v: t.v } };
                if (t.t === "int") return { ok: true, value: { t: "int", v: t.v } };
                if (t.t === "kw") return { ok: true, value: t.v === "null" ? { t: "null" } : { t: "bool", v: t.v === "true" } };
                if (t.t === "path") return { ok: false, error: "the right-hand side of a comparison must be a literal (left-hand side carries the path)" };
                return { ok: false, error: "the right-hand side of a comparison must be a literal, not an operator or punctuation" };
        }

        function term(): { ok: true; term: HookFilterTerm } | { ok: false; error: string } {
                const t = peek();
                if (!t) return { ok: false, error: "unexpected end of filter" };
                if (t.t === "punc" && t.v === "!") {
                        take();
                        const inner = term();
                        if (!inner.ok) return inner;
                        return { ok: true, term: { kind: "not", term: inner.term } };
                }
                if (t.t === "ident" && (t.v === "contains" || t.v === "exists")) {
                        take();
                        const open = take();
                        if (!open || open.t !== "punc" || open.v !== "(") return { ok: false, error: `${t.v}( must open its parentheses directly` };
                        const arg1 = take();
                        // A path argument: dotted (payload.title) or a bare
                        // identifier (action) — the same two spellings the
                        // comparison branch accepts.
                        const argPath = arg1?.t === "path" ? arg1.v : arg1?.t === "ident" ? [arg1.v] : null;
                        if (!argPath) return { ok: false, error: `${t.v}() takes a path as its first argument` };
                        if (t.v === "exists") {
                                const close = take();
                                if (!close || close.t !== "punc" || close.v !== ")") return { ok: false, error: "exists() takes exactly one path argument" };
                                return { ok: true, term: { kind: "exists", path: argPath } };
                        }
                        const comma = take();
                        if (!comma || comma.t !== "punc" || comma.v !== ",") return { ok: false, error: 'contains() needs two arguments: contains(path, "substr")' };
                        const needle = take();
                        if (!needle || needle.t !== "str") return { ok: false, error: 'contains()\'s second argument must be a quoted string: contains(path, "substr")' };
                        const close = take();
                        if (!close || close.t !== "punc" || close.v !== ")") return { ok: false, error: "contains() needs its closing parenthesis" };
                        return { ok: true, term: { kind: "contains", path: argPath, needle: needle.v } };
                }
                if (t.t === "ident") {
                        // Any other identifier followed by "(" is a call into a
                        // function the language does not have — the error that keeps
                        // it function-closed (no eval surface, ever).
                        const next = toks[pos + 1];
                        if (next && next.t === "punc" && next.v === "(") {
                                return { ok: false, error: `unknown function "${t.v}" — only contains(path, "str") and exists(path) exist` };
                        }
                        // Otherwise a bare identifier IS a one-segment path
                        // (`event == "push"`, `action == "opened"` — the top-level
                        // event name and GitHub-webhook-style payload fields).
                        take();
                        return comparison(t.v);
                }
                if (t.t === "path") {
                        take();
                        return comparison(t.v.join("."));
                }
                return { ok: false, error: "a filter term is a comparison, contains(...), exists(...) or a ! negation" };
        }

        /** `path op literal` — shared by dotted paths and bare identifiers. */
        function comparison(pathSrc: string): { ok: true; term: HookFilterTerm } | { ok: false; error: string } {
                const t = take();
                if (!t || t.t !== "op") return { ok: false, error: `"${pathSrc}" needs a comparison operator (==, !=, >, >=, <, <=)` };
                const op = t.v;
                const lit = literal();
                if (!lit.ok) return lit;
                if ((op === ">" || op === ">=" || op === "<" || op === "<=") && lit.value.t !== "int") {
                        return { ok: false, error: `${op} compares integers only` };
                }
                return { ok: true, term: { kind: "cmp", path: pathSrc.split("."), op, value: lit.value } };
        }

        const terms: HookFilterTerm[] = [];
        while (pos < toks.length) {
                const one = term();
                if (!one.ok) return { ok: false, error: one.error };
                terms.push(one.term);
        }
        if (terms.length === 0) return { ok: false, error: "empty filter" };
        return { ok: true, ast: { terms } };
}

/** Parse a filter source into an AST, or report why not (create-time 400). */
export function parseHookFilter(src: string): HookFilterParseResult {
        if (typeof src !== "string") return { ok: false, error: "filter must be a string" };
        if (src.length > MAX_HOOK_FILTER_CHARS) return { ok: false, error: `filter too long (max ${MAX_HOOK_FILTER_CHARS} chars)` };
        const lexed = lex(src);
        if (!lexed.ok) return lexed;
        return parseTokens(lexed.toks);
}

// ---------------------------------------------------------------------------
// Evaluation — total: no payload shape can make it throw
// ---------------------------------------------------------------------------

/** Sentinel for "path does not resolve" (distinct from a resolvable null). */
const MISSING = Symbol("missing");

function isPlainObject(v: unknown): v is Record<string, unknown> {
        return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Walk segments through plain objects only (hasOwnProperty, so a payload
 *  key named "toString" or "__proto__" resolves literally and nothing
 *  reaches a prototype). */
function descend(from: unknown, segments: string[]): unknown | typeof MISSING {
        let cur: unknown = from;
        for (const seg of segments) {
                if (!isPlainObject(cur)) return MISSING;
                if (!Object.prototype.hasOwnProperty.call(cur, seg)) return MISSING;
                cur = cur[seg];
        }
        return cur;
}

function resolve(segments: string[], ctx: HookEventContext): unknown | typeof MISSING {
        if (segments.length === 0) return MISSING;
        if (segments[0] === "event" && segments.length === 1) return ctx.event;
        if (segments[0] === "payload") return descend(ctx.payload, segments.slice(1));
        // Bare first segment = a payload field (GitHub-webhook style addressing).
        return descend(ctx.payload, segments);
}

function evalCmp(op: "==" | "!=" | ">" | ">=" | "<" | "<=", left: unknown | typeof MISSING, lit: FilterLiteral): boolean {
        const missing = left === MISSING;
        const nullish = left === null || left === undefined;
        if (lit.t === "null") {
                // `== null` reads missing as null (the one comparison a missing path
                // satisfies); everything else on a missing path is false.
                const isNull = missing || nullish;
                return op === "==" ? isNull : op === "!=" ? !isNull : false;
        }
        if (missing || nullish) return false;
        switch (lit.t) {
                case "str":
                case "bool":
                        if (op === "==") return left === lit.v;
                        if (op === "!=") return left !== lit.v;
                        return false; // ordering is integers-only (parser enforces the literal; eval the value)
                case "int": {
                        if (typeof left !== "number" || !Number.isFinite(left)) return false;
                        switch (op) {
                                case "==":
                                        return left === lit.v;
                                case "!=":
                                        return left !== lit.v;
                                case ">":
                                        return left > lit.v;
                                case ">=":
                                        return left >= lit.v;
                                case "<":
                                        return left < lit.v;
                                case "<=":
                                        return left <= lit.v;
                        }
                }
        }
}

function evalTerm(term: HookFilterTerm, ctx: HookEventContext): boolean {
        switch (term.kind) {
                case "not":
                        return !evalTerm(term.term, ctx);
                case "exists":
                        return resolve(term.path, ctx) !== MISSING;
                case "contains": {
                        const v = resolve(term.path, ctx);
                        if (v === MISSING) return false;
                        if (typeof v === "string") return v.includes(term.needle);
                        if (Array.isArray(v)) return v.some((el) => el === term.needle);
                        return false;
                }
                case "cmp":
                        return evalCmp(term.op, resolve(term.path, ctx), term.value);
        }
}

/** Evaluate a parsed filter against an event + payload. Total: any payload
 *  shape yields a boolean, never a throw (the webhook lane must be safe to
 *  point at the internet). */
export function evalHookFilter(ast: HookFilterAst, ctx: HookEventContext): boolean {
        try {
                for (const term of ast.terms) {
                        if (!evalTerm(term, ctx)) return false;
                }
                return true;
        } catch {
                return false; // unreachable by construction; the contract is absolute
        }
}

// ---------------------------------------------------------------------------
// Human description (the TUI/CLI schedule cell)
// ---------------------------------------------------------------------------

function describeLiteral(lit: FilterLiteral): string {
        switch (lit.t) {
                case "str":
                        return JSON.stringify(lit.v);
                case "int":
                        return String(lit.v);
                case "bool":
                        return String(lit.v);
                case "null":
                        return "null";
        }
}

function describeTerm(term: HookFilterTerm): string {
        switch (term.kind) {
                case "cmp":
                        return `${term.path.join(".")} ${term.op} ${describeLiteral(term.value)}`;
                case "contains":
                        return `${term.path.join(".")} contains ${JSON.stringify(term.needle)}`;
                case "exists":
                        return `${term.path.join(".")} exists`;
                case "not":
                        return `not ${describeTerm(term.term)}`;
        }
}

/** One short human line for a filter source (list rows, detail panes). An
 *  unparseable source is shown truncated — the row is display, not judgment. */
export function describeHookFilter(src: string): string {
        const parsed = parseHookFilter(src);
        if (!parsed.ok) return src.length > 40 ? `${src.slice(0, 39)}…` : src;
        return parsed.ast.terms.map(describeTerm).join(" and ");
}
