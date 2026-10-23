#!/usr/bin/env bun
/**
 * scripts/build-artifacts.ts — the per-OS release binaries for the `unown` CLI.
 *
 * One run produces, for every supported OS/arch:
 *
 *   <out>/unown-<platform>.tar.gz   (darwin, linux)  — unown-<platform>/{unown,VERSION,LICENSE,INSTALL.txt}
 *   <out>/unown-<platform>.zip      (windows)        — unown-<platform>/{unown.exe,VERSION,LICENSE,INSTALL.txt}
 *   <out>/version.txt                                — the plain release version (no leading v)
 *   <out>/sha256sums.txt                             — the six archives + version.txt
 *
 * Every archive is self-describing: VERSION is the plain release version the
 * binary was stamped with, LICENSE is the repo-root license, and INSTALL.txt is
 * versioned per archive. version.txt exists so a compiled binary's update check
 * can read the newest release version from the release's own download URL
 * without the GitHub API.
 *
 * Why each piece is the way it is (all of it measured on the platform that
 * produces it — see the release workflow's `smoke-artifacts` leg, which runs
 * every artifact on its own OS):
 *
 *   - ONE host builds ALL SIX targets. `bun build --compile --target=…`
 *     downloads the bun runtime for the requested platform, so the build job
 *     needs no macOS or Windows machine. A runner can only EXECUTE its own
 *     platform's output, which is why the workflow smoke-tests per OS.
 *   - The entry is `pi-repo/packages/self-learning/src/boot.ts`, NOT
 *     `bin/unown`. Compiling the extensionless shim produced a silent no-op
 *     executable (exit 0, zero output, ~6 modules bundled) because bun does not
 *     treat it as a main module. boot.ts is what bin/unown calls, so there is
 *     still exactly one way unown starts.
 *   - x64 targets use bun's `-baseline` runtime so the binary runs on CPUs
 *     without AVX2 — the same trade upstream pi makes in its own builder.
 *   - `--define __UNOWN_VERSION__` injects the version. A compiled binary has
 *     no repo-root package.json to read (packaging.ts explains why every
 *     `import.meta.dir` escape fails there), so without the define
 *     `unown --version` would print "unknown" and the release's
 *     version-consistency assertion would be unsatisfiable.
 *   - `--no-compile-autoload-bunfig` is required: the repo-root bunfig.toml
 *     preloads the happy-dom test registrator, which would run inside the
 *     shipped binary before the CLI starts.
 *   - The image-resize worker is a SECOND entrypoint on purpose: Bun only
 *     embeds worker scripts passed explicitly, and the worker is not reachable
 *     from boot.ts's import graph.
 *   - Artifacts are UNSIGNED (decision 2026-10-19: no Apple Developer account,
 *     no code-signing secrets in the repo). Each archive therefore carries an
 *     INSTALL.txt naming the Gatekeeper/SmartScreen step, so the friction is
 *     documented where the user hits it rather than discovered by them.
 *
 * Usage:
 *   bun scripts/build-artifacts.ts [--platform <p>]... [--out <dir>] [--dry-run]
 *   bun scripts/build-artifacts.ts --list-platforms
 *
 * Prerequisite: the vendored pi workspace must be built (it provides the worker
 * file) — `bun run agent:install` does that.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IS_WIN, REPO_ROOT, run, sym } from "./lib";

/** The six platform ids Unown ships. Order is the release-page order. */
export const PLATFORMS = [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-arm64",
    "windows-x64",
] as const;

export type Platform = (typeof PLATFORMS)[number];

const ENTRY = join(REPO_ROOT, "pi-repo", "packages", "self-learning", "src", "boot.ts");
const WORKER = join(REPO_ROOT, "pi-repo", "packages", "coding-agent", "dist", "utils", "image-resize-worker.js");
const LICENSE = join(REPO_ROOT, "LICENSE");

/** A real bun-compiled CLI is ~86-98 MiB here. Anything far smaller means the
 *  bundle lost its graph (the extensionless-entry failure mode produced a
 *  ~1 MiB no-op), so a stub must fail the build instead of shipping. */
