/** Scenario catalog — twelve landing-page stories, each a real end-to-end
 *  session against the live stack (bridge + engine), captured in one take.
 *
 *  Demo-fixture states (prep with prep_demo.sh BEFORE running):
 *    s1-hero-bugfix   seed      (bug present, suite red)
 *    s3-checkpoints   fixed     (clean tree, suite green)
 *    s5-review        seed+fix  (one-char fix uncommitted, suite green)
 *    s2/s4/s8/s10     any       (fixture content irrelevant — s10 wants the
 *                               .unown scaffold pristine: v0 project memory,
 *                               no provenance sidecar, so the dream's
 *                               version bump is visible in the footer chip)
 *    s6/s7 run in the real repo checkout (no prep).
 *    s9 runs in the real repo checkout too (the fleet spawns real children
 *      against it; .unown/fleet/ is wiped first for a fresh registry).
 *    s11 runs in the real repo checkout with the landing dev server already
 *      up on :3000 (the realistic "the site is running locally" state).
 *    s12 boots `unown dashboard dreams` against the live engine — richest
 *      AFTER s10 (its dream is then the newest row on the Dreams screen).
 */
const fs = require("node:fs");
const path = require("node:path");
const { DEMO_DIR, REPO_ROOT, unownBin } = require("./_paths");

/** Wait until the agent's turn is over. beauty-2/3 replaced the generic
 *  "Working..." loader with verb-first labels ("Editing x…", "Running bun…")
 *  plus an m:ss elapsed chip, so the old `exclude: ["Working..."]` wait now
 *  passes mid-turn while a tool label is up. The stable idle signal is the
 *  loader's braille spinner disappearing from the pane: those glyphs are the
 *  ONLY spinner frames in the TUI (loader.ts DEFAULT_FRAMES), the status line
 *  keeps one on screen for the whole turn, and at turn end the completion
 *  beat shows "✓ <label>" for ~600ms before the line clears. */
const SPIN_FRAMES = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
async function waitTurnIdle(s, timeout, desc = "turn complete") {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    last = await s.tmux.text();
    if (!SPIN_FRAMES.test(last)) {
      // settle past the 600ms completion beat and re-check — the beat line
      // ("✓ <last verb>") also has no spinner
      await s.sleep(900);
      const again = await s.tmux.text();
      if (!SPIN_FRAMES.test(again)) return;
    }
    await s.sleep(300);
  }
  const tail = last.split("\n").slice(-14).join("\n");
  throw new Error(`waitTurnIdle timeout (${desc}) after ${timeout}ms — spinner still in pane. Pane tail:\n${tail}`);
}

const s1 = {
  name: "hero-bugfix", cwd: DEMO_DIR, port: 7610, env: {},
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "01-boot-fresh-session" },
    // The failing suite is the hook of the story (! bash passthrough, one line)
    { t: "prompt", s: "!bun test", cps: 24 },
    { t: "wait", include: [" 2 fail"], timeout: 60_000, desc: "red suite" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "02-red-test-run" },
    { t: "linger", ms: 800 },
    // The ask
    { t: "prompt", s: "The pagination test is failing. Find the bug, fix it, and get the whole test suite green.", cps: 30 },
    // agent starts investigating: first tool header appears after the echoed prompt
    { t: "fn", desc: "wait for first tool block", fn: async (s) => {
      await s.wait({ include: ["The pagination test is failing"], timeout: 30_000, desc: "prompt echoed" });
      await s.wait({ include: ["read ", "grep ", "find ", "ls ", "$ ", "edit ", "write "], mode: "any", timeout: 300_000, desc: "first tool block" });
      await s.linger(1000);
      await s.still("03-agent-investigating");
    }},
    // the fix lands — anchor on the edit tool block itself (it renders the
    // instant the tool starts, with the diff streaming under it). 2026-10-25
    // (SOTA re-cut): with the quick upstream the edit+bash+answer all land
    // inside any linger, so a MID-edit still raced the finished turn and
    // shipped byte-identical to the next beat. The mid-edit moment stays in
    // the MOVIE (the frames record it continuously); the stills now anchor on
    // states that differ by construction.
    { t: "fn", desc: "wait for the edit block", fn: async (s) => {
      await s.wait({ include: ["edit ", "write "], mode: "any", timeout: 420_000, desc: "edit block visible" });
      await s.linger(600);
    }},
    // agent re-runs the suite → green. 2026-10-24: the anchor " 0 fail" can
    // also match the agent's FINAL ANSWER quoting the tally, so it only paces
    // the video — the stills moved POST-IDLE: mid-turn stills raced the
    // streaming answer twice (row-clip pane/pixel desync), and a stable
    // pane is the whole point of a still.
    { t: "fn", desc: "wait for green suite", fn: async (s) => {
      await s.wait({ include: [" 0 fail"], timeout: 420_000, desc: "green suite" });
    }},
    // turn completes (working line gone) — 05 is the finished turn: the
    // green bash output + the agent's answer, spinner gone, pane stable
    { t: "fn", desc: "turn complete", fn: (s) => waitTurnIdle(s, 420_000, "hero turn complete") },
    { t: "linger", ms: 1800 },
    { t: "still", name: "04-agent-fixed" },
    // 2026-10-24 (3rd fix): with agnes-3.0-flash the bash re-run + short
    // final answer land inside any pre-idle settle window — a post-idle still
    // shipped byte-identical to 05 twice. The honest closing beat is the
    // user's own flake-guard re-run (this repo's convention: the suite runs
    // twice), which puts the fresh green tally under the agent's answer.
    { t: "prompt", s: "!bun test", cps: 24 },
    { t: "wait", include: [" 5 pass"], timeout: 60_000, desc: "second green run" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "05-suite-green-twice" },
  ],
};

const s2 = {
  name: "plan-mode",
  cwd: "/home/z/my-project/demo-projects/api-server",
  port: 7611,
  env: {},
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "01-session" },
    { t: "prompt", s: "/plan", cps: 20 },
    { t: "wait", include: ["Plan mode ON"], timeout: 20_000, desc: "plan mode on" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "02-plan-mode-on" },
    {
      t: "prompt",
      s: "Add a renameTask(id, title) method to the store and a PUT /tasks/:id route that uses it. Keep it simple - no new tests. Plan first, then wait for my approval.",
      cps: 30,
    },
    // the plan card + approval selector appears when the agent's turn ends
    { t: "wait", include: ["Plan ready ("], timeout: 420_000, desc: "plan approval overlay" },
    { t: "linger", ms: 2000 },
    { t: "still", name: "03-plan-approval-overlay" },
    // "Execute the plan (track progress)" is pre-selected — press Enter
    { t: "key", k: "Enter" },
    { t: "wait", include: ["Execute the plan"], timeout: 60_000, desc: "execution started" },
    // wait for the first step to complete (checkbox flips) or footer progress
    { t: "fn", desc: "capture mid-execution", fn: async (s) => {
      await s.wait({ include: ["[DONE:1]", "[x]"], mode: "any", timeout: 300_000, desc: "first step done" }).catch(() => {});
      await s.linger(1600);
      await s.still("04-plan-executing");
    }},
    { t: "fn", desc: "wait for completion (bounded, soft)", fn: async (s) => {
      // "Plan complete" (the notify is "Plan complete — all steps done.") only
      // fires when EVERY extracted step carries a [DONE:n] tag; the model
      // often folds sub-details into the parent step ([DONE:1..3] of a 6-item
      // plan), the badge freezes at "plan N/M" and the toast never appears —
      // measured: a 240s dead wait on a turn that had already ended. The
      // stable end signal is the execution TURN going idle after the first
      // [DONE: tag; the toast stays a short bonus wait, not the gate.
      await s.wait({ include: ["[DONE:"], timeout: 300_000, desc: "first plan step done" }).catch(() => {});
      await waitTurnIdle(s, 300_000, "plan execution turn complete").catch(() => {});
      await s.wait({ include: ["Plan complete"], timeout: 20_000, desc: "completion toast (bonus)" }).catch(() => {});
    }},
    { t: "linger", ms: 2200 },
    { t: "still", name: "05-plan-complete" },
  ],
};

const s3 = {
  name: "checkpoints", cwd: DEMO_DIR, port: 7612, env: {},
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 900 },
    { t: "prompt", s: "Rename the exported function paginateItems to paginateList everywhere (src and tests). Keep the suite green.", cps: 30 },
    { t: "fn", desc: "wait for rename done", fn: async (s) => {
      await s.waitForExternal({
        desc: "rename landed",
        timeout: 420_000,
        poll: 1500,
        check: async () => {
          const out = await s.exec(`grep -c paginateList ${DEMO_DIR}/src/pagination.ts ${DEMO_DIR}/src/server.ts 2>/dev/null`);
          return out.split("\n").filter(Boolean).every((l) => /:(1|2|3)$/.test(l.trim()));
        },
      });
      await waitTurnIdle(s, 420_000, "rename turn complete");
      // checkpoint seals flush a couple of seconds after the turn ends — settle first
      await s.sleep(4500);
    }},
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-rename-done" },
    { t: "prompt", s: "/checkpoints", cps: 26 },
    { t: "wait", include: ["Checkpoints (newest first"], timeout: 30_000, desc: "checkpoint list" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "02-checkpoint-list" },
    { t: "prompt", s: "/undo", cps: 26 },
    { t: "wait", include: ["Undid "], timeout: 60_000, desc: "undo applied" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "03-undo-reverted" },
    { t: "prompt", s: "/redo", cps: 26 },
    { t: "wait", include: ["Redid "], timeout: 60_000, desc: "redo applied" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "04-redo-restored" },
  ],
};

