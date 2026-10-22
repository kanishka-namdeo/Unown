// hook-filter.test.ts — the M2 event-routine payload filter (hook-filter.ts),
// pinned as a LANGUAGE CONTRACT, not an implementation detail: the filter is
// stored in the engine DB, evaluated on every inbound webhook, and written by
// users at routine-create time, so a silent semantic drift (a missing path
// suddenly throwing, `>` learning string coercion) is a behavior change for
// every configured sender, not a refactor.
//
// Three tables, mirroring the module's three exports:
//   1. parseHookFilter — accept/reject: every operator, both quote styles,
//      negation, AND-by-juxtaposition, and the syntax errors createAutomation
//      must turn into 400s (unterminated strings, dangling dots, unknown
//      functions, ordering against a string literal, over-length sources).
//   2. evalHookFilter — the TOTALITY contract: missing paths satisfy nothing
//      (except `== null`, which reads missing as null), type mismatches are
//      false, nested payloads resolve through `payload.` AND bare paths
//      (GitHub-webhook addressing), arrays answer contains(), and a payload
//      shaped like anything at all (scalars, arrays, nulls) can only ever
//      produce a boolean — never a throw. The webhook lane is the one engine
//      surface pointed at the open internet; these rows are its whole safety
//      story next to the 64KB cap.
//   3. describeHookFilter — the short human line the CLI list rows and the
//      TUI schedule chip render (unparseable sources degrade to a truncation,
//      because a stored filter is display data, not judgment).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";
import {
        describeHookFilter,
        evalHookFilter,
        MAX_HOOK_FILTER_CHARS,
        parseHookFilter,
} from "../src/hook-filter.ts";

/** Parse must succeed (and return the term count the AND carries). */
function parses(src: string, terms = 1): void {
        const r = parseHookFilter(src);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.ast.terms).toHaveLength(terms);
}

/** Parse must fail — optionally matching the error text. */
function rejects(src: string, hint?: string): void {
        const r = parseHookFilter(src);
        expect(r.ok).toBe(false);
        if (!r.ok && hint) expect(r.error).toContain(hint);
}

/** Eval a source against {event, payload} — the one-liner the truth table
 *  wants; parse failures fail the test outright (they were pinned above). */
function matches(src: string, event: string, payload: unknown): boolean {
        const parsed = parseHookFilter(src);
        if (!parsed.ok) throw new Error(`fixture failed to parse: ${src} (${parsed.error})`);
        return evalHookFilter(parsed.ast, { event, payload });
}

// ---------------------------------------------------------------------------
// parseHookFilter — the accept/reject table
// ---------------------------------------------------------------------------

describe("parseHookFilter (accept)", () => {
        test("every comparison operator", () => {
                parses('payload.action == "opened"');
                parses("payload.state != 'closed'");
                parses("payload.attempt > 2");
                parses("payload.attempt >= 2");
                parses("payload.attempt < 2");
                parses("payload.attempt <= 2");
        });
        test("literals: both quote styles, integers (incl. negative), true/false/null", () => {
                parses('payload.a == "x"');
                parses("payload.a == 'x'");
                parses("payload.n == 7");
                parses("payload.n == -12");
                parses("payload.draft == true");
                parses("payload.draft == false");
                parses("payload.x == null");
                parses("payload.n != 0");
        });
        test("dotted paths, multi-segment, and the top-level event name", () => {
                parses("payload.label.name == 'bug'");
                parses("sender.login == 'octocat'"); // bare first segment = payload field
                parses('event == "push"'); // the event NAME string, not a payload field
        });
        test("contains + exists (both quote styles for contains)", () => {
                parses('contains(payload.title, "bug")');
                parses("contains(payload.title, 'bug')");
                parses("exists(payload.label)");
                parses("exists(payload.label.name)");
        });
        test("prefix ! negation (and its distinction from !=)", () => {
                parses("!exists(payload.draft)");
                parses('!contains(payload.title, "wip")');
                parses('payload.a != "b"'); // != is the operator, not ! + =
        });
        test("AND is juxtaposition — spaces between terms, no operator token", () => {
                parses('payload.action == "opened" contains(payload.title, "bug")', 2);
                parses("exists(payload.a) exists(payload.b) !exists(payload.c)", 3);
        });
        test("whitespace variants (tabs, newlines) separate terms", () => {
                parses('payload.a == "x"\texists(payload.b)', 2);
        });
});

