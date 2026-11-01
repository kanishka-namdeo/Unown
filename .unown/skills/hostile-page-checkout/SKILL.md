---
name: hostile-page-checkout
description: Use when driving a hostile or adversarial web page through the browser tool — the BrowseBench stress checkout (benchmarks/browser-autonomy-round/fixtures/stress.html) and any real page that plants interstitials, overlays, arm-races, iframe forms, or native-dialog guards. Validated across six receipted runs (benchmarks/browser-autonomy-round/RESULTS.md); promoted from the browser autonomy round's skill candidate 2026-11-01 (round 2's decision).
---

# Hostile-page checkout

The order of operations that survives a page that fights back. Every step
below is a planted failure class in the stress fixture, and each was a real
failure in at least one receipted run before this procedure consolidated.

1. **Interstitials first, actions second.** Dismiss the newsletter modal
   (stress page: "No thanks, just let me shop") and accept the cookie banner
   BEFORE the first effective click — a modal or overlay silently swallows
   the click you actually wanted (run 1: the first "Add to cart" never
   landed, cart stayed 0).
2. **Respect the arm-race.** Controls that enable on a delay punish clicks
   fired within their arming window (the two-stage order button resets the
   cart): snapshot, see the control still disabled or staged, `wait` for the
   text/state change, THEN click.
3. **Frame-verified fills.** Address forms inside a same-origin iframe:
   fill by ref through the frame (`fill_form` resolves refs through
   iframes), and trust the post-fill verification — a `re-filled … verified
   on retry` note or a loud per-field failure, never a silent success
   (issue #43's fix; the readiness barrier waits for the frame too).
4. **Arm dialogs BEFORE the guard-gated click.** Native `confirm()`/
   `prompt()` auto-dismiss by default and the dismissal CANCELS the flow
   ("Order cancelled at the dialog"). Arm `browser dialog accept text=OK`
   first (one-shot — re-arm after each use), then click the button that
   opens the dialog. Run 6's receipt is the proof: pre-armed at call #11,
   the triggering click at #12, trap never hit.
5. **Verify the success marker, not the vibe.** The stress contract is
   `#final-status[data-success="true"]` — check the element (or eval it),
   and save the screenshot receipt (`.png` names now capture png — issue #44).
6. **Refs are per-snapshot.** After any navigation or DOM mutation,
   re-snapshot before acting; a stale ref is a misclick.

The tool-time memory hint lane (issue #45) surfaces the memory side of this
procedure at the first browser call — this skill is the full procedure,
available up front for benchmark and hostile-page work.
