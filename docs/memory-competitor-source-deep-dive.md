# Memory competitor source-level deep dive (RESEARCH-2)

> Companion to [memory-competitor-research.md](memory-competitor-research.md) (the 2026-10-25 product-level sweep). That page answered "what do the products do"; this one answers **"how is the code actually shaped"** — process models, write/read paths, background-work mechanics, durability, and the failure modes visible in the trackers — for five required projects (Letta, Mem0, Cognee, Zep/Graphiti, MemOS) plus three quick dives (LangMem, Memobase, A-MEM). Everything was read in shallow clones pinned to the SHAs below; every claim cites a file path + URL. Task ID: RESEARCH-2 (2026-10-26).

**Method.** Each repo was shallow-cloned at HEAD and read directly (file paths below are exact at the pinned SHA). Issue links come from the GitHub search API the same day. Claim tiers as on the parent page: **[V]** read in fetched source; **[C]** upstream-claimed; **[U]** inference. Line numbers drift; the file paths + function names are the stable citation.

| Repo | Pinned SHA | Date | Notes |
|---|---|---|---|
| `letta-ai/letta` (main) | `8816d3a` | 2026-10-18 | Archived pointer repo — source moved to `letta-code` |
| `letta-ai/letta` (`archive` branch) | `56ba9c2` | 2026-08-13 | "Letta V1" Python/FastAPI server, v0.16.7 — the codebase the task's questions describe |
| `letta-ai/letta-code` | `1fb6ea4` | 2026-10-25 | Current TS/Bun CLI + App Server, v0.34.24 |
| `letta-ai/letta-python` | `3731731` | 2026-09-12 | Current client SDK (`letta-client` 1.12.1) |
| `mem0ai/mem0` | `2c81af3` | 2026-10-20 | Python SDK + TS SDK + self-host server |
| `topoteretes/cognee` | `37f788b` | 2026-10-16 | |
| `getzep/graphiti` | `5c27edf` | 2026-10-25 | |
| `MemTensor/MemOS` | `adcb9f2` | 2026-10-23 | MemOS 2.0 "Stardust" restructure |
| `langchain-ai/langmem` | `48e3c11` | 2026-10-02 | |
| `memodb-io/memobase` | `358c16b` | 2026-01-11 | |
| `agiresearch/A-mem` | `ceffb86` | 2025-12-12 | |

