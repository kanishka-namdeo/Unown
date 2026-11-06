/**
 * Shared fake-DOM builders for the fixture pages (the §6 unit lane).
 * The URL constants mirror the fixture file names; the element tables
 * mirror the HTML the fixtures render, so a unit-lane test and an
 * e2e-lane test observe the SAME page through different adapters.
 */
import type { FakeDomBuilder, FakeElement } from "../src/runner/adapter.js";

const el = (selector: string, text = "", extra: Partial<FakeElement> = {}): FakeElement => ({
  selector,
  text,
  attrs: {},
  present: true,
  clickable: true,
  ...extra,
});

/** The happy-path fixture page (form, select, readout, button). */
export const HAPPY_URL = "http://fixture.local/happy.html";

export const happyDom: FakeDomBuilder = (url: string) => {
  if (url !== HAPPY_URL) return { elements: {} };
  return {
    elements: {
      "#name": el("#name", "", { value: "" }),
      "#tier": el("#tier", "tier-a", { value: "a" }),
      "#readout": el("#readout", "initial readout", { attrs: { "data-ref": "ref-42" } }),
      "#go": el("#go", "go"),
    },
  };
};

/** The failure-path fixture page (#ghost is absent; #late is time-gated). */
export const FAILURE_URL = "http://fixture.local/failure.html";

export const failureDom: FakeDomBuilder = (url: string) => {
  if (url !== FAILURE_URL) return { elements: {} };
  const late = el("#late", "late arrival", { appearsAt: Date.now() + 4000 });
  return {
    elements: {
      "#present": el("#present", "always here"),
      "#failbtn": el("#failbtn", "fail"),
      "#late": late,
    },
  };
};

/**
 * Build a FRESH copy of the happy table with `#name.fillCorrupt`
 * set to the given value — the shared-table law: the builder output
 * is per-test, never mutated in place (a poisoned table would leak
 * into sibling tests running on the same FakeAdapter instance).
 */
export function happyDomCorruptFill(corruptValue: string): FakeDomBuilder {
  return (url: string) => {
    if (url !== HAPPY_URL) return { elements: {} };
    const table = happyDom(url).elements;
    return {
      elements: {
        ...table,
        "#name": { ...table["#name"], fillCorrupt: corruptValue },
      },
    };
  };
}
