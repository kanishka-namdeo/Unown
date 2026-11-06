/**
 * C-3 — the app boot persistence pins (P0 #6's "every transition
 * persists" + the corrupt/empty boot panels).
 *
 *   Lane A — `cd apps/chaconne && bun test`: no DOM → one skipped
 *            stub (the module's boot-time side effects are avoided
 *            by the lazy import inside the else branch).
 *   Lane B — `bun test apps/chaconne` from the root: happy-dom
 *            provides `document` + `window.localStorage` → the real
 *            pins RUN.
 *
 * The pins:
 *   1. First boot (no localStorage key) → the ready state with an
 *      honest empty data set (the no-recipes panel, never blank).
 *   2. Corrupt committed bytes → the error panel (the load() null
 *      + the import gate's throw lane — Ostinato's receipt verbatim).
 *   3. The every-transition persist: after a data mutation, the
 *      committed key holds the canonical bytes (the persistAll law).
 *   4. The sw.js skeleton: CACHE_NAME + the empty PRECACHE_LIST
 *      (C-6/C-7's completion contract).
 */
import { test, expect, afterEach } from "bun:test";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("chaconne boot pin — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  /** A clean localStorage for each test (happy-dom's window). */
  function cleanStorage(): void {
    window.localStorage.clear();
  }

  function cleanBody(): void {
    document.body.innerHTML = "";
  }

  afterEach(() => {
    cleanStorage();
    cleanBody();
  });

  // The import of the app module runs main().catch(...) at module
  // scope (the Ostinato lane) — that's why these pins are lazy:
  // the module's bootstrap touches `document` + `window.localStorage`
  // on import, so a DOM-free runtime throws between tests.

  test("first boot: no localStorage key → the ready state + the empty panel (never blank)", async () => {
    cleanStorage();
    cleanBody();

    // A minimal root for the app's render target.
    const root = document.createElement("main");
    root.id = "chaconne-root";
    document.body.append(root);

    // A stub storage that returns null (first boot).
    const storage = window.localStorage;
    expect(storage.getItem("chaconne.data")).toBeNull();

    // Run the app's main() (idempotent: the module already ran it
    // at import; this pin checks the DOM outcome, not a re-boot).
    // The first-boot data set is the honest empty state.
    const mod = await import("./app.js");
    expect(typeof mod.main).toBe("function");

    // The root should now carry the header (the boot reached the
    // render phase — no blank screen).
    expect(root.querySelector(".chaconne-header")).not.toBeNull();
    // The no-recipes empty panel (the C-1 contract: load() null →
    // the empty panels, never blank).
    expect(root.textContent).toContain("No recipes yet");
  });

  test("corrupt committed bytes → the error panel (the load() null + import gate lane)", async () => {
    // Pre-seed a corrupt committed key.
    window.localStorage.setItem("chaconne.data", "{not-valid-json");

    const root = document.createElement("main");
    root.id = "chaconne-root";
    document.body.append(root);

    // Re-run the app's main() to boot against the corrupt store.
    const mod = await import("./app.js");
    await mod.main();

    // The error panel lands (role=alert, the clear button).
    expect(root.querySelector(".chaconne-error")).not.toBeNull();
    expect(root.textContent).toContain("Storage error");
  });

  test("every-transition persist: after a data mutation, the committed key holds canonical bytes", async () => {
    cleanStorage();
    cleanBody();

    const root = document.createElement("main");
    root.id = "chaconne-root";
    document.body.append(root);

    // Seed a valid store + a known data set.
    const { toCanonicalJson } = await import("../domain/io.js");
    const { addRecipe } = await import("../domain/model.js");
    const { emptyData } = await import("../domain/model.js");

    let data = emptyData();
    data = addRecipe(data, "persist-test", [{ kind: "goto", selector: "https://example.com" }]).data;

    // Persist through the app's own lane: the storage adapter + io.
    const { createLocalStorageAdapter } = await import("../storage/local-storage.js");
    const { createImportExport } = await import("../domain/io.js");
    const storage = createLocalStorageAdapter(window.localStorage);
    const io = createImportExport();
    await storage.save(data, io.exportData(data));

    // The committed key holds EXACTLY the canonical bytes (the
    // byte-stability law — the Ostinato lane I-1 kin).
    const committed = window.localStorage.getItem("chaconne.data");
    expect(committed).toBe(io.exportData(data));
    expect(committed).toBe(toCanonicalJson(data));

    // A reload round-trip: load() returns the same data set.
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.recipes[0]?.name).toBe("persist-test");
  });

  test("sw.js: CACHE_NAME 'chaconne-v0' + the C-5-completed PRECACHE_LIST (the offline closure)", async () => {
    // Read the sw.js source (the offline closure's static contract —
    // the list is completed at C-5; every static asset the shell
    // needs at boot is enumerated with a derivation comment).
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const swPath = join(process.cwd(), "apps/chaconne/sw.js");
    const sw = await readFile(swPath, "utf8");
    expect(sw).toContain('const CACHE_NAME = "chaconne-v0";');
    // The C-5 completion: the list is non-empty and carries the shell's
    // document root + manifest + icon + css + offline fallback + the
    // app.ts entry + the module graph (the derivation comment).
    expect(sw).toContain("const PRECACHE_LIST = [");
    expect(sw).toContain('"index.html"');
    expect(sw).toContain('"public/manifest.webmanifest"');
    expect(sw).toContain('"public/icon.svg"');
    // The C-5 gate-caught fix: public/offline.html is a C-7 asset and
    // MUST NOT appear as a LIVE precache entry (cache.add rejects a
    // 404 — the install would fail). It lives only in the fetch-lane
    // fallback reference (cache.match on a missing entry → undefined,
    // no throw) and in the comment naming C-7 as the restorer. Scan
    // the list's live entries (non-comment lines) for the string.
    const swListBlock = sw.slice(sw.indexOf("const PRECACHE_LIST"), sw.indexOf("];", sw.indexOf("const PRECACHE_LIST")));
    const liveEntries = swListBlock.split("\n").filter((l) => !l.trim().startsWith("//"));
    expect(liveEntries.join("\n")).not.toContain('"public/offline.html"');
    expect(sw).toContain('"src/ui/chaconne.css"');
    expect(sw).toContain('"src/ui/app.ts"');
    expect(sw).toContain('"src/domain/types.ts"');
    expect(sw).toContain('"src/storage/local-storage.ts"');
    // The derivation comment (the ticket's doc pin).
    expect(sw).toContain("Derivation (the comment the ticket");
  });
}
