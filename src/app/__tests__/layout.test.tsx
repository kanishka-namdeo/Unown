// layout.test.tsx — the root layout's OG-image contract, drift-pinned.
//
// The layout itself renders only inside Next's runtime (next/font/google
// exports are compiler-generated — a direct metadata import is a SyntaxError
// under bun), so the honest pin is the source text plus the asset files:
// the OG image set is D7's flip from the retired web dashboard's screenshot
// to the TUI still, and a dead path here would ship a broken social card
// with every green gate behind it (the a11y/budget specs never render the
// <head>; Vercel serves whatever the metadata says).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LAYOUT = readFileSync(join(import.meta.dir, "..", "layout.tsx"), "utf8");

describe("root layout metadata (drift-pinned)", () => {
	test("the OG images are the hero + the TUI dashboard still (D7 flip), not the dead dash PNG", () => {
		// The exact images array — a stale path (the retired
		// /landing/dash-overview.png) fails here instead of 404-ing in
		// every social card embed.
		expect(LAYOUT).toContain(
			'images: ["/landing/landing-hero.png", "/landing/tui/dashboard/stills/01-overview.png"]',
		);
		expect(LAYOUT).not.toContain("dash-overview");
	});

	test("every OG asset exists in public/", () => {
		for (const img of ["/landing/landing-hero.png", "/landing/tui/dashboard/stills/01-overview.png"]) {
			const p = join(import.meta.dir, "..", "..", "..", "public", img.replace(/^\//, ""));
			expect(existsSync(p), `${img} must exist in public/`).toBe(true);
		}
	});
});
