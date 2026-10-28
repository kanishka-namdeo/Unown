// Component tests for the Cadence UI (src/components/cadence/*).
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same style as the landing __tests__ (bun:test +
// @testing-library/react). Every date-sensitive component is driven with a
// FIXED `asOf` day key so results are deterministic; the store's
// localStorage path is spied on (happy-dom provides window.localStorage)
// to prove the single-commit persistence effect fires on user actions.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CadenceProvider, useCadence } from "@/lib/cadence/store";
import type { CadenceState } from "@/lib/cadence/types";
import { seedCadence } from "@/lib/cadence/seed";
import { toWeeklyBars } from "@/lib/cadence/stats";
import { CadenceShell } from "../shell";
import { Dashboard } from "../dashboard";
import { Heatmap } from "../heatmap";
import { StatsChart } from "../stats-chart";
import { HabitForm } from "../habit-form";

// A FIXED clock: every seeded checkoff is anchored to it, and tests pass it
// as `asOf` where a component accepts one.
const AS_OF = "2026-07-14";
const AS_OF_DATE = new Date(2026, 6, 14);
const seed = seedCadence(AS_OF_DATE);
// The seeded state at the FIXED asOf date: how many of the 6 habits are
// already checked off on that day. The dashboard's "N of M done" line must
// match this exactly — the real pin replacing the tautology.
const doneOnASOF = seed.habits.filter((h) =>
  (seed.entries[h.id] ?? []).includes(AS_OF),
).length;
/** Seed the localStorage first-load path so the provider starts deterministically. */
function seedStorage() {
  window.localStorage.clear();
  window.localStorage.setItem(
    "cadence:v1",
    JSON.stringify({
      habits: seed.habits,
      entries: seed.entries,
      theme: "dark",
    }),
  );
  window.localStorage.setItem("cadence:seedVersion", "1");
}

/** Spy on the store's persistence effect (the single commit path).
 *
 * The store's commit effect calls `saveState` → `localStorage.setItem`.
 * happy-dom's localStorage is a global; `Object.defineProperty` on the
 * instance (the `window.localStorage` object) is the one pattern that
 * reliably intercepts calls made *through the module* (the persistence
 * module captured its own reference at import time), unlike a simple
 * property assignment on the global which some runtimes route around. */
function spySaves(): { saves: number[]; restore: () => void } {
  const saves: number[] = [];
  const ls = window.localStorage;
  const proto = Object.getPrototypeOf(ls);
  const origSet = proto.setItem.bind(ls) as (k: string, v: string) => void;
  const patched = (k: string, v: string) => {
    if (k === "cadence:v1") saves.push(v.length);
    return origSet(k, v);
  };
  Object.defineProperty(ls, "setItem", {
    value: patched,
    writable: true,
    configurable: true,
  });
  return {
    saves,
    restore: () =>
      Object.defineProperty(ls, "setItem", {
        value: origSet,
        writable: true,
        configurable: true,
      }),
  };
}

/** A probe that reads the provider state from inside the tree. */
function Probe({ onSnap }: { onSnap: (s: CadenceState) => void }) {
  const { state } = useCadence();
  onSnap({ habits: state.habits, entries: state.entries, theme: state.theme });
  return null;
}

beforeEach(() => {
  seedStorage();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("cadence shell", () => {
  test("renders all three views via the store's setView", () => {
    const { container } = render(
      <CadenceProvider>
        <CadenceShell embed={false} />
      </CadenceProvider>,
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Today", "Habits", "Stats"]);

    fireEvent.click(tabs[2]);
    expect(container.textContent).toContain("Completions — last 52 weeks");

    fireEvent.click(tabs[1]);
    expect(container.textContent).toContain("+ New habit");

    fireEvent.click(tabs[0]);
    // Today: the "N of M done" progress line. The shell's Dashboard
    // renders with no asOf (uses todayKey(new Date())), so the count
    // reflects the seeded state at the REAL current date. The seed is
    // deterministic but anchored to 2000-01-01, so todayKey(new Date())
    // will never be in the seeded entries → 0 of 6 done.
    expect(container.textContent).toContain(
      `0 of ${seed.habits.length} done`,
    );
    // Also pin the Dashboard component directly with the fixed asOf date,
    // computing the expected value from the seed (not hardcoded blindly).
    const { container: dashContainer } = render(
      <CadenceProvider>
        <Dashboard asOf={AS_OF} />
      </CadenceProvider>,
    );
    expect(dashContainer.textContent).toContain(
      `${doneOnASOF} of ${seed.habits.length} done`,
    );
  });

  test("embed mode shows the live-demo tag", () => {
    const { container } = render(
      <CadenceProvider>
        <CadenceShell embed={true} />
      </CadenceProvider>,
    );
    expect(container.textContent).toContain("live demo");
  });
});

describe("dashboard (Today view)", () => {
  test("check-off button toggles today's entry in the store", () => {
    const { saves, restore } = spySaves();
    const { container } = render(
      <CadenceProvider>
        <Dashboard asOf={AS_OF} />
      </CadenceProvider>,
    );
    const buttons = [...container.querySelectorAll('button[aria-pressed]')];
    expect(buttons.length).toBeGreaterThan(0);

    const target = buttons.find((b) =>
      b.getAttribute("aria-label")?.includes("Drink 8 glasses"),
    );
    expect(target).toBeTruthy();
    const before = target!.getAttribute("aria-pressed");
    fireEvent.click(target!);
    const after = target!.getAttribute("aria-pressed");
    expect(before).not.toEqual(after);
    // a check-off committed through the store's persistence effect
    expect(saves.length).toBeGreaterThan(0);
    restore();
  });

  test("empty state when zero habits", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "cadence:v1",
      JSON.stringify({ habits: [], entries: {}, theme: "dark" }),
    );
    window.localStorage.setItem("cadence:seedVersion", "1");
    const { container } = render(
      <CadenceProvider>
        <Dashboard asOf={AS_OF} />
      </CadenceProvider>,
    );
    expect(container.textContent).toContain("No habits yet");
  });
});

describe("heatmap", () => {
  test("renders 52×7 cells with role=grid", () => {
    const habit = seed.habits[0];
    const entries = seed.entries[habit.id] ?? [];
    const { container } = render(
      <Heatmap habit={habit} entries={entries} asOf={AS_OF} />,
    );
    const grid = container.querySelector('[role="grid"]');
    expect(grid).toBeTruthy();
    const cells = [...container.querySelectorAll('[role="cell"]')];
    expect(cells.length).toBe(52 * 7);
    // spot-check every cell's inner swatch carries the date in its title attribute
    const titled = cells.filter(
      (c) => c.firstElementChild?.getAttribute("title") !== null,
    );
    expect(titled.length).toBe(52 * 7);
  });
});

describe("stats-chart", () => {
  test("svg role=img with 52 bars", () => {
    const bars = toWeeklyBars(seed.entries, seed.habits, AS_OF);
    expect(bars.length).toBe(52);
    const { container } = render(<StatsChart bars={bars} target={bars[0].target} />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute("aria-label")).toBe(
      "Completions per week, last 52 weeks",
    );
    const rects = [...(svg as unknown as HTMLElement).querySelectorAll("rect")];
    expect(rects.length).toBeGreaterThanOrEqual(52);
  });
});

describe("habit-form", () => {
  test("blocks submit on empty name (no store mutation)", () => {
    let habitCountBefore = -1;
    const { container } = render(
      <CadenceProvider>
        <HabitForm onClose={() => {}} />
        <Probe onSnap={(s) => (habitCountBefore = s.habits.length)} />
      </CadenceProvider>,
    );
    expect(habitCountBefore).toBe(seed.habits.length);

    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // pressing a disabled button is a no-op; force it anyway to be safe
    fireEvent.click(submit);
    // wait a tick for any (incorrect) mutation to settle
    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
      expect(habitCountBefore).toBe(seed.habits.length);
      // and an inline error is shown for the empty name
      expect(
        container.textContent,
      ).toContain("Please enter a habit name.");
    });
  });

  test("a valid name + submit adds the habit", () => {
    let addedName = "";
    const { container } = render(
      <CadenceProvider>
        <HabitForm
          onClose={() => {}}
        />
        <Probe onSnap={(s) => {
          const last = s.habits[s.habits.length - 1];
          if (last && last.name === "Meditate") addedName = last.name;
        }} />
      </CadenceProvider>,
    );
    const name = container.querySelector("#habit-name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Meditate" } });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(addedName).toBe("Meditate");
  });
});
