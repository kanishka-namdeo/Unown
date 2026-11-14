/**
 * app.test.ts — the shell's boot + interaction pins (L-5, PLAN
 * §1.1: "boots against a StoragePort (injected; FakeStorage in
 * tests), the '/' search focus lane, the j/k/list/detail
 * composition, the state rendering, the empty state").
 *
 * Lane semantics (the el-pin precedent):
 *   Lane A — DOM-free: the emptyDoc() factory pin RUNS (pure data);
 *            the DOM-guarded boot/interaction pins register skipped
 *            stubs.
 *   Lane B — happy-dom: the real pins RUN (boot against FakeStorage,
 *            the empty-state panel, the '/' focus lane, detail open +
 *            Esc focus-return to the originating row).
 */
import { test, expect } from "bun:test";
import { emptyDoc, type AppDeps } from "./app.js";
import type { LegatoData } from "../domain/types.js";
import { FakeStorage } from "../storage/fake-storage.js";

// ─── The pure half (runs in BOTH lanes) ──────────────────────────

test("emptyDoc: a fresh store is the grammar's empty shape", () => {
  const d: LegatoData = emptyDoc();
  expect(d.schema).toBe("legato.v1");
  expect(d.schemaVersion).toBe(1);
  expect(d.clips).toEqual([]);
  expect(d.tags).toEqual([]);
  expect(d.queue).toEqual([]);
});

