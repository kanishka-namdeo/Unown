/**
 * e7.mjs — E7 (H9): remote-lane response_format adoption for the failure miner.
 *
 * E3 found (REPORT.md finding 2) that the remote production model (kimi-k2.5)
 * violates the miner's <=200-char patch-line spec on 50% of calls, while the
 * LOCAL lane's json_schema grammar makes the violation structurally impossible.
 * H9 asks the mirror question for the REMOTE lane: does the Dashscope upstream
 * accept per-call response_format, and does adopting
 * response_format:json_schema on the miner's chatJson call eliminate the spec
 * violations with no quality regression?
 *
 * Design: three arms over the SAME 4 E3 fixture sources (byte-faithful
 * minerMessages), differing ONLY in body.response_format:
 *   - baseline    : none (current production behavior — extractJson + one
 *                   corrective JSON-only retry, ported from llm.ts chatJson)
 *   - json_object : {type:"json_object"}
 *   - json_schema : {type:"json_schema", json_schema:{name:"mining_result",
 *                   strict:true, schema:E7_MINER_SCHEMA}}
 * plus a cheap acceptance matrix (1 tiny call each) probing
 * [kimi-k2.5, qwen3.7-plus, qwen3.6-plus] x [json_object, json_schema], and —
 * only when the json_schema arm is accepted — a blind position-swapped judge
 * (judge.mjs) of json_schema vs baseline outputs, same criteria as E3.
 */
import { performance } from "node:perf_hooks";
import { chat, extractJson } from "./openai.mjs";
import { judgePair } from "./judge.mjs";
import { latencyStats, mdTable } from "./report.mjs";
import { COSTS, cfg } from "./experiments.mjs";
import { loadTasks, loadRuns, loadMemory, minerMessages } from "./prompts.mjs";

/**
 * The E3 mining JSON schema, copied verbatim from experiments.mjs MINER_SCHEMA
 * (keep in sync) — the exact schema the local lane already uses, so the remote
 * arm is measured against the identical contract.
 */
export const E7_MINER_SCHEMA = {
        type: "object",
        properties: {
                diagnosis: { type: "string" },
                proposal: { type: "string" },
                patchLines: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 6 },
                targetTier: { type: "string", enum: ["project", "local"] },
        },
        required: ["diagnosis", "proposal", "patchLines", "targetTier"],
};

/** The three arms' response_format values (null = plain completion). */
export const E7_ARMS = {
        baseline: null,
        json_object: { type: "json_object" },
        json_schema: {
                type: "json_schema",
                json_schema: { name: "mining_result", strict: true, schema: E7_MINER_SCHEMA },
        },
};

// Port of llm.ts chatJson's corrective-retry pieces (keep in sync with
// pi-repo/packages/self-learning/src/llm.ts) so the baseline arm replays the
// production client exactly, and the other arms differ ONLY by response_format.
const JSON_ONLY_NUDGE =
        "Respond with ONLY a valid JSON object — no prose before or after it, no code fences, no explanation. Output the complete object.";

function withJsonOnlyNudge(messages) {
        if (messages[0]?.role === "system") {
                return [{ role: "system", content: `${messages[0].content}\n\n${JSON_ONLY_NUDGE}` }, ...messages.slice(1)];
        }
        return [{ role: "system", content: JSON_ONLY_NUDGE }, ...messages];
}

/** completionTexts port: visible content first, then reasoning_content. */
function completionTexts(res) {
        // openai.mjs chat() returns {content, reasoning} already split
        const texts = [];
        if (typeof res.content === "string" && res.content.length > 0) texts.push(res.content);
        if (typeof res.reasoning === "string" && res.reasoning.length > 0) texts.push(res.reasoning);
        return texts;
}

/** First successful extractJson over the candidate texts, else {ok:false}. */
function jsonFromTexts(texts) {
        let error = "llm: empty completion";
        for (const text of texts) {
                // openai.mjs extractJson is non-throwing: {ok:true,value} | {ok:false,error}
                const r = extractJson(text);
                if (r.ok) return { ok: true, value: r.value };
                error = String(r.error ?? error);
        }
        return { ok: false, error };
}

