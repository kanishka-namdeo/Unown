/**
 * max-turns.ts — `unown -p --max-turns N` (the 2026-10-24 CI round; Claude
 * Code / Gemini CLI parity — the bounded headless run). An unbounded `-p`
 * run is a CI hazard: a model that loops (tool-call ping-pong, retry
 * spirals) burns budget until the caller's own timeout kills it, with no
 * clean partial answer. The cap turns that into a bounded, contract-shaped
 * stop: after N COMPLETED model turns, the (N+1)th model call is aborted —
 * the transcript keeps turns 1..N and the final assistant text stands.
 *
 * Turn semantics (measured live, 2026-10-24): a "turn" is ONE MODEL CALL —
 * pi fires `message_start` per assistant message, while `agent_start`/
 * `agent_end` bracket the whole agent LOOP for one user prompt (one loop
 * spans every model call of a tool-using exchange; the first live test
 * capped nothing because a 3-step tool task was ONE agent_start). The
 * guard therefore counts assistant `message_start` events and aborts the
 * in-flight (N+1)th call — pi's own ctx.abort() ("abort the current agent
 * operation", the Ctrl-C path), so disposal, session notes and print-mode
 * exit semantics all behave as an interrupted run. The answer produced so
 * far still prints (the F11 empty-answer guard keeps a cap-on-turn-1 from
 * reporting an empty success).
 *
 * Exit codes: unchanged (0 with an answer, 1 on empty/error); the JSON
 * envelope gains `capped: true` when the cap fired (additive field, only
 * with the flag) so pipelines can tell "finished" from "stopped at N".
 * `num_turns` in the envelope counts completed assistant messages — the
 * same boundary this guard enforces.
 */

/** The extension + its readable state. */
export interface MaxTurnsGuard {
    extension: { name: string; hidden: boolean; factory: (pi: any) => void };
    /** Live state (read after the run for the envelope + stderr note). */
    state: { turns: number; capped: boolean; abortedTurnEnds: number };
}

/** Parse + validate the --max-turns value: a positive integer. */
export function parseMaxTurns(raw: string): { ok: true; value: number } | { ok: false; error: string } {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        return { ok: false, error: `--max-turns expects a positive integer (got ${JSON.stringify(raw)})` };
    }
    return { ok: true, value: n };
}

/**
 * The cap guard. `onCapped` fires (once) when the cap aborts a model call —
 * print mode passes a stderr logger; the JSON lane reads `state.capped`.
 */
export function createMaxTurnsGuard(maxTurns: number, onCapped?: (turns: number) => void): MaxTurnsGuard {
    const state = { turns: 0, capped: false, abortedTurnEnds: 0 };
    const factory = (pi: any) => {
        pi.on("message_start", ((event: any, ctx: any) => {
            if (event?.message?.role !== "assistant") return;
            state.turns += 1;
            if (state.turns > maxTurns && !state.capped) {
                state.capped = true;
                try {
                    ctx?.abort?.();
                } catch {
                    /* a guard's abort must never crash the session */
                }
                onCapped?.(maxTurns);
            }
        }) as any);
        // The aborted (N+1)th turn can still emit a message_end for the
        // partial/empty assistant message pi records — the envelope's
        // num_turns must count COMPLETED turns, so track those ends and
        // subtract them at assembly time (cli.ts).
        pi.on("message_end", ((event: any) => {
            if (state.capped && event?.message?.role === "assistant") state.abortedTurnEnds += 1;
        }) as any);
    };
    return {
        extension: { name: "unown-max-turns", hidden: true, factory },
        state,
    };
}
