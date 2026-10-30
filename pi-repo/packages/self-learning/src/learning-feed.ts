/**
 * learning-feed.ts — the ambient learning feed: what Unown learned, live.
 *
 * The observability round (audit flag D1, E8, E9): the learning story —
 * dreams shipped, improvements landed, notes consumed — lives entirely
 * behind the dashboard door; a user in a session sees one transient toast
 * per dream and nothing else. The five personas all asked for the same
 * thing: ambient learning signals with a cheap drill-in.
 *
 * Data sources (all existing, none new — the feed composes, it does not
 * add engine load):
 *
 *   - dreamNews — the engine-status probe already carries the newest
 *     project dream (the "✦ AutoDream learned N new rules" toast lane);
 *   - memory bar transitions — the probe already reads the project's
 *     memory version from disk (readMemoryBarInfo); a version bump is a
 *     learning event;
 *   - /api/overview counts — diffed at a slow cadence (default 5 min,
 *     only while the engine is up): improvements shipped, dreams done,
 *     notes consumed. /api/overview costs an engine-side scan, so the
 *     feed NEVER rides the 30s probe with it.
 *
 * Surfaces: the mission panel's ✦ line (events < 10 min old), a footer
 * chip while unsee events exist, /feed for the drill-in card, and the
 * brief's "learned:" line (events inside the away window).
 *
 * Pure module: no pi imports, no fs, no network — the fetcher is injected.
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type FeedEventKind = "dream" | "memory" | "improvement" | "notes" | "skill";

export interface FeedEvent {
        kind: FeedEventKind;
        /** One compact line, already phrased for the panel/chip surfaces. */
        text: string;
        ts: number;
}

/** How many events the ring keeps (the feed is a recent-memory surface, not a log). */
export const FEED_MAX = 50;

// ---------------------------------------------------------------------------
// The process-wide singleton
// ---------------------------------------------------------------------------

// One terminal process hosts one foreground session (the same soundness
// argument the todo bridge and the engine-status loop's in-memory latches
// use). The engine loop's hooks (termhooks.ts) push into it from whichever
// extension observes the transition; tools.ts reads it for the panel, the
// chip, /feed and the brief. Process lifetime — events are engine-side
// learning facts, not session state, so they survive /new|resume|fork.
let shared: LearningFeed | null = null;

export function getLearningFeed(): LearningFeed {
        if (!shared) shared = new LearningFeed();
        return shared;
}

// A push-listener so AMBIENT surfaces repaint the moment an event lands.
// The OB-5 live lane found the gap: events pushed from the engine-status
// loop (dream news, memory versions) landed in the ring but the footer
// chip only painted at the next turn boundary — an idle session learned
// in silence. tools.ts registers refreshObservability here; the listener
// is cleared at shutdown and is always optional (no listener = no crash).
type FeedListener = () => void;
let listener: FeedListener | null = null;

export function setLearningFeedListener(fn: FeedListener | null): void {
        listener = fn;
}

/** A dream older than this is no longer news (engine-status.ts DREAM_NEWS_MAX_AGE_MS). */
export const FEED_FRESH_MS = 3_600_000;

/** Events younger than this ride the mission panel's ✦ line. */
export const PANEL_FRESH_MS = 10 * 60_000;

/**
 * The ring buffer. push() dedupes consecutive identical texts inside a
 * 60s window (the probe cadence can see the same dream twice) and trims to
 * FEED_MAX newest. All mutations are local — one session, one feed.
 */
export class LearningFeed {
        private events: FeedEvent[] = [];

        push(event: FeedEvent, now: number = Date.now()): void {
                const last = this.events[this.events.length - 1];
                if (last && last.text === event.text && now - last.ts < 60_000 && last.kind === event.kind) return;
                this.events.push(event);
                if (this.events.length > FEED_MAX) this.events = this.events.slice(-FEED_MAX);
                try {
                        listener?.();
                } catch {
                        /* a listener must never break a push */
                }
        }

        /** All events, oldest first. */
        all(): FeedEvent[] {
                return [...this.events];
        }

        /** Events inside the trailing window, newest first (the brief + /feed). */
        recent(withinMs: number, now: number = Date.now()): FeedEvent[] {
                return this.events.filter((e) => now - e.ts <= withinMs).reverse();
        }

        /** True when at least one event is newer than `sinceTs` (the unseen latch). */
        hasSince(ts: number): boolean {
                return this.events.some((e) => e.ts > ts);
        }
}

// ---------------------------------------------------------------------------
// The overview diff
// ---------------------------------------------------------------------------

/** The subset of /api/overview the feed tracks (additive — extra fields ignored). */
export interface OverviewCounts {
        improvementsShipped?: number;
        dreamsDone?: number;
        notesPending?: number;
}

/**
 * Diff two overview snapshots into events (pure). Every diff requires BOTH
 * sides present — a field missing on either side is "unknown", never zero,
 * so a partial probe response can never fabricate "an improvement was
 * un-shipped". Decreases in notesPending are consumption (learning
 * happened); increases are not events (notes queue silently — the engine
 * footer already narrates the queue).
 */