function costOf(model, promptTokens, completionTokens) {
        const c = COSTS[model];
        if (!c || !promptTokens) return 0;
        return (promptTokens / 1e6) * c.in + ((completionTokens ?? 0) / 1e6) * c.out;
}

/** Pull {httpStatus, errorSnippet} out of an openai.mjs chat() error string. */
function httpErrorOf(err) {
        const msg = String(err ?? "");
        const m = /^HTTP (\d+):([\s\S]*)$/.exec(msg);
        if (m) return { httpStatus: Number(m[1]), errorSnippet: m[2].slice(0, 300) };
        return { httpStatus: null, errorSnippet: msg.slice(0, 300) };
}

/**
 * One arm call: plain chat completion + the production extractJson/single
 * corrective-retry client behavior. Returns per-call metrics + the parsed value.
 */
async function armCall({ baseUrl, model, messages, responseFormat }) {
        const callOnce = (msgs) =>
                chat({
                        baseUrl,
                        model,
                        messages: msgs,
                        maxTokens: 1500,
                        temperature: 0.1, // e3's remote-arm sampling
                        extra: responseFormat ? { response_format: responseFormat } : undefined,
                });

        const calls = [];
        let first = await callOnce(messages);
        calls.push(first);
        if (!first.ok) {
                const { httpStatus, errorSnippet } = httpErrorOf(first.error);
                return { httpOk: false, httpStatus, errorSnippet, calls: 1, latencyMs: first.latencyMs, texts: [], parsed: { ok: false, error: first.error } };
        }
        let parsed = jsonFromTexts(completionTexts(first));
        if (parsed.ok) {
                return { httpOk: true, httpStatus: null, errorSnippet: null, calls: 1, latencyMs: first.latencyMs, texts: completionTexts(first), parsed, res: first, allCalls: calls };
        }

        // ONE corrective retry with the JSON-only nudge (same response_format).
        const retry = await callOnce(withJsonOnlyNudge(messages));
        calls.push(retry);
        if (!retry.ok) {
                const { httpStatus, errorSnippet } = httpErrorOf(retry.error);
                return { httpOk: false, httpStatus, errorSnippet, calls: 2, latencyMs: (first.latencyMs ?? 0) + (retry.latencyMs ?? 0), texts: completionTexts(first), parsed: { ok: false, error: retry.error } };
        }
        parsed = jsonFromTexts(completionTexts(retry));
        return { httpOk: true, httpStatus: null, errorSnippet: null, calls: 2, latencyMs: (first.latencyMs ?? 0) + (retry.latencyMs ?? 0), texts: completionTexts(retry), parsed, res: retry, allCalls: calls, retried: true };
}

/**
 * E7 — remote-lane response_format for the failure miner (H9).
 * Three arms over the E3 failed-run fixtures + acceptance matrix + blind judge.
 */
