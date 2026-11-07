/**
 * io-view.test.ts — the F-8 IO lane's unit pins (Lane A, DOM-free).
 *
 * Pins the pure view models behind the export/import wiring:
 *  - the export toast line (the honest empty lane + the N/M summary)
 *  - the refusal view model (reason + the schema literal + details verbatim)
 *  - importDocument: the ok lane (a healthy doc), the foreign-schema
 *    refusal, the not-json refusal, the invariant refusal
 *  - exportBytes: byte-stable over the canonical serializer
 */
import { describe, test, expect } from "bun:test";
import {
  exportBytes,
  exportToastLine,
  importDocument,
  importOkLine,
  refusalViewModel,
} from "./io-view.js";
import { emptyData, addJob } from "../domain/model.js";
import { exportFugue } from "../domain/io.js";
import type { DryRunRefusal } from "../domain/io.js";

const NOW = 1762454400000;

function oneJob() {
  return addJob(
    emptyData(),
    {
      title: "job A",
      prompt: "p",
      schedule: { kind: "every", spec: "1d" },
      mode: "read-only",
      model: "agnes-3.0-flash",
      timezone: "UTC",
      misfire: "skip",
      spendCap: "off",
    },
    NOW,
  ).data;
}

describe("export toast (the honest summary lane)", () => {
  test("empty store: the honest empty-export line", () => {
    const line = exportToastLine(emptyData());
    expect(line).toContain("empty store");
    expect(line).toContain("fugue-export.json");
  });
  test("populated store: the N/M summary", () => {
    const d = oneJob();
    const line = exportToastLine(d);
    expect(line).toContain("1 jobs");
    expect(line).toContain("0 runs");
    expect(line).toContain("fugue-export.json");
  });
});

describe("import ok line (the N/M summary)", () => {
  test("the imported counts are echoed honestly", () => {
    const d = oneJob();
    expect(importOkLine(d)).toBe("imported 1 jobs, 0 runs");
  });
});

describe("refusal view model (the dry-run panel's shape)", () => {
  test("foreign-schema: the offending schema literal is carried", () => {
    const r: DryRunRefusal = {
      ok: false,
      reason: "foreign-schema",
      schema: "fugue.v999",
      details: "no partial import",
    };
    const vm = refusalViewModel(r);
    expect(vm.reason).toBe("foreign-schema");
    expect(vm.schemaLiteral).toBe("fugue.v999");
    expect(vm.details).toBe("no partial import");
  });
  test("an absent schema literal is named 'absent'", () => {
    const r: DryRunRefusal = {
      ok: false,
      reason: "foreign-schema",
      details: "schema is absent",
    };
    const vm = refusalViewModel(r);
    expect(vm.schemaLiteral).toBe("absent");
  });
  test("invariant + not-json: the details are verbatim", () => {
    const vm = refusalViewModel({
      ok: false,
      reason: "invariant",
      details: "jobs[0].title: must be non-empty",
    });
    expect(vm.reason).toBe("invariant");
    expect(vm.details).toBe("jobs[0].title: must be non-empty");
  });
});

describe("importDocument (the parse decision, DOM-free)", () => {
  test("ok lane: a healthy export parses to a valid document", () => {
    const d = oneJob();
    const out = importDocument(exportFugue(d));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.jobs.length).toBe(1);
      expect(out.data.jobs[0].title).toBe("job A");
    }
  });
  test("foreign schema: a structured refusal (never a partial import)", () => {
    const out = importDocument(JSON.stringify({ schema: "fugue.v999", jobs: [], runs: [], nextId: 0 }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.refusal.reason).toBe("foreign-schema");
      expect(out.refusal.schemaLiteral).toBe("fugue.v999");
      expect(out.refusal.details).toContain("no partial import");
    }
  });
  test("not-json: a garbage document is refused with the not-json reason", () => {
    const out = importDocument("{not json");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.refusal.reason).toBe("not-json");
  });
  test("invariant: a corrupt fugue.v1 document is refused (never a throw)", () => {
    // plant a drift: an empty title breaches the invariant law
    const doc = {
      schema: "fugue.v1",
      jobs: [
        {
          id: 1,
          title: "",
          prompt: "p",
          schedule: { kind: "every", spec: "1d" },
          mode: "read-only",
          model: "m",
          timezone: "UTC",
          misfire: "skip",
          spendCap: "off",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      runs: [],
      nextId: 2,
    };
    const out = importDocument(JSON.stringify(doc));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.refusal.reason).toBe("invariant");
  });
});

describe("exportBytes (the byte-stable golden)", () => {
  test("re-export is byte-identical (the stability pin, not a frozen blob)", () => {
    const d = oneJob();
    expect(exportBytes(d)).toBe(exportFugue(d));
    expect(exportBytes(d)).toBe(exportBytes(d));
  });
});
