// Shared harness for the dashboard component tests (bun:test +
// @testing-library/react + happy-dom — see docs/testing-strategy.md §4.1,
// "Component" tests).
//
// What lives here:
// - `createEngine()` — a fetch double for the engine REST API. Tests route
//   path substrings (longest match wins, so `/api/runs/<id>` beats `/api/runs`)
//   to fixture objects, Response instances, thrown Errors (network-style
//   rejections), or per-call functions. Every (url, init, body) is recorded so
//   mutations can assert on request shape.
// - `renderWithProviders()` — renders a tab inside a fresh QueryClient
//   (retry:false, gcTime:0, staleTime:0 — deterministic) and records every
//   `invalidateQueries` filters object for invalidation assertions.
// - `installToastSpy()` — records every sonner `toast.*()` call. Toasts are
//   asserted through the spy, not the DOM: sonner's toast store is
//   module-global and outlives a test, so a Toaster mounted in the next test
//   would briefly render the previous test's not-yet-dismissed toast (found
//   empirically; 4s auto-dismiss), which breaks "no false success" style
//   assertions and — worse — a failing `expect(element).toBeNull()` makes
//   bun's assertion serializer walk the happy-dom node graph without cycle
//   handling and OOM-kill the whole test process. See bun-quirks note below.
// - `resetActivityStore()` — the zustand activity store is a module singleton
//   (same reset trick as src/lib/agent-store.test.ts).
// - `FakeEventSource` — happy-dom does not implement EventSource; the SSE
//   bridge (providers.tsx) reads the global, so tests swap in this fake and
//   deliver raw frames through it.
//
// The dashboard sources are NOT mocked or modified — components run against
// the real react-query / sonner / radix stack with only `globalThis.fetch` and
// `globalThis.EventSource` replaced.
//
// bun-quirks note: never pass a happy-dom element to `expect(...).toBeNull()` /
//   `toBe` / `toEqual` — on failure bun deep-serializes the DOM node (cyclic
//   parent/child graph) and the process gets OOM-killed instead of reporting
//   the failure. Negative DOM assertions go through queryAllByText(...)
//   .length or the toast spy instead.

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
  type InvalidateQueryFilters,
} from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { toast } from "sonner";
import { useActivityStore } from "@/lib/agent-store";

// ---------------------------------------------------------------------------
// Engine fetch double
// ---------------------------------------------------------------------------

/** One recorded fetch (url, method, JSON-parsed body for POSTs). */
export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

/** Route responder: any JSON-shaped object/array (typed engine payloads are
 *  fine — `object` rather than `Record<string, unknown>` so interfaces from
 *  agent-types.ts assign without index signatures); Response → as-is;
 *  Error → thrown (network-style rejection); function → per-call. */
export type RouteResponder =
  | object
  | Response
  | Error
  | Promise<object | Response | Error>
  | ((call: RecordedCall) => object | Response | Error | void | undefined);

export interface EngineStub {
  /** Register a route under a URL substring (longest key wins). */
  route(key: string, responder: RouteResponder): EngineStub;
  /** All recorded fetch calls, in order. */
  calls: RecordedCall[];
  /** Recorded calls whose URL contains `key`. */
  callsFor(key: string): RecordedCall[];
  /** Replace globalThis.fetch with the stub. */
  install(): void;
  /** Clear recorded calls and registered routes — call in beforeEach so
   *  per-test fetch-count assertions stay isolated within a file. */
  reset(): void;
  /** Restore the fetch that was active when the stub was created. */
  restore(): void;
}

