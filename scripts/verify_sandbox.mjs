/**
 * verify_sandbox.mjs — engine-level verification of the bubblewrap OS sandbox.
 *
 * Exercises the integration points the self-learning engine actually uses:
 *   1. bwrap resolution + availability probe (src/bwrap.ts)
 *   2. execInSandbox: isolation field + fs/net confinement (src/sandbox.ts)
 *   3. verifyInSandbox: a verify script that itself asserts isolation
 *   4. the generated sandbox shell wrapper used as the agent bash tool shell
 *
 * Repo-relative (M4): every path is derived from this file's location, so the
 * script runs from any checkout (developer machine, CI runner home). The
 * assertions themselves stay Linux-targeted — they exercise the bwrap backend,
 * which is a Linux surface (src/bwrap.ts gates non-linux hosts to null).
 *
 * The engine DB/data are redirected to a scratch dir (same pattern as the
 * test suite's test/_env.ts) BEFORE the src imports below, so this smoke
 * never opens the live engine database.
 *
 * Run: bun scripts/verify_sandbox.mjs
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const PKG = join(REPO_ROOT, "pi-repo", "packages", "self-learning", "src");
const HOST_HOME = homedir();

// Scratch engine state (must precede the src imports — store.ts opens its
// SQLite database at module scope).
const SMOKE_TMP = mkdtempSync(join(tmpdir(), "unown-verify-sandbox-"));
process.env.PI_SELFLEARNING_DB ??= join(SMOKE_TMP, "selflearning.db");
process.env.PI_SELFLEARNING_DATA ??= join(SMOKE_TMP, "data");
process.env.PI_BRIDGE_URL ??= "http://127.0.0.1:9"; // dead endpoint — never the live bridge

const { osSandboxAvailable, resolveBwrapPath, writeSandboxShell } = await import(`${PKG}/bwrap.ts`);
const { createSandbox, seedFiles, execInSandbox, verifyInSandbox } = await import(`${PKG}/sandbox.ts`);

// python3: prefer system locations — the bwrap profile hides /home, and the
// first python3 on PATH is often a $HOME venv that cannot run inside.
const PY_BIN =
        ["/usr/bin/python3", "/usr/local/bin/python3"].find((p) => existsSync(p)) ??
        Bun.which("python3") ??
        "/usr/bin/python3";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
        console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
        if (ok) pass++;
        else fail++;
};

// 1. availability ------------------------------------------------------------
const available = await osSandboxAvailable();
check("bwrap resolves", resolveBwrapPath() !== null, String(resolveBwrapPath()));
check("bwrap smoke (osSandboxAvailable)", available);

if (available) {
        // 2. execInSandbox --------------------------------------------------------
        const sb = createSandbox("verify-sandbox");
        seedFiles(sb, { "seed.txt": "seeded" });

        const r1 = await execInSandbox(sb, ["/bin/sh", "-c", "exit 7"]);
        check("execInSandbox reports isolation=bwrap", r1.isolation === "bwrap");
        check("execInSandbox propagates exit codes", r1.exitCode === 7, `exit=${r1.exitCode}`);

        const r2 = await execInSandbox(sb, ["/bin/sh", "-c", "echo ws > w.txt && cat w.txt seed.txt"]);
        check("workspace read/write works", r2.exitCode === 0 && r2.stdout.includes("seeded"));

        // Repo content invisible through the mount chain: the bwrap profile
        // tmpfs-mounts /home (this check assumes the checkout sits under $HOME's
        // tree, as it does on dev boxes and CI runners: /home/<user>/...).
        const r3 = await execInSandbox(sb, [
                "/bin/sh",
                "-c",
                `test ! -e '${REPO_ROOT}/package.json' && test ! -e '${REPO_ROOT}/src' && test ! -e '${HOST_HOME}/.unown'`,
        ]);
        check("repo content invisible (mount chain only)", r3.exitCode === 0, `exit=${r3.exitCode}`);

        const r4 = await execInSandbox(sb, ["/bin/sh", "-c", `cat '${REPO_ROOT}/.env'`]);
        check("secrets unreadable", r4.exitCode !== 0, `exit=${r4.exitCode}`);

        const r5 = await execInSandbox(sb, [
                PY_BIN,
                "-c",
                'import socket\ntry:\n\tsocket.create_connection(("deb.debian.org", 80), 3)\n\traise SystemExit(1)\nexcept Exception:\n\traise SystemExit(0)',
        ]);
        check("network egress blocked", r5.exitCode === 0, `exit=${r5.exitCode}`);

        const r6 = await execInSandbox(sb, ["bun", "-e", 'console.log("bun-ok")']);
        check("bun runs inside sandbox", r6.exitCode === 0 && r6.stdout.includes("bun-ok"));

        // 3. verifyInSandbox (the harness ground-truth path) ------------------------
        const vr = await verifyInSandbox(
                sb,
                [
                        "import { existsSync, writeFileSync } from 'node:fs';",
                        `const isolated = !existsSync('${REPO_ROOT}/package.json') && !existsSync('${REPO_ROOT}/.env') && !existsSync('${HOST_HOME}/.unown');`,
                        "let writable = false;",
                        "try { writeFileSync('verify-probe.txt', 'ok'); writable = true; } catch {}",
                        `const home = process.env.HOME;`,
                        `console.log('VERIFY_RESULT: ' + JSON.stringify({ passed: isolated && writable && home === '/tmp/home', summary: 'isolated=' + isolated + ' writable=' + writable + ' HOME=' + home }));`,
                ].join("\n"),
        );
        check("verifyInSandbox passes isolation self-test", vr.passed, vr.summary);

        // 4. sandbox shell wrapper (agent bash tool path) ---------------------------
        const agentDir = mkdtempSync(join(tmpdir(), "unown-agentdir-"));
        const shell = writeSandboxShell(agentDir);
        check("sandbox shell generated", shell !== null && existsSync(shell));
        if (shell) {
                const proc = Bun.spawn([shell, "-c", `pwd; test ! -e '${REPO_ROOT}/package.json' && echo no-repo`], {
                        cwd: sb.workspace,
                        stdout: "pipe",
                        stderr: "pipe",
                });
                const out = await new Response(proc.stdout).text();
                const code = await proc.exited;
                check("wrapper: bash -c runs under bwrap at real workspace path", code === 0 && out.trim().startsWith(sb.workspace) && out.includes("no-repo"), out.trim().slice(0, 120));
        }
        rmSync(agentDir, { recursive: true, force: true });
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
rmSync(SMOKE_TMP, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
