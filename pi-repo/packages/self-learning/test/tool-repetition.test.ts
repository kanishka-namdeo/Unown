// tool-repetition.test.ts — the parity-round loop guard
// (--max-tool-repetitions, src/tool-repetition.ts; goose parity).
//
// Coverage contract: the value parses/validates like --max-turns; argument
// canonicalization is key-order-insensitive at every depth; toolCall
// signatures walk assistant message_end content blocks; the streak counts
// CONSECUTIVE identical calls across messages and within one message
// (parallel identical calls), resets on a different tool or changed
// arguments, aborts exactly once via ctx.abort, survives a missing ctx, and
// never crashes on malformed shapes.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";

import {
    canonicalArgs,
    createToolRepetitionGuard,
    parseMaxToolRepetitions,
    toolCallSignature,
    toolCallSignaturesInMessage,
    type ToolRepetitionGuard,
} from "../src/tool-repetition.ts";

describe("parseMaxToolRepetitions", () => {
    test("positive integers pass; zero/negative/floats/junk are usage errors", () => {
        expect(parseMaxToolRepetitions("3").ok).toBe(true);
        expect(parseMaxToolRepetitions("1").ok).toBe(true);
        for (const bad of ["0", "-1", "1.5", "abc", ""]) {
            const r = parseMaxToolRepetitions(bad);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.error).toContain("--max-tool-repetitions");
        }
    });
});

describe("canonicalArgs", () => {
    test("key order (at every depth) does not change the canonical form", () => {
        expect(canonicalArgs({ a: 1, b: { x: 1, y: 2 } })).toBe(canonicalArgs({ b: { y: 2, x: 1 }, a: 1 }));
        expect(canonicalArgs({ a: 1, b: 2 })).not.toBe(canonicalArgs({ a: 1, b: 3 }));
    });
    test("arrays keep order; non-JSON falls back to String", () => {
        expect(canonicalArgs([1, 2])).toBe("[1,2]");
        expect(canonicalArgs([2, 1])).toBe("[2,1]");
        expect(canonicalArgs(undefined)).toBe("{}");
        expect(typeof canonicalArgs(BigInt(1))).toBe("string");
    });
});

describe("toolCallSignature / toolCallSignaturesInMessage", () => {
    test("name + NUL + canonical args; different tools never compare equal", () => {
        const a = toolCallSignature("bash", { command: "ls" });
        const b = toolCallSignature("bash", { command: "ls" });
        const c = toolCallSignature("edit", { command: "ls" });
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(toolCallSignature("", {})).toBeNull();
        expect(toolCallSignature(42 as any, {})).toBeNull();
    });
    test("walks assistant content blocks in order; tolerates junk", () => {
        const msg = {
            role: "assistant",
            content: [
                { type: "text", text: "thinking out loud" },
                { type: "toolCall", name: "bash", arguments: { command: "ls" } },
                { type: "toolCall", name: "bash", arguments: { command: "ls" } },
                { type: "toolCall", name: "read", arguments: { path: "a.ts" } },
                null,
                { type: "unknown" },
            ],
        };
        const sigs = toolCallSignaturesInMessage(msg);
        expect(sigs).toHaveLength(3);
        expect(sigs[0]).toBe(sigs[1]);
        expect(sigs[2]).not.toBe(sigs[0]);
        expect(toolCallSignaturesInMessage(null)).toEqual([]);
        expect(toolCallSignaturesInMessage({ role: "assistant", content: "raw string" })).toEqual([]);
        expect(toolCallSignaturesInMessage({ role: "user", content: [{ type: "toolCall", name: "x" }] })).toEqual([]);
    });
});

