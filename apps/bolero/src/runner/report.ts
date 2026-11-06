/**
 * Bolero runner — the run-report builder (PLAN §2 round-trip pin law:
 * the runner CONSTRUCTS a `RunReport` through the frozen domain
 * module; it never re-declares a grammar field).
 *
 * `buildRunReport` takes an `ExecutionResult` (the executor's honest
 * outcome), the watch's id/run-seq/version, and the artifact payloads
 * the run produced, and returns a `RunReport` that PASSES the frozen
 * `assertReport` (imported from `src/domain/invariants.js`). The
 * content-addressed artifact-name grammar
 * `<watchId>_r<runSeq>_sha256:<64hex>.<ext>` is built here from the
 * payload's sha256 — the name IS the hash, so a lying caller cannot
 * clobber a slot (the Chaconne `store.ts` law re-adopted).
 */
import { createHash } from "node:crypto";
import { assertReport } from "../domain/invariants.js";
import type { ArtifactRef, RunReport } from "../domain/types.js";

/** sha256 hex of arbitrary payload bytes (content-addressing). */
export function sha256Hex(payload: Uint8Array | string): string {
  return sha256HexImpl(payload);
}

function sha256HexImpl(payload: Uint8Array | string): string {
  const buf = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return createHash("sha256").update(buf).digest("hex");
}

/** The content-addressed artifact-name grammar (PLAN §2 run-report
 * draft): `<watchId>_r<runSeq>_sha256:<64hex>.<ext>`. */
export function artifactName(watchId: number, runSeq: number, sha256: string, ext: string): string {
  return `${watchId}_r${runSeq}_sha256:${sha256}.${ext}`;
}

/** Build one content-addressed artifact ref from a payload. */
export function artifactRef(
  watchId: number,
  runSeq: number,
  ext: "png" | "json" | "log",
  payload: Uint8Array | string,
): ArtifactRef {
  const hex = sha256Hex(payload);
  return { name: artifactName(watchId, runSeq, hex, ext), sha256: hex, ext };
}

export type BuildReportArgs = {
  watchId: number;
  /** The recipe version the run SNAPPED at start (edge E-09 kin). */
  recipeVersion: number;
  /** The run sequence number (deterministic max+1 in the server's
   * registry; the runner receives it — it is NEVER random). */
  runSeq: number;
  status: RunReport["report"]["status"];
  startedAt: string;
  /** Absent when the run was killed. */
  finishedAt?: string;
  committedPrefix: number;
  failedStepIdx?: number;
  extracted?: Record<string, string>;
  /** Screenshot / extract payloads this run produced, in order. */
  artifacts: { ext: "png" | "json" | "log"; payload: Uint8Array | string }[];
  log?: string;
};

/**
 * Build a `RunReport` that PASSES `assertReport`. Every artifact's
 * name is derived from its payload's sha256 here (content-addressing);
 * the result is validated against the frozen grammar before it is
 * returned — a drift on the runner's side is a test-time RED, never
 * a 422 at ingest (the V-41 law).
 *
 * @throws {DomainInvariantError} on any grammar breach
 */
export function buildRunReport(args: BuildReportArgs): RunReport {
  const refs: ArtifactRef[] = args.artifacts.map((a) =>
    artifactRef(args.watchId, args.runSeq, a.ext, a.payload),
  );
  const report: RunReport = {
    schema: "bolero.v1",
    report: {
      watchId: args.watchId,
      recipeVersion: args.recipeVersion,
      status: args.status,
      startedAt: args.startedAt,
      committedPrefix: args.committedPrefix,
      artifacts: refs,
    },
  };
  // Optional fields: set only when present (the grammar's
  // "absent when killed / optional when empty" law).
  const r = report.report;
  if (args.finishedAt !== undefined) r.finishedAt = args.finishedAt;
  if (args.failedStepIdx !== undefined) r.failedStepIdx = args.failedStepIdx;
  if (args.extracted !== undefined) r.extracted = args.extracted;
  if (args.log !== undefined) r.log = args.log;
  // The pin: the constructed report must satisfy the frozen grammar
  // BEFORE it leaves this module (the V-41 round-trip law, item 3).
  assertReport(report);
  return report;
}