const MIN_BINARY_BYTES = 20 * 1024 * 1024;

/** Bun's compile target for a platform id. x64 gets the baseline runtime. */
export function bunTarget(p: Platform): string {
    return `bun-${p}${p.endsWith("-x64") ? "-baseline" : ""}`;
}

/** Archive file name + the directory name inside it. */
export function archiveName(p: Platform): string {
    return `unown-${p}${isWindows(p) ? ".zip" : ".tar.gz"}`;
}

export function binaryName(p: Platform): string {
    return `unown${isWindows(p) ? ".exe" : ""}`;
}

function isWindows(p: Platform): boolean {
    return p.startsWith("windows");
}

function sha256(file: string): string {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readVersion(): string {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version?: unknown };
    const v = String(pkg.version ?? "");
    if (!/^\d+\.\d+\.\d+/.test(v)) {
        die(`${sym.fail} package.json version is missing or not X.Y.Z ("${v}") — the artifact must carry a real version`);
    }
    return v;
}

function die(message: string, code = 1): never {
    console.error(message);
    process.exit(code);
}

type Options = { platforms: Platform[]; out: string; dryRun: boolean };

function parseArgs(argv: string[]): Options {
    const platforms: Platform[] = [];
    let out = join(REPO_ROOT, "download", "artifacts");
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--platform") {
            const p = argv[++i] as Platform | undefined;
            if (!p || !(PLATFORMS as readonly string[]).includes(p)) {
                die(`${sym.fail} --platform needs one of: ${PLATFORMS.join(", ")}`);
            }
            platforms.push(p);
        } else if (a === "--out") {
            const o = argv[++i];
            if (!o) die(`${sym.fail} --out needs a directory`);
            out = join(o);
        } else if (a === "--dry-run") {
            dryRun = true;
        } else if (a === "--list-platforms") {
            console.log(PLATFORMS.join("\n"));
            process.exit(0);
        } else {
            die(`${sym.fail} unknown argument: ${a}\n    usage: bun scripts/build-artifacts.ts [--platform <p>]... [--out <dir>] [--dry-run]`);
        }
    }
    return { platforms: platforms.length ? platforms : [...PLATFORMS], out, dryRun };
}

/** The INSTALL.txt inside each archive. Per-OS because the friction differs:
 *  macOS quarantines downloaded executables, Windows warns via SmartScreen,
 *  Linux just needs the exec bit. The first line carries the version so an
 *  extracted archive can identify itself without running the binary. */