export function diffOverviewCounts(
        prev: OverviewCounts | null,
        next: OverviewCounts | null,
        now: number = Date.now(),
): FeedEvent[] {
        if (!prev || !next) return [];
        const events: FeedEvent[] = [];
        if (typeof prev.improvementsShipped === "number" && typeof next.improvementsShipped === "number") {
                const delta = next.improvementsShipped - prev.improvementsShipped;
                if (delta > 0) {
                        events.push({
                                kind: "improvement",
                                text: `harness shipped ${delta} improvement${delta === 1 ? "" : "s"} (memory patch verified twice)`,
                                ts: now,
                        });
                }
        }
        if (typeof prev.dreamsDone === "number" && typeof next.dreamsDone === "number") {
                const delta = next.dreamsDone - prev.dreamsDone;
                if (delta > 0)
                        events.push({
                                kind: "dream",
                                text: `AutoDream completed ${delta} consolidation${delta === 1 ? "" : "s"}`,
                                ts: now,
                        });
        }
        if (typeof prev.notesPending === "number" && typeof next.notesPending === "number") {
                const delta = next.notesPending - prev.notesPending;
                if (delta < 0) {
                        const consumed = -delta;
                        events.push({
                                kind: "notes",
                                text: `${consumed} session note${consumed === 1 ? "" : "s"} consolidated into memory`,
                                ts: now,
                        });
                }
        }
        return events;
}

/** Lift the counts out of a raw /api/overview body (defensive — malformed is null). */
export function overviewCountsOf(body: unknown): OverviewCounts | null {
        if (!body || typeof body !== "object") return null;
        // The engine nests the counters under `kpis` (`improvementsShipped`,
        // `dreams`) and `notes.pending` — verified against the live engine in
        // the round's dogfood pass: a first draft read flat top-level keys and
        // the 5-minute diff saw nothing (pinned by the shape test).
        const raw = body as Record<string, unknown>;
        const kpis = raw.kpis as Record<string, unknown> | undefined;
        const notes = raw.notes as Record<string, unknown> | undefined;
        const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
        const counts: OverviewCounts = {
                improvementsShipped: num(kpis?.improvementsShipped),
                dreamsDone: num(kpis?.dreams),
                notesPending: num(notes?.pending),
        };
        if (
                counts.improvementsShipped === undefined &&
                counts.dreamsDone === undefined &&
                counts.notesPending === undefined
        ) {
                return null;
        }
        return counts;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatAge(ageMs: number): string {
        const s = Math.max(0, Math.floor(ageMs / 1000));
        if (s < 60) return "just now";
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
}

/**
 * The /feed card — newest first, ages inline, the data sources named at
 * the bottom (where the numbers come from is part of the trust contract).
 * An empty feed says so honestly and points at what would fill it (the
 * dashboard's Dreams screen — the deep surface stays the deep surface).
 */
export function renderFeedCard(events: FeedEvent[], now: number = Date.now()): string {
        if (events.length === 0) {
                return [
                        "learning feed — nothing yet this session",
                        "  events land here as AutoDream consolidates notes, the harness ships",
                        "  improvements, or memory versions advance.",
                        "deep view: /dashboard (Dreams · Learning Lab · Memory)",
                ].join("\n");
        }
        const lines: string[] = [`learning feed — ${events.length} event${events.length === 1 ? "" : "s"} this session`];
        const newestFirst = [...events].sort((a, b) => b.ts - a.ts);
        for (const event of newestFirst.slice(0, 12)) {
                lines.push(`  ✦ ${event.text} (${formatAge(now - event.ts)})`);
        }
        if (events.length > 12) lines.push(`  └ +${events.length - 12} earlier`);
        lines.push("deep view: /dashboard (Dreams · Learning Lab · Memory)");
        return lines.join("\n");
}

/**
 * The mission panel's ✦ line — the newest event younger than
 * PANEL_FRESH_MS, else null (the panel line never shows stale learning).
 */
export function freshLearnedLine(
        events: FeedEvent[],
        now: number = Date.now(),
        withinMs: number = PANEL_FRESH_MS,
): string | null {
        const fresh = events.filter((e) => now - e.ts <= withinMs).sort((a, b) => b.ts - a.ts)[0];
        return fresh ? fresh.text : null;
}

/**
 * The footer chip — non-empty only while unseen events exist, and the
 * drill-in command rides it: `✦ 3 learning events · /feed`.
 */
export function renderFeedChip(events: FeedEvent[], seenTs: number): string | undefined {
        const unseen = events.filter((e) => e.ts > seenTs).length;
        if (unseen === 0) return undefined;
        return `✦ ${unseen} learning event${unseen === 1 ? "" : "s"} · /feed`;
}

/** The brief's learned lines — events inside the away window (or recent, on demand). */
export function briefLearnedLines(events: FeedEvent[], withinMs: number, now: number = Date.now()): string[] {
        return events
                .filter((e) => now - e.ts <= withinMs)
                .sort((a, b) => b.ts - a.ts)
                .map((e) => `${e.text} (${formatAge(now - e.ts)})`);
}
