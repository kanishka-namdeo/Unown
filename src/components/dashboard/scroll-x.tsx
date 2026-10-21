"use client";

// ScrollX — a horizontal scroll container that TELLS you it scrolls
// (audit M4-b: the benchmark table packs 720px into a 375px viewport with a
// bare overflow-x-auto — the Pass/Fail column starts off-screen and nothing
// hints at it). A right-edge gradient fades in while more content exists to
// the right and disappears at the end of the scroll; a one-time "swipe" hint
// chip does the same for touch users. ResizeObserver-driven, pointer-safe,
// zero layout shift (the fade overlays, never pushes).

import * as React from "react";
import { cn } from "@/lib/utils";

export function ScrollX({
  children,
  className,
  hint = "swipe for more",
}: {
  children: React.ReactNode;
  className?: string;
  /** Shown once (per mount) while the content overflows and hasn't scrolled. */
  hint?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"idle" | "overflowing" | "scrolled" | "end">("idle");

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflowing = el.scrollWidth - el.clientWidth > 8;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    if (!overflowing) setState("idle");
    else if (atEnd) setState("end");
    else if (el.scrollLeft > 8) setState("scrolled");
    else setState("overflowing");
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // content resize (table rows load) also changes scrollWidth
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={measure}
        className={cn("scroll-thin overflow-x-auto", className)}
      >
        {children}
      </div>
      {/* right-edge fade: present while content exists past the fold */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-zinc-950 to-transparent transition-opacity duration-200",
          state === "overflowing" || state === "scrolled" ? "opacity-100" : "opacity-0",
        )}
      />
      {/* one-time touch hint */}
      {state === "overflowing" && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-2 right-2 z-10 rounded-full border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-400"
        >
          {hint} →
        </span>
      )}
    </div>
  );
}
