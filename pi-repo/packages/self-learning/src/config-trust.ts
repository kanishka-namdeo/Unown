/**
 * config-trust.ts — project-config trust gate (H2, audit M-01/L-07).
 *
 * Problem: `.unown/mcp.json` and `.unown/lsp.json` inside a project configure
 * arbitrary command execution (stdio `command`, project LSP server overrides).
 * A cloned repo is attacker-controlled, so loading them silently is RCE — the
 * top security gap in the R-a audit. Files under `~/.unown/agent/` are
 * user-owned and always trusted.
 *
 * Semantics — REFUSE FIRST (this is a TUI/agent context: no module-level
 * interactive prompt exists). An untrusted project config is never loaded or
 * executed; the status surfaces (`/mcp`, `/lsp`) render the approval action
 * instead (`/mcp trust` in mcp.ts's extension command; `lspTrustGuidance()`
 * from lsp.ts until tools.ts wires `/lsp trust`).
 *
 * Approval pins a FINGERPRINT (sha256 over the resolved absolute path + the
 * file bytes), so a config that changed since approval — or a same-named file
 * in a different checkout — re-enters the gated state.
 *
 * Env escape (CI/headless): `UNOWN_TRUST_PROJECT_CONFIG=1` (or `=true`)
 * bypasses the gate entirely. Any other value (unset, `0`, `never`) keeps the
 * gate on.
 *
 * Purity: fs + crypto only (atomic writes via ./atomic.ts, the same crash-safe
 * pattern the memory/checkpoint state files use) — no pi imports, fully
 * unit-testable. The trust state is a small JSON file, read-modify-written
 * atomically; a concurrent two-process race is last-writer-wins on the record
 * list, which only costs a re-approval, never a wrong execution.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

/** The env knob that bypasses the gate (CI/headless). */
export const TRUST_BYPASS_ENV = "UNOWN_TRUST_PROJECT_CONFIG";

/**
 * Where trust state lives: `<agentDir>/trusted-configs.json`. Default agentDir
 * is `~/.unown/agent` (UNOWN_HOME-respecting, same source as term.ts); config
 * resolution passes its own userDir so tests (and any redirected UNOWN_HOME)
 * get a colocated, isolated state file.
 */
export function trustStatePath(agentDir: string = UNOWN_AGENT_DIR): string {
    return join(agentDir, "trusted-configs.json");
}

export interface TrustedConfigRecord {
    /** sha256(absPath + "\n" + fileBytes) — pins both location and content. */
    fingerprint: string;
    /** Absolute path as recorded at approval time (diagnostics only). */
    path: string;
    /** ms-epoch of the approval. */
    trustedAt: number;
}

export interface TrustState {
    version: 1;
    trusted: TrustedConfigRecord[];
}

/**
 * Fresh empty state. NEVER a shared object: callers mutate the returned
 * state (trustConfig pushes records into it), so a shared empty-state would
 * alias-mutate across every loadTrust call (found by the round-trip test —
 * a corrupt/missing file returned the previous caller's records).
 */
function emptyState(): TrustState {
    return { version: 1, trusted: [] };
}

/**
 * Read the trust state. Missing or corrupt file → empty state (the gate then
 * refuses until (re-)approval — corrupt state can never authorize execution).
 */
export function loadTrust(statePath: string = trustStatePath()): TrustState {
    try {
        const raw = readFileSync(statePath, "utf8");
        const parsed = JSON.parse(raw) as TrustState;
        if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.trusted)) return emptyState();
        return {
            version: 1,
            trusted: parsed.trusted.filter(
                (r) => typeof r?.fingerprint === "string" && typeof r?.path === "string" && typeof r?.trustedAt === "number",
            ),
        };
    } catch {
        return emptyState();
    }
}

