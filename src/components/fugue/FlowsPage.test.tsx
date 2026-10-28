import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import FlowsPage, { FlowsContent, FlowEditor } from "./FlowsPage";
import type { Flow, Workspace } from "@/lib/fugue/types";

const WS: Workspace = {
  id: "ws_atlas",
  slug: "atlas",
  name: "Atlas",
  description: "test",
  createdAt: "2025-06-01T00:00:00.000Z",
};

const FLOW: Flow = {
  id: "fl_atlas",
  workspaceId: "ws_atlas",
  name: "Atlas Triage Pipeline",
  description: "demo",
  enabled: true,
  updatedAt: "2025-06-01T00:00:00.000Z",
  steps: [
    {
      id: "st_atlas_transform",
      type: "transform",
      name: "Normalise text",
      config: { template: "{{input}}" },
      retry: { maxAttempts: 2 },
    },
  ],
};

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Host-embedding adaptation: the host's `bun test src` runs every file in one
// process (cadence/bazaar suites included) — a router leaked by a throwing
// test would poison later files (observed live: cadence habit-form). Every
// router registers here and afterEach disposes whatever is still live.
const activeRouters: Array<{ dispose(): void }> = [];

/**
 * Replace global fetch with a router over (path, method) → body.
 * Returns a handle that records calls and restores the original on dispose.
 */
function fetchRouter(route: (url: string, init?: RequestInit) => unknown | null) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = route(url, init);
    if (body === null) {
      throw new TypeError("fetch failed");
    }
    return jsonResp(body);
  }) as typeof fetch;
  const handle = {
    calls,
    dispose() {
      globalThis.fetch = original;
      const i = activeRouters.indexOf(handle);
      if (i !== -1) activeRouters.splice(i, 1);
    },
  };
  activeRouters.push(handle);
  return handle;
}

afterEach(() => {
  while (activeRouters.length > 0) activeRouters.pop()!.dispose();
  cleanup();
});

// ── flows list ──

describe("flows list", () => {
  it("renders the flows list with step counts", async () => {
    const { dispose } = fetchRouter((url) => {
      if (url.includes("/flows?workspaceId=")) return { flows: [FLOW] };
      return null;
    });
    render(<FlowsContent workspaces={[WS]} onOpen={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("Atlas Triage Pipeline")).toBeDefined();
    });
    expect(screen.getByText("1 step")).toBeDefined();
    dispose();
  });

  it("shows the empty state", async () => {
    const { dispose } = fetchRouter((url) => {
      if (url.includes("/flows?workspaceId=")) return { flows: [] };
      return null;
    });
    render(<FlowsContent workspaces={[WS]} onOpen={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("No flows in this workspace yet.")).toBeDefined();
    });
    dispose();
  });

  it("toggles enabled via PATCH", async () => {
    let patchSeen = false;
    const { dispose } = fetchRouter((url, init) => {
      if (url.includes("/flows?workspaceId=")) return { flows: [FLOW] };
      if (init?.method === "PATCH") {
        patchSeen = true;
        return { flow: { ...FLOW, enabled: false } };
      }
      return null;
    });
    render(<FlowsContent workspaces={[WS]} onOpen={() => {}} />);
    const sw = await waitFor(
      () => screen.getByRole("switch") as HTMLElement,
      { timeout: 2000 },
    );
    fireEvent.click(sw);
    await waitFor(() => expect(patchSeen).toBe(true));
    dispose();
  });

  it("opens the editor on click", async () => {
    const { dispose } = fetchRouter((url) => {
      if (url.includes("/flows?workspaceId=")) return { flows: [FLOW] };
      return null;
    });
    let opened: Flow | null | undefined;
    render(<FlowsContent workspaces={[WS]} onOpen={(f) => (opened = f)} />);
    const btn = await waitFor(
      () =>
        screen.getByRole("button", { name: "Atlas Triage Pipeline" }) as HTMLElement,
      { timeout: 2000 },
    );
    fireEvent.click(btn);
    expect(opened?.id).toBe("fl_atlas");
    dispose();
  });
});

// ── flow editor ──

