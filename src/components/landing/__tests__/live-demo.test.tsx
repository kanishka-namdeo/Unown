// live-demo.test.tsx — the live-demo band's contract (2026-10-28 round).
//
// The band iframes the /demo route (the app one unown session wrote) in
// browser chrome. What this suite pins:
//   - the section exists with the aqua hue and the #live-demo anchor the
//     nav points at;
//   - the receipt chips read from live-demo-data.ts — every count the band
//     prints is the receipt's count (drift between the copy and the data
//     file is exactly the hand-typed-number defect the honesty rules
//     forbid);
//   - the poster exists on disk and its <img> carries the real intrinsic
//     dimensions (the dex-media pattern — a missing or mis-sized poster is
//     a layout shift, not just a broken image);
//   - the iframe is absent until mounted (the lazy contract: an idle visit
//     never pays the demo's hydration cost) and mounts on demand;
//   - the reset handshake posts the documented {source, type} pair;
//   - the mobile story is the poster + a /demo link, never a cramped frame.
import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LiveDemoSection } from "../live-demo";
import { LIVE_DEMO_RECEIPT } from "../live-demo-data";

// The composition root's animate shim (see landing-page.test.tsx).
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const POSTER = resolve(
  import.meta.dir.slice(0, import.meta.dir.indexOf("/src/") + 1),
  "public/landing/demo/poster.png",
);

/** PNG IHDR width/height reader — the dex-media trick, no image lib needed. */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("live-demo band", () => {
  test("renders the section with the aqua hue, its anchor, and the browser-chrome URL bar", () => {
    const { container } = render(<LiveDemoSection />);
    const section = container.querySelector("section#live-demo");
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-hue")).toBe("aqua");
    // the URL bar names the real route, truthfully
    expect(section?.textContent).toContain("unown-nine.vercel.app/demo?embed=1");
  });

  test("every receipt chip reads from the data file — no hand-typed counts", () => {
    const { container } = render(<LiveDemoSection />);
    const text = container.textContent ?? "";
    expect(text).toContain(`${LIVE_DEMO_RECEIPT.sessions} sessions`);
    expect(text).toContain(`~${LIVE_DEMO_RECEIPT.toolCalls} tool calls`);
    expect(text).toContain(`${LIVE_DEMO_RECEIPT.files} files`);
    expect(text).toContain(`${LIVE_DEMO_RECEIPT.tests} tests green`);
    expect(text).toContain(`${LIVE_DEMO_RECEIPT.commits} commits`);
    // the honest embedding-adaptations note
    expect(text).toContain(`${LIVE_DEMO_RECEIPT.embeddingAdaptations} documented`);
    // the receipt link points at the session record
    const receipt = within(container as HTMLElement).getByRole("link", { name: "the receipt" });
    expect(receipt.getAttribute("href")).toBe(LIVE_DEMO_RECEIPT.receiptDoc);
  });

  test("the poster exists with the dimensions the <img> declares", () => {
    const buf = readFileSync(POSTER);
    const [w, h] = pngSize(buf);
    expect(w).toBe(1440 * 2); // device scale 2 capture lane
    expect(h).toBe(900 * 2);
    const { container } = render(<LiveDemoSection />);
    const img = container.querySelector<HTMLImageElement>('img[src="/landing/demo/poster.png"]');
    expect(img).toBeTruthy();
    expect(Number(img?.getAttribute("width"))).toBe(1440);
    expect(Number(img?.getAttribute("height"))).toBe(900);
  });

  test("the iframe is absent until mounted; clicking the poster mounts it with the sandbox contract", async () => {
    const { container } = render(<LiveDemoSection />);
    expect(container.querySelector("iframe")).toBeNull();
    const trigger = within(container as HTMLElement).getByRole("button", { name: /load the live demo/i });
    fireEvent.click(trigger);
    await waitFor(() => {
      const frame = container.querySelector<HTMLIFrameElement>("iframe");
      expect(frame).toBeTruthy();
      expect(frame?.getAttribute("src")).toBe("/demo?embed=1");
      expect(frame?.getAttribute("title")).toBeTruthy();
      expect(frame?.getAttribute("loading")).toBe("lazy");
      const sandbox = frame?.getAttribute("sandbox") ?? "";
      for (const token of ["allow-scripts", "allow-same-origin", "allow-forms", "allow-modals"]) {
        expect(sandbox).toContain(token);
      }
    });
  });

  test("reset posts the documented handshake and is disabled until the frame mounts", async () => {
    const postMessage = mock((_data: unknown, _origin?: string) => {});
    const { container } = render(<LiveDemoSection />);
    const reset = within(container as HTMLElement).getByRole("button", { name: /reset the demo board/i });
    expect(reset.hasAttribute("disabled")).toBe(true); // no frame yet
    fireEvent.click(within(container as HTMLElement).getByRole("button", { name: /load the live demo/i }));
    await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    // stub the frame's contentWindow.postMessage
    Object.defineProperty(frame, "contentWindow", {
      value: { postMessage },
      configurable: true,
    });
    const resetAfter = within(container as HTMLElement).getByRole("button", { name: /reset the demo board/i });
    expect(resetAfter.hasAttribute("disabled")).toBe(false);
    fireEvent.click(resetAfter);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({
      source: "unown-landing",
      type: "sigil-reset",
    });
  });

  test("the mobile story is the poster linking to /demo — never a frame below sm", () => {
    const { container } = render(<LiveDemoSection />);
    const mobileLink = container.querySelector<HTMLAnchorElement>('a[href="/demo"][target="_blank"]');
    expect(mobileLink).toBeTruthy();
    expect(mobileLink?.querySelector("img")).toBeTruthy();
    expect(mobileLink?.textContent).toContain("tap to try it live");
    // the frame host is desktop-only
    const frameHost = container.querySelector("div.relative.hidden.sm\\:block");
    expect(frameHost).toBeTruthy();
  });
});
