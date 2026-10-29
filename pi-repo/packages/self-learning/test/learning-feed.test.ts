/**
 * learning-feed.test.ts — the observability round's ambient learning feed: the
 * ring buffer (dedupe + cap), the overview diff (improvements/dreams/notes),
 * the /feed card, the chip's unseen latch and the panel's fresh line.
 */
import { describe, expect, test } from "bun:test";
import {
        briefLearnedLines,
        diffOverviewCounts,
        LearningFeed,
        overviewCountsOf,
        renderFeedCard,
        renderFeedChip,
        freshLearnedLine,
} from "../src/learning-feed.ts";

const NOW = 1_700_000_000_000;

describe("LearningFeed — the ring", () => {
        test("push/recent/all with window filtering", () => {
                const feed = new LearningFeed();
                feed.push({ kind: "dream", text: "d1", ts: NOW - 30 * 60_000 });
                feed.push({ kind: "dream", text: "d2", ts: NOW - 60_000 });
                expect(feed.recent(5 * 60_000, NOW).map((e) => e.text)).toEqual(["d2"]);
                expect(feed.all().length).toBe(2);
        });
        test("consecutive identical texts inside 60s dedupe (probe cadence)", () => {
                const feed = new LearningFeed();
                feed.push({ kind: "dream", text: "same dream", ts: NOW }, NOW);
                feed.push({ kind: "dream", text: "same dream", ts: NOW + 30_000 }, NOW + 30_000);
                expect(feed.all().length).toBe(1);
        });
        test("the ring caps at FEED_MAX, newest kept", () => {
                const feed = new LearningFeed();
                for (let i = 0; i < 60; i++) feed.push({ kind: "notes", text: `e${i}`, ts: NOW + i });
                const all = feed.all();
                expect(all.length).toBe(50);
                expect(all[all.length - 1].text).toBe("e59");
        });
});

describe("diffOverviewCounts — both sides present or it is unknown, never zero", () => {
        test("shipped improvements and completed dreams become events", () => {
                const events = diffOverviewCounts(
                        { improvementsShipped: 2, dreamsDone: 5, notesPending: 3 },
                        { improvementsShipped: 3, dreamsDone: 6, notesPending: 3 },
                        NOW,
                );
                expect(events.some((e) => e.text.includes("shipped 1 improvement"))).toBe(true);
                expect(events.some((e) => e.text.includes("completed 1 consolidation"))).toBe(true);
        });
        test("consumed notes become events; queued notes do not", () => {
                const consumed = diffOverviewCounts({ notesPending: 4 }, { notesPending: 1 }, NOW);
                expect(consumed[0].text).toContain("3 session notes consolidated");
                const queued = diffOverviewCounts({ notesPending: 1 }, { notesPending: 4 }, NOW);
                expect(queued).toEqual([]);
        });
        test("a partial probe response fabricates nothing", () => {
                expect(diffOverviewCounts(null, { improvementsShipped: 9 }, NOW)).toEqual([]);
                expect(diffOverviewCounts({ dreamsDone: 1 }, null, NOW)).toEqual([]);
                expect(diffOverviewCounts({ improvementsShipped: 1 }, { dreamsDone: 2 }, NOW)).toEqual([]);
        });
        test("overviewCountsOf lifts only finite numbers", () => {
                expect(overviewCountsOf({ improvementsShipped: "3" })).toBeNull();
                expect(overviewCountsOf({ dreamsDone: 2 }).dreamsDone).toBe(2);
                expect(overviewCountsOf("junk")).toBeNull();
        });
});

describe("rendering — the card, the chip, the panel line, the brief lines", () => {
        test("an empty feed says so and points at the deep surface", () => {
                const card = renderFeedCard([], NOW);
                expect(card).toContain("nothing yet this session");
                expect(card).toContain("/dashboard");
        });
        test("the card lists newest first with ages", () => {
                const card = renderFeedCard(
                        [
                                { kind: "dream", text: "older", ts: NOW - 30 * 60_000 },
                                { kind: "memory", text: "newer", ts: NOW - 60_000 },
                        ],
                        NOW,
                );
                const lines = card.split("\n");
                expect(lines[1]).toContain("newer (1m ago)");
                expect(lines[2]).toContain("older (30m ago)");
        });
        test("the chip shows only unseen events and rides the command", () => {
                const events = [
                        { kind: "dream", text: "a", ts: NOW - 60_000 },
                        { kind: "dream", text: "b", ts: NOW + 1000 },
                ];
                expect(renderFeedChip(events, NOW)).toBe("✦ 1 learning event · /feed");
                expect(renderFeedChip(events, NOW + 2000)).toBeUndefined();
        });
        test("the panel's fresh line only within 10 minutes", () => {
                expect(freshLearnedLine([{ kind: "dream", text: "fresh", ts: NOW - 2 * 60_000 }], NOW)).toBe("fresh");
                expect(freshLearnedLine([{ kind: "dream", text: "stale", ts: NOW - 30 * 60_000 }], NOW)).toBeNull();
        });
        test("the brief lines carry ages and respect the window", () => {
                const lines = briefLearnedLines(
                        [
                                { kind: "dream", text: "in-window", ts: NOW - 60_000 },
                                { kind: "dream", text: "out", ts: NOW - 30 * 60_000 },
                        ],
                        5 * 60_000,
                        NOW,
                );
                expect(lines).toEqual(["in-window (1m ago)"]);
        });
});
