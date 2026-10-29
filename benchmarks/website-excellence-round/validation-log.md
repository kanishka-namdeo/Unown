# The Website Excellence Round — the validation log

> The failure→root-cause→benchmark→improvement→rerun ledger, continuing the
> gallery-round lineage (SOTA F0–F5 → Parley F3–F7 → aria F8 reserved →
> nocturne F8–F13) — so this round's entries start at **F14**. Same rules:
> never patch around a failure; decide where the defect lives (Unown, the
> caller's environment, or the artifact under construction); fix it where
> it lives; create the regression or benchmark that would catch it; rerun
> and record before/after evidence. An entry that ends in "no Unown
> defect" is a valid, wanted outcome.

## Failures

---

## F14 — the design critic photographed only the light scheme (a blind spot in the round's own new tool, found by its first real run)

**Failure (the encore v0 critique).** The critic's first run on `/encore`
(label `encore-v0`, receipt `critiques/20261029-160942-encore-v0-encore.json`)
returned VLM critiques describing "off-white background", "warm paper
background", "pale green" — on a page whose primary experience is the dark
scheme. Playwright's default `colorScheme` is `light`; the critic never
pinned it, so every screenshot (and the baseline landing critique before
it) photographed the light scheme only.

**Reproduction.** Any `page.goto` without `emulateMedia({ colorScheme })`:
playwright renders `prefers-color-scheme: light`, and a dark-first page
that only swaps via the media query renders light.

**Root cause.** Tool defect — `scripts/design_critic.mjs` (this round's own
new lane). The repo's own `contrast_audit.mjs` had already learned this
lesson ("IT AUDITS BOTH SCHEMES… each pass first asserts the scheme's
`--color-canvas` actually resolved"); the new tool didn't inherit it.

**Fix implemented.** `capture()` now pins `colorScheme` per pass: the main
pass is `dark` (the page's first experience), plus a light-scheme twin pass
(full-page shot + audit, bands stay dark-only to bound VLM cost); the
contrast gate sums violations across BOTH schemes; the receipt schema gains
`audit.desktopLight`; the report line prints both minima.

**Benchmark created.** The receipts themselves: `iter0` on `/encore`
(`critiques/20261029-161216-iter0-encore.json`) carries both audits
(dark min 4.69:1 / light 6.71:1, 0 violations) — every future receipt
fails loudly if the light twin ever goes missing (the seed's drift gate
reads these fields).

**Rerun.** The canonical `iter0` receipt covers both schemes; the
light-only `encore-v0` receipt stays committed as this entry's evidence.

---

## F15 — the lib session shipped a wrong expected value and a self-scanning invariant (caught by its own test suite, fixed in a 15-turn resume)

**Failure (E2).** The lib session's first run ended capped at 40 turns with
5 failing tests: `gatePasses` expected the baseline at 9-of-11 gates
passing (the receipt says 8 — `vlmAxes` fails too; the session miscounted
by treating the VLM gate as one bundle with the objective ones), and the
fugue-determinism invariant scanned `*.ts` including its own test file, so
the matcher's literal `Date.now()`/`Math.random()` strings tripped the very
rule they enforce.

**Reproduction.** `bun test src/lib/encore` at the E2 first-cut commit:
`(fail) no lib domain file contains Date.now()` ×2, `(fail) gatePasses >
BASELINE has 9 of 11` ×3.

**Root cause.** App-under-construction defect (the writing session), with
a process accelerant: the turn cap cut the session mid-verification, and a
capped session's last act is a diagnosis, not a fix.

**Fix implemented.** The E2 resume (fed the precise diagnosis, the F9
lesson from the nocturne round): expected values corrected to the
receipt-derived 8 (and the magic number replaced by derivation from the
seed's gate results), the invariant scan scoped to domain files only.
64/64 green after.

**Benchmark created.** The drift-gate suite itself now pins the 8-of-11
count against the real receipt — a future receipt edit or gate miscount
re-fails `seed.test.ts` by construction.

---

## F16 — the production build OOM-killed on the 4GB host (an environment constraint with a documented mitigation, not a code defect)

**Failure (the Phase-4 build).** `bun run build` died with exit 137
(SIGKILL — the OOM killer) with the dev server, the engine and the bridge
all resident.

**Reproduction.** ~2.6GB free + Next.js 16 Turbopack building eight gallery
apps + the landing + the blog: the build's peak exceeds the box.

**Root cause.** Caller-environment constraint. No repo defect — the build
passes with headroom when the box isn't also running a dev server.

**Mitigation adopted (the round's build protocol).** Stop the dev server
before production builds; `NODE_OPTIONS=--max-old-space-size=2048` pins the
node heap. Recorded here so the next session on a small host doesn't
re-diagnose it.

---

## F17 — encore's first build failed the mobile covenant by 42px (found by the critique loop, not by any human — the program working as designed)

**Failure (the iter0 critique).** `mobileOverflow: 42px` — the 390px
covenant broken in the first UI build. The audit's mobile critiques name
the culprit class: unbreakable monospace receipt paths
("benchmarks/website-excellence-round/critiques/20261029-….json") rendering
at full width, wrapping to four vertical lines in cards.

**Reproduction.** The `iter0` receipt's `audit.mobile.overflowX: 42`.

**Root cause.** App defect (the UI sessions rendering full receipt paths
inline). The lib's honesty rule (every number carries its receipt path)
was over-applied to RENDERING: provenance belongs in attributes and links,
not in full-width monospace text.

**Fix implemented.** The E5 session's work order 1: short receipt refs
inline (title attribute carries the full path), plus the work order 2
compare-band redesign to viewport-scale hero shots. Rerun: the `iter1`
receipt (below) is the evidence.

---

## F18 — a contrast "fix" broke the light scheme (the loop caught its own earlier fix one iteration later)

**Failure (the iter2 critique).** After E6's contrast work orders landed,
the iter2 receipt measured **27 light-scheme violations** (min 1.09:1)
against 0 dark-scheme violations. The E6 fix had pinned
`.encore-scope { --color-poke: #ff7362; --color-amber: #ffbd83; }` and
re-anchored the panel tokens "under ANY scheme" — so in light mode the
root scheme correctly flipped the text tokens dark (for the light canvas)
while Encore's panels stayed dark navy: dark-on-dark at 1.67–1.78:1 on
every text-on-panel pairing.

**Reproduction.** The iter2 receipt's `audit.desktopLight.contrast`
(27 entries, all `encore-type-*` classes on panel surfaces).

**Root cause.** App defect, with a process anatomy worth keeping: E6 ran
the critic itself mid-work — its `iter1b` receipt (16:38) measured 0
light violations BEFORE the pins landed; the pins then shipped; its own
follow-up `iter1c` receipt (16:41) measured the 27 violations — and the
session hit its turn cap reacting to a typecheck error first and never
circled back to its own audit data. A clean measurement taken BEFORE a
change does not cover the change; the receipt that mattered (iter1c) was
in hand and unread when the session ended.

**Fix implemented.** E8: the unconditional pins deleted; Encore inherits
the root's dual-declared tokens (the landing's own pattern — dark scheme
renders as before; light scheme renders the landing's light palette);
`color-scheme: dark` unpinned so the page follows the OS scheme.

**Benchmark created.** The iter3 receipt (`critiques/
20261029-170148-iter3-encore.json`): 0 violations in BOTH schemes (dark
min 4.69:1 / light 6.71:1) — the both-scheme contrast gate (F14's fix)
is now load-bearing: a one-scheme fix cannot pass it.

**The loop note worth keeping.** iter2's regression was INTRODUCED by the
fix for iter1's findings, and caught by the very audit lane F14 added
after the tool's own blind spot — the loop policing itself, one
iteration delayed. The alternative (a human eyeballing dark-mode
screenshots) would have shipped the 27 violations.

---

## Positive validations (defects the system caught itself — recorded so the loop's defenses are visible)

- **P14.1 (the baseline's honest numbers).** The very first critique run
  measured the landing page at 23 distinct font sizes and 32.7% off-grid —
  numbers no existing lane could see, on a page six rounds of agent-built
  polish had produced. The calibration fixture then proved the judge
  discriminates (1.5 vs 6.4). The program's instrument validated itself
  before its first work order.

- **P14.2 (the discipline gates held on the first encore build).** The
  iter0 receipt shows the flagship's first build at 6 distinct font sizes
  (gate ≤ 8) and 0.0% off-grid spacing (gate ≤ 15) — the design-system
  constraints in the plan propagating through the writing sessions into
  the built page. The rubric's remaining failures are craft failures
  (VLM axes, the 42px overflow), which is exactly what a rubric is for.

- **P14.3 (the loop caught its own fix's regression).** iter2's 27
  light-scheme violations were introduced BY the E6 contrast fix for
  iter1's dark-scheme findings — and caught by the both-scheme audit the
  loop had added after F14. See F18 for the anatomy; the point for this
  section: the infrastructure, not a human reviewer, was the line of
  defense.

- **P14.4 (the final receipt: every objective gate green).** The iter3
  receipt closes the loop: 0 contrast violations in both schemes, 6
  distinct font sizes, 0.0% off-grid, 0 heading skips, 0 missing alts,
  0px mobile overflow, FCP/LCP/CLS/TBT 216ms/216ms/0/0 — against a
  baseline landing page measuring 23 sizes and 32.7% off-grid. The
  VLM-overall floor (7.0) stays open and is recorded honestly as such
  (the single-judge variance band; see the round README's limitations).

---

## F19 — zombie standalone servers serving stale builds after a clean rebuild (an environment trap that mimics a build defect)

**Failure (the OG-shot gate).** After a CLEAN rebuild (`rm -rf .next`), the
landing page still 500'd on one chunk (`0uvtt87t3cfhp.js`) that existed in
no build artifact — the served HTML referenced a chunk the fresh build
never emitted, which presents exactly like a Turbopack manifest corruption.

**Reproduction.** Boot `.next/standalone/server.js`, `pkill -f "node
.next/standalone"`, rebuild, boot again — the old process survives: Next.js
renames the process to `next-server (v16.4.2)`, so the pkill pattern never
matches, and the OLD process keeps the port, serving its in-memory build
against a deleted static tree.

**Root cause.** Caller-environment: process-title rename defeating pattern
kills. Two zombies accumulated this round (ports 3111/3218, both holding
pre-rebuild state).

**Mitigation adopted.** Kill standalone servers by PID from the port table
(`ss -tlnp`), never by cmdline pattern; the round's build protocol (F16)
now includes the port sweep before any build→serve→shoot sequence. No repo
defect — the clean build was correct all along; the gate (the OG lane's
console-error rejection) did its job.

---

## F20 — the encore sessions reintroduced the opacity-faded text tokens the landing banned (caught by the live deploy gate, the one lane that checks the emitted CSS)

**Failure (verify-deploy after the v0.0.42 push).** The live gate's
"faded text utilities not emitted" check failed: the emitted CSS carried
`.text-faint\/70` — four occurrences across the encore components
(`loop.tsx`, `finale.tsx`, `primitives.tsx` `text-dim[/]70`,
`failures.tsx` `text-amber[/]80`).

**Reproduction.** `node scripts/verify-deploy.mjs` against the live
deployment; the source sweep
`rg "text-(faint|dim|ink|gold|amber|poke)[a-z-]*/[0-9]+" src/components/encore/`.

**Root cause.** App defect with a DOX-scope lesson: the landing's
categorical rule ("NO translucent text/background tokens — axe computes
effective contrast THROUGH alpha", the gallery round's documented lesson
in `src/components/landing/AGENTS.md`) lives in the landing's DOX file —
which the encore sessions were explicitly scoped AWAY from ("no landing
edits"). A rule that must hold repo-wide but is documented in one
subtree's AGENTS.md is a rule the next subtree will break. The
session-level design rules (the plan §4.3 named-pairs rule) did not
spell out the no-opacity-modifier form.

**Fix implemented.** E11 + E12: all four occurrences replaced with
full-strength tokens (`text-dim` / `text-faint` / `text-amber` per
surface); the mangle-proof sweep returns zero matches across
`src/components/encore/` + `src/app/encore/`.

**Benchmark created.** The existing verify-deploy gate IS the regression
net (it caught this within one deploy); the sweep pattern is recorded
here for the next round's checklist. The candidate durable fix (the gap
analysis's roadmap): move the no-faded-text rule to the root AGENTS.md
or a shared design-system contract so no subtree can miss it.

**The F20 postscript (the part nobody would believe without a receipt).**
After the four source fixes, the live gate STILL failed — the emitted CSS
still carried `.text-faint\/70`, now resolved to a literal
`#9cb4deb3` (the dark faint at 70% alpha). The candidate came from
NOWHERE in `src/` — it came from THIS ROUND'S OWN RECEIPTS: the E11/E12
prompt files, their envelopes, and the first F20 entry itself contained
the literal utility string, and Tailwind v4's default source detection
scans the whole repo from the CSS file upward (gitignore-respecting,
but `benchmarks/` is tracked) — every text file is a candidate source.
The receipts resurrected the banned utility through the build pipeline.
Defused by bracket-breaking the tokens in the receipts
(`text-faint[/]70` — prose keeps its meaning, the scanner loses the
candidate). The durable lesson for the root contract: a repo-wide CSS
rule enforced by emitted-utility gates is violated by DOCUMENTATION that
quotes the utility — the gate and the scanner disagree about what a
source is.
