/**
 * adversary.test.ts — Adversary Mode PreToolUse reviewer (Milestone 1.4).
 *
 * Pins the file-gated LLM reviewer:
 *   - no gate file → no-op (callLlm never invoked)
 *   - cfg.enabled === false → no-op
 *   - tool allowlist enforced (default: bash/powershell/write/edit)
 *   - callLlm missing → no-op
 *   - BLOCK/ALLOW parsing (case-insensitive, first-line wins)
 *   - ambiguous output defaults to allow
 *   - LLM timeout → failClosed posture (both directions)
 *   - secret redaction before LLM call (sk-/ghp_/github_pat_/AKIA/PEM/Bearer)
 *   - input truncation (per-field 2 KB, total prompt 8 KB)
 *
 * The adversary module is pure (fs + os + path only, no pi imports, no
 * store, no bus), so these tests run hermetically — the only I/O is the
 * gate file, written under `tmpdir()` per test.
 */
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	adversaryPath,
	buildReviewPrompt,
	decideAdversary,
	parseAdversaryReply,
	redactSecrets,
	type AdversaryConfig,
} from "../src/adversary.ts";

// Hermetic tmp root for the whole file (one mkdir, one rm at the end).
const tmpRoot = mkdtempSync(join(tmpdir(), `adversary-${Date.now()}-`));

/** Write a gate file under `tmpRoot/<name>/adversary.md` and return its path. */
function gateFile(
	name: string,
	contents = "# Adversary Policy\n\nReviewer must block destructive ops.\n",
): string {
	const dir = join(tmpRoot, name);
	mkdirSync(dir, { recursive: true });
	const p = join(dir, "adversary.md");
	writeFileSync(p, contents);
	return p;
}

/** Build a default-enabled AdversaryConfig pointing at `gateFilePath`. */
function cfg(gateFilePath: string, extra: Partial<AdversaryConfig> = {}): AdversaryConfig {
	return {
		enabled: true,
		gateFilePath,
		...extra,
	};
}

afterAll(() => {
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* overlayfs quirks on some CI hosts — best-effort cleanup */
	}
});

// ---------------------------------------------------------------------------
// adversaryPath
// ---------------------------------------------------------------------------

describe("adversaryPath", () => {
	test("returns a path ending in adversary.md", () => {
		expect(adversaryPath()).toMatch(/[\\/]adversary\.md$/);
	});

	test("respects UNOWN_HOME when set", () => {
		const saved = process.env.UNOWN_HOME;
		try {
			process.env.UNOWN_HOME = "/tmp/adversary-unown-home-test";
			const p = adversaryPath();
			expect(p).toContain("adversary-unown-home-test");
			expect(p).toMatch(/[\\/]adversary\.md$/);
		} finally {
			if (saved === undefined) delete process.env.UNOWN_HOME;
			else process.env.UNOWN_HOME = saved;
		}
	});
});

// ---------------------------------------------------------------------------
// Gate-file semantics
// ---------------------------------------------------------------------------

describe("decideAdversary — gate file", () => {
	test("no gate file → {block:false}, callLlm never invoked", async () => {
		let called = false;
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(join(tmpRoot, "nope-does-not-exist", "adversary.md")),
			async () => {
				called = true;
				return "ALLOW";
			},
		);
		expect(result).toEqual({ block: false });
		expect(called).toBe(false);
	});

	test("cfg.enabled === false → {block:false}, callLlm never invoked", async () => {
		const gate = gateFile("disabled");
		let called = false;
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate, { enabled: false }),
			async () => {
				called = true;
				return "BLOCK: destructive";
			},
		);
		expect(result).toEqual({ block: false });
		expect(called).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Tool allowlist + callLlm presence
// ---------------------------------------------------------------------------

describe("decideAdversary — tool allowlist & callLlm", () => {
	test("tool not in default allowlist → {block:false}", async () => {
		const gate = gateFile("tool-allowlist");
		let called = false;
		const result = await decideAdversary(
			"read", // NOT in [bash, powershell, write, edit]
			{ path: "/etc/passwd" },
			cfg(gate),
			async () => {
				called = true;
				return "BLOCK";
			},
		);
		expect(result).toEqual({ block: false });
		expect(called).toBe(false);
	});

	test("tool in allowlist → LLM is consulted", async () => {
		const gate = gateFile("tool-allowlist-ok");
		let called = false;
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate),
			async () => {
				called = true;
				return "ALLOW";
			},
		);
		expect(result).toEqual({ block: false });
		expect(called).toBe(true);
	});

	test("custom tools allowlist respected", async () => {
		const gate = gateFile("custom-tools");
		let called = false;
		// `bash` is normally allowed, but a custom tools list of just
		// `["write"]` excludes it.
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate, { tools: ["write"] }),
			async () => {
				called = true;
				return "BLOCK";
			},
		);
		expect(result).toEqual({ block: false });
		expect(called).toBe(false);
	});

	test("callLlm missing → {block:false}", async () => {
		const gate = gateFile("no-llm");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate),
			undefined,
		);
		expect(result).toEqual({ block: false });
	});
});

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