const s4 = {
  name: "overlays", cwd: DEMO_DIR, port: 7613, env: {},
  steps: [
    { t: "waitReady" },
    // 2026-10-25 (SOTA re-cut): the shipped cut opened cold on /model — the
    // video's first dwell read as an idle boot screen (VLM: "70% dead air").
    // A fresh-session beat opens the story like every other session lane.
    { t: "linger", ms: 900 },
    { t: "still", name: "01-fresh-session" },
    { t: "prompt", s: "/model", cps: 30 },
    { t: "wait", include: ["Enter to select"], timeout: 20_000, desc: "model picker open" },
    { t: "linger", ms: 1400 },
    { t: "still", name: "01-model-picker" },
    { t: "key", k: "Down" },
    { t: "linger", ms: 500 },
    { t: "key", k: "Down" },
    { t: "linger", ms: 500 },
    { t: "still", name: "02-model-picker-navigated" },
    { t: "key", k: "Up" },
    { t: "linger", ms: 500 },
    { t: "key", k: "Enter" },
    { t: "wait", include: ["Model: "], timeout: 30_000, desc: "model switched" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "03-model-switched" },
    { t: "prompt", s: "/permissions", cps: 30 },
    { t: "wait", include: ["unown permissions"], timeout: 30_000, desc: "permissions status" },
    { t: "linger", ms: 1800 },
    { t: "still", name: "04-permissions" },
    { t: "prompt", s: "/hooks", cps: 30 },
    { t: "wait", include: ["hooks configured", "User hooks"], mode: "any", timeout: 30_000, desc: "hooks status" },
    { t: "linger", ms: 1800 },
    { t: "still", name: "05-hooks" },
  ],
};

const s5 = {
  name: "review", cwd: DEMO_DIR, port: 7614, env: {},
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 900 },
    // 2026-10-24: the poster beat must show what its name says. The fixture's
    // uncommitted one-char fix lives in the FILESYSTEM — a plain boot still
    // rendered byte-identical to every other lane's boot frame (the shipped
    // poster collided with hero-bugfix/01 and plan-mode/01). Read the diff
    // into the pane first, so "session with uncommitted diff" is pane-true.
    { t: "prompt", s: "!git diff", cps: 24 },
    // the seed fixture's function is `paginate` (the paginateItems rename is
    // the FIXED tag's state) — anchor on the removed off-by-one line itself
    { t: "wait", include: ["perPage + 1"], timeout: 30_000, desc: "diff rendered in pane" },
    { t: "linger", ms: 900 },
    { t: "still", name: "01-session-with-uncommitted-diff" },
    { t: "prompt", s: "/review", cps: 30 },
    { t: "wait", include: ["Review: "], timeout: 60_000, desc: "review starting" },
    { t: "fn", desc: "capture reviewers running", fn: async (s) => {
      await s.wait({ include: ["reviewer(s)"], timeout: 120_000, desc: "reviewers spawned" }).catch(() => {});
      await s.linger(2800);
      await s.still("02-reviewers-running");
    }},
    { t: "wait", include: ["VERDICT:"], timeout: 330_000, desc: "review verdict" },
    // 2026-10-24: capture the verdict the moment it lands — the artifact save
    // line can render inside the old 3s linger, which made 03 and 04
    // byte-identical. 03 is the verdict beat, 04 is the artifact beat.
    { t: "linger", ms: 1000 },
    { t: "still", name: "03-verdict" },
    { t: "wait", include: ["Saved to "], timeout: 60_000, desc: "artifact saved" },
    // 2026-10-24 (2nd fix): the verdict and the "Saved to" path land in the
    // SAME result block — panes at 03 and 04 were verbatim equal, so no two
    // stills can differ there. The honest 04 beat is the user's own next
    // move: list the reviews dir and open the artifact's head — the pane
    // shows the saved file itself, which is what "artifact saved" means.
    { t: "prompt", s: "!ls .unown/reviews/", cps: 24 },
    { t: "wait", include: ["uncommitted-work-diff"], timeout: 30_000, desc: "reviews dir listed" },
    { t: "linger", ms: 700 },
    { t: "still", name: "04-review-artifact-saved" },
  ],
};

const s6 = {
  name: "subagent-explore", cwd: REPO_ROOT, port: 7615, env: {},
  steps: [
    { t: "waitReady" },
    // 2026-10-24: the lane's own boot frame was byte-identical to fleet's
    // (same cwd, same chrome, nothing typed yet) — the shipped poster
    // collided with the fleet lane's. The poster beat is now the session with
    // the repo-exploration ask in it, which is what makes this lane this lane.
    { t: "prompt", s: "Use a task subagent to explore this repository and give me a short map of the main modules and what they do.", cps: 30 },
    { t: "wait", include: ["explore this repository"], timeout: 30_000, desc: "prompt echoed" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "01-boot-in-real-repo" },
    { t: "wait", include: ["task → "], timeout: 240_000, desc: "subagent spawned" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "02-task-subagent-running" },
    { t: "fn", desc: "wait for subagent result", fn: async (s) => {
      await s.wait({ include: ["turns,"], timeout: 420_000, desc: "subagent done" }).catch(() => {});
      await s.linger(1600);
      await s.still("03-subagent-result");
    }},
    { t: "fn", desc: "turn complete", fn: (s) => waitTurnIdle(s, 420_000, "module-map turn complete") },
    { t: "linger", ms: 2000 },
    { t: "still", name: "04-final-module-map" },
  ],
};

