/**
 * verify_sandbox.mjs — engine-level verification of the bubblewrap OS sandbox.
 *
 * Exercises the integration points the self-learning engine actually uses:
 *   1. bwrap resolution + availability probe (src/bwrap.ts)
 *   2. execInSandbox: isolation field + fs/net confinement (src/sandbox.ts)
 *   3. verifyInSandbox: a verify script that itself asserts isolation
 *   4. the generated sandbox shell wrapper used as the agent bash tool shell
 *
 * Run: bun /home/z/my-project/scripts/verify_sandbox.mjs
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKG = "/home/z/my-project/pi-repo/packages/self-learning/src";
const { osSandboxAvailable, resolveBwrapPath, writeSandboxShell } = await import(`${PKG}/bwrap.ts`);
const { createSandbox, seedFiles, execInSandbox, verifyInSandbox } = await import(`${PKG}/sandbox.ts`);

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

        const r3 = await execInSandbox(sb, ["/bin/sh", "-c", "test ! -e /home/z/my-project/package.json && test ! -e /home/z/my-project/src && test ! -e /home/z/.unown"]);
        check("repo content invisible (mount chain only)", r3.exitCode === 0, `exit=${r3.exitCode}`);

        const r4 = await execInSandbox(sb, ["/bin/sh", "-c", "cat /home/z/my-project/.env"]);
        check("secrets unreadable", r4.exitCode !== 0, `exit=${r4.exitCode}`);

        const r5 = await execInSandbox(sb, [
                "/usr/bin/python3",
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
                        "const isolated = !existsSync('/home/z/my-project/package.json') && !existsSync('/home/z/my-project/.env') && !existsSync('/home/z/.unown');",
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
                const proc = Bun.spawn([shell, "-c", "pwd; test ! -e /home/z/my-project/package.json && echo no-repo"], {
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
process.exit(fail > 0 ? 1 : 0);
