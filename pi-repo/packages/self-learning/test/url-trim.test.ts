// Unit tests for src/url-trim.ts — the linear-time trailing-slash trim that
// replaced the eleven inline `.replace(/\/+$/, "")` call sites (the CodeQL
// js/polynomial-redos sweep, 2026-11-01: setup.ts ×2, providers-cli.ts,
// term.ts ×2, server.ts ×2, usage-cli.ts, websearch.ts, uninstall.ts ×2).
//
// Pure module — no `./_env.ts` redirect needed (no store, no fs, no env at
// module scope), unlike most of this suite's imports.
//
// The last test pins the actual contract the round was about: a hostile run
// of trailing slashes must cost one linear scan, not the regex engine's
// quadratic rescan.

import { describe, expect, test } from "bun:test";
import { trimTrailingSlashes } from "../src/url-trim.ts";

describe("trimTrailingSlashes", () => {
	test("strips every trailing slash, interior slashes untouched", () => {
		expect(trimTrailingSlashes("https://x.com/v1/")).toBe("https://x.com/v1");
		expect(trimTrailingSlashes("https://x.com/v1///")).toBe("https://x.com/v1");
		expect(trimTrailingSlashes("https://x.com//v1//")).toBe("https://x.com//v1");
		expect(trimTrailingSlashes("http://127.0.0.1:3031")).toBe("http://127.0.0.1:3031");
	});

	test("degenerate inputs stay degenerate (byte-identical to the old regex)", () => {
		expect(trimTrailingSlashes("")).toBe("");
		expect(trimTrailingSlashes("/")).toBe("");
		expect(trimTrailingSlashes("///")).toBe("");
	});

	test("no trailing slash returns the same string object", () => {
		const s = "http://127.0.0.1:3031";
		expect(trimTrailingSlashes(s)).toBe(s);
	});

	test("the uninstall.ts normalizers keep their old results", () => {
		// samePath/pathInside pipeline: backslashes to slashes, then trim
		const norm = (s: string) => trimTrailingSlashes(s.replace(/\\/g, "/"));
		expect(norm("C:\\Users\\me\\.local\\bin\\")).toBe("C:/Users/me/.local/bin");
		expect(norm("/home/me/unown/")).toBe("/home/me/unown");
		expect(norm("/")).toBe("");
	});

	test("a hostile slash-run stays linear-fast (the polynomial-redos contract)", () => {
		const hostile = `https://x.com/v1${"/".repeat(100_000)}`;
		const start = performance.now();
		expect(trimTrailingSlashes(hostile)).toBe("https://x.com/v1");
		// generous bound so it never flakes on a slow runner: the old regex's
		// quadratic rescan blows far past it at this input size
		expect(performance.now() - start).toBeLessThan(100);
	});
});
