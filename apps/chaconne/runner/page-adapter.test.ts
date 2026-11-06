/**
 * Chaconne runner — fake-adapter unit lane (PLAN §3, acceptance #4/#5/#6).
 *
 * Every step kind, every error-taxonomy entry, the caps, the
 * committed-prefix law, and the post-fill-verification pin — all
 * deterministic, no browser. Time-gated DOM uses REAL timers
 * (`appearsAt = Date.now() + N`); the operator ruling removed the
 * manual-clock path from the fake (the injected-clock law belongs to
 * C-4's scheduler, not the adapter's internal waits).
 */
import { test, expect } from "bun:test";
import { FakePageAdapter, AdapterStepError, FakeElement, type FakeDomBuilder } from "./page-adapter.js";
import { executeRecipe } from "./index.js";
import { DEFAULT_CAPS } from "./caps.js";
import type { Recipe, Step } from "../src/domain/types.js";

/* — a small DOM-table helper (the §3 fake-table shape) — */

function table(...els: [string, FakeElement][]): Record<string, FakeElement> {
  const out: Record<string, FakeElement> = {};
  for (const [k, v] of els) out[k] = v;
  return out;
}

function el(selector: string, extra: Partial<FakeElement> = {}): FakeElement {
  return {
    selector,
    text: extra.text ?? "",
    attrs: extra.attrs ?? {},
    value: extra.value,
    present: extra.present ?? true,
    clickable: extra.clickable ?? true,
  };
}

/** A recipe with the closed 9-kind vocabulary; ids 1..N. */
function recipe(steps: Omit<Step, "id">[], name = "r"): Recipe {
  return {
    id: 1,
    name,
    version: 1,
    steps: steps.map((s, i) => ({ ...s, id: i + 1 })),
  };
}

/**
 * The fixture-set DOM tables as in-memory fakes (mirrors test/fixtures/).
 * URLs are the short recipe-URL tokens the recipes' goto steps use.
 */
function fixtureDom(url: string): { elements: Record<string, FakeElement> } {
  const byUrl: Record<string, Record<string, FakeElement>> = {
    blank: {},
    form: table(
      ["#name", el("#name", { value: "" })],
      ["inner::#token", el("inner::#token", { value: "" })],
      ["#color", el("#color", { value: "", attrs: { role: "select" } })],
      ["#status", el("#status", { text: "idle", attrs: { "data-attr": "idle" } })],
      ["#go", el("#go")],
    ),
    tall: table(
      ["#mid", el("#mid", { text: "mid-marker", attrs: { "data-attr": "mid" } })],
      ["#bottom", el("#bottom", { text: "bottom-marker", attrs: { "data-attr": "end" } })],
    ),
    slow: table(["#hint", el("#hint", { text: "loading" })]),
    dynamic: table(
      ["#label", el("#label", { text: "settled", attrs: { "data-attr": "settled" } })],
    ),
  };
  return { elements: byUrl[url] ?? {} };
}

function fake(url: string): { adapter: FakePageAdapter } {
  return { adapter: new FakePageAdapter({ dom: fixtureDom }) };
}

/* — acceptance #4: ALL 9 step kinds — */

