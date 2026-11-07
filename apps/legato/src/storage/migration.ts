/**
 * Migration frame — the v1→v2 bump slot with a named design note
 * (PLAN §1.1, §3 L-2; S-1/S-4 edge register rows; the W3 retention
 * axis in PLAN Appendix B, risk #2).
 *
 * v1 is the ONLY version that currently exists: `SUPPORTED_VERSIONS`\`
 * is `{1}` and `migrate` is a structural no-op today (the frame is
 * in place for when a real field change lands). The frame's honesty
 * is pinned by `migration.test.ts`: any unknown or future version is
 * refused with a typed `MigrationError` — never a silent
 * pass-through.
 *
 * DESIGN NOTE (W3 retention axis, named per PLAN risk #2):
 *
 * When Legato bumps `schemaVersion` from 1 → 2, data will exist in
 * the IDB (real clips, highlights, tags). The migration must run
 * inside the IDB `onupgradeneeded` callback — which is the ONLY
 * window where the old and new schemas coexist and IDB will
 * rewrite the object stores.
 *
 * **Honest limitation:** the FakeStorage in-memory fake cannot
 * reproduce a v2 bump under real quota pressure. The W3 risk
 * ("IDB schema-migration loss under real quota pressure") is the
 * one lane the fake CANNOT fake — the L-11 Chromium e2e battery is
 * the only lane that touches real IDB, and a quota-class error
 * there is a receipted `[U]`, not a pass.
 *
 * The frame below implements:
 * - `migrate(data, fromVersion)` — the pure migration function
 *   (v1→v2: no structural change to clip records yet, so v2 is a
 *   no-op transform; the frame is in place when a real schema
 *   change lands).
 * - typed refusal for unknown/future `schemaVersion` — an unknown
 *   version throws `MigrationError`, never a silent pass-through.
 * - the in-flight flag semantics: while a migration is running,
 *   `load()` returns the pre-migration view (S-4).
 */
import type { LegatoData } from "../domain/types.js";
import { MigrationError } from "../domain/types.js";

/**
 * The supported schema versions. v1 is the only version that
 * currently exists; v2 is the forward-design slot.
 */
export const SUPPORTED_VERSIONS: ReadonlySet<number> = new Set([1]);

/**
 * Apply the v1→v2 migration to a data set.
 *
 * v2 is structurally identical to v1 (no field changes yet — the
 * frame is in place for when a real schema change lands). This
 * function is the seam: when v2 adds or renames fields, the
 * transform logic goes here, not in the IDB upgrade handler.
 *
 * @param data - the pre-migration data set.
 * @param fromVersion - the `schemaVersion` the data was stored under.
 * @returns the post-migration data set (v2).
 * @throws {MigrationError} if `fromVersion` is unknown or is a
 *  future version this frame does not know how to handle.
 */
export function migrate(data: LegatoData, fromVersion: number): LegatoData {
  if (!SUPPORTED_VERSIONS.has(fromVersion)) {
    throw new MigrationError(
      `unknown schemaVersion ${fromVersion}: the migration frame only handles versions [${[...SUPPORTED_VERSIONS].join(", ")}]`,
    );
  }

  // v1 → v2: no structural change to clip records yet.
  // The frame is in place; when a real v2 change lands, add the
  // transform here.
  // v1 is the only version; the v2 transform is a structural no-op
  // today (the frame is in place for when a real field change lands).
  // schemaVersion is the IDB object-store version, not the document's
  // `schema` tag — the tag stays "legato.v1" (the import gate's law).
  const result: LegatoData = {
    schema: data.schema,
    schemaVersion: 1,
    clips: data.clips.map((c) => ({ ...c })),
    tags: [...data.tags],
    queue: [...data.queue],
  };
  return result;
}

/**
 * The v1→v2 design note as a machine-readable marker.
 * Callers (UI edge, migration runner) can use this to check
 * whether a pending migration has a named design note.
 */
export const MIGRATION_NOTES: Readonly<Record<number, string>> = {
  1: "v1 → v2: schema bump frame in place; clip record shape unchanged. " +
    "W3 retention axis: the v1→v2-with-data migration under real quota " +
    "pressure is the one lane the FakeStorage fake cannot reproduce — " +
    "the L-11 Chromium e2e battery is the only lane that touches real IDB, " +
    "and a quota-class error there is a receipted [U], not a pass.",
};