export function installNotes(p: Platform, version: string): string {
    const os = p.split("-")[0];
    const dir = `unown-${p}`;
    const archive = archiveName(p);
    const binary = binaryName(p);
    const lines = [
        `unown ${version} (${p})`,
        "",
        `Contents: ${binary}, VERSION (${version}), LICENSE, INSTALL.txt.`,
        "",
        "This archive is the standalone build of the unown terminal agent: no bun,",
        "no clone, no repo. Extract it and run the binary.",
        "",
        os === "windows"
            ? `  Expand-Archive ${archive} -DestinationPath $env:LOCALAPPDATA   # or unzip / double-click`
            : `  tar -xzf ${archive} -C ~/.local/share                            # creates ${dir}/`,
        os === "windows"
            ? `  $env:Path += ";$env:LOCALAPPDATA\\${dir}"`
            : `  export PATH="$HOME/.local/share/${dir}:$PATH"                    # or put ${binary} on PATH`,
        "  unown --version",
        "",
        "Verify what you downloaded against the release's sha256sums.txt:",
    ];
    if (os === "darwin") {
        lines.push(
            `  grep "  ${archive}$" sha256sums.txt | shasum -a 256 -c -`,
            "  (shasum has no --ignore-missing; the grep limits the check to this archive.)",
        );
    } else if (os === "windows") {
        lines.push(
            `  Get-FileHash .\\${archive} -Algorithm SHA256`,
            `  # compare the hash with the ${archive} line in sha256sums.txt`,
        );
    } else {
        lines.push(
            "  sha256sum -c --ignore-missing sha256sums.txt",
            "  (the manifest also covers version.txt and the installers; --ignore-missing",
            "   skips the ones you did not download)",
        );
    }
    lines.push(
        "",
        "Binary updates verify the release manifest (release.json), including the",
        "archive's exact size and SHA-256, before activating it; sha256sums.txt",
        "remains the manual checksum and installer path.",
        "",
        "Update and uninstall (both install modes):",
        "  unown update                     # checkout: git fast-forward; binary install: verified release download",
        "  unown uninstall [--dry-run] [--purge-data]",
        `  (a hand-extracted archive has no install metadata: replace ${binary} manually and delete ${dir}/.)`,
        "",
    );
    if (os === "darwin") {
        lines.push(
            "macOS note: these builds are NOT signed or notarized, so Gatekeeper",
            "quarantines the first run. Either of:",
            `  xattr -d com.apple.quarantine ${binary}     # once, after extracting`,
            "  or in Finder: right-click > Open",
            "",
        );
    }
    if (os === "windows") {
        lines.push(
            "Windows note: this build is NOT code-signed, so SmartScreen may show",
            `"Windows protected your PC" — choose "More info" > "Run anyway", or`,
            `  Unblock-File ${binary}                      # in PowerShell`,
            "",
        );
    }
    lines.push(
        "First run: `unown setup` connects a model provider, then `unown` starts a",
        "session in the current directory. `unown doctor` checks the whole path.",
        "",
        "This channel ships the CLI only. The learning engine, llm-bridge and the",
        "dashboard's data source run from the repository: see README.md + docs/install.md.",
        "",
    );
    return lines.join("\n");
}

/** Write version.txt and sha256sums.txt into the payload. The manifest covers
 *  the archives AND version.txt, sorted by file name, two-space separated so
 *  `sha256sum -c` (and `shasum -c`) read it. Exported so the unit suite can
 *  prove version.txt is written and covered without compiling a binary. */
export function writePayloadManifest(outDir: string, version: string, archives: string[]): void {
    const versionFile = join(outDir, "version.txt");
    writeFileSync(versionFile, `${version}\n`);
    const entries = [...archives, versionFile].map((file) => ({
        name: file.split(/[\\/]/).pop()!,
        hash: sha256(file),
    }));
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    writeFileSync(join(outDir, "sha256sums.txt"), `${entries.map((e) => `${e.hash}  ${e.name}`).join("\n")}\n`);
}

/**
 * mem0ai's OSS dist dynamically imports every optional store/embedder/LLM
 * backend it can drive (30 module ids, from `mongodb` to
 * `zeroentropy`). Only the SQLite vector store + the OpenAI SDK
 * (both hard deps) are ever exercised by unown's in-process platform, and the
 * optional ids are NOT installed in this repo — so the compile's module
 * resolution dies on the first one it meets ("Could not resolve: mongodb",
 * the post-Mem0-swap release-blocker: v0.0.3 predates the swap, every
 * release:artifacts run after it failed at darwin-arm64). Marking them
 * --external leaves the lazy `import()` calls in the bundle as runtime
 * lookups: an optional backend a binary install never configures is never
 * imported, and the one lane that COULD want an optional package
 * (@huggingface/transformers, the local-ml ONNX embedder) is
 * install-on-demand by design — a compiled binary runs the deterministic
 * lexical embedder fallback either way (same posture as a source checkout
 * without `npm install` in local-ml).
 *
 * Node builtins appearing in the same dist (crypto/fs/os/path) resolve
 * natively and are deliberately NOT in this list.
 */