const s7 = {
  name: "wiki", cwd: DEMO_DIR, port: 7616, env: {},
  steps: [
    { t: "waitReady" },
    // 2026-10-25 (SOTA re-cut): the shipped cut never showed the session the
    // user works in (VLM: "the initial ask is invisible"). A fresh-session
    // beat anchors the story before the /wiki round starts.
    { t: "linger", ms: 900 },
    { t: "still", name: "01-fresh-session" },
    { t: "fn", desc: "clean wiki for a fresh generate", fn: async (s) => {
      await s.exec(`rm -rf ${DEMO_DIR}/.unown/wiki`);
    }},
    { t: "prompt", s: "/wiki generate", cps: 30 },
    { t: "wait", include: ["Generating wiki at"], timeout: 60_000, desc: "wiki starting" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-wiki-generating" },
    { t: "wait", include: ["Wiki written to"], timeout: 900_000, desc: "wiki written" },
    { t: "linger", ms: 1800 },
    { t: "still", name: "02-wiki-written" },
    { t: "prompt", s: "/wiki search paginate", cps: 30 },
    { t: "wait", include: ["Search \"paginate\""], timeout: 60_000, desc: "wiki search results" },
    { t: "linger", ms: 2000 },
    { t: "still", name: "03-wiki-search-results" },
  ],
};

const s8 = {
  name: "cli-doctor", cwd: DEMO_DIR, port: 7617, env: {},
  bootCmd: "bash --noprofile --norc -i",
  ready: { include: ["bash-"], desc: "shell prompt" },
  steps: [
    { t: "waitReady", timeout: 30_000 },
    { t: "prompt", s: "clear", cps: 40 },
    { t: "linger", ms: 400 },
    { t: "prompt", s: `bun ${unownBin} doctor`, cps: 40 },
    { t: "wait", include: ["ready to chat"], timeout: 120_000, desc: "doctor done" },
    { t: "linger", ms: 1800 },
    { t: "still", name: "01-doctor" },
    { t: "prompt", s: "clear", cps: 40 },
    { t: "wait", exclude: ["unown version"], timeout: 20_000, desc: "cleared" },
    // Model-agnostic anchors (2026-10-24): the lane previously waited on
    // "kimi-k2.5", the model id of the ORIGINAL capture host — a fresh clone
    // serving any other catalog (agnes, qwen…) never matched and the lane
    // timed out with the listing on screen. The printed HEADERS are the
    // contract, not the host's model ids.
    { t: "prompt", s: `bun ${unownBin} models`, cps: 40 },
    { t: "wait", include: ["Configured providers"], timeout: 60_000, desc: "models listed" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "02-models" },
    { t: "prompt", s: "clear", cps: 40 },
    { t: "wait", exclude: ["Configured providers"], timeout: 20_000, desc: "cleared" },
    { t: "prompt", s: `bun ${unownBin} usage`, cps: 40 },
    { t: "wait", include: ["LLM usage"], timeout: 60_000, desc: "usage table" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "03-usage" },
  ],
};

const s9 = {
  // --no-split: the classic transcript look (the other eight scenarios' visual
  // language) with maximum room for the fleet widget + the story's beats; the
  // widget/footer are dock surfaces, unaffected by the split-view flag.
  name: "fleet", cwd: REPO_ROOT, port: 7618, env: {},
  bootCmd: `bun ${unownBin} --no-split`,
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 1000 },
    // Fresh fleet state — a stale resume registry would pollute the /tasks beat.
    { t: "fn", desc: "wipe fleet runtime state", fn: async (s) => {
      await s.exec(`rm -rf ${REPO_ROOT}/.unown/fleet`);
    }},
    { t: "still", name: "01-boot-fleet-ready" },
    // The ask: an async spawn with a name, acknowledged immediately. The child
    // orients (reads two files) BEFORE asking — that spaces the story's beats
    // so the widget "running · read" frame lands before the question frame.
    { t: "prompt", s: 'Spawn an async subagent to map this repo: use the task tool with async=true, name="mapper", agent="explore", and this task text: "First read README.md and package.json to get oriented. Then use ask_question to ask the orchestrator whether the map should include test files. Once answered, map this repository main source areas with one line each, under 15 lines total." Do not wait for it — just confirm the ack and tell me it is running.', cps: 30 },
    { t: "wait", include: ["[async]"], timeout: 240_000, desc: "async spawn call rendered" },
    { t: "wait", include: ["Subagents"], timeout: 60_000, desc: "fleet widget up" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "02-async-ack-fleet-widget" },
    // The child asks mid-task; the question arrives as its own turn.
    { t: "wait", include: ["asks a question after"], timeout: 300_000, desc: "child asks a question" },
    { t: "linger", ms: 1800 },
    { t: "still", name: "03-ask-question" },
    // The parent answers via task_control steer — autonomously (the question
    // message spells the command out), with an explicit fallback prompt if the
    // model stalls. A steer while parked IS the answer.
    { t: "fn", desc: "answer arrives (autonomous or fallback)", fn: async (s) => {
      const answered = await s
        .wait({ include: ["Message delivered to mapper"], timeout: 180_000, desc: "parent answers autonomously" })
        .then(() => true)
        .catch(() => false);
      if (!answered) {
        await s.prompt('Answer mapper now: use task_control with action="steer", id="mapper", message="Skip tests - production code only. Keep the map under 15 lines."', { cps: 30 });
        await s.wait({ include: ["Message delivered to mapper"], timeout: 240_000, desc: "fallback answer delivered" });
      }
    }},
    // The child finishes; the result arrives as a new turn (steer delivery).
    { t: "wait", include: ["finished in"], timeout: 420_000, desc: "child result delivered" },
    { t: "fn", desc: "parent turn complete", fn: (s) => waitTurnIdle(s, 420_000, "fleet parent turn complete") },
    { t: "linger", ms: 1800 },
    { t: "still", name: "04-child-result" },
    // /tasks: the human view — the resumable registry.
    { t: "prompt", s: "/tasks", cps: 30 },
    { t: "wait", include: ["Resumable"], timeout: 60_000, desc: "registry shown" },
    { t: "linger", ms: 2000 },
    { t: "still", name: "05-resume-registry" },
  ],
};

/* ────────────────────────────────────────────────────────────────────────
 * s10-s12 — the memory / browser / dream lanes (2026-10-23)
 *
 * Three gaps the catalog had as pending: the memory learning loop end to
 * end (№ 005 Memory), the browser round's visitor check (№ 011 Browser),
 * and the dashboard's Dreams + Memory screens on the live engine (№ 008
 * Dream). Ports 7619-7621 extend the catalog's block.
 * ──────────────────────────────────────────────────────────────────────── */

/** The engine's own URL + bearer token (M7) — the same discovery every
 * in-tree client does. Used by fn steps that trigger AutoDream. */
const ENGINE_URL = process.env.UNOWN_ENGINE_URL || "http://127.0.0.1:3030";
const engineToken = () => {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, "data", "self-learning", "engine.token"), "utf8").trim();
  } catch {
    return "";
  }
};

/** Trigger AutoDream for the terminal notes of `projectDir` — the exact
 * path the dashboard's "dream now" key hits (POST /api/dreams/run) — and
 * wait until the project's memory file carries `needle`. The engine's own
 * self-improvement loop (auto-dream ticks + dream-check events on canary
 * runs) holds the busy-mutex for multi-minute stretches, so this retries
 * FAST (12s — grab the mutex the moment it frees) and budgets generously
 * (default 420s: a queued engine dream ~3 min + the project dream ~1 min).
 * A "skipped" answer means the tick already drained the notes — the file
 * poll below is the convergence either way. Hard-fails on timeout: the
 * story needs the dream. */
async function dreamUntilLearned(s, projectDir, needle, timeoutMs = 420_000) {
  const memFile = path.join(projectDir, ".unown", "memory", "project.md");
  const hasNeedle = () => {
    try {
      return fs.readFileSync(memFile, "utf8").includes(needle);
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !hasNeedle()) {
    try {
      const res = await fetch(`${ENGINE_URL}/api/dreams/run`, {
        method: "POST",
        headers: { authorization: `Bearer ${engineToken()}` },
      });
      const body = await res.json().catch(() => ({}));
      s.log(`dreams/run -> ${JSON.stringify(body).slice(0, 140)}`);
    } catch (e) {
      s.log(`dreams/run failed: ${e instanceof Error ? e.message : e}`);
    }
    const inner = Math.min(Date.now() + 12_000, deadline);
    while (Date.now() < inner && !hasNeedle()) await s.sleep(1_500);
  }
  if (!hasNeedle()) throw new Error(`dream did not land "${needle}" within ${timeoutMs}ms`);
  // the footer chip + boot Context read the file at session start; settle
  await s.sleep(2_000);
}

const s10 = {
  // Two sessions in one pane, exactly like a real terminal: teach the house
  // rules + one real task, /note the lesson, /quit — AutoDream consolidates
  // behind the scenes (the dashboard's "dream now" trigger) — then a fresh
  // session boots with the learned memory (footer chip v0 -> v1), /learning
  // prints the 4-tier stack, and a second task shows the lesson applied
  // unprompted (bun, tests run twice, both tallies quoted).
  name: "memory-learn", cwd: DEMO_DIR, port: 7619, env: {},
  bootCmd: "bash --noprofile --norc -i",
  ready: { include: ["bash-"], desc: "shell prompt" },
  steps: [
    { t: "waitReady", timeout: 30_000 },
    { t: "prompt", s: "clear", cps: 40 },
    { t: "sleep", ms: 600 },
    // ── session one: the teach + a real task
    { t: "prompt", s: `bun ${unownBin}`, cps: 40 },
    { t: "wait", include: ["unown v", "memory: up"], timeout: 90_000, desc: "TUI up" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-fresh-session-v0" },
    { t: "prompt", s: "Quick context before you start: this repo is bun-only - the package manager is bun, with a bun.lock at the root; npm and yarn are not used here. The suite has shown flakes on single runs, so the verification bar for pagination changes is two consecutive green bun test runs. Now the task: bump the default page size for GET /api/tasks from 5 to 10 (src/server.ts) and add one test that pins the new default.", cps: 28 },
    { t: "fn", desc: "task one lands", fn: async (s) => {
      await s.waitForExternal({
        desc: "default page size bumped to 10",
        timeout: 420_000, poll: 1500,
        check: async () => (await s.exec(`grep -cF '?? "10"' ${DEMO_DIR}/src/server.ts`)).trim() === "1",
      });
      await waitTurnIdle(s, 420_000, "task one turn complete");
      await s.sleep(1500);
    }},
    { t: "linger", ms: 1500 },
    { t: "still", name: "02-task-done" },
    { t: "prompt", s: "/note Environment: this repo is bun-only - the package manager is bun, with a bun.lock at the root; npm and yarn are not used here. Known pitfall: pagination changes have regressed this API before and single test runs have missed flakes - the repo's verification bar for a pagination change is two consecutive green bun test runs.", cps: 26 },
    { t: "wait", include: ["Note delivered"], timeout: 30_000, desc: "note delivered" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "03-note-recorded" },
    // ── the session ends; AutoDream consolidates the notes
    { t: "prompt", s: "/quit", cps: 26 },
    { t: "wait", include: ["bash-"], timeout: 60_000, desc: "back at the shell" },
    { t: "fn", desc: "AutoDream consolidates the notes", fn: (s) => dreamUntilLearned(s, DEMO_DIR, "bun") },
    { t: "linger", ms: 1200 },
    // ── session two: a fresh boot carries the learned memory
    { t: "prompt", s: `bun ${unownBin}`, cps: 40 },
    { t: "wait", include: ["unown v"], timeout: 90_000, desc: "TUI up (session two)" },
    { t: "fn", desc: "footer chip shows learned memory", fn: async (s) => {
      // the memory bar is "mem ▕█░░▏ vN · M rules" — wait for v>=1 (v0 is
      // the scaffold state session one started from)
      await s.waitForExternal({
        desc: "memory chip version >= 1",
        timeout: 60_000, poll: 800,
        check: async () => /v[1-9][0-9]* · \d+ rules/.test(await s.text()),
      });
    }},
    { t: "linger", ms: 1600 },
    { t: "still", name: "04-second-session-learned" },
    // /memory search — the cross-scope recall surface: the learned rules come
    // back as scored results (and it fits the pane, unlike /learning's full
    // stack print which scrolls the PROJECT tier out of the 36-row viewport)
    { t: "prompt", s: "/memory search package manager", cps: 26 },
    { t: "wait", include: ["cross-project memory search"], timeout: 30_000, desc: "memory recall results" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "05-memory-recall" },
    { t: "prompt", s: "Change the default page size back from 10 to 5. Keep the suite green.", cps: 28 },
    { t: "fn", desc: "task two lands (lesson applied)", fn: async (s) => {
      // soft tail: the closing still must always fire (workflow §recipe);
      // the pane dump + audits judge whether the lesson visibly applied.
      const landed = await s.waitForExternal({
        desc: "default page size back to 5",
        timeout: 420_000, poll: 1500,
        check: async () => (await s.exec(`grep -cF '?? "5"' ${DEMO_DIR}/src/server.ts`)).trim() === "1",
      }).then(() => true).catch(() => false);
      if (landed) await waitTurnIdle(s, 180_000, "task two turn complete").catch(() => {});
      else s.log("warn: task two did not land before the tail budget — still fires for audit");
    }},
    { t: "linger", ms: 1800 },
    { t: "still", name: "06-lesson-applied" },
  ],
};

const s11 = {
  // The browser round's own lane: the visitor check. The dev server is
  // already running (the harness pre-starts it — the realistic "can you
  // check the site" state); the agent opens the landing page with its
  // browser tool, reads the a11y tree, finds the curl install command,
  // clicks the GitHub link, screenshots where it landed, and reports.
  name: "browser-verify", cwd: REPO_ROOT, port: 7620, env: {},
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "01-session" },
    { t: "prompt", s: "The landing page dev server is already running at http://localhost:3000. Give it a quick visitor check with your browser tool: open the page, take an accessibility snapshot, find the exact curl install command it prints, then click the GitHub link and screenshot where you land. Report the install command and the page you ended up on.", cps: 28 },
    // browser(v2) prints its tool blocks as "web <action>" (tools.ts:199 —
    // the display title), so the anchor is "web navigate"
    { t: "wait", include: ["web navigate"], timeout: 180_000, desc: "browser opened the landing page" },
    { t: "linger", ms: 2000 },
    { t: "still", name: "02-browser-open" },
    // soft tail: the whole browsing turn may span several tool calls; the
    // closing still always fires (pane dump + audits judge the report)
    { t: "fn", desc: "visitor check turn complete", fn: (s) => waitTurnIdle(s, 420_000, "browser check complete").catch((e) => s.log(`warn: ${e.message}`)) },
    { t: "linger", ms: 1600 },
    { t: "still", name: "03-check-report" },
  ],
};

