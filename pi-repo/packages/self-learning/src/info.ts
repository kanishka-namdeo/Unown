/**
 * info.ts — `unown info`: the bug-report support bundle.
 *
 * Everything a maintainer needs and NOTHING they must not: version, platform,
 * toolchain, git state, provider NAMES (never keys — auth.json is never read,
 * only stat'd), memory paths with sizes, update-check state, and which
 * opt-outs are active. The output is safe to paste straight into a GitHub
 * issue; `--json` gives the same fields for scripts.
 *
 * Redaction rules (pinned by test):
 *   - provider baseUrl passes through redactUrl (credential-bearing URLs are
 *     stripped the same way the updater strips the git remote)
 *   - auth.json: existence + file mode only, contents never read
 *   - env dump: ONLY the known-safe UNOWN_ / PI_ booleans, never arbitrary env
 *     (the process env may carry API keys set by the user's shell)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { join } from "node:path";
import { describeAge, readRootVersion, readUpdateCheckCache, redactUrl, unownHome } from "./update.ts";

export interface InfoCtx {
        repoRoot?: string;
        home?: string;
        env?: NodeJS.ProcessEnv;
        log?: (line: string) => void;
}

export interface UnownInfo {
        unownVersion: string;
        git: { sha: string | null; branch: string | null; dirty: boolean | null; repoRoot: string | null };
        platform: { os: string; arch: string; release: string; bun: string | null };
        providers: { id: string; baseUrl: string | null; models: number }[];
        engineUrl: string;
        updateCheck: { latest: string; checkedAt: string; age: string } | null;
        state: { home: string; agentDirExists: boolean; authFile: { exists: boolean; mode: number | null } };
        optOuts: string[];
}

function gitLines(repoRoot: string): { sha: string | null; branch: string | null; dirty: boolean | null } {
        const run = (args: string[]): string | null => {
                const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", timeout: 15_000 });
                return r.status === 0 ? (r.stdout ?? "").trim() : null;
        };
        return {
                sha: run(["rev-parse", "--short", "HEAD"]),
                branch: run(["symbolic-ref", "--quiet", "--short", "HEAD"]),
                dirty: run(["status", "--porcelain"]) !== null ? run(["status", "--porcelain"]) !== "" : null,
        };
}

/** Collect the info bundle (pure data; rendering stays separate). */
export function collectInfo(ctx: InfoCtx = {}): UnownInfo {
        const env = ctx.env ?? process.env;
        const home = ctx.home ?? unownHome(env);
        const repoRoot =
                ctx.repoRoot ??
                (() => {
                        const guess = join(import.meta.dir, "..", "..", "..", "..");
                        return existsSync(guess) ? guess : null;
                })();
        const version = repoRoot ? readRootVersion(repoRoot) : "unknown";
        const git: UnownInfo["git"] = repoRoot
                ? { ...gitLines(repoRoot), repoRoot }
                : { sha: null, branch: null, dirty: null, repoRoot: null };

        // providers: NAMES + counts + redacted baseUrl; auth.json never read
        const providers: UnownInfo["providers"] = [];
        const modelsPath = join(home, "agent", "models.json");
        if (existsSync(modelsPath)) {
                try {
                        const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as {
                                providers?: Record<string, { baseUrl?: string; models?: { id?: string }[] }>;
                        };
                        for (const [id, def] of Object.entries(parsed.providers ?? {})) {
                                providers.push({
                                        id,
                                        baseUrl: def.baseUrl ? redactUrl(def.baseUrl) : null,
                                        models: Array.isArray(def.models) ? def.models.length : 0,
                                });
                        }
                } catch {
                        // unreadable models.json — report nothing rather than guess
                }
        }

        const bunVersion = (() => {
                const r = spawnSync(process.execPath, ["--version"], { encoding: "utf8", timeout: 10_000 });
                return r.status === 0 ? (r.stdout ?? "").trim() : null;
        })();

        const optOuts: string[] = [];
        if (env.NO_UPDATE_NOTIFIER !== undefined) optOuts.push("NO_UPDATE_NOTIFIER");
        if (/^(1|true|yes)$/i.test(env.UNOWN_DISABLE_AUTOUPDATE ?? "")) optOuts.push("UNOWN_DISABLE_AUTOUPDATE");
        if (/^(1|true|yes)$/i.test(env.UNOWN_DISABLE_UPDATES ?? "")) optOuts.push("UNOWN_DISABLE_UPDATES");
        if (/^(1|true|yes)$/i.test(env.DO_NOT_TRACK ?? "")) optOuts.push("DO_NOT_TRACK");
        if (/^(1|true|yes)$/i.test(env.UNOWN_STRICT_HOOKS ?? "")) optOuts.push("UNOWN_STRICT_HOOKS");
        if (/^(1|true|yes)$/i.test(env.UNOWN_NO_PREFLIGHT ?? "")) optOuts.push("UNOWN_NO_PREFLIGHT");
        // granular permissions layer (docs/permissions.md): both directions are
        // worth seeing in a bug report — the whole layer off, or learning on.
        if (/^(0|false|no)$/i.test(env.UNOWN_PERMISSIONS ?? "")) optOuts.push("UNOWN_PERMISSIONS=0");
        if (/^(1|true|yes)$/i.test(env.UNOWN_PERMISSIONS_LEARN ?? "")) optOuts.push("UNOWN_PERMISSIONS_LEARN");

        const cache = readUpdateCheckCache(home);

        const authPath = join(home, "agent", "auth.json");
        let authMode: number | null = null;
        if (existsSync(authPath)) {
                try {
                        authMode = statSync(authPath).mode & 0o777;
                } catch {
                        authMode = null;
                }
        }

        return {
                unownVersion: version,
                git,
                platform: { os: platform(), arch: arch(), release: release(), bun: bunVersion },
                providers,
                engineUrl: env.UNOWN_ENGINE_URL ?? "http://127.0.0.1:3030",
                updateCheck: cache?.checkedAt
                        ? { latest: cache.latest, checkedAt: cache.checkedAt, age: describeAge(cache.checkedAt) }
                        : null,
                state: {
                        home,
                        agentDirExists: existsSync(join(home, "agent")),
                        authFile: { exists: existsSync(authPath), mode: authMode },
                },
                optOuts,
        };
}

