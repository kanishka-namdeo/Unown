"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { LIVE_DEMO_APPS } from "./live-demo-data";
import { FadeUp, SectionHead, TrafficDots } from "./shell";

/**
 * The live demo — what the agent builds, running in the visitor's browser.
 *
 * The commerce round (2026-10-28) turned the band into a GALLERY: two
 * agent-built apps, each iframed from its own route in browser chrome, one
 * switcher — the v0-templates pattern (one live deployment per artifact,
 * switchable in place; see docs/live-preview-competitor-research.md).
 * The cadence round added a third app; the parley round added the fourth:
 *
 *   · Sigil Focus  — /demo (the kanban round: one prompt, four sessions)
 *   · Sigil Bazaar  — /bazaar (the commerce round: planned → reviewed →
 *     browser-QA'd; storefront, checkout wizard, owner analytics)
 *   · Cadence  — /cadence (the cadence round: habit & streak tracker,
 *     dashboard check-offs with 52-week heatmap and stats)
 *   · Parley  — /parley (the parley round: multi-tenant support-inbox
 *     SaaS, RBAC-gated inbox + admin surfaces + customer portal, live
 *     demo auto-login + the parley-reset handshake)
 *   · Aria  — /aria (the aria round: the enterprise CRM — accounts, deals,
 *     sequences and forecasts, fail-closed tenancy + RBAC, the live
 *     demo auto-login + the aria-reset handshake)
 *
 * Contract notes:
 *  - The frame mounts ONLY when scrolled near or clicked (an idle landing
 *    visit never pays the demo's hydration cost; the active app's poster
 *    carries the first impression). Switching apps swaps the iframe src in
 *    place — no remount, the second app's first paint is a src change.
 *  - The frame is same-origin (each app on this deployment), sandboxed with
 *    allow-same-origin + allow-scripts so the app's localStorage works and
 *    the reset handshake can flow.
 *  - The reset handshake posts the ACTIVE app's documented {source, type}
 *    pair with targetOrigin = this origin — never "*" (MDN's rule; a stray
 *    window in the hierarchy can postMessage a child, the origin check is
 *    the defense).
 *  - Below sm, the frame is replaced by the poster + a tap-through link to
 *    the app's own route — a 390px iframe of a storefront is a punishment,
 *    not a demo (both apps collapse to tabs/sheets there).
 *  - Every number in the chips row reads from the active app's receipt in
 *    live-demo-data.ts; the test suite pins the band against that file (no
 *    hand-typed counts).
 */

