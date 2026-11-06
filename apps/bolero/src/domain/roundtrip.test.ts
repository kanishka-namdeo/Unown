/**
 * The cross-host round-trip pin (PLAN §2 round-trip pin law, the V-41
 * law made executable, ticket S-1).
 *
 * 1. CLEAN PATH — build a `RunReport` the way the runner would
 *    construct it, serialize through `io.ts`'s canonical JSON,
 *    re-parse + re-validate the way the server would. Byte-stable.
 * 2. PLANTED DRIFT — the same report with one field renamed/missing
 *    on one side (here: `status` renamed to `state`). The pin MUST
 *    throw, and the thrown message MUST carry the DOTTED PATH. A
 *    drift on either side REDS at test time, never as a 422 at
 *    runtime.
 */
import { test, expect } from "bun:test";
import { DomainInvariantError } from "./types.js";
import type { RunReport } from "./types.js";
import { toCanonicalJson, parseReport, checkSchemaGate } from "./io.js";
import { assertReport, assertWatch } from "./invariants.js";
import { SCHEMA_VERSION, RUN_STATUSES, STEP_KINDS } from "./sets.js";

/** A deterministic 64-hex digest (a real sha256 of any fixed bytes). */
const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** The runner-side construction (PLAN §2 run-report grammar, exact). */
const cleanReport: RunReport = {
  schema: "bolero.v1",
  report: {
    watchId: 3,
    recipeVersion: 2,
    status: "ok",
    startedAt: "2026-11-07T09:00:00.000Z",
    finishedAt: "2026-11-07T09:00:02.500Z",
    committedPrefix: 4,
    extracted: { "0": "logged in" },
    artifacts: [
      {
        name: `3_r7_sha256:${SHA}.png`,
        sha256: SHA,
        ext: "png",
      },
    ],
    log: "run finished clean",
  },
};

test("clean round-trip: serialize → re-parse → assertReport passes", () => {
  const wire = toCanonicalJson(cleanReport);

  // Byte-stability: the canonical form is identical across re-serializations.
  expect(toCanonicalJson(cleanReport)).toBe(wire);
  expect(JSON.parse(toCanonicalJson(JSON.parse(wire)))).toEqual(JSON.parse(wire));

  // The server-side path: re-parse through the shared gate.
  const reparsed = parseReport(wire);
  assertReport(reparsed);
  expect(reparsed).toEqual(cleanReport);
});

test("canonical JSON sorts object keys and keeps arrays in order", () => {
  const wire = toCanonicalJson(cleanReport);
  expect(wire).toBe('{"report":{"artifacts":[{"ext":"png","name":"3_r7_sha256:' + SHA + '.png","sha256":"' + SHA + '"}],"committedPrefix":4,"extracted":{"0":"logged in"},"finishedAt":"2026-11-07T09:00:02.500Z","log":"run finished clean","recipeVersion":2,"startedAt":"2026-11-07T09:00:00.000Z","status":"ok","watchId":3},"schema":"bolero.v1"}');
});

test("PLANTED DRIFT: a renamed field REDS with the dotted path", () => {
  // The drift: one side renames `status` → `state` (the drift the
  // V-41 law is built to catch at authoring time, not 422 time).
  const drifted = JSON.parse(JSON.stringify(cleanReport)) as unknown as Record<string, unknown>;
  const inner = drifted.report as Record<string, unknown>;
  inner.state = inner.status;
  delete inner.status;

  expect(() => assertReport(drifted as unknown as RunReport)).toThrow(DomainInvariantError);
  expect(() => assertReport(drifted as unknown as RunReport)).toThrow("report.status");

  // The server's parse path goes RED the same way — the same code.
  expect(() => parseReport(toCanonicalJson(drifted as unknown as RunReport))).toThrow("report.status");
});

test("PLANTED DRIFT: a MISSING field REDS with the dotted path", () => {
  // The drift on the other shape: `startedAt` dropped by one host.
  const missing = JSON.parse(JSON.stringify(cleanReport)) as unknown as Record<string, unknown>;
  delete (missing.report as Record<string, unknown>).startedAt;

  expect(() => assertReport(missing as unknown as RunReport)).toThrow("report.startedAt");
});