export async function e7ResponseFormat({ runLimit = 4 } = {}) {
        const { bridgeUrl, remoteModel, judgeModel } = cfg();
        const tasks = loadTasks();
        const runs = loadRuns().filter((r) => r.status === "failed" && Array.isArray(r.transcript) && r.transcript.length > 0);
        const mem = loadMemory();
        const memoryTiers = {
                policy: tierText(mem, "policy"),
                project: tierText(mem, "project"),
                user: tierText(mem, "user"),
                local: tierText(mem, "local"),
        };

        // ---- acceptance matrix (cheap side-probes, 1 tiny call each) -----------
        const acceptanceMatrix = [];
        for (const model of [remoteModel, "qwen3.7-plus", "qwen3.6-plus"]) {
                for (const [rfKey, rf] of Object.entries({ json_object: E7_ARMS.json_object, json_schema: E7_ARMS.json_schema })) {
                        const probe = await probeAcceptance(bridgeUrl, model, rfKey, rf);
                        acceptanceMatrix.push(probe);
                        console.log(`[e7] accept ${model} ${rfKey}: ${probe.accepted ? `OK (${probe.latencyMs}ms)` : `REJECTED http ${probe.httpStatus}`}`);
                }
        }

        // ---- the three arms over the same fixture sources -----------------------
        const rows = [];
        for (const run of runs.slice(0, runLimit)) {
                const task = tasks.get(run.task_id);
                if (!task) continue;
                const messages = minerMessages(task, run, memoryTiers);

                const armRows = {};
                for (const [arm, rf] of Object.entries(E7_ARMS)) {
                        const out = await armCall({ baseUrl: bridgeUrl, model: remoteModel, messages, responseFormat: rf });
                        const val = out.parsed.ok ? out.parsed.value : null;
                        // e3's patch-line handling: keep string, non-empty lines
                        const patchLines = Array.isArray(val?.patchLines) ? val.patchLines.filter((l) => typeof l === "string" && l.trim()) : [];
                        // spec check (MINER_SYSTEM contract + e3's validator line): 1..6 lines, each <=200 chars
                        const patchSpecOk = out.parsed.ok && patchLines.length > 0 && patchLines.length <= 6 && patchLines.every((l) => l.length <= 200);
                        // the full harness-acceptance validator e3 uses (harness.ts post-validation)
                        const validatorPass =
                                patchSpecOk &&
                                typeof val.diagnosis === "string" &&
                                val.diagnosis.length > 0 &&
                                (val.targetTier === "project" || val.targetTier === "local");

                        const usage = (out.allCalls ?? []).reduce(
                                (a, c) => ({
                                        promptTokens: (a.promptTokens ?? 0) + (c.usage?.promptTokens ?? 0),
                                        completionTokens: (a.completionTokens ?? 0) + (c.usage?.completionTokens ?? 0),
                                }),
                                { promptTokens: 0, completionTokens: 0 },
                        );
                        if (!out.allCalls) Object.assign(usage, { promptTokens: null, completionTokens: null });

                        armRows[arm] = {
                                arm,
                                taskId: task.id,
                                runId: String(run.id).slice(0, 8),
                                httpOk: out.httpOk,
                                httpStatus: out.httpStatus ?? null,
                                errorSnippet: out.errorSnippet ?? null,
                                calls: out.calls,
                                jsonOk: out.parsed.ok,
                                patchSpecOk,
                                validatorPass,
                                latencyMs: out.latencyMs,
                                promptTokens: usage.promptTokens,
                                completionTokens: usage.completionTokens,
                                costUsd: (out.allCalls ?? []).reduce((a, c) => a + costOf(remoteModel, c.usage?.promptTokens, c.usage?.completionTokens), 0),
                                patchLineCount: patchLines.length,
                                maxPatchLineLen: patchLines.length ? Math.max(...patchLines.map((l) => l.length)) : 0,
                                targetTier: val?.targetTier ?? null,
                                diagnosis: (val?.diagnosis ?? "").slice(0, 160),
                                // for the judge (kept out of the saved row below)
                                _val: val,
                        };
                        console.log(
                                `[e7] ${task.id} ${String(run.id).slice(0, 8)} ${arm}: httpOk=${out.httpOk} jsonOk=${out.parsed.ok} specOk=${patchSpecOk} validator=${validatorPass} maxLen=${armRows[arm].maxPatchLineLen}`,
                        );
                }
                rows.push({ taskId: task.id, runId: String(run.id).slice(0, 8), arms: armRows });
        }

        // ---- blind judge (only when the json_schema arm was accepted) -----------
        const schemaAccepted = rows.length > 0 && rows.every((r) => r.arms.json_schema.httpOk);
        let judgeSkippedReason = null;
        if (!schemaAccepted) {
                judgeSkippedReason = "json_schema arm not accepted by the upstream (httpOk<1.0) — judge skipped per design";
        }
        for (const row of rows) {
                row.judged = null;
                if (!schemaAccepted) continue;
                const base = row.arms.baseline._val;
                const schema = row.arms.json_schema._val;
                if (!(base && schema)) continue;
                const judged = await judgePair({
                        bridgeUrl,
                        judgeModel,
                        system: "You are an expert on self-improving coding agents. Judge which failure-mining result is better.",
                        question:
                                "Criteria: (1) root-cause correctness (does the diagnosis match the failure?), (2) actionability of the proposed memory rule for future runs, (3) appropriate tier choice, (4) rule hygiene (imperative, concise, <=200 chars/line).",
                        outputA: JSON.stringify({ diagnosis: base.diagnosis, proposal: base.proposal, patchLines: base.patchLines, targetTier: base.targetTier }),
                        outputB: JSON.stringify({ diagnosis: schema.diagnosis, proposal: schema.proposal, patchLines: schema.patchLines, targetTier: schema.targetTier }),
                });
                row.judged = {
                        winner: judged.winner, // "A"=baseline, "B"=json_schema, "tie" (incl. position flips)
                        consistent: judged.consistent,
                        aScore: judged.aScore,
                        bScore: judged.bScore,
                        reason: judged.reason,
                };
                console.log(`[e7] judge ${row.taskId} ${row.runId}: ${judged.winner}${judged.consistent ? "" : " (flip->tie)"}`);
        }

        // ---- aggregate -----------------------------------------------------------
        const armAgg = {};
        for (const arm of Object.keys(E7_ARMS)) {
                const xs = rows.map((r) => r.arms[arm]);
                const n = xs.length || 1;
                const httpOkN = xs.filter((x) => x.httpOk).length;
                armAgg[arm] = {
                        n: xs.length,
                        httpOk: httpOkN / n,
                        jsonOk: xs.filter((x) => x.jsonOk).length / n,
                        patchSpecOk: xs.filter((x) => x.patchSpecOk).length / n,
                        validatorPass: xs.filter((x) => x.validatorPass).length / n,
                        correctiveRetries: xs.filter((x) => x.calls > 1).length,
                        latency: latencyStats(xs),
                        costUsd: round4(xs.reduce((a, x) => a + (x.costUsd ?? 0), 0)),
                        avgPromptTokens: avg(xs.map((x) => x.promptTokens)),
                        avgCompletionTokens: avg(xs.map((x) => x.completionTokens)),
                        maxPatchLineLen: xs.reduce((a, x) => Math.max(a, x.maxPatchLineLen ?? 0), 0),
                };
        }

        const judgedRows = rows.filter((r) => r.judged);
        const judgeTally = {
                judged: judgedRows.length,
                baselineWins: judgedRows.filter((r) => r.judged.winner === "A").length,
                jsonSchemaWins: judgedRows.filter((r) => r.judged.winner === "B").length,
                ties: judgedRows.filter((r) => r.judged.winner === "tie").length,
                positionConsistent: judgedRows.filter((r) => r.judged.consistent).length,
                skipped: judgeSkippedReason,
        };

        // ---- H9 thresholds --------------------------------------------------------
        const thresholds = {
                jsonSchemaAccepted: armAgg.json_schema.httpOk === 1.0,
                patchSpecOkIsPerfect: armAgg.json_schema.patchSpecOk === 1.0,
                patchSpecOkBeatsBaseline: armAgg.json_schema.patchSpecOk > armAgg.baseline.patchSpecOk,
                validatorPassAtLeastBaseline: armAgg.json_schema.validatorPass >= armAgg.baseline.validatorPass,
                judgeWinPlusTieGeqLosses: judgeTally.jsonSchemaWins + judgeTally.ties >= judgeTally.baselineWins,
        };
        const verdict = Object.values(thresholds).every(Boolean) ? "verified" : "refuted";

        return {
                summary: {
                        experiment: "E7-response-format",
                        hypothesis: "H9",
                        remoteModel,
                        judgeModel,
                        runs: rows.length,
                        arms: armAgg,
                        acceptanceMatrix,
                        judgeTally,
                        thresholds,
                        verdict,
                },
                // rows mirror e3's shape; strip the judge-facing _val internals
                rows: rows.map((r) => ({
                        taskId: r.taskId,
                        runId: r.runId,
                        arms: Object.fromEntries(Object.entries(r.arms).map(([k, v]) => [k, omit(v, ["_val"])])),
                        judged: r.judged,
                })),
        };
}

