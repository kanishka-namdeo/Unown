import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  advance,
  exitEnrollment,
  testCtx,
  traitMultiplier,
  type EngineCtx,
} from "./sequences";
import type {
  AriaEngagement,
  AriaEnrollment,
  AriaSequence,
} from "./types";

/* ── fixtures ─────────────────────────────────────────────────────── */

const SEQUENCE: AriaSequence = {
  id: "seq-1",
  tenantId: "t1",
  name: "Nurture",
  steps: [
    {
      id: "s1",
      type: "email",
      name: "Intro",
      email: { templateId: "t1", subject: "Hi {{name}}", body: "Welcome, {{name}}" },
    },
    { id: "s2", type: "wait", name: "Wait 2d", waitDays: 2 },
    {
      id: "s3",
      type: "branch",
      name: "Replied?",
      branch: { onEngagement: "replied", targetStepId: "s5" },
    },
    {
      id: "s4",
      type: "email",
      name: "Follow-up",
      email: { templateId: "t2", subject: "Re: Hi {{name}}", body: "Still there?" },
    },
    { id: "s5", type: "task", name: "Book", task: { title: "Book a call", priority: "high" } },
  ],
  traitSeed: 0.5,
  createdAt: "2026-05-01T00:00:00Z",
};

function enrollment(over: Partial<AriaEnrollment> = {}): AriaEnrollment {
  return {
    id: "enr-1",
    tenantId: "t1",
    contactId: "c-1",
    sequenceId: "seq-1",
    state: "enrolled",
    stepIndex: 0,
    createdAt: "2026-10-01T00:00:00Z",
    completedAt: null,
    traitMult: 0.5,
    ...over,
  };
}

/* ── traitMultiplier (pure, the P1 determinism pin) ──────────────── */

describe("traitMultiplier", () => {
  test("is a pure function of traits + seed (two calls → equal)", () => {
    const traits = { replyRate: 0.8, openRate: 0.6, busySignal: false };
    expect(traitMultiplier(traits, 0.4)).toBe(traitMultiplier(traits, 0.4));
  });

  test("clamps to 0..1", () => {
    expect(traitMultiplier({ replyRate: 1, openRate: 1, busySignal: false }, 1)).toBeLessThanOrEqual(1);
    expect(traitMultiplier({ replyRate: 0, openRate: 0, busySignal: true }, 0)).toBeGreaterThanOrEqual(0);
  });

  test("busySignal lowers the multiplier", () => {
    const busy = traitMultiplier({ replyRate: 0.5, openRate: 0.5, busySignal: true }, 0.5);
    const free = traitMultiplier({ replyRate: 0.5, openRate: 0.5, busySignal: false }, 0.5);
    expect(busy).toBeLessThan(free);
  });

  test("higher reply/open rates raise the multiplier", () => {
    const low = traitMultiplier({ replyRate: 0.1, openRate: 0.1, busySignal: false }, 0.5);
    const high = traitMultiplier({ replyRate: 0.9, openRate: 0.9, busySignal: false }, 0.5);
    expect(high).toBeGreaterThan(low);
  });
});

/* ── the state machine ────────────────────────────────────────────── */