const s12 = {
  // The Dreams + Memory screens of `unown dashboard` against the LIVE
  // engine — the dream rows are the real AutoDream history (the s10 lane's
  // own dream will be the newest row), the detail view shows the canary/
  // guard note + rendered output + consumed notes, and the Memory screen
  // shows the four tiers with versions and the injection budget.
  name: "dream-dashboard", cwd: REPO_ROOT, port: 7621, env: {},
  bootCmd: `bun ${unownBin} dashboard dreams`,
  ready: { include: ["unown dashboard", "Dreams"], desc: "dashboard dreams screen" },
  steps: [
    { t: "waitReady", timeout: 60_000 },
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-dreams" },
    { t: "key", k: "Enter" },
    // the detail heading "dream · <status>" prints immediately; the
    // "consumed notes" section sits below the fold when the dream output is
    // long (the 36-row pane only shows canary note + output start)
    { t: "wait", include: ["dream ·"], timeout: 20_000, desc: "dream detail open" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "02-dream-detail" },
    { t: "key", k: "2" },
    { t: "wait", include: ["injection budget"], timeout: 20_000, desc: "memory screen" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "03-memory-tiers" },
  ],
};

/* ------------------------------------------------------------------ */
/* s13-s22 — the 2026-10-24 capture round: the dex's pending lanes.     */
/* Every lane closes one `captures: PENDING` entry in dex-data.ts —     */
/* the ten "no capture yet" plates a visitor met while clicking the     */
/* spine. Same contracts as s1-s12: pane-truth anchors, real model      */
/* turns through the live bridge, stills at the story's beats, and the  */
/* honest-provenance rules of docs/tui-capture-workflow.md.             */
/* ------------------------------------------------------------------ */

const s13 = {
  // № 001 Websearch — the keyless chain answering a sourced question in a
  // real session. The question is picked to be stable forever (Node.js
  // first release: 2009, Ryan Dahl — Wikipedia holds both), so the lane
  // never rots, and the keyless chain's Wikipedia lane answers it from a
  // datacenter IP even where DuckDuckGo gets challenged (the cascade notes
  // surface in the tool result — the chain visibly working IS the story).
  name: "websearch", cwd: DEMO_DIR, port: 7622, env: {},
  steps: [
    { t: "waitReady" },
    // 2026-10-25 (SOTA re-cut): the keyless chain's results are CACHED from any
    // earlier ask — a re-run answers from the store in ~2s and the tool blocks
    // scroll past before a mid-turn beat can catch them. Clearing the store
    // gives the lane its honest first-ever-ask pacing (the cascade notes ARE
    // the story). Blocks render as "web <query>" / "web <url>" (the
    // browser-family display form), never the literal tool names.
    { t: "fn", desc: "clear the web results store for a live first ask", fn: async (s) => {
      await s.exec("rm -rf /home/z/.unown/cache/web/entries");
    }},
    { t: "prompt", s: "Use the web_search tool to look up who created Node.js and the year it was first released, then answer with the URL of the source you actually read. Do not answer from memory.", cps: 30 },
    { t: "wait", include: ["web_search tool"], timeout: 30_000, desc: "prompt echoed" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "01-session-with-question" },
    // 2026-10-25 (SOTA re-cut): web_search's renderCall prints "web <query>"
    // (the browser-tool family's display form), not the literal tool name —
    // the shipped anchor predated the renderer and never matched on the
    // 2.7s keyless-chain turn. The literal query prefix is the block's face.
    { t: "wait", include: ["web who created", "web http"], mode: "any", timeout: 180_000, desc: "search tool block" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "02-search-running" },
    { t: "fn", desc: "turn complete", fn: (s) => waitTurnIdle(s, 300_000, "websearch turn complete") },
    // 2026-10-25 (SOTA re-cut): the shipped cut's closing beat could land on
    // the tool-output tail while the answer sat below the fold (VLM: "no
    // concluding answer"). Soft-anchor the answer itself before the still —
    // the stable-forever question pins the wording (Ryan Dahl / 2009).
    { t: "fn", desc: "answer on screen", fn: async (s) => {
      await s.wait({ include: ["Ryan Dahl", "2009"], mode: "any", timeout: 30_000, desc: "answer text visible" }).catch(() => {});
    }},
    { t: "linger", ms: 2000 },
    { t: "still", name: "03-answer-with-sources" },
  ],
};

const s14 = {
  // № 002 Mcp — a real MCP stdio server (the harness's own
  // fixtures/mini-mcp-dice.mjs: initialize → tools/list → tools/call over
  // newline-delimited JSON-RPC) configured at user scope before boot, so
  // the session picks it up the way the docs promise: its tool arrives as
  // mcp__dice__roll, permissions and all, and the agent uses it live.
  // Prep (prep_demo.sh s14-mcp): `unown mcp add dice bun <repo>/scripts/
  // tui-capture/fixtures/mini-mcp-dice.mjs` — user scope, trusted by
  // definition (the user's own config dir).
  name: "mcp", cwd: DEMO_DIR, port: 7623, env: {},
  steps: [
    { t: "waitReady" },
    // 2026-10-25 (SOTA re-cut): the bare "roll a d20" ask read as a toy
    // command (VLM: "arbitrary for a coding agent"). The dev-real frame —
    // picking a random port for a test server — is the same tool call.
    // The dice turn also finishes in ~2s (the stdio MCP round trip is that
    // fast), so every mid-turn still raced it byte-identical: the ask is now
    // TYPED and stilled before Enter (the session-with-ask face the dex
    // poster promises), and a second real turn applies the result.
    { t: "fn", desc: "type the ask, still it, then send", fn: async (s) => {
      await s.type("I need a random port number for the test fixture server. Use the dice MCP server to roll a d20 and tell me the result.", { cps: 30 });
      await s.linger(700);
      await s.still("01-session-with-ask");
      await s.enter();
    }},
    { t: "wait", include: ["You rolled a"], timeout: 60_000, desc: "roll result rendered" },
    { t: "fn", desc: "roll turn complete", fn: (s) => waitTurnIdle(s, 240_000, "mcp roll turn complete") },
    { t: "linger", ms: 1600 },
    { t: "still", name: "02-rolled-result" },
    // apply the roll: a second real turn that puts the result to work — the
    // agent greps the fixture for port references and answers.
    { t: "prompt", s: "Use 2000 for the fixture port. Check src/ and test/ to make sure nothing already references it, and tell me whether it is safe to use.", cps: 30 },
    { t: "fn", desc: "port-check turn complete", fn: async (s) => {
      await s.wait({ include: ["grep ", "bash ", "ls ", "read "], mode: "any", timeout: 180_000, desc: "port check tool block" }).catch(() => {});
      await waitTurnIdle(s, 300_000, "mcp port-check turn complete").catch(() => {});
    }},
    { t: "linger", ms: 2000 },
    { t: "still", name: "03-port-checked" },
  ],
};

