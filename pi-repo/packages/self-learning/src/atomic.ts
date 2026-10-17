/**
 * atomic.ts — crash-safe file writes (pattern shared by the memory tiers and
 * the per-project dream writes).
 *
 * writeFileSync + rename is not enough: a crash between the two leaves no file
 * (or the old one) while the caller believes the write happened, and without
 * fsync the rename can be reordered/dropped on power loss. This helper writes
 * to a pid-tagged temp file, fsyncs the file, renames, and fsyncs the parent
 * directory (best effort — some filesystems refuse directory fsync).
 */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function atomicWriteFileSync(file: string, content: string): void {
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, content, "utf8");
        try {
                const fd = openSync(tmp, "r+");
                try {
                        fsyncSync(fd);
                } finally {
                        closeSync(fd);
                }
        } catch {
                /* fsync unavailable on this fs — rename still gives atomicity vs partial content */
        }
        renameSync(tmp, file);
        try {
                const dfd = openSync(dirname(file), "r");
                try {
                        fsyncSync(dfd);
                } finally {
                        closeSync(dfd);
                }
        } catch {
                /* directory fsync best-effort (e.g. not permitted on some fs) */
        }
}
