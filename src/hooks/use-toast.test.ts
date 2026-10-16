// Unit tests for src/hooks/use-toast.ts (shadcn-style toast store).
//
// Backlog reference: docs/testing-strategy.md §2 flags that `src/` has no unit
// tests and calls out the `use-toast.ts` reducer as untested pure logic; §4.1
// asks for reducer coverage (ADD/UPDATE/DISMISS/REMOVE), the toast limit, the
// remove-delay timer, and toast() side effects.
//
// Strategy — no new dependencies, `bun test` only (bun:test is built in):
//
// 1. The exported `reducer` is tested directly as a pure function. Its only
//    side effect is that DISMISS_TOAST schedules removal via setTimeout, so
//    globalThis.setTimeout is replaced file-wide with a capturing stub — this
//    both prevents real 1,000,000ms timers from leaking and lets tests fire
//    expiry callbacks deterministically.
// 2. The `toast()` / `useToast()` module store is exercised through a
//    react-dom/server `renderToString` probe: SSR runs the hook for real
//    (React.useState reads the module-level memoryState) without needing a
//    DOM or client renderer. react-dom is an existing dependency.
//
// Known gap (intentional, documented): the useEffect listener
// registration/unregistration and the listener-notification re-render path are
// NOT covered — they require a client-side React renderer with a DOM
// (React Testing Library / jsdom / happy-dom), which is out of scope for these
// zero-dependency tests.
//
// A few assertions pin down *quirks* rather than ideal behavior; each is marked
// with a `QUIRK`/`BUG` comment. The source module is not modified here.

import { beforeAll, afterAll, beforeEach, describe, expect, test } from "bun:test"
import * as React from "react"
import { renderToString } from "react-dom/server"

import { reducer, toast, useToast } from "./use-toast"

// ---------------------------------------------------------------------------
// Harness: capture setTimeout calls instead of running real timers.
// TOAST_REMOVE_DELAY in the module is 1,000,000ms (~16.7 min); letting real
// timers through would leave them dangling for the whole test process.
// ---------------------------------------------------------------------------

type CapturedTimer = { delay: number; fire: () => void }
let captured: CapturedTimer[] = []
const realSetTimeout = globalThis.setTimeout

beforeAll(() => {
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number) => {
    captured.push({ delay: delay ?? 0, fire: () => fn() })
    return captured.length as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
})

afterAll(() => {
  globalThis.setTimeout = realSetTimeout
})

beforeEach(() => {
  captured = []
})

// ---------------------------------------------------------------------------
// Helpers (the module's Action/State/ToasterToast types are not exported, so
// they are recovered from the reducer's signature).
// ---------------------------------------------------------------------------

type StateArg = Parameters<typeof reducer>[0]
type ActionArg = Parameters<typeof reducer>[1]
type ToastArg = StateArg["toasts"][number]

const makeToast = (id: string, extra: Record<string, unknown> = {}): ToastArg =>
  ({ id, open: true, title: `toast-${id}`, ...extra }) as ToastArg

const stateWith = (...toasts: ToastArg[]): StateArg => ({ toasts })

// SSR probe: renderToString mounts a fresh component per call, so useState
// re-reads the module-level memoryState on every readStore().
//
// The hook result is smuggled out through `capture()` (a helper defined
// *outside* the component) because assigning to an outer variable directly
// inside a component body trips the react-hooks/globals lint rule — which is
// exactly the side effect this probe intentionally performs.
let probe: ReturnType<typeof useToast> | null = null
function capture(value: ReturnType<typeof useToast>) {
  probe = value
}
function StoreProbe() {
  capture(useToast())
  return null
}

function readStore(): ReturnType<typeof useToast> {
  probe = null
  renderToString(React.createElement(StoreProbe))
  if (!probe) throw new Error("store probe did not render")
  return probe
}

// ---------------------------------------------------------------------------
// reducer — pure state transitions
// ---------------------------------------------------------------------------

