/**
 * project-settings.ts — the per-project session settings layer
 * (`.unown/settings.json`, the 2026-10-24 flow round; Claude Code's
 * committed `.claude/settings.json` / Gemini's workspace `.gemini/settings.json`
 * / Codex's project `.codex/config.toml` parity — the layer every competitor
 * ships and Unown lacked: model/provider/effort pinning per repository, so a
 * repo that wants `agnes-2.5-flash` for docs work or `acceptEdits` for its
 * sandbox gets it without every contributor hand-editing ~/.unown).
 *
 * Contract:
 *   - File: `<project>/.unown/settings.json` — TRUST-GATED exactly like
 *     `.unown/mcp.json` / `.unown/lsp.json` / `.unown/permissions.json`
 *     (config-trust.ts fingerprint pinning; a cloned repo is
 *     attacker-controlled — an untrusted file's keys are IGNORED, boot prints
 *     one notice, `/project-settings trust` approves it). The user-level
 *     defaults keep living where they are (~/.unown/agent/settings.json for
 *     pi's own defaults, env vars for the bridge) — this layer only adds the
 *     project scope between them and the CLI flags.
 *   - Precedence (high wins): CLI flags → project settings → user defaults.
 *     The overlay MERGES UNDER the BootOptions: a field the flag already set
 *     is never overwritten.
 *   - Keys (schema v1, all optional): `model`, `provider`, `effort`
 *     (low|medium|high), `permissionMode` (default|acceptEdits|
 *     bypassPermissions), `addDirs` (array of additional working directories —
 *     resolved relative to the PROJECT root at apply time; same trust basis
 *     as every other key because the file is trust-gated, which is exactly
 *     what write-roots.ts's header demands of config-file-driven roots).
 *   - Unknown keys / wrong shapes warn and are ignored — never fatal.
 *   - Applied at BOOT (bootRuntime merges before anything consumes the
 *     fields); `/project-settings` shows the live state and trusts the file
 *     (effective from the next session — stated honestly in the command).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configFingerprint, trustApprovalNeeded, trustBypassed, trustConfig, trustStatePath } from "./config-trust.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

export type ProjectSettingsEffort = "low" | "medium" | "high";
export type ProjectSettingsPermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** The validated overlay (only well-shaped keys survive). */
export interface ProjectSettings {
    model?: string;
    provider?: string;
    effort?: ProjectSettingsEffort;
    permissionMode?: ProjectSettingsPermissionMode;
    addDirs?: string[];
}

export interface ProjectSettingsStatus {
    path: string;
    found: boolean;
    trusted: boolean;
    /** Untrusted-but-present: keys ignored until approved. */
    ignored: boolean;
    settings: ProjectSettings;
    warnings: string[];
}

const EFFORTS = new Set(["low", "medium", "high"]);
const MODES = new Set(["default", "acceptEdits", "bypassPermissions"]);
const KNOWN_KEYS = new Set(["version", "model", "provider", "effort", "permissionMode", "addDirs"]);

/** The project settings file path (exported for tests + the command surface). */
export function projectSettingsPath(projectDir: string): string {
    return join(projectDir, ".unown", "settings.json");
}

/** Parse + validate one document. Unknown keys warn; wrong shapes warn and
 *  drop the key. NEVER throws (a bad project file must not kill the boot). */