/** Persist the trust state (atomic write: tmp + fsync + rename, dir fsync). */
export function saveTrust(state: TrustState, statePath: string = trustStatePath()): void {
    atomicWriteFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Fingerprint a config file: sha256 over the resolved absolute path and the
 * raw bytes. Null when the file does not exist (nothing to fingerprint).
 */
export function configFingerprint(file: string): string | null {
    try {
        if (!existsSync(file)) return null;
        const abs = isAbsolute(file) ? file : resolve(file);
        const bytes = readFileSync(file);
        return createHash("sha256").update(abs).update("\n").update(bytes).digest("hex");
    } catch {
        return null;
    }
}

export interface TrustOptions {
    /** Trust state file (default: `trustStatePath()`). */
    statePath?: string;
    /**
     * The user-owned directory whose files are ALWAYS trusted. Defaults to the
     * directory of the state file — the state lives in the agent dir, so a
     * custom statePath automatically re-scopes the user dir with it.
     */
    userDir?: string;
    /** Env override (default process.env) — tests toggle the bypass knob. */
    env?: Record<string, string | undefined>;
}

function resolvedStatePath(opts: TrustOptions): string {
    return opts.statePath ?? trustStatePath();
}

function resolvedUserDir(opts: TrustOptions): string {
    return opts.userDir ?? dirname(resolvedStatePath(opts));
}

/** True when the env bypass (`UNOWN_TRUST_PROJECT_CONFIG=1|true`) is active. */
export function trustBypassed(env: Record<string, string | undefined> = process.env): boolean {
    const raw = env[TRUST_BYPASS_ENV];
    return raw === "1" || (typeof raw === "string" && raw.toLowerCase() === "true");
}

/** True when `file` lives inside the user-owned (always-trusted) directory. */
export function isUserScopedConfig(file: string, opts: TrustOptions = {}): boolean {
    const abs = isAbsolute(file) ? file : resolve(file);
    const userDir = resolvedUserDir(opts);
    // path.relative is separator- and drive-aware per platform (win32
    // backslashes, drive letters) — a plain sub-path result (no leading "..",
    // not absolute) means abs is INSIDE userDir; "" means abs IS userDir.
    // This also kills the sibling-spoof case: <userDir>-evil is a "../.." hop,
    // and a different drive's absolute path comes back absolute.
    const rel = relative(userDir, abs);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Does `file` carry a matching approval record? User-scoped files are always
 * trusted; a project file needs a fingerprint match (content AND location).
 * Does NOT consult the env bypass — use `trustApprovalNeeded` for the policy.
 */
export function isConfigTrusted(file: string, opts: TrustOptions = {}): boolean {
    if (isUserScopedConfig(file, opts)) return true;
    const fingerprint = configFingerprint(file);
    if (!fingerprint) return false; // missing files have nothing approved
    return loadTrust(resolvedStatePath(opts)).trusted.some((r) => r.fingerprint === fingerprint);
}

/**
 * Approve `file` (records its current fingerprint). Idempotent. Returns true
 * when the record was written; false when the file does not exist or the
 * write failed (the gate then stays closed — never a silent success).
 */
export function trustConfig(file: string, opts: TrustOptions = {}): boolean {
    const fingerprint = configFingerprint(file);
    if (!fingerprint) return false;
    const statePath = resolvedStatePath(opts);
    const state = loadTrust(statePath);
    if (!state.trusted.some((r) => r.fingerprint === fingerprint)) {
        state.trusted.push({ fingerprint, path: isAbsolute(file) ? file : resolve(file), trustedAt: Date.now() });
    }
    try {
        saveTrust(state, statePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * THE gate. True when loading `file` requires approval first: project-scoped
 * (outside the user dir), existing, not yet trusted, and the env bypass is
 * off. Everything else (user-owned, missing, approved, bypassed) → false.
 */
export function trustApprovalNeeded(file: string, opts: TrustOptions = {}): boolean {
    if (trustBypassed(opts.env ?? process.env)) return false;
    if (isUserScopedConfig(file, opts)) return false;
    if (!existsSync(file)) return false;
    return !isConfigTrusted(file, opts);
}