test("closed RunStatus set: every entry passes, every foreign value throws", () => {
  for (const status of RUN_STATUSES) {
    const r = JSON.parse(JSON.stringify(cleanReport)) as RunReport;
    r.report.status = status as RunReport["report"]["status"];
    expect(() => assertReport(r)).not.toThrow();
  }
  const foreign = JSON.parse(JSON.stringify(cleanReport)) as unknown as Record<string, unknown>;
  (foreign.report as Record<string, unknown>).status = "passed";
  expect(() => assertReport(foreign as unknown as RunReport)).toThrow("report.status not in the closed RunStatus set");
});

test("schema gate: a foreign schema is refused, never partially parsed", () => {
  const wire = toCanonicalJson(cleanReport);
  // A future-schema payload carries the same body under a new gate value.
  const future: Record<string, unknown> = JSON.parse(wire);
  future.schema = "bolero.v2";
  expect(checkSchemaGate(future)).toContain('refused, expected "bolero.v1"');
  expect(() => parseReport(JSON.stringify(future))).toThrow(DomainInvariantError);
  expect(SCHEMA_VERSION).toBe("bolero.v1");
});

test("closed StepKind set: all 9 kinds pass, a 10th throws", () => {
  expect(STEP_KINDS).toHaveLength(9);
  expect(STEP_KINDS).toEqual(["goto", "click", "fill", "select", "wait", "assert-text", "assert-element", "extract", "screenshot"]);

  const artifactName = (seq: number, sha: string, ext: string) =>
    `3_r${seq}_sha256:${sha}.${ext}`;

  const watch = {
    schema: "bolero.v1",
    watch: {
      id: 1,
      name: "canary",
      baseUrl: "https://example.com",
      steps: [{ id: 1, kind: "goto", selector: "https://example.com" }],
    },
  };
  expect(() => assertWatch(watch)).not.toThrow();

  const bad = JSON.parse(JSON.stringify(watch));
  bad.watch.steps[0].kind = "hover";
  expect(() => assertWatch(bad)).toThrow("watch.steps[0].kind not in the closed step-kind set");
});

test("content-addressed artifact grammar: dotted-path throws on both halves", () => {
  const okArtifact = (sha: string, ext: string, seq: number) => ({
    name: `3_r${seq}_sha256:${sha}.${ext}`,
    sha256: sha,
    ext,
  });

  // A clean 7th-entry report with a well-formed artifact set validates.
  const good = JSON.parse(JSON.stringify(cleanReport)) as RunReport;
  good.report.status = "screenshot-failed";
  good.report.artifacts = [okArtifact(SHA, "png", 7)];
  expect(() => assertReport(good)).not.toThrow();

  // The name half of the grammar is the pin: a non-content-addressed
  // name REDS at `report.artifacts[0].name` (the dotted path), and the
  // sha256 half REDS at `report.artifacts[1].sha256`.
  const malformed = JSON.parse(JSON.stringify(cleanReport)) as unknown as Record<string, unknown>;
  const arr = JSON.parse(JSON.stringify(malformed.report.artifacts)) as Record<string, unknown>[];
  arr[0] = okArtifact(SHA, "png", 7);
  arr.push({ name: `3_r8_sha256:${SHA}`, sha256: SHA, ext: "png" }); // no dot/ext — fails the name grammar
  (malformed.report as Record<string, unknown>).artifacts = arr;
  expect(() => assertReport(malformed as unknown as RunReport)).toThrow("report.artifacts[1].name");

  const digestMismatch = JSON.parse(JSON.stringify(cleanReport)) as unknown as Record<string, unknown>;
  const arr2 = JSON.parse(JSON.stringify(cleanReport.report.artifacts)) as Record<string, unknown>[];
  const otherSha = SHA.slice(0, 63) + (SHA[63] === "a" ? "b" : "a"); // valid 64-hex, but NOT the embedded digest
  arr2.push({ name: `3_r8_sha256:${SHA}.png`, sha256: otherSha, ext: "png" }); // digest embedded in name != sha256 field
  (digestMismatch.report as Record<string, unknown>).artifacts = arr2;
  expect(() => assertReport(digestMismatch as unknown as RunReport)).toThrow("report.artifacts[1].name embeds a different digest");

  const noext = JSON.parse(JSON.stringify(cleanReport)) as unknown as Record<string, unknown>;
  (noext.report as Record<string, unknown>).artifacts = [{ name: "3_r7_sha256:" + SHA + ".txt", sha256: SHA, ext: "txt" }];
  expect(() => assertReport(noext as unknown as RunReport)).toThrow("report.artifacts[0].ext");
});
