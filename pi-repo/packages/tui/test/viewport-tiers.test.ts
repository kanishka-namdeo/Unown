import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
        isCompactViewport,
        isTerminalTooSmall,
        overlayWidthFor,
        viewportTier,
} from "../src/viewport-tiers.ts";

describe("viewportTier", () => {
        it("maps widths to the four tiers at their boundaries", () => {
                assert.equal(viewportTier(0), "narrow");
                assert.equal(viewportTier(39), "narrow");
                assert.equal(viewportTier(79), "narrow");
                assert.equal(viewportTier(80), "regular");
                assert.equal(viewportTier(109), "regular");
                assert.equal(viewportTier(110), "wide");
                assert.equal(viewportTier(143), "wide");
                assert.equal(viewportTier(144), "ultra");
                assert.equal(viewportTier(500), "ultra");
        });

        it("identifies the compact tier", () => {
                assert.equal(isCompactViewport(79), true);
                assert.equal(isCompactViewport(80), false);
        });
});

describe("isTerminalTooSmall", () => {
        it("gates only below the minimum geometry", () => {
                assert.equal(isTerminalTooSmall(47, 24), true);
                assert.equal(isTerminalTooSmall(48, 24), false);
                assert.equal(isTerminalTooSmall(80, 15), true);
                assert.equal(isTerminalTooSmall(80, 16), false);
        });
});

describe("overlayWidthFor", () => {
        it("scales with the terminal width (86%, clamped to [40, 96])", () => {
                // narrower than the floor: the terminal itself is the limit
                assert.equal(overlayWidthFor(30), 30);
                assert.equal(overlayWidthFor(40), 40); // 86% = 34 -> clamp floor 40
                // proportional band: 86% of the width, rounded
                assert.equal(overlayWidthFor(56), 48); // 86% of 56 = 48.16
                assert.equal(overlayWidthFor(72), 62); // 86% of 72 = 61.92
                assert.equal(overlayWidthFor(80), 69); // 86% of 80 = 68.8
                assert.equal(overlayWidthFor(96), 83); // 86% of 96 = 82.56
                // wide terminals: the clamp ceiling holds overlays at 96
                assert.equal(overlayWidthFor(120), 96); // 86% = 103.2 -> ceiling
                assert.equal(overlayWidthFor(200), 96);
        });

        it("honors a caller's preferred width when it fits", () => {
                assert.equal(overlayWidthFor(100, 60), 60);
                assert.equal(overlayWidthFor(100, 140), 100); // never wider than the terminal
                assert.equal(overlayWidthFor(50, 80), 50);
        });

        it("never returns zero or negative", () => {
                assert.equal(overlayWidthFor(1) >= 1, true);
                assert.equal(overlayWidthFor(0, 10) >= 1, true);
        });
});
