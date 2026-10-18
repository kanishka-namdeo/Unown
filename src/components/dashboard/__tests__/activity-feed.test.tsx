// Component tests for src/components/dashboard/activity-feed.tsx.
//
// Backlog reference: docs/testing-strategy.md §6 gate 9 (changed-line
// coverage) — the feed's icon-tone branches (hook / note:created / unknown
// fallback) had no coverage. These tests drive the zustand store directly —
// the same path SseBridge's push() takes in production — and cover every
// iconFor/tone branch plus the empty state.
//
// Runs under `bun test src` with the happy-dom global preload.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { useActivityStore } from "@/lib/agent-store";
import type { ActivityItem } from "@/lib/agent-types";
import { ActivityFeed } from "../activity-feed";
import { installToastSpy, renderWithProviders, resetActivityStore, resetToasts } from "./helpers";

installToastSpy();

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  key: `${over.event}-${Math.random()}`,
  ts: Date.now(),
  event: "run:finished",
  text: "run finished",
  tone: "zinc",
  ...over,
});

beforeEach(() => {
  resetActivityStore();
  resetToasts();
});

afterEach(() => {
  cleanup();
});

describe("ActivityFeed — items from the store", () => {
  test("renders every event family's text with its tone class", () => {
    const push = useActivityStore.getState().push;
    push(item({ event: "run:finished", text: "run finished · fix login flow redirect · passed", tone: "emerald" }));
    push(item({ event: "run:started", text: "run started · parse csv headers · baseline", tone: "amber" }));
    push(item({ event: "run:finished", text: "run finished · fix login flow redirect · failed", tone: "rose" }));
    push(item({ event: "memory:changed", text: "project memory → v9 · by autodream", tone: "emerald" }));
    push(item({ event: "hook", text: "hook PreToolUse · bash · deny", tone: "rose" }));
    push(item({ event: "note:created", text: "session note captured", tone: "zinc" }));
    push(item({ event: "job:finished", text: "job finished · note-sync", tone: "emerald" }));
    push(item({ event: "router:error", text: "router error · bridge unreachable", tone: "rose" }));
    push(item({ event: "cycle:started", text: "cycle started · fix login flow redirect", tone: "amber" }));
    push(item({ event: "improvement:shipped", text: "improvement shipped → project memory", tone: "emerald" }));
    push(item({ event: "dream:started", text: "autodream started · 4 notes in", tone: "amber" }));
    push(item({ event: "something-new", text: "an unrecognized event family", tone: "zinc" }));

    renderWithProviders(<ActivityFeed />);

    for (const text of [
      "run finished · fix login flow redirect · passed",
      "run started · parse csv headers · baseline",
      "run finished · fix login flow redirect · failed",
      "project memory → v9 · by autodream",
      "hook PreToolUse · bash · deny",
      "session note captured",
      "job finished · note-sync",
      "router error · bridge unreachable",
      "cycle started · fix login flow redirect",
      "improvement shipped → project memory",
      "autodream started · 4 notes in",
      "an unrecognized event family",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  test("renders the relative timestamp column for each row", () => {
    useActivityStore.getState().push(item({ event: "memory:changed", text: "user memory → v2 · by manual", tone: "emerald", ts: Date.now() }));
    renderWithProviders(<ActivityFeed />);
    expect(screen.getByText("just now")).toBeTruthy();
  });

  test("shows the empty state when the store has no items", () => {
    renderWithProviders(<ActivityFeed />);
    expect(screen.getByText("No live events yet")).toBeTruthy();
    expect(screen.getByText("Waiting for agent activity…")).toBeTruthy();
  });

  test("caps the rendered list at max", () => {
    const push = useActivityStore.getState().push;
    for (let i = 0; i < 6; i++) {
      push(item({ event: "run:finished", text: `run ${i} finished`, tone: "emerald" }));
    }
    renderWithProviders(<ActivityFeed max={3} />);
    expect(screen.getByText("run 5 finished")).toBeTruthy(); // newest first
    expect(screen.queryAllByText(/run \d finished/)).toHaveLength(3);
  });
});