export function parseProjectSettings(doc: unknown): { settings: ProjectSettings; warnings: string[] } {
    const warnings: string[] = [];
    const settings: ProjectSettings = {};
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
        return { settings, warnings: ["project settings file is not a JSON object — ignored"] };
    }
    const obj = doc as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
        if (!KNOWN_KEYS.has(key)) {
            warnings.push(`unknown key "${key}" ignored (known: model, provider, effort, permissionMode, addDirs)`);
        }
    }
    if (typeof obj.model === "string" && obj.model.trim()) settings.model = obj.model.trim();
    else if (obj.model !== undefined) warnings.push('"model" must be a non-empty string — ignored');
    if (typeof obj.provider === "string" && obj.provider.trim()) settings.provider = obj.provider.trim();
    else if (obj.provider !== undefined) warnings.push('"provider" must be a non-empty string — ignored');
    if (obj.effort !== undefined) {
        if (typeof obj.effort === "string" && EFFORTS.has(obj.effort)) settings.effort = obj.effort as ProjectSettingsEffort;
        else warnings.push(`"effort" must be one of low|medium|high — ignored (got ${JSON.stringify(obj.effort)})`);
    }
    if (obj.permissionMode !== undefined) {
        if (typeof obj.permissionMode === "string" && MODES.has(obj.permissionMode))
            settings.permissionMode = obj.permissionMode as ProjectSettingsPermissionMode;
        else warnings.push(`"permissionMode" must be one of default|acceptEdits|bypassPermissions — ignored (got ${JSON.stringify(obj.permissionMode)})`);
    }
    if (obj.addDirs !== undefined) {
        if (Array.isArray(obj.addDirs) && obj.addDirs.every((d) => typeof d === "string" && d.trim())) {
            settings.addDirs = (obj.addDirs as string[]).map((d) => d.trim()).filter(Boolean);
        } else {
            warnings.push('"addDirs" must be an array of non-empty strings — ignored');
        }
    }
    return { settings, warnings };
}

/** Load the project settings (trust-gated). Never throws. */
export function loadProjectSettings(
    projectDir: string,
    opts: { env?: Record<string, string | undefined>; agentDir?: string; statePath?: string } = {},
): ProjectSettingsStatus {
    const env = opts.env ?? process.env;
    const agentDir = opts.agentDir ?? UNOWN_AGENT_DIR;
    const statePath = opts.statePath ?? trustStatePath(agentDir);
    const path = projectSettingsPath(projectDir);
    const empty: ProjectSettingsStatus = {
        path,
        found: false,
        trusted: false,
        ignored: false,
        settings: {},
        warnings: [],
    };
    if (!existsSync(path)) return empty;
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch {
        return { ...empty, found: true, warnings: [`${path} is unreadable — ignored`] };
    }
    let doc: unknown;
    try {
        doc = JSON.parse(text);
    } catch (err: any) {
        return { ...empty, found: true, warnings: [`${path} is not valid JSON — ignored (${err instanceof Error ? err.message : String(err)})`] };
    }
    const { settings, warnings } = parseProjectSettings(doc);
    const bypassed = trustBypassed(env);
    const needsApproval = !bypassed && trustApprovalNeeded(path, { statePath, userDir: agentDir, env });
    // A file whose fingerprint is recorded (or the env bypass) is trusted.
    const trusted = !needsApproval;
    return {
        path,
        found: true,
        trusted,
        ignored: !trusted,
        settings: trusted ? settings : {},
        warnings: trusted ? warnings : [...warnings, "project .unown/settings.json is UNTRUSTED — its keys are ignored (approve with /project-settings trust or set UNOWN_TRUST_PROJECT_CONFIG=1)"],
    };
}

/** Approve the project settings file (the /project-settings trust action). */
export function trustProjectSettings(
    projectDir: string,
    opts: { agentDir?: string; statePath?: string; env?: Record<string, string | undefined> } = {},
): { ok: boolean; note: string } {
    const env = opts.env ?? process.env;
    const agentDir = opts.agentDir ?? UNOWN_AGENT_DIR;
    const statePath = opts.statePath ?? trustStatePath(agentDir);
    const path = projectSettingsPath(projectDir);
    if (!existsSync(path)) return { ok: false, note: `no project .unown/settings.json at ${path} — nothing to trust` };
    if (trustBypassed(env)) return { ok: true, note: "UNOWN_TRUST_PROJECT_CONFIG is set — the trust gate is already bypassed" };
    if (!configFingerprint(path)) return { ok: false, note: `${path} is unreadable — cannot record a fingerprint` };
    const ok = trustConfig(path, { statePath, userDir: agentDir, env });
    return ok
        ? { ok: true, note: `trusted ${path} — its keys apply from your next session in this project` }
        : { ok: false, note: "recording the trust failed (unwritable trust state)" };
}

