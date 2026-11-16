/**
 * Unit tests for the binary-default first-run copy in src/cli.ts:
 *
 *   firstRunGateLines    the offer/decline/wizard-failed copy; "keep the
 *                        bundled bridge" is only offered when one answers
 *   firstRunBannerLines  the first-run banner never claims a bundled bridge
 *                        that is not running (the standalone binary ships none)
 */
import "./_env.ts"; // MUST be the first import
import { describe, expect, test } from "bun:test";
import { firstRunBannerLines, firstRunGateLines } from "../src/cli.ts";

describe("first-run gate copy (binary-default install)", () => {
        test("a healthy bridge makes Enter KEEP it (the two-beat first run)", () => {
                const up = firstRunGateLines(true);
                expect(up.question).toContain("the bundled llm-bridge is answering");
                expect(up.question).toContain("Enter = keep the bundled bridge · y = guided setup");
                expect(up.defaultYes).toBe(false); // Enter keeps the working default
                expect(up.declined[0]).toContain("the bundled bridge is wired for now");
                expect(up.wizardFailed).toContain("Continuing with the bundled bridge");
        });

        test("a bridge-less install keeps Enter = setup (declining leaves nothing)", () => {
                const down = firstRunGateLines(false);
                expect(down.question).toContain("no provider connected yet");
                expect(down.question).toContain("Enter = guided setup");
                expect(down.question).not.toContain("bundled bridge is answering");
                expect(down.defaultYes).toBe(true); // Enter opens setup
                expect(down.declined[0]).toContain("no provider is connected yet");
                expect(down.wizardFailed).not.toContain("bundled bridge");
        });

        test("keeps the one-offer and recovery-command contract", () => {
                for (const gate of [firstRunGateLines(true), firstRunGateLines(false)]) {
                        expect(gate.question).toContain("First run — ");
                        expect(gate.question).toContain("(Agnes, OpenAI, OpenRouter, Anthropic, Dashscope, DeepSeek, local…)");
                        expect(gate.declined[1]).toContain(
                                "unown setup · unown providers add · unown providers list",
                        );
                }
        });
});

describe("first-run banner copy (binary-default install)", () => {
        test("never claims a bundled bridge that is not answering", () => {
                const down = firstRunBannerLines({
                        pid: "zai-bridge",
                        mid: "kimi-k2.5",
                        loopback: true,
                        bridgeUp: false,
                }).join("\n");
                expect(down).toContain("no model endpoint is answering");
                expect(down).toContain("bun run agent:start");
                expect(down).not.toContain("using the bundled llm-bridge");
        });

        test("names the bridge when it is up and the provider directly otherwise", () => {
                const up = firstRunBannerLines({
                        pid: "zai-bridge",
                        mid: "kimi-k2.5",
                        loopback: true,
                        bridgeUp: true,
                }).join("\n");
                expect(up).toContain("using the bundled llm-bridge (zai-bridge/kimi-k2.5)");

                const direct = firstRunBannerLines({
                        pid: "openai",
                        mid: "gpt-4o",
                        loopback: false,
                        bridgeUp: false,
                }).join("\n");
                expect(direct).toContain("using openai (openai/gpt-4o)");
                expect(direct).not.toContain("no model endpoint is answering");
        });
});