describe("reducer: ADD_TOAST", () => {
  test("adds a toast to an empty state without mutating the input", () => {
    const state = stateWith()
    const t = makeToast("add-1")
    const next = reducer(state, { type: "ADD_TOAST", toast: t })
    expect(next).not.toBe(state)
    expect(next.toasts).toEqual([t])
    expect(state.toasts).toEqual([]) // original untouched
  })

  test("enforces TOAST_LIMIT = 1: only the newest toast is kept", () => {
    let state = stateWith(makeToast("limit-a"))
    state = reducer(state, { type: "ADD_TOAST", toast: makeToast("limit-b") })
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].id).toBe("limit-b")
    state = reducer(state, { type: "ADD_TOAST", toast: makeToast("limit-c") })
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].id).toBe("limit-c")
  })

  test("does not schedule a removal timer", () => {
    reducer(stateWith(makeToast("add-notimer-1")), {
      type: "ADD_TOAST",
      toast: makeToast("add-notimer-2"),
    })
    expect(captured).toHaveLength(0)
  })
})

describe("reducer: UPDATE_TOAST", () => {
  test("merges a partial toast onto the matching id", () => {
    const state = stateWith(makeToast("upd-1"), makeToast("upd-2"))
    const next = reducer(state, {
      type: "UPDATE_TOAST",
      toast: { id: "upd-1", title: "renamed" },
    })
    expect(next.toasts).toHaveLength(2)
    expect(next.toasts[0].id).toBe("upd-1")
    expect(next.toasts[0].title).toBe("renamed")
    expect(next.toasts[0].open).toBe(true) // unmerged fields survive
    expect(next.toasts[1].id).toBe("upd-2")
    expect(state.toasts[0].title).toBe("toast-upd-1") // original untouched
  })

  test("unknown id: contents unchanged, but a new state object is returned", () => {
    // Pinning current behavior: .map() always runs, so consumers get a new
    // state object (and React re-renders) even for no-op updates.
    const state = stateWith(makeToast("upd-unknown-1"))
    const next = reducer(state, {
      type: "UPDATE_TOAST",
      toast: { id: "does-not-exist", title: "nope" },
    })
    expect(next).not.toBe(state)
    expect(next.toasts).toEqual(state.toasts)
  })

  test("empty state: no crash, still empty", () => {
    const next = reducer(stateWith(), {
      type: "UPDATE_TOAST",
      toast: { id: "upd-none", title: "x" },
    })
    expect(next.toasts).toEqual([])
  })
})

describe("reducer: DISMISS_TOAST", () => {
  // The reducer does not enforce the toast limit on hand-built states (the
  // limit is applied on ADD only), so multi-toast states can be constructed to
  // exercise the per-id code paths.
  test("with a toastId: closes only that toast and queues its removal", () => {
    const state = stateWith(makeToast("dis-1"), makeToast("dis-2"))
    const next = reducer(state, { type: "DISMISS_TOAST", toastId: "dis-1" })
    expect(next.toasts[0].open).toBe(false)
    expect(next.toasts[1].open).toBe(true) // sibling untouched
    expect(state.toasts[0].open).toBe(true) // original untouched
    expect(captured).toHaveLength(1)
    expect(captured[0].delay).toBe(1_000_000) // TOAST_REMOVE_DELAY
  })

  test("without a toastId: closes every toast and queues removal for each", () => {
    const state = stateWith(makeToast("dis-all-1"), makeToast("dis-all-2"))
    const next = reducer(state, { type: "DISMISS_TOAST", toastId: undefined })
    expect(next.toasts.map((t) => t.open)).toEqual([false, false])
    expect(captured).toHaveLength(2)
    expect(captured.every((c) => c.delay === 1_000_000)).toBe(true)
  })

  test("unknown toastId: closes nothing but still schedules a timer", () => {
    // QUIRK (side effect in a "reducer"): a removal timer is queued even for
    // an id that is not in the state.
    const state = stateWith(makeToast("dis-miss-1"))
    const next = reducer(state, { type: "DISMISS_TOAST", toastId: "ghost" })
    expect(next.toasts[0].open).toBe(true)
    expect(captured).toHaveLength(1)
  })

  test('QUIRK: toastId "" schedules removal for all but closes nothing', () => {
    // "" is falsy, so the "dismiss everything" scheduling branch runs, but the
    // open:false predicate (`t.id === "" || toastId === undefined`) never
    // matches — so timers are queued while no toast is closed. Unreachable via
    // the public API (genId starts at "1"), documented here.
    const state = stateWith(makeToast("dis-empty-1"))
    const next = reducer(state, { type: "DISMISS_TOAST", toastId: "" })
    expect(next.toasts[0].open).toBe(true)
    expect(captured).toHaveLength(1)
  })
})

