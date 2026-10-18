/**
 * config-trust.test.ts — the project-config trust gate (H2, audit M-01/L-07).
 *
 * Pins the RCE fix: an untrusted project `.unown/mcp.json`/`.unown/lsp.json`
 * must never authorize execution until approved; approval fingerprints BOTH
 * location and content, so a changed config re-enters the gated state; the
 * user-owned agent dir is always trusted; `UNOWN_TRUST_PROJECT_CONFIG`
 * bypasses for CI/headless.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
        TRUST_BYPASS_ENV,
        configFingerprint,
        isConfigTrusted,
        isUserScopedConfig,
        loadTrust,
        saveTrust,
        trustApprovalNeeded,
        trustBypassed,
        trustConfig,
        trustStatePath,
} from "../src/config-trust.ts";

const root = join(tmpdir(), `config-trust-${Date.now()}-${Math.random().toString(36).slice(2)}`);
mkdirSync(root, { recursive: true });

function freshUserDir(name: string): string {
        const dir = join(root, name);
        mkdirSync(dir, { recursive: true });
        return dir;
}

function writeProjectConfig(project: string, contents = { mcpServers: { s: { command: "x" } } }): string {
        const dir = join(project, ".unown");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "mcp.json");
        writeFileSync(file, JSON.stringify(contents));
        return file;
}

describe("config-trust (H2)", () => {
        test("trust state round-trips and tolerates a corrupt state file", () => {
                const userDir = freshUserDir("state");
                const statePath = trustStatePath(userDir);
                saveTrust({ version: 1, trusted: [{ fingerprint: "f".repeat(64), path: "/x", trustedAt: 1 }] }, statePath);
                const loaded = loadTrust(statePath);
                expect(loaded.trusted).toHaveLength(1);
                expect(loaded.version).toBe(1);
                // Corrupt state → empty, never a false authorization.
                // (Separate path: rewriting the same file the suite just
                // renamed over is flaky on overlayfs; the behavior under
                // test is "corrupt file → empty state".)
                const corruptPath = join(userDir, "corrupt-state.json");
                writeFileSync(corruptPath, "{not json");
                expect(loadTrust(corruptPath).trusted).toHaveLength(0);
                // Missing → empty.
                expect(loadTrust(join(userDir, "nope.json")).trusted).toHaveLength(0);
        });

        test("user-scoped configs are always trusted; siblings of the user dir are not", () => {
                const userDir = freshUserDir("scope");
                const inside = join(userDir, "mcp.json");
                writeFileSync(inside, "{}");
                expect(isUserScopedConfig(inside, { statePath: trustStatePath(userDir) })).toBe(true);
                // A sibling dir whose NAME starts with the user dir path must not spoof it.
                const sneaky = `${userDir}-evil/mcp.json`;
                expect(isUserScopedConfig(sneaky, { statePath: trustStatePath(userDir) })).toBe(false);
                // A project dir elsewhere is project-scoped.
                const project = join(root, "proj-scope");
                const projFile = writeProjectConfig(project);
                expect(isUserScopedConfig(projFile, { statePath: trustStatePath(userDir) })).toBe(false);
        });

        test("trustApprovalNeeded: refuse-first for fresh project configs; user files pass", () => {
                const userDir = freshUserDir("gate");
                const statePath = trustStatePath(userDir);
                const project = join(root, "proj-gate");
                const projFile = writeProjectConfig(project);
                const userFile = join(userDir, "mcp.json");
                writeFileSync(userFile, "{}");
                expect(trustApprovalNeeded(projFile, { statePath, userDir, env: {} })).toBe(true);
                expect(trustApprovalNeeded(userFile, { statePath, userDir, env: {} })).toBe(false);
                // Missing project file: nothing to gate.
                expect(trustApprovalNeeded(join(project, ".unown", "absent.json"), { statePath, userDir, env: {} })).toBe(false);
        });

        test("trustConfig approves; fingerprint pins content AND location", () => {
                const userDir = freshUserDir("approve");
                const statePath = trustStatePath(userDir);
                const project = join(root, "proj-approve");
                const file = writeProjectConfig(project);
                expect(trustConfig(file, { statePath, userDir })).toBe(true);
                expect(trustApprovalNeeded(file, { statePath, userDir, env: {} })).toBe(false);
                expect(isConfigTrusted(file, { statePath, userDir })).toBe(true);
                // CONTENT change → re-gated (fingerprint mismatch).
                writeFileSync(file, JSON.stringify({ mcpServers: { s: { command: "evil" } } }));
                expect(trustApprovalNeeded(file, { statePath, userDir, env: {} })).toBe(true);
                // LOCATION change (same bytes, different checkout) → re-gated.
                const otherProject = join(root, "proj-approve-clone");
                const otherFile = writeProjectConfig(otherProject);
                expect(trustApprovalNeeded(otherFile, { statePath, userDir, env: {} })).toBe(true);
                // Idempotent re-approval.
                expect(trustConfig(file, { statePath, userDir })).toBe(true);
                expect(trustConfig(file, { statePath, userDir })).toBe(true);
        });

        test("configFingerprint is stable and byte-sensitive; missing → null", () => {
                const project = join(root, "proj-fp");
                const file = writeProjectConfig(project);
                const a = configFingerprint(file);
                const b = configFingerprint(file);
                expect(a).toBe(b);
                expect(a).toHaveLength(64);
                writeFileSync(file, JSON.stringify({ mcpServers: {} }));
                expect(configFingerprint(file)).not.toBe(a);
                expect(configFingerprint(join(project, ".unown", "missing.json"))).toBeNull();
        });

        test("UNOWN_TRUST_PROJECT_CONFIG bypass: 1/true bypass, 0/never/unset keep the gate", () => {
                expect(trustBypassed({ [TRUST_BYPASS_ENV]: "1" })).toBe(true);
                expect(trustBypassed({ [TRUST_BYPASS_ENV]: "true" })).toBe(true);
                expect(trustBypassed({ [TRUST_BYPASS_ENV]: "TRUE" })).toBe(true);
                expect(trustBypassed({ [TRUST_BYPASS_ENV]: "0" })).toBe(false);
                expect(trustBypassed({ [TRUST_BYPASS_ENV]: "never" })).toBe(false);
                expect(trustBypassed({})).toBe(false);
                const userDir = freshUserDir("bypass");
                const statePath = trustStatePath(userDir);
                const project = join(root, "proj-bypass");
                const file = writeProjectConfig(project);
                expect(trustApprovalNeeded(file, { statePath, userDir, env: { [TRUST_BYPASS_ENV]: "1" } })).toBe(false);
                expect(trustApprovalNeeded(file, { statePath, userDir, env: {} })).toBe(true);
        });

        test("trustConfig refuses missing files (gate stays closed, no silent success)", () => {
                const userDir = freshUserDir("refuse");
                const statePath = trustStatePath(userDir);
                expect(trustConfig(join(root, "does-not-exist.json"), { statePath, userDir })).toBe(false);
        });

        test("saveTrust writes atomically (no .tmp leftovers)", () => {
                const userDir = freshUserDir("atomic");
                const statePath = trustStatePath(userDir);
                saveTrust({ version: 1, trusted: [] }, statePath);
                const leftovers = loadTrust(statePath); // readable = renamed into place
                expect(leftovers.version).toBe(1);
                // Direct check: no sibling temp files remain.
                const dirEntries = readdirSync(userDir) as string[];
                expect(dirEntries.filter((n) => n.includes(".tmp-"))).toEqual([]);
        });
});

// Cleanup after the suite (best-effort).
afterAll(() => {
        try {
                rmSync(root, { recursive: true, force: true });
        } catch {
                /* tmpdir — harmless */
        }
});