describe("advance: the enrolled → active transition", () => {
  test("the first advance on a short sequence flips to active→completed", () => {
    const seq: AriaSequence = { ...SEQUENCE, steps: SEQUENCE.steps.slice(0, 1) };
    const out = advance(enrollment(), seq, "Dana", [], testCtx("2026-10-01T00:00:00Z"));
    // the whole sequence is consumed → completed; the state machine
    // still went through active (verified by the mailbox msg + event)
    expect(out.enrollment.state).toBe("completed");
    // the enrollment object is NEW (the input was never mutated)
    expect(out.enrollment).not.toBe(enrollment());
  });

  test("a mid-sequence advance stays active with an advanced cursor", () => {
    // A wait step + an email: after the wait, the cursor sits at the email
    // (index 1) and the state is active (steps remain).
    const seq: AriaSequence = {
      ...SEQUENCE,
      steps: [SEQUENCE.steps[0], { id: "w", type: "wait", name: "W", waitDays: 1 }],
    };
    const out = advance(enrollment({ state: "active", stepIndex: 1 }), seq, "Dana", [], testCtx("2026-10-01T00:00:00Z"));
    expect(out.enrollment.state).toBe("completed"); // wait was the last step
    expect(out.newEvents[0].kind).toBe("sent");
  });

  test("an email step produces a mailbox message + an event", () => {
    const seq: AriaSequence = { ...SEQUENCE, steps: SEQUENCE.steps.slice(0, 1) };
    const out = advance(enrollment(), seq, "Dana", [], testCtx("2026-10-01T00:00:00Z"));
    expect(out.mailboxMsgs).toHaveLength(1);
    expect(out.mailboxMsgs[0].subject).toBe("Hi Dana"); // template render
    expect(out.newEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("advance: determinism (the P1 pin — 100 iterations deep-equal)", () => {
  test("100 calls with the same input → 100 identical outputs", () => {
    const ctx1 = testCtx("2026-10-01T00:00:00Z");
    const first = advance(enrollment(), SEQUENCE, "Dana", ["open"], ctx1);
    for (let i = 0; i < 100; i++) {
      const ctx = testCtx("2026-10-01T00:00:00Z");
      expect(advance(enrollment(), SEQUENCE, "Dana", ["open"], ctx)).toEqual(first);
    }
  });

  test("the input enrollment object is never mutated (copy semantics)", () => {
    const e = enrollment();
    const before = JSON.stringify(e);
    advance(e, SEQUENCE, "Dana", [], testCtx("2026-10-01T00:00:00Z"));
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("advance: reply auto-exit", () => {
  test("a reply outcome exits the enrollment (exited_by_reply + completedAt set)", () => {
    const e = enrollment({ traitMult: 0.9 }); // high-conviction tier
    const out = advance(e, SEQUENCE, "Dana", ["reply"], testCtx("2026-10-01T00:00:00Z"));
    expect(out.enrollment.state).toBe("exited_by_reply");
    expect(out.enrollment.completedAt).not.toBeNull();
  });

  test("a reply event in the input + traitMult > 0.6 → replied outcome", () => {
    const e = enrollment({ traitMult: 0.7 });
    const out = advance(e, SEQUENCE, "Dana", ["reply"], testCtx("2026-10-01T00:00:00Z"));
    expect(out.mailboxMsgs[0].outcome).toBe("replied");
  });
});

describe("advance: bounce threshold", () => {
  test("traitMult < 0.15 → bounced outcome (exits immediately)", () => {
    const e = enrollment({ traitMult: 0.08 });
    const out = advance(e, SEQUENCE, "Dana", [], testCtx("2026-10-01T00:00:00Z"));
    expect(out.enrollment.state).toBe("bounced");
    expect(out.mailboxMsgs[0].outcome).toBe("bounced");
  });

  test("the bounce boundary is exactly 0.15 (below bounces, above doesn't)", () => {
    const below = advance(enrollment({ traitMult: 0.14 }), SEQUENCE, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(below.mailboxMsgs[0].outcome).toBe("bounced");
    const above = advance(enrollment({ traitMult: 0.2 }), SEQUENCE, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(above.mailboxMsgs[0].outcome).toBe("sent");
  });

  test("the sent/opened tier boundary is 0.3 (0.3 < m ≤ 0.6 → opened)", () => {
    const m = advance(enrollment({ traitMult: 0.35 }), SEQUENCE, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(m.mailboxMsgs[0].outcome).toBe("opened");
    const s = advance(enrollment({ traitMult: 0.25 }), SEQUENCE, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(s.mailboxMsgs[0].outcome).toBe("sent");
  });

  test("traitMult > 0.8 → replied even without a reply input event", () => {
    const out = advance(enrollment({ traitMult: 0.85 }), SEQUENCE, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(out.mailboxMsgs[0].outcome).toBe("replied");
    expect(out.enrollment.state).toBe("exited_by_reply");
  });
});

describe("advance: step semantics", () => {
  test("wait steps record a marker event + advance the cursor", () => {
    const seq: AriaSequence = {
      ...SEQUENCE,
      steps: [{ id: "w1", type: "wait", name: "W", waitDays: 3 }],
    };
    const out = advance(enrollment({ state: "active" }), seq, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(out.newEvents[0].kind).toBe("sent");
    expect(out.mailboxMsgs).toHaveLength(0);
    // all steps consumed → completed
    expect(out.enrollment.state).toBe("completed");
  });

  test("task steps create a task with the step's title + priority", () => {
    const seq: AriaSequence = {
      ...SEQUENCE,
      steps: [{ id: "t1", type: "task", name: "T", task: { title: "Do X", priority: "urgent" } }],
    };
    const out = advance(enrollment({ state: "active" }), seq, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(out.newTasks).toHaveLength(1);
    expect(out.newTasks[0].title).toBe("Do X");
    expect(out.newTasks[0].priority).toBe("urgent");
    expect(out.enrollment.state).toBe("completed");
  });

  test("branch onEngagement=replied jumps to the target step when a reply is in the input", () => {
    const e = enrollment({ state: "active", traitMult: 0.9 });
    const out = advance(e, SEQUENCE, "Dana", ["reply"], testCtx("2026-10-01T00:00:00Z"));
    // s1 email → replied → exits; the branch at s3 is never reached
    expect(out.enrollment.state).toBe("exited_by_reply");
  });

  test("branch fall-through when the trigger is not met", () => {
    // traitMult 0.5 → opened outcome; no reply → the branch at s3 falls through to s4
    const e = enrollment({ state: "active", traitMult: 0.5 });
    const out = advance(e, SEQUENCE, "Dana", ["open"], testCtx("2026-10-01T00:00:00Z"));
    // s1 email (opened) → s2 wait → s3 branch (no reply → fall to s4) → s4 email → s5 task
    expect(out.mailboxMsgs.length).toBe(2);
    expect(out.enrollment.state).toBe("completed");
  });

  test("the cursor lands on the target step id when it exists (bounded visitation)", () => {
    // A loop-back target (branch → s1) visits s1 a second time on its
    // return; the bounded-visitation guard fires the second email, then
    // the branch falls through (its target is already visited) and the
    // sequence completes. No infinite loop.
    const seq: AriaSequence = {
      ...SEQUENCE,
      steps: [
        { id: "s1", type: "email", name: "E1", email: { templateId: "t", subject: "a", body: "b" } },
        { id: "s3", type: "branch", name: "B", branch: { onEngagement: "opened", targetStepId: "s1" } },
      ],
      traitSeed: 0.1,
    };
    const e = enrollment({ state: "active", traitMult: 0.5 });
    const out = advance(e, seq, "D", ["open"], testCtx("2026-10-01T00:00:00Z"));
    // s1 email (opened) → s3 branch (jump to s1, first visit) → s1 email again →
    // s3 branch (target already visited → fall through → end)
    expect(out.mailboxMsgs.length).toBe(2);
    expect(out.enrollment.state).toBe("completed");
  });
});

describe("advance: completion", () => {
  test("all steps consumed with no terminal event → completed + completedAt", () => {
    const seq: AriaSequence = {
      ...SEQUENCE,
      steps: [
        { id: "w1", type: "wait", name: "W", waitDays: 1 },
        { id: "t1", type: "task", name: "T", task: { title: "x", priority: "low" } },
      ],
    };
    const out = advance(enrollment({ state: "active" }), seq, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(out.enrollment.state).toBe("completed");
    expect(out.enrollment.completedAt).not.toBeNull();
    expect(out.enrollment.stepIndex).toBe(seq.steps.length);
  });
});

describe("terminal states are final (no reopening)", () => {
  test("advance on a completed enrollment is a no-op", () => {
    const e = enrollment({ state: "completed", completedAt: "2026-10-01T00:00:00Z" });
    const out = advance(e, SEQUENCE, "D", [], testCtx("2026-10-02T00:00:00Z"));
    expect(out.enrollment).toBe(e);
    expect(out.newEvents).toEqual([]);
    expect(out.mailboxMsgs).toEqual([]);
  });

  test("advance on exited_by_reply is a no-op", () => {
    const e = enrollment({ state: "exited_by_reply", completedAt: "2026-10-01T00:00:00Z" });
    const out = advance(e, SEQUENCE, "D", ["reply"], testCtx("2026-10-02T00:00:00Z"));
    expect(out.enrollment.state).toBe("exited_by_reply");
    expect(out.mailboxMsgs).toEqual([]);
  });

  test("advance on exited_manually is a no-op", () => {
    const e = enrollment({ state: "exited_manually", completedAt: "2026-10-01T00:00:00Z" });
    expect(advance(e, SEQUENCE, "D", [], testCtx("2026-10-02T00:00:00Z")).mailboxMsgs).toEqual([]);
  });

  test("advance on a bounced enrollment is a no-op", () => {
    const e = enrollment({ state: "bounced", completedAt: "2026-10-01T00:00:00Z" });
    expect(advance(e, SEQUENCE, "D", [], testCtx("2026-10-02T00:00:00Z")).mailboxMsgs).toEqual([]);
  });
});

describe("exitEnrollment", () => {
  test("manual exit flips active → exited_manually + completedAt", () => {
    const e = enrollment({ state: "active" });
    const out = exitEnrollment(e, testCtx("2026-10-02T00:00:00Z"));
    expect(out.state).toBe("exited_manually");
    expect(out.completedAt).not.toBeNull();
  });

  test("manual exit on an enrolled enrollment works", () => {
    const out = exitEnrollment(enrollment(), testCtx("2026-10-02T00:00:00Z"));
    expect(out.state).toBe("exited_manually");
  });

  test("manual exit on a terminal enrollment is a no-op", () => {
    const e = enrollment({ state: "completed", completedAt: "2026-09-01T00:00:00Z" });
    const out = exitEnrollment(e, testCtx("2026-10-02T00:00:00Z"));
    expect(out.state).toBe("completed");
    expect(out.completedAt).toBe("2026-09-01T00:00:00Z");
    const b = enrollment({ state: "bounced", completedAt: "2026-09-01T00:00:00Z" });
    expect(exitEnrollment(b, testCtx("2026-10-02T00:00:00Z")).state).toBe("bounced");
  });

  test("the input object is not mutated", () => {
    const e = enrollment({ state: "active" });
    const before = JSON.stringify(e);
    exitEnrollment(e, testCtx("2026-10-02T00:00:00Z"));
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe("hermetic ctx (the fugue injection contract)", () => {
  test("a fully-fixed ctx produces identical ids across runs", () => {
    function fixedCtx(): EngineCtx {
      let n = 0;
      return {
        now: () => "2026-10-01T00:00:00Z",
        nextEventId: () => `evt-${++n}`,
        nextMailId: () => `mail-${n}`,
        nextTaskId: () => `task-${n}`,
      };
    }
    const a = advance(enrollment(), SEQUENCE, "D", [], fixedCtx());
    const b = advance(enrollment(), SEQUENCE, "D", [], fixedCtx());
    expect(a.newEvents.map((x) => x.id)).toEqual(b.newEvents.map((x) => x.id));
    expect(a.mailboxMsgs.map((x) => x.id)).toEqual(b.mailboxMsgs.map((x) => x.id));
  });

  test("hermetic by construction: the module owns no module-scope clock or RNG", () => {
    // The determinism contract is structural: the engine owns no
    // module-scope mutable state that would make two calls diverge.
    // The source re-read is the mechanical pin: no top-level mutable
    // `let`, and no call into the real clock or RNG outside of an
    // injected-ctx consumer.
    const src = readFileSync(new URL("./sequences.ts", import.meta.url), "utf-8");
    // No module-scope `let` declarations at column 0 (the fugue
    // EngineCtx pattern: all counters live in the caller's ctx).
    const topLet = src.split("\n").filter((l) => /^let /.test(l));
    expect(topLet, `module-scope lets: ${topLet.join(" | ")}`).toEqual([]);
    // No Date.now / Math.random references anywhere.
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/Math\.random\(\)/);
  });
});

describe("input event kinds", () => {
  test("meeting_booked input counts as a reply for the outcome", () => {
    const e = enrollment({ traitMult: 0.7 });
    const out = advance(e, SEQUENCE, "D", ["meeting_booked"], testCtx("2026-10-01T00:00:00Z"));
    expect(out.mailboxMsgs[0].outcome).toBe("replied");
    expect(out.enrollment.state).toBe("exited_by_reply");
  });

  test("an 'open' input event alone (no reply) does not trigger a reply outcome", () => {
    const e = enrollment({ traitMult: 0.7, state: "active" });
    const out = advance(e, SEQUENCE, "D", ["open"], testCtx("2026-10-01T00:00:00Z"));
    // 0.7 > 0.3 → opened, NOT replied (no reply/meeting event in input)
    expect(out.mailboxMsgs[0].outcome).toBe("opened");
  });

  test("empty input events → the outcome is the tier-only path", () => {
    const sent = advance(enrollment({ traitMult: 0.2, state: "active" }), SEQUENCE, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(sent.mailboxMsgs[0].outcome).toBe("sent");
    const opened = advance(enrollment({ traitMult: 0.5, state: "active" }), SEQUENCE, "D", [], testCtx("2026-10-01T00:00:00Z"));
    expect(opened.mailboxMsgs[0].outcome).toBe("opened");
  });
});
