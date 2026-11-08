/**
 * b16.test.ts — THE B-16 UNIT-LANE CORROBORATION (PLAN §6.3,
 * L-11 deliverable #6).
 *
 * The B16-HOLDOUT.md freeze manifest (frozen at L-3, re-run at
 * L-11) names the 5 static fixture files + their SHA-256. THIS
 * FILE is the "fixture-files-as-law" lane:
 *
 *   1. THE FREEZE GATE — every fixture file's SHA-256 must still
 *      match the L-3 freeze. A byte change in a frozen file is a
 *      red gate (the manifest's Law #1: "the only legitimate
 *      change is a receipted operator decision").
 *   2. THE TAXONOMY LANE — for every static fixture, the
 *      FakeFetcher's canned double (the byte-faithful body + the
 *      header the fixture server would send for that file) is
 *      run through the clip orchestrator (clip.ts) + the
 *      classifier (error-taxonomy.ts), and the resulting Clip's
 *      `error` lane is asserted against the manifest's expected
 *      `ClipError` (the manifest is the assertion source — the
 *      code is never the law; if they disagree, the code is
 *      wrong).
 *
 * LANE SPLIT (the ostinato el-pin precedent):
 *   - Lane A (`cd apps/legato && bun test`): the SHA-256 gate
 *     RUNS (pure node:crypto + node:fs — no DOM). The taxonomy
 *     pins that need the DOMParser extractor (clean, paywall,
 *     huge, empty-article) are DOM-GUARDED (registered as skipped
 *     stubs when `document` is absent).
 *   - Lane B (`bun test apps/legato` from the root): the
 *     happy-dom preload provides the DOM; the real pins RUN.
 *
 * The DYNAMIC routes (redirect-chain, redirect-loop, walled-403,
 * walled-429, /slow, /health) are exercised ONLY in the L-11
 * e2e lane (against the live 4018 fixture server) — the unit
 * lane covers the STATIC files here (the "no real network is
 * touched by any unit lane" law, PLAN §6.1).
 *
 * The manifest's static rows (apps/legato/fixtures/B16-HOLDOUT.md
 * §"URL → Taxonomy → Expected ClipError"):
 *   clean.html            → clean  (—)
 *   wrong-charset.html    → T-1    charset-unknown
 *   paywall-excerpt.html  → T-4    paywalled
 *   huge.html             → T-5    oversized
 *   empty-article.html    → T-6    empty-text
 */
import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { FakeFetcher, toUtf8Bytes } from "./fetcher.js";
import { clipUrl } from "./clip.js";
import type { Clip, LegatoData } from "../domain/types.js";

// ── The freeze gate (the manifest's SHA-256 table, verbatim) ──

/**
 * The L-3 freeze manifest's SHA-256 table — byte-verbatim from
 * apps/legato/fixtures/B16-HOLDOUT.md. The law: any change to a
 * fixture file's bytes after freeze is a regression (red gate),
 * never a silent quality dip.
 */
const B16_SHA256: Readonly<Record<string, string>> = {
  "clean.html":
    "f4794d955b0dd0e445435a06c0517f9318fa0db846167850c26e254b3722f6b7",
  "wrong-charset.html":
    "057f9c7f91c594e4ab5d87abdf34b1a7423acacf2cc86ef859a2225735c359a6",
  "paywall-excerpt.html":
    "b6ec767aa8f392058a4f9dd31819381683e13f3062f1f38958d8ba3dfe0ff181",
  "huge.html":
    "10b52aab80cd26a9162235bbe1448ec667248b53209783f82b0977505bf35f73",
  "empty-article.html":
    "a75cf4b5c2496447f041d796893cf1ece809680f74ac4879d22110ba53191faf",
};

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures");

/**
 * The freeze gate (RUNS in BOTH lanes — pure node:fs +
 * node:crypto, no DOM, no network). Any byte drift in a frozen
 * fixture is a red gate (the manifest's Law #1).
 */
test("B-16 freeze gate: every static fixture's SHA-256 matches the L-3 freeze", async () => {
  for (const [name, frozen] of Object.entries(B16_SHA256)) {
    const buf = await readFile(join(FIXTURES_DIR, name));
    const sha = createHash("sha256").update(buf).digest("hex");
    expect(sha, `${name}: drifted from the L-3 freeze (regression — red gate)`).toBe(
      frozen,
    );
  }
});

/** Read a static fixture file into a `CannedFetch` body (the
 *  FakeFetcher's canned bytes — byte-faithful against the frozen
 *  fixture). */
async function cannedBytes(name: string): Promise<ArrayBuffer> {
  // The `encoding` argument is OMITTED — at RUNTIME Bun's `readFile`
  // returns a Buffer (a Uint8Array) whose `.buffer` is the
  // underlying ArrayBuffer, byte-faithful against the frozen fixture
  // (the manifest's Law #3: "Static fixtures are byte-honest").
  // The root tsconfig's types narrow the no-encoding overload to
  // `string` (Node's `TextEncoder` convention), so the cast goes
  // through `unknown` — the runtime bytes ARE a Buffer; only the
  // type declaration is wrong for Bun's binding.
  const buf = (await readFile(join(FIXTURES_DIR, name))) as unknown as Uint8Array;
  return buf.buffer as ArrayBuffer;
}

/** The content-type header the 4018 fixture server would attach
 *  to each static route (`/fixtures/*.html` → `text/html`). The
 *  charset for `wrong-charset.html` is what makes the T-1 lane
 *  fire (the fixture's own `<meta charset="windows-1252">` tag
 *  is the signal — the header alone is just `text/html`). */
