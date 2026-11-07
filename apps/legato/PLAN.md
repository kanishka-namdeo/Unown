# Legato — Architecture Plan (L-0)

> One-line identity: **Legato is a keyboard-first, offline-first
> read-later / web-clip PWA at `apps/legato/`** — clip a URL → clean
> readable copy stored locally, full-text search + tags, a keyboard-
> driven reading queue, highlights, byte-stable JSON import/export,
> PWA offline, no account, no server.

Basis: `docs/vivace-prd.md` (the Legato PRD — pre-registered 2026-11-05
on tree `18e4a98a`; the round vehicle was **selected per the §0.9.5
fallback law** by the Serenade round, receipted in
`docs/serenade-round-session.md` + `benchmarks/serenade-round/README.md`
(re-scoring the Vivace candidate card against the round's weakness
map, baseline frozen on `6e3579bb`)). This file materializes the
scored plan at `.unown/plans/plan.md` (101 lines, scored 100/100,
`passes: true`) as the permanent, repo-tracked artifact the 12-ticket
build queue is driven against.

Tree: `8de07f1d` · 2026-11-07. No code lands in this ticket; **L-1
owns the first write** under `apps/legato/`.

Precedents studied (per the scored plan's context):
`apps/fugue/PLAN.md`, `apps/chaconne/PLAN.md`, `apps/bolero/PLAN.md`
(port sequences, fixture laws, seam rulings), `apps/ostinato/AGENTS.md`
+ `serve.mjs` / `package.json` (the house scaffold),
`playwright.{fugue,ostinato}.config.ts` (e2e config shape).

## Mini table of contents

1. [Architecture: the five layers + the seam ruling](#1-architecture)
2. [The `legato.v1` grammar](#2-the-legatov1-grammar)
3. [The ticket queue (L-1..L-13)](#3-the-ticket-queue)
4. [The edge register](#4-the-edge-register)
5. [The ops contract](#5-the-ops-contract)
6. [The test strategy](#6-the-test-strategy)
7. [The three riskiest unknowns + the spike that settles each](#7-the-three-riskiest-unknowns--the-spike-that-settles-each)
8. [Learning plan (receipted at round close)](#8-learning-plan-receipted-at-round-close)
9. [Appendix — out of scope](#appendix--out-of-scope)

## 1. Architecture

Five layers, mirroring the house split (domain under, UI on top, host
edges outside the domain) with **ONE deliberate extension seam** — and
one deliberate *omission*: no Node `runner/` edge at all.

### 1.1 The five layers

**Domain core** — `src/domain/` (DOM-free + Node-free, the Ostinato
law). The `legato.v1` clip-record grammar, declared **once** in
`src/domain/types.ts`:

```ts
export interface Clip {
  id: number            // deterministic integer (ids.ts)
  url: string
  finalUrl?: string
  title: string
  text: string          // extracted readable body (capped — L-3 law: 500 KB)
  excerpt?: string      // paywall lane: the excerpt that could be clipped
  paywallExcerptOnly?: boolean
  emptyText?: boolean   // readable text empty → title+URL fallback flag
  jsWalled?: boolean    // 403/429/empty-but-200 wall → fallback-lane flag
  tags: string[]
  state: ClipState
  highlights: Highlight[]
  createdAt: string     // ISO-8601, plain JSON at every level
  updatedAt: string
  error?: ClipError
}
```

Closed enum sets (no widening without a schema bump):

```ts
export type ClipState = "unread" | "reading" | "done" | "archived";
export type ClipError =
  | "charset-unknown"   // undecodable / unknown charset
  | "redirect-loop"     // redirect chain that cycles
  | "js-walled"         // 403/429 / empty-but-200 JS wall (FALLBACK lane)
  | "paywalled"         // clip excerpt + link, never bypass
  | "oversized"         // cap exceeded; first-N KB retained
  | "empty-text"        // readable text empty (non-walled)
  | "fetch-failed";     // network failure / fetch cap
```

Co-located in the domain: `invariants.ts` (`assertData` — unique
integer ids, `highlight.clipId` resolves, closed enum sets,
non-empty `url`/`title`), `ids.ts` (deterministic integer id
helpers), `io.ts` (canonical JSON + import gate, §2), plus the pure
logic that is testable without a UI: `search.ts` (L-4), `queue.ts`
(L-6), `tags.ts` (L-7), `highlights.ts` (L-8) and
**`boundary.test.ts` — the import-graph pin**: it scans `src/**` and
bans any import that is not a relative `./`/`../` specifier or
`bun:test`. That single file IS the network-free-closure proof and
the zero-dep law's executable form.

**Storage seam** — `src/storage/`. `StoragePort` interface over
IndexedDB (object stores `clips` / `tags` / `queue` / `highlights`,
a `schemaVersion` + migration frame), the real IDB adapter, and an
**in-memory `FakeStorage`** so the unit lane is IDB-free and
network-free. Deliberate departure from the house localStorage
pattern: clip bodies exceed localStorage quota. IDB quota-class
errors are pinned through the fake (the seam makes them
deterministic — no real IDB in the unit lane). Migration v1→v2-
with-data is an L-2 deliverable, with a named design note (the W3
retention axis).

**Clip-pipeline seam** — `src/pipeline/`, the ONE extension seam:
`Fetcher` + `Extractor` interfaces. `FakeFetcher` + canned-HTML unit
doubles live here and double **each `ClipError` taxonomy entry**;
`RealFetcher` is ~40 lines on `window.fetch` + `DOMParser` + a
readability-lite extractor, running **inside the PWA closure**.

**UI shell** — `src/ui/`. Keyboard-first list/detail (`j/k` nav,
`/` search, Ctrl+K command palette — every P0 action reachable),
theming (light + dark; the fugue accent-ink a11y trap cured from
day one — scheme-paired badge text), the Ostinato dialog contract
(`role=dialog`, `aria-modal`, attach-before-focus, Tab-trap + Esc
focus-return, the `el()` tabindex-attribute-routing law).

**PWA** — `sw.js` + `public/`: precache bucket `legato-v<N>`
(bump-on-change, the `ostinato-v<N>` / `fugue-v<N>` discipline),
offline fallback page, `scripts/verify-precache.ts` — the static
**derivation proof** that the precache list equals the app's asset
closure (the Coda C-7 precedent).

### 1.2 THE SEAM RULING — browser-side pipeline, no Node `runner/` edge

**The clip pipeline is browser-side: `RealFetcher` lives in
`src/pipeline/`, not in a Node edge dir. Legato has NO `runner/`
edge. This is the Chaconne precedent, deliberately reshaped.**

- **Why:** `window.fetch` + `DOMParser` run fine inside the PWA
  closure. The browser already has a fetch implementation and an HTML
  parser; clipping a URL needs nothing Node-shaped. The fixture
  server (`scripts/fixture-server.mjs`, port 4018) is *test
  infrastructure* that `RealFetcher` points at in e2e — it is not a
  host process the app ships with.
- **The Chaconne precedent reshaped:** Chaconne needed a `runner/`
  Node edge because a Playwright `Page` only exists in Node (its
  `runner/real-adapter.ts` imports `playwright` by walk-up
  resolution, its §4 dependency-law ruling). Legato's clip path is
  *browser-native*, so the seam collapses to interfaces inside
  `src/pipeline/`; there is no out-of-closure half to build.
- **First app in the house to need no `runner/` edge at all**
  (receipted in the learning plan, §8). Consequence
  (devils-advocate ruling): the PWA install context can't walk up to
  root `node_modules` — and it doesn't need to: the app closure is
  100% self-contained vanilla TS, which the zero-dep law makes true
  **by construction**.
- **Boundary:** `boundary.test.ts` still pins `src/**` to
  `./`/`../`/`bun:test` only. The fixture server's **dynamic routes**
  (403/429/redirect/JS-wall pages, L-3/L-10) live in `scripts/`
  (test infra) and are exercised at L-11; the **static hostile HTML**
  is committed under `fixtures/` at L-3.

### 1.3 The module tree

```
apps/legato/
  PLAN.md                       (this file)
  package.json                  (7 lines, no dep fields — zero-dep law, L-1)
  tsconfig.json                 (app-local need only, extends root — L-1)
  index.html                    (PWA shell, L-5)
  sw.js                         (precache "legato-v<N>", L-10)
  serve.mjs                     (Bun dev/test server, LEGATO_PORT=4017,
                                  /health → {ok,port}, 4016-history header, L-1)
  public/
    manifest.webmanifest        (start_url "./", scope "./", L-10)
    offline.html                (offline fallback, L-10)
    icon.svg
  fixtures/                     (committed static hostile HTML, L-3;
                                   B-16 holdout frozen here, §6.3)
  scripts/
    fixture-server.mjs         (the 4018 hostile fixture server: static +
                                 dynamic 403/429/redirect/slow routes, L-3/L-10)
    verify-precache.ts        (precache derivation proof, L-10)
  src/domain/                   (DOM-free, Node-free — the Ostinato law)
    types.ts                    (Clip, ClipState, ClipError, Highlight,
                                 LegatoData — the grammar declared ONCE)
    invariants.ts               (assertData: unique integer ids, closed enum
                                  sets, highlight.clipId resolves)
    ids.ts                      (deterministic integer id helpers)
    io.ts                       (canonical JSON: sortKeysDeep + compact
                                  separators; import gate, §2)
    search.ts                   (L-4: inverted index, CJK-bigram hybrid
                                  tokenization, snippets, rebuild-after-import)
    queue.ts                    (L-6: state machine + concurrent-flip guard)
    tags.ts                     (L-7: filter combos, tag index)
    highlights.ts               (L-8: anchor + quote ranges, no silent
                                  truncation)
    *co-located *.test.ts + boundary.test.ts (import-graph pin)
  src/storage/
    storage-port.ts            (the interface: clips/tags/queue/highlights
                                 object stores, schemaVersion + migration frame)
    idb-storage.ts            (real IDB adapter — only L-11's e2e touches it live)
    fake-storage.ts          (in-memory; quota-error pin; the unit lane)
    migration.ts             (v1→v2 frame + named design note, L-2)
  src/pipeline/
    fetcher.ts                 (Fetcher + FakeFetcher + RealFetcher)
    extractor.ts               (readability-lite + DOMParser, 500 KB cap law)
    error-taxonomy.ts          (the 7-entry ClipError map, §2)
    *co-located *.test.ts
  src/ui/
    app.ts                     (boot, every-transition persist, route-by-route)
    palette.ts                 (Ctrl+K: every P0 action reachable)
    list.ts                    (j/k nav, / search, keyboard-first)
    detail.ts                  (reader view + annotation UI)
    queue.ts                   (queue keyboard flows + empty states)
    theme.ts                   (light/dark; the fugue accent-ink trap cured)
    legato.css
    *co-located *.test.ts (DOM-guarded el-kin pins)
  test/
    goldens/                    (the 3 export goldens, L-9)
```

The L-ticket → PRD V-ticket map is 1:1: V-1→L-1, V-2→L-2,
V-3→L-3, V-4→L-4, V-5→L-5, V-6→L-6, V-7→L-7, V-8→L-8, V-9→L-9,
V-10→L-10, V-11→L-11, V-12→L-12. **L-13 (root wiring) is a separate
ticket after L-12** — the fugue F-11 precedent. No V-ticket is
orphaned.

## 2. The `legato.v1` grammar

The producer/consumer grammar is declared **once** in
`src/domain/types.ts` (§1.1); both hosts (the pipeline, the storage
seam) import it. Plain JSON at every level — no class instances, no
`Date` objects; timestamps are ISO-8601 strings.

### The full `Clip` record shape

```
{
  "schema": "legato.v1",        // top-level; import refuses any other value
  "schemaVersion": 1,           // IDB object-store schema version
                                 // (v1 → v2-with-data is L-2's frame)
  "clips": [
    {
      "id": 1,                 // deterministic integer (ids.ts)
      "url": "…",              // the URL as clipped (non-empty)
      "finalUrl": "…?",        // set when the fetch followed redirects
      "title": "…",            // non-empty (fallback: host name)
      "text": "…",            // extracted readable body (≤ cap, L-3 law)
      "excerpt": "…?",         // paywall lane: the clipable excerpt
      "paywallExcerptOnly": ?,  // true → text is excerpt-only, link preserved
      "emptyText": ?,          // true → readable text empty; title+URL fallback
      "jsWalled": ?,           // true → 403/429 / empty-but-200 wall;
                                 //   fallback lane + "open in browser" affordance
      "tags": ["a", "b"],      // canonical order, deduped
      "state": "unread",       // closed ClipState set
      "highlights": [
        { "id": 11, "clipId": 1, "anchor": "…", "quote": "…",
          "note": "…?", "createdAt": "…" }
      ],
      "createdAt": "…", "updatedAt": "…",   // ISO-8601
      "error": "…?"            // closed ClipError set, only on failed /
                                 //   degraded clips
    }
  ],
  "queue": [1, 2]              // reading order — clip ids, array order is state
}
```

### The closed enums

- **`ClipState = "unread" | "reading" | "done" | "archived"`** — the
  queue's four-state machine (L-6); transitions are a table, not
  freeform.
- **`ClipError`** — the seven-entry taxonomy, declared in
  `src/pipeline/error-taxonomy.ts` and mapped 1:1 from fetch/extract
  failures:

| Entry | Meaning (PRD edge → clip outcome) |
|---|---|
| `charset-unknown` | non-UTF-8 / undecodable charset → error clip, never mojibake text |
| `redirect-loop` | redirect chain that cycles → no infinite follow |
| `js-walled` | 403/429 / empty-but-200 JS wall → **FALLBACK lane**: title+URL + flag + "open in browser" affordance (never the default path, no bypass) |
| `paywalled` | clip the **excerpt + link, never bypass** |
| `oversized` | 500 KB extract cap (L-3 law) → retained first-N-KB prefix + flag |
| `empty-text` | readable text empty (non-walled) → title+URL fallback + flag |
| `fetch-failed` | network failure / fetch cap → error clip, never a silent hang |

### The canonical-JSON rules (`io.ts`)

The Ostinato port, Chaconne §2 law verbatim:

- **`sortKeysDeep` + compact separators** (`":"` / `","`, no
  whitespace); arrays keep **index order** — `queue` order IS the
  reading order, `clips` order is insertion order, only **object
  keys** sort.
- **Unicode-stable**: exported UTF-8, no `\u`-escape drift across
  `JSON.stringify` implementations — the 3 goldens (§6.2) pin the
  bytes, not the shape.
- **Same dataset → same bytes on every boot.**

### The import gate law

- `importGate(doc)` refuses **any `schema !== "legato.v1"`**
  (including a future `legato.v2`) with a **dry-run report** — it
  lists what would be rejected, and **the store is never touched**:
  post-refusal bytes are asserted byte-identical to pre-import.
  Never a partial import.
- A same-schema doc failing an `assertData` invariant is refused the
  same way (the report names the breached invariant).
- **Rebuild-after-import**: an import re-derives the search index
  (§4 Srch-4) and re-runs the migration-frame check against
  `schemaVersion` (§4 S-4).

`assertData` invariants: unique integer ids; `highlight.clipId`
resolves; `queue` entries resolve and are deduped; `state` in the
closed four-set; `error`, when present, in the closed seven-set;
non-empty `url`/`title`. Any breach throws `DomainInvariantError` at
every boundary.

## 3. The ticket queue

Strict build order L-1 → L-12, **plus L-13 as a SEPARATE root-wiring
ticket after L-12** (the fugue F-11 precedent: root `package.json`
`legato:*` scripts + `ci.yml` job + runbook append land as their own
ticket, never folded into L-12). Each ticket = one dispatch session;
every verifier below is a named, runnable script. Rows are exactly as
the scored plan's Steps section orders them.

| Ticket | Deliverable | Verifier (runnable) | Dependency notes |
|---|---|---|---|
| **L-1** | Scaffold: `apps/legato/{package.json (7-line zero-dep), tsconfig.json (app-local need only, extends root), index.html, serve.mjs (LEGATO_PORT=4017, `GET /health` → `{ok:true,port:4017}`, header comments the 4016/4017 history §5), src/{domain,storage,pipeline,ui}/ dirs, test harness}` + root `tsconfig.json` include `apps/legato/**/*.ts` + `src/domain/boundary.test.ts` (import-graph pin) | `cd apps/legato && bun test` + `curl -s localhost:4017/health` — **dual review (builder + reviewer): first code write** | none — first write |
| **L-2** | Storage core: `src/storage/{storage-port.ts, idb-storage.ts, fake-storage.ts, migration.ts (v1→v2 frame + named design note)}` + `LegatoData` schema v1 in `src/domain/types.ts` + invariants + co-located tests (quota-error pin via fake, interrupted-write recover, export-mid-migration pin) | `cd apps/legato && bun test` | L-1 (grammar + harness) |
| **L-3** | Clip pipeline: `src/pipeline/{fetcher.ts (Fetcher + FakeFetcher + RealFetcher: window.fetch), extractor.ts (readability-lite + DOMParser), error-taxonomy.ts}`; **js-walled → `js-walled` clip with title+URL+flag (first-class FALLBACK-lane deliverable, no bypass — product-strategist ruling)**; 500 KB cap → `oversized` with retained prefix; `fixtures/` hostile HTML (wrong-charset, redirect-target, paywall-excerpt, huge, empty-article) + **B-16 holdout frozen**; `scripts/fixture-server.mjs` skeleton | `cd apps/legato && bun test` (fixture units, FakeFetcher doubles) | L-2 (clips land in the store) |
| **L-4** | Search: `src/domain/search.ts` — inverted index over `text`, CJK char-bigram + word **hybrid** tokenization, hyphenation-aware, snippet boundaries at sentence anchors, rebuild-after-import; ranking tests incl. CJK fixture | `cd apps/legato && bun test` | L-3 (clip `text` to index); **before L-5** — search is pure, ranking/snippet/CJK units need no UI (delivery-manager ruling) |
| **L-5** | UI shell: `src/ui/{app,palette,list,detail,theme}.ts` + `legato.css`; keyboard-first (`j/k` nav, `/` search, Ctrl+K palette); **Ostinato dialog contract + `el()` tabindex-routing law from day one** (the B-12 cure — focusable rows die silently otherwise; synthesis gap-note); axe a11y pass both schemes | `cd apps/legato && bun test` (DOM-guarded pins) + manual axe | L-4 (search box), L-3 (detail renders a clip) |
| **L-6** | Queue: `src/domain/queue.ts` (state machine unread/reading/done/archived, **concurrent-flip guard**) + `src/ui/queue.ts` keyboard flows + **empty states** (never a blank) | `cd apps/legato && bun test` | L-5 (list/detail views exist) |
| **L-7** | Tags: `src/domain/tags.ts` (filter combos, tag index) + UI filter bar | `cd apps/legato && bun test` | L-5/L-6 (filter bar renders) |
| **L-8** | Highlights: `src/domain/highlights.ts` (anchor + quote ranges, **no silent truncation**) + reader annotation UI | `cd apps/legato && bun test` | L-5 (reader detail view) |
| **L-9** | io: byte-stable export bundle round-trip + Markdown export; **3 goldens under `test/goldens/`** (empty store; populated store with unicode + CJK + highlights; migrated v1 store); foreign/future-schema dry-run refusal, **store byte-identical** | `cd apps/legato && bun test` (golden pins) | **L-2..L-8 complete** (byte-stable export needs the full dataset shape) |
| **L-10** | PWA offline: `sw.js` (`legato-v1` precache), `public/{manifest.webmanifest, offline.html}`, offline-boot e2e spec `e2e/legato-offline.spec.ts` + **`playwright.legato.config.ts` (repo root: LEGATO_E2E marker, baseURL 4017, fixture server 4018 as 2nd webServer)** + `scripts/verify-precache.ts` | `bunx playwright test -c playwright.legato.config.ts --grep offline` + `bun apps/legato/scripts/verify-precache.ts` | L-9 (byte-stable export before the offline shell); L-3's fixture server |
| **L-11** | e2e battery: `e2e/legato-{flow,hostile-clip,a11y,cross-browser-smoke}.spec.ts` — **≥12 specs total**; hostile-clip spec drives the 4018 fixture server (redirect-chain, 403/429, charset, huge, empty + the **timeout-masking pin**); keyboard flow zero-pointer; cross-browser smoke = **flagged Chromium-first condition only** | `LEGATO_E2E=1 bunx playwright test -c playwright.legato.config.ts` (local marker; root wiring stays separate) | L-10 (config + offline spec exist); **the B-16 holdout re-run happens HERE** (regression = red gate, §6) |
| **L-12** | Docs + landing + closeout: `docs/legato.md` (chaconne-doc shape), landing band + stills capture lane (port 4018), README section, CHANGELOG, round memory/skill harvest | `bun run check:docs` + `bun run check:changelog` | L-11 (battery green before docs claim it) |
| **L-13** | **SEPARATE root-wiring ticket (fugue F-11 precedent), AFTER L-12:** root `package.json` `legato:dev` / `legato:test` / `legato:e2e` scripts + `.github/workflows/ci.yml` legato job (frozen-lockfile, zero-dep hash assert, Lane A/B, e2e self-skip lane, check:docs/check:changelog gates) + runbook append | `bun run legato:test` + `bun run legato:e2e` + `bun run typecheck` on a clean tree | **after L-12** — the CI gate lands on a green tree; **no ticket before L-13 touches root `package.json` or `ci.yml`** |

**Ordering rationale** (delivery-manager rulings, verbatim from the
scored plan): L-4 before L-5 (search is pure over clip `text`); L-9
before L-10 (byte-stable export needs L-2..L-8 complete); L-10 owns
the offline SW + the offline e2e SPEC, L-11 owns the rest of the
battery (keyboard flow, hostile-clip, a11y, cross-browser smoke); no
hidden cross-dependencies; 12 × one session is realistic (each ≤ the
Ostinato C-ticket size).

## 4. The edge register

Every edge case from the PRD's "Edge cases the PRD names up front"
list is mapped to a named ticket + verifier — **none orphaned**. The
"Verifier" column names the runnable lane that pins it.

### 4.1 Clipping — the taxonomy rows (T-1..T-7)

| ID | Edge case | Ticket | Verifier |
|---|---|---|---|
| T-1 | **charset-unknown** — non-UTF-8 page, undecodable/unknown charset → `ClipError "charset-unknown"`, never mojibake text | L-3 | `cd apps/legato && bun test` (FakeFetcher + `fixtures/` wrong-charset HTML) + L-11 hostile-clip e2e |
| T-2 | **redirect-loop** — redirect chain that cycles → `redirect-loop`, no infinite follow | L-3 | unit pin (FakeFetcher canned loop) + L-11 e2e (4018 dynamic redirect route) |
| T-3 | **js-walled** — 403/429 / JS-wall page → `js-walled` clip storing title+URL with the flag + "open in browser" affordance (the PRD's FALLBACK lane, **not the default path**; product-strategist ruling, folded into L-3 as first-class) | L-3 | unit pin (canned 403/429/empty-but-200 doubles) + L-11 e2e against 4018 dynamic 403/429 routes |
| T-4 | **paywalled** — paywalled content → clip the **excerpt + link, never bypass** | L-3 | unit pin (paywall-excerpt fixture → `excerpt` + `paywallExcerptOnly`) + L-11 e2e |
| T-5 | **oversized** — gigantic page → 500 KB extract cap, `oversized` flag with first-N KB retained (solution-architect ruling) | L-3 | unit pin (huge fixture: cap + retained-prefix assert) + L-11 e2e |
| T-6 | **empty-text** — readable text empty (non-walled) → fall back to title+URL with the `emptyText` flag | L-3 | unit pin (empty-article fixture) + L-11 e2e |
| T-7 | **fetch-failed** — network failure / app-side fetch cap → `fetch-failed`, never a silent hang | L-3 | unit pin (FakeFetcher reject) + L-11 e2e: fixture slow-route + app-side fetch cap — **the timeout-masking pin** (the qa-architect's named hardest e2e) |

### 4.2 Storage rows (S-1..S-4)

| ID | Edge case | Ticket | Verifier |
|---|---|---|---|
| S-1 | **migration v1→v2 with data** — schema bump while clips exist; migration frame + named design note (W3 retention axis) | L-2 | `cd apps/legato && bun test` (FakeStorage: pre-migration dataset → migrate → invariants hold) + L-9 3rd golden (migrated v1 store) |
| S-2 | **IDB quota error** — quota-class error mid-write, deterministic, never a silent loss | L-2 | unit pin: `FakeStorage` throwing a quota-class error (the seam makes it deterministic — no real IDB in the unit lane) |
| S-3 | **interrupted writes** — temp-key + commit-swap (the Ostinato atomic-write pattern); `recover()` discards orphans, never a torn store | L-2 | unit pin (orphaned-temp recover) + L-11 e2e (the real-IDB lane is the only one that touches real IDB) |
| S-4 | **export mid-migration** — export during an in-flight migration is well-defined (the pre-migration `legato.v1` document), never a torn mixed-version byte stream; store byte-identical | L-2 (+L-9) | L-9 golden pin: export during migration → bytes equal the pre-migration golden |

### 4.3 Search rows (Srch-1..Srch-4)

| ID | Edge case | Ticket | Verifier |
|---|---|---|---|
| Srch-1 | **CJK bigram** — CJK text: char-bigram + word **hybrid** tokenization (no naive word splitting) | L-4 | `cd apps/legato && bun test` (CJK fixture ranking test) |
| Srch-2 | **hyphenation** — `well-known` / `well known` (and line-wrap hyphens) match without false misses | L-4 | unit pin (hyphenation-aware tokenizer) |
| Srch-3 | **snippet boundaries** — snippets break at sentence anchors, never mid-word | L-4 | unit pin (snippet-extraction assertions) |
| Srch-4 | **index rebuild after import** — an import re-derives the index; no stale-index merge | L-4 (+L-9) | unit pin: import → index equals a fresh build over the same dataset |

### 4.4 Queue rows (Q-1..Q-3)

| ID | Edge case | Ticket | Verifier |
|---|---|---|---|
| Q-1 | **concurrent state flips** — two tabs / re-entrant update racing a state flip → the concurrent-flip guard keeps transitions legal (last-write-wins by `updatedAt`, no illegal transition) | L-6 | `cd apps/legato && bun test` (flip-guard unit pin) |
| Q-2 | **keyboard focus traps** — the Ostinato dialog contract re-pinned (Tab-trap, Esc focus-return, `el()` tabindex-routing law landed in L-5) | L-6 (+L-5) | L-11 a11y e2e (axe `wcag2a`+`wcag2aa` both schemes + tab-order + Esc focus-return pins) |
| Q-3 | **empty states** — no clips / empty queue / no search results → honest panels, never a blank | L-6 | `cd apps/legato && bun test` (DOM-guarded pins) + L-11 flow e2e |

**Orphan-check gate (L-12 closeout):** every register row resolves to
a landed ticket's verifier; no row may point at a ticket that did not
land.

## 5. The ops contract

### 5.1 Port allocation (the scout's repo-wide sweep; 4017/4018 free)

| Port | Owner |
|---|---|
| 4012 | Coda (`CODA_PORT`, `apps/coda/serve.mjs`) |
| 4013 | Ostinato (`OSTINATO_PORT`, `apps/ostinato/serve.mjs`) |
| 4014 | Chaconne (`CHACONNE_PORT`, `apps/chaconne/serve.mjs`) |
| 4015 | Fugue app lane (`FUGUE_PORT`, `apps/fugue/serve.mjs`) |
| 4016 | Fugue **capture-usage** lane (devils-advocate ruling, F-11 runbook) |
| 4050 | Bolero API (`BOLERO_PORT`, `apps/bolero/serve.mjs`) |
| 4051 | Bolero static (`BOLERO_STATIC_PORT`) |
| **4017** | **Legato app lane — `LEGATO_PORT`** |
| **4018** | **Legato fixture/capture lane — `LEGATO_FIXTURE_PORT`** |

- **4017 is unclaimed — the incident receipt is a scar, not a
  reservation.** The 2026-10-17 4017 incident receipt confirms 4017
  was the colliding party in that historical episode, never a
  permanent claim; no `serve.mjs` in the repo defaults to 4017 today
  (4016 = fugue-capture, 4050/4051 = bolero). The product-strategist's
  "collision" refutation stands on this evidence; **ruling:
  `LEGATO_PORT=4017`, fixture/capture lane = 4018** per the task brief.
- **The 4016-history comment law (devils-advocate ruling):** L-1's
  `serve.mjs` **header comments the 4016/4017 history** — what 4016
  is (the fugue-capture lane), why 4017 was refused once (the
  incident), why it is free now — so the next reader knows the scar
  is documented, not accidental.

### 5.2 Serve + health + fixture server

- `serve.mjs` (Bun dev/test server) listens on **4017**
  (`LEGATO_PORT`, default in code, env-overridable — the house
  pattern).
- **`GET /health` → `{ "ok": true, "port": 4017 }`** — the cheap
  liveness probe the e2e `webServer` entries assert before launching
  specs (fugue/ostinato shape verbatim).
- `scripts/fixture-server.mjs` listens on **4018**
  (`LEGATO_FIXTURE_PORT`): static hostile pages from `fixtures/` +
  the dynamic 403/429/redirect/slow routes (§6.3). Test
  infrastructure only — **not a host edge the app ships with** (§1.2).
- **Port-drift mitigation (scored plan, risk #3):** both port pins
  live in `playwright.legato.config.ts`'s webServer entries + the
  serve.mjs / fixture-server.mjs headers — one file per port, no
  scattered literals.

### 5.3 The test lanes

- **Lane A (enforcement):** `cd apps/legato && bun test` — the
  app-dir has **no** bunfig → the DOM-free runtime IS the
  enforcement lane (the Ostinato/Chaconne law).
- **Lane B (compatibility):** `bun test apps/legato` from the root —
  the root `bunfig.toml` happy-dom preload masks it as the
  compatibility form.
- **Root-battery integration law:** only `apps/legato/src/**` joins
  the root battery; `scripts/` (fixture server — Node test infra) and
  `e2e/` stay out, exactly as Chaconne's runner lane is excluded.
- **e2e:** `bunx playwright test -c playwright.legato.config.ts`
  (repo-root config, L-10; §6.4).

### 5.4 The zero-dep law

`apps/legato/package.json` is the **7-line house law: no dep
fields** — no `dependencies`, no `devDependencies`. The app closure
is 100% self-contained vanilla TS (devils-advocate ruling: the PWA
install context can't walk up to root `node_modules`; the zero-dep
law makes it safe by construction). Playwright touches **only**
`e2e/` (a repo-root lane) and never the app; the fixture server is
plain-Bun test infra.

### 5.5 No root wiring until L-13

Until L-13 lands: root `package.json` carries **no** `legato:*`
scripts, `.github/workflows/ci.yml` carries **no** legato job.
L-1..L-12 verify with the app-local + repo-root commands above (e2e
via `bunx playwright test -c playwright.legato.config.ts` directly,
`LEGATO_E2E=1` armed in the config's module scope — the
Coda `CODA_E2E` / Ostinato `OSTINATO_E2E` / Fugue `FUGUE_E2E`
self-skip-marker precedent). L-13 (the fugue F-11 precedent) then
adds `legato:dev` / `legato:test` / `legato:e2e`, the ci.yml job,
and the runbook append — on a green tree, last of all.

## 6. The test strategy

### 6.1 Unit lanes — on the in-memory fakes

The unit lane (`cd apps/legato && bun test`) runs entirely on
**fakes**: `FakeStorage` (in-memory, IDB-free, network-free) and
`FakeFetcher` (canned-HTML doubles for **each `ClipError` taxonomy
entry**). IDB quota-class errors are pinned by making the fake
*throw* a quota-class error — the seam makes it deterministic, and
**no real IDB ever appears in the unit lane**. Real IDB is touched
by exactly one lane: the L-11 Chromium e2e battery. Real network is
touched by no lane — the fixture server (4018) stands in for the
hostile web.

### 6.2 The 3 export goldens (`test/goldens/`, L-9)

1. **Empty store** — a `legato.v1` doc with zero clips; the byte
   floor of the canonical form.
2. **Populated store** — clips with **unicode + CJK** text, tags,
   and highlights; the UTF-8 byte-stability pin (no `\u`-escape
   drift across `JSON.stringify` implementations).
3. **Migrated v1 store** — the L-2 migration frame applied to real
   data; proves migration preserves meaning (S-1's byte-level half,
   S-4's mid-migration export half).

Goldens are **pinned, not re-derived** (the Chaconne §5 edge-9
law): the golden file is committed; a test recomputes the canonical
bytes and asserts equality.

### 6.3 The `fixtures/` inventory + the 4018 fixture server

**Static hostile pages** (committed under `fixtures/`, L-3):

| Fixture | Purpose | Taxonomy row |
|---|---|---|
| `wrong-charset.html` | non-UTF-8 bytes, undecodable charset | T-1 |
| `paywall-excerpt.html` | paywall marker + clipable excerpt only | T-4 |
| `huge.html` | >500 KB body | T-5 |
| `empty-article.html` | body present, zero readable text | T-6 / T-3 |

**Dynamic (JS) routes** on the **4018 fixture server**
(`scripts/fixture-server.mjs`) — the same server, JS routes:

| Route | Behavior | Taxonomy row |
|---|---|---|
| `/redirect` (chain) | multi-hop redirect chain ending in a loop detector | T-2 |
| `/403`, `/429` | status codes served trivially; **JS-wall detection asserted against a body that is empty-but-200** (the qa-architect fixture form) | T-3 |
| `/slow` | deferred response, paired with the app-side fetch cap — the **timeout-masking route** (T-7) | T-7 |

Fixtures are static, zero-JS-dependency (inline `<script>` timers
only, no network, no CDNs), and the static set serves both the
unit lane (via `FakeFetcher`) and the e2e lane (via `RealFetcher`
against 4018).

### The B-16 holdout freeze + re-run law

The frozen hostile-fixture holdout (`benchmarks/vivace-round/` B-16
anchor) is **frozen at L-3** and **re-run at L-11** — any
extraction regression is a **red gate, never a silent quality dip**
(scored plan, risk #1). Extraction over-fitting the fixtures is the
named risk; the holdout is the counterweight. Delta receipts land in
`benchmarks/vivace-round/`.

### 6.4 The e2e battery (L-10 + L-11)

- **≥12 specs total** across the lane (the Ostinato bar),
  **Chromium-first** (`devices["Desktop Chrome"]` — the PRD's
  platform-scope statement; cross-browser is a smoke, not a
  battery):
  - `legato-offline.spec.ts` (L-10) — PWA offline boot: precached
    shell, offline fallback, zero network.
  - `legato-flow.spec.ts` (L-11) — keyboard-only, **zero-pointer**:
    clip → read → tag → highlight → export.
  - `legato-hostile-clip.spec.ts` (L-11) — drives the 4018 fixture
    server (T-1..T-7 rows + the timeout-masking pin) and re-runs the
    **B-16 holdout**.
  - `legato-a11y.spec.ts` (L-11) — axe `wcag2a` + `wcag2aa`,
    **light and dark schemes**, tab-order, Esc focus-return (the
    fugue F-9 precedent).
  - `legato-cross-browser-smoke.spec.ts` (L-11) — a **flagged
    condition**: run under a second engine **if the lane allows**;
    the gap stays a named `[U]` otherwise (PRD non-goal #3).
- **`playwright.legato.config.ts`** (repo root, L-10):
  `testDir: "e2e"`, `testMatch: /legato-.*\.spec\.ts/`; module-scope
  `process.env.LEGATO_E2E = "1"` arms the self-skip marker;
  **two webServers** (the scored plan's dual-server form):
  `bun apps/legato/serve.mjs` (`env: { LEGATO_PORT: "4017" }`) +
  `bun apps/legato/scripts/fixture-server.mjs`
  (`env: { LEGATO_FIXTURE_PORT: "4018" }`); `baseURL:
  "http://127.0.0.1:4017"`; `outputDir:
  "download/test-results-legato"` (gitignored scratch);
  `reuseExistingServer: !process.env.CI`, `timeout: 60_000`
  (Ostinato values verbatim).

### 6.5 The verification block (from the scored plan)

```
cd apps/legato && bun test                      # Lanes A+B: unit (all lanes L-2..L-9)
bun run typecheck                                # root tsconfig include covers apps/legato/**
curl -s http://127.0.0.1:4017/health            # {ok:true,port:4017}
LEGATO_E2E=1 bunx playwright test -c playwright.legato.config.ts   # ≥12 specs, Chromium
bun apps/legato/scripts/verify-precache.ts       # N URLs, 0 missing — PASS
```

Orphan-check gate at L-12: every edge-register row (§4) resolves to a
landed ticket's verifier; the B-16 holdout re-run is green.

## Appendix A — Out of scope

The PRD's non-goals (P0) — no L-ticket touches them:

- **No server, no accounts, no sync service** — offline-first local
  only.
- **No full browser engine embedding** — clipping is fetch +
  extraction with the browser tool as the **FALLBACK lane** for
  JS-walled pages (T-3), not the default path.
- **No Firefox/WebKit full parity** — the honest Chromium-first
  scope of the prior app rounds, with a cross-browser smoke **if the
  lane allows** (§6.4 flagged condition); the gap stays a named
  `[U]` otherwise.
- **No AI features in the app itself** — the agent builds it; the
  app is deterministic.

**P1 backlog (post-freeze, out of L-1..L-13):** browser-extension
quick capture, reading-time estimates, per-tag digests, sync via
file (WebDAV), Firefox/WebKit full batteries.

**Ticket scope (L-0):** this file is the **only write** L-0 makes
under `apps/legato/` — no `package.json`, no `serve.mjs`, no
`src/**`, no `fixtures/`, no `playwright.legato.config.ts`, no
`sw.js`, no root `package.json` or `ci.yml` change (that is L-13).
All of it is L-1..L-13's.

## Appendix B — The three riskiest unknowns + the spike that settles each

*(From the scored plan's Risks section.)*

1. **Readability-lite quality drift (extraction over-fits the
   fixtures).**
   *Spike/mitigation:* the B-16 holdout is frozen at L-3 and
   re-run at L-11 — any regression is a red gate, never a silent
   quality dip. The fixtures are the law; the holdout is the
   counterweight.
2. **IDB schema-migration loss under real quota pressure (the fake
   can't reproduce it).**
   *Spike/mitigation:* L-2's migration design note **names the
   honest limitation** (the W3 retention axis: v1→v2-with-data
   under quota pressure is the one lane the fake cannot fake); the
   L-11 e2e runs migrations on **real Chromium IDB** — the only
   lane that touches real IDB — and a quota-class error there is a
   receipted `[U]`, not a pass.
3. **Port drift between the app (4017) and the fixture server
   (4018).**
   *Spike/mitigation:* both port pins live in
   `playwright.legato.config.ts`'s webServer entries + the
   serve.mjs / fixture-server.mjs headers — **one file per port, no
   scattered literals** (§5.2 port-drift mitigation).

## Appendix C — The learning plan

*(From the scored plan's Learning plan; receipted at round close.)*

- **memory (pin at closeout):** 4017/4018 port allocation; the
  **Fetcher/Extractor seam ruling** (browser-side, no Node
  `runner/` edge — the first app in the house to need none); the
  IDB-vs-localStorage departure rationale (clip bodies exceed
  localStorage quota); the js-walled fallback-lane semantics
  (fallback, not default; no bypass).
- **benchmark:** the L-11 hostile-clip battery (fixture server +
  dynamic 403/429/redirect routes) is the **W2 live-web-axis
  receipt**; the B-16 holdout delta receipts feed
  `benchmarks/vivace-round/`.
- **skills (mint candidates, each exercised ≥1× with receipts before
  minting — the PRD W4 rule):**
  - `hostile-fixture-server-setup` (the 4018 dual static/dynamic
    server, §6.3).
  - `hostile-clip e2e authoring` (the L-11 hostile-clip spec
    driving the taxonomy rows T-1..T-7).
  - `byte-stable-export golden pinning` (the 3-golden L-9 lane,
    §6.2).