const s15 = {
  // № 004 Lsp — the reading form's two halves in one session: the
  // graph-ranked repo map (/repomap, tree-sitter symbols + reference
  // ranking) that orients every fresh subagent, then a rename driven
  // through edits while typescript-language-server's diagnostics ride
  // each tool result (PostToolUse feedback loop — broken intermediate
  // states surface as compiler feedback instead of compounding).
  // Fixture: tag "fixed" (green suite); the rename keeps it green.
  name: "lsp", cwd: DEMO_DIR, port: 7624, env: {},
  steps: [
    { t: "waitReady" },
    { t: "prompt", s: "/repomap", cps: 30 },
    { t: "wait", include: ["pagination"], timeout: 30_000, desc: "repo map rendered" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "01-repomap" },
    { t: "prompt", s: "Rename the paginate function to paginateItems across src/ and test/, keeping the whole test suite green.", cps: 30 },
    { t: "fn", desc: "edit block with diagnostics", fn: async (s) => {
      await s.wait({ include: ["Rename the paginate function"], timeout: 30_000, desc: "prompt echoed" });
      await s.wait({ include: ["edit "], timeout: 300_000, desc: "first edit block" });
      await s.linger(1200);
      await s.still("02-edit-riding-diagnostics");
    }},
    { t: "fn", desc: "turn complete", fn: (s) => waitTurnIdle(s, 420_000, "rename turn complete") },
    { t: "linger", ms: 2200 },
    { t: "still", name: "03-rename-green" },
  ],
};

const s16 = {
  // № 022 The parity round — the 2026 consensus workflows in one live
  // session: the persona layer (/output-style listing + set), the
  // side-question lane (/btw answering from context in a dismissible
  // overlay that never enters the transcript), cross-session analytics
  // (/insights), and the auto-title proven by /name. The ttyd-lane movie
  // of the story pty_capture_parity.py filmed as stills (same anchors).
  name: "parity-round", cwd: REPO_ROOT, port: 7625, env: {},
  steps: [
    { t: "waitReady" },
    // fresh per-run style state so the listing still shows "active: default"
    { t: "fn", desc: "clean output-style state", fn: async (s) => {
      await s.exec("rm -f .unown/output-style.json").catch(() => {});
    }},
    // one real turn: context for /btw, material for the auto-title.
    // 2026-10-25 (SOTA re-cut): the shipped "Reply with exactly: …" context
    // turn was a harness test-case, not a dev ask (VLM: "a test case, not a
    // dev task"). A docs question is real work and feeds /btw the same way.
    { t: "prompt", s: "Read docs/usage.md and answer in one sentence: what does the /btw command do?", cps: 30 },
    { t: "fn", desc: "context turn", fn: async (s) => {
      await s.wait({ include: ["btw"], timeout: 120_000, desc: "answer landed" }).catch(() => {});
      await waitTurnIdle(s, 120_000, "context turn complete").catch(() => {});
    }},
    { t: "prompt", s: "/output-style", cps: 30 },
    { t: "wait", include: ["Output styles"], timeout: 20_000, desc: "style listing" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "01-output-styles" },
    { t: "prompt", s: "/output-style concise", cps: 30 },
    { t: "wait", include: ["Output style set: concise"], timeout: 20_000, desc: "style set" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "02-style-set" },
    { t: "prompt", s: "/btw what did I just ask you about?", cps: 30 },
    // the /btw side-channel rides the bridge's BACKGROUND lane (the same
    // lane AutoDream and skill-minting use) and the overlay mounts only
    // AFTER the answer resolves — 2026-10-25 live runs measured 1s on a
    // quiet engine but 20s+ behind a mint queue, so the old "wait for the
    // word btw" (which the ECHOED COMMAND matches instantly) plus a fixed
    // 12s sleep missed the overlay entirely. Anchor the overlay's OWN
    // chrome — the dismiss hint only exists while it is mounted.
    { t: "wait", include: ["esc / enter / q"], timeout: 300_000, desc: "btw overlay mounted" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "03-btw-overlay" },
    { t: "fn", desc: "dismiss the overlay (Esc, verified live)", fn: async (s) => {
      // a bare Esc dismisses (probed on the live TUI); loop until the hint
      // is gone so a slow last paint can never eat the next command.
      for (let attempt = 0; attempt < 8; attempt++) {
        const text = String(await s.tmux.text());
        if (!text.includes("esc / enter / q")) return;
        await s.key("Esc");
        await s.sleep(1_200);
      }
      throw new Error("btw overlay did not dismiss after 8 attempts");
    }},
    { t: "linger", ms: 800 },
    { t: "prompt", s: "/insights", cps: 30 },
    // the report renders as one tall notify toast — taller than the 36-row
    // pane, so its SECTION HEADERS scroll out of view and only the tail
    // ("window: N days · generated …") stays visible: anchor THAT. ~12s
    // against the quiet engine; 90s covers a cold bridge fetch.
    { t: "wait", include: ["window:"], timeout: 90_000, desc: "insights report" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "04-insights" },
    { t: "fn", desc: "auto-title landed", fn: async (s) => {
      // the background title call can take up to two minutes on the
      // bridge's background lane — poll the /name output like the PTY lane
      const deadline = Date.now() + 150_000;
      for (;;) {
        await s.prompt("/name", { cps: 30 });
        await s.sleep(2500);
        const text = String(await s.text());
        if (text.includes("Session name:")) break;
        if (Date.now() > deadline) break;
      }
      await s.wait({ include: ["Session name:", "Usage: /name"], mode: "any", timeout: 15_000, desc: "session name output" }).catch(() => {});
    }},
    { t: "linger", ms: 1200 },
    { t: "still", name: "05-auto-title" },
  ],
};

const s17 = {
  // № 006 Harness — the Learning Lab screen of `unown dashboard` against
  // the live engine, after a REAL harness cycle was run through the
  // engine API (POST /api/tasks/<id>/run — the pipeline's prep step), so
  // the screen shows the cycle the engine actually ran: task, baseline
  // pass/fail, the mined-rule decision, and the transcript.
  name: "harness", cwd: REPO_ROOT, port: 7626, env: {},
  bootCmd: `bun ${unownBin} dashboard lab`,
  ready: { include: ["unown dashboard", "Learning"], desc: "dashboard learning-lab screen" },
  steps: [
    { t: "waitReady", timeout: 60_000 },
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-learning-lab" },
    // the dashboard opens with focus on the section sidebar (the footer
    // reads "tab sections · j/k select") — Tab hands focus to the content
    // list first, then Enter opens the selected cycle's run detail
    { t: "key", k: "Tab" },
    { t: "linger", ms: 600 },
    { t: "key", k: "Enter" },
    { t: "fn", desc: "cycle detail open", fn: async (s) => {
      await s.wait({ include: ["prompt", "transcript", "verify"], mode: "any", timeout: 20_000, desc: "run detail view" }).catch(() => {});
      await s.linger(1500);
      await s.still("02-cycle-detail");
    }},
  ],
};

const s18 = {
  // № 007 Router — the Router screen: the engine's real job table —
  // dreams, harness, automations, the busy-mutex — against the live
  // engine, exactly the "signpost that walks its own routes" story.
  name: "router", cwd: REPO_ROOT, port: 7627, env: {},
  bootCmd: `bun ${unownBin} dashboard router`,
  ready: { include: ["unown dashboard", "Router"], desc: "dashboard router screen" },
  steps: [
    { t: "waitReady", timeout: 60_000 },
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-router-jobs" },
    // 2026-10-25 (SOTA re-cut): the Router screen's own interaction model is
    // "space triggers, d toggles" — there is NO per-job detail view (the
    // shipped "Enter opens a detail" step selected nothing: both shipped
    // stills and every frame of the shipped movie showed the same jobs table,
    // which the shipped VLM audit correctly read as four identical static
    // screens). The honest visible action is the screen's own: walk the
    // selection onto auto-dream (the interval job a trigger actually starts —
    // probed live; the first row is the event-driven dream-check) and trigger
    // it — the emerald toast + the running row are the beat, and the engine
    // really runs the job.
    { t: "key", k: "j" },
    { t: "linger", ms: 500 },
    { t: "key", k: "j" },
    { t: "linger", ms: 600 },
    { t: "key", k: "Space" },
    { t: "fn", desc: "job triggered", fn: async (s) => {
      await s.wait({ include: ["job triggered"], timeout: 20_000, desc: "trigger toast" }).catch(() => {});
      await s.linger(1600);
      await s.still("02-job-triggered");
    }},
  ],
};

