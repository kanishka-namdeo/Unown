// Unit tests for src/subagent-catalog.ts — the advertised-subagent catalog,
// delegation levels, BLOCKED protocol, and completion-guard helpers
// (pi-cciotti port).
//
// Pure module: no pi imports, no engine store, no network — these tests
// import ONLY from subagent-catalog.ts (the same hermetic posture as
// subagent-routing.test.ts). The git-touching snapshot helper is exercised
// against a real temp git repo (init + commit + mutate), mirroring how
// worktree.test.ts drives real git.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ADVERTISED_CATALOG_MAX_BYTES,
	type CatalogAgent,
	CHILD_BOUNDARY_INSTRUCTIONS,
	CLEAN_DIGEST,
	COMPLETION_GUARD_FAILURE,
	DELEGATION_SENTENCES,
	isBlockedReply,
	mutatedPaths,
	parseAgentCatalogFrontmatter,
	parseDelegationLevel,
	renderAdvertisedCatalog,
	snapshotWorkingTree,
	treeMutated,
} from "../src/subagent-catalog.ts";

// ---------------------------------------------------------------------------
// Delegation levels
// ---------------------------------------------------------------------------

describe("parseDelegationLevel", () => {
	test("accepts the four levels (case-insensitive, whitespace-tolerant)", () => {
		expect(parseDelegationLevel("never")).toBe("never");
		expect(parseDelegationLevel("RARELY")).toBe("rarely");
		expect(parseDelegationLevel(" standard ")).toBe("standard");
		expect(parseDelegationLevel("aggressive")).toBe("aggressive");
	});
	test("invalid, empty and undefined values fall back to standard (tolerant posture)", () => {
		expect(parseDelegationLevel(undefined)).toBe("standard");
		expect(parseDelegationLevel("")).toBe("standard");
		expect(parseDelegationLevel("sometimes")).toBe("standard");
		expect(parseDelegationLevel("NEVER!")).toBe("standard");
	});
	test("every level carries exactly one non-empty sentence", () => {
		for (const sentence of Object.values(DELEGATION_SENTENCES)) {
			expect(typeof sentence).toBe("string");
			expect(sentence.length).toBeGreaterThan(10);
			expect(sentence.includes(".")).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// Catalog frontmatter parsing
// ---------------------------------------------------------------------------

describe("parseAgentCatalogFrontmatter", () => {
	test("plucks all five fields, camelCase + snake_case", () => {
		const fm = parseAgentCatalogFrontmatter({
			advertise: false,
			completionGuard: true,
			fallbackModels: "qwen3.7-plus, kimi-k2.5",
			context: "summary",
			contextBrief: "Quote each decision verbatim.",
		});
		expect(fm.advertise).toBe(false);
		expect(fm.completionGuard).toBe(true);
		expect(fm.fallbackModels).toEqual(["qwen3.7-plus", "kimi-k2.5"]);
		expect(fm.context).toBe("summary");
		expect(fm.contextBrief).toBe("Quote each decision verbatim.");

		const snake = parseAgentCatalogFrontmatter({
			completion_guard: "true",
			fallback_models: ["a", "b"],
			context_brief: "x",
		});
		expect(snake.completionGuard).toBe(true);
		expect(snake.fallbackModels).toEqual(["a", "b"]);
		expect(snake.contextBrief).toBe("x");
	});
	test("string booleans parse; invalid values drop silently", () => {
		const fm = parseAgentCatalogFrontmatter({
			advertise: "false",
			completionGuard: "0",
			fallbackModels: [],
			context: "sometimes",
			contextBrief: "   ",
		});
		expect(fm.advertise).toBe(false);
		expect(fm.completionGuard).toBe(false);
		expect(fm.fallbackModels).toBeUndefined();
		expect(fm.context).toBeUndefined();
		expect(fm.contextBrief).toBeUndefined();
	});
	test("non-object input returns empty", () => {
		expect(parseAgentCatalogFrontmatter(null)).toEqual({});
		expect(parseAgentCatalogFrontmatter("nope")).toEqual({});
		expect(parseAgentCatalogFrontmatter([1, 2])).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// renderAdvertisedCatalog
// ---------------------------------------------------------------------------

const AGENTS: CatalogAgent[] = [
	{ name: "general", description: "Full toolset subagent." },
	{ name: "explore", description: "Read-only exploration." },
	{ name: "scout", description: "Compressed recon handoff." },
	{ name: "worker", description: "Implementation with completion guard." },
	{ name: "planner", description: "Writes plan.md.", advertise: false },
];

describe("renderAdvertisedCatalog", () => {
	test("renders the XML block with policy + entries, skipping unadvertised agents", () => {
		const block = renderAdvertisedCatalog(AGENTS, "standard");
		expect(block).toBeDefined();
		expect(block!.startsWith("<advertised_subagents>")).toBe(true);
		expect(block!.endsWith("</advertised_subagents>")).toBe(true);
		expect(block!.includes("Delegation policy: " + DELEGATION_SENTENCES.standard)).toBe(true);
		expect(block!.includes("- name: general")).toBe(true);
		expect(block!.includes("- name: scout")).toBe(true);
		// planner opted out of advertising
		expect(block!.includes("- name: planner")).toBe(false);
	});
	test("never withdraws the catalog entirely; empty input yields undefined", () => {
		expect(renderAdvertisedCatalog(AGENTS, "never")).toBeUndefined();
		expect(renderAdvertisedCatalog([], "standard")).toBeUndefined();
		expect(renderAdvertisedCatalog([{ name: "x", description: "y", advertise: false }], "standard")).toBeUndefined();
	});
	test("agent-count cap: 60 small agents keep the first 24, drop 36 with a marker", () => {
		// The delegation round raised the count cap 16 → 24 (the byte budget
		// is the binding guard; see ADVERTISED_CATALOG_MAX_AGENTS' comment).
		const many: CatalogAgent[] = Array.from({ length: 60 }, (_, i) => ({
			name: `agent-${String(i).padStart(2, "0")}`,
			description: "small",
		}));
		const block = renderAdvertisedCatalog(many, "aggressive")!;
		expect((block.match(/- name:/g) ?? []).length).toBe(24);
		expect(block.includes(`<omitted count="36"/>`)).toBe(true);
		// The count cap keeps the FRONT (discovery order — builtins first):
		// agent-00 survives, agent-59 is omitted.
		expect(block.includes("- name: agent-00")).toBe(true);
		expect(block.includes("- name: agent-59")).toBe(false);
	});
	test("byte budget: oversized blocks drop oldest-first until they fit", () => {
		// Descriptions are individually capped at 512 bytes, so the realistic
		// overflow path is many LONG NAMES: 5 × ~3 KB names ≈ 15 KB > the
		// 12,288-byte block budget. (Names are canonical identifiers in
		// cciotti's design — never truncated — so the block drops whole
		// agents instead.)
		const fat: CatalogAgent[] = Array.from({ length: 5 }, (_, i) => ({
			name: `fat-${i}-` + "n".repeat(3000),
			description: "d",
		}));
		const block = renderAdvertisedCatalog(fat, "standard")!;
		expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(ADVERTISED_CATALOG_MAX_BYTES);
		const kept = (block.match(/- name:/g) ?? []).length;
		expect(kept).toBeLessThan(5);
		expect(block.includes(`<omitted count="${5 - kept}"/>`)).toBe(true);
		// Front-dropping: the LAST agents survive.
		expect(block.includes(`- name: fat-4-`)).toBe(true);
		expect(block.includes(`- name: fat-0-`)).toBe(false);
	});
	test("descriptions are byte-capped without splitting UTF-8 sequences", () => {
		const long = renderAdvertisedCatalog([{ name: "x", description: "é".repeat(600) }], "standard")!;
		const desc = long.split("description: ")[1].split("\n")[0];
		expect(Buffer.byteLength(desc, "utf8")).toBeLessThanOrEqual(512); // cap INCLUDING the ellipsis
		// é is 2 bytes; a split sequence would produce U+FFFD on re-decode
		expect(desc.includes("\uFFFD")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// BLOCKED protocol
// ---------------------------------------------------------------------------

describe("isBlockedReply", () => {
	test("accepts the exact shape, fenced shape, and first-line shape", () => {
		expect(isBlockedReply("BLOCKED: no access to the payments repo")).toEqual({
			blocked: true,
			reason: "no access to the payments repo",
		});
		expect(isBlockedReply("```\nBLOCKED: ambiguous target\n```")).toEqual({
			blocked: true,
			reason: "ambiguous target",
		});
		expect(isBlockedReply("BLOCKED: needs credentials\n\nSome trailing prose.")).toEqual({
			blocked: true,
			reason: "needs credentials",
		});
		expect(isBlockedReply("  BLOCKED: padded  ")).toEqual({ blocked: true, reason: "padded" });
	});
	test("a mid-document mention is NOT a block (discussing the protocol is not using it)", () => {
		expect(isBlockedReply("I considered replying BLOCKED: but decided to proceed.\nDone.")).toEqual({
			blocked: false,
		});
		expect(isBlockedReply("All steps completed.")).toEqual({ blocked: false });
		expect(isBlockedReply("")).toEqual({ blocked: false });
	});
	test("reasons are capped at 200 chars", () => {
		const res = isBlockedReply(`BLOCKED: ${"x".repeat(500)}`);
		expect(res.blocked).toBe(true);
		expect(res.reason!.length).toBeLessThanOrEqual(200);
	});
	test("boundary instructions ship the protocol text", () => {
		expect(CHILD_BOUNDARY_INSTRUCTIONS.includes("BLOCKED:")).toBe(true);
		expect(COMPLETION_GUARD_FAILURE.length).toBeGreaterThan(10);
	});
});

// ---------------------------------------------------------------------------
// Completion guard (real temp git repo, mirrors worktree.test.ts's approach)
// ---------------------------------------------------------------------------

const guardRoot = mkdtempSync(join(tmpdir(), "unown-catalog-guard-"));

function makeRepo(name: string): string {
	const dir = join(guardRoot, name);
	mkdirSync(dir, { recursive: true });
	const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	git(["init", "-q"]);
	git(["config", "user.email", "t@t"]);
	git(["config", "user.name", "t"]);
	writeFileSync(join(dir, "a.txt"), "one\n");
	git(["add", "."]);
	git(["commit", "-q", "-m", "init"]);
	return dir;
}

describe("completion guard snapshots", () => {
	test("clean tree → clean digest; mutation → detected with paths; revert → equal again", () => {
		const repo = makeRepo("basic");
		const before = snapshotWorkingTree(repo);
		expect(before).not.toBeNull();
		expect(before!.changedPaths).toHaveLength(0);
		expect(before!.diffDigest).toBe(CLEAN_DIGEST);

		writeFileSync(join(repo, "b.txt"), "new file\n");
		const mid = snapshotWorkingTree(repo)!;
		expect(treeMutated(before, mid)).toBe(true);
		expect(mutatedPaths(before, mid)).toEqual(["b.txt"]);

		// Revert: back to equal (untracked file removed).
		rmSync(join(repo, "b.txt"));
		const after = snapshotWorkingTree(repo)!;
		expect(treeMutated(before, after)).toBe(false);
	});
	test("tracked-file edits also count (git diff path, not just status)", () => {
		const repo = makeRepo("tracked");
		const before = snapshotWorkingTree(repo)!;
		writeFileSync(join(repo, "a.txt"), "changed\n");
		const after = snapshotWorkingTree(repo)!;
		expect(treeMutated(before, after)).toBe(true);
		expect(mutatedPaths(before, after)).toEqual(["a.txt"]);
	});
	test("non-git directory yields null (guard reports unavailable, never a false failure)", () => {
		const plain = mkdtempSync(join(guardRoot, "plain-"));
		expect(snapshotWorkingTree(plain)).toBeNull();
		expect(treeMutated(null, null)).toBeNull();
		expect(mutatedPaths(null, null)).toEqual([]);
	});
});
