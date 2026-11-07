# B-16 Holdout — Freeze Manifest (Legato L-3)

**Freeze date:** 2026-11-07
**Ticket:** L-3 (the keystone ticket — the hostile-page surface)
**Round:** Serenade (Vivace PRD)
**Re-run:** L-11 (regression = red gate, never a silent quality dip)

---

## B-16 Task Definition

**Precondition:** the fixture server (`scripts/fixture-server.mjs`) is
running on port 4018 (`LEGATO_FIXTURE_PORT` default, 127.0.0.1), and
`/health` answers `{ok: true, port: 4018}`.

**Task:** clip the following URL set, using the `RealFetcher` +
`RealParser` pipeline (the L-11 e2e lane drives `RealFetcher`
against the live 4018 server — the unit lane drives `FakeFetcher`
canned doubles against the static fixture files):

| URL | Taxonomy row | Expected `ClipError` |
|-----|-------------|----------------------|
| `http://127.0.0.1:4018/walled-403` | T-3 | `js-walled` |
| `http://127.0.0.1:4018/walled-429` | T-3 | `js-walled` |
| `http://127.0.0.1:4018/redirect-loop` | T-2 | `redirect-loop` |
| `http://127.0.0.1:4018/redirect-chain` | clean (3-hop → clean) | — |
| `http://127.0.0.1:4018/fixtures/wrong-charset.html` | T-1 | `charset-unknown` |
| `http://127.0.0.1:4018/fixtures/paywall-excerpt.html` | T-4 | `paywalled` |
| `http://127.0.0.1:4018/fixtures/huge.html` | T-5 | `oversized` |
| `http://127.0.0.1:4018/fixtures/empty-article.html` | T-6 | `empty-text` |
| `http://127.0.0.1:4018/fixtures/clean.html` | clean | — |
| `http://127.0.0.1:4018/slow` | T-7 (paired with a short cap) | `fetch-failed` |

**Success bar:**
- every clip record is a full `Clip` (id, url, title, text, state,
  `createdAt`, `updatedAt`, `highlights: []`, `tags: []`) — no
  `null`/`undefined`, no silent failure.
- the taxonomy lane is correct for every row (the `error` field
  matches the expected `ClipError`).
- the degraded fields are honest per PLAN §4.1:
  - `js-walled` clips have `jsWalled: true`, a non-empty `title`,
    and `text: ""`.
  - `paywalled` clips have `paywallExcerptOnly: true`, a non-empty
    `excerpt`, and `text` = the excerpt.
  - `oversized` clips have `text` length ≤ 500 000 chars
    (the cap is 500 000 bytes ≈ 500 000 chars for ASCII) and the
    prefix is the first N characters of the full extraction.
  - `empty-text` clips have `emptyText: true` and `text: ""`.
  - `redirect-loop` clips have `error: "redirect-loop"` and
    `text: ""`.
  - `charset-unknown` clips have `error: "charset-unknown"` and
    `text: ""` (never mojibake).

---

## Fixture File List + SHA-256

These are the frozen static fixtures. The hashes are computed
against the committed bytes; any change to a fixture file after
freeze is a regression (red gate).

| File | SHA-256 |
|------|---------|
| `clean.html` | `f4794d955b0dd0e445435a06c0517f9318fa0db846167850c26e254b3722f6b7` |
| `wrong-charset.html` | `057f9c7f91c594e4ab5d87abdf34b1a7423acacf2cc86ef859a2225735c359a6` |
| `paywall-excerpt.html` | `b6ec767aa8f392058a4f9dd31819381683e13f3062f1f38958d8ba3dfe0ff181` |
| `huge.html` | `10b52aab80cd26a9162235bbe1448ec667248b53209783f82b0977505bf35f73` |
| `empty-article.html` | `a75cf4b5c2496447f041d796893cf1ece809680f74ac4879d22110ba53191faf` |

**Dynamic routes** (served by `scripts/fixture-server.mjs`, not
committed files — the B-16 task exercises them live):
`/redirect-chain`, `/redirect-loop`, `/walled-403`, `/walled-429`,
`/slow`, `/health`.

---

## The Law

1. **Never edited after freeze.** A fixture file's SHA-256 changing
   between L-3 freeze and L-11 re-run is a red gate. The only
   legitimate change is a receipted operator decision (logged in
   the round's session notes).
2. **Re-run at L-11.** The B-16 holdout re-runs as part of the
   L-11 hostile-clip e2e spec (`legato-hostile-clip.spec.ts`).
   Any extraction regression against the frozen fixtures is a
   red gate, not a silent quality dip.
3. **Static fixtures are byte-honest.** No placeholders: every
   file is a real HTML document with the taxonomy signal encoded
   in its bytes (windows-1252 encoding, the paywall marker
   attribute, the 500 KB+ body, the empty article). The
   dynamic routes add the status-code + timing signals.
4. **The fixture server is test infrastructure.** It runs on 4018,
   is NOT a host edge the app ships with, and is started/stopped
   by the L-11 e2e spec (or manually via `bun apps/legato/scripts/
   fixture-server.mjs` + `curl http://127.0.0.1:4018/health`).

---

## Verification at L-3 (this ticket)

```
# Static fixtures exist and are non-empty:
ls apps/legato/fixtures/*.html
# SHA-256 match (run from apps/legato/fixtures/):
sha256sum clean.html wrong-charset.html paywall-excerpt.html huge.html empty-article.html

# Fixture server boots:
bun apps/legato/scripts/fixture-server.mjs &
FX_PID=$!
sleep 1
curl -s http://127.0.0.1:4018/health
curl -s http://127.0.0.1:4018/fixtures/clean.html | head -3
kill $FX_PID
```