/** Human rendering — paste-safe for bug reports. */
export function renderInfo(i: UnownInfo): string {
        const lines: string[] = [];
        lines.push(`unown ${i.unownVersion} — support info`);
        lines.push(`  platform:   ${i.platform.os} ${i.platform.arch} (${i.platform.release})`);
        lines.push(`  bun:        ${i.platform.bun ?? "unknown"}`);
        lines.push(
                `  git:        ${i.git.sha ?? "?"} ${i.git.branch ? `(${i.git.branch})` : "(detached)"}${i.git.dirty ? " · dirty" : ""}`,
        );
        lines.push(`  checkout:   ${i.git.repoRoot ?? "(not found)"}`);
        lines.push(
                `  state:      ${i.state.home} (agent dir ${i.state.agentDirExists ? "present" : "missing"}, auth.json ${i.state.authFile.exists ? `mode ${i.state.authFile.mode ?? "?"}` : "absent"})`,
        );
        if (i.providers.length) {
                lines.push(
                        `  providers:  ${i.providers.map((p) => `${p.id} (${p.models} model${p.models === 1 ? "" : "s"}${p.baseUrl ? `, ${p.baseUrl}` : ""})`).join(", ")}`,
                );
        } else {
                lines.push(`  providers:  none configured (run: unown setup)`);
        }
        lines.push(`  engine url: ${i.engineUrl}`);
        lines.push(
                `  update:     ${i.updateCheck ? `last check ${i.updateCheck.age} — latest seen: ${i.updateCheck.latest || "?"}` : "never checked"}`,
        );
        lines.push(`  opt-outs:   ${i.optOuts.length ? i.optOuts.join(", ") : "none"}`);
        return lines.join("\n");
}

/** `unown info [--json]` — returns the exit code. */
export function cmdInfo(json: boolean, ctx: InfoCtx = {}): number {
        const log = ctx.log ?? ((l: string) => console.log(l));
        const info = collectInfo(ctx);
        if (json) {
                log(JSON.stringify(info, null, 2));
        } else {
                log(renderInfo(info));
                log("");
                log("  paste this into your bug report: https://github.com/kanishka-namdeo/Unown/issues");
        }
        return 0;
}
