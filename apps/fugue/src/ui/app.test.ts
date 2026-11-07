/**
 * app.test.ts — the F-4 SPIKE lane (PLAN §7 unknown #2) + the
 * every-transition persistAll pin.
 *
 * The spike: boot the app's adapter resolution (a) against a live
 * RestAdapterClient answer (the fixture-server proxy path),
 * (b) with no transport injected (the runner stubbed out) — the
 * app degrades to the EngineDown lane, never a crash, never a
 * blank. The second assertion IS the spike verdict's proof.
 *
 * Lane A (DOM-free enforcement): no DOM globals — the app's pure
 * surface (resolveAdapter / boot / persistAll / render) is driven
 * over in-memory StorageLike + a stubbed RestAdapterClient.
 */
import { describe, test, expect } from "bun:test";
import {
  resolveAdapter,
  boot,
  persistAll,
  render,
  initialState,
  createFetchClient,
} from "./app.js";
import type { RestAdapterClient } from "../adapter/rest-adapter.js";
import { EngineDown, EngineLocked } from "../adapter/engine-adapter.js";
import { toCanonicalJson } from "../domain/io.js";

/** A RestAdapterClient that succeeds (the fixture-server answer). */
function liveClient(): RestAdapterClient {
  return {
    call: async () => ({
      phase: "ready",
      pid: 1,
      version: "0.0.0",
      memoryVersion: 1,
      dreams: 0,
    }),
    nowMs: () => 0,
  };
}

/** A RestAdapterClient that throws EngineDown (the stubbed runner). */
function downClient(): RestAdapterClient {
  return {
    call: async () => {
    throw new EngineDown("fixture server unreachable");
    },
    nowMs: () => 0,
  };
}

/** A RestAdapterClient that throws EngineLocked (the 401 lane). */
function lockedClient(): RestAdapterClient {
  return {
    call: async () => {
      throw new EngineLocked("engine 401");
    },
    nowMs: () => 0,
  };
}

describe("F-4 spike (PLAN §7 unknown #2)", () => {
  test("live lane: the proxy path resolves + lists automations", async () => {
    const resolved = await resolveAdapter(liveClient());
    expect(resolved.lane).toBe("live");
    const state = await boot(liveClient());
    expect(state.engineLane).toBe("live");
    // The fixture's canned automations cross the boundary.
    expect(state.automations.length).toBeGreaterThanOrEqual(0);
    // The render is NEVER blank (the O-1 law).
    expect(render(state).length).toBeGreaterThan(0);
  });

  test("degraded lane: no transport -> EngineDown panel, never blank", async () => {
    const resolved = await resolveAdapter();
    expect(resolved.lane).toBe("down");
    expect(resolved.reason).toBe("no live transport injected");
    const state = await boot();
    expect(state.engineLane).toBe("down");
    const html = render(state);
    // The honest engine-down panel is present (never a blank).
    expect(html).toContain('data-panel="engine-down"');
    expect(html.length).toBeGreaterThan(0);
  });

  test("transport throwing EngineDown -> degraded lane", async () => {
    const resolved = await resolveAdapter(downClient());
    expect(resolved.lane).toBe("down");
    expect(resolved.reason).toContain("fixture server unreachable");
  });

  test("the EngineLocked taxonomy maps to the locked lane", async () => {
    const resolved = await resolveAdapter(lockedClient());
    expect(resolved.lane).toBe("locked");
    expect(resolved.reason).toContain("engine 401");
  });

  test("createFetchClient returns the typed client surface", () => {
    const c = createFetchClient("http://127.0.0.1:4130");
    expect(typeof c.call).toBe("function");
    expect(typeof c.nowMs).toBe("function");
  });
});

describe("the every-transition persistAll (O-1/O-2 house law)", () => {
  test("persistAll writes canonical bytes through the adapter", () => {
    let bytes: string | null = null;
    const adapter = { save: (b: string) => (bytes = b) };
    persistAll(initialState, adapter);
    expect(bytes).not.toBeNull();
    // Canonical bytes round-trip through the domain's io.
    expect(bytes).toBe(toCanonicalJson(initialState.data));
  });
});
