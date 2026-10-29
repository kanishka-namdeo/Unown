// live-demo.test.tsx — the live-demo band's contract (the cadence round,
// 2026-10-28: the band became a three-app gallery).
//
// The band iframes each agent-built app's own route in browser chrome, one
// switcher. What this suite pins:
//   - the section exists with the aqua hue and the #live-demo anchor;
//   - the data file carries three apps with distinct routes, posters, reset
//     types and receipt docs (a gallery, not one app twice);
//   - every receipt chip reads from the ACTIVE app's data — switching tabs
//     swaps the counts (drift between the copy and the data file is exactly
//     the hand-typed-number defect the honesty rules forbid);
//   - every poster exists on disk with the real intrinsic dimensions (the
//     dex-media pattern — a missing or mis-sized poster is a layout shift,
//     not just a broken image);
//   - the iframe is absent until mounted (the lazy contract: an idle visit
//     never pays the demo's hydration cost) and mounts on demand;
//   - the reset handshake posts the ACTIVE app's {source, type} pair with
//     targetOrigin = this origin, never "*";
//   - the mobile story is the poster + the app's route link, never a
//     cramped frame.
import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LiveDemoSection } from "../live-demo";
import { LIVE_DEMO_APPS } from "../live-demo-data";

// The composition root's animate shim (see landing-page.test.tsx).
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const ROOT = resolve(import.meta.dir.slice(0, import.meta.dir.indexOf("/src/") + 1));

function posterPath(app: (typeof LIVE_DEMO_APPS)[number]) {
  // the path mirrors the data file's declared poster (focus lives at
  // /landing/demo — its id predates the path)
  return resolve(ROOT, `public${app.poster}`);
}