test("step kind: goto", async () => {
  const { adapter } = fake("form");
  const r = recipe([{ kind: "goto", selector: "form" }, { kind: "assert-element", selector: "#name" }]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
  expect(res.committedPrefix).toBe(2);
  expect(adapter.url).toBe("form");
});

test("step kind: click", async () => {
  const { adapter } = fake("form");
  const r = recipe([{ kind: "goto", selector: "form" }, { kind: "click", selector: "#go" }]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
  expect(res.committedPrefix).toBe(2);
  // The fake's click is once-clickable (in-place mutation persists for
  // the adapter's lifetime): a second click on the same element fails.
  const r2 = recipe([{ kind: "click", selector: "#go" }]);
  const res2 = await executeRecipe(adapter, r2);
  expect(res2.status).toBe("step-failed");
  expect(res2.failedStepIdx).toBe(0);
});

test("step kind: fill", async () => {
  const { adapter } = fake("form");
  const r = recipe([{ kind: "goto", selector: "form" }, { kind: "fill", selector: "#name", value: "ada" }]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
  expect(adapter.lastFill).toBe("ada");
});

test("step kind: select", async () => {
  const { adapter } = fake("form");
  const r = recipe([{ kind: "goto", selector: "form" }, { kind: "select", selector: "#color", value: "green" }]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
});

test("step kind: wait (timed DOM — slow.html kin, real timers)", async () => {
  // #ready appears ~150ms from now (real clock); a generous cap passes.
  const { adapter } = fake("slow");
  const t0 = Date.now();
  const dom = {
    elements: table(["#hint", el("#hint", { text: "loading" })], ["#ready", el("#ready", { text: "ready", appearsAt: t0 + 150 })]),
  };
  const a = new FakePageAdapter({ dom: () => dom });
  const r = recipe([{ kind: "goto", selector: "slow" }, { kind: "wait", selector: "#ready", timeoutMs: 2000 }]);
  const res = await executeRecipe(a, r);
  expect(res.status).toBe("ok");
  expect(res.committedPrefix).toBe(2);
});

test("step kind: assert-text", async () => {
  const { adapter } = fake("dynamic");
  const r = recipe([{ kind: "goto", selector: "dynamic" }, { kind: "assert-text", selector: "#label", value: "settled" }]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
  // A wrong expectation fails as step-failed.
  const r2 = recipe([{ kind: "goto", selector: "dynamic" }, { kind: "assert-text", selector: "#label", value: "wrong" }]);
  const res2 = await executeRecipe(adapter, r2);
  expect(res2.status).toBe("step-failed");
});

test("step kind: assert-element", async () => {
  const { adapter } = fake("tall");
  const r = recipe([{ kind: "goto", selector: "tall" }, { kind: "assert-element", selector: "#bottom" }]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
  // Absent element (blank) → selector-not-found.
  const { adapter: a2 } = fake("blank");
  const res2 = await executeRecipe(a2, recipe([{ kind: "goto", selector: "blank" }, { kind: "assert-element", selector: "#ghost" }]));
  expect(res2.status).toBe("selector-not-found");
});

test("step kind: extract", async () => {
  const { adapter } = fake("tall");
  const r = recipe([
    { kind: "goto", selector: "tall" },
    { kind: "extract", selector: "#bottom" },
    { kind: "extract", selector: "#mid", value: "data-attr" },
  ]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
  expect(res.extracted["1"]).toBe("bottom-marker");
  expect(res.extracted["2"]).toBe("mid"); // value names the attribute; #mid's data-attr is "mid"
  // The extract artifact is content-addressed (one json payload).
  expect(res.artifacts.some((a) => a.ext === "json")).toBe(true);
});

test("step kind: screenshot (tall page, fullPage kin)", async () => {
  const { adapter } = fake("tall");
  const r = recipe([{ kind: "goto", selector: "tall" }, { kind: "screenshot", selector: "#" }]);
  const res = await executeRecipe(adapter, r);
  expect(res.status).toBe("ok");
  expect(res.artifacts.some((a) => a.ext === "png")).toBe(true);
});

/* — acceptance #4: ALL 5 error-taxonomy entries — */

test("taxonomy: ok", async () => {
  const { adapter } = fake("tall");
  const res = await executeRecipe(adapter, recipe([{ kind: "goto", selector: "tall" }]));
  expect(res.status).toBe("ok");
});

test("taxonomy: step-failed (click on a non-clickable)", async () => {
  const domFor = (u: string) =>
    u === "form" ? { elements: table(["#go", el("#go", { clickable: false })]) } : { elements: {} };
  const adapter = new FakePageAdapter({ dom: domFor });
  const res = await executeRecipe(adapter, recipe([{ kind: "goto", selector: "form" }, { kind: "click", selector: "#go" }]));
  expect(res.status).toBe("step-failed");
  expect(res.failedStepIdx).toBe(1);
});

test("taxonomy: selector-not-found (blank — a miss, never a hang)", async () => {
  const { adapter } = fake("blank");
  const res = await executeRecipe(adapter, recipe([{ kind: "goto", selector: "blank" }, { kind: "assert-element", selector: "#ghost" }]));
  expect(res.status).toBe("selector-not-found");
  expect(res.committedPrefix).toBe(1); // goto committed; the assert did not
});

test("taxonomy: timeout (a time-gated element lands FAR after the cap — real timers)", async () => {
  // #ready appears at now + 60s, but the wait's cap is 200ms → the
  // budget expires first and the run records `timeout` + committedPrefix 1.
  const t0 = Date.now();
  const domFor = (u: string) => ({
    elements: {
      "#hint": { selector: "#hint", text: "loading", attrs: {}, present: true, clickable: true },
      "#ready": { selector: "#ready", text: "ready", attrs: {}, present: true, clickable: true, appearsAt: t0 + 60_000 },
    },
  });
  const adapter = new FakePageAdapter({ dom: domFor });
  const started = Date.now();
  const res = await executeRecipe(
    adapter,
    recipe([{ kind: "goto", selector: "slow" }, { kind: "wait", selector: "#ready", timeoutMs: 200 }]),
  );
  const elapsed = Date.now() - started;
  expect(res.status).toBe("timeout");
  expect(res.committedPrefix).toBe(1);
  expect(elapsed).toBeLessThan(1000); // bounded — no hang
});

test("taxonomy: invalid-recipe (a step with a bad selector shape)", async () => {
  const { adapter } = fake("form");
  // An empty selector is an invariant breach — the recipe is refused
  // BEFORE any step runs (P0 #1 boundary law).
  let threw = false;
  try {
    await executeRecipe(adapter, recipe([{ kind: "goto", selector: "" }]));
  } catch (e) {
    threw = true;
    expect((e as Error).name).toBe("DomainInvariantError");
  }
  expect(threw).toBe(true);
});

/* — acceptance #5: the committed-prefix law — */

test("committed-prefix: a run killed mid-step keeps only the completed prefix", async () => {
  const domFor: FakeDomBuilder = (u: string) =>
    u === "form"
      ? {
          elements: {
            "#name": { selector: "#name", text: "", attrs: {}, value: "", present: true, clickable: true, fillCorrupt: "stale" },
            "#status": { selector: "#status", text: "idle", attrs: { "data-attr": "idle" }, present: true, clickable: true },
          } as Record<string, FakeElement>,
        }
      : { elements: {} as Record<string, FakeElement> };
  const f = new FakePageAdapter({ dom: domFor });
  const res = await executeRecipe(
    f,
    recipe([
      { kind: "goto", selector: "form" },
      { kind: "fill", selector: "#name", value: "ada" },
      { kind: "assert-text", selector: "#status", value: "idle" },
    ]),
  );
  // The fill's read-back mismatches at step 1 → only step 0 (goto)
  // is committed (the prefix law).
  expect(res.status).toBe("step-failed");
  expect(res.failedStepIdx).toBe(1);
  expect(res.committedPrefix).toBe(1);
});

/* — acceptance #6: post-fill verification pin (the #43 class) — */

test("post-fill: a silently-failed fill records a failure, never a false ok", async () => {
  const domFor: FakeDomBuilder = (u: string) =>
    u === "form"
      ? {
          elements: {
            "#name": { selector: "#name", text: "", attrs: {}, value: "", present: true, clickable: true, fillNoop: true },
          } as Record<string, FakeElement>,
        }
      : { elements: {} as Record<string, FakeElement> };
  const f = new FakePageAdapter({ dom: domFor });
  await f.goto("form", 5000); // seed currentUrl
  const res = await executeRecipe(f, recipe([{ kind: "fill", selector: "#name", value: "ada" }]));
  // fillNoop → the value never lands → the read-back mismatch fails the step.
  expect(res.status).toBe("step-failed");
  expect(res.committedPrefix).toBe(0);
  expect(f.lastFill).toBe("ada"); // logged, not trusted
});

/* — caps — */

test("caps: maxSteps stops a runaway recipe (prefix law holds)", async () => {
  const many: Omit<Step, "id">[] = [{ kind: "goto", selector: "form" }];
  for (let i = 0; i < 200; i++) many.push({ kind: "assert-element", selector: "#name" });
  const { adapter } = fake("form");
  const res = await executeRecipe(
    adapter,
    recipe(many),
    { caps: { ...DEFAULT_CAPS, maxSteps: 50, runWallMs: 1_000_000 } },
  );
  // Steps 0..49 complete; step 50 is never started — the step-count cap
  // trips first, and the prefix is exactly 50.
  expect(res.status).toBe("timeout");
  expect(res.committedPrefix).toBe(50);
});
