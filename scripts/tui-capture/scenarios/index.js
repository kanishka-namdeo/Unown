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
    // instant the tool starts, with the diff streaming under it), so the
    // "editing" beat lands mid-edit instead of after the whole fast turn
    { t: "fn", desc: "wait for the edit block", fn: async (s) => {
      await s.wait({ include: ["edit ", "write "], mode: "any", timeout: 420_000, desc: "edit block visible" });
      await s.linger(600);
      await s.still("04-agent-editing");
    }},
    // agent re-runs the suite → green
    { t: "fn", desc: "wait for green suite", fn: async (s) => {
      await s.wait({ include: [" 0 fail"], timeout: 420_000, desc: "green suite" });
      await s.linger(1500);
      await s.still("05-tests-passing");
    }},
    // turn completes (working line gone)
    { t: "fn", desc: "turn complete", fn: (s) => waitTurnIdle(s, 420_000, "hero turn complete") },
    { t: "linger", ms: 2200 },
    { t: "still", name: "06-final-answer" },
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
    { t: "linger", ms: 900 },
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
    { t: "linger", ms: 1500 },
    { t: "still", name: "04-permissions" },
    { t: "prompt", s: "/hooks", cps: 30 },
    { t: "wait", include: ["hooks configured", "User hooks"], mode: "any", timeout: 30_000, desc: "hooks status" },
    { t: "linger", ms: 1500 },
    { t: "still", name: "05-hooks" },
  ],
};

const s5 = {
  name: "review", cwd: DEMO_DIR, port: 7614, env: {},
  steps: [
    { t: "waitReady" },
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
    { t: "linger", ms: 3000 },
    { t: "still", name: "03-verdict" },
    { t: "wait", include: ["Saved to "], timeout: 60_000, desc: "artifact saved" },
    { t: "linger", ms: 2600 },
    { t: "still", name: "04-review-artifact-saved" },
  ],
};

const s6 = {
  name: "subagent-explore", cwd: REPO_ROOT, port: 7615, env: {},
  steps: [
    { t: "waitReady" },
    { t: "linger", ms: 1000 },
    { t: "still", name: "01-boot-in-real-repo" },
    { t: "prompt", s: "Use a task subagent to explore this repository and give me a short map of the main modules and what they do.", cps: 30 },
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
    { t: "linger", ms: 900 },
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
    { t: "prompt", s: `bun ${unownBin} models`, cps: 40 },
    { t: "wait", include: ["kimi-k2.5"], timeout: 60_000, desc: "models listed" },
    { t: "linger", ms: 1600 },
    { t: "still", name: "02-models" },
    { t: "prompt", s: "clear", cps: 40 },
    { t: "wait", exclude: ["kimi-k2.5"], timeout: 20_000, desc: "cleared" },
    { t: "prompt", s: `bun ${unownBin} usage`, cps: 40 },
    { t: "wait", include: ["kimi-k2.5"], timeout: 60_000, desc: "usage table" },
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
};