/** PNG IHDR width/height reader — the dex-media trick, no image lib needed. */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("live-demo band (the gallery)", () => {
  test("renders the section with the aqua hue, its anchor, and the browser-chrome URL bar", () => {
    const { container } = render(<LiveDemoSection />);
    const section = container.querySelector("section#live-demo");
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-hue")).toBe("aqua");
    // the URL bar names the ACTIVE app's real route, truthfully
    expect(section?.textContent).toContain(LIVE_DEMO_APPS[0].url);
  });

  test("the data file is a real gallery: eight apps, distinct everything", () => {
    expect(LIVE_DEMO_APPS.length).toBeGreaterThanOrEqual(8);
    const routes = new Set(LIVE_DEMO_APPS.map((a) => a.route));
    const posters = new Set(LIVE_DEMO_APPS.map((a) => a.poster));
    const resets = new Set(LIVE_DEMO_APPS.map((a) => a.resetType));
    const docs = new Set(LIVE_DEMO_APPS.map((a) => a.receipt.receiptDoc));
    expect(routes.size).toBe(LIVE_DEMO_APPS.length);
    expect(posters.size).toBe(LIVE_DEMO_APPS.length);
    expect(resets.size).toBe(LIVE_DEMO_APPS.length);
    expect(docs.size).toBe(LIVE_DEMO_APPS.length);
    // every receipt doc is an https link (the receipt lives in the repo)
    for (const a of LIVE_DEMO_APPS) {
      expect(a.receipt.receiptDoc.startsWith("https://")).toBe(true);
      expect(a.url).toContain(a.route.replace("/", "") + "?embed=1");
    }
    // The cadence entry is present with its own reset type.
    const cadence = LIVE_DEMO_APPS.find((a) => a.id === "cadence");
    expect(cadence).toBeTruthy();
    expect(cadence!.resetType).toBe("cadence-reset");
    expect(cadence!.route).toBe("/cadence");
    expect(cadence!.url).toContain("cadence?embed=1");
    expect(cadence!.receipt.receiptDoc).toBeDefined();
    // The parley entry is present with its own reset type.
    const parley = LIVE_DEMO_APPS.find((a) => a.id === "parley");
    expect(parley).toBeTruthy();
    expect(parley!.resetType).toBe("parley-reset");
    expect(parley!.route).toBe("/parley");
    expect(parley!.url).toContain("parley?embed=1");
    expect(parley!.receipt.receiptDoc).toContain("parley-demo-session.md");
    // The fugue entry (the SOTA round) is present with its own reset type.
    const fugue = LIVE_DEMO_APPS.find((a) => a.id === "fugue");
    expect(fugue).toBeTruthy();
    expect(fugue!.resetType).toBe("fugue-reset");
    expect(fugue!.route).toBe("/fugue/flows");
    expect(fugue!.url).toContain("fugue/flows?embed=1");
    expect(fugue!.receipt.receiptDoc).toContain("fugue-demo-session.md");
    // The aria entry (the aria round) is present with its own reset type.
    const aria = LIVE_DEMO_APPS.find((a) => a.id === "aria");
    expect(aria).toBeTruthy();
    expect(aria!.resetType).toBe("aria-reset");
    expect(aria!.route).toBe("/aria");
    expect(aria!.url).toContain("aria?embed=1");
    expect(aria!.receipt.receiptDoc).toContain("aria-demo-session.md");
    // The nocturne entry (the nocturne round, gallery app #7) is present
    // with its own reset type and a counted receipt block.
    const nocturne = LIVE_DEMO_APPS.find((a) => a.id === "nocturne");
    expect(nocturne).toBeTruthy();
    expect(nocturne!.resetType).toBe("nocturne-reset");
    expect(nocturne!.route).toBe("/nocturne");
    expect(nocturne!.url).toContain("nocturne?embed=1");
    expect(nocturne!.poster).toBe("/landing/nocturne/poster.png");
    expect(nocturne!.receipt.receiptDoc).toContain("nocturne-demo-session.md");
    // the counted receipts (the round's CP1–CP4 + the ledger)
    expect(nocturne!.receipt.sessions).toBe(28);
    expect(nocturne!.receipt.files).toBe(104);
    expect(nocturne!.receipt.tests).toBe(473);
    expect(nocturne!.receipt.commits).toBe(8);
  });

  test("every receipt chip reads from the ACTIVE app's data — switching tabs swaps the counts", () => {
    const { container } = render(<LiveDemoSection />);
    const first = LIVE_DEMO_APPS[0];
    const second = LIVE_DEMO_APPS[1];
    const text = () => container.textContent ?? "";
    expect(text()).toContain(`${first.receipt.sessions} sessions`);
    expect(text()).toContain(`~${first.receipt.toolCalls} tool calls`);
    expect(text()).toContain(`${first.receipt.tests} tests`);
    expect(text()).toContain(`${first.receipt.commits} commits`);
    expect(text()).toContain(`${first.receipt.embeddingAdaptations} documented`);

    // switch to the second app — the chips swap to ITS receipt
    const tabs = within(container as HTMLElement).getAllByRole("tab");
    expect(tabs.length).toBe(LIVE_DEMO_APPS.length);
    fireEvent.click(tabs[1]);
    expect(text()).toContain(`${second.receipt.toolCalls} tool calls`);
    expect(text()).toContain(`${second.receipt.tests} tests`);
    expect(text()).toContain(`${second.receipt.commits} commits`);
    expect(text()).not.toContain(`~${first.receipt.toolCalls} tool calls`);
  });

  test("every poster exists on disk with the real intrinsic dimensions", () => {
    for (const app of LIVE_DEMO_APPS) {
      const buf = readFileSync(posterPath(app));
      const [w, h] = pngSize(buf);
      // the posters are shot at 1440x900 @2x (see scripts/landing_demo_poster.mjs)
      expect(w).toBe(2880);
      expect(h).toBe(1800);
    }
  });

  test("the iframe is absent until mounted, then carries the active app's src", async () => {
    const { container } = render(<LiveDemoSection />);
    expect(container.querySelector("iframe")).toBeNull();
    const loader = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Load the"]',
    );
    expect(loader).toBeTruthy();
    expect(loader?.textContent).toContain("load the live demo");
    fireEvent.click(loader!);
    await waitFor(() => {
      const frame = container.querySelector<HTMLIFrameElement>("iframe");
      expect(frame).toBeTruthy();
      expect(frame?.getAttribute("src")).toBe(`${LIVE_DEMO_APPS[0].route}?embed=1`);
      expect(frame?.getAttribute("title")).toContain(LIVE_DEMO_APPS[0].name);
      expect(frame?.getAttribute("sandbox")).toContain("allow-same-origin");
    });
  });

  test("the reset handshake posts the ACTIVE app's pair with a pinned origin", async () => {
    const postMessage = mock((_data: unknown, _origin?: string) => {});
    const { container } = render(<LiveDemoSection />);
    // mount first (reset is disabled until then)
    fireEvent.click(container.querySelector('button[aria-label^="Load the"]')!);
    await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    // stub the frame's contentWindow.postMessage (the happy-dom frame has
    // no real browsing context)
    Object.defineProperty(frame, "contentWindow", {
      value: { postMessage },
      configurable: true,
    });
    fireEvent.click(
      within(container as HTMLElement).getByRole("button", { name: /^reset/i }),
    );
    expect(postMessage).toHaveBeenCalledTimes(1);
    // the payload is the documented pair; the origin is this origin, NEVER "*"
    const [payload, origin] = postMessage.mock.calls[0] as [
      { source: string; type: string },
      string,
    ];
    expect(payload).toEqual({
      source: "unown-landing",
      type: LIVE_DEMO_APPS[0].resetType,
    });
    expect(origin).toBe(window.origin);
    expect(origin).not.toBe("*");

    // switching apps re-points the handshake at the second app's type
    postMessage.mockClear();
    fireEvent.click(within(container as HTMLElement).getAllByRole("tab")[1]);
    fireEvent.click(
      within(container as HTMLElement).getByRole("button", { name: /^reset/i }),
    );
    const [p2, o2] = postMessage.mock.calls[0] as [{ type: string }, string];
    expect(p2.type).toBe(LIVE_DEMO_APPS[1].resetType);
    expect(o2).not.toBe("*");

    // Switch to the cadence app — the handshake posts the cadence reset
    // payload with a pinned origin.
    postMessage.mockClear();
    const tabs = within(container as HTMLElement).getAllByRole("tab");
    const cadenceTab = tabs.findIndex((t) => t.textContent === "Cadence");
    if (cadenceTab >= 0) {
      fireEvent.click(tabs[cadenceTab]);
      fireEvent.click(
        within(container as HTMLElement).getByRole("button", { name: /^reset/i }),
      );
      const [p3, o3] = postMessage.mock.calls[0] as [{ source: string; type: string }, string];
      expect(p3.source).toBe("unown-landing");
      expect(p3.type).toBe("cadence-reset");
      expect(o3).toBe(window.origin);
      expect(o3).not.toBe("*");
    }

    // Switch to the parley app — the handshake posts the parley-reset
    // payload with a pinned origin (the fourth gallery app).
    postMessage.mockClear();
    const parleyTab = tabs.findIndex((t) => t.textContent === "Parley");
    if (parleyTab >= 0) {
      fireEvent.click(tabs[parleyTab]);
      fireEvent.click(
        within(container as HTMLElement).getByRole("button", { name: /^reset/i }),
      );
      const [p4, o4] = postMessage.mock.calls[0] as [{ source: string; type: string }, string];
      expect(p4.source).toBe("unown-landing");
      expect(p4.type).toBe("parley-reset");
      expect(o4).toBe(window.origin);
      expect(o4).not.toBe("*");
    }

    // Switch to the aria app — the handshake posts the aria-reset
    // payload with a pinned origin (the sixth gallery app).
    postMessage.mockClear();
    const ariaTab = tabs.findIndex((t) => t.textContent === "Aria");
    if (ariaTab >= 0) {
      fireEvent.click(tabs[ariaTab]);
      fireEvent.click(
        within(container as HTMLElement).getByRole("button", { name: /^reset/i }),
      );
      const [p5, o5] = postMessage.mock.calls[0] as [{ source: string; type: string }, string];
      expect(p5.source).toBe("unown-landing");
      expect(p5.type).toBe("aria-reset");
      expect(o5).toBe(window.origin);
      expect(o5).not.toBe("*");
    }

    // Switch to the nocturne app — the handshake posts the nocturne
    // payload with a pinned origin (the seventh gallery app).
    postMessage.mockClear();
    const nocturneTab = tabs.findIndex((t) => t.textContent === "Nocturne");
    if (nocturneTab >= 0) {
      fireEvent.click(tabs[nocturneTab]);
      fireEvent.click(
        within(container as HTMLElement).getByRole("button", { name: /^reset/i }),
      );
      const [p6, o6] = postMessage.mock.calls[0] as [{ source: string; type: string }, string];
      expect(p6.source).toBe("unown-landing");
      expect(p6.type).toBe("nocturne-reset");
      expect(o6).toBe(window.origin);
      expect(o6).not.toBe("*");
    }
  });

  test("the mobile story is the poster + the app's own route link, never a cramped frame", () => {
    const { container } = render(<LiveDemoSection />);
    const mobile = container.querySelector('a[href="/demo"][target="_blank"]');
    expect(mobile).toBeTruthy();
    expect(mobile?.textContent).toContain("tap to try it live");
    // the desktop iframe host is hidden below sm (class-level contract)
    const host = container.querySelector("div.relative");
    expect(host?.className).toContain("hidden sm:block");
  });
});