describe("decideAdversary — LLM response parsing", () => {
	test("BLOCK: reason → {block:true, reason}", async () => {
		const gate = gateFile("block");
		const result = await decideAdversary(
			"bash",
			{ command: "rm -rf /" },
			cfg(gate),
			async () => "BLOCK: destructive command\nThanks.",
		);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("destructive command");
	});

	test("ALLOW → {block:false}", async () => {
		const gate = gateFile("allow");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate),
			async () => "ALLOW",
		);
		expect(result).toEqual({ block: false });
	});

	test("ambiguous → {block:false}", async () => {
		const gate = gateFile("ambiguous");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate),
			async () => "I'm not sure what to do here.",
		);
		expect(result).toEqual({ block: false });
	});

	test("case-insensitive 'block' keyword", async () => {
		const gate = gateFile("case-insensitive");
		const result = await decideAdversary(
			"bash",
			{ command: "x" },
			cfg(gate),
			async () => "block: danger ahead",
		);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("danger ahead");
	});

	test("BLOCK on a later line still wins when no earlier ALLOW", async () => {
		const gate = gateFile("block-later");
		const result = await decideAdversary(
			"bash",
			{ command: "x" },
			cfg(gate),
			async () => "Reasoning about the command...\nIt looks dangerous.\nBLOCK: destructive",
		);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("destructive");
	});

	test("BLOCK without a reason → default reason surfaced", async () => {
		const gate = gateFile("block-no-reason");
		const result = await decideAdversary(
			"bash",
			{ command: "x" },
			cfg(gate),
			async () => "BLOCK",
		);
		expect(result.block).toBe(true);
		expect(typeof result.reason).toBe("string");
		expect(result.reason!.length).toBeGreaterThan(0);
	});

	test("empty reply → {block:false}", async () => {
		const gate = gateFile("empty-reply");
		const result = await decideAdversary(
			"bash",
			{ command: "x" },
			cfg(gate),
			async () => "",
		);
		expect(result).toEqual({ block: false });
	});
});

// ---------------------------------------------------------------------------
// Timeout & error posture
// ---------------------------------------------------------------------------

describe("decideAdversary — timeout & errors", () => {
	test("LLM timeout with failClosed: false → {block:false}", async () => {
		const gate = gateFile("timeout-open");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate, { timeoutMs: 50, failClosed: false }),
			async () => new Promise<string>((resolve) => setTimeout(() => resolve("BLOCK: would block"), 500)),
		);
		expect(result).toEqual({ block: false });
	});

	test("LLM timeout with failClosed: true → {block:true}", async () => {
		const gate = gateFile("timeout-closed");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate, { timeoutMs: 50, failClosed: true }),
			async () => new Promise<string>((resolve) => setTimeout(() => resolve("ALLOW"), 500)),
		);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("adversary reviewer error");
	});

	test("LLM throws with failClosed: true → {block:true, reason contains msg}", async () => {
		const gate = gateFile("throws-closed");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate, { failClosed: true }),
			async () => {
				throw new Error("network down");
			},
		);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("network down");
	});

	test("LLM throws with failClosed: false → {block:false}", async () => {
		const gate = gateFile("throws-open");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate, { failClosed: false }),
			async () => {
				throw new Error("network down");
			},
		);
		expect(result).toEqual({ block: false });
	});

	test("failClosed defaults to false (no cfg.failClosed)", async () => {
		const gate = gateFile("failclosed-default");
		const result = await decideAdversary(
			"bash",
			{ command: "ls" },
			cfg(gate), // failClosed unset
			async () => {
				throw new Error("oops");
			},
		);
		expect(result).toEqual({ block: false });
	});
});

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

