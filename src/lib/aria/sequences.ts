/**
 * The deterministic cadence engine (plan §4 — the fugue EngineCtx
 * pattern).
 *
 * `advance(enrollment, sequence, events, ctx)` is a PURE function:
 * zero I/O — the clock and id generators are injected via `ctx` and
 * the engagement simulation is a pure function of the enrollment's
 * `traitMult` (itself a pure function of `contact.traits` +
 * `sequence.traitSeed` via `traitMultiplier`). No module-scope
 * mutable state, no wall-clock reads. Two calls with the same
 * inputs → the same outputs (the "two seeds deep-equal" pin).
 *
 * States & transitions:
 *   enrolled → active → completed
 *                    → exited_by_reply
 *                    → exited_manually
 *                    → bounced
 * Terminal states are final — the engine never reopens them (the
 * invariant test pins this).
 */

import type {
  AriaEngagement,
  AriaEnrollment,
  AriaEngagementEvent,
  AriaMailboxMessage,
  AriaSequence,
  AriaTask,
  SeqStep,
} from "./types";

/* ── the trait multiplier (pure) ─────────────────────────────────── */

/**
 * The per-contact trait multiplier (0..1): the contact's reply +
 * open behavior blended with the sequence's trait seed. No
 * per-call randomness — the P1 determinism pin.
 */
export function traitMultiplier(
  traits: { replyRate: number; openRate: number; busySignal: boolean },
  traitSeed: number,
): number {
  const blend = 0.5 * traits.replyRate + 0.3 * traits.openRate + (traits.busySignal ? -0.1 : 0.05);
  const m = 0.7 * blend + 0.3 * traitSeed;
  return Math.max(0, Math.min(1, m));
}

/* ── the engine context (the fugue injection point) ──────────────── */

export interface EngineCtx {
  /** Current ISO timestamp. Tests inject a fixed clock. */
  now(): string;
  /** Generate the next engagement-event id (deterministic counter). */
  nextEventId(): string;
  /** Generate the next mailbox-message id. */
  nextMailId(): string;
  /** Generate the next task id (task steps). */
  nextTaskId(): string;
}

/** A fixed-clock test ctx. */
export function testCtx(startIso: string): EngineCtx {
  let t = new Date(startIso).getTime();
  let eventId = 0;
  let mailId = 0;
  let taskId = 0;
  return {
    now: () => new Date((t += 1000)).toISOString().replace(".000Z", "Z"),
    nextEventId: () => `evt-aria-${String((eventId += 1)).padStart(6, "0")}`,
    nextMailId: () => `mb-aria-${String((mailId += 1)).padStart(6, "0")}`,
    nextTaskId: () => `tsk-aria-${String((taskId += 1)).padStart(6, "0")}`,
  };
}

/* ── outcome simulation (pure over traitMult) ────────────────────── */

export type SimOutcome = "sent" | "opened" | "replied" | "bounced";

/**
 * The deterministic engagement outcome for an email step (plan §4
 * step semantics):
 *   traitMult < 0.15          → "bounced"
 *   traitMult > 0.8 AND the  → "replied"  (input events carry a reply)
 *   input events carry a reply AND traitMult > 0.6
 *   traitMult > 0.3          → "opened"
 *   otherwise                 → "sent"
 */
export function simulateOutcome(
  traitMult: number,
  inputEvents: AriaEngagement[],
): SimOutcome {
  if (traitMult < 0.15) return "bounced";
  const hasReply = inputEvents.includes("reply") || inputEvents.includes("meeting_booked");
  if (hasReply && traitMult > 0.6) return "replied";
  if (traitMult > 0.8) return "replied"; // high-conviction contacts always engage
  if (traitMult > 0.3) return "opened";
  return "sent";
}

/* ── the advance output ───────────────────────────────────────────── */

export interface AdvanceOutput {
  /** The updated enrollment (a NEW object — the input is untouched). */
  enrollment: AriaEnrollment;
  /** The events generated this advance. */
  newEvents: AriaEngagementEvent[];
  /** The outbound emails generated this advance. */
  mailboxMsgs: AriaMailboxMessage[];
  /** Tasks created by task steps. */
  newTasks: AriaTask[];
}

/** The step's template variable substitution (pure string replace). */
function render(
  step: SeqStep,
  contactName: string,
  vars?: Record<string, string>,
): { subject: string; body: string } {
  const fill = (s: string, v: Record<string, string>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k === "name" ? contactName : v[k] ?? ""));
  const e = step.email!;
  return { subject: fill(e.subject, e.variables ?? {}), body: fill(e.body, e.variables ?? {}) };
}

/**
 * The engine. Advances the enrollment over the sequence's steps
 * given the input events. Pure: no I/O, no wall-clock reads, no RNG.
 */