const s19 = {
  // № 019 Routines — the full routines manager (`unown dashboard
  // routines`) against the live engine with a REAL routine created
  // through the CLI first (prep: unown routines create --title 'morning
  // brief' --every '1d at 09:00' --prompt '...' — real recurrence
  // semantics: cron, every, after; per-routine timezone + misfire
  // policy), then its history view.
  name: "routines", cwd: REPO_ROOT, port: 7628, env: {},
  bootCmd: `bun ${unownBin} dashboard routines`,
  ready: { include: ["unown dashboard", "Routines"], desc: "dashboard routines screen" },
  steps: [
    { t: "waitReady", timeout: 60_000 },
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-routines-manager" },
    { t: "key", k: "Enter" },
    { t: "fn", desc: "routine history open", fn: async (s) => {
      await s.wait({ include: ["history", "next run", "morning brief"], mode: "any", timeout: 20_000, desc: "routine detail" }).catch(() => {});
      await s.linger(1500);
      await s.still("02-routine-detail");
    }},
  ],
};

const s20 = {
  // № 021 Skills — the Skills screen: what the agent shipped itself.
  // Requires the engine to have actually minted a skill through the
  // harness loop (mine → candidate → re-run → ship), which the pipeline's
  // engine-prep step drives for real (minted variant tasks until a ship
  // lands). The screen shows the shipped skill rows; Enter opens one.
  name: "skills", cwd: REPO_ROOT, port: 7629, env: {},
  bootCmd: `bun ${unownBin} dashboard skills`,
  ready: { include: ["unown dashboard", "Skills"], desc: "dashboard skills screen" },
  steps: [
    { t: "waitReady", timeout: 60_000 },
    { t: "linger", ms: 1500 },
    { t: "still", name: "01-skills-shipped" },
    { t: "key", k: "Enter" },
    { t: "fn", desc: "skill detail open", fn: async (s) => {
      await s.wait({ include: ["skill", "rule", "evidence"], mode: "any", timeout: 20_000, desc: "skill detail" }).catch(() => {});
      await s.linger(1500);
      await s.still("02-skill-detail");
    }},
  ],
};

const s21 = {
  // № 019 Goals — the durable, evidence-verified objective: /goal sets the
  // objective (footer chip "goal: active"; the contract rides the system
  // prompt FROM THE NEXT MESSAGE — setting it starts no work), the user
  // starts the turn, the agent works it with todos, and the completion
  // gate only passes with the [GOAL:COMPLETE] tag on its own line, every
  // todo done, and BOTH kinds of cited evidence (a changed-file path AND
  // a command output). The footer chip flipping to "goal: ✓ complete" is
  // the state anchor — prose anchors false-match the model's own text.
  name: "goals", cwd: DEMO_DIR, port: 7630, env: {},
  steps: [
    { t: "waitReady" },
    { t: "prompt", s: "/goal Add a GET /health endpoint returning {ok:true} to this API server, with a test proving the response shape. Track it with a todo and complete only with real evidence.", cps: 30 },
    { t: "wait", include: ["Goal set:"], timeout: 30_000, desc: "goal acknowledged" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "01-goal-set" },
    // the goal rides the NEXT message — nothing happens until the user
    // starts the turn. (Earlier cuts gave the agent 3 endpoints + tests +
    // README: real work, but the turn outgrew the driver's 575s box and
    // the gate never closed — one endpoint closes inside the budget.)
    { t: "prompt", s: "Start working on the goal now and complete it in this turn.", cps: 30 },
    // the mid-work beat anchors on the FILESYSTEM, not the pane: the demo
    // tree is clean at boot, so a dirty git status means real edits are
    // landing (pane-text anchors false-matched the boot context's "read")
    { t: "fn", desc: "goal work underway", fn: async (s) => {
      await s.waitForExternal({
        // s.exec resolves to the raw stdout STRING (and rejects on failure) —
        // an earlier shape bug read `.status` off the promise and never fired
        check: async () => {
          const out = String(await s.exec("git -C '" + DEMO_DIR + "' status --porcelain", { timeout: 10_000 }));
          return out.split("\n").some((l) => l.trim() && !l.includes(".unown"));
        },
        timeout: 300_000, poll: 2_000, desc: "first real edits land in the tree",
      });
      await s.linger(1600);
      await s.still("02-goal-work");
    }},
    // completion is a FOOTER STATE, not prose: "goal: ✓ complete" only
    // renders when the evidence gate actually passed
    { t: "fn", desc: "goal completes with evidence", fn: async (s) => {
      await s.wait({ include: ["goal: \u2713 complete"], timeout: 300_000, desc: "completion gate passed" });
      await waitTurnIdle(s, 120_000, "goal turn complete").catch(() => {});
    }},
    { t: "linger", ms: 1800 },
    { t: "still", name: "03-goal-complete" },
    { t: "prompt", s: "/goal", cps: 30 },
    { t: "fn", desc: "goal status", fn: async (s) => {
      await s.wait({ include: ["complete", "evidence", "active"], mode: "any", timeout: 20_000, desc: "status output" }).catch(() => {});
      await s.linger(1200);
    }},
    { t: "still", name: "04-goal-status" },
  ],
};

const s22 = {
  // № 018 Split view — the display mode's own band, dock and transcript,
  // FILMED (the dex copy said "stills only — this lane ships no movie";
  // this round ships one). /split mounts the Thinking + Tool Usage band
  // and the Files dock on the real pi-tui split geometry; a live turn
  // fills the band with reasoning and tool blocks while the dock shows
  // the edit diff, and the response-only transcript carries the answer.
  name: "split-view", cwd: DEMO_DIR, port: 7631, env: {},
  steps: [
    { t: "waitReady" },
    { t: "prompt", s: "/split", cps: 30 },
    { t: "fn", desc: "split panels mounted", fn: async (s) => {
      await s.wait({ include: ["Thinking"], timeout: 20_000, desc: "split band up" }).catch(() => {});
      await s.linger(1200);
    }},
    { t: "prompt", s: "Add a /health route returning {ok:true} to the API server, with a test.", cps: 30 },
    { t: "wait", include: ["/health route"], timeout: 30_000, desc: "prompt echoed" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "01-split-band" },
    { t: "fn", desc: "live thinking + tools", fn: async (s) => {
      await s.wait({ include: ["Thinking"], timeout: 30_000, desc: "thinking panel live" }).catch(() => {});
      await s.linger(1800);
      await s.still("02-thinking-tools-live");
    }},
    { t: "fn", desc: "files dock with diff", fn: async (s) => {
      await s.wait({ include: ["edit ", "write "], mode: "any", timeout: 300_000, desc: "edit under way" });
      await s.linger(1500);
      await s.still("03-files-dock");
    }},
    { t: "fn", desc: "turn complete", fn: (s) => waitTurnIdle(s, 420_000, "split-view turn complete") },
    { t: "linger", ms: 1800 },
    { t: "still", name: "04-response-transcript" },
    // 2026-10-25 (SOTA re-cut): the shipped cut ended on the answer with a
    // failed-then-fixed test pair unresolved mid-story (VLM: "bash fails, final
    // shows success — inconsistent"). The repo's own closing convention — the
    // user's flake-guard re-run — closes the arc with the green tally visible
    // in split view.
    { t: "prompt", s: "!bun test", cps: 24 },
    { t: "wait", include: [" 0 fail"], timeout: 90_000, desc: "suite green in split view" },
    { t: "linger", ms: 1800 },
    { t: "still", name: "05-suite-green" },
  ],
};

/* ────────────────────────────────────────────────────────────────────────
 * s23-s24 — the 2026-10-24 media-completion round
 *
 * The two surfaces a visitor could click to and find nothing moving:
 *   s23 browser-subagent — the delegated browser flow END TO END as film
 *       (the 2026-10-24 PTY stills lane, superseded by a moving cut: sync
 *       delegation → humanized live labels → done → report → async fleet
 *       widget → /tasks registry), and
 *   s24 sdlc — the № 010 Parity plate closed with the NEWEST parity ports
 *       filmed live (/context, the context-window view + the session
 *       workflow: /sessions list → /sessions export --md → the exported
 *       markdown on disk → /sessions list --all).
 * Ports 7632-7633 extend the catalog's block.
 * ──────────────────────────────────────────────────────────────────────── */

const BROWSER_FIXTURE_PAGE = `<!doctype html><html><head><title>Subagent Fixture</title></head><body>
<h1>Form page</h1>
<form id="f" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'submitted ' + document.getElementById('nm').value + '/' + document.getElementById('sel').value;">
<input id="nm" type="text" placeholder="name">
<select id="sel"><option value="a">Alpha</option><option value="b">Beta</option></select>
<button type="submit" id="go">Submit form</button>
</form>
<div id="out"></div>
</body></html>`;