// ─── The DOM-guarded half (Lane B only) ───────────────────────────

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("app boot + '/' lane + detail Esc-return — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  /** A seeded FakeStorage + a detached boot root (happy-dom's body
   *  is NOT used as the root — main() renders into the element it
   *  is handed, so a detached div keeps the tests isolated). */
  async function boot(seeded: LegatoData | null) {
    const { main } = await import("./app.js");
    const storage = new FakeStorage(seeded);
    const root = document.createElement("div");
    document.body.append(root);
    const app = await main({ storage }, root);
    return { app, root, storage };
  }

  test("app: boots against FakeStorage on first boot → the honest empty state (DOM)", async () => {
    const { app, root } = await boot(null);
    expect(app.state.bootError).toBeNull();
    expect(app.state.data!.clips).toEqual([]);
    // The empty-state panel (Q-3: never a blank — the "clip your
    // first URL" affordance).
    const empty = root.querySelector<HTMLElement>("#legato-empty");
    expect(empty !== null).toBe(true);
    expect(empty!.textContent).toContain("No clips yet");
    expect(empty!.textContent).toContain("Clip your first URL");
    // The list is hidden, the detail lane shows its own empty copy.
    const list = root.querySelector<HTMLElement>("#legato-clips");
    expect(list!.style.display).toBe("none");
    const detail = root.querySelector<HTMLElement>("#legato-detail");
    expect(detail!.textContent).toContain("Nothing open");
    root.remove();
  });

  test("app: boots against a seeded FakeStorage → the clip list renders (DOM)", async () => {
    const seed: LegatoData = {
      schema: "legato.v1",
      schemaVersion: 1,
      clips: [
        {
          id: 1,
          url: "https://a.example",
          title: "Clip A",
          text: "alpha body",
          tags: ["x"],
          state: "unread",
          highlights: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      tags: ["x"],
      queue: [1],
    };
    const { app, root } = await boot(seed);
    expect(app.state.data!.clips.length).toBe(1);
    const rows = root.querySelectorAll<HTMLElement>(".legato-clip-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Clip A");
    root.remove();
  });

  test("app: the '/' lane focuses the search input; j/k move the cursor (DOM)", async () => {
    const seed: LegatoData = {
      schema: "legato.v1",
      schemaVersion: 1,
      clips: [
        { id: 1, url: "https://a.example", title: "One", text: "alpha beta", tags: [], state: "unread", highlights: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: 2, url: "https://b.example", title: "Two", text: "gamma delta", tags: [], state: "unread", highlights: [], createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
      ],
      tags: [],
      queue: [1, 2],
    };
    const { app, root } = await boot(seed);
    // Focus a non-input element first so the '/' lane is active
    // (the inInput guard: '/' while an input is focused is literal).
    const hdr = root.querySelector<HTMLElement>(".legato-header");
    hdr!.setAttribute("tabindex", "-1");
    hdr!.focus();
    // The '/' key focuses the search input (the focus lane).
    const key = new KeyboardEvent("keydown", { key: "/", bubbles: true });
    document.dispatchEvent(key);
    const searchEl = root.querySelector<HTMLElement>("#legato-search")!;
    // happy-dom returns a live element proxy: identity compares
    // fail across proxies, so the pin is by id (the law is that
    // the search input holds focus, which its id proves).
    expect((document.activeElement as HTMLElement).id).toBe("legato-search");
    // Now the input is focused — j/k typing there is literal, not
    // the cursor (the typingInInput guard). Move focus to a
    // focusable non-input element (the header) so the j/k
    // lane is active again.
    const title = root.querySelector<HTMLElement>(".legato-header");
    title!.setAttribute("tabindex", "-1");
    title!.focus();
    const j = new KeyboardEvent("keydown", { key: "j", bubbles: true });
    document.dispatchEvent(j);
    expect(app.state.selectedIdx).toBe(1);
    const rows = root.querySelectorAll<HTMLElement>(".legato-clip-row");
    expect((document.activeElement as HTMLElement)?.getAttribute("data-index")).toBe("1");
    const k = new KeyboardEvent("keydown", { key: "k", bubbles: true });
    document.dispatchEvent(k);
    expect(app.state.selectedIdx).toBe(0);
    root.remove();
  });

  test("app: Enter opens the detail; Esc returns focus to the originating row (DOM)", async () => {
    const seed: LegatoData = {
      schema: "legato.v1",
      schemaVersion: 1,
      clips: [
        { id: 1, url: "https://a.example", title: "Read Me", text: "the body text", tags: [], state: "unread", highlights: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      ],
      tags: [],
      queue: [1],
    };
    const { app, root } = await boot(seed);
    // Focus a non-input element so the Enter lane is active.
    const title = root.querySelector<HTMLElement>(".legato-title");
    title!.setAttribute("tabindex", "-1");
    title!.focus();
    // Enter opens the detail for row 0.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(app.state.detailOpen).toBe(true);
    const detail = root.querySelector<HTMLElement>("#legato-detail");
    expect(detail!.textContent).toContain("Read Me");
    expect(detail!.textContent).toContain("the body text");
    // Esc returns to the list: the detail closes, focus lands on the
    // originating row (row 0 — the tabindex=-1 target).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(app.state.detailOpen).toBe(false);
    const rows = root.querySelectorAll<HTMLElement>(".legato-clip-row");
    expect((document.activeElement as HTMLElement)?.getAttribute("data-index")).toBe("0");
    root.remove();
  });

  // ── The pipeline-boot lane's pins (the 2026-11-14 CI-receipt cure:
  //    runs 43614723332 + 43632794835 failed the clip lane with an
  //    EMPTY status line — deps.clipUrl was never wired and nothing
  //    surfaced it; the boot now retries + surfaces + answers with
  //    the honest not-booted stub) ──────────────────────────────────

  test("app: the clip pipeline boots — deps.clipUrl wires, the ready signal lands, the outcome is never silent (DOM)", async () => {
    const { main } = await import("./app.js");
    const deps: AppDeps = { storage: new FakeStorage(null) };
    const root = document.createElement("div");
    document.body.append(root);
    // The boot diagnostic is the wiring's signal: the log fires in
    // the same synchronous block that assigns deps.clipUrl (the
    // RealFetcher + the read seam + the assignment), so seeing the
    // line means the real pipeline is callable.
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    try {
      await main(deps, root);
      // Bounded wait for the dynamic-import boot to land (bun
      // resolves the cached modules in microtasks; 3 s is generous).
      let wired = false;
      for (let i = 0; i < 120 && !wired; i++) {
        wired = lines.some((l) => l.includes("pipeline closure booted"));
        if (!wired) await new Promise((r) => setTimeout(r, 25));
      }
      expect(wired).toBe(true);
      expect(typeof deps.clipUrl).toBe("function");
      // THE READY SIGNAL (the lane's contract): the synchronous
      // first write — "Clipping <url>…" — the exact signal the
      // e2e lane's clipAndRead waits on.
      deps.clipUrl!("https://unreachable.invalid/x");
      const status = document.getElementById("legato-status");
      expect(status!.textContent).toContain("Clipping https://unreachable.invalid/x");
      // THE HONEST OUTCOME (never silent): the unreachable host
      // rejects (RFC 2606's .invalid never resolves) → the
      // orchestrator's fetch-failed lane → the degraded clip's
      // status write. Bounded: DNS rejects in ~1.5 s locally; the
      // 10 s bound covers loaded machines.
      let outcome = "";
      for (let i = 0; i < 400; i++) {
        outcome = document.getElementById("legato-status")?.textContent ?? "";
        if (outcome.includes("Clipped (degraded: fetch-failed)")) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(outcome).toContain("Clipped (degraded: fetch-failed)");
    } finally {
      console.log = origLog;
      root.remove();
    }
  });

  test("app: a submit that outlives the pipeline boot gets the honest not-booted notice — never the silent no-op (DOM)", async () => {
    const { main } = await import("./app.js");
    const deps: AppDeps = { storage: new FakeStorage(null) };
    const root = document.createElement("div");
    document.body.append(root);
    // The boot's own guard ("a window without fetch has nothing to
    // boot") makes the stub lane deterministic here: with fetch
    // gone, the dynamic-import boot no-ops and deps.clipUrl KEEPS
    // the not-booted stub — the exact window the CI receipts hit
    // (a submit racing a boot that never lands).
    const wAny = (globalThis as Record<string, unknown>)["window"] as Record<string, unknown>;
    const savedFetch = wAny["fetch"];
    delete wAny["fetch"];
    try {
      await main(deps, root);
      expect(typeof deps.clipUrl).toBe("function");
      deps.clipUrl!("https://example.com/anything");
      // THE HONEST NOTICE (the store-not-loaded guard's twin): the
      // status line gets words — the silent `?.` no-op lane (the
      // receipt's signature: an EMPTY status for the whole 30 s
      // budget) is gone.
      const status = document.getElementById("legato-status");
      expect(status!.textContent).toContain("Clip: the pipeline has not booted yet — try again.");
    } finally {
      if (savedFetch !== undefined) wAny["fetch"] = savedFetch;
      root.remove();
    }
  });
}