describe("parseHookFilter (reject)", () => {
        test("empty / whitespace-only", () => {
                rejects("");
                rejects("   ");
                rejects("empty filter", "needs a comparison operator"); // two bare identifiers, no operator
        });
        test("unterminated string", () => {
                rejects('payload.a == "open');
                rejects("payload.a == 'open");
        });
        test("dangling / doubled dots in a path", () => {
                rejects("payload.a. == 'x'", "dangling");
                rejects("payload..a == 'x'", "dangling");
        });
        test("unknown function names (the whole point: no eval surface)", () => {
                rejects('regex(payload.a, "x")', "unknown function");
                rejects("size(payload.a)", "unknown function");
        });
        test("contains/exists argument shapes", () => {
                rejects("contains(payload.a)", "two arguments");
                rejects("contains('lit', 'x')", "takes a path");
                rejects("contains(payload.a, 5)", "quoted string");
                rejects("contains(payload.a, payload.b)", "quoted string");
                rejects("exists(payload.a, payload.b)", "exactly one");
                rejects("exists 'naked'", "parentheses");
        });
        test("a comparison needs an operator and a LITERAL right-hand side", () => {
                rejects('payload.a "x"', "comparison operator");
                rejects("payload.a", "comparison operator");
                rejects("payload.a == payload.b", "literal");
                rejects("payload.a == >", "literal");
        });
        test("ordering operators compare integers only (parse-time 400, not eval-time false)", () => {
                rejects('payload.a > "x"', "integers only");
                rejects("payload.a >= true", "integers only");
                rejects("payload.a < null", "integers only");
        });
        test("stray punctuation and unknown characters", () => {
                rejects("&&", "unexpected character");
                rejects('payload.a == "x" && exists(payload.b)', "unexpected character");
                rejects("()", "a filter term is");
                rejects("!", "unexpected end of filter");
                rejects(",", "a filter term is");
                rejects('!(payload.a == "b")', "a filter term is"); // no parenthesized grouping — ! applies to one term
        });
        test("over-length sources (a condition, not a program)", () => {
                rejects("x".repeat(MAX_HOOK_FILTER_CHARS + 1), "too long");
                // exactly at the cap still parses if it is a real term
                parses(`exists(${"a".repeat(MAX_HOOK_FILTER_CHARS - 10)})`);
        });
        test("non-string input is a parse error, not a throw", () => {
                expect(parseHookFilter(null as any).ok).toBe(false);
                expect(parseHookFilter(undefined as any).ok).toBe(false);
                expect(parseHookFilter(42 as any).ok).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// evalHookFilter — the truth table (total: no payload shape can throw)
// ---------------------------------------------------------------------------

describe("evalHookFilter (equality + literals)", () => {
        const payload = { action: "opened", state: "closed", attempt: 3, draft: false, note: null };
        test("string equality / inequality, both quote styles", () => {
                expect(matches('payload.action == "opened"', "push", payload)).toBe(true);
                expect(matches("payload.action == 'opened'", "push", payload)).toBe(true);
                expect(matches('payload.action != "closed"', "push", payload)).toBe(true);
                expect(matches('payload.action == "closed"', "push", payload)).toBe(false);
        });
        test("integer + boolean + null literals", () => {
                expect(matches("payload.attempt == 3", "push", payload)).toBe(true);
                expect(matches("payload.attempt != 3", "push", payload)).toBe(false);
                expect(matches("payload.draft == false", "push", payload)).toBe(true);
                expect(matches("payload.draft == true", "push", payload)).toBe(false);
                expect(matches("payload.note == null", "push", payload)).toBe(true);
                expect(matches("payload.note != null", "push", payload)).toBe(false);
        });
        test("ordering operators on integers", () => {
                expect(matches("payload.attempt > 2", "push", payload)).toBe(true);
                expect(matches("payload.attempt >= 3", "push", payload)).toBe(true);
                expect(matches("payload.attempt < 3", "push", payload)).toBe(false);
                expect(matches("payload.attempt <= 3", "push", payload)).toBe(true);
                expect(matches("payload.attempt > 3", "push", payload)).toBe(false);
        });
        test("the top-level event path resolves to the event NAME", () => {
                expect(matches('event == "push"', "push", payload)).toBe(true);
                expect(matches('event == "issue.opened"', "push", payload)).toBe(false);
                // `event` is a string, not a container: descending is a miss
                expect(matches("event.action == 'x'", "push", payload)).toBe(false);
        });
});

describe("evalHookFilter (missing paths — the totality contract)", () => {
        test("a missing path satisfies nothing", () => {
                expect(matches('payload.nope == "x"', "push", {})).toBe(false);
                expect(matches('payload.nope != "x"', "push", {})).toBe(false);
                expect(matches("payload.nope > 1", "push", {})).toBe(false);
                expect(matches("payload.nope == true", "push", {})).toBe(false);
                expect(matches("exists(payload.nope)", "push", {})).toBe(false);
                expect(matches('contains(payload.nope, "x")', "push", {})).toBe(false);
        });
        test("the ONE exception: == null reads missing as null (!= null is false)", () => {
                expect(matches("payload.nope == null", "push", {})).toBe(true);
                expect(matches("payload.nope != null", "push", {})).toBe(false);
                // a present null and a missing path are the same for == null
                expect(matches("payload.note == null", "push", { note: null })).toBe(true);
        });
        test("descending through a scalar or an array is a miss, not a throw", () => {
                expect(matches("payload.title.name == 'x'", "push", { title: "plain string" })).toBe(false);
                expect(matches("payload.list.name == 'x'", "push", { list: [1, 2] })).toBe(false);
                // `payload` itself resolves to the whole body: a scalar payload is
                // comparable as a string, and still never throws.
                expect(matches("payload == 'scalar'", "push", "scalar")).toBe(true);
                expect(matches("payload == null", "push", "scalar")).toBe(false);
                expect(matches("payload.x == null", "push", [1, 2])).toBe(true); // array payload: every path is missing
        });
        test("a null/undefined mid-path stops the walk", () => {
                expect(matches("payload.a.b == 'x'", "push", { a: null })).toBe(false);
                expect(matches("payload.a.b == null", "push", { a: null })).toBe(true); // missing ⇒ null
        });
});

describe("evalHookFilter (type mismatches are false, never coercions)", () => {
        test("string field vs integer literal, integer field vs string literal", () => {
                expect(matches("payload.name == 7", "push", { name: "7" })).toBe(false);
                expect(matches("payload.count == '3'", "push", { count: 3 })).toBe(false);
        });
        test("ordering against a non-number value is false (no JS coercion)", () => {
                expect(matches("payload.count > 1", "push", { count: "3" })).toBe(false);
                expect(matches("payload.count > 1", "push", { count: null })).toBe(false);
                expect(matches("payload.count > 1", "push", { count: "2" })).toBe(false);
        });
        test("string 'true' is not boolean true", () => {
                expect(matches("payload.draft == true", "push", { draft: "true" })).toBe(false);
        });
        test("floats compare by value where the literal is an integer", () => {
                expect(matches("payload.score == 2", "push", { score: 2 })).toBe(true);
                expect(matches("payload.score == 2", "push", { score: 2.5 })).toBe(false);
                expect(matches("payload.score > 2", "push", { score: 2.5 })).toBe(true);
        });
});

describe("evalHookFilter (nested payloads + both path spellings)", () => {
        const githubish = { action: "opened", label: { name: "bug" }, sender: { login: "octocat" }, payload: { deep: true } };
        test("payload.<path> descends", () => {
                expect(matches('payload.label.name == "bug"', "issues", githubish)).toBe(true);
                expect(matches('payload.label.name == "chore"', "issues", githubish)).toBe(false);
                expect(matches("payload.sender.login == 'octocat'", "issues", githubish)).toBe(true);
        });
        test("a bare first segment is looked up INSIDE the payload (GitHub-webhook style)", () => {
                expect(matches("label.name == 'bug'", "issues", githubish)).toBe(true);
                expect(matches("sender.login == 'octocat'", "issues", githubish)).toBe(true);
                expect(matches("action == 'opened'", "issues", githubish)).toBe(true);
        });
        test("nested 'payload' key: payload.payload resolves literally", () => {
                expect(matches("payload.payload.deep == true", "push", githubish)).toBe(true);
        });
});

describe("evalHookFilter (contains + exists + negation + AND)", () => {
        test("contains: substring in a string", () => {
                expect(matches('contains(payload.title, "bug")', "push", { title: "Fix: bug in parser" })).toBe(true);
                expect(matches('contains(payload.title, "BUG")', "push", { title: "bug" })).toBe(false); // case-sensitive
                expect(matches('contains(payload.title, "x")', "push", { title: "" })).toBe(false);
        });
        test("contains: membership in an array of primitives (not objects)", () => {
                expect(matches('contains(payload.labels, "bug")', "push", { labels: ["bug", "chore"] })).toBe(true);
                expect(matches('contains(payload.labels, "Bug")', "push", { labels: ["bug"] })).toBe(false);
                expect(matches('contains(payload.labels, "bug")', "push", { labels: [{ name: "bug" }] })).toBe(false);
                expect(matches('contains(payload.labels, "bug")', "push", { labels: "just a string with bug" })).toBe(true); // string lane
                expect(matches('contains(payload.labels, "bug")', "push", { labels: 42 })).toBe(false);
        });
        test("exists: presence, including an explicit null value", () => {
                expect(matches("exists(payload.label)", "push", { label: null })).toBe(true); // null is a VALUE
                expect(matches("exists(payload.label)", "push", { label: { name: "x" } })).toBe(true);
                expect(matches("exists(payload.label)", "push", {})).toBe(false);
                expect(matches("exists(payload.label.name)", "push", { label: {} })).toBe(false);
        });
        test("! negation", () => {
                expect(matches("!exists(payload.draft)", "push", {})).toBe(true);
                expect(matches("!exists(payload.draft)", "push", { draft: true })).toBe(false);
                expect(matches('!contains(payload.title, "wip")', "push", { title: "ready" })).toBe(true);
        });
        test("AND: every term must hold", () => {
                const src = 'payload.action == "opened" contains(payload.title, "bug") !exists(payload.draft)';
                expect(matches(src, "push", { action: "opened", title: "bug hunt" })).toBe(true);
                expect(matches(src, "push", { action: "closed", title: "bug hunt" })).toBe(false);
                expect(matches(src, "push", { action: "opened", title: "chore" })).toBe(false);
                expect(matches(src, "push", { action: "opened", title: "bug hunt", draft: true })).toBe(false);
        });
});

describe("evalHookFilter (hostility: prototype names resolve literally, nothing throws)", () => {
        test("an own 'toString'/'__proto__' key is data, never a prototype reach", () => {
                expect(matches('payload.toString == "weird"', "push", { toString: "weird" })).toBe(true);
                expect(matches("exists(payload.toString)", "push", { toString: "weird" })).toBe(true);
                expect(matches("exists(payload.toString)", "push", {})).toBe(false); // Object.prototype is NOT a hit
                // JSON.parse yields own properties even for __proto__ (no setter runs):
                // the walk sees DATA, and a bare object sees a missing path.
                expect(matches('payload.__proto__ == "x"', "push", JSON.parse('{"__proto__": "x"}'))).toBe(true);
                expect(matches('payload.__proto__ == "x"', "push", {})).toBe(false);
                expect(matches("payload.__proto__ == null", "push", {})).toBe(true);
        });
        test("deeply weird payloads only ever yield false", () => {
                const weird = [{}, [], "s", 3, true, null];
                for (const p of weird) {
                        expect(matches('payload.a.b.c == "x"', "push", p)).toBe(false);
                        expect(matches("payload.a.b.c == null", "push", p)).toBe(true);
                        expect(matches("exists(payload.a)", "push", p)).toBe(false);
                }
        });
});

// ---------------------------------------------------------------------------
// describeHookFilter — the human line (CLI rows + TUI chips)
// ---------------------------------------------------------------------------

describe("describeHookFilter", () => {
        test("each term kind renders its short form", () => {
                expect(describeHookFilter('payload.action == "opened"')).toBe('payload.action == "opened"');
                expect(describeHookFilter("payload.n > 2")).toBe("payload.n > 2");
                expect(describeHookFilter('contains(payload.title, "bug")')).toBe('payload.title contains "bug"');
                expect(describeHookFilter("exists(payload.label)")).toBe("payload.label exists");
                expect(describeHookFilter("!exists(payload.draft)")).toBe("not payload.draft exists");
        });
        test("AND joins with ' and '", () => {
                expect(describeHookFilter('payload.action == "opened" exists(payload.label)')).toBe(
                        'payload.action == "opened" and payload.label exists',
                );
        });
        test("booleans/null render as themselves", () => {
                expect(describeHookFilter("payload.draft == true")).toBe("payload.draft == true");
                expect(describeHookFilter("payload.x == null")).toBe("payload.x == null");
        });
        test("an unparseable source degrades to a truncation (display, not judgment)", () => {
                const bad = "this is not a filter at all";
                expect(describeHookFilter(bad)).toBe(bad);
                const longBad = "x".repeat(60);
                expect(describeHookFilter(longBad)).toBe(`${"x".repeat(39)}…`);
        });
});