export function advance(
  enrollment: AriaEnrollment,
  sequence: AriaSequence,
  contactName: string,
  inputEvents: AriaEngagement[],
  ctx: EngineCtx,
): AdvanceOutput {
  const newEvents: AriaEngagementEvent[] = [];
  const mailboxMsgs: AriaMailboxMessage[] = [];
  const newTasks: AriaTask[] = [];

  // Terminal states are final — the engine never reopens them.
  if (
    enrollment.state === "completed" ||
    enrollment.state === "exited_by_reply" ||
    enrollment.state === "exited_manually" ||
    enrollment.state === "bounced"
  ) {
    return { enrollment, newEvents, mailboxMsgs, newTasks };
  }

  let state: AriaEnrollment["state"] =
    enrollment.state === "enrolled" ? "active" : enrollment.state;
  let stepIndex = enrollment.stepIndex;
  const steps = sequence.steps;
  const at = ctx.now();

  // Track the last engagement state for branch resolution.
  let lastEngagement: AriaEngagement =
    inputEvents.length > 0 ? inputEvents[inputEvents.length - 1] : "sent";

  // Bounded-visit map (shared across all branch steps in this advance).
  const visited = new Map<string, number>();

  while (stepIndex < steps.length) {
    const step = steps[stepIndex];

    if (step.type === "email") {
      const outcome = simulateOutcome(enrollment.traitMult, inputEvents);
      const { subject, body } = render(step, contactName);
      mailboxMsgs.push({
        id: ctx.nextMailId(),
        tenantId: enrollment.tenantId,
        enrollmentId: enrollment.id,
        contactId: enrollment.contactId,
        subject,
        body,
        at,
        outcome,
      });
      // The simulated outcome is a deterministic event row.
      const kind: AriaEngagement =
        outcome === "opened" ? "open" : outcome === "replied" ? "reply" : outcome === "sent" ? "sent" : "sent";
      newEvents.push({
        id: ctx.nextEventId(),
        tenantId: enrollment.tenantId,
        enrollmentId: enrollment.id,
        kind,
        at,
      });
      lastEngagement = kind === "sent" ? lastEngagement : kind;
      if (outcome === "replied") {
        state = "exited_by_reply";
        break;
      }
      if (outcome === "bounced") {
        state = "bounced";
        break;
      }
      stepIndex += 1;
    } else if (step.type === "wait") {
      // The wait is simulated (no real timer): record a "sent"-kind
      // marker event, advance the cursor.
      newEvents.push({
        id: ctx.nextEventId(),
        tenantId: enrollment.tenantId,
        enrollmentId: enrollment.id,
        kind: "sent",
        at: at,
      });
      stepIndex += 1;
    } else if (step.type === "task") {
      newTasks.push({
        id: ctx.nextTaskId(),
        tenantId: enrollment.tenantId,
        title: step.task!.title,
        ownerId: "", // the API layer fills the enrollment's owner
        entityType: "contact",
        entityId: enrollment.contactId,
        due: at,
        priority: step.task!.priority,
        done: false,
        doneAt: null,
        createdAt: at,
      });
      stepIndex += 1;
    } else {
      // branch: check the current engagement state against the step's
      // onEngagement trigger.
      const b = step.branch!;
      let jumped = false;
      // A branch may visit the SAME target at most once per advance
      // (bounded visitation — a loop-back target that keeps firing
      // terminates on its second visit, no infinite cadence). The
      // `visited` map is shared across all branch steps in this
      // advance so a loop through different branch steps cannot
      // outlive the guard either.
      if (b.onEngagement === "replied" && (lastEngagement === "reply" || lastEngagement === "meeting_booked")) {
        const target = b.targetStepId ? steps.findIndex((s) => s.id === b.targetStepId) : -1;
        if (target !== -1) {
          const visits = (visited.get(b.targetStepId!) ?? 0) + 1;
          visited.set(b.targetStepId!, visits);
          if (visits <= 1) {
            stepIndex = target;
            jumped = true;
          }
        }
      } else if (b.onEngagement === "opened" && lastEngagement === "open") {
        const target = b.targetStepId ? steps.findIndex((s) => s.id === b.targetStepId) : -1;
        if (target !== -1) {
          const visits = (visited.get(b.targetStepId!) ?? 0) + 1;
          visited.set(b.targetStepId!, visits);
          if (visits <= 1) {
            stepIndex = target;
            jumped = true;
          }
        }
      }
      if (!jumped) stepIndex += 1;
    }

    // Guard against a forward jump that lands past the end.
    if (stepIndex < 0) stepIndex = steps.length;
  }

  const isTerminal =
    state === "exited_by_reply" || state === "bounced" || (state === "active" && stepIndex >= steps.length);
  if (state === "active" && stepIndex >= steps.length) state = "completed";

  const updated: AriaEnrollment = {
    ...enrollment,
    state,
    stepIndex: isTerminal ? steps.length : stepIndex,
    completedAt: isTerminal ? at : enrollment.completedAt,
  };

  return { enrollment: updated, newEvents, mailboxMsgs, newTasks };
}

/**
 * The manual exit (the `enrollment.exit` route). Terminal — the
 * enrollment can never advance again.
 */
export function exitEnrollment(enrollment: AriaEnrollment, ctx: EngineCtx): AriaEnrollment {
  if (
    enrollment.state === "completed" ||
    enrollment.state === "exited_by_reply" ||
    enrollment.state === "exited_manually" ||
    enrollment.state === "bounced"
  ) {
    return enrollment; // terminals are final
  }
  return {
    ...enrollment,
    state: "exited_manually",
    completedAt: ctx.now(),
  };
}
