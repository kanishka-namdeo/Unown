// info.test.ts — `unown info` support bundle: the redaction contract is the point.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdInfo, collectInfo, renderInfo } from "../src/info.ts";

let TMP: string;
function fresh(): string {
	TMP ??= mkdtempSync(join(tmpdir(), "unown-info-"));
	const d = join(TMP, `c-${Math.random().toString(36).slice(2)}`);
	mkdirSync(d, { recursive: true });
	return d;
}

describe("unown info", () => {
	test("collectInfo redacts credential-bearing provider URLs and never reads auth.json", () => {
		const home = fresh();
		mkdirSync(join(home, "agent"), { recursive: true });
		writeFileSync(
			join(home, "agent", "models.json"),
			JSON.stringify({
				providers: {
					"custom-creds": {
						baseUrl: "https://user:secret-token@private.example.com/v1",
						models: [{ id: "m1" }, { id: "m2" }],
					},
				},
			}),
		);
		writeFileSync(join(home, "agent", "auth.json"), JSON.stringify({ "sk-super-secret": "x" }));

		const info = collectInfo({ home, env: {}, repoRoot: "/nonexistent-repo" });
		const raw = JSON.stringify(info);
		expect(raw).not.toContain("secret-token");
		expect(raw).not.toContain("sk-super-secret"); // auth.json contents never surface
		expect(info.providers[0].baseUrl).toBe("https://private.example.com/v1");
		expect(info.providers[0].models).toBe(2);
		// auth.json: existence + file mode only
		expect(info.state.authFile.exists).toBe(true);
		expect(info.state.authFile.mode).toBeGreaterThan(0);
	});

	test("collectInfo reports opt-outs and the update-check cache; render is paste-safe", () => {
		const home = fresh();
		mkdirSync(join(home, "agent"), { recursive: true });
		writeFileSync(
			join(home, "update-check.json"),
			JSON.stringify({
				checkedAt: new Date().toISOString(),
				latest: "2.1.0",
				remoteUrl: "https://github.com/x/y.git",
			}),
		);
		const info = collectInfo({
			home,
			env: { NO_UPDATE_NOTIFIER: "1", DO_NOT_TRACK: "1" },
			repoRoot: "/nonexistent-repo",
		});
		expect(info.optOuts).toContain("NO_UPDATE_NOTIFIER");
		expect(info.optOuts).toContain("DO_NOT_TRACK");
		expect(info.updateCheck?.latest).toBe("2.1.0");
		const text = renderInfo(info);
		expect(text).toContain("opt-outs:");
		expect(text).not.toContain("sk-");
	});

	test("cmdInfo --json emits parseable JSON; --json hides the issue hint", () => {
		const home = fresh();
		const lines: string[] = [];
		const code = cmdInfo(true, { home, env: {}, repoRoot: "/nonexistent-repo", log: (l) => lines.push(l) });
		expect(code).toBe(0);
		const parsed = JSON.parse(lines.join("\n"));
		expect(parsed.platform).toBeDefined();
		expect(parsed.optOuts).toEqual([]);
	});
});

afterAll(() => {
	if (TMP) rmSync(TMP, { recursive: true, force: true });
});