const MEM0_OPTIONAL_EXTERNALS = [
        "@azure/identity",
        "@azure/search-documents",
        "@elastic/elasticsearch",
        "@google-cloud/aiplatform",
        "@huggingface/transformers",
        "@langchain/core/documents",
        "@langchain/core/messages",
        "@mistralai/mistralai",
        "@mochow/mochow-sdk-node",
        "@opensearch-project/opensearch",
        "@pinecone-database/pinecone",
        "@qdrant/js-client-rest",
        "@supabase/supabase-js",
        "@turbopuffer/turbopuffer",
        "@upstash/vector",
        "cassandra-driver",
        "chromadb",
        "cloudflare",
        "cohere-ai",
        "fastembed",
        "groq-sdk",
        "iovalkey",
        "mongodb",
        "mysql2/promise",
        "ollama",
        "oracledb",
        "pg",
        "redis",
        "weaviate-client",
        "zeroentropy",
];

function compile(bun: string, p: Platform, version: string, stageDir: string): string {
    const out = join(stageDir, binaryName(p));
    const args = [
        "build",
        "--compile",
        "--no-compile-autoload-bunfig",
        `--define`,
        `__UNOWN_VERSION__="${version}"`,
        `--target=${bunTarget(p)}`,
        ...MEM0_OPTIONAL_EXTERNALS.flatMap((id) => ["--external", id]),
        ENTRY,
        WORKER,
        "--outfile",
        out,
    ];
    const code = run(bun, args, { cwd: REPO_ROOT });
    if (code !== 0) die(`${sym.fail} compile failed for ${p} (exit ${code})`, code);
    if (!existsSync(out)) die(`${sym.fail} ${p}: compile exited 0 but produced no binary at ${out}`);
    const size = statSync(out).size;
    if (size < MIN_BINARY_BYTES) {
        die(`${sym.fail} ${p}: binary is ${size} bytes — under the ${MIN_BINARY_BYTES} floor, so the bundle lost its import graph (a no-op stub). Refusing to ship.`);
    }
    if (!IS_WIN && (p.startsWith("linux") || p.startsWith("darwin"))) run("chmod", ["755", out]);
    return out;
}

function makeArchive(stageParent: string, p: Platform, outDir: string): string {
    // Absolute, always: the zip branch runs with cwd=stageParent, so a
    // repo-root-relative archive path resolves INSIDE the stage dir — a
    // directory that does not exist, and zip dies with "Could not create
    // output file" (first exercised by the v0.0.1 release build, run
    // 39609534703: every earlier release predates the six-binary pipeline,
    // and the plan gate only ever ran --dry-run). Absolute is equally correct
    // for tar (repo-root cwd) and the Windows bsdtar branch.
    const archive = resolve(join(outDir, archiveName(p)));
    // Wrapper dir inside the archive, both formats, so extracting never dumps a
    // bare binary into the cwd.
    if (IS_WIN) {
        // Windows' tar is bsdtar and picks the format from the extension; it
        // writes both zip and tar.gz. The absolute System32 path is required:
        // under Git Bash, bare `tar` is GNU tar, which has no zip writer and
        // treats `C:\...` as a remote host (`Cannot connect to C:`), silently
        // failing every non-Windows archive too. The magic-byte check below
        // turns that class of silent corruption into a build failure.
        const bsdtar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
        if (!existsSync(bsdtar)) {
            die(`${sym.fail} ${p}: need ${bsdtar} (bsdtar) to write an archive; build on the ubuntu runner instead`);
        }
        const code = run(bsdtar, ["-a", "-cf", archive, "-C", stageParent, `unown-${p}`]);
        if (code !== 0) die(`${sym.fail} bsdtar failed for ${p} (exit ${code})`, code);
        assertArchiveMagic(archive, archive.endsWith(".zip") ? "PK" : "1f8b", p);
        return archive;
    }
    if (archive.endsWith(".tar.gz")) {
        const code = run("tar", ["-czf", archive, "-C", stageParent, `unown-${p}`]);
        if (code !== 0) die(`${sym.fail} tar failed for ${p} (exit ${code})`, code);
        assertArchiveMagic(archive, "1f8b", p);
        return archive;
    }
    const z = run("zip", ["-qr", archive, `unown-${p}`], { cwd: stageParent });
    if (z !== 0) die(`${sym.fail} zip failed for ${p} (exit ${z}) — install zip, or run this build on the ubuntu runner`, z);
    assertArchiveMagic(archive, "PK", p);
    return archive;
}

