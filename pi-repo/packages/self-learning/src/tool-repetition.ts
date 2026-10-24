/**
 * tool-repetition.ts — `unown -p --max-tool-repetitions N` (the 2026-10-24
 * parity round; goose `--max-tool-repetitions` parity — the loop-guard lane).
 *
 * --max-turns bounds the RUN (a budget); this bounds the LOOP (an anomaly
 * detector): a model stuck calling the SAME tool with the SAME arguments,
 * over and over, is the classic degenerate headless failure — a retry spiral
 * against a wedged tool, a "fix the test" loop that reads the same file
 * forever. Each individual call is legitimate; only the REPETITION is the
 * bug. The guard counts CONSECUTIVE identical tool calls (same name + same
 * arguments, key-order-insensitive) across assistant messages and aborts the
 * agent loop when the streak reaches N — the transcript keeps everything up
 * to and including the tripped call's message, and print mode reports it as
 * a distinct exit code (4) with the tool named on stderr.
 *
 * Streak semantics (measured against pi's event shapes): assistant
 * `message_end` carries the complete content blocks; toolCall blocks are
 * walked in order. Each call is compared to the PREVIOUS call — identical
 * extends the streak, different resets it to 1. A single message with
 * parallel identical calls (same tool, same args twice in one message)
 * counts as a streak of 2 — two identical requests in a row is exactly the
 * pathology. A different tool OR different arguments in between resets —
 * legitimate retry-with-changed-args (the common healthy pattern: edit,
 * read, edit) never trips.
 */

/** The extension + its readable state. */
export interface ToolRepetitionGuard {
    extension: { name: string; hidden: boolean; factory: (pi: any) => void };
    /** Live state (read after the run for the envelope + exit code). */
    state: {
        /** The current consecutive-identical streak (diagnostic; 0 before any call). */
        streak: number;
        /** The last-seen call signature (name + canonical args), when any. */
        lastSignature: string | null;
        /** Set when the guard tripped — the run was aborted. */
        tripped: boolean;
        tool: string | null;
        count: number;
        limit: number;
    };
}

/** Parse + validate the --max-tool-repetitions value: a positive integer. */
export function parseMaxToolRepetitions(raw: string): { ok: true; value: number } | { ok: false; error: string } {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        return { ok: false, error: `--max-tool-repetitions expects a positive integer (got ${JSON.stringify(raw)})` };
    }
    return { ok: true, value: n };
}

/** Stable stringify: object keys sorted at every depth, so `{a:1,b:2}` and
 *  `{b:2,a:1}` canonicalize equal — the guard must not miss a loop because
 *  the model reordered its JSON. Non-JSON values fall back to String(). */
export function canonicalArgs(args: unknown): string {
    const walk = (v: unknown): unknown => {
        if (v === null || typeof v !== "object") return v;
        if (Array.isArray(v)) return v.map(walk);
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) {
            out[k] = walk((v as Record<string, unknown>)[k]);
        }
        return out;
    };
    try {
        // nullish args canonicalize as the empty object (the toolCallSignature
        // call site's `args ?? {}` semantics, kept consistent here).
        return JSON.stringify(walk(args ?? {})) ?? "null";
    } catch {
        return String(args);
    }
}

/** One tool call's signature: `name\0canonicalArgs` (name first so different
 *  tools never compare equal, even with identical argument objects). */
export function toolCallSignature(name: unknown, args: unknown): string | null {
    if (typeof name !== "string" || name.length === 0) return null;
    return `${name}\u0000${canonicalArgs(args ?? {})}`;
}

/** Walk an ASSISTANT message's content blocks; yield toolCall signatures in
 *  order. Tolerates every malformed shape (returns []). Role-checked: only
 *  assistant messages carry tool calls — a forged toolCall block in any
 *  other role's content is ignored. */
export function toolCallSignaturesInMessage(message: unknown): string[] {
    if (!message || typeof message !== "object") return [];
    if ((message as any).role !== "assistant") return [];
    const content = (message as any).content;
    if (!Array.isArray(content)) return [];
    const out: string[] = [];
    for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if (block.type !== "toolCall") continue;
        const sig = toolCallSignature(block.name, block.arguments);
        if (sig !== null) out.push(sig);
    }
    return out;
}

/**
 * The loop guard. `onLoop` fires (once) when the streak reaches the limit —
 * print mode passes a stderr logger; the JSON lane reads `state.tripped`.
 */
export function createToolRepetitionGuard(
    limit: number,
    onLoop?: (info: { tool: string; count: number; limit: number }) => void,
): ToolRepetitionGuard {
    const state: ToolRepetitionGuard["state"] = {
        streak: 0,
        lastSignature: null,
        tripped: false,
        tool: null,
        count: 0,
        limit,
    };
    const consider = (sig: string, ctx: any) => {
        if (state.tripped) return;
        if (sig === state.lastSignature) {
            state.streak += 1;
        } else {
            state.streak = 1;
            state.lastSignature = sig;
        }
        if (state.streak >= limit) {
            state.tripped = true;
            state.tool = sig.slice(0, sig.indexOf("\u0000"));
            state.count = state.streak;
            try {
                ctx?.abort?.();
            } catch {
                /* a guard's abort must never crash the session */
            }
            onLoop?.({ tool: state.tool!, count: state.streak, limit });
        }
    };
    const factory = (pi: any) => {
        pi.on("message_end", ((event: any, ctx: any) => {
            if (event?.message?.role !== "assistant") return;
            for (const sig of toolCallSignaturesInMessage(event.message)) {
                consider(sig, ctx);
                if (state.tripped) return;
            }
        }) as any);
    };
    return {
        extension: { name: "unown-tool-repetition", hidden: true, factory },
        state,
    };
}
