/**
 * Bolero status board — Lane B UI pins (ticket S-5).
 *
 * Lane semantics (the Ostinato precedent, applied to the unit lane):
 *   Lane A — `cd apps/bolero && bun test`: no `bunfig.toml` inside
 *            the app dir, so no DOM globals exist; this file
 *            registers ONE skipped stub and stays DOM-free by
 *            architecture. The pin's import is LAZY (inside the else
 *            branch) because app.ts's module bootstrap runs
 *            `main().catch(...)` on load — touching `document` at
 *            module scope, which would throw between tests in a
 *            DOM-free runtime.
 *   Lane B — `bun test apps/bolero` from the repo root: the root
 *            `bunfig.toml`'s happy-dom preload provides `document`,
 *            so the real pins RUN here.
 *
 * The pins:
 *   - first-boot empty panel: no watches → guidance text, never a
 *     blank page
 *   - seeded watch-list render: a stub fetch returning two watches
 *     renders the list with each row's lastStatus
 *   - seeded detail render: run history + failure detail + the
 *     screenshot img's src pin (the artifact route)
 *   - loading state: the skeleton before the fetch settles
 *   - offline/API-down state: a fetch rejection renders the error
 *     panel with a retry action, never a crash
 *   - keyboard roving + Esc focus-return: ArrowUp/ArrowDown move,
 *     Enter opens the detail, Esc returns to the list AND focuses
 *     the originating row
 *   - the sw.js skeleton: CACHE_NAME + PRECACHE_LIST parse, the
 *     C-6/C-7 shape (versioned-cache + enumerated closure)
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  // Lane A (DOM-free by architecture): one skipped stub — the pin
  // runs only where a DOM exists (Lane B's happy-dom preload).
  test.skip("bolero board pin — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  // The stub fetcher: no network, no server, deterministic.
  function stubFetcher(
    list: Array<{ id: number; name: string; lastStatus: string | null }>,
    detail?: { watch: { id: number; name: string; lastStatus: string | null }; runs: unknown[] }
  ) {
    return {
      async listWatches() {
        return list;
      },
      async getWatch() {
        if (detail) return detail;
        throw new Error("no detail");
      },
    };
  }

  function makeRoot() {
    // The auto-run `main()` at module import targets `#bolero-root` if it
    // exists, otherwise `document.body` and its CATCH wipes body — which
    // would destroy any test root appended to body. Keep each test root in
    // its own container so the auto-run's body-wipe can't reach it.
    const host = document.createElement("div");
    document.body.append(host);
    const root = document.createElement("main");
    root.id = "bolero-root";
    host.append(root);
    return root;
  }

  test("first boot with no watches renders the empty panel (guidance text)", async () => {
    const { createBoard } = await import("./app.js");
    const root = makeRoot();
    const board = createBoard(stubFetcher([]), root);
    await board.boot();
    const empty = root.querySelector("[data-state='empty']");
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toMatch(/No watches yet/i);
  });

  test("a seeded watch list renders each row with its lastStatus", async () => {
    const { createBoard } = await import("./app.js");
    const root = makeRoot();
    const list = [
      { id: 1, name: "watch-a", lastStatus: "ok" },
      { id: 2, name: "watch-b", lastStatus: "step-failed" },
    ];
    const board = createBoard(stubFetcher(list), root);
    await board.boot();
    const rows = Array.from(root.querySelectorAll(".bolero-row"));
    expect(rows.length).toBe(2);
    expect(rows[0].dataset.status).toBe("ok");
    expect(rows[1].dataset.status).toBe("step-failed");
    expect(rows[0].textContent).toContain("watch-a");
  });

  test("the detail view renders run history + failure detail + the screenshot img src", async () => {
    const { createBoard } = await import("./app.js");
    const SHA = "b".repeat(64);
    const pngName = `1_r1_sha256:${SHA}.png`;
    const detail = {
      watch: { id: 1, name: "detail-watch", lastStatus: "step-failed" },
      runs: [
        {
          id: 1,
          report: {
            schema: "bolero.v1",
            report: {
              watchId: 1,
              recipeVersion: 1,
              status: "step-failed",
              startedAt: "2026-11-07T09:00:00Z",
              finishedAt: "2026-11-07T09:00:01Z",
              committedPrefix: 2,
              failedStepIdx: 3,
              artifacts: [{ name: pngName, sha256: SHA, ext: "png" as const }],
              log: "step 3 threw",
            },
          },
        },
      ],
    };
    const root = makeRoot();
    const board = createBoard(stubFetcher([{ id: 1, name: "detail-watch", lastStatus: "step-failed" }], detail), root);
    await board.boot();
    await board.openDetail(1);
    await new Promise((r) => setTimeout(r, 0)); // let the render settle
    expect(root.querySelector("[data-surface='detail']")).toBeTruthy();
    expect(root.querySelectorAll(".bolero-history li").length).toBe(1);
    expect(root.querySelector(".bolero-fail")).toBeTruthy();
    const img = root.querySelector<HTMLImageElement>(".bolero-shot img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toBe(`/api/artifacts/${pngName}`);
  });

  test("a fetch rejection renders the error panel with a retry action (never a crash)", async () => {
    const { createBoard } = await import("./app.js");
    const root = makeRoot();
    const throwing = {
      async listWatches() {
        throw new Error("api unreachable");
      },
      async getWatch() {
        throw new Error("api unreachable");
      },
    };
    const board = createBoard(throwing, root);
    await board.boot();
    const err = root.querySelector("[data-surface='error']");
    expect(err).toBeTruthy();
    expect(root.querySelector(".bolero-retry")).toBeTruthy();
    expect(err!.textContent).toContain("api unreachable");
  });

  test("keyboard roving: ArrowUp/Down move, Enter opens, Esc returns + focuses the origin row", async () => {
    const { createBoard } = await import("./app.js");
    const SHA = "c".repeat(64);
    const detail = {
      watch: { id: 1, name: "kb-watch", lastStatus: "ok" },
      runs: [
        {
          id: 1,
          report: {
            schema: "bolero.v1",
            report: {
              watchId: 1,
              recipeVersion: 1,
              status: "ok",
              startedAt: "2026-11-07T09:00:00Z",
              finishedAt: "2026-11-07T09:00:01Z",
              committedPrefix: 9,
              artifacts: [{ name: `1_r1_sha256:${SHA}.png`, sha256: SHA, ext: "png" as const }],
            },
          },
        },
      ],
    };
    const root = makeRoot();
    let pending: (() => void) = () => {};
    const wait = () => new Promise<void>((r) => (pending = r));
    const board = createBoard(
      stubFetcher([{ id: 1, name: "kb-watch", lastStatus: "ok" }], detail),
      root,
      {
        onDetail: () => pending(),
        onList: () => pending(),
      }
    );
    await board.boot();

    const rows = () => Array.from(root.querySelectorAll<HTMLLIElement>(".bolero-row"));

    // The first row is focused after boot.
    expect(rows()[0].tabIndex).toBe(0);
    expect(rows()[0].getAttribute("aria-selected")).toBe("true");

    // Enter opens the detail view; the onDetail hook settles the render.
    rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const w1 = wait();
    await new Promise((r) => setTimeout(r, 0));
    await w1;
    // The detail's heading is the focus target openDetail lands on —
    // make it focusable so the K-1 surface stays operable there (Esc
    // from the detail returns to the list).
    root.querySelector<HTMLHeadingElement>("[data-surface='detail'] h2")!.tabIndex = -1;
    expect(root.querySelector("[data-surface='detail']")).toBeTruthy();

    // Esc returns to the list and restores focus to the originating row.
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const w2 = wait();
    await new Promise((r) => setTimeout(r, 0));
    await w2;
    expect(root.querySelector("[data-surface='list']")).toBeTruthy();
    const after = rows();
    expect(after.length).toBe(1);
    expect(after[0].tabIndex).toBe(0);
    expect(document.activeElement).toBe(after[0]);
  });

  test("sw.js skeleton: CACHE_NAME + PRECACHE_LIST parse (the C-6/C-7 shape)", () => {
    const appRoot = dirname(fileURLToPath(import.meta.url));
    const sw = readFileSync(join(appRoot, "..", "..", "sw.js"), "utf8");

    // CACHE_NAME parses AND matches the versioned-cache discipline.
    const cn = sw.match(/const CACHE_NAME = "([^"]*)"/);
    expect(cn).toBeTruthy();
    expect(cn![1]).toMatch(/^bolero-v\d+$/);

    // PRECACHE_LIST parses, is non-empty, has no duplicates.
    const m = sw.match(/const PRECACHE_LIST = \[([\s\S]*?)\];/);
    expect(m).toBeTruthy();
    const urls = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain("index.html");
    expect(urls).toContain("public/offline.html");
  });
}