const s23 = {
  // --no-split: the classic transcript look with maximum room for the task
  // rows, the fleet widget and the story's beats (same visual language as
  // s9-fleet, the other subagent lane).
  name: "browser-subagent", cwd: REPO_ROOT, port: 7632, env: {},
  bootCmd: `bun ${unownBin} --no-split`,
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 1000 },
    // Fresh fleet state + the local form fixture the child will really fill
    // (a real rendered page is the only place the confirmation text can come
    // from — the proof the whole loop ran, not a mock).
    { t: "fn", desc: "fixture page + fresh fleet registry", fn: async (s) => {
      await s.exec(`rm -rf ${REPO_ROOT}/.unown/fleet`);
      await s.exec("mkdir -p /tmp/browsersub-fixture");
      await s.exec(`printf '%s\\n' ${JSON.stringify(BROWSER_FIXTURE_PAGE)} > /tmp/browsersub-fixture/index.html`);
      // [h]ttp bracket: pkill -f 'http.server' would match THIS bash's own
      // cmdline (the pattern string rides in it) and kill the shell mid-step
      await s.exec("pkill -f '[h]ttp.server 7788' 2>/dev/null; true");
      await s.exec("nohup python3 -m http.server 7788 --directory /tmp/browsersub-fixture >/tmp/browsersub-http.log 2>&1 & echo $! > /tmp/browsersub-http.pid");
      await s.waitForExternal({
        check: async () => {
          try { return String(await s.exec("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7788/", { timeout: 5_000 })) === "200"; }
          catch { return false; }
        },
        timeout: 20_000, poll: 1_000, desc: "fixture page serving",
      });
    }},
    { t: "still", name: "01-boot-session" },
    // The sync delegation: the task row mounts, the child really drives the
    // page, the humanized labels ride the row, the report comes back.
    { t: "prompt", s: 'Delegate a web task to the browser subagent right now using the task tool with agent set to browser. The task: open http://127.0.0.1:7788/ in the browser, type Ada into the name field, pick the Beta option, click Submit form, then report the confirmation text exactly. Do not open the page yourself; delegate it.', cps: 30 },
    { t: "wait", include: ["task → browser"], timeout: 240_000, desc: "delegation row rendered" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "02-task-call" },
    { t: "wait", include: ["browser: navigate", "browser: click", "browser: fill_form", "browser: snapshot", "browser: type", "browser: start"], mode: "any", timeout: 240_000, desc: "humanized live label" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "03-live-browser" },
    { t: "wait", include: ["browser: ✓", "browser: ✗", "browser: ⊘"], mode: "any", timeout: 300_000, desc: "finished task row" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "04-done" },
    // The report reaching the parent transcript is model-timed and can scroll
    // past the pane — best-effort, never fatal to the lane. 2026-10-25
    // (SOTA re-cut): the old anchor also accepted "submitted", which the
    // child's LIVE labels (the fixture page's own confirmation text) print
    // during 04 — the wait passed instantly, the pane had not changed, and
    // 05 shipped byte-identical to 04. The parent-side report block's own
    // prefix is the only unambiguous marker; when it does not land in the
    // fold, the still is skipped and the movie carries the beat.
    { t: "fn", desc: "child report (best effort)", fn: async (s) => {
      const seen = await s
        .wait({ include: ["Outcome:"], timeout: 150_000, desc: "child report" })
        .then(() => true)
        .catch(() => false);
      if (seen) {
        await s.linger(1200);
        await s.still("05-report");
      } else {
        await s.linger(800);
      }
    }},
    // The async lane: the fleet widget above the editor with the ◉ browser
    // row, then the /tasks lifecycle registry.
    { t: "prompt", s: 'Now spawn the browser subagent IN THE BACKGROUND: call the task tool with async true and agent browser, with this task: open http://127.0.0.1:7788/ and report the page heading. Acknowledge immediately; do not wait for it to finish.', cps: 30 },
    { t: "wait", include: ["Subagents"], timeout: 240_000, desc: "fleet widget up" },
    { t: "fn", desc: "fleet row carries the live label (best effort)", fn: async (s) => {
      await s
        .wait({ include: ["browser: navigate", "browser: snapshot", "browser: start", "browser: click"], mode: "any", timeout: 90_000, desc: "fleet row label" })
        .catch(() => {});
      await s.linger(1500);
      await s.still("06-fleet");
    }},
    // The async child finishes on its own clock; its result arrives as a new
    // turn (the fleet lane's "finished in" beat). /tasks is an idle-context
    // command — typing it mid-turn queues it behind the child's arrival, so
    // the lane waits the parent's turn out first (s9's proven shape).
    { t: "fn", desc: "async child result arrives / parent idle", fn: (s) => waitTurnIdle(s, 300_000, "async child turn settles") },
    { t: "linger", ms: 1200 },
    { t: "prompt", s: "/tasks", cps: 30 },
    { t: "wait", include: ["Resumable"], timeout: 90_000, desc: "registry shown" },
    { t: "linger", ms: 1800 },
    { t: "still", name: "07-tasks" },
    { t: "fn", desc: "stop the fixture server", fn: async (s) => {
      await s.exec("kill $(cat /tmp/browsersub-http.pid) 2>/dev/null; true").catch(() => {});
    }},
  ],
};

const s24 = {
  // № 010 Parity — the checklist counted out loud. The filmed surface is the
  // session-workflow round (the NEWEST of the 15 ports, "blame + sessions")
  // plus /context (the context round): a real task gives the session real
  // turns, then the workflow surfaces one beat at a time. Every anchor is a
  // literal the TUI itself prints — the pane is the truth.
  name: "sdlc", cwd: DEMO_DIR, port: 7633, env: {},
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 1200 },
    { t: "still", name: "01-boot-fresh-session" },
    // One real task: the session this lane exports needs real turns, real
    // tool calls, real tokens — a fabricated session would be a lie the
    // exported markdown would expose immediately.
    { t: "prompt", s: "Read src/pagination.ts and tell me in one sentence what it does.", cps: 30 },
    { t: "fn", desc: "turn complete", fn: (s) => waitTurnIdle(s, 300_000, "real turn complete") },
    { t: "linger", ms: 1500 },
    { t: "still", name: "02-real-turn" },
    // /context — where the window goes, mid-session, with real accounting.
    { t: "prompt", s: "/context", cps: 30 },
    { t: "wait", include: ["Where it goes:"], timeout: 30_000, desc: "context report rendered" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "03-context-view" },
    // /sessions list — the project store + the user store, merged and
    // deduped (the both-stores fix this round shipped).
    { t: "prompt", s: "/sessions list", cps: 30 },
    { t: "wait", include: ["Sessions in this project:"], timeout: 60_000, desc: "sessions listed" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "04-sessions-list" },
    // /sessions export --md — the share artifact, redacted by default.
    { t: "prompt", s: "/sessions export --md", cps: 30 },
    { t: "wait", include: ["Exported session"], timeout: 60_000, desc: "export confirmed" },
    { t: "linger", ms: 1400 },
    { t: "still", name: "05-export-confirmed" },
    // The artifact itself on screen — the path comes from the confirmation
    // line (which WRAPS: the notify renders the session id and the path on
    // separate rows, so match the export filename anywhere in the pane).
    { t: "fn", desc: "cat the exported markdown", fn: async (s) => {
      const pane = await s.tmux.text();
      const p = pane.split("\n").map((l) => l.match(/\S*export-[0-9a-f-]+\.md/)?.[0]).find(Boolean);
      if (!p) throw new Error("no export path in pane — cannot cat the artifact");
      await s.prompt(`!head -n 24 '${p}'`, { cps: 30 });
      // the artifact's FIRST row (# Unown session — …) scrolls above the
      // 36-row fold when the confirmation is still on screen — anchor on
      // rows that land inside the fold: the passthrough echo and the
      // manifest table's Model row.
      try {
        await s.wait({ include: ["$ head", "| Model |"], mode: "any", timeout: 30_000, desc: "markdown on screen" });
      } catch (err) {
        // the full pane rides the error so a failed lane tells the truth
        const cur = await s.tmux.text();
        throw new Error(`markdown never rendered — pane dump:\n${cur}`);
      }
      await s.linger(1800);
      await s.still("06-exported-markdown");
    }},
    // The machine-wide view: every project's sessions, one flag away.
    // 2026-10-25 (SOTA re-cut): the shipped cut's closing frame caught the
    // list mid-render (VLM: "the sessions list cuts off abruptly") — settle
    // the listing before the closing beat so the full table reads.
    { t: "prompt", s: "/sessions list --all", cps: 30 },
    { t: "wait", include: ["Sessions on this machine"], timeout: 60_000, desc: "machine-wide listing" },
    { t: "linger", ms: 2200 },
    { t: "still", name: "07-all-machine-sessions" },
  ],
};

