/**
 * The /fugue route family's page contracts, drift-pinned.
 *
 * The cadence round's pattern (src/app/cadence/__tests__/page.test.tsx):
 * ?embed=1 is read server-side and must reach the client tree as an explicit
 * prop — the server render and the hydration render agree and React #418
 * never fires. The fugue pages ship the bazaar/cadence/parley shape:
 * sync-outer Page + Suspense + async PageInner that awaits the Next 15+/16
 * searchParams Promise (a fully-async default export measured live to drop
 * the query — embed:false serialized into the RSC payload for ?embed=1;
 * fixed by pattern parity with the three live gallery apps).
 *
 * Two lanes per page: (a) the outer Page renders the Suspense fallback
 * (the async inner resolves in the Next runtime, pinned end-to-end by the
 * production build and the live demo); (b) PageInner is exported so the
 * embed contract itself is pinned directly — await the inner, render the
 * returned tree, settle the auth probe, and assert the EMBEDDED heading
 * mounts (the visible receipt that embed=1 reached the client tree).
 *
 * /fugue itself is the embed entry: PageInner without the flag
 * redirect()s to /fugue/flows — in the bun lane that is the NEXT_REDIRECT
 * rejection from the awaited inner call, pinned by catching.
 *
 * Rendering the three sub-pages' inners also drives
 * src/components/fugue/entries.tsx (the client entry points they delegate
 * to) through mount + fetch effects, which is what gives that file its
 * coverage row.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";

// Host-embedding adaptation: bun runs all test files in one process — restore the
// NATIVE fetch (never `undefined`) so later suites (cadence, bazaar) keep a
// working global. Captured at module load, before any router patches it.
const NATIVE_FETCH = globalThis.fetch;
import { render, screen, cleanup } from "@testing-library/react";
import Page, { PageInner } from "../page";
import FlowsPage, { PageInner as FlowsInner } from "../flows/page";
import RunsPage, { PageInner as RunsInner } from "../runs/page";
import StatsPage, { PageInner as StatsInner } from "../stats/page";

beforeEach(() => cleanup());
afterEach(() => {
  // RTL cleanup removes the mounted tree; also restore the global fetch so
  // a forgotten patch in a later/earlier file can't poison this lane.
  cleanup();
  globalThis.fetch = NATIVE_FETCH;
});

/** The embedded auth screen's heading — proof embed=1 reached the client tree. */
const EMBED_HEADING = "Fugue (embedded)";

/** Render an awaited async inner's tree. */
async function renderInner(tree: Promise<import("react").ReactElement>) {
  return render(await tree);
}

/**
 * The auth probe (GET /fugue/api/auth/me) settles on a microtask; the
 * existing suites use the same 50ms tick to let the shell settle.
 */
async function settle() {
  await new Promise((r) => setTimeout(r, 60));
}

const sp = (embed: string) => Promise.resolve({ embed });

describe("/fugue page (the embed entry's React #418 contract)", () => {
  test("the outer Page renders the Suspense fallback (cadence lane)", () => {
    const { container } = render(<Page searchParams={sp("1")} />);
    // The boundary's fallback is the min-h-full div while the async
    // inner component resolves (in the Next runtime; not awaited here).
    expect(container.querySelector(".min-h-full")).not.toBeNull();
  });

  test("PageInner: embed=1 reaches the client tree (no header, embedded heading)", async () => {
    const { container } = await renderInner(PageInner({ searchParams: sp("1") }));
    expect(container.querySelector(".min-h-screen")).not.toBeNull();
    await settle();
    expect(screen.getByText(EMBED_HEADING)).toBeDefined();
    // Embed mode owns no header — the host's nav drives the app.
    expect(screen.queryByRole("banner")).toBeNull();
  });

  test("PageInner without embed redirects to /fugue/flows (NEXT_REDIRECT)", async () => {
    let err: unknown = null;
    try {
      await PageInner({ searchParams: sp("0") });
    } catch (e) {
      err = e;
    }
    const digest = (err as { digest?: string } | null)?.digest ?? "";
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("/fugue/flows");
  });

  test("the outer default export takes searchParams as an explicit typed prop", () => {
    expect(typeof Page).toBe("function");
    expect(Page.length).toBe(1);
  });
});

describe("/fugue/flows page (bazaar hydration pattern)", () => {
  test("the outer Page renders the Suspense fallback", () => {
    const { container } = render(<FlowsPage searchParams={sp("1")} />);
    expect(container.querySelector(".min-h-full")).not.toBeNull();
  });

  test("PageInner: embed=1 reaches the client tree", async () => {
    const { container } = await renderInner(FlowsInner({ searchParams: sp("1") }));
    expect(container.querySelector(".min-h-screen")).not.toBeNull();
    await settle();
    expect(screen.getByText(EMBED_HEADING)).toBeDefined();
  });

  test("the outer default export takes searchParams as an explicit typed prop", () => {
    expect(typeof FlowsPage).toBe("function");
    expect(FlowsPage.length).toBe(1);
  });
});

describe("/fugue/runs page (bazaar hydration pattern)", () => {
  test("the outer Page renders the Suspense fallback", () => {
    const { container } = render(<RunsPage searchParams={sp("1")} />);
    expect(container.querySelector(".min-h-full")).not.toBeNull();
  });

  test("PageInner: embed=1 reaches the client tree", async () => {
    const { container } = await renderInner(RunsInner({ searchParams: sp("1") }));
    expect(container.querySelector(".min-h-screen")).not.toBeNull();
    await settle();
    expect(screen.getByText(EMBED_HEADING)).toBeDefined();
  });

  test("the outer default export takes searchParams as an explicit typed prop", () => {
    expect(typeof RunsPage).toBe("function");
    expect(RunsPage.length).toBe(1);
  });
});

describe("/fugue/stats page (bazaar hydration pattern)", () => {
  test("the outer Page renders the Suspense fallback", () => {
    const { container } = render(<StatsPage searchParams={sp("1")} />);
    expect(container.querySelector(".min-h-full")).not.toBeNull();
  });

  test("PageInner: embed=1 reaches the client tree", async () => {
    const { container } = await renderInner(StatsInner({ searchParams: sp("1") }));
    expect(container.querySelector(".min-h-screen")).not.toBeNull();
    await settle();
    expect(screen.getByText(EMBED_HEADING)).toBeDefined();
  });

  test("the outer default export takes searchParams as an explicit typed prop", () => {
    expect(typeof StatsPage).toBe("function");
    expect(StatsPage.length).toBe(1);
  });
});
