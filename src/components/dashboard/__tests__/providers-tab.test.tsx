// Component tests for src/components/dashboard/providers-tab.tsx (M5).
//
// Pattern: the real component stack against the fetch-double engine stub —
// happy (cards, health dots, key labels, default badges, engine banner),
// empty (only the add form), error (engine down, inline card — no toast),
// and the mutation flows (add + verify toast, test, refresh with import,
// default switch via a model chip, key rotation dialog, remove confirm)
// with the exact fetch calls the tab makes. Toasts are asserted through the
// spy (toastsWithTitle), dialogs through role=dialog + named buttons — the
// automations-tab conventions.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProviderInfo, ProvidersResponse } from "@/lib/agent-types";
import { ProvidersTab } from "../providers-tab";
import { createEngine, installToastSpy, renderWithProviders, resetToasts, toastsWithTitle, type EngineStub } from "./helpers";

const engine: EngineStub = createEngine();

beforeEach(() => {
  engine.install();
  engine.reset();
  resetToasts();
  installToastSpy(); // idempotent, module-global
});

afterEach(() => {
  cleanup();
  engine.restore();
});

function provider(over: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: "agnes",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    api: "openai-completions",
    modelIds: ["agnes-3.0-flash", "agnes-2.5-flash"],
    keyStatus: "env-ref",
    keyEnv: "AGNES_API_KEY",
    keyLabel: "key: $AGNES_API_KEY",
    isDefault: false,
    health: { ok: true, checkedAt: Date.now() },
    ...over,
  };
}

function routeProviders(over: Partial<ProvidersResponse> = {}) {
  const response: ProvidersResponse = {
    ok: true,
    providers: [
      provider(),
      provider({
        id: "zai-bridge",
        baseUrl: "http://127.0.0.1:3031/v1",
        keyStatus: "models-json",
        keyLabel: "key: in models.json",
        isDefault: true,
        modelIds: ["agnes-3.0-flash"],
      }),
    ],
    defaultProvider: "zai-bridge",
    defaultModel: "agnes-3.0-flash",
    engine: { provider: "zai-bridge", model: "agnes-3.0-flash" },
    presets: [
      {
        id: "agnes",
        label: "Agnes AI (OpenAI-compatible, image-capable)",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        api: "openai-completions",
        defaultModel: "agnes-3.0-flash",
        input: ["text", "image"],
        keyEnvHint: "AGNES_API_KEY",
      },
      {
        id: "custom",
        label: "Any other OpenAI-compatible endpoint",
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        defaultModel: "",
        input: ["text"],
        keyEnvHint: "your endpoint's key",
      },
    ],
    ...over,
  };
  engine.route("/api/providers", response);
  return response;
}

describe("ProvidersTab — happy state", () => {
  test("renders provider cards with key labels, default badge, model chips, and the engine banner", async () => {
    routeProviders();
    renderWithProviders(<ProvidersTab />);

    expect(await screen.findByText("agnes")).toBeTruthy();
    expect(screen.getByText("zai-bridge")).toBeTruthy();
    expect(screen.getByText("key: $AGNES_API_KEY")).toBeTruthy();
    expect(screen.getByText("key: in models.json")).toBeTruthy();
    expect(screen.getByText("default")).toBeTruthy(); // zai-bridge's badge
    // engine banner + session-default both render provider/model — 2 nodes
    expect(screen.getAllByText("zai-bridge/agnes-3.0-flash")).toHaveLength(2);
    // model chips: the default model chip carries the checkmark
    expect(screen.getByText("agnes-3.0-flash ✓")).toBeTruthy();
    expect(screen.getByText("agnes-2.5-flash")).toBeTruthy();
    // the add form rides alongside
    expect(screen.getByText("Add a provider")).toBeTruthy();
  });

  test("health dot aria-labels reflect reachable / unreachable / rejected", async () => {
    routeProviders({
      providers: [
        provider({ id: "ok-p", health: { ok: true, checkedAt: Date.now() } }),
        provider({ id: "down-p", health: { ok: false, problem: "unreachable", checkedAt: Date.now() } }),
        provider({ id: "auth-p", health: { ok: false, problem: "auth", checkedAt: Date.now() } }),
      ],
    });
    renderWithProviders(<ProvidersTab />);
    await screen.findByText("ok-p");
    expect(screen.getByLabelText("healthy")).toBeTruthy();
    expect(screen.getByLabelText("unreachable")).toBeTruthy();
    expect(screen.getByLabelText("credentials rejected")).toBeTruthy();
  });
});

describe("ProvidersTab — empty + error states", () => {
  test("empty registry renders only the add form (no provider cards)", async () => {
    routeProviders({ providers: [], defaultProvider: null, defaultModel: null });
    renderWithProviders(<ProvidersTab />);
    expect(await screen.findByText("Add a provider")).toBeTruthy();
    expect(screen.queryAllByText(/^key: /).length).toBe(0);
  });

  test("engine down renders the inline unavailable card, not a toast", async () => {
    engine.route(
      "/api/providers",
      new Response(JSON.stringify({ error: "engine down" }), { status: 503, headers: { "Content-Type": "application/json" } }),
    );
    renderWithProviders(<ProvidersTab />);
    expect(await screen.findByText(/provider registry is unavailable/i)).toBeTruthy();
    expect(toastsWithTitle("agnes: endpoint reachable")).toHaveLength(0);
  });
});

