/** Scenario catalog — eight landing-page stories, each a real end-to-end
 *  session against the live stack (bridge + engine), captured in one take.
 *
 *  Demo-fixture states (prep with prep_demo.sh BEFORE running):
 *    s1-hero-bugfix   seed      (bug present, suite red)
 *    s3-checkpoints   fixed     (clean tree, suite green)
 *    s5-review        seed+fix  (one-char fix uncommitted, suite green)
 *    s2/s4/s8         any       (fixture content irrelevant)
 *    s6/s7 run in the real repo checkout (no prep).
 */
const { DEMO_DIR, REPO_ROOT, unownBin } = require("./_paths");

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
    // agent starts investigating: any tool header appears after the echoed prompt
    { t: "fn", desc: "wait for first tool block", fn: async (s) => {
      await s.wait({ include: ["The pagination test is failing"], timeout: 30_000, desc: "prompt echoed" });
      await s.wait({ include: ["read ", "grep ", "find ", "ls ", "$ ", "edit ", "write "], mode: "any", timeout: 300_000, desc: "first tool block" });
      await s.linger(1600);
      await s.still("03-agent-investigating");
    }},
    // the fix lands — tool-agnostic: poll the working tree externally
    { t: "fn", desc: "wait for the file change", fn: async (s) => {
      await s.waitForExternal({
        desc: "pagination.ts edited",
        timeout: 420_000,
        check: async () => (await s.exec(`git -C ${DEMO_DIR} diff --name-only`)).includes("pagination.ts"),
      });
      await s.linger(1600);
      await s.still("04-agent-editing");
    }},
    // agent re-runs the suite → green
    { t: "fn", desc: "wait for green suite", fn: async (s) => {
      await s.wait({ include: [" 0 fail"], timeout: 420_000, desc: "green suite" });
      await s.linger(1500);
      await s.still("05-tests-passing");
    }},
    // turn completes (spinner gone)
    { t: "wait", exclude: ["Working..."], timeout: 420_000, desc: "turn complete" },
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
      await s.wait({ include: ["Plan complete"], timeout: 240_000, desc: "plan complete" }).catch(() => {});
      await s.wait({ exclude: ["Working..."], timeout: 90_000, desc: "turn complete" }).catch(() => {});
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
      await s.wait({ exclude: ["Working..."], timeout: 420_000, desc: "turn complete" });
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
    { t: "wait", exclude: ["Working..."], timeout: 420_000, desc: "turn complete" },
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

module.exports = {
  "s1-hero-bugfix": s1,
  "s2-plan-mode": s2,
  "s3-checkpoints": s3,
  "s4-overlays": s4,
  "s5-review": s5,
  "s6-subagent-explore": s6,
  "s7-wiki": s7,
  "s8-cli-doctor": s8,
};