describe("decideAdversary — secret redaction", () => {
	test("sk- key in bash command is redacted before reaching the LLM", async () => {
		const gate = gateFile("sk-redact");
		const rawKey = `sk-${"a".repeat(40)}`;
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: `export OPENAI_KEY=${rawKey}` },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured).toHaveLength(1);
		expect(captured[0]).toContain("[REDACTED:sk-key]");
		expect(captured[0]).not.toContain(rawKey);
	});

	test("ghp_ (GitHub PAT) is redacted", async () => {
		const gate = gateFile("ghp-redact");
		const token = `ghp_${"a".repeat(36)}`;
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: `echo ${token}` },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0]).toContain("[REDACTED:ghp-key]");
		expect(captured[0]).not.toContain(token);
	});

	test("github_pat_ (fine-grained) is redacted", async () => {
		const gate = gateFile("github-pat-redact");
		const token = `github_pat_${"a".repeat(20)}`;
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: `echo ${token}` },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0]).toContain("[REDACTED:github-pat]");
	});

	test("AKIA (AWS access key) is redacted", async () => {
		const gate = gateFile("aws-redact");
		const key = `AKIA${"A".repeat(16)}`;
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: `export AWS_KEY=${key}` },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0]).toContain("[REDACTED:aws-ak]");
		expect(captured[0]).not.toContain(key);
	});

	test("Bearer token is redacted", async () => {
		const gate = gateFile("bearer-redact");
		const token = "a".repeat(30);
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: `curl -H "Authorization: Bearer ${token}" http://x` },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0]).toContain("[REDACTED:bearer]");
		// The raw token must not appear.
		expect(captured[0]).not.toContain(`Bearer ${token}`);
	});

	test("PEM private key block is redacted", async () => {
		const gate = gateFile("pem-redact");
		const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA${"A".repeat(64)}
-----END RSA PRIVATE KEY-----`;
		const captured: string[] = [];
		await decideAdversary(
			"write",
			{ path: "/x", content: pem },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0]).toContain("[REDACTED:pem]");
		// The PEM body must not leak.
		expect(captured[0]).not.toContain("MIIEpAIBAAKCAQEA");
	});

	test("multiple secrets in one field are all redacted", async () => {
		const gate = gateFile("multi-redact");
		const sk = `sk-${"a".repeat(40)}`;
		const ghp = `ghp_${"b".repeat(36)}`;
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: `echo ${sk} ${ghp}` },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0]).toContain("[REDACTED:sk-key]");
		expect(captured[0]).toContain("[REDACTED:ghp-key]");
		expect(captured[0]).not.toContain(sk);
		expect(captured[0]).not.toContain(ghp);
	});
});

// ---------------------------------------------------------------------------
// Input truncation
// ---------------------------------------------------------------------------

describe("decideAdversary — input truncation", () => {
	test("100 KB input is truncated to ≤ 8 KB total prompt", async () => {
		const gate = gateFile("truncate-100k");
		const big = "x".repeat(100 * 1024);
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: big },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured).toHaveLength(1);
		// The total prompt passed to callLlm must be ≤ 8 KB.
		expect(captured[0].length).toBeLessThanOrEqual(8 * 1024);
	});

	test("per-field truncation: field > 2 KB is truncated (visible marker)", async () => {
		const gate = gateFile("truncate-field");
		const big = "y".repeat(5 * 1024);
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ command: big },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0]).toContain("[truncated]");
		// And the full 5 KB didn't make it through.
		expect(captured[0].length).toBeLessThan(5 * 1024);
	});

	test("many fields together are capped at 8 KB", async () => {
		const gate = gateFile("truncate-many");
		const big = "z".repeat(3 * 1024); // each under the 2 KB per-field cap?
		// Actually 3 KB > 2 KB so each is truncated to 2 KB. With 5
		// fields that's 5 × 2 KB = 10 KB → must be capped to 8 KB.
		const captured: string[] = [];
		await decideAdversary(
			"bash",
			{ a: big, b: big, c: big, d: big, e: big },
			cfg(gate),
			async (prompt) => {
				captured.push(prompt);
				return "ALLOW";
			},
		);
		expect(captured[0].length).toBeLessThanOrEqual(8 * 1024);
	});
});

// ---------------------------------------------------------------------------
// Unit tests for the pure helpers
// ---------------------------------------------------------------------------

describe("parseAdversaryReply (unit)", () => {
	test("BLOCK: foo → block with reason foo", () => {
		expect(parseAdversaryReply("BLOCK: foo")).toEqual({ block: true, reason: "foo" });
	});

	test("BLOCK first wins over ALLOW later", () => {
		expect(parseAdversaryReply("BLOCK: foo\nALLOW")).toEqual({ block: true, reason: "foo" });
	});

	test("ALLOW on the first non-empty line wins (line 2 BLOCK ignored)", () => {
		// The parser scans line-by-line and returns on the first line
		// containing EITHER keyword (BLOCK checked before ALLOW on each
		// line). A line with just ALLOW (no BLOCK) returns allow
		// immediately, even if a later line has BLOCK.
		expect(parseAdversaryReply("ALLOW\nBLOCK: foo")).toEqual({ block: false });
	});

	test("empty reply → allow", () => {
		expect(parseAdversaryReply("")).toEqual({ block: false });
	});

	test("whitespace-only lines skipped", () => {
		expect(parseAdversaryReply("\n  \n   \nALLOW")).toEqual({ block: false });
	});

	test("BLOCK without reason falls back to subsequent lines for reason", () => {
		const r = parseAdversaryReply("BLOCK\nthe command is destructive");
		expect(r.block).toBe(true);
		expect(r.reason).toContain("destructive");
	});

	test("BLOCK with no reason and no following lines → default reason", () => {
		const r = parseAdversaryReply("BLOCK");
		expect(r.block).toBe(true);
		expect(typeof r.reason).toBe("string");
		expect(r.reason!.length).toBeGreaterThan(0);
	});
});

describe("redactSecrets (unit)", () => {
	test("sk- key", () => {
		const s = `x=sk-${"a".repeat(40)}`;
		const out = redactSecrets(s);
		expect(out).toContain("[REDACTED:sk-key]");
		expect(out).not.toContain("sk-aaaa");
	});

	test("non-secret string unchanged", () => {
		expect(redactSecrets("hello world")).toBe("hello world");
	});

	test("idempotent (redacted output doesn't trigger more redaction)", () => {
		const s = `sk-${"a".repeat(40)}`;
		const once = redactSecrets(s);
		const twice = redactSecrets(once);
		expect(twice).toBe(once);
	});

	test("short sk- (<20 chars) NOT redacted (false-positive guard)", () => {
		// `sk-abc` is too short to be a real key; the {20,} quantifier
		// prevents a false positive on words like "sk-tiny".
		expect(redactSecrets("sk-abc")).toBe("sk-abc");
	});
});

describe("buildReviewPrompt (unit)", () => {
	test("includes tool name", () => {
		expect(buildReviewPrompt("bash", { command: "ls" })).toContain("Tool: bash");
	});

	test("includes input fields", () => {
		const p = buildReviewPrompt("bash", { command: "ls" });
		expect(p).toContain("command: ls");
	});

	test("handles empty input", () => {
		const p = buildReviewPrompt("bash", {});
		expect(p).toContain("Tool: bash");
		expect(p).not.toContain("Input:");
	});

	test("redacts secrets before truncating", () => {
		const key = `sk-${"a".repeat(40)}`;
		const p = buildReviewPrompt("bash", { command: `export K=${key}` });
		expect(p).toContain("[REDACTED:sk-key]");
		expect(p).not.toContain(key);
	});

	test("total prompt ≤ 8 KB on huge input", () => {
		const big = "z".repeat(100 * 1024);
		const p = buildReviewPrompt("bash", { command: big, content: big, path: big });
		expect(p.length).toBeLessThanOrEqual(8 * 1024);
	});
});
