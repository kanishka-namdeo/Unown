/**
 * Shell.tsx unit tests — pins the AuthScreen form's implicit label
 * association so a regression to htmlFor-less *sibling* labels (the
 * cross-field-fill shape noted in project memory) fails loudly, and pins
 * the embed reset channel (cadence-round pattern, docs/cadence-demo-session.md
 * adaptation 3): embed-only mount, origin check, payload shape, and the
 * reset → POST /fugue/api/reset → re-fetch sequence.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Host-embedding adaptation: bun runs all test files in one process — restore the
// NATIVE fetch (never `undefined`) so later suites (cadence, bazaar) keep a
// working global. Captured at module load, before any router patches it.
const NATIVE_FETCH = globalThis.fetch;
import { render, screen, cleanup } from "@testing-library/react";
import FugueShell from "./Shell";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./shared";

// ── helpers ──

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Set up a fetch router that returns 401 for /auth/me (no session) and 200
 * for /workspaces — enough to drive FugueShell into the AuthScreen branch
 * while keeping the workspace selector mounted.
 */
function authFetchRouter() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/me")) return jsonResp({ user: null }, 401);
    if (url.includes("/workspaces")) return jsonResp({ workspaces: [] });
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  return {
    dispose() {
      globalThis.fetch = original;
    },
  };
}

/**
 * Like authFetchRouter but records every fetch call and 204s /reset POSTs
 * (with the init) — the embed reset channel test needs to observe the
 * reset → POST /fugue/api/reset sequence.
 */
function resetCapturingRouter(calls: Array<{ url: string; init?: RequestInit }>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/auth/me")) return jsonResp({ user: null }, 401);
    if (url.includes("/workspaces")) return jsonResp({ workspaces: [] });
    if (url.includes("/reset")) return new Response(null, { status: 204 });
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  return {
    dispose() {
      globalThis.fetch = original;
    },
  };
}

function resetPostCount(calls: Array<{ url: string; init?: RequestInit }>): number {
  return calls.filter((c) => c.url.includes("/reset") && c.init?.method === "POST").length;
}

beforeEach(() => cleanup());
afterEach(() => {
  cleanup();
  globalThis.fetch = NATIVE_FETCH;
});

async function renderShell() {
  render(<FugueShell embed={false}>{null}</FugueShell>);
  // useAuth's effect needs a tick to settle loading → unauth → AuthScreen.
  await new Promise((r) => setTimeout(r, 50));
}

describe("embed reset channel (cadence-round pattern)", () => {
  const PAYLOAD = { source: "unown-landing", type: "fugue-reset" };

  function dispatchMessage(data: unknown, origin = window.origin) {
    const ev = new MessageEvent("message", { data, origin });
    // happy-dom's MessageEvent constructor drops the `origin` init member
    // (its Origin getter returns ""), which would make the listener's
    // origin check unsatisfiable in the shim. Force the contract's value
    // onto the event — the real browser path never goes through this.
    Object.defineProperty(ev, "origin", { value: origin, configurable: true });
    window.dispatchEvent(ev);
  }

  async function renderEmbedShell(calls: Array<{ url: string; init?: RequestInit }>) {
    const { dispose } = resetCapturingRouter(calls);
    render(<FugueShell embed={true}>{null}</FugueShell>);
    await new Promise((r) => setTimeout(r, 50));
    return { dispose };
  }

  it("mounts the listener ONLY in embed mode", async () => {
    // Non-embed shell: even a correct payload must not hit the reset route.
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { dispose } = resetCapturingRouter(calls);
    render(<FugueShell embed={false}>{null}</FugueShell>);
    await new Promise((r) => setTimeout(r, 50));

    dispatchMessage(PAYLOAD);
    await new Promise((r) => setTimeout(r, 50));
    expect(resetPostCount(calls)).toBe(0);
    dispose();

    // Embed shell: the same payload fires a POST /fugue/api/reset.
    const calls2: Array<{ url: string; init?: RequestInit }> = [];
    const { dispose: dispose2 } = await renderEmbedShell(calls2);
    calls2.length = 0; // drop the mount-time /auth/me + /workspaces traffic
    dispatchMessage(PAYLOAD);
    await new Promise((r) => setTimeout(r, 50));
    expect(resetPostCount(calls2)).toBe(1);
    dispose2();
  });

  it("POSTs /fugue/api/reset on the landing's payload, then re-fetches workspaces", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { dispose } = await renderEmbedShell(calls);
    calls.length = 0; // drop the mount-time /auth/me + /workspaces traffic

    dispatchMessage(PAYLOAD, window.origin);
    // onReset is async (POST then re-fetch) — give it two ticks.
    await new Promise((r) => setTimeout(r, 50));

    // Sequence: POST /reset, then the re-fetch GET /workspaces.
    const resetIdx = calls.findIndex((c) => c.url.includes("/reset"));
    expect(resetIdx).toBe(0);
    expect(calls[resetIdx].init?.method).toBe("POST");
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.some((c, i) => i > resetIdx && c.url.includes("/workspaces"))).toBe(true);

    dispose();
  });

  it("ignores messages from a foreign origin (origin check)", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { dispose } = await renderEmbedShell(calls);
    calls.length = 0;

    dispatchMessage(PAYLOAD, "http://evil.example");
    await new Promise((r) => setTimeout(r, 20));
    expect(resetPostCount(calls)).toBe(0);

    dispose();
  });

  it("ignores payloads with the wrong shape (shape check)", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { dispose } = await renderEmbedShell(calls);
    calls.length = 0;

    // Right origin, wrong source field: ignored.
    dispatchMessage({ source: "other-host", type: "fugue-reset" }, window.origin);
    // Right source, wrong type: ignored.
    dispatchMessage({ source: "unown-landing", type: "cadence-reset" }, window.origin);
    // Null payload: ignored.
    dispatchMessage(null, window.origin);
    await new Promise((r) => setTimeout(r, 20));
    expect(resetPostCount(calls)).toBe(0);

    dispose();
  });
});

describe("AuthScreen form labels", () => {
  it("Email and Password labels resolve to distinct inputs (no cross-field fill)", async () => {
    const { dispose } = authFetchRouter();
    await renderShell();

    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;

    // The two inputs must be distinct DOM elements — the original
    // cross-field-fill bug (label-less siblings sharing one input) would
    // make getByLabelText resolve the same element for both queries.
    expect(emailInput).not.toBe(passwordInput);
    expect(emailInput.type).toBe("email");
    expect(passwordInput.type).toBe("password");

    // Both inputs should be pre-filled with the demo credentials.
    expect(emailInput.value).toBe(DEMO_EMAIL);
    expect(passwordInput.value).toBe(DEMO_PASSWORD);

    dispose();
  });

  it("the demo credential hint card exposes email + password in code elements", async () => {
    const { dispose } = authFetchRouter();
    await renderShell();

    // Scope strictly to the hint card via its <p class="font-medium"> heading
    // so we don't accidentally match any <code> node in another part of the
    // document tree (e.g. a leaked DOM from a prior test).
    const heading = screen.getByText("Demo credentials");
    const card = heading.closest("div[class*='border-dashed']") ?? heading.parentElement;
    const codeNodes = card!.querySelectorAll("code");
    expect(codeNodes.length).toBe(2);
    expect(codeNodes[0]?.textContent).toBe(DEMO_EMAIL);
    expect(codeNodes[1]?.textContent).toBe(DEMO_PASSWORD);

    dispose();
  });
});
