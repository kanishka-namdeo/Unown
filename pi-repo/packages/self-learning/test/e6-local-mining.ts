/**
 * E6 — production-path validation of the local mining lane.
 *
 * Calls the REAL mineFailure() from harness.ts (production code, production
 * env var PI_MINER_MODEL_ID, production bridge routing) against a REAL failed
 * run harvested from the engine DB. No replay approximation: this is the
 * exact code path the router's harness-cycle job takes when a task fails.
 *
 * Run from the self-learning package dir:
 *   PI_MINER_MODEL_ID=local-qwen3-0.6b bun test/e6-local-mining.ts <runId>
 */
import { mineFailure } from "../src/harness.ts";
import { getTask } from "../src/tasks.ts";
import { store } from "../src/store.ts";

async function main() {
        const runId = process.argv[2];
        if (!runId) throw new Error("usage: bun e6-local-mining.ts <runId>");

        const row: any = store.get(`SELECT * FROM runs WHERE id = ?`, [runId]);
        if (!row) throw new Error(`run ${runId} not found`);
        const task = getTask(row.task_id);
        if (!task) throw new Error(`task ${row.task_id} not found`);

        const run = {
                id: row.id,
                status: row.status,
                transcript: JSON.parse(row.transcript || "[]"),
                verify: row.verify_output ? { passed: false, summary: "", log: String(row.verify_output) } : undefined,
                sandboxId: row.sandbox_id ?? "",
                tokensIn: row.tokens_in ?? 0,
                tokensOut: row.tokens_out ?? 0,
                toolCalls: row.tool_calls ?? 0,
                turns: row.turns ?? 0,
                lastAssistantText: "",
                toolsUsed: [],
                durationMs: row.ended_at && row.started_at ? row.ended_at - row.started_at : 0,
        };

        console.log(`[e6] task=${task.id} run=${run.id} status=${run.status} transcript events=${run.transcript.length}`);
        console.log(`[e6] PI_MINER_MODEL_ID=${process.env.PI_MINER_MODEL_ID ?? "(unset -> remote default)"}`);

        const t0 = Date.now();
        const result = await mineFailure(task, run);
        const dt = Date.now() - t0;

        console.log(`[e6] mineFailure returned in ${dt}ms via the ${process.env.PI_MINER_MODEL_ID ? "LOCAL" : "remote"} lane:`);
        console.log(JSON.stringify(result, null, 2));

        // acceptance: a structured MiningResult the harness would accept
        const ok =
                typeof result.diagnosis === "string" && result.diagnosis.length > 0 &&
                Array.isArray(result.patchLines) && result.patchLines.length >= 1 && result.patchLines.length <= 6 &&
                result.patchLines.every((l: string) => l.length <= 200) &&
                (result.targetTier === "project" || result.targetTier === "local");
        console.log(`[e6] harness-validator pass: ${ok}`);
        process.exit(ok ? 0 : 1);
}

main().catch((e) => {
        console.error("[e6] FATAL:", e);
        process.exit(1);
});
