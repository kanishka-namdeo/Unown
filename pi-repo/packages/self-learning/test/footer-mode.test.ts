/**
 * footer-mode.test.ts — the footer quiet round's pure cores:
 * the UNOWN_FOOTER_CLASSIC kill switch (self-learning side) and the engine
 * chip's attention gate (which engine states earn the footer's attention row).
 */
import { describe, expect, test } from "bun:test";
import { engineFooterAttention, engineFooterText, type EngineStatusInfo } from "../src/engine-status.ts";
import { FOOTER_PRIORITY, footerClassicMode } from "../src/footer-mode.ts";

function info(state: EngineStatusInfo["state"], extra: Partial<EngineStatusInfo> = {}): EngineStatusInfo {
        return {
                state,
                since: 0,
                lastProbeAt: 0,
                queuedNotes: 0,
                ...extra,
        } as EngineStatusInfo;
}

describe("footerClassicMode (the kill switch)", () => {
        test("off by default and for any value but 1", () => {
                expect(footerClassicMode({})).toBe(false);
                expect(footerClassicMode({ UNOWN_FOOTER_CLASSIC: "0" })).toBe(false);
                expect(footerClassicMode({ UNOWN_FOOTER_CLASSIC: "yes" })).toBe(false);
        });
        test("UNOWN_FOOTER_CLASSIC=1 restores the classic footer", () => {
                expect(footerClassicMode({ UNOWN_FOOTER_CLASSIC: "1" })).toBe(true);
        });
        test("priority ladder: critical > active > default", () => {
                expect(FOOTER_PRIORITY.critical).toBeGreaterThan(FOOTER_PRIORITY.active);
                expect(FOOTER_PRIORITY.active).toBeGreaterThan(FOOTER_PRIORITY.default);
                expect(FOOTER_PRIORITY.default).toBe(0);
        });
});

describe("engineFooterAttention (which states earn the attention row)", () => {
        test("a plain healthy up state does NOT (healthy states are silent)", () => {
                expect(engineFooterAttention(info("up"))).toBe(false);
                expect(engineFooterAttention(info("up", { activeJob: "dream" }))).toBe(false);
        });
        test("every non-up state does", () => {
                for (const state of ["down", "blocked", "paused", "starting", "unknown"] as const) {
                        expect(engineFooterAttention(info(state))).toBe(true);
                }
        });
        test("build skew is a standing condition — it paints even while up (M8 parity)", () => {
                for (const verdict of ["old-build", "stale", "ancient"] as const) {
                        expect(
                                engineFooterAttention(info("up", { buildVerdict: { verdict } as EngineStatusInfo["buildVerdict"] })),
                        ).toBe(true);
                }
                expect(engineFooterAttention(info("up", { buildVerdict: { verdict: "ahead" } as EngineStatusInfo["buildVerdict"] }))).toBe(false);
        });
        test("engineFooterText still renders every state's text (classic, /engine and the pinned copy tests)", () => {
                expect(engineFooterText(info("up"))).toBe("memory: up");
                expect(engineFooterText(info("down", { queuedNotes: 2 }))).toBe("memory: down · 2 queued");
                expect(engineFooterText(info("paused"))).toBe("memory: paused · /engine");
                expect(engineFooterText(info("blocked"))).toBe("memory: blocked · no answer");
        });
});
