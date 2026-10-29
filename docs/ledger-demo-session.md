# Ledger — the demo session record

> The receipt behind the gallery's ninth app: the round-2 validation
> website — a fintech treasury dashboard (the mission's PROJECT TYPE 2,
> the one gallery type never exercised), built under the round's new
> capabilities and gated by them from the first iteration. The build
> contract is [`../benchmarks/website-excellence-round-2/ledger-plan.md`](../benchmarks/website-excellence-round-2/ledger-plan.md);
> the critique receipts are
> [`../benchmarks/website-excellence-round-2/critiques/`](../benchmarks/website-excellence-round-2/critiques/).

## The round's capability chain this app exercised

Built in the order the framework prescribes: the
`design-system-generator` skill's procedure produced the token set
BEFORE any component existed (the warm-paper ramp, the closed 9-size
type ramp, the one-accent law, the 3-breakpoint set — the plan §4);
the components followed the `motion-designer` and
`frontend-craftsman` laws (compositing-only animation, the
finished-state-first DOM, explicit transition lists); and every
iteration ran the critic's FULL rubric — the objective gates, the
craft axes and the VLM's seven axes — with receipts committed per run.

## The critique loop (four receipts, the honest trajectory)

| Iteration | Verdict | The findings that mattered |
|---|---|---|
| v0 | FAIL | 132 contrast violations (`#8f8b7c` on paper = 3.24:1); mobile overflow 252px (a grid child's `min-width:auto` around the 640px table); weight 700 ×94 (the sr-only day table's `th` defaults); the tranche spike dwarfing the series (the VLM caught it); **the VLM persona dinged the app for not being the landing's dark GBA brand — a persona bug, not a design defect** |
| iter1 | FAIL (crash) | A render-order TDZ in the chart (`netPath` executing before `yClamped` was defined) — SSR crashed; the audit measured an error shell. Fixed by reordering; also the persona fix: the critic gained `--brand`, because the judge must follow the design language, never the reverse |
| iter2 | FAIL (2 gates) | All VLM axes ≥ 7 for the first time; 6 contrast violations left (the clay link at 3.9:1, the button at 4.31:1); the `transition[-]all` utility still emitted — **the round's own F24 ledger entry quoted the literal token and Tailwind's scanner resurrected it (F25, the F20 trap repeated)** |
| iter3 / final | **PASS** (`--enforce`, exit 0) | Contrast 0 violations (min 4.91); 8 type sizes; 0% off-grid; 0 overflow; FCP/LCP 220ms, CLS 0, TBT 1ms; VLM 7.0–8.23; every craft axis green (weights 400/500/600, tracking 0 offenders, neutral hue 10.0° over 705 grays, 1 accent cluster, 0 anim layout props, 6 breakpoints, prm guard) |

## What the loop taught the platform (the retained learning)

- **F25** — the F20 documentation-quotes-the-utility trap repeated by
  this round's own F24 entry: three tracked files carried the literal
  `transition[-all]` token and re-emitted the banned utility. The
  defusal (bracket-breaking) is now applied at WRITE time in this
  repo, not at gate time.
- **The VLM persona must be brand-scoped** — a judge pinned to one
  design language will fail every other design language on identity,
  not craft. The critic's `--brand` flag is the durable fix, and the
  receipt records which persona scored it.
- **The sr-only data table is a repeat offender class** — its `th`
  defaults trip the weight census and (per F17) its layout box can
  break mobile. The clip-on-a-wrapper rule plus a `font-weight:
  inherit` on scoped tables closes both.
- **A grid child needs `min-width: 0`** the moment a table wider than
  the viewport enters it — the 252px overflow was pure grid
  `min-width: auto`, not the table's fault.

## Where things live

- `src/lib/ledger/` — the domain (types, the deterministic seed, stats, format) + the drift gate (22 assertions: the displayed figures against the seed's arithmetic)
- `src/components/ledger/` — the shell (7 bands), the chart (clamped + annotated), the table (sortable, aria-sort), the primitives
- `src/app/ledger/` — the route (the `?embed=1` server-side read, the scoped stylesheet, the CSP block in `next.config.ts`)
- `public/landing/ledger/poster.png` — the gallery poster (the media lane, real capture)
- `benchmarks/website-excellence-round-2/critiques/ledger-*.json` — the four receipts
