// bin-update.test.ts — the standalone-binary update path: release feed check,
// mandatory checksums, atomic versioned install, shim/metadata rewrite and
// rollback. Hermetic: injected fetch/extract/verify, temp roots, no network.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
        archiveName,
        assetUrl,
        binaryName,
        binaryPath,
        checksumsUrl,
        readInstallMetadata,
        versionDir,
        versionTxtUrl,
        writeBinaryShims,
        writeInstallMetadata,
        type ReleasePlatform,
} from "../src/install-layout.ts";
import {
        checkBinaryUpdate,
        checkLatestVersion,
        downloadAndStage,
        type ExtractArchive,
        type FetchLike,
        type VerifyBinary,
        verifyChecksum,
} from "../src/bin-update.ts";
import { cmdUpdate, resolveInstallInfo, updateCheckPath, updateStatePath } from "../src/update.ts";

const BASE = "https://example.test/releases";

let TMP = "";
function fresh(): string {
        TMP ||= mkdtempSync(join(tmpdir(), "unown-bin-update-"));
        const d = join(TMP, `c-${Math.random().toString(36).slice(2)}`);
        mkdirSync(d, { recursive: true });
        return d;
}

afterAll(() => {
        if (TMP) rmSync(TMP, { recursive: true, force: true });
});

interface Fixture {
        root: string;
        home: string;
        bin: string;
        current: string;
        platform: ReleasePlatform;
        shim: string;
}

function makeInstall(current = "0.0.1", platform: ReleasePlatform = "linux-x64"): Fixture {
        const base = fresh();
        const root = join(base, "data", "unown");
        const home = join(base, "home");
        const bin = join(base, "bin");
        const file = binaryPath(root, current, platform);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, current);
        const shims = writeBinaryShims({ root, version: current, env: { UNOWN_BIN_DIR: bin } });
        writeInstallMetadata(home, {
                schema: 1,
                mode: "binary",
                version: current,
                platform,
                root,
                bin: file,
                shim: shims.primary,
                installedAt: "2026-01-01T00:00:00.000Z",
        });
        return { root, home, bin, current, platform, shim: shims.primary };
}

interface Feed {
        fetch: FetchLike;
        extract: ExtractArchive;
        verify: VerifyBinary;
}

/** A release feed for `version`; `checksum` overrides the published hash. */
function feed(version: string, platform: ReleasePlatform, checksum?: string): Feed {
        const archive = Buffer.from(`fake archive ${version}`);
        const name = archiveName(platform);
        const digest = checksum ?? createHash("sha256").update(archive).digest("hex");
        const bodies = new Map<string, string | Uint8Array>([
                [versionTxtUrl(BASE), `${version}\n`],
                [assetUrl(BASE, platform, version), new Uint8Array(archive)],
                [checksumsUrl(BASE, version), `${digest}  ${name}\n`],
        ]);
        // A Response body can only be consumed once; each request gets a fresh one.
        const fetchImpl: FetchLike = async (url) => {
                const body = bodies.get(url);
                return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
        };
        const extract: ExtractArchive = (_archive, dest, p) => {
                const dir = join(dest, `unown-${p}`);
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, binaryName(p)), version);
        };
        const verify: VerifyBinary = (file, want) => {
                try {
                        return readFileSync(file, "utf8") === want;
                } catch {
                        return false;
                }
        };
        return { fetch: fetchImpl, extract, verify };
}

async function runBinary(
        fx: Fixture,
        flags: Parameters<typeof cmdUpdate>[0],
        release: Feed,
        extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number; lines: string[] }> {
        const lines: string[] = [];
        const code = await cmdUpdate(flags, {
                home: fx.home,
                env: { UNOWN_BIN_DIR: fx.bin, ...extraEnv },
                install: { mode: "binary", root: fx.root, version: fx.current, platform: fx.platform },
                platform: process.platform,
                binary: {
                        fetch: release.fetch,
                        extract: release.extract,
                        verifyBinary: release.verify,
                        platform: fx.platform,
                        baseUrl: BASE,
                        musl: false,
                },
                log: (l) => lines.push(l),
                git: () => {
                        throw new Error("binary updates must never run git");
                },
        });
        return { code, lines };
}

function noTempDirs(root: string): string[] {
        try {
                return readdirSync(root).filter((f) => f.startsWith(".update-"));
        } catch {
                return [];
        }
}

