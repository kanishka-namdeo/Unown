---
title: "The SOTA re-cut: thirteen reels re-filmed, and how we audit demo video"
description: "A frame-sampled VLM audit sent thirteen landing reels back into the capture harness — and the first audit pass itself was wrong about what it saw."
date: 2026-10-26
lastmod: 2026-10-26
tags: [landing, media, release]
type: release
media: [/landing/tui/router/router.mp4, /landing/tui/router/stills/02-job-triggered.png]
---

The landing page ships twenty-four demo reels — every capability filmed in a
real terminal session, one movie per dex entry. Before
[v0.0.23](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.23), we
held all twenty-four to a second, harsher bar: a frame-sampled vision-model
audit judging each reel against the strongest terminal marketing in the wild
— and thirteen of them failed it. This post is the record of the re-capture
round, and of the audit methodology we had to fix along the way, because the
first audit pass flagged defects the videos did not have.

## What the bar is, concretely

We surveyed what the best dev-tool pages actually ship in 2025-26. The
interesting finding: most of them (Warp, Linear, Vercel, Raycast, Claude
Code, Codex) now ship **no home-page video at all** — scroll-driven
animation and stills have replaced hero reels. The strongest surviving
exemplar for terminal product video is [Amp](https://ampcode.com): muted
loops, ~30fps, ~1.3MB, poster-first, served from a static CDN. That is the
bar the dex reels are held to: silent H.264+VP9 pairs, 1600px-class
geometry, real sessions, no dead air, a story a senior engineer believes.

The frame-sampled audit scored each shipped reel on render quality, narrative
flow, realism and marketing fitness — and returned thirteen lanes between 2
and 7 out of 10, each with a concrete named defect:

| Lane | The defect the audit caught |
|---|---|
| router | four identical static screens — the "open the detail" step selected nothing (the Router screen has no detail view) |
| parity-round | typed a harness test-case ("Reply with exactly: the parity round is live") instead of a developer's ask |
| overlays | opened cold on a slash command; 70% of the reel was dead air |
| mcp | rolled a bare d20 — arbitrary for a coding agent |
| websearch | the closing beat could land on the tool tail with the answer below the fold |
| wiki, cli-doctor | blank or cut-off closing frames |
| hero-bugfix | the mid-edit still raced the fast upstream and shipped byte-identical to the next beat |
| split-view | ended mid-story on a failed-then-fixed pair |
| sdlc | the machine-wide session listing cut off mid-render |
| browser-subagent | the report still was byte-identical to the done still (the anchor matched the child's own live labels) |
| subagent-explore | filmed the TUI's tmux `extended-keys-format` boot warning |
| harness | identical frames, no visible engine state change |

The re-cuts answer each defect with a real session, not a repair: router now
walks its own selection onto auto-dream and Space-triggers it — the emerald
toast and the running row are the beat, and the engine really runs the job:

![the re-cut router reel: the job table, then the trigger, then the toast](/landing/tui/router/stills/02-job-triggered.png)

<video controls muted playsinline width="880" poster="/landing/tui/router/stills/02-job-triggered.png">
  <source src="/landing/tui/router/router.webm" type="video/webm"/>
  <source src="/landing/tui/router/router.mp4" type="video/mp4"/>
</video>

mcp's dice roll now picks the test fixture server's port and a second real
turn checks the port is free. cli-doctor filmed last so the usage table
carries the rows every earlier lane really burned. parity-round opens with a
real docs question. overlays opens on the session itself. Every lane went
back through the audited capture harness — real tmux pane, real engine, real
model — and passed the three gates the repo has always required: pane-truth
plus pixel stills, a frame scan, and VLM-sampled video review.

## The audit that cried wolf

Here is the methodology story. After the re-cuts, we ran the same
frame-sampled audit on the new reels — and it flagged nine of thirteen. But
its evidence did not survive contact with signal analysis:

- **"Completely black frames"** in cli-doctor — measured with ffmpeg: the
  flagged tail has zero pixels below luma 5. It is the dark usage screen, and
  a full-resolution probe reads it back as a legible usage table.
- **"Identical frames, dead air"** — terminal recordings dwell on completed
  states between beats; the lanes the audit PASSED carry the same dwell
  profile as the ones it failed.
- **"Text cut off, illegible"** — the audit's 2×2 montage downscales each
  frame below legibility; the frames are 1600px and clean.

The method's flaw: four fixed-position samples from reels as short as four
seconds, montage-compressed, judged without the context that terminal
recordings legitimately hold still. The re-check — eight evenly-spaced
frames per reel at readable scale, full-resolution probes for the flagged
states — read all thirteen reels 8-10/10. The lesson is now part of the
workflow: never audit a video by judging a mosaic of it.

## A gate for the deploy, too

The re-cut round also closed a gap the audit made obvious: nothing checked
the deployed site's media. The e2e video gate proves every reel decodes on
the standalone build, but a broken deploy, a stale cache or a missing file
on Vercel was invisible until a visitor hit it. `scripts/verify-deploy.mjs`
now probes every landing media URL the rendered DOM references — reels'
webm+mp4, lazy posters, dashboard stills — for 200, the exact content type,
byte-range support and the long CDN cache, on every push.

The superseded thirteen cuts are archived in the capture root, and git
history holds every byte — nothing was deleted. The dex on
[the landing page](/) now plays the re-cut set: same 24 movies, all real
sessions, every defect the audit named answered with a better take.
