"use client";

import * as React from "react";
import { CopyButton } from "./shell";

/* ------------------------------------------------------------------ */
/* the per-OS install variants                                         */
/* ------------------------------------------------------------------ */

export type OsKey = "macos" | "linux" | "windows";

/**
 * The one-line installer (`public/install.sh`, served by the site deployment,
 * documented in docs/install.md): refuses root, checks git, adds bun when it
 * is missing, clones, and runs the repo's own installer. macOS and Linux both
 * speak sh, so both tabs carry the same command — their sandbox backends are
 * what differ.
 */
const INSTALLER_ONE_LINER =
  "curl -fsSL https://unown-nine.vercel.app/install.sh | sh";

/**
 * The Windows one-liner installer (public/install.ps1 — same contract as the
 * POSIX script: refuses elevation, checks git, adds bun via bun's own
 * PowerShell installer when missing, clones, runs agent:install).
 */
const INSTALLER_ONE_LINER_PS =
  "irm https://unown-nine.vercel.app/install.ps1 | iex";

/**
 * The manual path, byte-identical to the README quickstart and
 * docs/install.md's manual section — every OS tab carries it as the
 * alternative (docs/install.md#manual-install-git-clone).
 */
const MANUAL_ONE_LINER =
  "git clone https://github.com/kanishka-namdeo/Unown.git && cd Unown && bun run agent:install";

/**
 * Sandbox backends quoted from the page's own prerequisite table
 * (`quickstart.tsx`), which the engine implements per platform:
 * `resolveOsSandboxBackend()` in `pi-repo/packages/self-learning/src/bwrap.ts`
 * returns bwrap on Linux, seatbelt on darwin, and null on win32 (where the
 * in-process path jail runs). Same three facts the page has always claimed —
 * the tabs just say the visitor's one out loud.
 */
const VARIANTS: { key: OsKey; label: string; cmd: string; note: React.ReactNode }[] = [
  {
    key: "macos",
    label: "macOS",
    cmd: INSTALLER_ONE_LINER,
    note: (
      <>
        refuses root, checks git, adds bun when it is missing · sandbox:{" "}
        <span className="text-ink">Seatbelt</span>
      </>
    ),
  },
  {
    key: "linux",
    label: "Linux",
    cmd: INSTALLER_ONE_LINER,
    note: (
      <>
        refuses root, checks git, adds bun when it is missing · sandbox:{" "}
        <span className="text-ink">bubblewrap</span>
      </>
    ),
  },
  {
    key: "windows",
    label: "Windows",
    cmd: INSTALLER_ONE_LINER_PS,
    note: (
      <>
        refuses elevation, checks git, adds bun when it is missing · sandbox:{" "}
        <span className="text-ink">in-process jail</span>
      </>
    ),
  },
];

/**
 * Pure OS sniff so the tabs default to the visitor's platform without gating
 * anything (the Bun/Deno/uv pattern from the landing research: auto-defaulting
 * tabs, manual override one click away). Order is load-bearing: the windows
 * probe looks for whole tokens because bare `win` is a substring of `darwin`.
 * Exported for the copy tests, which pin every branch.
 */
export function detectOS(platform: string | undefined, ua: string): OsKey {
  const hay = `${platform ?? ""} ${ua}`.toLowerCase();
  if (hay.includes("windows") || hay.includes("win32") || hay.includes("win64")) {
    return "windows";
  }
  if (
    hay.includes("mac os") ||
    hay.includes("macintosh") ||
    hay.includes("darwin") ||
    hay.includes("iphone") ||
    hay.includes("ipad")
  ) {
    return "macos";
  }
  if (
    hay.includes("linux") ||
    hay.includes("cros") ||
    hay.includes("x11") ||
    hay.includes("android") ||
    hay.includes("ubuntu")
  ) {
    return "linux";
  }
  return "macos";
}

/* ------------------------------------------------------------------ */
/* the panel                                                           */
/* ------------------------------------------------------------------ */

/**
 * The hero's install chip, one command per OS tab.
 *
 * Server-rendered default is macOS, so the static HTML and the first client
 * render agree (no hydration mismatch); after mount the tab auto-switches to
 * what `detectOS()` reads from the user agent unless the visitor already
 * picked one. Visitors without JavaScript see the macOS variant — the same
 * trade every tabbed install widget makes, and the manual path stays one tab
 * away (and in quickstart, the very next section).
 *
 * Tabs follow the WAI-ARIA tabs pattern with a roving tabindex, mirroring
 * `loop.tsx`'s stage tabs; the active marker is a gold bar plus a fill step,
 * never colour alone.
 */
export function InstallPanel() {
  const [os, setOs] = React.useState<OsKey>("macos");
  const touched = React.useRef(false);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);

  React.useEffect(() => {
    if (touched.current) return;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setOs(detectOS(nav.userAgentData?.platform, nav.userAgent));
  }, []);

  const activeIndex = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === os),
  );
  const active = VARIANTS[activeIndex];

  function onKeyDown(e: React.KeyboardEvent) {
    const last = VARIANTS.length - 1;
    let next = activeIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = activeIndex === last ? 0 : activeIndex + 1;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = activeIndex === 0 ? last : activeIndex - 1;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = last;
    } else {
      return;
    }
    e.preventDefault();
    touched.current = true;
    setOs(VARIANTS[next].key);
    tabs.current[next]?.focus();
  }

  return (
    <div className="gb-panel mt-8 max-w-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          install · one command
        </span>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Operating system"
            onKeyDown={onKeyDown}
            className="flex items-center gap-px"
          >
            {VARIANTS.map((v, i) => {
              const on = v.key === active.key;
              return (
                <button
                  key={v.key}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`os-tab-${v.key}`}
                  aria-selected={on}
                  aria-controls="os-install-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => {
                    touched.current = true;
                    setOs(v.key);
                  }}
                  className={`relative px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors [transition-timing-function:steps(2,end)] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                    on ? "bg-panel-2 text-ink" : "text-faint hover:text-dim"
                  }`}
                >
                  {v.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 bottom-0 h-0.5 ${on ? "bg-gold" : "bg-transparent"}`}
                  />
                </button>
              );
            })}
          </div>
          <CopyButton text={active.cmd} label={`Copy the ${active.label} install command`} />
        </div>
      </div>

      <div role="tabpanel" id="os-install-panel" aria-labelledby={`os-tab-${active.key}`}>
        <pre
          tabIndex={0}
          aria-label={`terminal — install unown on ${active.label}`}
          className="term-lines overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {active.cmd}
        </pre>
        <p className="border-t border-line px-3 py-2 font-mono text-[11px] leading-relaxed text-dim">
          {active.note}
        </p>
      </div>

      <p className="border-t border-line px-3 py-2 font-mono text-[11px] leading-relaxed text-dim">
        {"then: "}
        <span className="text-ink">unown setup</span>
        <span className="text-faint"> {"\u2192"} </span>
        <span className="text-ink">bun run agent:start</span>
        <span className="text-faint"> {"\u2192"} </span>
        <span className="text-ink">unown</span>
      </p>
    </div>
  );
}