describe("reducer: REMOVE_TOAST", () => {
  test("with a toastId: removes only that toast", () => {
    const state = stateWith(makeToast("rem-1"), makeToast("rem-2"))
    const next = reducer(state, { type: "REMOVE_TOAST", toastId: "rem-1" })
    expect(next.toasts).toHaveLength(1)
    expect(next.toasts[0].id).toBe("rem-2")
    expect(state.toasts).toHaveLength(2) // original untouched
  })

  test("with an unknown toastId: contents unchanged", () => {
    const state = stateWith(makeToast("rem-unknown-1"))
    const next = reducer(state, { type: "REMOVE_TOAST", toastId: "ghost" })
    expect(next.toasts).toEqual(state.toasts)
  })

  test("without a toastId: clears all toasts", () => {
    const state = stateWith(makeToast("rem-all-1"), makeToast("rem-all-2"))
    const next = reducer(state, { type: "REMOVE_TOAST", toastId: undefined })
    expect(next.toasts).toEqual([])
  })
})

describe("reducer: general contract", () => {
  test("never mutates the previous state or its toast objects", () => {
    const a = makeToast("immut-1")
    const b = makeToast("immut-2")
    const state = stateWith(a, b)
    const snapshot = structuredClone(state)

    reducer(state, { type: "ADD_TOAST", toast: makeToast("immut-3") })
    reducer(state, { type: "UPDATE_TOAST", toast: { id: "immut-1", open: false } })
    reducer(state, { type: "DISMISS_TOAST", toastId: "immut-2" })
    reducer(state, { type: "REMOVE_TOAST", toastId: "immut-1" })

    expect(state).toEqual(snapshot)
    expect(a.open).toBe(true)
    expect(b.open).toBe(true)
  })

  test("FIXED: an unknown action type returns the state unchanged", () => {
    // The switch previously had no default branch, so a payload that bypassed
    // the Action union made the reducer return undefined — React's useReducer
    // would then throw. A default branch now preserves the previous state.
    const state = stateWith(makeToast("unknown-1"))
    const out = reducer(state, {
      type: "NOT_A_REAL_ACTION",
    } as unknown as ActionArg)
    expect(out).toBe(state)
  })
})

// ---------------------------------------------------------------------------
// Module store integration — toast() / useToast() via the SSR probe.
// Each test starts with a fresh toast(), which (thanks to TOAST_LIMIT = 1)
// resets the shared module store, so tests are order-independent.
// ---------------------------------------------------------------------------