/** Render the /project-settings status card. */
export function renderProjectSettingsStatus(status: ProjectSettingsStatus): string {
    const lines: string[] = [];
    lines.push("unown project settings — .unown/settings.json (per-project session defaults)");
    if (!status.found) {
        lines.push(`  ${status.path} (not found — user defaults + CLI flags only)`);
        lines.push("  keys: model · provider · effort · permissionMode · addDirs — see docs/usage.md (trust-gated like every project config)");
        return lines.join("\n");
    }
    if (status.ignored) {
        lines.push(`  ${status.path} — UNTRUSTED (keys ignored until approved)`);
        lines.push("  → /project-settings trust  (or UNOWN_TRUST_PROJECT_CONFIG=1 for CI)");
    } else {
        lines.push(`  ${status.path} — trusted`);
    }
    const s = status.settings;
    const entries: string[] = [];
    if (s.model) entries.push(`model: ${s.model}`);
    if (s.provider) entries.push(`provider: ${s.provider}`);
    if (s.effort) entries.push(`effort: ${s.effort}`);
    if (s.permissionMode) entries.push(`permissionMode: ${s.permissionMode}`);
    if (s.addDirs?.length) entries.push(`addDirs: ${s.addDirs.join(", ")}`);
    if (entries.length === 0) lines.push("  keys: (none set — the file is trusted but empty)");
    else for (const e of entries) lines.push(`  ${e}`);
    for (const w of status.warnings) lines.push(`  ⚠ ${w}`);
    lines.push("  precedence: CLI flags > project settings > user defaults — effective from session start");
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The /project-settings session command (inline extension — the /mcp trust /
// /permissions trust pattern). Bare: status. `trust`: approve the file.
// ---------------------------------------------------------------------------

export interface ProjectSettingsExtensionOptions {
    cwd: string;
    agentDir?: string;
    env?: Record<string, string | undefined>;
    verbose?: boolean;
    statePath?: string;
}

export function createProjectSettingsExtension(opts: ProjectSettingsExtensionOptions) {
    const cwd = opts.cwd;
    const agentDir = opts.agentDir ?? UNOWN_AGENT_DIR;
    const env = opts.env ?? process.env;
    const statePath = opts.statePath ?? trustStatePath(agentDir);
    const log = (msg: string) => {
        if (opts.verbose) console.error(`[unown] project-settings: ${msg}`);
    };
    const factory = (pi: any) => {
        pi.registerCommand("project-settings", {
            description:
                "Per-project session defaults (.unown/settings.json — model/provider/effort/permissionMode/addDirs, trust-gated): /project-settings [trust]",
            handler: async (args: string, ctx: any) => {
                try {
                    const sub = ((args ?? "").trim().split(/\s+/)[0] ?? "").toLowerCase();
                    if (sub === "trust") {
                        const res = trustProjectSettings(cwd, { agentDir, statePath, env });
                        ctx?.ui?.notify?.(res.note, res.ok ? "info" : "error");
                        if (res.ok) {
                            const status = loadProjectSettings(cwd, { agentDir, statePath, env });
                            ctx?.ui?.notify?.(renderProjectSettingsStatus(status), "info");
                        }
                        return;
                    }
                    if (sub !== "") {
                        ctx?.ui?.notify?.(`Unknown /project-settings argument "${sub}". Usage: /project-settings [trust]`, "info");
                        return;
                    }
                    const status = loadProjectSettings(cwd, { agentDir, statePath, env });
                    log(`status: found=${status.found} trusted=${status.trusted}`);
                    ctx?.ui?.notify?.(renderProjectSettingsStatus(status), "info");
                } catch (err: any) {
                    ctx?.ui?.notify?.(`project-settings command failed: ${err instanceof Error ? err.message : String(err)}`, "error");
                }
            },
        });
    };
    return { name: "unown-project-settings", factory, hidden: true } as const;
}