/** s25-build-session — the builder round: one real session, one whole app.
 *
 * The landing page's live-preview band needs a build filmed end-to-end: a
 * fresh empty project (just PRODUCT-BRIEF.md), one mission prompt, and the
 * agent designing + writing + testing + verifying a complete fullstack app
 * (Bun server + REST API + JSON store + vanilla frontend + bun test suite)
 * without any human keystroke after the prompt. The scenario is long by
 * design (~15-30 min of real turns; every other lane compresses a story
 * into seconds — this one is the honest uncut build). The stills anchor on
 * states that differ by construction (brief read, plan visible, backend
 * files, frontend files, test run, curl verify, finished turn), and the
 * frame recorder keeps the whole movie between them.
 *
 * Fixture: a fresh dir with ONLY the brief — no prep_demo.sh state. The
 * app the session produces is the artifact the landing band embeds, so
 * the dir must start empty (the receipts quote the file inventory).
 */
const S25_CWD = process.env.UNOWN_BUILD_DIR || "/home/z/my-project/glyphquests-filmed";
const s25 = {
  name: "build-session",
  cwd: S25_CWD,
  port: 7634,
  env: {},
  steps: [
    { t: "waitReady", timeout: 120_000 },
    { t: "linger", ms: 1200 },
    { t: "still", name: "01-boot-empty-project" },
    // The one and only keystroke burst a real user sends: the mission.
    // No "!" / "@" / "/" inside the body (autocomplete-popup hygiene).
    {
      t: "prompt",
      s: "Read PRODUCT-BRIEF.md in this directory and build exactly what it describes: the complete Glyph Quests app, tests included. Follow the brief's architecture contract and file layout precisely. Then run the tests until they all pass, verify the server endpoints with curl as the brief's mission section describes, fix everything you find broken, and end with the one-paragraph summary the brief asks for.",
      cps: 30,
    },
    // Anchors are TOOL-ROW chrome, never prose: the first cut of this spec
    // anchored on bare filenames ("store.ts", "app.js"…) mode:"any" and the
    // stills fired on the model's PLAN TEXT minutes before the work; the
    // second cut anchored on the todo panel HEADER ("Todos (N/M)") mode:all
    // and died — the header scrolls off the 36-row fold while the panel's
    // rows stay, so "all" could never match again (a hard wait timeout kills
    // the whole ~20-minute session). This cut: (a) anchor on rendered row
    // chrome ("✓  read <path>", "•  write …", "$ bun test", the todo rows'
    // "├─ ○"/"◐" markers), (b) EVERY story wait is SOFT — a miss logs and
    // captures the pane as-is, because a long real session is worth more
    // than a perfect anchor, and (c) the closing still always fires.
    { t: "fn", desc: "wait for the brief's read row (soft)", fn: async (s) => {
      try {
        await s.wait({ include: ["read ", "PRODUCT-BRIEF.md"], mode: "all", timeout: 240_000, desc: "the brief's read row" });
      } catch { s.log("soft wait missed: brief read row — capturing the pane as-is"); }
    }},
    { t: "linger", ms: 1000 },
    { t: "still", name: "02-reading-the-brief" },
    // The plan: any todo panel row chrome (pending ○ / in-progress ◐ /
    // completed ● markers ride every row; the header may have scrolled).
    { t: "fn", desc: "wait for the todo plan (soft)", fn: async (s) => {
      try {
        await s.wait({ include: ["├─ ○", "└─ ○", "◐ in_progress", "● completed"], mode: "any", timeout: 360_000, desc: "todo panel rows visible" });
      } catch { s.log("soft wait missed: todo rows — capturing the pane as-is"); }
    }},
    { t: "linger", ms: 900 },
    { t: "still", name: "03-the-plan" },
    // Files being written: a write/edit tool row (bullet or check form).
    { t: "fn", desc: "wait for a write row (soft)", fn: async (s) => {
      try {
        await s.wait({ include: ["•  write", "✓  write", "•  edit", "✓  edit"], mode: "any", timeout: 420_000, desc: "a write or edit row on screen" });
      } catch { s.log("soft wait missed: write rows — capturing the pane as-is"); }
    }},
    { t: "linger", ms: 900 },
    { t: "still", name: "04-writing-the-app" },
    // The suite runs: the bun test bash row, or bun test's own output
    // markers ("Ran N tests", "(pass)" rows).
    { t: "fn", desc: "wait for the test run (soft)", fn: async (s) => {
      try {
        await s.wait({ include: ["$ bun test", "Ran ", "pass)"], mode: "any", timeout: 600_000, desc: "bun test row or output" });
      } catch { s.log("soft wait missed: test run — capturing the pane as-is"); }
    }},
    { t: "linger", ms: 1000 },
    { t: "still", name: "05-tests-running" },
    // Green suite (may take iterations — the agent fixes what fails).
    // Fifth cut (2026-10-27, run-4 postmortem): the fourth cut's diagnosis
    // was wrong — bun DOES render a fail-count row on a green piped run
    // (run-4 pane dump @still 05: "  39 pass" / "  0 fail" / " Ran 39
    // tests across 1 file."), so the exclude [" fail"] blocked its own
    // match for the whole 600 s budget while the green summary sat in the
    // fold, and the stills 06/07 captured the same idle summary twice.
    // Anchor on the green-unique row itself, no exclude. A `| tail -1`
    // render never shows the row (run 4's own later re-runs) — which is
    // why this wait is SHORT: a miss hands the beat to the receipt-led
    // verify wait below, not to a timeout.
    { t: "fn", desc: "wait for the green suite (soft)", fn: async (s) => {
      try {
        await s.wait({ include: [" 0 fail"], mode: "any", timeout: 180_000, desc: "green summary row (0 fail)" });
      } catch { s.log("soft wait missed: green suite row — the verify wait carries the beat"); }
    }},
    // Server verification round-trip — receipt-led. Fifth cut (run-4
    // postmortem): the pane can NEVER anchor this beat. The echoed bash row
    // collapses a multi-line script to its first line ("✓  $ cd …" + "⋯ N
    // earlier hidden"), so "curl -s" inside the script body never renders,
    // and by the time the fourth cut's 480 s pane wait started polling the
    // round-trip had completed and scrolled off. The workflow contract's
    // own rule applies: prefer EXTERNAL state checks over screen parsing.
    // The session receipt (`.unown/receipts/*.jsonl`) is the agent's own
    // record — a bash tool_call whose command mentions curl IS the verify
    // phase starting, whatever pipe style the model chose, and its paired
    // tool_result means the round-trip output block is on screen. The
    // still's own G8 settle/repaint/verify pass does the pane-side timing.
    { t: "fn", desc: "wait for curl verification (soft, receipt-led)", fn: async (s) => {
      const fs = require("fs");
      const readReceipt = () => {
        try {
          const dir = `${S25_CWD}/.unown/receipts`;
          const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
          if (!files.length) return [];
          const newest = files
            .map((f) => ({ f, m: fs.statSync(`${dir}/${f}`).mtimeMs }))
            .sort((a, b) => b.m - a.m)[0].f;
          return fs.readFileSync(`${dir}/${newest}`, "utf8").split("\n")
            .filter(Boolean)
            .map((l) => { try { return JSON.parse(l); } catch { return null; } })
            .filter(Boolean);
        } catch { return []; }
      };
      try {
        await s.waitForExternal({
          timeout: 480_000, poll: 2_000,
          desc: "curl round-trip in the session receipt (call + result)",
          check: async () => {
            const events = readReceipt();
            let curlId = null;
            for (const d of events) {
              if (d.kind === "tool_call" && d.tool === "bash" &&
                  ((d.input || {}).command || "").includes("curl")) curlId = d.id;
            }
            if (!curlId) return false;
            return events.some((d) => d.kind === "tool_result" && d.id === curlId);
          },
        });
      } catch { s.log("soft wait missed: curl receipt — capturing the pane as-is"); }
    }},
    { t: "linger", ms: 1000 },
    { t: "still", name: "06-verifying-the-server" },
    // The finished turn: closing summary, spinner gone. Soft too — the
    // closing still fires regardless; the pane dump is the truth.
    { t: "fn", desc: "wait for the final answer (soft)", fn: async (s) => {
      try {
        await waitTurnIdle(s, 900_000, "final answer");
      } catch { s.log("soft wait missed: idle turn — capturing the pane as-is"); }
    }},
    { t: "linger", ms: 1600 },
    { t: "still", name: "07-app-built" },
  ],
};

module.exports = {
  "s1-hero-bugfix": s1,
  "s2-plan-mode": s2,
  "s3-checkpoints": s3,
  "s4-overlays": s4,
  "s5-review": s5,
  "s6-subagent-explore": s6,
  "s7-wiki": s7,
  "s8-cli-doctor": s8,
  "s9-fleet": s9,
  "s10-memory-learn": s10,
  "s11-browser-verify": s11,
  "s12-dream-dashboard": s12,
  "s13-websearch": s13,
  "s14-mcp": s14,
  "s15-lsp": s15,
  "s16-parity-round": s16,
  "s17-harness": s17,
  "s18-router": s18,
  "s19-routines": s19,
  "s20-skills": s20,
  "s21-goals": s21,
  "s22-split-view": s22,
  "s23-browser-subagent": s23,
  "s24-sdlc": s24,
  "s25-build-session": s25,
};