describe("checkLatestVersion / checkBinaryUpdate", () => {
        test("reads version.txt and validates it", async () => {
                const good = await checkLatestVersion({
                        baseUrl: BASE,
                        fetch: async (url) => (url === versionTxtUrl(BASE) ? new Response("0.0.2\n") : new Response("no", { status: 404 })),
                });
                expect(good).toMatchObject({ ok: true, latest: "0.0.2", baseUrl: BASE });

                const garbage = await checkLatestVersion({ baseUrl: BASE, fetch: async () => new Response("banana\n") });
                expect(garbage.ok).toBe(false);
                expect(garbage.error).toContain("did not contain a version");

                const missing = await checkLatestVersion({ baseUrl: BASE, fetch: async () => new Response("nope", { status: 404 }) });
                expect(missing.ok).toBe(false);
                expect(missing.error).toContain("HTTP 404");
        });

        test("a credentialed mirror URL is redacted before it is reported", async () => {
                const res = await checkLatestVersion({
                        baseUrl: "https://user:secret-token@mirror.example/releases",
                        fetch: async () => new Response("0.0.2\n"),
                });
                expect(res.ok).toBe(true);
                expect(res.baseUrl).toBe("https://mirror.example/releases");
                expect(JSON.stringify(res)).not.toContain("secret-token");
        });

        test("exit-code inputs: 2 available, 0 current, 1 error", async () => {
                const release = feed("0.0.2", "linux-x64");
                expect(await checkBinaryUpdate({ current: "0.0.1", fetch: release.fetch, baseUrl: BASE })).toMatchObject({
                        ok: true,
                        latest: "0.0.2",
                        available: true,
                });
                expect(await checkBinaryUpdate({ current: "0.0.2", fetch: release.fetch, baseUrl: BASE })).toMatchObject({
                        available: false,
                });
                expect(
                        await checkBinaryUpdate({ current: "0.0.1", fetch: async () => new Response("down", { status: 500 }), baseUrl: BASE }),
                ).toMatchObject({ ok: false, available: false });
        });
});

describe("binary update", () => {
        test("successful update writes versions/<v>, rewrites the shim/metadata, keeps the old version", async () => {
                const fx = makeInstall("0.0.1");
                const release = feed("0.0.2", fx.platform);
                const r = await runBinary(fx, {}, release);
                expect(r.code).toBe(0);
                expect(r.lines.join("\n")).toContain("unown updated: 0.0.1 → 0.0.2");

                expect(readFileSync(binaryPath(fx.root, "0.0.2", fx.platform), "utf8")).toBe("0.0.2");
                expect(existsSync(binaryPath(fx.root, "0.0.1", fx.platform))).toBe(true); // kept for rollback
                const meta = readInstallMetadata(fx.home);
                expect(meta).toMatchObject({ mode: "binary", version: "0.0.2", previousVersion: "0.0.1", root: fx.root });
                const shim = readFileSync(meta?.shim ?? fx.shim, "utf8");
                expect(shim).toContain(binaryPath(fx.root, "0.0.2", fx.platform));
                expect(shim).toContain(fx.root);
                expect(noTempDirs(fx.root)).toEqual([]);

                const state = JSON.parse(readFileSync(updateStatePath(fx.home), "utf8"));
                expect(state).toMatchObject({ from: "0.0.1", to: "0.0.2", ok: true });
        });

        test("checksum mismatch leaves the old install, shim and metadata intact", async () => {
                const fx = makeInstall("0.0.1");
                const before = readFileSync(fx.shim, "utf8");
                const release = feed("0.0.2", fx.platform, "0".repeat(64));
                const r = await runBinary(fx, {}, release);
                expect(r.code).toBe(1);
                expect(r.lines.join("\n")).toContain("checksum mismatch");
                expect(r.lines.join("\n")).toContain("existing install was not changed");
                expect(readInstallMetadata(fx.home)?.version).toBe("0.0.1");
                expect(readFileSync(fx.shim, "utf8")).toBe(before);
                expect(existsSync(versionDir(fx.root, "0.0.2"))).toBe(false);
                expect(noTempDirs(fx.root)).toEqual([]);
        });

        test("a downloaded binary that reports the wrong version is rejected", async () => {
                const fx = makeInstall("0.0.1");
                const release = feed("0.0.2", fx.platform);
                release.verify = () => false;
                const r = await runBinary(fx, {}, release);
                expect(r.code).toBe(1);
                expect(r.lines.join("\n")).toContain("did not report version 0.0.2");
                expect(readInstallMetadata(fx.home)?.version).toBe("0.0.1");
                expect(existsSync(versionDir(fx.root, "0.0.2"))).toBe(false);
        });

        test("reinstalling the active version keeps the recorded rollback target", async () => {
                const fx = makeInstall("0.0.1");
                const release = feed("0.0.2", fx.platform);
                expect((await runBinary(fx, {}, release)).code).toBe(0);
                fx.current = "0.0.2";
                const again = await runBinary(fx, { version: "0.0.2" }, release);
                expect(again.code).toBe(0);
                expect(readInstallMetadata(fx.home)).toMatchObject({ version: "0.0.2", previousVersion: "0.0.1" });
        });

        test("--rollback restores previousVersion and the old shim", async () => {
                const fx = makeInstall("0.0.1");
                const release = feed("0.0.2", fx.platform);
                expect((await runBinary(fx, {}, release)).code).toBe(0);
                expect(readInstallMetadata(fx.home)?.version).toBe("0.0.2");

                const r = await runBinary(fx, { rollback: true }, release);
                expect(r.code).toBe(0);
                expect(r.lines.join("\n")).toContain("rolled back: 0.0.2 → 0.0.1");
                const meta = readInstallMetadata(fx.home);
                expect(meta).toMatchObject({ version: "0.0.1", previousVersion: "0.0.2" });
                expect(binaryPath(fx.root, "0.0.1", fx.platform)).toBe(meta?.bin);
                expect(readFileSync(meta?.shim ?? fx.shim, "utf8")).toContain(binaryPath(fx.root, "0.0.1", fx.platform));
                expect(JSON.parse(readFileSync(updateStatePath(fx.home), "utf8")).rolledBack).toBe(true);
        });

        test("--check follows the 0/2/1 contract without touching git", async () => {
                const fx = makeInstall("0.0.1");
                const release = feed("0.0.2", fx.platform);
                const available = await runBinary(fx, { check: true, json: true }, release);
                expect(available.code).toBe(2);
                const parsed = JSON.parse(available.lines.join("\n"));
                expect(parsed).toMatchObject({ current: "0.0.1", latest: "0.0.2", available: true, mode: "binary" });
                expect(parsed.remoteUrl).toBe(BASE);

                const current = await runBinary(fx, { check: true }, feed("0.0.1", fx.platform));
                expect(current.code).toBe(0);
                expect(current.lines.join("\n")).toContain("up to date");

                const offline = await runBinary(fx, { check: true }, { ...release, fetch: async () => new Response("x", { status: 503 }) });
                expect(offline.code).toBe(1);
                expect(offline.lines.join("\n")).toContain("update check failed");
        });

        test("--background writes the notifier cache silently", async () => {
                const fx = makeInstall("0.0.1");
                const r = await runBinary(fx, { background: true }, feed("0.0.2", fx.platform));
                expect(r.code).toBe(0);
                expect(r.lines).toEqual([]);
                const cache = JSON.parse(readFileSync(updateCheckPath(fx.home), "utf8"));
                expect(cache.latest).toBe("0.0.2");
                expect(cache.remoteUrl).toBe(BASE);
        });

        test("--check --background (the detached child's argv) still means background", async () => {
                const fx = makeInstall("0.0.1");
                const r = await runBinary(fx, { check: true, background: true }, feed("0.0.2", fx.platform));
                expect(r.code).toBe(0);
                expect(r.lines).toEqual([]);
                expect(JSON.parse(readFileSync(updateCheckPath(fx.home), "utf8")).latest).toBe("0.0.2");
        });

        test("windows-arm64 is refused unless explicitly allowed", async () => {
                const fx = makeInstall("0.0.1", "windows-arm64");
                // the metadata says this install is a DIFFERENT platform (an x64
                // host being pointed at the arm64 archive) — the un-smoked case
                const meta = readInstallMetadata(fx.home);
                if (!meta) throw new Error("fixture metadata missing");
                writeInstallMetadata(fx.home, { ...meta, platform: "linux-x64" });
                const release = feed("0.0.2", "windows-arm64");
                const refused = await runBinary(fx, {}, release);
                expect(refused.code).toBe(1);
                expect(refused.lines.join("\n")).toContain("experimental");
                const allowed = await runBinary(fx, {}, release, { UNOWN_ALLOW_EXPERIMENTAL: "1" });
                expect(allowed.code).toBe(0);
        });

        test("downloadAndStage verifies the exact checksum before staging", async () => {
                const root = join(fresh(), "unown");
                const bad = feed("9.9.9", "linux-x64", "f".repeat(64));
                const res = await downloadAndStage({
                        root,
                        platform: "linux-x64",
                        version: "9.9.9",
                        baseUrl: BASE,
                        fetch: bad.fetch,
                        extract: bad.extract,
                        verifyBinary: bad.verify,
                });
                expect(res.ok).toBe(false);
                if (!res.ok) expect(res.error).toContain("checksum mismatch");
                expect(noTempDirs(root)).toEqual([]);
        });
});

