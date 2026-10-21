// update-feed-e2e.test.ts — the real command over a real local HTTP feed.
// Unlike bin-update.test.ts (injected fetch), this drives `cmdUpdate --check`
// with the global fetch against a Bun.serve feed and a real Ed25519 signature,
// proving the CLI -> checkBinaryUpdate -> verifyReleaseManifest wiring.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeInstallMetadata } from "../src/install-layout.ts";
import { cmdUpdate } from "../src/update.ts";
import { readUpdateCheckCache } from "../src/update-status.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-update-feed-e2e-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function fixture() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
	const raw = `${JSON.stringify(
		{
			schema: 1,
			keyId: "test-key",
			version: "0.0.2",
			releasedAt: "2026-10-21T14:41:06.000Z",
			channel: "stable",
			severity: "normal",
			minimumVersion: null,
			requiredMinimumVersion: null,
			notesUrl: "https://example.test/releases/tag/v0.0.2",
			assets: [{ platform: "linux-x64", name: "unown-linux-x64.tar.gz", sha256: "a".repeat(64), size: 1 }],
		},
		null,
		2,
	)}\n`;
	const signature = sign(null, Buffer.from(raw, "utf8"), privateKey).toString("base64");
	const base = mkdtempSync(join(TMP, "case-"));
	const home = join(base, "home");
	const root = join(base, "install");
	mkdirSync(join(root, "versions", "0.0.1"), { recursive: true });
	writeInstallMetadata(home, {
		schema: 1,
		mode: "binary",
		version: "0.0.1",
		platform: "linux-x64",
		root,
		bin: join(root, "versions", "0.0.1", "unown"),
		shim: join(base, "bin", "unown"),
		installedAt: "2026-10-21T12:00:00.000Z",
	});
	return { raw, signature, publicKeyBase64, home, root };
}

describe("update check over a real HTTP feed", () => {
	test("verifies the signature, selects the platform asset, writes the cache, and fails closed on tamper", async () => {
		const fx = fixture();
		let served = fx.raw;
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch(req) {
				const path = new URL(req.url).pathname;
				if (path.endsWith("/release.json")) return new Response(served);
				if (path.endsWith("/release.json.sig")) return new Response(`${fx.signature}\n`);
				return new Response("not found", { status: 404 });
			},
		});
		const baseUrl = `http://127.0.0.1:${server.port}`;
		const lines: string[] = [];
		const run = () =>
			cmdUpdate(
				{ check: true, json: true },
				{
					home: fx.home,
					env: {},
					install: { mode: "binary", root: fx.root, version: "0.0.1", platform: "linux-x64" },
					platform: process.platform,
					binary: {
						baseUrl,
						platform: "linux-x64",
						musl: false,
						keys: { "test-key": fx.publicKeyBase64 },
					},
					log: (line) => lines.push(line),
				},
			);
		try {
			expect(await run()).toBe(2);
			const body = JSON.parse(lines.join("\n")) as Record<string, unknown>;
			expect(body).toMatchObject({
				schema: 2,
				mode: "binary",
				platform: "linux-x64",
				applicable: true,
				available: true,
				signature: "verified",
			});
			expect((body.asset as { name: string }).name).toBe("unown-linux-x64.tar.gz");
			expect(readUpdateCheckCache(fx.home)).toMatchObject({ schema: 2, latest: "0.0.2", applicable: true });

			served = `${fx.raw} `;
			lines.length = 0;
			expect(await run()).toBe(1);
			const failed = JSON.parse(lines.join("\n")) as Record<string, unknown>;
			expect(String(failed.error)).toContain("signature verification failed");
		} finally {
			server.stop(true);
		}
	}, 20_000);
});