/** A release asset is only as trustworthy as its format: check the leading
 *  bytes say what the file name claims before anything consumes it. */
function assertArchiveMagic(archive: string, expected: "PK" | "1f8b", p: Platform): void {
    const head = readFileSync(archive).subarray(0, 2);
    const hex = head.toString("hex");
    const want = expected === "PK" ? Buffer.from("PK").toString("hex") : "1f8b";
    if (hex !== want) {
        die(
            `${sym.fail} ${p}: ${archive.split(/[\\/]/).pop()} starts with 0x${hex}, not the expected ` +
                `0x${want} — the archive is not the format its name claims. Refusing to ship it.`,
        );
    }
}

const BUN = process.execPath;

function main(): void {
    const opts = parseArgs(process.argv.slice(2));
    const version = readVersion();

    if (!existsSync(ENTRY)) die(`${sym.fail} entry module missing: ${ENTRY}`);
    if (!existsSync(LICENSE)) die(`${sym.fail} license file missing: ${LICENSE}`);
    if (!existsSync(WORKER)) {
        die(
            `${sym.fail} pi worker module missing: ${WORKER}\n` +
                `    the vendored pi workspace must be built first:  bun run agent:install`,
        );
    }

    if (opts.dryRun) {
        console.log(
            `version ${version} — plan only, nothing built (archives carry VERSION/LICENSE/INSTALL.txt; output adds version.txt)`,
        );
        for (const p of opts.platforms) {
            console.log(`${p}\t${bunTarget(p)}\t${binaryName(p)}\t${archiveName(p)}`);
        }
        process.exit(0);
    }

    const stageParent = join(opts.out, "stage");
    rmSync(stageParent, { recursive: true, force: true });
    mkdirSync(stageParent, { recursive: true });
    const license = readFileSync(LICENSE);
    const archives: string[] = [];
    for (const p of opts.platforms) {
        const stageDir = join(stageParent, `unown-${p}`);
        mkdirSync(stageDir, { recursive: true });
        // zip APPENDS to an existing archive, which would duplicate the binary
        // inside it; every archive starts from nothing.
        rmSync(join(opts.out, archiveName(p)), { force: true });
        console.log(`${sym.step} ${p} (${bunTarget(p)})…`);
        compile(BUN, p, version, stageDir);
        if (IS_WIN && !isWindows(p)) {
            // NTFS has no POSIX mode bits, and tar records what the host sees — so
            // a unix archive built on Windows ships WITHOUT the exec bit (measured:
            // `Permission denied` on first run after extracting). The release
            // workflow builds on ubuntu, where chmod 755 lands in the archive; a
            // local Windows build is for inspection only.
            console.log(
                `${sym.dot} ${p}: built on Windows — exec bit NOT in the archive. ` +
                    `Run "chmod +x ${binaryName(p)}" after extracting, or build on Linux/macOS.`,
            );
        }
        writeFileSync(join(stageDir, "VERSION"), `${version}\n`);
        writeFileSync(join(stageDir, "LICENSE"), license);
        writeFileSync(join(stageDir, "INSTALL.txt"), installNotes(p, version));
        archives.push(makeArchive(stageParent, p, opts.out));
    }

    // version.txt + sha256sums.txt (archives + version.txt). The release
    // workflow rewrites the manifest to also cover the SBOM, checklist and
    // installers; this local copy is complete for the payload the builder
    // produced, so a local build is verifiable too.
    writePayloadManifest(opts.out, version, archives);
    rmSync(stageParent, { recursive: true, force: true });

    console.log(`\n${sym.ok} ${archives.length} artifacts for unown ${version} in ${opts.out}`);
    for (const name of readdirSync(opts.out).sort()) {
        const size = statSync(join(opts.out, name)).size;
        console.log(`  ${name}\t${(size / 1048576).toFixed(1)} MiB`);
    }
}

if (import.meta.main) main();
