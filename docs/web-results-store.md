# The web results store — design record

**Status**: shipped (2026-10-20) · perf layer added same day (receipts: [`benchmarks/webcache/`](../benchmarks/webcache/RESULTS.md)) · **Modules**: [`webcache.ts`](../pi-repo/packages/self-learning/src/webcache.ts) · [`websearch.ts`](../pi-repo/packages/self-learning/src/websearch.ts) · **Docs**: [usage](usage.md#web-search--webfetch) · [configuration](configuration.md#terminal-agent-unown-cli)

This is the decision record for the persistent, shared cache behind `web_search`, `webfetch` and `fetch_url`. It captures what was built, why each load-bearing choice is what it is, what was rejected and on what evidence, and the failure modes the design bends around. The behavior contract (TTLs, revalidation, stale-if-error, provenance markers, env knobs) lives in the [usage](usage.md#web-search--webfetch) and [configuration](configuration.md#terminal-agent-unown-cli) pages; this page is the *why*.

## The problem

Every unown surface that touches the web is its own process — terminal sessions, parallel subagents, engine sandbox runs, scheduled automations. Until this feature each had at most a process-local 10-minute fetch memory (a `Map` in `websearch.ts`) and nothing at all for searches. In practice that meant:

- **Repeated searches re-burned quota.** A model that re-issues a query (retry loops, four subagents researching the same topic, tomorrow's automation re-running the morning brief) paid the provider chain again — Tavily/Brave/Serper credits on the keyed side, per-IP rate limits (StackExchange 300/day, You.com 100/day) on the keyless side. Claude Code users file quota-exhaustion issues against exactly this (anthropics/claude-code#91723).
- **Repeated fetches re-paid latency for unchanged pages.** Documentation, changelogs, registry pages and release notes are the agent's most-fetched class of URL and its most stable — a full GET for bytes that did not change.
- **Outages were total.** Provider down, network down, quota gone → the tool errored with nothing to show, even when the same query had been answered correctly an hour ago.

## What was built

One user-scoped, on-disk store at `~/.unown/cache/web/` (content-addressed entries + an append-only events feed), shared by every unown process on the machine, answering all three web tools through one policy layer:

| Layer | Decision | Why |
|---|---|---|
| Keying | **Exact-key only**: sha256 over canonicalized key material (normalized query + maxResults + domain filters for searches; normalized URL for fetches) | The repo's own H20 benchmark (`benchmarks/complementary/`) **refuted** near-duplicate semantic serving: outcome-flipping edits embed at cosine 0.95–0.974, overlapping the embedder's own rerun self-similarity — no safe similarity threshold exists on Unown's call shapes. GPTCache's layered vector tier was skipped for the same reason. |
| Entry storage | Content-addressed immutable files on the npm/cacache model: `entries/<xx>/<sha256>.json`, atomic writes (pid-tagged temp + rename), sha256-verified reads, corrupt/unknown-schema self-heal | Reads never lock; concurrent identical writes are idempotent; a torn write can never be served; no native modules, no platform branches (the websearch module's portability contract, preserved). SQLite was considered and rejected: WAL + native-module questions for zero benefit at this scale. Cache writes are tmp+rename **without fsync** — the cacache write model: a cache entry is re-fetchable, so process-crash safety is the right durability point, and a power-loss-torn entry is caught by the payload checksum and re-fetched (self-heal). `UNOWN_WEB_CACHE_DURABLE=1` restores the double-fsync for slow-to-trust filesystems. LevelDB's own db_bench measures fsync-per-write at ~150× a buffered write (fillseq 1.7 µs vs fillsync 268 µs) and npm's history carries 3–8× install regressions from fsync-heavy phases on Docker/network mounts — a cache should not pay that. |
| Freshness ("not too old") | TTL windows — search 60 min; fetch honors origin `Cache-Control`/`Expires` (heuristic 30 min, capped 24 h) | Claude Code ships a fixed 15-min WebFetch TTL — the precedent that fixed TTLs are acceptable UX. We cap origin directives at 24 h so a misbehaving origin cannot pin content forever, and honor `no-store`/`no-cache` literally (never stored). `max-age=0` and TTL knobs at `0` mean "never fresh, always revalidate" — those entries ARE stored, because revalidation needs the body. |
| Validation ("no version change") | RFC 9111 revalidation on the direct-fetch path: capture `ETag`/`Last-Modified`, replay stale entries as conditional GETs; a 304 re-serves the stored body and refreshes the clock | This is npm's own architecture (`make-fetch-happen` + `http-cache-semantics` + `cacache`). A 304 costs one round-trip and no body — and on GitHub's API, conditional requests that return 304 do not count against the rate limit. Verified live against real origins (bun.sh revalidates over a genuine ETag round-trip). Search APIs mostly do not emit validators, so the search side is TTL-only — documented rather than papered over. |
| Resilience | Stale-if-error (RFC 5861 spirit): when every upstream attempt fails, the last good answer serves within a bounded window (24 h search / 7 d fetch), always flagged `STALE` in the tool result. **Stale-while-revalidate** (RFC 5861 proper): a stale-but-windowed answer serves *instantly* — marked `· stale — refreshing in background` — while a detached, single-flighted background refresh restores freshness for the next caller | SWR is the missing half of the 5861 pair nginx ships as `proxy_cache_use_stale updating` and Varnish as grace mode: the agent asking again at minute 61 gets the marked stale answer in microseconds instead of re-paying the provider, and the *next* ask is fresh. The background refresh rides the same single-flight machinery (its own key — joining the foreground key would return the stale serve and refresh nothing), never throws into the serve path, and is bounded by `UNOWN_WEB_CACHE_SWR_MS` (default: the entry's own stale window; `UNOWN_WEB_CACHE_SWR=0` restores fully blocking semantics). Fetches WITH validators keep their exact blocking 304 path and its error fall-through — one cheap conditional GET is worth blocking on when the answer is byte-identical. |
| Concurrency | In-process single-flight (a pending-promise map); cross-process races are benign (identical immutable writes) | Four parallel subagents searching the same thing should cost one provider call. Cross-process coalescing would need locks the design deliberately avoids. |
| Reuse across caps | Bodies are stored at the 200k ceiling (the `max_chars` clamp max) and sliced per-request at render time | One entry serves every `max_chars` value; a tighter cap is a render-time slice, not a new entry. (The old in-memory cache keyed by URL only and silently served stale truncations — fixed by construction here.) |
| Eviction | Byte cap (256 MiB default), LRU by **RAM recency** — the in-memory index's `lastUsed`, seeded from file mtime at rebuild; no per-hit disk writes at all | npm/cacache's shape, upgraded to the Chromium SimpleCache rule (`UseIfExists` updates recency in memory, never on disk): the old per-hit `utimes` metadata write is the same write-amplification the Linux kernel engineered `lazytime`/`relatime` to avoid, and timestamp-derived LRU is hopeless to read back on NTFS (1 h access-time delay) or FAT (1-day resolution). A restart degrades LRU to write-order — benign for a TTL-bounded cache. |
| Observability | Append-only `events.jsonl` (kind/tool/provider/age per event, rotated at 10k lines); stats derived from the newest ≤500 events via a bounded 128 KiB tail read — no stats file to race on | Every hit/miss/revalidate/stale/evict is visible in `unown webcache stats`, the doctor line, and the TUI dashboard's Web Cache screen. Cross-process stat counters would race; deriving from the feed cannot. |
| Privacy | User-scoped `0700` store, shared across projects **by design** (the public web is not project-specific); query text appears in the events feed (the same machine, the same user — receipts already record more), but **never** in doctor's `--json` support-bundle subset | Multi-user machines are separated by `$HOME` per user, which is where the store lives. |

## Prior art (what was adopted, borrowed, rejected)

- **npm / cacache / make-fetch-happen** — adopted the architecture whole (content-addressed blobs + integrity verification + RFC 9111 policy + retries). The most battle-tested cache that ships in a CLI today.
- **Claude Code** — borrowed the fixed-TTL-is-acceptable UX (15 min WebFetch default) and improved on it: TTL + validators instead of TTL-only.
- **LangChain** — borrowed "key = hash of the canonicalized request" exactly; skipped the framework.
- **GPTCache** — rejected as a dependency (maintenance limbo since 2024) and rejected its vector-similarity tier on H20's evidence.
- **http-cache-semantics** — adopted the RFC semantics, implemented the needed subset in ~40 lines rather than taking the dependency (the store keeps zero new deps; the vendored-pi portability contract stays intact).
- **SearXNG / Perplexica** — not precedents: multi-user metasearch projects deliberately avoid caching queries for privacy; a single-user CLI inverts that tradeoff.

## Failure modes the design bends around

- **Stale answers mislead the agent** → every served-from-store answer carries provenance the model can read; stale-if-error is window-bounded and flagged in caps; the kill switch is one env var.
- **Store poisoning via corrupted entries** → sha256 verification on every read; corrupt or unknown-schema entries self-heal to a miss and log an `error` event.
- **Engine sandboxes cannot see `$HOME`** (bubblewrap private `/home`) → every store op fails open to a bypass; a cache failure can never fail a web call.
- **Live verification must not read the store** → `noCache` bypasses both directions (no read, no write); `scripts/websearch-live.mjs` passes it so the provider matrix measures providers, not the disk.
- **Clock semantics** → TTL windows are wall-clock on the same machine (`storedAt` vs `Date.now()`); policies are baked into entries at store time so later knob changes never retroactively resurrect or kill an entry.
- **The `Number("") === 0` trap** → the env parser treats empty string as *unset* before converting (the trap the repo's `||` convention exists to prevent — the regression is pinned by a named test).

## The performance layer (added after benchmarking, receipts included)

The store was benchmarked end to end (`scripts/webcache-bench.mjs`, receipts
under [`benchmarks/webcache/`](../benchmarks/webcache/RESULTS.md)) and the
baseline exposed two real costs plus one cheap read path, each of which the
perf layer then addressed on named prior art:

| Cost measured at baseline | The fix (and its precedent) | After (same box, same cells) |
|---|---|---|
| `webCacheStats` — a full-directory `readdir`+`stat` scan per call, event-loop-blocking, **49.9 ms p50 at 20k entries**, and the then-current dashboard client polled it every 8 s (the retired web dashboard; the TUI dashboard polls active-screen resources every 4 s — same argument, tighter) | **In-memory index** `{key → bytes, lastUsed}` answering stats/sweep from RAM, rebuilt on first use / root switch / every `UNOWN_WEB_CACHE_INDEX_MS` (default 60 s); counts are cross-process approximate and *labeled* as such (`stats.index: {mode, ageMs, approximate}` — the CLI prints "approx", the TUI Web Cache screen prints an `approximate — entry/byte counts are a snapshot` line) | **0.003 ms p50** between rebuilds; the poll-loop over 5k entries went 311.9 ms → 12.9 ms total (12.74 ms = the one rebuild) |
| Eviction sweep — the same scan, **47.9 ms p50 at 20k** | Sweeps iterate the index, not the disk; RAM recency replaces the per-hit `utimes` write | **0.002 ms p50, 0.16 ms max** over 200 consecutive sweeps on a 5k store |
| Hot-hit read path — `readFileSync` + `JSON.parse` + sha256 re-verify per hit: 0.211 ms on a 48 KB entry, 0.764 ms at the 192 KB cap | **Hot-entry memo** — cacache's own memoization layer shape (500 entries / 50 MiB / 3 min TTL, `UNOWN_WEB_CACHE_MEMO*` knobs): hot keys skip disk, parse and hash entirely while still honoring their own entry TTL | **0.001 ms** on the same 48 KB entry (~200×; ~1,500× at the cap) |

The receipts also corrected an attribution: the baseline RESULTS table blamed
the amortized-put p99 (15.7 ms) on the 1/8-probability sweep, but the after
run showed the same tail while 200 consecutive sweeps measured 0.002 ms —
the tail was environmental CPU contention on the 2-core test box, not the
sweep. The correction is recorded in `benchmarks/webcache/RESULTS.md` because
the raw samples in both receipts make it checkable; only direct measurements
(the 47.9 ms → 0.002 ms sweep cost) are claimed as wins.

Cross-process honesty: the index is per-process. Another process's writes are
invisible to it until the next rebuild — which is why stats are approximate
and labeled, and why eviction correctness never depends on the index being
complete (a missed entry simply survives one sweep longer; the cap
self-heals at the next rebuild). This is the same trade WebKit ships
(`m_approximateSize`, reconciled by periodic background synchronization) and
Chromium SimpleCache (index flushed on idle/shutdown, merged with a scan at
startup).

## Where it deliberately stops

- No semantic/near-duplicate tier (H20 refuted it; revisit only with new evidence).
- No cross-process request coalescing (single-flight is in-process; cross-process duplicates are rare and idempotent).
- No search-side conditional revalidation (search APIs rarely emit validators; fetch-side covers the "version change" contract).
- No per-domain TTL overrides or user-tunable TTL tables (three scalar knobs cover the observed needs; complexity can be added with evidence).
- No persisted index file (a crash costs one rebuild scan — Chromium's STARTUP_MERGE without the file; a stats file would add a write on the hot path and a cross-process race to keep honest).
- No async fs / worker-thread offload (cacache's v17 lesson is real, but our calls ride multi-second agent tool turns; the measured store ops are 0.001–1 ms sync, and the one millisecond-scale path — the scan — is now off the per-call hot path entirely. Revisit only with a measured need).
- No SWR on the raw webfetch path (power users asking for exact bytes keep the exact blocking semantics; the search and text-fetch paths — what agents hammer — have it).