export function createEngine(): EngineStub {
  const calls: RecordedCall[] = [];
  const routes = new Map<string, RouteResponder>();
  const realFetch = globalThis.fetch;

  const engine: EngineStub = {
    calls,
    callsFor: (key) => calls.filter((c) => c.url.includes(key)),
    route(key, responder) {
      routes.set(key, responder);
      return engine;
    },
    reset() {
      calls.length = 0;
      routes.clear();
    },
    install() {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const rawBody = init?.body;
        let body: unknown;
        if (typeof rawBody === "string") {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody;
          }
        }
        const call: RecordedCall = { url, method: init?.method ?? "GET", body };
        calls.push(call);
        // Longest registered key contained in the URL wins, so exact
        // sub-paths (`/api/runs/<id>`) beat their prefixes (`/api/runs`).
        const key = [...routes.keys()].sort((a, b) => b.length - a.length).find((k) => url.includes(k));
        if (key === undefined) {
          // No route registered: a loud 404 keeps un-stubbed traffic visible
          // instead of silently hitting happy-dom's real fetch.
          return new Response(JSON.stringify({ error: `test route not stubbed: ${url}` }), { status: 404 });
        }
        const responder = routes.get(key) as RouteResponder;
        const result = typeof responder === "function" ? responder(call) : responder;
        if (result === undefined || result === null) {
          return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (result instanceof Error) throw result;
        if (result instanceof Response) return result;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
  return engine;
}

/** A 409 "engine busy" Response carrying the engine's error string. */
export function busyResponse(message = "router busy: a background job is learning"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
}

/** Manually-resolved promise for driving pending mutations. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// QueryClient wrapper (fresh client per render, invalidateQueries recorder)
// ---------------------------------------------------------------------------

export interface TabRender extends RenderResult {
  queryClient: QueryClient;
  /** Every filters object passed to queryClient.invalidateQueries. */
  invalidations: InvalidateQueryFilters[];
  /** The `queryKey` of every invalidateQueries call — compare with `qk.*`. */
  invalidatedKeys(): unknown[];
}

/**
 * Render a dashboard surface inside a deterministic QueryClientProvider.
 * invalidateQueries is recorded (and still forwarded) for assertions.
 * The sonner Toaster is deliberately NOT mounted — toast side-effects are
 * observed through the toast spy instead (see the header comment).
 */
export function renderWithProviders(ui: React.ReactElement, options?: RenderOptions): TabRender {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const invalidations: InvalidateQueryFilters[] = [];
  const realInvalidate = queryClient.invalidateQueries.bind(queryClient);
  (queryClient as { invalidateQueries: unknown }).invalidateQueries = ((
    filters?: InvalidateQueryFilters
  ) => {
    if (filters) invalidations.push(filters);
    return realInvalidate(filters);
  }) as QueryClient["invalidateQueries"];

  const view = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    options
  );
  return {
    ...view,
    queryClient,
    invalidations,
    invalidatedKeys: () => invalidations.map((f) => (f as { queryKey?: unknown }).queryKey),
  };
}

// ---------------------------------------------------------------------------
// sonner toast spy (components call toast.success/error/warning/info)
// ---------------------------------------------------------------------------

export interface ToastCall {
  kind: "success" | "error" | "warning" | "info";
  title: string;
  description?: string;
}

const toastCalls: ToastCall[] = [];
let toastSpyInstalled = false;

/** Wrap sonner's toast.success/info/warning/error with recorders (idempotent —
 *  safe to call from every test file; the underlying toast still fires). */
export function installToastSpy(): void {
  if (toastSpyInstalled) return;
  toastSpyInstalled = true;
  const kinds = ["success", "info", "warning", "error"] as const;
  for (const kind of kinds) {
    const original = toast[kind];
    (toast as unknown as Record<string, unknown>)[kind] = ((
      title: string,
      data?: { description?: string }
    ) => {
      toastCalls.push({ kind, title, description: data?.description });
      return original(title, data);
    }) as typeof toast["success"];
  }
}

/** Clear the recorded toast calls (call in beforeEach). */
export function resetToasts(): void {
  toastCalls.length = 0;
}

/** All recorded toast calls whose title matches (exact string). */
export function toastsWithTitle(title: string): ToastCall[] {
  return toastCalls.filter((c) => c.title === title);
}

// ---------------------------------------------------------------------------
// Activity store reset (module singleton across tests)
// ---------------------------------------------------------------------------

export function resetActivityStore() {
  useActivityStore.setState({ items: [], connected: false, lastEventAt: null });
}

// ---------------------------------------------------------------------------
// Fake EventSource (happy-dom has none; providers.tsx reads the global)
// ---------------------------------------------------------------------------

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;

  url: string;
  readyState = 0;
  closed = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Simulate a successful connection (fires es.onopen). */
  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Deliver a raw SSE message frame through es.onmessage. */
  deliver(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  /** Fire es.onerror. */
  simulateError(): void {
    this.onerror?.({});
  }
}

export interface EventSourceStub {
  /** All FakeEventSource instances created since install(). */
  instances: FakeEventSource[];
  /** The most recently created instance (the live SseBridge connection). */
  latest(): FakeEventSource;
  /** Restore whatever EventSource global was there before. */
  restore(): void;
}

export function installFakeEventSource(): EventSourceStub {
  const real = globalThis.EventSource;
  (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
  FakeEventSource.instances = [];
  return {
    get instances() {
      return FakeEventSource.instances;
    },
    latest: () => FakeEventSource.instances[FakeEventSource.instances.length - 1],
    restore() {
      (globalThis as { EventSource: unknown }).EventSource = real;
      FakeEventSource.instances = [];
    },
  };
}

// ---------------------------------------------------------------------------
// Small DOM assertion helpers
// ---------------------------------------------------------------------------

/** True when the element has `disabled` semantics (button or aria-disabled). */
export function isDisabled(el: HTMLElement | Element): boolean {
  const anyEl = el as HTMLElement & { disabled?: boolean };
  return anyEl.disabled === true || el.getAttribute("aria-disabled") === "true";
}