describe("flow editor", () => {
  function editorFlow(): Flow {
    return {
      id: "fl_atlas",
      workspaceId: "ws_atlas",
      name: "Atlas Triage Pipeline",
      description: "demo",
      enabled: true,
      updatedAt: "2025-06-01T00:00:00.000Z",
      steps: [
        {
          id: "st_atlas_transform",
          type: "transform",
          name: "Normalise text",
          config: { template: "{{input}}" },
          retry: { maxAttempts: 2 },
        },
        {
          id: "st_atlas_classify",
          type: "classify",
          name: "Classify",
          config: { rules: { urgent: ["urgent"] } },
          retry: { maxAttempts: 1 },
        },
      ],
    };
  }

  it("adds, removes, reorders steps; switches per-type config forms", () => {
    render(
      <FlowEditor flow={editorFlow()} onSaved={() => {}} onCancel={() => {}} />,
    );

    // Add step.
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    expect(screen.getByRole("button", { name: "Remove step 3" })).toBeDefined();

    // Switch the new step to notify → the notify config form appears.
    fireEvent.change(screen.getByLabelText("Step 3 type"), {
      target: { value: "notify" },
    });
    expect(screen.getByLabelText("Notify message")).toBeDefined();

    // Remove the step again.
    fireEvent.click(screen.getByRole("button", { name: "Remove step 3" }));
    expect(screen.queryByLabelText("Notify message")).toBeNull();
    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDefined();

    // Reorder: move step 2 (classify) above step 1.
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    // After the reorder, step 1 is classify → its rules form is first.
    expect(screen.getAllByRole("button", { name: /Remove step/ }).length).toBe(2);
    const firstTypeSelect = screen.getAllByLabelText(/^Step \d+ type/)[0] as HTMLSelectElement;
    expect(firstTypeSelect.value).toBe("classify");
  });

  it("renders per-type config forms", () => {
    const flow: Flow = {
      ...editorFlow(),
      steps: [
        {
          id: "s1",
          type: "transform",
          name: "T",
          config: { template: "hello {{input}}" },
          retry: { maxAttempts: 1 },
        },
        {
          id: "s2",
          type: "classify",
          name: "C",
          config: { rules: { urgent: ["urgent", "critical"] } },
          retry: { maxAttempts: 1 },
        },
        {
          id: "s3",
          type: "branch",
          name: "B",
          config: { when: [{ field: "labels:urgent", target: "s4" }] },
          retry: { maxAttempts: 1 },
        },
        {
          id: "s4",
          type: "enrich",
          name: "E",
          config: { fields: { team: "ops" } },
          retry: { maxAttempts: 1 },
        },
      ],
    };
    render(<FlowEditor flow={flow} onSaved={() => {}} onCancel={() => {}} />);
    expect((screen.getByLabelText("Transform template") as HTMLInputElement).value).toBe(
      "hello {{input}}",
    );
    expect(
      (screen.getByLabelText("classify label 1") as HTMLInputElement).value,
    ).toBe("urgent");
    expect(
      (screen.getByLabelText("classify keywords for urgent") as HTMLInputElement).value,
    ).toBe("urgent, critical");
    expect((screen.getByLabelText("branch field 1") as HTMLInputElement).value).toBe(
      "labels:urgent",
    );
    expect(
      (screen.getByLabelText("branch target 1") as HTMLSelectElement).value,
    ).toBe("s4");
    expect((screen.getByLabelText("enrich field key 1") as HTMLInputElement).value).toBe(
      "team",
    );
    expect(
      (screen.getByLabelText("enrich value for team") as HTMLInputElement).value,
    ).toBe("ops");
  });

  it("shows API validation errors on save", async () => {
    const { dispose, calls } = fetchRouter((url, init) => {
      if (init?.method === "PATCH" && url.includes("/flows/fl_atlas")) {
        return {
          errors: [{ path: "name", message: "name must be a non-empty string" }],
        };
      }
      return null;
    });
    render(
      <FlowEditor flow={editorFlow()} onSaved={() => {}} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "name must be a non-empty string",
      );
    });
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true);
    dispose();
  });

  it("Run button posts the payload and redirects to the run inspector", async () => {
    let posted: string | null = null;
    const { dispose } = fetchRouter((url, init) => {
      if (init?.method === "POST" && url.includes("/flows/fl_atlas/run")) {
        posted = String(init?.body ?? "");
        return { run: { id: "run_fl_atlas_1" } };
      }
      return null;
    });
    const origHref = window.location.href;
    // Intercept the redirect via history in the handler.
    const origAssign = Object.getOwnPropertyDescriptor(window.location, "href");
    let captured: string | null = null;
    Object.defineProperty(window.location, "href", {
      configurable: true,
      get: () => origHref,
      set: (v: string) => {
        captured = v;
      },
    });

    render(
      <FlowEditor flow={editorFlow()} onSaved={() => {}} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const postedBody = await new Promise<string>((resolve) => {
      const timer = setInterval(() => {
        if (posted !== null) {
          clearInterval(timer);
          resolve(posted);
        }
      }, 5);
      setTimeout(() => clearInterval(timer), 2000);
    });
    expect(postedBody).toContain("urgent: server down");
    await waitFor(() => expect(captured).toContain("/fugue/runs?id=run_fl_atlas_1"));

    if (origAssign) Object.defineProperty(window.location, "href", origAssign);
    else Object.defineProperty(window.location, "href", {
      configurable: true,
      get: () => origHref,
    });
    dispose();
  });

  it("new-flow editor creates via POST", async () => {
    const { dispose } = fetchRouter((url, init) => {
      if (init?.method === "POST" && url.includes("/flows")) {
        return {
          flow: {
            ...FLOW,
            id: "fl_15",
            name: "New flow",
            steps: [
              {
                id: "st_15",
                type: "transform",
                name: "Step 1",
                config: { template: "{{input}}" },
                retry: { maxAttempts: 1 },
              },
            ],
          },
        };
      }
      return null;
    });
    let saved: Flow | null = null;
    render(
      <FlowEditor
        flow={null}
        onSaved={(f) => (saved = f)}
        onCancel={() => {}}
      />,
    );
    // Set the flow name (the first textbox is the name field).
    const nameInput = screen.getAllByRole("textbox")[0];
    fireEvent.change(nameInput, { target: { value: "New flow" } });
    // Set URL for workspaceId.
    const origHref = window.location.href;
    Object.defineProperty(window.location, "href", {
      configurable: true,
      get: () => `${origHref}?workspaceId=ws_atlas`,
    });
    fireEvent.click(screen.getByRole("button", { name: "Create flow" }));
    await waitFor(() => expect(saved?.id).toBe("fl_15"));
    Object.defineProperty(window.location, "href", {
      configurable: true,
      get: () => origHref,
    });
    dispose();
  });
});