describe("mode detection", () => {
        test("a versioned execPath is a binary install without touching git", () => {
                const base = fresh();
                const execPath = binaryPath(join(base, "data", "unown"), "1.2.3", "linux-x64");
                const info = resolveInstallInfo({
                        env: {},
                        home: join(base, "home"),
                        execPath,
                        checkGit: false,
                        git: () => {
                                throw new Error("git must not run for a binary");
                        },
                });
                expect(info).toMatchObject({ mode: "binary", version: "1.2.3", root: join(base, "data", "unown") });
        });

        test("UNOWN_INSTALL_ROOT (the shim marker) is binary mode; a forced root is checkout", () => {
                const base = fresh();
                const info = resolveInstallInfo({
                        env: { UNOWN_INSTALL_ROOT: join(base, "root") },
                        home: join(base, "home"),
                        execPath: "/usr/bin/bun",
                        checkGit: false,
                });
                expect(info?.mode).toBe("binary");
                expect(info?.root).toBe(join(base, "root"));

                const forced = resolveInstallInfo({ root: base, env: {}, home: join(base, "home") });
                expect(forced).toMatchObject({ mode: "checkout", root: base });
        });
});

test("verifyChecksum compares a file's sha256", () => {
        const dir = fresh();
        const p = join(dir, "x");
        writeFileSync(p, "abc");
        expect(verifyChecksum(p, "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD")).toBe(true);
        expect(verifyChecksum(p, "0".repeat(64))).toBe(false);
});
