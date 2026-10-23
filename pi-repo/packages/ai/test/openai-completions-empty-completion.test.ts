import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel, streamSimple } from "../src/compat.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";

// Empty-completion guard (2026-10-23): a 200 stream that carries ZERO content
// blocks (no text, no tool call, no thinking) but a clean finish_reason "stop"
// is an upstream fault, not a valid empty answer. Measured live: an Agnes AI
// flash endpoint under concurrent load returns empty 200 streams (usage 0/0)
// after 48-81s — pre-fix, pi-ai minted a VALID empty assistant turn from that
// shape, print mode wrote nothing, and the process exited 0.
//
// The guard throws inside the stream parser, which lands in the catch block:
// stopReason becomes "error" with a message matching the retryable pattern
// ("empty completion" in utils/retry.ts) so retryAssistantCall restarts the
// turn instead of accepting the silent empty response.

const mockState = vi.hoisted(() => ({
        frames: [] as Array<Record<string, unknown>>,
}));

vi.mock("openai", () => {
        class FakeOpenAI {
                chat = {
                        completions: {
                                create: () => {
                                        const stream = {
                                                async *[Symbol.asyncIterator]() {
                                                        for (const frame of mockState.frames) yield frame;
                                                },
                                        };
                                        const promise = Promise.resolve(stream) as Promise<typeof stream> & {
                                                withResponse: () => Promise<{
                                                        data: typeof stream;
                                                        response: { status: number; headers: Headers };
                                                }>;
                                        };
                                        promise.withResponse = async () => ({
                                                data: stream,
                                                response: { status: 200, headers: new Headers() },
                                        });
                                        return promise;
                                },
                        },
                };
        }

        return { default: FakeOpenAI };
});

function makeModel() {
        const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
        return { ...baseModel, api: "openai-completions" } as const;
}

const userMsg = [{ role: "user", content: "hi", timestamp: Date.now() }];

describe("openai-completions degenerate (empty) completion guard", () => {
        beforeEach(() => {
                mockState.frames = [];
        });

        it("finish_reason stop with ZERO content blocks -> error stopReason with the retryable empty-completion message", async () => {
                mockState.frames = [
                        { choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
                        { choices: [{ delta: {}, finish_reason: "stop" }] },
                        { choices: [{ delta: {}, finish_reason: null }], usage: { prompt_tokens: 9, completion_tokens: 0 } },
                ];
                const message = await streamSimple(makeModel(), { messages: userMsg as any }, { apiKey: "test" }).result();
                expect(message.stopReason).toBe("error");
                expect(message.errorMessage).toMatch(/empty completion/i);
                // And the classifier that drives retryAssistantCall must agree it is transient.
                expect(isRetryableAssistantError(message as any)).toBe(true);
        });

        it("usage-only frames never count as content (pt>0 ct=0 still degenerate)", async () => {
                mockState.frames = [
                        { choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
                        { choices: [{ delta: {}, finish_reason: "stop" }] },
                        { choices: [{ delta: {}, finish_reason: null }], usage: { prompt_tokens: 9200, completion_tokens: 0 } },
                ];
                const message = await streamSimple(makeModel(), { messages: userMsg as any }, { apiKey: "test" }).result();
                expect(message.stopReason).toBe("error");
                expect(message.errorMessage).toMatch(/empty completion/i);
        });

        it("a stream WITH text content passes through untouched", async () => {
                mockState.frames = [
                        { choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
                        { choices: [{ delta: { content: "hello there" }, finish_reason: null }] },
                        { choices: [{ delta: {}, finish_reason: "stop" }] },
                ];
                const message = await streamSimple(makeModel(), { messages: userMsg as any }, { apiKey: "test" }).result();
                expect(message.stopReason).toBe("stop");
                expect(message.content.some((b: any) => b.type === "text" && b.text === "hello there")).toBe(true);
        });

        it("a tool-call-only stream is NOT degenerate (tool calls are work product)", async () => {
                mockState.frames = [
                        {
                                choices: [
                                        {
                                                delta: {
                                                        tool_calls: [{ index: 0, id: "t1", function: { name: "noop", arguments: "{}" } }],
                                                },
                                                finish_reason: null,
                                        },
                                ],
                        },
                        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
                ];
                const message = await streamSimple(makeModel(), { messages: userMsg as any }, { apiKey: "test" }).result();
                expect(message.stopReason).not.toBe("error");
                expect(message.content.some((b: any) => b.type === "toolCall")).toBe(true);
        });

        it("a reasoning-only stream is NOT degenerate (thinking is work product)", async () => {
                mockState.frames = [
                        { choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
                        { choices: [{ delta: { reasoning_content: "thinking hard" }, finish_reason: null }] },
                        { choices: [{ delta: {}, finish_reason: "stop" }] },
                ];
                const message = await streamSimple(makeModel(), { messages: userMsg as any }, { apiKey: "test" }).result();
                expect(message.stopReason).not.toBe("error");
                expect(message.content.some((b: any) => b.type === "thinking")).toBe(true);
        });

        it("finish_reason length with no content is NOT flagged (deterministic budget outcome)", async () => {
                mockState.frames = [
                        { choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
                        { choices: [{ delta: {}, finish_reason: "length" }] },
                ];
                const message = await streamSimple(makeModel(), { messages: userMsg as any }, { apiKey: "test" }).result();
                expect(message.stopReason).toBe("length");
        });
});
