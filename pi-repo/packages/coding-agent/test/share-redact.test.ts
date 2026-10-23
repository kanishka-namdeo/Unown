import { describe, expect, it } from "vitest";
import { redactSecretsForShare } from "../src/utils/share-redact.ts";

// The secret fixtures are ASSEMBLED from fragments at runtime so the source
// file never carries a complete secret literal (the same posture the shipped
// table enforces on transcripts).
const skKey = ["sk-", "abcdefghijklmnopqrst", "0123456789"].join("");
const ghPat = ["github_pat_", "11AEVXY6", "0VR9BGFEriaZv"].join("");
const awsKey = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

describe("redactSecretsForShare", () => {
	it("replaces every known secret shape with a typed marker", () => {
		const input = `debug: key ${skKey} failed, PAT ${ghPat} too, and ${awsKey}`;
		const result = redactSecretsForShare(input);
		expect(result.count).toBe(3);
		expect(result.redacted).toBe(true);
		expect(result.text).toContain("[REDACTED:sk-key]");
		expect(result.text).toContain("[REDACTED:github-pat]");
		expect(result.text).toContain("[REDACTED:aws-ak]");
		expect(result.text).not.toContain(skKey);
		expect(result.text).not.toContain(ghPat);
		expect(result.text).not.toContain(awsKey);
	});

	it("redacts a full PEM block (multiline) as one secret", () => {
		const pem = [
			"-----BEGIN RSA PRIVATE KEY-----",
			"MIIEowIBAAKCAQEA0123456789abcdefghijklmnopqrstuvwxyzABCD",
			"-----END RSA PRIVATE KEY-----",
		].join("\n");
		const result = redactSecretsForShare(`cert:\n${pem}\nafter`);
		expect(result.count).toBe(1);
		expect(result.text).toContain("[REDACTED:pem]");
		expect(result.text).not.toContain("BEGIN RSA PRIVATE KEY");
	});

	it("redacts bearer tokens from authorization headers", () => {
		const token = ["Bearer ", "abcdefghij", "klmnopqrstuv", "wxyz0123456789"].join("");
		const result = redactSecretsForShare(`curl -H "Authorization: ${token}" https://api.example.com`);
		expect(result.count).toBe(1);
		expect(result.text).toContain("[REDACTED:bearer]");
		expect(result.text).not.toContain(token);
	});

	it("leaves clean text untouched and reports zero", () => {
		const input = "just a normal transcript about cats and coffee, nothing secret";
		const result = redactSecretsForShare(input);
		expect(result.count).toBe(0);
		expect(result.redacted).toBe(false);
		expect(result.text).toBe(input);
		expect(result.digests).toBe("");
	});

	it("is idempotent: a second pass over redacted output changes nothing", () => {
		const first = redactSecretsForShare(`key ${skKey}`);
		const second = redactSecretsForShare(first.text);
		expect(second.count).toBe(0);
		expect(second.text).toBe(first.text);
	});

	it("digests are stable SHA-256[:16] of each secret, comma-joined", () => {
		const result = redactSecretsForShare(`${skKey} ${awsKey}`);
		expect(result.digests).toMatch(/^[0-9a-f]{16},[0-9a-f]{16}$/);
		// Deterministic: same input, same digests.
		const again = redactSecretsForShare(`${skKey} ${awsKey}`);
		expect(again.digests).toBe(result.digests);
	});

	it("keys built from the full allowed charset (- and _) redact cleanly", () => {
		// The match class is [a-zA-Z0-9-_]; the callback form guarantees the
		// replacement is literal text, never a replacement-pattern.
		const dashed = ["sk-", "abcd-efgh", "_ijkl-mnop", "qrst_uvwx"].join("");
		const result = redactSecretsForShare(`token: ${dashed}`);
		expect(result.count).toBe(1);
		expect(result.text).toContain("[REDACTED:sk-key]");
		expect(result.text).not.toContain(dashed);
	});
});
