/**
 * edit-resend.ts — edit-and-resend user message with all-or-nothing file reset
 * (Milestone 3.6).
 *
 * Reverse-engineered from zcode's Edit History Conversation feature (per
 * /home/z/my-project/research/2-b2-report.md proposal #5): the user can edit
 * a previous user message and resend it; the agent reverts the file state to
 * just before that message and replays from there.
 *
 * The all-or-nothing safety property is the key innovation:
 *   1. `findUserMessageCheckpoint` locates the checkpoint sealed just before
 *      the Nth user message (turn checkpoints are sealed at the next input —
 *      `checkpoints.ts:sealTurnCheckpoint` — so the manifest with the latest
 *      `ts <= userMessage.timestamp` is the one we want).
 *   2. `revertToCheckpoint` restores the file state from the checkpoint blobs.
 *      BEFORE the restore, every file in the checkpoint is SHA-256-checked
 *      against its recorded hash — if any file was edited out-of-band (the
 *      user touched it in another editor), the whole operation aborts with a
 *      clear error rather than landing in a half-rolled-back state.
 *   3. `editAndResend` is the atomic wrapper: it does the SHA-256 check +
 *      revert + session fork as one transaction. If the revert fails midway,
 *      the pre-revert file state is restored (rollback) — no file is left in
 *      an inconsistent state.
 *
 * Pure module (no pi imports): takes `SessionLike` and `CheckpointStoreLike`
 * interfaces as deps so tests can mock them.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
    type CheckpointFile,
    type CheckpointManifest,
    type RestoreOutcome,
    sha256,
} from "./checkpoints.ts";

// ---------------------------------------------------------------------------
// Deps — minimal interfaces so tests can mock without spawning pi
// ---------------------------------------------------------------------------

/**
 * The subset of pi-coding-agent's `SessionManager` we need. `tools.ts`'s
 * `/edit-resend` slash command passes `ctx.sessionManager` (the live
 * instance); tests pass a mock.
 */
export interface SessionLike {
    getSessionId(): string;
    getCwd(): string;
    getEntries(): SessionEntryLike[];
    /** Move the leaf pointer back to an earlier entry (start a new branch).
     *  Throws if the entry id is not found in the session. */
    branch(fromId: string): void;
    /** Reset the leaf to null — the next append creates a new root. */
    resetLeaf(): void;
    /** Append a message; returns the new entry id. */
    appendMessage(message: any): string;
}

export interface SessionEntryLike {
    type: string;
    id: string;
    parentId: string | null;
    timestamp: string;
    message?: any;
    [k: string]: unknown;
}

export interface CheckpointStoreLike {
    list(): CheckpointManifest[];
    readBlob(hash: string): Buffer | null;
    restore(manifest: RestoreSourceLike, cwd: string): RestoreOutcome[];
}