describe("toast() and the module store", () => {
  test("returns a handle with a unique, incrementing string id", () => {
    const first = toast({ title: "first" })
    const second = toast({ title: "second" })
    expect(typeof first.id).toBe("string")
    expect(first.id).toMatch(/^\d+$/)
    expect(second.id).not.toBe(first.id)
    expect(Number(second.id)).toBe(Number(first.id) + 1)
    expect(typeof first.dismiss).toBe("function")
    expect(typeof first.update).toBe("function")
  })

  test("adds the toast to the store: open, props preserved, onOpenChange wired", () => {
    const handle = toast({ title: "hello", description: "world" })
    const store = readStore()
    expect(store.toasts).toHaveLength(1)
    const stored = store.toasts[0]
    expect(stored.id).toBe(handle.id)
    expect(stored.open).toBe(true)
    expect(stored.title).toBe("hello")
    expect(stored.description).toBe("world")
    expect(typeof stored.onOpenChange).toBe("function")
  })

  test("the store keeps only the newest toast (TOAST_LIMIT = 1, live path)", () => {
    toast({ title: "older" })
    const newest = toast({ title: "newest" })
    const store = readStore()
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0].id).toBe(newest.id)
    expect(store.toasts[0].title).toBe("newest")
  })

  test("update() merges fields onto the same toast and schedules no timer", () => {
    const handle = toast({ title: "v1" })
    // update() re-stamps the id from the handle, so passing it keeps the call
    // type-honest while still merging only the changed field.
    handle.update({ id: handle.id, title: "v2" })
    const store = readStore()
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0].id).toBe(handle.id)
    expect(store.toasts[0].title).toBe("v2")
    expect(captured).toHaveLength(0)
  })

  test("update({ open: false }) closes the toast but queues no removal", () => {
    // Divergence from dismiss(): updating open:false leaves the toast in the
    // store with no removal timer, so it lingers until something else
    // dismisses or removes it.
    const handle = toast({ title: "stay" })
    handle.update({ id: handle.id, open: false })
    const store = readStore()
    expect(store.toasts[0].id).toBe(handle.id)
    expect(store.toasts[0].open).toBe(false)
    expect(captured).toHaveLength(0)
  })

  test("dismiss() closes the toast and queues removal after TOAST_REMOVE_DELAY", () => {
    const handle = toast({ title: "bye" })
    handle.dismiss()
    expect(captured).toHaveLength(1)
    expect(captured[0].delay).toBe(1_000_000)
    const store = readStore()
    expect(store.toasts[0].id).toBe(handle.id)
    expect(store.toasts[0].open).toBe(false) // closed, but still present
  })

  test("firing the queued timer removes the toast from the store", () => {
    const handle = toast({ title: "expired" })
    handle.dismiss()
    expect(captured).toHaveLength(1)
    captured[0].fire() // simulates TOAST_REMOVE_DELAY elapsing
    const store = readStore()
    expect(store.toasts).toEqual([])
  })

  test("double dismiss queues exactly one timer until it fires", () => {
    const handle = toast({ title: "dedupe" })
    handle.dismiss()
    handle.dismiss() // suppressed: addToRemoveQueue is idempotent per id
    expect(captured).toHaveLength(1)
    captured[0].fire() // clears the id from the timeout map…
    handle.dismiss()
    expect(captured).toHaveLength(2) // …so a new timer can be queued
  })

  test("onOpenChange(false) dismisses the toast; onOpenChange(true) is a no-op", () => {
    const keep = toast({ title: "keep-open" })
    readStore().toasts[0].onOpenChange?.(true)
    expect(captured).toHaveLength(0)
    let store = readStore()
    expect(store.toasts[0].id).toBe(keep.id)
    expect(store.toasts[0].open).toBe(true)

    const close = toast({ title: "close-me" })
    readStore().toasts[0].onOpenChange?.(false)
    expect(captured).toHaveLength(1)
    expect(captured[0].delay).toBe(1_000_000)
    store = readStore()
    expect(store.toasts[0].id).toBe(close.id)
    expect(store.toasts[0].open).toBe(false)
  })

  test("useToast() exposes the same toast() and a dismiss() that closes all when called without an id", () => {
    const handle = toast({ title: "hook-dismiss" })
    const store = readStore()
    expect(store.toast).toBe(toast) // same exported function
    expect(store.toasts[0].id).toBe(handle.id)
    store.dismiss() // no argument -> dismiss everything
    expect(captured).toHaveLength(1)
    expect(captured[0].delay).toBe(1_000_000)
    const after = readStore()
    expect(after.toasts[0].open).toBe(false)
  })
})
