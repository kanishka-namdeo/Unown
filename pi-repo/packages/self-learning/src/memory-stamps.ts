/**
 * memory-stamps.ts — the PURE memory-stamp helpers (Memory Divertimento
 * round CP4, 2026-11-14), store-free by construction.
 *
 * Why a separate module: tools.ts (the TERMINAL agent's tools) needs
 * `memoryFreshnessStamp` for the /memory search provenance badges, but
 * importing it from memzero.ts would pull store.ts into the terminal
 * process — SQLite opening at module scope — violating the detached
 * contract (the terminal agent never opens the engine's database;
 * measured 0 fds). Everything here is pure: env reads + plain object
 * math, no fs, no store, no platform. memzero.ts re-exports the whole
 * surface so existing importers are unchanged; the definitions live HERE
 * and nowhere else (one truth, no mirrors).
 */
import type { PlatformMemory } from "./memzero.ts";

// ---------------------------------------------------- memory typing + decay
// The Memory v2 round (2026-11-12): the field has moved past "one memory type"
// — Supermemory's typed auto-forgetting (facts persist, preferences strengthen,
// episodes decay), MemOS's L1→L2→L3→skills tiering, and LangMem's
// semantic/episodic/procedural taxonomy all give each memory type a different
// decay policy. The type lives in metadata.type (default "fact" for backward
// compatibility — memories without a type tag behave as before).

/** The four memory types (LangMem's taxonomy + Supermemory's typed forgetting):
 *  - fact: a durable verifiable statement (versions, paths, schemas) — persists
 *    until superseded; the default for backward compatibility.
 *  - episode: a one-time event or transient observation — decays fastest.
 *  - procedure: a multi-step playbook that recurred — persists longest.
 *  - preference: a convention/style rule the user stated — strengthens with
 *    repetition, rarely stale. */
export type MemoryType = "fact" | "episode" | "procedure" | "preference";

/** The set of valid memory types (for validation / display). */
export const MEMORY_TYPES: readonly MemoryType[] = ["fact", "episode", "procedure", "preference"];

/** Read a memory's type (metadata.type, default "fact" for backward compat). */
export function memoryType(m: PlatformMemory): MemoryType {
        const t = String(m?.metadata?.type ?? "").trim().toLowerCase();
        return (MEMORY_TYPES as readonly string[]).includes(t) ? (t as MemoryType) : "fact";
}

/** The fact lane's stale-day horizon (PI_MEM0_STALE_DAYS, default 28; 0
 *  disables the marker while keeping the dates). */
export function mem0StaleDays(): number {
        const n = Number(process.env.PI_MEM0_STALE_DAYS ?? 28);
        return Number.isFinite(n) && n >= 0 ? n : 28;
}

/** The stale-day horizon for a memory type. Episodes decay fastest (default
 *  14d — one-time observations rarely help future sessions); facts persist
 *  until superseded (default 28d — the original horizon); procedures persist
 *  longest (default 90d — multi-step playbooks that recurred are high-value);
 *  preferences strengthen with repetition and rarely go stale (default 180d —
 *  a convention the user stated is durable instruction, not decayable
 *  observation). Each is overridable via PI_MEM0_STALE_DAYS_<TYPE>. */
export function mem0StaleDaysForType(type: MemoryType): number {
        const fallback = mem0StaleDays();
        const envKey = `PI_MEM0_STALE_DAYS_${type.toUpperCase()}`;
        const n = Number(process.env[envKey]);
        if (!Number.isFinite(n) || n < 0) {
                // per-type defaults: episode 14, fact 28 (the fallback), procedure 90, preference 180
                if (type === "episode") return Number(process.env.PI_MEM0_STALE_DAYS_EPISODE ?? 14) || 14;
                if (type === "procedure") return Number(process.env.PI_MEM0_STALE_DAYS_PROCEDURE ?? 90) || 90;
                if (type === "preference") return Number(process.env.PI_MEM0_STALE_DAYS_PREFERENCE ?? 180) || 180;
                return fallback;
        }
        return n;
}

// --------------------------------------------------------------- freshness
// The Memory Encore round (2026-11-12): every rendered memory bullet carries
// the date it was last confirmed (the mem0 updatedAt — an UPDATE verdict from
// a later dream rewrites it, so re-asserted evidence refreshes the date the
// way Copilot's re-store-on-verify does), and bullets older than the horizon
// are marked stale.

/** The memory's confirmed timestamp (ms) — the platform updatedAt (a later
 *  UPDATE rewrites it, so re-asserted evidence refreshes the date), or null
 *  when neither updatedAt nor createdAt parses (legacy/migrated rows; an
 *  unknown age must not render as a fake date, or a fake 1970-stale). */
export function memoryConfirmedAt(m: PlatformMemory): number | null {
        const ts = Date.parse(String(m?.updatedAt ?? m?.createdAt ?? ""));
        return Number.isFinite(ts) ? ts : null;
}

// ----------------------------------------------- bi-temporal supersede reads
// The Memory v2 round (2026-11-12): the loser of a contradiction is STAMPED
// (metadata.supersededBy + metadata.invalidAt) instead of deleted — retained
// for audit, excluded from recall by filterLatestOnly.

/** True when this memory has been superseded (carries metadata.supersededBy). */
export function isSuperseded(m: PlatformMemory): boolean {
        return Boolean(m?.metadata?.supersededBy);
}

/** The id of the memory that supersedes this one, or null when current. */
export function supersededById(m: PlatformMemory): string | null {
        const v = m?.metadata?.supersededBy;
        return v ? String(v) : null;
}

/** The invalidation timestamp (ms) of a superseded memory, or null. */
export function memoryInvalidAt(m: PlatformMemory): number | null {
        const ts = Date.parse(String(m?.metadata?.invalidAt ?? ""));
        return Number.isFinite(ts) ? ts : null;
}

/** Filter superseded memories out of a list (the `latest_only=true` search
 *  semantics — superseded memories stay in the store for audit but are
 *  excluded from recall by default). Memories without `supersededBy` metadata
 *  pass through unchanged (backward-compatible). */
export function filterLatestOnly(memories: PlatformMemory[]): PlatformMemory[] {
        return memories.filter((m) => !isSuperseded(m));
}

/**
 * The freshness stamp: the date a memory was last confirmed, `· stale` past
 * the per-type horizon, `· superseded` with the invalidation date when the
 * row carries the bi-temporal stamp. Deterministic (no Date.now inside —
 * `now` is a parameter), so renders stay idempotent: the same memory set
 * always renders byte-identical, and only an UPDATE (new evidence) moves
 * a date. Seeds and rows without a parseable timestamp render BARE — a
 * missing date is honest, a fake one is not.
 */
export function memoryFreshnessStamp(m: PlatformMemory, now: number = Date.now()): string {
        if (String(m?.metadata?.kind ?? "") === "seed") return "";
        if (isSuperseded(m)) {
                const inv = memoryInvalidAt(m);
                if (inv !== null) {
                        const date = new Date(inv).toISOString().slice(0, 10);
                        return `${date} · superseded`;
                }
                return "superseded";
        }
        const ts = memoryConfirmedAt(m);
        if (ts === null) return "";
        const days = mem0StaleDaysForType(memoryType(m));
        const stale = days > 0 && now - ts > days * 86_400_000;
        const date = new Date(ts).toISOString().slice(0, 10);
        return stale ? `${date} · stale` : date;
}
