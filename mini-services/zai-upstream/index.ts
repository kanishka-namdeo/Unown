/**
 * zai-upstream — OpenAI-compatible shim over z-ai-web-dev-sdk (the sandbox's
 * built-in LLM gateway). Gives the llm-bridge a real model endpoint without
 * any external provider key.
 *
 * Endpoints:
 *   GET  /v1/models            → model list (satisfies the bridge health probe)
 *   POST /v1/chat/completions  → JSON or SSE streaming; tools/tool_choice and
 *                                tool-role messages pass through verbatim.
 *
 * The SDK's gateway ignores the requested model id (it always serves its
 * default GLM model), so any model id the bridge routes here works.
 *
 * Environment:
 *   ZAI_UPSTREAM_PORT   listen port (3032)
 *   ZAI_UPSTREAM_MODEL  advertised model id (glm-4-plus)
 */
import ZAI from "z-ai-web-dev-sdk";

const PORT = Number(process.env.ZAI_UPSTREAM_PORT ?? 3032);
const MODEL_ID = process.env.ZAI_UPSTREAM_MODEL ?? "glm-4-plus";

const zai = await (ZAI.default ?? ZAI).create();

const server = Bun.serve({
        port: PORT,
        idleTimeout: 255, // LLM calls are slow; keep connections open (max 255s)
        async fetch(req) {
                const url = new URL(req.url);

                if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
                        return Response.json({
                                object: "list",
                                data: [{ id: MODEL_ID, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "zai-upstream" }],
                        });
                }

                if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
                        try {
                                const body = await req.json();
                                // Forward only the params the gateway is known to accept.
                                const sdkBody: any = {
                                        messages: body.messages ?? [],
                                };
                                if (Array.isArray(body.tools) && body.tools.length > 0) sdkBody.tools = body.tools;
                                if (body.tool_choice !== undefined) sdkBody.tool_choice = body.tool_choice;
                                if (body.temperature !== undefined) sdkBody.temperature = body.temperature;
                                if (body.top_p !== undefined) sdkBody.top_p = body.top_p;
                                if (body.stop !== undefined) sdkBody.stop = body.stop;
                                if (body.max_tokens !== undefined) sdkBody.max_tokens = body.max_tokens;
                                if (body.stream === true) sdkBody.stream = true;

                                const res = await zai.chat.completions.create(sdkBody);

                                if (body.stream === true) {
                                        // The SDK returns a ReadableStream that already carries
                                        // OpenAI-style SSE frames — pipe it through verbatim.
                                        return new Response(res as any, {
                                                headers: {
                                                        "Content-Type": "text/event-stream",
                                                        "Cache-Control": "no-cache",
                                                        Connection: "keep-alive",
                                                },
                                        });
                                }

                                // Non-streaming: normalize the completion into the shape
                                // OpenAI clients expect (finish_reason, tool_call ids, model).
                                const completion: any = res;
                                const choice = completion?.choices?.[0];
                                if (choice) {
                                        const msg = choice.message ?? {};
                                        if (Array.isArray(msg.tool_calls)) {
                                                msg.tool_calls = msg.tool_calls.map((tc: any, i: number) => ({
                                                        id: tc?.id ?? `call_${i}`,
                                                        type: "function" as const,
                                                        function: { name: tc?.function?.name ?? "", arguments: tc?.function?.arguments ?? "{}" },
                                                }));
                                                choice.finish_reason = choice.finish_reason ?? "tool_calls";
                                        } else {
                                                choice.finish_reason = choice.finish_reason ?? "stop";
                                        }
                                        choice.message = msg;
                                }
                                completion.model = MODEL_ID;
                                return Response.json(completion);
                        } catch (err: any) {
                                console.log(`[zai-upstream] error: ${String(err?.message ?? err).slice(0, 200)}`);
                                return Response.json(
                                        { error: { message: `zai-upstream: ${String(err?.message ?? err)}`, type: "upstream_error", code: 500 } },
                                        { status: 500 },
                                );
                        }
                }

                return Response.json({ error: { message: `Not found: ${req.method} ${url.pathname}` } }, { status: 404 });
        },
});

console.log(`[zai-upstream] listening on http://127.0.0.1:${server.port} (OpenAI-compatible shim over z-ai-web-dev-sdk; advertises ${MODEL_ID})`);
