import * as crypto from "node:crypto";

/**
 * Secret redaction for session SHARING (the /share gist + Radius upload).
 *
 * A session transcript can legitimately contain secrets the user pasted for
 * debugging ("here is my API key, why does it 401?"). The moment that
 * transcript leaves the machine — a gist upload, an artifact POST — the
 * secret leaks with it. Every share path therefore runs the exported content
 * through this table first and reports what it caught.
 *
 * Marker format `[REDACTED:<type>]` matches the terminal-agent's adversary
 * scanner (pi-repo/packages/self-learning/src/adversary.ts) — the same twin
 * pattern table, kept in sync deliberately: one for the vendored share path
 * (this file, no cross-package import possible), one for the learning layer.
 */
interface SecretPattern {
	re: RegExp;
	type: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
	// PEM-encoded private keys (entire BEGIN..END block, multiline). MUST
	// come before the others: a PEM body can contain `AKIA…`-like noise
	// that would otherwise produce a leaky double-redaction.
	{ re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, type: "pem" },
	// OpenAI / Anthropic keys: sk-...
	{ re: /sk-[a-zA-Z0-9-_]{20,}/g, type: "sk-key" },
	// GitHub PATs (classic): ghp_...
	{ re: /ghp_[a-zA-Z0-9]{36,}/g, type: "ghp-key" },
	// GitHub fine-grained PATs: github_pat_...
	{ re: /github_pat_[a-zA-Z0-9_]{20,}/g, type: "github-pat" },
	// AWS access keys: AKIA...
	{ re: /AKIA[0-9A-Z]{16}/g, type: "aws-ak" },
	// Bearer tokens (Authorization: Bearer <token> in headers/commands).
	{ re: /Bearer [a-zA-Z0-9._-]{20,}/g, type: "bearer" },
];

export interface RedactionResult {
	/** The redacted text. */
	text: string;
	/** How many distinct secrets were replaced (0 = clean input). */
	count: number;
	/** True when at least one secret was found — drives the user notice. */
	redacted: boolean;
	/**
	 * Non-reversible digest of each redacted-away secret (SHA-256, first 16
	 * hex chars, comma-joined), so the user can verify AFTER the fact WHICH
	 * secret leaked — compare against the local original — without the
	 * share itself carrying the secret. Empty string when nothing matched.
	 */
	digests: string;
}

/**
 * Redact known secret shapes from `text` in one pass. Pure, deterministic,
 * no I/O. Each pattern carries the `g` flag and is module-scoped; the
 * replace callback (not a replacement string) is used so a `$`-bearing
 * secret can never be interpreted as a replacement pattern.
 */
export function redactSecretsForShare(text: string): RedactionResult {
	let count = 0;
	const digests: string[] = [];
	let out = text;
	for (const { re, type } of SECRET_PATTERNS) {
		out = out.replace(re, (secret) => {
			count++;
			digests.push(crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16));
			return `[REDACTED:${type}]`;
		});
	}
	return { text: out, count, redacted: count > 0, digests: digests.join(",") };
}