describe("createToolRepetitionGuard", () => {
    /** Build the handler table from a guard's factory, the harness contract. */
    function handlersOf(guard: ToolRepetitionGuard) {
        const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
        guard.extension.factory({
            on: (name: string, h: (event: unknown, ctx: unknown) => void) => {
                handlers[name] = h as (event: unknown, ctx: unknown) => void;
            },
        });
        return handlers;
    }

    function assistantMsg(calls: Array<{ name: string; args: any }>) {
        return {
            type: "message_end",
            message: {
                role: "assistant",
                content: calls.map((c) => ({ type: "toolCall", name: c.name, arguments: c.args })),
            },
        };
    }

    test("N consecutive identical calls abort once at the limit; the callback names the tool", () => {
        const guard = createToolRepetitionGuard(3);
        const handlers = handlersOf(guard);
        let aborted = 0;
        let fired: { tool: string; count: number; limit: number } | null = null;
        guard; // state read below
        const g = createToolRepetitionGuard(3, (info) => (fired = info));
        const h = handlersOf(g);
        const ctx = { abort: () => (aborted += 1) };
        h["message_end"]?.(assistantMsg([{ name: "read", args: { path: "a.ts" } }]), ctx);
        expect(g.state.streak).toBe(1);
        expect(g.state.tripped).toBe(false);
        h["message_end"]?.(assistantMsg([{ name: "read", args: { path: "a.ts" } }]), ctx);
        expect(g.state.tripped).toBe(false);
        h["message_end"]?.(assistantMsg([{ name: "read", args: { path: "a.ts" } }]), ctx); // 3rd — trips
        expect(g.state.tripped).toBe(true);
        expect(g.state.tool).toBe("read");
        expect(g.state.count).toBe(3);
        expect(g.state.limit).toBe(3);
        expect(aborted).toBe(1);
        expect(fired).toEqual({ tool: "read", count: 3, limit: 3 });
        // A 4th identical call after the trip does not abort again.
        h["message_end"]?.(assistantMsg([{ name: "read", args: { path: "a.ts" } }]), ctx);
        expect(aborted).toBe(1);
        expect(g.state.streak).toBe(3); // consider() returns early post-trip
        expect(handlers).toBeTruthy(); // the first guard's table stays unused-but-built
    });

    test("changed arguments or a different tool resets the streak", () => {
        const g = createToolRepetitionGuard(3);
        const h = handlersOf(g);
        const ctx = { abort: () => {} };
        h["message_end"]?.(assistantMsg([{ name: "bash", args: { command: "ls" } }]), ctx);
        h["message_end"]?.(assistantMsg([{ name: "bash", args: { command: "ls" } }]), ctx);
        expect(g.state.streak).toBe(2);
        // Changed args → reset to 1.
        h["message_end"]?.(assistantMsg([{ name: "bash", args: { command: "ls -la" } }]), ctx);
        expect(g.state.streak).toBe(1);
        expect(g.state.tripped).toBe(false);
        // Same args again, but a different tool in between resets too.
        h["message_end"]?.(assistantMsg([{ name: "bash", args: { command: "ls -la" } }]), ctx);
        h["message_end"]?.(assistantMsg([{ name: "read", args: { path: "x" } }]), ctx);
        h["message_end"]?.(assistantMsg([{ name: "bash", args: { command: "ls -la" } }]), ctx);
        expect(g.state.streak).toBe(1);
        expect(g.state.tripped).toBe(false);
    });

    test("parallel identical calls within ONE message count toward the streak", () => {
        const g = createToolRepetitionGuard(2);
        const h = handlersOf(g);
        const ctx = { abort: () => {} };
        h["message_end"]?.(
            assistantMsg([
                { name: "grep", args: { pattern: "foo" } },
                { name: "grep", args: { pattern: "foo" } },
            ]),
            ctx,
        );
        expect(g.state.tripped).toBe(true);
        expect(g.state.tool).toBe("grep");
        expect(g.state.count).toBe(2);
    });

    test("key-order-different but value-identical args are the same call", () => {
        const g = createToolRepetitionGuard(2);
        const h = handlersOf(g);
        const ctx = { abort: () => {} };
        h["message_end"]?.(assistantMsg([{ name: "edit", args: { path: "a.ts", old: "x" } }]), ctx);
        h["message_end"]?.(assistantMsg([{ name: "edit", args: { old: "x", path: "a.ts" } }]), ctx);
        expect(g.state.tripped).toBe(true);
    });

    test("non-assistant events and malformed messages are ignored; a missing ctx never crashes", () => {
        const g = createToolRepetitionGuard(2);
        const h = handlersOf(g);
        h["message_end"]?.({ type: "message_end", message: { role: "user", content: "hi" } }, undefined);
        h["message_end"]?.({ type: "message_end", message: null }, undefined);
        h["message_end"]?.({ type: "message_end" }, undefined);
        h["message_end"]?.(null, undefined);
        h["message_start"]?.({ type: "message_start", message: { role: "assistant" } }, { abort: () => {} });
        expect(g.state.streak).toBe(0);
        expect(g.state.tripped).toBe(false);
        // Trip with no ctx at all — the abort is skipped, the state still records.
        h["message_end"]?.(assistantMsg([{ name: "read", args: { path: "z" } }]), undefined);
        h["message_end"]?.(assistantMsg([{ name: "read", args: { path: "z" } }]), undefined);
        expect(g.state.tripped).toBe(true);
    });

    test("limit 1 trips on the first call (the strictest contract)", () => {
        const g = createToolRepetitionGuard(1);
        const h = handlersOf(g);
        h["message_end"]?.(assistantMsg([{ name: "bash", args: { command: "ls" } }]), { abort: () => {} });
        expect(g.state.tripped).toBe(true);
        expect(g.state.count).toBe(1);
    });
});