export function LiveDemoSection() {
  const [activeId, setActiveId] = useState(LIVE_DEMO_APPS[0].id);
  const active = LIVE_DEMO_APPS.find((a) => a.id === activeId) ?? LIVE_DEMO_APPS[0];
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
    // The handshake pairs are the apps' documented contracts; the origin is
    // pinned (never "*" — the 2026-10-28 hardening round).
    iframeRef.current?.contentWindow?.postMessage(
      { source: "unown-landing", type: active.resetType },
      window.origin,
    );
  };

  const R = active.receipt;

  return (
    <section
      data-hue="aqua"
      id="live-demo"
      className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="Live demo">
            The agent built these. They run.
          </SectionHead>
          {/* One line, on purpose: the frame below IS the feature list —
              the scroll budget contract makes the band pay for its own
              height, and every word here is one the frame shows for free. */}
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
            Nine apps, live. Pick one.
          </p>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          {/* The switcher + the browser chrome bar share one row: the app
              tabs left, the URL bar (the one honest signal that this is a
              real deployed route) right. */}
          <div className="gb-panel lift overflow-hidden">
            <div className="gb-bar flex items-center gap-2 px-3 py-2">
              <TrafficDots />
              {/* The honest status light: the frame below is a real route
                  running live in the visitor's browser, and the chip says so
                  in the same idiom the session replay's cursor blinks in —
                  an opaque pill on full-strength tokens (the gallery round's
                  axe lesson: never a translucent chip on this bar), a
                  blinking square that stills under reduced motion, and the
                  one word this round adds to the page. */}
              <span className="inline-flex shrink-0 items-center gap-1.5 border border-gold bg-panel px-1.5 py-[3px] leading-none">
                <span className="gb-cont size-1.5 bg-gold" aria-hidden="true" />
                <span className="gb-label text-[8px] text-gold">Live</span>
              </span>
              <div
                className="flex min-w-0 flex-1 items-center gap-1"
                role="tablist"
                aria-label="Live demo apps"
              >
                {LIVE_DEMO_APPS.map((app) => {
                  const selected = app.id === active.id;
                  return (
                    <button
                      key={app.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveId(app.id)}
                      className={
                        // Opaque pill, never a translucent overlay: axe
                        // computes the effective contrast THROUGH an alpha
                        // background (bg-ink/15 over the aqua bar read
                        // 1.73:1 — the gallery round's a11y gate caught it).
                        "rounded-md px-2.5 py-1 text-[11px] transition-colors " +
                        (selected
                          ? "bg-canvas font-semibold text-ink"
                          : "text-canvas hover:underline underline-offset-2")
                      }
                    >
                      {app.name}
                    </button>
                  );
                })}

              </div>
              <div className="flex min-w-[120px] items-center justify-end gap-2">
                <span className="gb-label hidden truncate text-[9px] text-canvas lg:inline">
                  {active.url}
                </span>
                <button
                  type="button"
                  onClick={resetDemo}
                  disabled={!mounted}
                  className="flex items-center gap-1 font-mono text-[9px] text-canvas/80 underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50"
                  aria-label={`Reset the ${active.name} demo to its seeded state`}
                  title={`Reset the ${active.name} demo`}
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  reset
                </button>
              </div>
            </div>

            {/* Desktop: the frame (the active app's poster until mounted). */}
            <div ref={frameHostRef} className="relative hidden sm:block">
              {mounted ? (
                /* One persistent frame: switching apps swaps its src (a
                   same-origin navigation), never a remount — the sandbox
                   attrs stay identical, the ref stays live, and the reset
                   handshake keeps pointing at the same browsing context. */
                <iframe
                  ref={iframeRef}
                  src={`${active.route}?embed=1`}
                  title={`${active.name} — the app unown built, running live`}
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  className="block h-[540px] w-full border-0 bg-black"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setMounted(true)}
                  className="group relative block h-[540px] w-full"
                  aria-label={`Load the ${active.name} live demo — the app unown built, running in your browser`}
                >
                  {/* The poster fills the FRAME's height (object-cover,
                object-top: the app lives in the top of the shot), so the
                band never shifts when the iframe swaps in — and the
                un-mounted band is exactly as tall as the mounted one. */}
                  { }
                  <img
                    src={active.poster}
                    alt={active.posterAlt}
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
                storefront is a punishment; both apps collapse to tabs and
                sheets at that width — take it full screen instead). */}
            <a
              href={active.route}
              target="_blank"
              rel="noreferrer noopener"
              className="relative block h-[420px] sm:hidden"
              aria-label={`Open the ${active.name} live demo app full screen in a new tab`}
            >
              { }
              <img
                src={active.poster}
                alt={active.posterAlt}
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
              files · {R.tests} tests · {R.commits} commits
            </span>
            <a
              href={R.receiptDoc}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 transition-colors hover:text-gold"
            >
              receipt
            </a>
            <a
              href={active.route}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-gold"
            >
              full screen
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          </p>
          {/* The honesty note joins the chips row — the band pays for its
              height; the patch details live in the receipt doc. */}
          <p className="mt-2 font-mono text-[10px] text-faint">
            agent-written · {R.embeddingAdaptations} documented
            patches
          </p>
        </FadeUp>
      </div>
    </section>
  );
}