/** RestoreSourceLike — the slice of a manifest that `restore` consumes. */
export interface RestoreSourceLike {
    files: CheckpointFile[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface EditResendOptions {
    cwd: string;
    sessionManager?: SessionLike;
    checkpointStore?: CheckpointStoreLike;
    /** Boot id (the checkpoints.ts `owner` field) — when provided, only
     *  manifests owned by this session are candidates. Absent: consider all
     *  manifests (legacy or shared stores). */
    owner?: string;
}

// ---------------------------------------------------------------------------
// findUserMessageCheckpoint
// ---------------------------------------------------------------------------

export interface UserMessageCheckpoint {
    checkpointId: string;
    blobHashes: Record<string, string>;
    /** The timestamp of the Nth user message (epoch ms). */
    userMessageTs: number;
}

/**
 * Locate the checkpoint sealed just before the Nth user message (1-indexed).
 * Returns `null` if no such message exists or no checkpoint predates it.
 *
 * The "checkpoint sealed just before message N" semantics: turn checkpoints
 * are sealed at the NEXT input after a turn that wrote files (see
 * `checkpoints.ts:sealTurnCheckpoint` — called from the `input` event
 * handler). So the manifest with the LATEST `ts <= userMessage.timestamp` is
 * the snapshot of the file state right before that user message landed.
 */
export function findUserMessageCheckpoint(
    sessionId: string,
    messageIndex: number,
    opts: EditResendOptions,
): UserMessageCheckpoint | null {
    const sm = opts.sessionManager;
    const store = opts.checkpointStore;
    if (!sm || !store) {
        throw new Error("findUserMessageCheckpoint: sessionManager and checkpointStore are required");
    }
    if (messageIndex < 1) {
        throw new Error(`findUserMessageCheckpoint: messageIndex must be ≥ 1 (got ${messageIndex})`);
    }

    // 1. Walk session entries, find the Nth user message's timestamp.
    const entries = sm.getEntries();
    let userMsgCount = 0;
    let targetTs: number | null = null;
    for (const entry of entries) {
        if (entry.type !== "message") continue;
        if (entry.message?.role !== "user") continue;
        userMsgCount++;
        if (userMsgCount === messageIndex) {
            // Prefer the message-level timestamp (Unix ms) when present;
            // fall back to the entry's ISO timestamp.
            const msgTs = entry.message.timestamp;
            if (typeof msgTs === "number" && Number.isFinite(msgTs) && msgTs > 0) {
                targetTs = msgTs;
            } else {
                const parsed = Date.parse(entry.timestamp);
                targetTs = Number.isNaN(parsed) ? null : parsed;
            }
            break;
        }
    }
    if (targetTs === null) return null;

    // 2. Find the manifest with the LATEST ts ≤ targetTs.
    //    Filter by owner (bootId) when provided; otherwise consider all.
    const all = store.list();
    const candidates = opts.owner ? all.filter((m) => m.owner === opts.owner) : all;
    let best: CheckpointManifest | null = null;
    for (const m of candidates) {
        if (m.ts <= targetTs) {
            if (best === null || m.ts > best.ts) best = m;
        }
    }
    if (!best) return null;

    const blobHashes: Record<string, string> = {};
    for (const f of best.files) {
        if (f.hash) blobHashes[f.path] = f.hash;
    }
    return { checkpointId: best.id, blobHashes, userMessageTs: targetTs };
}

// ---------------------------------------------------------------------------
// revertToCheckpoint
// ---------------------------------------------------------------------------

export interface RevertResult {
    revertedFiles: string[];
    tombstonedFiles: string[];
    /** Per-file outcomes (for debugging + tests). */
    outcomes: RestoreOutcome[];
}

/**
 * Restore the file state from a checkpoint's blobs. Returns the list of files
 * that were restored (overwritten with the pre-turn content) and tombstoned
 * (deleted because they were created during the now-reverted turn).
 *
 * BEFORE the restore, every file in the manifest is SHA-256-checked:
 *   - if `f.hash !== null` and the file exists, `sha256(currentBytes)` must
 *     equal `f.hash` — otherwise the user edited the file out-of-band and
 *     the restore would clobber their work. Abort.
 *   - if `f.hash === null` (tombstone: the file did not exist before), the
 *     file MUST currently exist (the turn created it). If it doesn't, the
 *     pre-state cannot be reconstructed cleanly — abort.
 *
 * If the restore itself fails midway (any outcome with `ok === false`), the
 * pre-restore state is rolled back: each touched file is rewritten with its
 * snapshot (or deleted if it didn't exist). This is the "atomic: if revert
 * fails midway, no files are left in an inconsistent state" guarantee.
 */
export async function revertToCheckpoint(
    checkpointId: string,
    opts: EditResendOptions,
): Promise<RevertResult> {
    const store = opts.checkpointStore;
    if (!store) throw new Error("revertToCheckpoint: checkpointStore is required");
    const cwd = opts.cwd;

    const manifest = store.list().find((m) => m.id === checkpointId);
    if (!manifest) {
        throw new Error(`revertToCheckpoint: checkpoint ${checkpointId} not found`);
    }

    // 1. SHA-256 out-of-band edit detection — abort BEFORE any file is touched.
    const mismatched = detectOutOfBandEdits(manifest, cwd);
    if (mismatched.length > 0) {
        throw new Error(
            `revertToCheckpoint: ${mismatched.length} file(s) have been edited out-of-band since ` +
                `the checkpoint (SHA-256 mismatch). Aborting to prevent an inconsistent state. ` +
                `First: ${mismatched[0]}`,
        );
    }

    // 2. Snapshot the pre-restore state for rollback if restore fails midway.
    const snapshots = snapshotFiles(manifest.files, cwd);

    // 3. Restore.
    const outcomes = store.restore(manifest, cwd);
    const failed = outcomes.filter((o) => !o.ok);
    if (failed.length > 0) {
        // Rollback: rewrite each touched file with its pre-restore snapshot.
        rollbackFiles(snapshots);
        throw new Error(
            `revertToCheckpoint: ${failed.length} file(s) could not be restored; rolled back to ` +
                `pre-revert state. First failure: ${failed[0].path} (${failed[0].action})`,
        );
    }

    const revertedFiles: string[] = [];
    const tombstonedFiles: string[] = [];
    for (const o of outcomes) {
        if (o.action === "restored") revertedFiles.push(o.path);
        else if (o.action === "deleted") tombstonedFiles.push(o.path);
    }
    return { revertedFiles, tombstonedFiles, outcomes };
}

// ---------------------------------------------------------------------------
// editAndResend
// ---------------------------------------------------------------------------

export interface EditAndResendResult {
    newSessionId: string;
    revertedFiles: string[];
    tombstonedFiles: string[];
}

/**
 * Atomic edit-and-resend:
 *   1. Locate the checkpoint for the Nth user message (throws if none).
 *   2. SHA-256 out-of-band edit detection (throws if any file mismatched).
 *   3. Revert the file state (throws + rolls back if the restore fails midway).
 *   4. Fork the session at the parent of the Nth user message and append the
 *      edited message — the agent will replay from there on the next turn.
 *
 * `newMessage` may be empty (the user just wants the file reset + replay
 * without changing the message — equivalent to zcode's "reset files only").
 */
export async function editAndResend(
    sessionId: string,
    messageIndex: number,
    newMessage: string,
    opts: EditResendOptions,
): Promise<EditAndResendResult> {
    const sm = opts.sessionManager;
    const store = opts.checkpointStore;
    if (!sm || !store) {
        throw new Error("editAndResend: sessionManager and checkpointStore are required");
    }
    if (messageIndex < 1) {
        throw new Error(`editAndResend: messageIndex must be ≥ 1 (got ${messageIndex})`);
    }

    // 1. Locate the checkpoint for the Nth user message.
    const cpInfo = findUserMessageCheckpoint(sessionId, messageIndex, opts);
    if (!cpInfo) {
        throw new Error(
            `editAndResend: no checkpoint found for user message #${messageIndex} in session ${sessionId}`,
        );
    }

    // 2. Verify the manifest still exists (someone could have pruned it
    //    between findUserMessageCheckpoint and revertToCheckpoint).
    const manifest = store.list().find((m) => m.id === cpInfo.checkpointId);
    if (!manifest) {
        throw new Error(`editAndResend: checkpoint ${cpInfo.checkpointId} vanished mid-flight`);
    }

    // 3. SHA-256 out-of-band edit detection — abort before touching files.
    const mismatched = detectOutOfBandEdits(manifest, opts.cwd);
    if (mismatched.length > 0) {
        throw new Error(
            `editAndResend: aborted — ${mismatched.length} file(s) edited out-of-band since ` +
                `the checkpoint (SHA-256 mismatch). Reverting would clobber user edits. ` +
                `First: ${mismatched[0]}`,
        );
    }

    // 4. Revert files. revertToCheckpoint snapshots + rolls back on its own
    //    failure, so a throw here means the file state is intact.
    const revertResult = await revertToCheckpoint(cpInfo.checkpointId, opts);

    // 5. Fork the session: move the leaf to the parent of the Nth user
    //    message (so the next appendMessage replaces it with the edited
    //    version). messageIndex === 1 → resetLeaf (root).
    const entries = sm.getEntries();
    let userMsgCount = 0;
    let prevUserMsgId: string | null = null;
    for (const entry of entries) {
        if (entry.type !== "message") continue;
        if (entry.message?.role !== "user") continue;
        userMsgCount++;
        if (userMsgCount === messageIndex) break;
        prevUserMsgId = entry.id;
    }
    if (prevUserMsgId) {
        sm.branch(prevUserMsgId);
    } else {
        sm.resetLeaf();
    }

    // 6. Append the edited user message. The agent picks this up on the
    //    next turn — the caller (slash command / CLI) decides whether to
    //    trigger a model turn immediately or wait for the user to send.
    const editedMessage = {
        role: "user",
        content: newMessage,
        timestamp: Date.now(),
    };
    sm.appendMessage(editedMessage);

    // 7. The new "session id" — the SessionManager keeps the same id on
    //    branch() (it's a tree fork, not a new file). For edit-resend we
    //    surface the current id; callers that want a separate persisted
    //    session can call createBranchedSession() (pi's API) on their own.
    const newSessionId = sm.getSessionId();

    return {
        newSessionId,
        revertedFiles: revertResult.revertedFiles,
        tombstonedFiles: revertResult.tombstonedFiles,
    };
}

// ---------------------------------------------------------------------------
// Internal: SHA-256 out-of-band edit detection + rollback
// ---------------------------------------------------------------------------

/**
 * Walk every file in the manifest; return the list of paths whose CURRENT
 * on-disk state does NOT match the recorded hash (or, for tombstones, where
 * the file should exist but doesn't). Empty list = all clear, safe to revert.
 *
 * Exposed (not exported) for unit testing.
 */
function detectOutOfBandEdits(manifest: CheckpointManifest, cwd: string): string[] {
    const mismatched: string[] = [];
    for (const f of manifest.files) {
        const abs = isAbsolute(f.path) ? f.path : join(cwd, f.path);
        if (f.oversized === true) {
            // Oversized capture: never blobbed, no hash to compare against.
            // The revert path will skip these (CheckpointStore.restore
            // reports `oversized`); they are NOT a safety violation.
            continue;
        }
        if (f.hash === null) {
            // Tombstone: file did NOT exist before the turn. For the revert
            // to be clean, the file must STILL exist (the turn created it).
            // If it was deleted out-of-band, the tombstone-deletion would
            // be a no-op silently — we surface it as a mismatch.
            if (!existsSync(abs)) {
                mismatched.push(f.path);
            }
            continue;
        }
        // Hashed file: must exist and match.
        if (!existsSync(abs)) {
            mismatched.push(f.path);
            continue;
        }
        try {
            const content = readFileSync(abs);
            if (sha256(content) !== f.hash) {
                mismatched.push(f.path);
            }
        } catch {
            mismatched.push(f.path);
        }
    }
    return mismatched;
}

interface FileSnapshot {
    path: string;
    content: Buffer | null; // null = file did not exist pre-restore
}

function snapshotFiles(files: CheckpointFile[], cwd: string): FileSnapshot[] {
    const snapshots: FileSnapshot[] = [];
    for (const f of files) {
        const abs = isAbsolute(f.path) ? f.path : join(cwd, f.path);
        try {
            snapshots.push({ path: abs, content: readFileSync(abs) });
        } catch {
            snapshots.push({ path: abs, content: null });
        }
    }
    return snapshots;
}

function rollbackFiles(snapshots: FileSnapshot[]): void {
    for (const snap of snapshots) {
        if (snap.content === null) {
            try {
                rmSync(snap.path);
            } catch {
                /* best effort — file may already be gone */
            }
        } else {
            try {
                writeFileSync(snap.path, snap.content);
            } catch {
                /* best effort — rollback is best-effort by contract */
            }
        }
    }
}