// ---------------------------------------------------------------- acceptance probe

/** One tiny maxTokens-64 probe: does the upstream ACCEPT this response_format? */
async function probeAcceptance(bridgeUrl, model, rfKey, responseFormat) {
        const body = {
                model,
                messages: [{ role: "user", content: 'Return {"ok":true} as JSON' }],
                max_tokens: 64,
                stream: false,
                thinking: { type: "disabled" }, // production llm.ts always sends this
                response_format: responseFormat,
        };
        const t0 = performance.now();
        try {
                const res = await fetch(`${bridgeUrl}/v1/chat/completions`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(120_000),
                });
                const latencyMs = Math.round(performance.now() - t0);
                if (!res.ok) {
                        const text = await res.text().catch(() => "");
                        return { model, responseFormat: rfKey, accepted: false, httpStatus: res.status, errorSnippet: text.slice(0, 300), latencyMs };
                }
                const j = await res.json();
                const content = typeof j.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content : "";
                let jsonOk = false;
                try {
                        JSON.parse(content);
                        jsonOk = true;
                } catch {
                        /* not bare JSON — could be fenced or prose; still accepted */
                }
                return {
                        model,
                        responseFormat: rfKey,
                        accepted: true,
                        httpStatus: res.status,
                        contentSnippet: content.slice(0, 120),
                        jsonOk,
                        promptTokens: j.usage?.prompt_tokens ?? null,
                        completionTokens: j.usage?.completion_tokens ?? null,
                        latencyMs,
                };
        } catch (err) {
                return { model, responseFormat: rfKey, accepted: false, httpStatus: null, errorSnippet: String(err?.message ?? err).slice(0, 300), latencyMs: Math.round(performance.now() - t0) };
        }
}

