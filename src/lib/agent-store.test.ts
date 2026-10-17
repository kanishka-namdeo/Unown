// Unit tests for src/lib/agent-store.ts (zustand SSE activity store).
//
// Backlog reference: docs/testing-strategy.md §4.1 asks for coverage of the
// activity store's cap (60 items), prepend ordering (newest first),
// `lastEventAt` bookkeeping and `clear()`.
//
// Strategy — no new dependencies, `bun test` only (bun:test is built in):
// zustand stores are module singletons, so instead of instantiating a fresh
// store per test we reset the shared state in `beforeEach` via
// `useActivityStore.setState` (actions survive the merge). The source module
// is not modified here.
//
// A few assertions pin down *quirks* rather than ideal behavior; each is
// marked with a `QUIRK`/`BUG` comment. They document current behavior so a
// future fix is a deliberate, visible change.

import { beforeEach, describe, expect, test } from "bun:test"

import { useActivityStore } from "./agent-store"
import type { ActivityItem } from "./agent-types"

// Fresh state before every test (store singleton: reset items/connected/lastEventAt).
beforeEach(() => {
  useActivityStore.setState({ items: [], connected: false, lastEventAt: null })
})

function item(key: string, ts: number): ActivityItem {
  return { key, ts, event: "run:started", text: `run ${key}`, tone: "zinc" }
}

describe("initial state", () => {
  test("empty feed, disconnected, no lastEventAt", () => {
    const s = useActivityStore.getState()
    expect(s.items).toEqual([])
    expect(s.connected).toBe(false)
    expect(s.lastEventAt).toBeNull()
  })
})

describe("push", () => {
  test("prepends: the newest event lands first", () => {
    const { push } = useActivityStore.getState()
    push(item("a", 100))
    push(item("b", 200))
    push(item("c", 300))
    expect(useActivityStore.getState().items.map((i) => i.key)).toEqual(["c", "b", "a"])
  })

  test("pushed items are stored verbatim (no copying/normalizing)", () => {
    const it = item("a", 100)
    useActivityStore.getState().push(it)
    expect(useActivityStore.getState().items[0]).toBe(it)
  })

  test("lastEventAt tracks the ts of the most recent push", () => {
    const { push } = useActivityStore.getState()
    push(item("a", 1_000))
    expect(useActivityStore.getState().lastEventAt).toBe(1_000)
    push(item("b", 2_000))
    expect(useActivityStore.getState().lastEventAt).toBe(2_000)
  })

  test("QUIRK: lastEventAt follows push order, not max ts — a late-arriving older event moves it backwards", () => {
    // SSE frames normally arrive in order, but a reconnect can deliver an
    // older replayed event after a newer one; the store blindly overwrites
    // lastEventAt with the pushed item's ts.
    const { push } = useActivityStore.getState()
    push(item("new", 5_000))
    push(item("old-replay", 1_000))
    expect(useActivityStore.getState().lastEventAt).toBe(1_000)
  })

  test("push does not touch the connection flag", () => {
    useActivityStore.getState().setConnected(true)
    useActivityStore.getState().push(item("a", 100))
    expect(useActivityStore.getState().connected).toBe(true)
  })

  test("caps the feed at 60 items, evicting the oldest", () => {
    const { push } = useActivityStore.getState()
    for (let i = 1; i <= 65; i++) push(item(`k${i}`, i))
    const s = useActivityStore.getState()
    expect(s.items).toHaveLength(60)
    expect(s.items[0]?.key).toBe("k65") // newest survives at the head
    expect(s.items[59]?.key).toBe("k6") // 60th-newest is the tail
    // the five oldest (k1..k5) were evicted
    expect(s.items.map((i) => i.key)).not.toContain("k5")
    expect(s.items.map((i) => i.key)).not.toContain("k1")
  })

  test("exactly 60 items are all retained (cap boundary)", () => {
    const { push } = useActivityStore.getState()
    for (let i = 1; i <= 60; i++) push(item(`k${i}`, i))
    const s = useActivityStore.getState()
    expect(s.items).toHaveLength(60)
    expect(s.items[0]?.key).toBe("k60")
    expect(s.items[59]?.key).toBe("k1")
  })

  test("lastEventAt keeps updating after the cap is reached", () => {
    const { push } = useActivityStore.getState()
    for (let i = 1; i <= 65; i++) push(item(`k${i}`, i))
    expect(useActivityStore.getState().lastEventAt).toBe(65)
  })
})

describe("setConnected", () => {
  test("toggles connection state", () => {
    const { setConnected } = useActivityStore.getState()
    setConnected(true)
    expect(useActivityStore.getState().connected).toBe(true)
    setConnected(false)
    expect(useActivityStore.getState().connected).toBe(false)
  })

  test("does not touch items or lastEventAt", () => {
    useActivityStore.getState().push(item("a", 123))
    useActivityStore.getState().setConnected(true)
    const s = useActivityStore.getState()
    expect(s.items).toHaveLength(1)
    expect(s.lastEventAt).toBe(123)
  })
})

describe("clear", () => {
  test("empties the feed", () => {
    const s0 = useActivityStore.getState()
    s0.push(item("a", 100))
    s0.push(item("b", 200))
    expect(useActivityStore.getState().items).toHaveLength(2)
    useActivityStore.getState().clear()
    expect(useActivityStore.getState().items).toEqual([])
  })

  test("QUIRK: clear() resets only items — lastEventAt and connected survive", () => {
    // clear() is `set({ items: [] })`: the "when did I last see an event"
    // timestamp and the SSE connection flag deliberately (or at least
    // consistently) outlive the cleared list. Pinned as-is; change requires a
    // product decision (e.g. should the header's "last event" indicator blank
    // out when the feed is cleared?).
    const s0 = useActivityStore.getState()
    s0.push(item("a", 1234))
    s0.setConnected(true)
    s0.clear()
    const s = useActivityStore.getState()
    expect(s.items).toEqual([])
    expect(s.lastEventAt).toBe(1234)
    expect(s.connected).toBe(true)
  })

  test("the store stays usable after clear()", () => {
    const s0 = useActivityStore.getState()
    s0.push(item("old", 1))
    s0.clear()
    useActivityStore.getState().push(item("fresh", 2))
    const s = useActivityStore.getState()
    expect(s.items.map((i) => i.key)).toEqual(["fresh"])
    expect(s.lastEventAt).toBe(2)
  })
})