- [Letta / MemGPT](#letta--memgpt) · [Mem0](#mem0) · [Cognee](#cognee) · [Zep / Graphiti](#zep--graphiti) · [MemOS](#memos) · [Quick dives: LangMem, Memobase, A-MEM](#quick-dives-langmem-memobase-a-mem)
- [Comparative synthesis table](#comparative-synthesis-table) · [Top 10 transferable architecture lessons](#top-10-transferable-architecture-lessons-for-the-detached-bun-engine)

**Reference point.** Unown's engine, per [detached-engine-architecture.md](detached-engine-architecture.md): a detached Bun daemon on `:3030` (REST+SSE, bearer token), single writer of `db/selflearning.db` (SQLite WAL, `BEGIN IMMEDIATE`, 60s checkpoint), a job router with one busy mutex + 20-min watchdog, budget governor (60 calls/hr, 2M tokens/day), filesystem outbox fallback for notes, ping-and-spawn supervision, automations scheduler, memory = 4-tier Markdown files rendered from the DB, AutoDream consolidation gated on ≥3 undreamed notes + cooldown + budget. "Better/worse" below is measured against exactly that.

---

## Letta / MemGPT

The repo asked about (`letta-ai/letta`) is now an archived pointer: main's README says "The current source code lives in [`letta-ai/letta-code`](https://github.com/letta-ai/letta-code)… The [`archive`](https://github.com/letta-ai/letta/tree/archive) branch contains the retired Letta V1 API server" ([V — README @ `8816d3a`](https://github.com/letta-ai/letta/blob/main/README.md)). So there are **two architectures to reverse-engineer**: the retired Python FastAPI server (which is what "FastAPI server + sleep-time compute" describes) and the current Bun/TS App Server.

### Letta V1 — the FastAPI server (archive branch, v0.16.7)

**Process model: one Python process (uvicorn + FastAPI), everything in-process.** [`letta server`](https://github.com/letta-ai/letta/blob/archive/letta/server/rest_api/app.py) → `uvicorn.run("letta.server.rest_api.app:app", host, port=REST_DEFAULT_PORT, workers=settings.uvicorn_workers …)` with `REST_DEFAULT_PORT = 8283` ([letta/server/constants.py](https://github.com/letta-ai/letta/blob/archive/letta/server/constants.py)) [V]. The `SyncServer` object is constructed at module scope (`app.py`: `server = SyncServer(default_interface_factory=…)`) [V]. The FastAPI lifespan does the boot work: an **event-loop watchdog** (`start_watchdog(loop, check_interval=5.0, timeout_threshold=15.0)`), NLTK data pre-download via `asyncio.to_thread`, DB pool monitoring, and readiness-state transitions `warming → ready → draining` (`lifespan` in app.py) [V]. Multi-worker scale-out exists via uvicorn `workers` + a Redis Streams manager for SSE fan-out ([letta/server/rest_api/redis_stream_manager.py](https://github.com/letta-ai/letta/blob/archive/letta/server/rest_api/redis_stream_manager.py)) [V].

**How agents persist.** SQLAlchemy async ORM over **Postgres (pgvector) by default, SQLite as dev fallback** — `settings.py` resolves `DatabaseChoice.POSTGRES if self.letta_pg_uri_no_default else DatabaseChoice.SQLITE` ([letta/settings.py](https://github.com/letta-ai/letta/blob/archive/letta/settings.py)) [V]; the engine/session factory is built once at module level in [letta/server/db.py](https://github.com/letta-ai/letta/blob/archive/letta/server/db.py) with asyncpg + pool tuning [V]. Schema evolution = **Alembic, 167 migration files** in [`alembic/versions/`](https://github.com/letta-ai/letta/tree/archive/alembic/versions) [V]. Deployment = docker-compose with `redis` + `ankane/pgvector` + the letta container ([scripts/docker-compose.yml](https://github.com/letta-ai/letta/blob/archive/scripts/docker-compose.yml)); the Dockerfile itself is `FROM pgvector/pgvector:0.8.1-pg15` [V].

Two ORM details worth stealing:

- **Memory blocks are optimistic-locked.** `letta/orm/block.py`: `version: Mapped[int] … doc="Optimistic locking version counter, incremented on each state change"` with SQLAlchemy `version_id_col` — concurrent updates raise `ConcurrentUpdateError` [V].
- **Memory block history is a first-class table.** `block_history` with a unique index on `(block_id, sequence_number)` and a `current_history_entry` FK on the block ([letta/orm/block_history.py](https://github.com/letta-ai/letta/blob/archive/letta/orm/block_history.py)) [V]. That's per-block append-only history in SQL — Unown's `memory_versions` table is the same idea; Letta got there with an ORM version column doing double duty as the race detector.

**Sleep-time compute / memory consolidation — the actual mechanics** ([V — letta/groups/sleeptime_multi_agent_v4.py](https://github.com/letta-ai/letta/blob/archive/letta/groups/sleeptime_multi_agent_v4.py)):

1. A "sleeptime" agent is a **second agent created in the same multi-agent group, sharing the main agent's memory blocks** — `create_sleeptime_agent_async` in [letta/server/server.py](https://github.com/letta-ai/letta/blob/archive/letta/server/server.py) creates `<name>-sleeptime` with `agent_type=sleeptime_agent`, `sleeptime_memory_persona`, and `sleeptime_agent_frequency=5` [V].
2. After every foreground `step()`/`stream()` completes, `SleeptimeMultiAgentV4.run_sleeptime_agents()` **bumps a per-group turns counter** in the DB; only when `turns % sleeptime_agent_frequency == 0` does it proceed [V].
3. It records a **cursor** (`get_last_processed_message_id_and_update_async`) so the sleep agent sees only messages since its last run, then for each sleeper creates a **`Run` row (status `created`)** and fires `_participant_agent_step` via `safe_create_task(…)` [V].
4. `safe_create_task` = **bare `asyncio.create_task` with a module-level strong-reference set** (`_background_tasks.add(task)`) plus a logging wrapper — no queue, no worker pool, no persistence of the coroutine ([letta/utils.py](https://github.com/letta-ai/letta/blob/archive/letta/utils.py), `safe_create_task`) [V]. The `stream()` path runs sleep agents in a `finally:` block because "stream is throwing a GeneratorExit even though it appears that the client is getting the whole stream" (their comment) [V].

So: **sleep-time compute is fire-and-forget asyncio inside the server process, frequency-gated at every 5 turns, cursor-tracked, with a DB row for observability but no recovery of the in-flight coroutine.** I found **no startup sweep** that resumes `Run` rows stuck in `created`/`running` in `server.py` or `run_manager.py` — if the process dies mid-sleep, the row orphans [V — absence of recovery code; flagged as such]. Their "lettuce" service (`letta/services/lettuce/`) is the cloud batch-job abstraction, and in the final archived state it's a stub base class (`LettuceClient.get_status` → `None`) [V].

**Client/server protocol + server-down handling.** Current client = [`letta-client` 1.12.1](https://pypi.org/pypi/letta-client/json) from `letta-ai/letta-python`, a Stainless-generated httpx SDK: **REST + SSE streaming**, `DEFAULT_MAX_RETRIES = 2` with `Retry-After` header parsing and exponential backoff (`_base_client.py`, `_constants.py:10`) [V]. Server down → 2 retries → typed exception. There is no client-side durable queue; durability is the server's Postgres.

**Known issues (process/memory class):** [letta #3366](https://github.com/letta-ai/letta/issues/3366) — `ConcurrentUpdateError` on block updates from *expected* optimistic-lock races between the main and sleeptime agents (they log it at WARNING now: the shared-block design makes races normal) [V]; [letta #3104](https://github.com/letta-ai/letta/issues/3104) — sleeptime message grouping causes role confusion [V]; [letta #3294](https://github.com/letta-ai/letta/issues/3294) — "Sleeptime-to-reflection migration: support customizable subagents…" [V]; [letta #3116](https://github.com/letta-ai/letta/issues/3116) — archival memory deduplication/consolidation feature request [V]; [letta #3330](https://github.com/letta-ai/letta/issues/3330) — "server.py: 1910-line god file with 39 methods" (their own architecture debt ticket) [V]; [letta #2354](https://github.com/letta-ai/letta/issues/2354) — "Recreated Docker container, agents are lost!" (volume-mount durability footgun) [V]; [letta #1485](https://github.com/letta-ai/letta/issues/1485) — sqlalchemy error after upgrade (migration break) [V].

```
   client (letta-python, httpx+SSE, 2 retries)          docker-compose: redis + pgvector + letta
        │ REST :8283 / SSE
        ▼
   ┌─────────────────────────────────────────────────────┐
   │ uvicorn → FastAPI app.py                             │
   │  lifespan: event-loop watchdog(5s/15s), NLTK,       │
   │    DB pool monitor, readiness warming→ready→drain   │
   │  SyncServer (module singleton)                      │
   │    ├─ SQLAlchemy async ORM → Postgres (SQLite dev)  │
   │    │   blocks: version col (optimistic lock)        │
   │    │   block_history: append-only per block         │
   │    │   runs: sleeptime Run rows (created→running)   │
   │    ├─ request handler: foreground agent step        │
   │    └─ SleeptimeMultiAgentV4.step()                  │
   │         turns++ (DB) ; every 5th turn:              │
   │         cursor = last_processed_message_id          │
   │         Run(created) + safe_create_task(            │
   │            sleep agent step)  ← fire-and-forget     │
   │            asyncio.create_task, strong-ref set,     │
   │            NO queue, NO restart recovery            │
   └─────────────────────────────────────────────────────┘
```

### Letta current — `letta-code` (v0.34.24, Bun)

Today's Letta is **a Bun TypeScript CLI** — `packageManager: bun@1.3.14`, `bin: letta` ([package.json @ `1fb6ea4`](https://github.com/letta-ai/letta-code/blob/main/package.json)) [V] — i.e., the same runtime family as Unown's engine. `letta server` runs an in-process **WebSocket App Server**: `src/websocket/app-server.ts` accepts only `ws://` listen URLs, enforces Origin + token/bearer auth, rejects "legacy split-channel" clients [V]. Channel integrations (Slack/Telegram/Discord) and **scheduled jobs live in `src/cron/`** (`cron-file.ts`, `parse-interval.ts`, `process-identity.ts`) [V]. Dreaming is server-side: the `/dream` command POSTs over the SDK and receives `{status: "queued", run_id}` — the CLI test suite pins that contract with "no model or message requests" client-side ([src/websocket/app-server-dream.test.ts](https://github.com/letta-ai/letta-code/blob/main/src/websocket/app-server-dream.test.ts)) [V]. Memory itself is MemFS (git-backed) + dreaming subagents in worktrees — covered from docs on the parent page; the shipped `dist/memory-confinement.js` / `dist/memory-constraints.js` artifacts confirm memory governance is a first-class module in the current binary [V].

**Better than our detached Bun engine + SQLite:** per-block optimistic-lock versions with append-only `block_history` (auditable, race-detecting memory writes in SQL); a typed, retrying client SDK contract; readiness/drain lifecycle states; Alembic migration discipline (167 steps); a frequency-gated (every-5-turns) consolidation trigger tied to actual usage, with a message cursor so the sleeper only sees new messages; a scale-out path (uvicorn workers + Redis Streams) we deliberately don't need yet.

**Worse:** sleep runs are non-durable asyncio tasks — a restart orphans `Run` rows (no recovery sweep in the archived code); the "real" deployment needs Postgres+pgvector+Redis; the V1 server was a self-admitted 1910-line god file (#3330); the optimistic-lock design makes concurrent memory edits *fail* rather than serialize (Unown's single-writer mutex sidesteps the entire class — Letta needed #3366 to make the failures quiet).

---

## Mem0

**Process model: an in-process library first; the OSS "server" is a thin FastAPI wrapper around a singleton `Memory()`.** The Python `Memory` class ([mem0/memory/main.py @ `2c81af3`](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py), 3912 lines, plus a parallel `AsyncMemory`) is the product; there is no daemon, no queue, no cron anywhere in the OSS tree [V].

**`Memory` lifecycle** (constructor, `main.py:488`): builds embedder + vector store + LLM + `SQLiteManager(history_db_path)` (default `~/.mem0/history.db`), optional reranker; the **entity store is lazy** (first use); `close()` + context-manager support exist — and `close()` has a documented race: "Memory.close() races in-flight writes: silent audit-history loss (db=None window)" ([mem0 #7440](https://github.com/mem0ai/mem0/issues/7440)) [V].

**Write path — `add()` → `_add_to_vector_store()`** [V, `main.py:881`]:

- `infer=False` → verbatim message insert per non-system message.
- Otherwise the **V3 phased batch pipeline**: Phase 0 context gathering (last 10 messages from the SQLite history DB) → Phase 1 retrieve top-10 existing memories, **map UUIDs to ints as an anti-hallucination measure** → Phase 2 a **single ADD-only extraction LLM call** (`ADDITIVE_EXTRACTION_PROMPT`, agent-scope suffix, custom instructions; **extraction failure now raises `LLMError` instead of returning `[]`** — the comment says the old silent-empty path "made upstream callers unable to distinguish 'LLM unavailable' from 'LLM extracted no facts'") → Phase 3 batch embed (per-text fallback) → Phase 4/5 **MD5-hash dedup against the top-10 snapshot + within batch** → Phase 6 batch insert into the vector store with per-record fallback, and the recent fix that **only records the store actually persisted make it into history, entity links, and the returned results** ("a record the store rejected must never be reported back as a successful ADD") → Phase 7 batch entity linking (`_upsert_entity`, `linked_memory_ids`) [V].
- The dedup reference set being just the top-10 neighbors with no similarity floor is exactly the corpus-scale duplicate bug ([mem0 #7123](https://github.com/mem0ai/mem0/issues/7123)); hash-dedup against a stale snapshot under concurrent `add()`s is the TOCTOU bug ([mem0 #6531](https://github.com/mem0ai/mem0/issues/6531) TS / [#6515](https://github.com/mem0ai/mem0/issues/6515) Python) — both already pinned on the parent page; the source confirms the mechanism.

**Read path — `search()`**: hybrid semantic + BM25 over `text_lemmatized` (stores without `keyword_search` log a warning that hybrid scoring is disabled) + entity boosts computed from query entities; optional reranker; `get_all` supports `expiration_date` / `show_expired` (memory expiry exists in the data model) [V].

**The TS SDK** (`mem0-ts/src/oss`, `mem0ai-oss` package — what Unown embeds): `Memory` class is 2201 lines with the same phased `add()`; constructor defers vector-store creation to `_autoInitialize()` which **probes the embedding dimension with a live embed call**; `disableHistory` → `DummyHistoryManager` [V]. Defaults ([`src/oss/src/config/defaults.ts`](https://github.com/mem0ai/mem0/blob/main/mem0-ts/src/oss/src/config/defaults.ts)): vector store provider `"memory"` = the better-sqlite3 `MemoryVectorStore` (vectors as payloads in SQLite; the file's own comment: "We *intentionally* don't rely on sqlite-wasm or vss. Pure JS brute is…"), history store `"sqlite"` (`memory.db`), embedder OpenAI `text-embedding-3-small`, LLM `gpt-5-mini` [V]. ~30 store adapters ship alongside [V].

**Background processing: none in OSS.** No celery/asyncio-scheduler/cron anywhere; consolidation ("Dream") is platform-only (parent page). The self-host server ([`server/`](https://github.com/mem0ai/mem0/tree/main/server)) is FastAPI + uvicorn + **Postgres (pgvector pg17) via Alembic** for app-level state (users, JWT auth, rate limiting, `Settings.config_overrides`), a Next.js dashboard, and a module-level singleton guarded by an `RLock` (`server_state.py`); `POST /memories` calls `get_memory_instance().add(...)` **synchronously in the request handler** (a plain `def`, so FastAPI threadpools it) [V]. docker-compose: `mem0` + `postgres` + `mem0-dashboard` [V].

**Known issues (source/process class):** [#7440](https://github.com/mem0ai/mem0/issues/7440) close() race (above); [#4573](https://github.com/mem0ai/mem0/issues/4573) — "What we found after auditing 10,134 mem0 entries: 97.8% were junk" (extraction quality at scale, with a public audit) [V]; [#7529](https://github.com/mem0ai/mem0/issues/7529) — an `AND` metadata filter silently overwrites a sibling top-level filter key (filter semantics bugs persist post-V3) [V]; plus the tracker set pinned on the parent page (#6531/#6515, #7123, #5439, #6243, #5577, #6925, #6448, #7214) [V].

```
  caller code ── new Memory(config)  (embedder + vector store + LLM + SQLiteManager + lazy entity store)
        │ add(messages, {user_id})
        ▼
   Phase 0: last-10 msgs from SQLite history DB
   Phase 1: embed msg → top-10 search → UUID→int map
   Phase 2: ONE LLM call (ADD-only extraction + entity links + observation date)
            ── failure raises LLMError (was silent [])
   Phase 3: batch embed (fallback per-text)
   Phase 4/5: MD5 hash dedup (vs top-10 snapshot + in-batch)   ← TOCTOU #6531 / window #7123
   Phase 6: batch insert (fallback per-record); ONLY persisted rows count
            → SQLite history rows (event=ADD)                   ← close() race #7440
   Phase 7: entity upserts + linked_memory_ids                  ← cross-scope bug #5439
   [no background lane — caller does everything]
```

**Better than our engine:** pure-library embeddability with zero server ops; the dimension-probe auto-init trick; a 30-adapter store matrix; the history DB records old/new text per event; the "only persisted records count as success" and "extraction failure raises" fixes are exactly the right durability semantics; memory expiry is in the data model.

**Worse:** no background/consolidation lane at all in OSS — an embedding app must invent its own daemon (which is why Unown exists); documented TOCTOU/no-floor dedup; a 3912-line `main.py` god module with a duplicated `AsyncMemory` twin (every fix lands twice); the self-host server runs LLM extraction inline in request handlers with no queue, so a slow provider stalls the endpoint's threadpool.

---

## Cognee

**Process model: async library + optional FastAPI server + subprocess-isolated embedded databases.** The library entry points are `add()` / `cognify()` / `search()` / `improve()` / `forget()`; the server is `uvicorn cognee.api.client:app --port 8000` (referenced in [cognee/cli/api_dispatch.py](https://github.com/topoteretes/cognee/blob/main/cognee/cli/api_dispatch.py)) [V]. The distinctive piece is `cognee_db_workers/`: **Kuzu (graph, "Ladybug") and LanceDB (vector) each run in a dedicated child process** — a stdlib-only "subprocess harness: request/response dataclasses, queue event loop, and a main-process Session that owns a Process + queues" ([cognee_db_workers/harness.py](https://github.com/topoteretes/cognee/blob/main/cognee_db_workers/harness.py)) with crash detection (win32 `OpenProcess`/exit-code handling), **respawn with setup-RPC replay**, per-call timeouts "before the retry loop forces a respawn", and `atexit` shutdown; the worker modules deliberately "must not import cognee — that would defeat the whole point of running the DB client in a separate process" ([kuzu_worker.py](https://github.com/topoteretes/cognee/blob/main/cognee_db_workers/kuzu_worker.py)) [V]. Rationale visible in the code: Kuzu file-lock contention gets bounded exponential backoff (`_retry_open_locked`) [V].

**Pipeline architecture.** `cognify()` composes **`Task` pipelines** ([cognee/api/v1/cognify/cognify.py](https://github.com/topoteretes/cognee/blob/main/cognee/api/v1/cognify/cognify.py)) — classify documents → chunk → extract graph + summarize → provenance → store; code repos get their own task set (code graph); a `cognify_rollback_handler` unwinds failed runs; `CognifyFailedError` wraps pipeline failures with dataset context and a "pass raise_on_error=False" hint [V].

**Background work — asyncio tasks with three layers of hardening** [V]:

1. `run_in_background=True` → `run_pipeline_as_background_process` ([cognee/modules/pipelines/layers/pipeline_execution_mode.py](https://github.com/topoteretes/cognee/blob/main/cognee/modules/pipelines/layers/pipeline_execution_mode.py)): `asyncio.create_task` anchored in `_BACKGROUND_PIPELINE_TASKS`, with the comment "The event loop only keeps weak references to tasks, so without anchoring here Python's gc can collect an in-flight task before it completes, silently aborting the background run" [V].
2. A **process-wide background-task registry** ([cognee/infrastructure/background_tasks.py](https://github.com/topoteretes/cognee/blob/main/cognee/infrastructure/background_tasks.py)): `register_background_task` anchors fire-and-forget tasks (remember-with-`run_in_background`, the session→graph bridge) and `wait_for_background_tasks(timeout)` drains them — "the FastAPI lifespan calls it on shutdown so an in-flight improve is not cut off by process exit" [V].
3. **OS-level run ownership** ([cognee/modules/pipelines/run_ownership.py](https://github.com/topoteretes/cognee/blob/main/cognee/modules/pipelines/run_ownership.py)): every pipeline run takes a `filelock` at `<system_root>/pipeline_run_locks/<uuid>/owner.lock`; "Age makes a run eligible for recovery; acquiring its existing ownership lock proves the writer has released it or died" — crash recovery for orphaned runs without a heartbeat daemon [V].

The docker-compose ties it together explicitly: `stop_grace_period: 15s` with the comment "Must exceed the shutdown hook's background-task drain (default 8s, BACKGROUND_DRAIN_TIMEOUT_SECONDS) plus the engine close/WAL checkpoint — raise BOTH together, or the worker is SIGKILLed mid-checkpoint" ([docker-compose.yml](https://github.com/topoteretes/cognee/blob/main/docker-compose.yml)) [V].

**Session distillation** (`remember(session_id=…)`) has its own debounced background improve: `auto_improve_debounce.py` + `should_auto_improve(qa_count)` gates when a session's Q&A gets bridged into the graph ([cognee/api/v1/remember/remember.py](https://github.com/topoteretes/cognee/blob/main/cognee/api/v1/remember/remember.py)) [V].

**Durability.** Defaults are fully embedded: **SQLite relational** (`DB_PROVIDER=sqlite` default in [cognee/infrastructure/databases/relational/config.py](https://github.com/topoteretes/cognee/blob/main/cognee/infrastructure/databases/relational/config.py)) + **Kuzu graph files** + **LanceDB vector files** (`vector_db_provider: "lancedb"` in [cognee/infrastructure/databases/vector/config.py](https://github.com/topoteretes/cognee/blob/main/cognee/infrastructure/databases/vector/config.py), path `cognee.lancedb`); Alembic migrations under `cognee/alembic`; Postgres is a compose profile [V]. Native install via `uv`/pip; the compose runs one container (+ optional postgres), with named volumes for `.cognee_system` / `.data_storage` [V].

**Known issues (process class):** [#5987](https://github.com/topoteretes/cognee/issues/5987) — `LanceDBAdapter.create_data_points` deadlocks when the collection doesn't exist yet (`VECTOR_DB_LOCK` taken twice) [V]; [#5227](https://github.com/topoteretes/cognee/pull/5227) — "Make locks event-loop-agnostic" (asyncio locks breaking across `asyncio.run` loops) [V]; [#5779](https://github.com/topoteretes/cognee/issues/5779) — `detect_contradictions` swallows all exceptions including `KeyboardInterrupt`, "failures are completely invisible" [V]; [#5778](https://github.com/topoteretes/cognee/issues/5778) — `search()` has no timeout, long LLM searches "block indefinitely with no cancellation" [V]; [#5710](https://github.com/topoteretes/cognee/issues/5710) — LanceDB background prune "can respawn a worker during intentional shutdown, leaving it alive after close" [V].

```
 cognee.add() ─► SQLite (datasets/documents) ─► cognify() builds Task pipeline
                                                     │
        ┌────────────────────────────────────────────┴────────────────────────────┐
        │ run_pipeline_blocking            run_pipeline_as_background_process     │
        │   (awaited)                       asyncio.create_task anchored in set    │
        │                                    + run info pushed to in-memory queue  │
        │                                    + run_ownership filelock (crash proof)│
        │  registry: background_tasks.py — wait_for_background_tasks(timeout)      │
        │  FastAPI lifespan drains; compose stop_grace_period 15s > drain 8s       │
        └───────┬───────────────────────┬───────────────────────┬─────────────────┘
                ▼                       ▼                       ▼
        Kuzu worker (child proc)  LanceDB worker (child proc)  SQLite relational
        harness: pickle RPC,      same harness; background     (in-process)
        respawn + setup replay    prune (#5710 respawn bug)
```

**Better than our engine:** embedded-DB crash containment (a Kuzu/LanceDB native segfault kills a replaceable child, not the server — the single best idea here for anything with native code in-process, e.g. our ONNX embedder); filelock run-ownership as cheap, daemon-free crash recovery; the drain-registry + grace-period arithmetic; an explicit rollback handler for failed ingests.

**Worse:** the background queue is in-memory (restart loses queued-but-unstarted pipelines — same hole as Graphiti's queue, without even a `202 Accepted` marker); the asyncio-everything design has recurring loop/lock footguns (#5227, #5778); a 176 MB repo with an enormous dependency surface for what Unown does with one SQLite file; silent exception swallowing in exactly the contradiction-detection stage we care about (#5779).

---

## Zep / Graphiti

**Process model: async Python library; background ingestion is explicitly the caller's job.** `graphiti-core` is a library you await; `add_episode()`'s own docstring says: "It is recommended to run this method as a background process, such as in a queue… consider using FastAPI's background tasks or a dedicated task queue like Celery" ([graphiti_core/graphiti.py @ `5c27edf`](https://github.com/getzep/graphiti/blob/main/graphiti_core/graphiti.py)) [V]. The repo ships two optional servers, both reference-quality: a FastAPI `graph-service` (`server/`) whose README warns "This server is a reference implementation… no authentication, no authorization, and no prompt-injection protection… Do not expose the server to an untrusted network" ([server/README.md](https://github.com/getzep/graphiti/blob/main/server/README.md)) [V], and an MCP server (`mcp_server/`) [V].

**The reference ingest path is a textbook single-worker queue** ([server/graph_service/routers/ingest.py](https://github.com/getzep/graphiti/blob/main/server/graph_service/routers/ingest.py)) [V]:

```python
class AsyncWorker:
    def __init__(self): self.queue = asyncio.Queue(); self.task = None
    async def worker(self):
        while True: job = await self.queue.get(); await job()
@router.post('/messages', status_code=202)
async def add_messages(request, graphiti):
    for m in request.messages: await async_worker.queue.put(partial(add_messages_task, m))
    return Result(message='Messages added to processing queue', success=True)
```

One consumer task, **HTTP 202 + in-memory queue**, jobs lost on restart, no per-group parallelism (the library wants episodes added sequentially per group) [V]. The failure this causes is public: "[BUG] add_memory returns success but episodes can be silently dropped — no failure signal reaches the caller" ([graphiti #1707](https://github.com/getzep/graphiti/issues/1707)); an RFC to replace the in-memory queue with Redis Streams was closed ([#1177](https://github.com/getzep/graphiti/issues/1177)); the MCP server's queue got retry + dead-letter + dropped-episode counters in [#1915](https://github.com/getzep/graphiti/pull/1915) / [#1992](https://github.com/getzep/graphiti/pull/1992), fixing "[MCP queue drops episodes on transient extraction errors (no retry; episode left with 0 edges)](https://github.com/getzep/graphiti/issues/1911)" [V].

**How a temporal edge actually gets built** (`add_episode` → `_extract_and_resolve_nodes` → `_extract_and_resolve_edges` → `_process_episode_data`, `graphiti.py`) [V]: extract entities from the episode (LLM) → resolve/dedupe against existing nodes (embeddings + LLM) → extract facts as edges (LLM, optionally typed by Pydantic `edge_types`) → resolve edges and **invalidate contradicting old edges by setting `invalid_at`** (bi-temporal: `valid_at` = event time from `reference_time`, `created_at` = ingestion time) → write episodic edges (fact→episode provenance) → optionally update communities. Two newer mechanics: **request-scoped clients** so concurrent calls for different `group_ids` can't clobber the shared driver (fixes their issue #1676, cited in-code) [V], and **sagas** — named episode chains linked `HAS_EPISODE`/`NEXT_EPISODE` with a `saga_previous_episode_uuid` fast-path [V]. `store_raw_episode_content=False` blanks episode content after extraction to save graph space [V]. Search = hybrid semantic + BM25 fulltext + graph traversal with RRF reranking recipes ([graphiti_core/search/search_config_recipes.py](https://github.com/getzep/graphiti/blob/main/graphiti_core/search/search_config_recipes.py)) [V].

**Durability: the graph DB is the database.** Drivers for Neo4j (docker-compose default, `neo4j:5.26.2`), FalkorDB, Neptune, and Kuzu ([graphiti_core/driver/](https://github.com/getzep/graphiti/tree/main/graphiti_core/driver), e.g. [kuzu_driver.py](https://github.com/getzep/graphiti/blob/main/graphiti_core/driver/kuzu_driver.py)); `build_indices_and_constraints()` on init; migrations live per-driver under `driver/*/operations` [V]. Embeddings + a cross-encoder reranker are configured, LLM must be structured-output-capable [V]. The compose pins `127.0.0.1:8000` for the API + Neo4j with healthchecks [V]. Cross-platform: pip + docker; no native daemon.

**Known issues (process/scale class):** #1707 / #1177 / #1911 (above) [V]; [#1592](https://github.com/getzep/graphiti/issues/1592) — FalkorDB `edge_fulltext_search` Node-By-Label-Scan per hit "→ add_episode times out at scale" and [#1272](https://github.com/getzep/graphiti/issues/1272) full-graph scan via re-MATCH [V]; [#186](https://github.com/getzep/graphiti/issues/186) — "Graphiti messages are added very slowly" [V]; [#912](https://github.com/getzep/graphiti/issues/912) — pydantic validation errors on `ExtractedEntities` (small-model extraction breaks ingestion) [V].

```
  caller (agent/app)
     │ await graphiti.add_episode(...)          ── library: fully inline pipeline
     │   extract nodes → resolve/dedupe → extract edges → resolve +
     │   invalidate old edges (invalid_at) → episodic edges (+saga links)
     ▼
  optional servers:
  ├─ graph-service (FastAPI)  POST /messages → 202 → asyncio.Queue (1 worker,
  │    in-memory, restart = loss #1707; RFC Redis Streams #1177 closed)
  └─ mcp_server               queue + retry + dead-letter (#1915/#1992)
     │
     ▼
  graph DB: Neo4j (default) | FalkorDB | Neptune | Kuzu   ← durability lives here
  (+ embeddings, cross-encoder; LLM must do structured output)
```

**Better than our engine:** contradiction handling as a *data-model* operation (bi-temporal `invalid_at`) rather than a reconcile pass; episode→fact provenance edges; `group_ids` tenancy pushed into every query; the honest "run me in a queue" contract with a 5-line reference worker; per-request client scoping (the fix pattern for cross-tenant clobbering).

**Worse:** the reference queue loses acknowledged work on restart — the exact failure our outbox + `markDreamed`-only-on-success contract exists to prevent; requires an external graph DB + an extraction-class LLM; ingestion latency issues at scale (#1592/#186); no consolidation/forgetting beyond edge invalidation.

---

## MemOS

MemOS 2.0 ships **two completely different shapes in one repo** [V]:

**(a) The full server stack** — FastAPI API (`src/memos/api/`), docker-compose with `memos-api` + **Neo4j 5.26.6 + Qdrant 1.15.3** (+ MySQL ORM via SQLAlchemy, + optional Redis/RabbitMQ for the scheduler; a Helm chart in `deploy/`) ([docker/docker-compose.yml](https://github.com/MemTensor/MemOS/blob/main/docker/docker-compose.yml)) [V].

**(b) The local plugin** — `@memtensor/memos-local-plugin` v2.0.16-beta.1 (`apps/memos-local-plugin/`): an **agent-agnostic TypeScript core with better-sqlite3 storage, FTS5 keyword search, pure-JS brute-force vectors** ("We *intentionally* don't rely on sqlite-wasm or vss. Pure JS brute is…", `core/storage/vector.ts`), SQL migrations under `core/storage/migrations/`, an HTTP server (`/api`, `/events`) serving a viewer, and a **JSON-RPC bridge daemon for the Python host**; a supervisor with KeepAlive restart; well-known ports per host agent (openclaw=18799, hermes=18800, dsh=18801) ([ARCHITECTURE.md](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/ARCHITECTURE.md), `server/types.ts`) [V]. *This is the closest thing in the industry to Unown's detached engine: a per-agent memory daemon over SQLite with a supervisor.*

**MemScheduler — the process model** ([src/memos/mem_scheduler/base_scheduler.py](https://github.com/MemTensor/MemOS/blob/main/src/memos/mem_scheduler/base_scheduler.py)) [V]:

- A **thread-pool dispatcher** (`SchedulerDispatcher`, `max_workers=30` default): "Dedicated thread pool per message label… Batch message processing… Thread race competition for parallel task execution" ([task_schedule_modules/dispatcher.py](https://github.com/MemTensor/MemOS/blob/main/src/memos/mem_scheduler/task_schedule_modules/dispatcher.py)) [V].
- The inbound queue is an **`AutoDroppingQueue`** (bounded, drops on overflow) — with a **dead-letter quarantine for poisoned stream messages** as a recent PR ([#2403](https://github.com/MemTensor/MemOS/pull/2403)) [V].
- **Redis or local queue** (`DEFAULT_USE_REDIS_QUEUE`), a **RabbitMQ webservice module**, a consume loop with `consume_interval_seconds` + `consume_batch`, `TaskStatusTracker`, and three monitors (dispatcher/general/task-schedule) [V].
- `MOSCore` (`mem_os/core.py`) owns cubes + reader + scheduler behind a `Lock`, with `enable_mem_scheduler` toggling the whole lane [V].

**Memory lifecycle across tiers** [V]:

- **Hot: activation memory** — `ActivationMemoryManager.update_activation_memory_periodically()` pulls texts from `working_memory_monitors` (synced with the ORM DB) and packs them into **KV-cache items (including vLLM `VLLMKVCacheItem`s)** so the hot tier is literally a precomputed prompt/KV prefix (`mem_scheduler/memory_manage_modules/activation_memory_manager.py`) [V]. Its growth bug was real: "stop activation KV cache from growing every turn" ([#2359](https://github.com/MemTensor/MemOS/pull/2359)) [V].
- **Warm: textual/working memory** — `TreeTextMemory` in MemCubes (`mem_cube/general.py`), hybrid retrieval.
- **Cold: archived versions** — textual items keep archived versions with "compact temporal index snapshot… used by retrieval-side version selection" (`memories/textual/item.py`) [V]; the local plugin archives idle low-eta skills ([#2209](https://github.com/MemTensor/MemOS/pull/2209)) [V].
- The local plugin's ladder is explicit and documented per directory: **L1 = step-level traces `(s_t, a_t, o_t, ρ_t, r_t)`** in the SQLite `traces` table with write-time enrichment (tags, error signatures) ([core/memory/l1/README.md](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/core/memory/l1/README.md)); **L2 = cross-task policy induction** triggered by `reward.updated` events through a candidate pool ("when you see X, do Y; verify Z") ([core/memory/l2/README.md](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/core/memory/l2/README.md)); **L3 = world-model abstraction** (environment topology / inference rules / taboos), "deliberately cross-task… a single episode never produces an L3 row" ([core/memory/l3/README.md](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/core/memory/l3/README.md)); plus a skill crystallizer [V].

**Known issues (process class):** [#1929](https://github.com/MemTensor/MemOS/issues/1929) — "`/api/v1/embeddings/maintenance` causes 100% CPU and event loop starvation on large corpora" [V]; [#2359](https://github.com/MemTensor/MemOS/pull/2359) activation KV cache growth (above) [V]; [#2402](https://github.com/MemTensor/MemOS/pull/2402) — "stop retaining retrieval payloads across mem_update" (memory leak in the scheduler) [V]; [#2512](https://github.com/MemTensor/MemOS/pull/2512) — scheduler `enhanced_mem_ids` misaligned with filtered mem_group [V]; [#1911](https://github.com/MemTensor/MemOS/pull/1911) — "stop bridge subprocess leak — share one bridge client per host process" [V]; [#1546](https://github.com/MemTensor/MemOS/pull/1546) — "prevent orphan episode scan from closing active sessions" [V]; [#2538](https://github.com/MemTensor/MemOS/issues/2538) — dsh session-format mismatch makes every turn fail [V].

```
 full stack:                       local plugin (the Unown-shaped one):
 ┌──────────────────────┐          ┌────────────────────────────────────────┐
 │ FastAPI :8000        │          │ agent host (openclaw/dsh/hermes)       │
 │ MOSCore (Lock)       │          │  in-process TS adapter │ JSON-RPC      │
 │  ├─ MemScheduler    │          ├────────────────────────┴───────────────┤
 │  │  AutoDroppingQ ─► │          │ server/ (HTTP /api /events + viewer)  │
 │  │  dispatcher (30   │          │ bridge.cts (JSON-RPC daemon)          │
 │  │  threads/label)   │          │ supervisor: KeepAlive restart         │
 │  │  ├ Redis/RabbitMQ │          │ core/: L1 traces (SQLite) → L2        │
 │  │  ├ monitors       │          │  policies (reward.updated) → L3       │
 │  │  └ dead-letter    │          │  world model → skills                 │
 │  ├─ ActivationMemory │          │ better-sqlite3 + FTS5 + brute vectors │
 │  │  (KV cache, hot)  │          │ ports: 18799/18800/18801              │
 │  └─ MemCubes         │          └────────────────────────────────────────┘
 │   Neo4j + Qdrant(+MySQL)
 └──────────────────────┘
```

**Better than our engine:** a genuine scheduler process model — bounded queues **with** dead-lettering, per-label thread pools, monitors, and a status tracker; the hot tier as an actual KV-cache prefix (a different league of "hot" than Markdown injection); the L1→L2→L3 ladder with reward-gated induction is the richest published consolidation semantics; the local plugin proves the per-agent SQLite daemon + supervisor + well-known-port pattern at production beta.

**Worse:** the full stack needs Neo4j+Qdrant(+MySQL, +Redis/RabbitMQ) — five stateful systems for one memory service; thread-based concurrency has produced exactly the leak/starvation bugs our single-writer design avoids (#2402, #1929); the 2.0 restructure (memos → packages/src/apps) is high-churn; the local plugin's port-per-agent scheme breaks the "one engine, many projects" model Unown chose.

---

## Quick dives: LangMem, Memobase, A-MEM

### LangMem (`langchain-ai/langmem` @ `48e3c11`)

Library over the LangGraph `BaseStore` (Postgres or in-memory). Its interesting part is the **two background executors** ([src/langmem/reflection.py](https://github.com/langchain-ai/langmem/blob/main/src/langmem/reflection.py)) [V]:

- `LocalReflectionExecutor`: a **non-daemon `threading.Thread`** worker over a `queue.PriorityQueue` honoring `after_seconds` (deferred scheduling), returning a `Future` per submit, and — the notable semantics — **submitting again for the same `thread_id` cancels the still-pending task** (`existing.cancel_event.set(); existing.future.cancel()`): built-in debounce per conversation [V].
- `RemoteReflectionExecutor`: submits to a **LangGraph Server** run (`client.runs.create(..., after_seconds=…, multitask_strategy="rollback")`) — the background lane can be an entirely separate deployment with its own queue and rollback semantics [V].

Issues: [#196](https://github.com/langchain-ai/langmem/issues/196) — "MemoryStoreManager.invoke() reports success when store writes or deletes fail" (silent failure in the hot path) [V]; [#198](https://github.com/langchain-ai/langmem/issues/198)/[#197](https://github.com/langchain-ai/langmem/pull/197) — `query_limit` above the store default ignored [V]; [#192](https://github.com/langchain-ai/langmem/issues/192) — `enable_deletes` docstring/signature mismatch [V]; [#202](https://github.com/langchain-ai/langmem/issues/202) — a public audit of "what LangMem leaves after a deletion" [V].

### Memobase (`memodb-io/memobase` @ `358c16b`)

A **server-first** design: FastAPI + **Postgres (pgvector pg17)** + **Redis 7.4** via docker-compose, Alembic migrations, plus an MCP server and client SDKs ([src/server/](https://github.com/memodb-io/memobase/tree/main/src/server)) [V]. Write path: chat events land in a **`buffer_zone` table (status `idle → processing`)**; background **`flush_buffer_by_ids_in_background`** batches buffer rows into general blobs and extracts **profiles**, guarded by **Redis distributed locks per `(project, user, scope)`** with a Lua check-and-delete script, and Redis queues of buffer ids ([controllers/buffer_background.py](https://github.com/memodb-io/memobase/blob/main/src/server/api/memobase_server/controllers/buffer_background.py)) [V]. Issues: [#77](https://github.com/memodb-io/memobase/issues/77) — "Chats Lost from general_blobs and buffer_zones After LLM Call Failure During Profile Extraction" (buffer rows stranded `processing` — the stuck-state failure mode) [V]; [#109](https://github.com/memodb-io/memobase/issues/109) — "Randomly Fails to Retain New Information" [V]; [#86](https://github.com/memodb-io/memobase/issues/86) — docker API container exit 139 [V].

### A-MEM (`agiresearch/A-mem` @ `ceffb86`)

Research code, single process, no server, no background: `AgenticMemorySystem` (727 lines) + ChromaDB (`chromadb.Client(Settings(allow_reset=True))`, SentenceTransformer embedding function, `cosine_similarity` from sklearn for the evolution/linking passes) ([agentic_memory/memory_system.py](https://github.com/agiresearch/A-mem/blob/main/agentic_memory/memory_system.py), [agentic_memory/retrievers.py](https://github.com/agiresearch/A-mem/blob/main/agentic_memory/retrievers.py)) [V]. Memory evolution = re-tagging/linking historical notes on new inserts, computed inline [V]. No issue tracker depth (academic repo); the parent page's feature-level coverage stands.

---

## Comparative synthesis table

| | **Process model** | **Write path** | **Background consolidation** | **Durability** | **Crash/restart behavior** | **Install** |
|---|---|---|---|---|---|---|
| **Letta V1 (archive)** | 1 Python proc: uvicorn+FastAPI :8283; SyncServer singleton; optional multi-worker + Redis Streams | agent messages → tools write memory **blocks** (optimistic-lock `version`, append-only `block_history`) | sleeptime agent = 2nd agent sharing blocks; every 5th turn, cursor'd, `Run` row + fire-and-forget `asyncio.create_task` (strong-ref set) | Postgres/pgvector default (SQLite dev); 167 Alembic migrations | sleep runs die with process; Run rows orphan (no recovery sweep found); client retries 2× w/ backoff | pip/pipx/docker (redis+pgvector compose) |
| **Letta current (letta-code)** | Bun TS CLI + in-proc WebSocket App Server (ws://, token auth); cron for channels; dreaming POSTs to server-side queue | MemFS git repo (docs, prior page) | server-side dream runs (`{status:"queued", run_id}`) + worktree subagents | git + cloud; TS `dist/memory-confinement` governance modules | CLI/server split like ours; KeepAlive-ish supervision not observed in-tree | npm `-g @letta-ai/letta-code` (bundles runtime) |
| **Mem0 OSS** | in-process library (sync + async twins); optional FastAPI self-host wrapping a singleton `Memory()` | `add()` → 8-phase V3 pipeline (single ADD-only LLM extraction, MD5 dedup vs top-10, batch insert, entity links) | **none** (platform-only Dream) | vector store (30+ adapters; TS default better-sqlite3 brute-force) + SQLite history DB + entity store | close() races writes (#7440); no jobs to lose because nothing is queued | pip/npm; server via docker compose (pg17) |
| **Cognee** | async library + FastAPI + **embedded DBs in child processes** (Kuzu/LanceDB workers w/ respawn) | `add()` → SQLite docs; `cognify()` Task pipelines (chunk→graph→provenance), rollback handler | `run_in_background=True` → anchored asyncio task + in-memory run-info queues; drain registry on shutdown; filelock run ownership; debounced session improve | SQLite + Kuzu files + LanceDB files (all embedded); Alembic | run-ownership filelocks prove dead writers → recovery; queued-but-unstarted pipelines lost; compose grace 15s > drain 8s | uv/pip native; docker compose optional |
| **Graphiti** | async library; optional FastAPI graph-service + MCP (reference only, no auth) | `add_episode()` fully awaited: extract→resolve→edges→bi-temporal invalidate→episodic edges (+sagas) | caller's job; sample = 1 asyncio.Queue worker, 202 Accepted; MCP got retry+dead-letter | external graph DB (Neo4j/Falkor/Neptune/Kuzu) + embeddings + cross-encoder | in-memory queue loses acked jobs (#1707); Redis Streams RFC closed (#1177) | pip + docker (neo4j compose) |
| **MemOS full** | FastAPI :8000 + MemScheduler: 30-thread dispatcher, per-label pools, AutoDroppingQueue, Redis/RabbitMQ optional, monitors, dead-letter | messages → scheduler → MemCube writes (Neo4j+Qdrant); activation KV hot tier updated periodically | scheduler lanes + dead-letter quarantine + status tracker; NL feedback correction | Neo4j + Qdrant (+MySQL ORM); helm chart | thread leaks/starvation bugs fixed in public (#2402, #1929); bridge subprocess leak (#1911) | docker compose (3 containers +) |
| **MemOS local plugin** | **per-agent TS daemon**: HTTP server + JSON-RPC bridge + supervisor KeepAlive; well-known ports 18799/18800/18801 | capture pipeline → SQLite traces (L1) → reward backprop → L2 policies → L3 world model → skills | event-bus subscribers per tier (async, failures logged as `l2.failed`, never bubble) | better-sqlite3 + FTS5 + brute-force vectors + SQL migrations | supervisor restarts daemon; orphan-episode scan bugs fixed publicly (#1546) | npm plugin per host agent |
| **LangMem** | library; LocalReflectionExecutor = thread + PriorityQueue (+debounce-by-cancel) or Remote = LangGraph Server runs | hot-path tools + background manager → LangGraph BaseStore (Postgres) namespaces | thread executor w/ `after_seconds` + per-thread cancel; remote runs w/ rollback strategy | Postgres via LangGraph store | executor reports success on store failure (#196) | pip (LangChain ecosystem) |
| **Memobase** | server-first: FastAPI + Postgres + Redis | buffer_zone (idle→processing) → background flush by ids → blobs → profiles | Redis locks (Lua) + Redis queues per (project,user,scope) | Postgres/pgvector + Redis; Alembic | LLM failure strands buffer rows (#77) | docker compose |
| **A-MEM** | single-process research library | notes → ChromaDB; evolution re-tags/links historical notes inline | none | ChromaDB persistent dir | n/a | pip (academic) |
| **Unown (today)** | detached Bun daemon :3030, REST+SSE, single SQLite writer, router mutex + 20-min watchdog, budget governor, ping-and-spawn | notes → POST/outbox → AutoDream (quarantine → ADD-extract → reconcile → render) → 4-tier Markdown | gated event+schedule dreams; cooldown; outbox; `markDreamed` only on success | SQLite WAL + memory files + event stream; versions/rollback | crash → outbox holds, `recoverOrphans` heals, watchdog frees mutex; budget stops runaway | one bun binary, two entry points |

---

## Top 10 transferable architecture lessons for the detached bun engine

1. **Anchor every fire-and-forget task; make shutdown drain them by name.** Cognee's `background_tasks.py` registry + `wait_for_background_tasks(timeout)` (and its in-code citation of the gc-collects-in-flight-task bug, #4312) is the minimal, correct version of what our SIGTERM drain does — one module, one set, one drain entry point, called from the HTTP lifespan *and* exportable for scripts. (`cognee/infrastructure/background_tasks.py`)
2. **A bounded queue is only honest if drops are dead-lettered.** MemOS's `AutoDroppingQueue` + poisoned-message quarantine PR (#2403), Graphiti's 202-then-drop failure (#1707) and its MCP retry/dead-letter fix (#1915/#1992) all say the same thing: every dropped/failed job must leave a queryable record with a retry count. Our outbox should grow an explicit `state` + `attempts` + `last_error` — a `dead` state, not a silent vanish.
3. **Prove "the writer died" with OS file locks, not heartbeats.** Cognee's `run_ownership.py` — a `filelock` per pipeline run, aged runs recoverable by acquiring the lock — is a cheaper and more robust `recoverOrphans` than row-state guessing. Worth adopting for engine jobs and dream runs, especially the "second engine on the same data dir" hazard.
4. **Isolate crash-prone native code in a watched child process.** Cognee runs Kuzu and LanceDB in subprocess workers with respawn + setup-RPC replay because embedded native DBs segfault. Our ONNX embedder is the same risk class inside the Bun process: a native-module crash kills the whole engine today. A tiny "embedder worker" with respawn would contain it.
5. **Optimistic-lock versions + append-only history on memory rows.** Letta's `block.version` (SQLAlchemy `version_id_col`) + `block_history` sequence table gives race detection *and* per-item audit in SQL. If we ever allow a second writer (dashboard edits, teammate import), this is the pattern — and it makes `memory_versions` diffs cheap to render.
6. **Gate background consolidation on usage frequency + a cursor, not just timers.** Letta fires sleep agents every 5th turn with a `last_processed_message_id` cursor; LangMem debounces per-thread with cancel-events; our `PI_DREAM_CHECK_MIN_NOTES=3` + cooldown is the same species. The cursor is the part to steal: the dream should record "consumed through note X" so a partial dream never re-reads everything.
7. **Client contract: typed errors, bounded retries with backoff, and a durable fallback.** Letta's generated client (2 retries, Retry-After, exponential backoff, typed exceptions) is the industry baseline; our agent→engine path (4s timeout → outbox file) is stronger on durability, weaker on protocol hygiene — add the retry/backoff layer in front of the outbox so transient engine restarts don't hit files.
8. **Readiness/drain lifecycle with arithmetic that's pinned in deployment config.** Letta's `warming → ready → draining` states and Cognee's compose comment ("stop_grace_period must exceed drain timeout + WAL checkpoint — raise BOTH together") are the exact discipline our `POST /api/shutdown` + launcher scripts need: the drain budget should be a named constant echoed in every deployment artifact, and `/api/health` should expose the phase.
9. **The per-agent SQLite daemon is validated — twice.** MemOS's local plugin (better-sqlite3 + FTS5 + brute-force vectors + supervisor KeepAlive + well-known ports) and Supermemory's SMFS (parent page) both shipped the "detached memory daemon over SQLite" shape. Our differentiators to keep: one engine for many projects (their port-per-agent fragments memory), budget governor (nobody else has one), and the file outbox (only we survive *both* sides being down).
10. **Store typed tiers and review lanes in the data model, not the render.** Every system with real consolidation semantics got there structurally: MemOS L1/L2/L3 + reward-gated induction + archived versions with temporal snapshots; LangMem semantic/episodic/procedural + profiles; Graphiti bi-temporal `invalid_at`. The transferable move for us is per-bullet metadata (`type`, `event_time`, `superseded_by`, `attempts`) in SQLite now, so supersede-with-provenance, typed decay, and a review queue (parent-page opportunities #1–#3) become queries instead of migrations.

**Runners-up worth a spike:** request-scoped engine clients per project to make cross-scope clobbering structurally impossible (Graphiti's fix for #1676); "only persisted records count as success" + "extraction failure raises" as named invariants in our dream tests (Mem0's two most recent durability fixes); Cognee's `cognify_rollback_handler` — an ingest that can unwind itself; Letta-code's `process-identity.ts` for cron (who owns a scheduled job across CLI restarts — the same problem our automations scheduler solved with the engine DB).

---

## Corrections register

- 2026-10-26 — first edition (task RESEARCH-2). All claims [V] unless marked; pinned SHAs in the method table. Two absences of evidence are stated as such: no Letta-V1 startup sweep for orphaned `Run` rows was found (checked `server.py` + `run_manager.py`), and LangMem/A-MEM issue depth is thin because their trackers are small. Letta's main-branch README (fetched 2026-10-26, commit `8816d3a`) is the authority for "V1 retired, source moved to letta-code"; the archive branch (v0.16.7) is the last V1 code and therefore the right place to read the FastAPI/sleeptime architecture the task asked about. Line numbers intentionally omitted from citations (they drift); file paths + symbols are stable at the pinned SHAs.
