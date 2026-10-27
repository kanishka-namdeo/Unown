"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { LIVE_DEMO_RECEIPT as R } from "./live-demo-data";
import { FadeUp, SectionHead, TrafficDots } from "./shell";

/**
 * The live demo — what the agent builds, running in the visitor's browser.
 *
 * No terminal-agent competitor ships this: their landing pages show videos
 * of the agent working; this one runs the artifact. The section iframes
 * /demo?embed=1 — the Sigil Focus app one unown session wrote end-to-end
 * (receipts in live-demo-data.ts) — in a browser-chrome frame, lazy-mounted
 * (the poster still is a real capture of the same route via
 * scripts/landing_demo_poster.mjs), with a working Reset (a postMessage
 * handshake the demo listens for in embed mode) and a full-screen escape
 * hatch (the route itself, opened in a new tab).
 *
 * Contract notes:
 *  - The iframe mounts ONLY when scrolled near or clicked (an idle landing
 *    visit never pays the demo's hydration cost; the poster carries the
 *    first impression). `loading="lazy"` is belt-and-braces.
 *  - The frame is same-origin (/demo on this deployment), sandboxed with
 *    allow-same-origin + allow-scripts so the app's localStorage works and
 *    the reset handshake can flow.
 *  - Below sm, the frame is replaced by the poster + a "tap to try it
 *    live" link to /demo — a 390px iframe of a 4-column board is a
 *    punishment, not a demo (the app itself collapses to tabs there).
 *  - Every number in the chips row reads from the receipt data file; the
 *    test suite pins the section against that file (no hand-typed counts).
 */

/** The demo's URL bar — the deployment's own route, truthfully shown. */
const DEMO_URL = "unown-nine.vercel.app/demo?embed=1";

export function LiveDemoSection() {
  const [mounted, setMounted] = useState(false);
  const frameHostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Lazy mount: one IntersectionObserver, armed once, mounts when the band
  // is one viewport away (rootMargin). A click mounts immediately.
  useEffect(() => {
    const host = frameHostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          io.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(host);
    return () => io.disconnect();
  }, []);

  const resetDemo = () => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "unown-landing", type: "sigil-reset" },
      "*",
    );
  };

  return (
    <section
      data-hue="aqua"
      id="live-demo"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="Live demo">
            The agent built this. It&apos;s running.
          </SectionHead>
          {/* One line, on purpose: the frame below IS the feature list —
              the scroll budget contract makes the band pay for its own
              height, and every word here is one the frame shows for free. */}
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
            One unown session, start to finish. Not a video: drag a card,
            start the timer, break it if you can.
          </p>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          <div className="gb-panel lift overflow-hidden">
            {/* Browser chrome: the Gen-3 name strip carries the URL bar —
                the one honest signal that this is a real deployed route. */}
            <div className="gb-bar flex items-center gap-3 px-3 py-2">
              <TrafficDots />
              <div className="flex min-w-0 flex-1 justify-center">
                <span className="gb-label truncate text-[9px] text-canvas">
                  {DEMO_URL}
                </span>
              </div>
              <div className="flex min-w-[28px] items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={resetDemo}
                  disabled={!mounted}
                  className="flex items-center gap-1 font-mono text-[9px] text-canvas/80 underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50"
                  aria-label="Reset the demo board to its seeded state"
                  title="Reset the demo board"
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  reset
                </button>
              </div>
            </div>

            {/* Desktop: the frame (poster until mounted). */}
            <div ref={frameHostRef} className="relative hidden sm:block">
              {mounted ? (
                <iframe
                  ref={iframeRef}
                  src="/demo?embed=1"
                  title="Sigil Focus — the app unown built, running live"
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                  className="block h-[540px] w-full border-0 bg-black"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setMounted(true)}
                  className="group relative block h-[540px] w-full"
                  aria-label="Load the live demo — the app unown built, running in your browser"
                >
                  {/* The poster fills the FRAME's height (object-cover,
                object-top: the board lives in the top of the shot), so the
                band never shifts when the iframe swaps in — and the
                un-mounted band is exactly as tall as the mounted one. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- a
                      static poster, not an authored art asset: the capture
                      lane writes it (scripts/landing_demo_poster.mjs). */}
                  <img
                    src="/landing/demo/poster.png"
                    alt="Sigil Focus — the kanban board app unown built: four columns with seeded demo tasks, focus timer and stats"
                    width={1440}
                    height={900}
                    className="block h-full w-full object-cover object-top"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-canvas/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="gb-label rounded bg-canvas px-3 py-2 text-[10px] text-ink">
                      load the live demo
                    </span>
                  </span>
                </button>
              )}
            </div>

            {/* Mobile: the poster + the escape hatch (a 390px frame of a
                four-column board is a punishment; the app collapses to
                tabs at that width — take it full screen instead). */}
            <a
              href="/demo"
              target="_blank"
              rel="noreferrer noopener"
              className="relative block h-[420px] sm:hidden"
              aria-label="Open the live demo app full screen in a new tab"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- capture-lane poster, as above. */}
              <img
                src="/landing/demo/poster.png"
                alt="Sigil Focus — the kanban board app unown built"
                width={1440}
                height={900}
                loading="lazy"
                className="block h-full w-full object-cover object-top"
              />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-canvas/85 py-3 gb-label text-[10px] text-ink">
                tap to try it live
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </span>
            </a>
          </div>

          {/* The receipt chips — every count reads off the data file. */}
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] text-faint">
            <span>
              {R.sessions} sessions · ~{R.toolCalls} tool calls · {R.files}{" "}
              files · {R.tests} tests green · {R.commits} commits
            </span>
            <a
              href={R.receiptDoc}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 transition-colors hover:text-gold"
            >
              the receipt
            </a>
            <a
              href="/demo"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-gold"
            >
              open full screen
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          </p>
          {/* The honesty note joins the chips row — the band pays for its
              height; the patch details live in the receipt doc. */}
          <p className="mt-2 font-mono text-[10px] text-faint">
            agent-written as built · {R.embeddingAdaptations} documented
            embedding patches (list in the receipt)
          </p>
        </FadeUp>
      </div>
    </section>
  );
}