describe("ProvidersTab — mutations", () => {
  test("Test fires GET /api/providers/:id/test and toasts the verdict", async () => {
    routeProviders();
    engine.route("/api/providers/agnes/test", { ok: true, provider: "agnes", probe: { ok: true } });
    const user = userEvent.setup();
    renderWithProviders(<ProvidersTab />);
    await screen.findByText("agnes");
    await user.click(screen.getAllByRole("button", { name: /test/i })[0]);
    await waitFor(() => expect(engine.callsFor("/api/providers/agnes/test").length).toBe(1));
    await waitFor(() => expect(toastsWithTitle("agnes: endpoint reachable")).toHaveLength(1));
  });

  test("Refresh models posts /refresh and toasts the import list", async () => {
    routeProviders();
    engine.route("/api/providers/agnes/refresh", { ok: true, provider: "agnes", added: ["agnes-2.5-flash"], missing: [] });
    const user = userEvent.setup();
    renderWithProviders(<ProvidersTab />);
    await screen.findByText("agnes");
    await user.click(screen.getAllByRole("button", { name: /refresh models/i })[0]);
    await waitFor(() => expect(engine.callsFor("/api/providers/agnes/refresh").length).toBe(1));
    await waitFor(() =>
      expect(toastsWithTitle("agnes: imported agnes-2.5-flash")).toHaveLength(1),
    );
  });

  test("Remove confirms first; the confirm dialog fires DELETE and toasts", async () => {
    routeProviders();
    engine.route("/api/providers/agnes", (call) =>
      call.method === "DELETE" ? { ok: true, provider: "agnes", defaultFellBack: false, remaining: 1 } : { ok: true },
    );
    const user = userEvent.setup();
    renderWithProviders(<ProvidersTab />);
    await screen.findByText("agnes");
    await user.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove agnes?")).toBeTruthy();
    // not yet: the confirm is required
    expect(engine.callsFor("/api/providers/agnes").filter((c) => c.method === "DELETE")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(engine.callsFor("/api/providers/agnes").filter((c) => c.method === "DELETE")).toHaveLength(1),
    );
    await waitFor(() => expect(toastsWithTitle("removed agnes (its stored key went with it)")).toHaveLength(1));
  });

  test("Rotate key opens the dialog, posts the key, toasts verification", async () => {
    routeProviders();
    engine.route("/api/providers/agnes/key", { ok: true, provider: "agnes", probe: { ok: true } });
    const user = userEvent.setup();
    renderWithProviders(<ProvidersTab />);
    await screen.findByText("agnes");
    await user.click(screen.getAllByRole("button", { name: /rotate key/i })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Rotate key — agnes")).toBeTruthy();
    await user.type(within(dialog).getByPlaceholderText("new API key"), "cpk-new-1");
    await user.click(within(dialog).getByRole("button", { name: /rotate & verify/i }));
    await waitFor(() => expect(engine.callsFor("/api/providers/agnes/key")).toHaveLength(1));
    expect(engine.callsFor("/api/providers/agnes/key")[0]?.body).toEqual({ apiKey: "cpk-new-1" });
    await waitFor(() => expect(toastsWithTitle("agnes: endpoint reachable")).toHaveLength(1));
  });

  test("the Add form posts the preset + key and toasts verification", async () => {
    const happy = routeProviders();
    engine.route("/api/providers", (call) =>
      call.method === "POST" ? { ok: true, provider: "agnes", model: "agnes-3.0-flash", probe: { ok: true } } : happy,
    );
    const user = userEvent.setup();
    renderWithProviders(<ProvidersTab />);
    await screen.findByText("Add a provider");

    // preset select: radix combobox trigger, then the option in the listbox
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Agnes AI/i }));

    await user.type(screen.getByPlaceholderText(/cpk-…/), "cpk-test-1");
    await user.click(screen.getByRole("button", { name: /add & verify/i }));

    await waitFor(() => {
      const post = engine.callsFor("/api/providers").find((c) => c.method === "POST");
      expect(post).toBeTruthy();
      expect((post?.body as Record<string, unknown>).preset).toBe("agnes");
      expect((post?.body as Record<string, unknown>).apiKey).toBe("cpk-test-1");
    });
    await waitFor(() =>
      expect(toastsWithTitle("added agnes (agnes-3.0-flash) — endpoint reachable")).toHaveLength(1),
    );
  });

  test("clicking a non-default model chip posts the default switch", async () => {
    routeProviders();
    engine.route("/api/providers/agnes/default", { ok: true, provider: "agnes" });
    const user = userEvent.setup();
    renderWithProviders(<ProvidersTab />);
    await screen.findByText("agnes");
    await user.click(screen.getByRole("button", { name: "agnes-2.5-flash" }));
    await waitFor(() => expect(engine.callsFor("/api/providers/agnes/default")).toHaveLength(1));
    await waitFor(() => expect(toastsWithTitle("default → agnes")).toHaveLength(1));
  });
});