describe("config-trust aliasing regression (H2 fix)", () => {
    test("loadTrust returns a FRESH empty state — trustConfig on a missing state file cannot pollute later reads", () => {
        // Regression: loadTrust used to return a shared EMPTY_STATE object;
        // trustConfig mutated it (state.trusted.push), so a later corrupt or
        // missing state file returned the previous caller's records.
        const userDirA = freshUserDir("alias-a");
        const userDirB = freshUserDir("alias-b");
        const project = join(root, "alias-proj");
        const file = writeProjectConfig(project);

        // Caller A trusts with NO pre-existing state file (missing → the old
        // bug mutated the shared empty state).
        expect(trustConfig(file, { statePath: trustStatePath(userDirA), userDir: userDirA })).toBe(true);

        // Caller B reads a corrupt state file — must be empty, NOT A's records.
        const corrupt = join(userDirB, "corrupt.json");
        writeFileSync(corrupt, "{broken");
        const b = loadTrust(corrupt);
        expect(b.trusted).toHaveLength(0);
        // And a missing file too.
        expect(loadTrust(join(userDirB, "absent.json")).trusted).toHaveLength(0);
        // Two consecutive empty reads are independent objects.
        const e1 = loadTrust(join(userDirB, "absent.json"));
        const e2 = loadTrust(join(userDirB, "absent.json"));
        expect(e1).not.toBe(e2);
        expect(e1.trusted).toHaveLength(0);
        expect(e2.trusted).toHaveLength(0);
    });
});