// ---------------------------------------------------------------- render

/** Receipt rendering (kept here so the runner.mjs diff stays surgical). */
export function renderE7(r, log = console.log) {
        const s = r.summary;
        log("\n=== E7 remote-lane response_format (H9) ===");
        log(
                mdTable(
                        Object.entries(s.arms).map(([arm, a]) => ({
                                arm,
                                httpOk: a.httpOk,
                                jsonOk: a.jsonOk,
                                patchSpecOk: a.patchSpecOk,
                                validator: a.validatorPass,
                                p50ms: a.latency?.p50 ?? "—",
                                maxLineLen: a.maxPatchLineLen,
                                cost: `$${a.costUsd}`,
                        })),
                ),
        );
        log("acceptance matrix:");
        log(
                mdTable(
                        s.acceptanceMatrix.map((p) => ({
                                model: p.model,
                                responseFormat: p.responseFormat,
                                accepted: p.accepted,
                                http: p.httpStatus ?? "—",
                                jsonOk: p.jsonOk ?? "—",
                                error: p.errorSnippet ? String(p.errorSnippet).slice(0, 60) : "",
                        })),
                ),
        );
        const t = s.judgeTally;
        log(`judge: baselineWins=${t.baselineWins} jsonSchemaWins=${t.jsonSchemaWins} ties=${t.ties} (consistent ${t.positionConsistent}/${t.judged})${t.skipped ? ` — ${t.skipped}` : ""}`);
        log(`H9 thresholds: ${JSON.stringify(s.thresholds)} -> ${s.verdict}`);
}

// ---------------------------------------------------------------- helpers

function tierText(memExport, tier) {
        const t = memExport?.tiers?.[tier];
        if (!t) return "";
        if (typeof t === "string") return t;
        return t.content ?? "";
}
function omit(obj, keys) {
        const o = {};
        for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) o[k] = v;
        return o;
}
function avg(xs) {
        const v = xs.filter((x) => typeof x === "number");
        return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
function round4(x) {
        return Math.round(x * 10000) / 10000;
}