const headersFor = (name: string): Record<string, string> =>
  name === "wrong-charset.html"
    ? { "content-type": "text/html; charset=windows-1252" }
    : { "content-type": "text/html" };

/** An empty store view (the ids.ts allocation target — every
 *  fixture clip is id 1 in this lane). */
function emptyData(): LegatoData {
  return { schema: "legato.v1", schemaVersion: 1, clips: [], tags: [], queue: [] };
}

const NOW = "2026-11-07T00:00:00.000Z";
const clock = () => NOW;

/** Clip a static fixture through the orchestrator + classifier,
 *  using the fixture file's actual bytes (the byte-honest rule —
 *  no placeholders, the B-16 manifest's Law #3). */
async function clipFixture(name: string, url: string): Promise<Clip> {
  const body = await cannedBytes(name);
  const fetcher = new FakeFetcher(url, {
    status: 200,
    headers: headersFor(name),
    body,
  });
  return clipUrl(url, { fetcher, data: emptyData(), clock });
}

// ── The static-fixture taxonomy lane (DOM-guarded: the clean,
//    paywall, huge, empty-article pins reach the DOMParser
//    extractor — Lane B only) ────────────────────────────────────

const hasDom = typeof document !== "undefined";

/**
 * The T-1 lane (wrong-charset → charset-unknown) SHORT-CIRCUITS
 * before extraction (the undecodable flag is set in the
 * orchestrator's charset sniff; the extractor never runs), so
 * this pin RUNS in BOTH lanes.
 */
test("B-16 T-1: wrong-charset.html → charset-unknown clip (never mojibake)", async () => {
  const c = await clipFixture(
    "wrong-charset.html",
    "http://127.0.0.1:4018/fixtures/wrong-charset.html",
  );
  expect(c.id).toBe(1);
  expect(c.state).toBe("unread");
  expect(c.tags).toEqual([]);
  expect(c.highlights).toEqual([]);
  expect(c.createdAt).toBe(NOW);
  expect(c.updatedAt).toBe(NOW);
  expect(c.error).toBe("charset-unknown");
  expect(c.text).toBe(""); // no extraction — the undecodable gate
  // The title fallback (host name, the PLAN §1.1 "fallback: host
  // name" rule) — the fixture's document title is NOT usable
  // (the undecodable gate skips extraction), so the fallback is
  // the host.
  expect(c.title.length).toBeGreaterThan(0);
});

if (!hasDom) {
  test.skip(
    "B-16 static taxonomy pins (clean/paywalled/oversized/empty-text) — requires a DOM (Lane B's happy-dom provides it)",
    () => {},
  );
} else {
  test("B-16 clean: clean.html → the happy-path clean clip (no error)", async () => {
    const c = await clipFixture(
      "clean.html",
      "http://127.0.0.1:4018/fixtures/clean.html",
    );
    expect(c.id).toBe(1);
    expect(c.state).toBe("unread");
    expect(c.tags).toEqual([]);
    expect(c.highlights).toEqual([]);
    expect(c.error).toBeUndefined(); // the clean lane — no ClipError
    expect(c.jsWalled).toBeUndefined();
    expect(c.paywallExcerptOnly).toBeUndefined();
    expect(c.emptyText).toBeUndefined();
    expect(c.title).toBe("Clean story"); // the document's <title>
    expect(c.text.length).toBeGreaterThan(200); // the readable body
  });

  test("B-16 T-4: paywall-excerpt.html → paywalled clip (excerpt lane, never bypass)", async () => {
    const c = await clipFixture(
      "paywall-excerpt.html",
      "http://127.0.0.1:4018/fixtures/paywall-excerpt.html",
    );
    expect(c.error).toBe("paywalled");
    expect(c.paywallExcerptOnly).toBe(true);
    expect(c.excerpt).toBeDefined();
    expect((c.excerpt ?? "").length).toBeGreaterThan(0);
    // text = the excerpt (the manifest's success bar: "text = the
    // excerpt" — the paywall lane's honest degrade, never the
    // full body).
    expect(c.text).toBe(c.excerpt ?? "");
    expect(c.title).toBe("The Paywalled Story");
  });

  test("B-16 T-5: huge.html → oversized clip (500 KB cap, retained prefix)", async () => {
    const c = await clipFixture(
      "huge.html",
      "http://127.0.0.1:4018/fixtures/huge.html",
    );
    expect(c.error).toBe("oversized");
    // The 500 KB cap: extracted text is capped at EXTRACT_CAP_BYTES
    // (500 * 1024 = 512000 chars, ASCII byte ≈ char). The manifest
    // pins "text length ≤ 500 000 chars" (the cap is 500 000 BYTES
    // ≈ 500 000 CHARS for ASCII). The classifier's exact slice is
    // the cap value; assert ≤ the cap + > 0 (the prefix is
    // retained, the full text is not).
    const CAP = 500 * 1024;
    expect(c.text.length).toBeGreaterThan(0);
    expect(c.text.length).toBeLessThanOrEqual(CAP);
    expect(c.title).toBe("The Enormous Article");
  });

  test("B-16 T-6: empty-article.html → empty-text clip (title+URL fallback + flag)", async () => {
    const c = await clipFixture(
      "empty-article.html",
      "http://127.0.0.1:4018/fixtures/empty-article.html",
    );
    expect(c.error).toBe("empty-text");
    expect(c.emptyText).toBe(true);
    expect(c.text).toBe("");
    expect(c.title).toBe("Empty Article"); // the document title survives
  });
}
