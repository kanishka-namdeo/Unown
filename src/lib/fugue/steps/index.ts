/**
 * Fugue step processors — the five deterministic inference engines.
 * Each is a pure function: (payload, config, ctx) → { payload, error? }
 * No mutation of the input payload; new object on success.
 * PLAN.md §3.
 */
import type { EngineCtx } from "../engine";
import type {
  BranchStepConfig,
  ClassifyStepConfig,
  EnrichStepConfig,
  FlowStep,
  NotifyStepConfig,
  Run,
  TransformStepConfig,
} from "../types";

export interface StepResult {
  payload: unknown;
  error?: string;
}

/**
 * TRANSFORM — apply a template to the payload's designated text field.
 * Fails (honestly triggering retries) when `payload.input` or `payload.text` is missing.
 * Result is written to `payload.text`.
 */
export function runTransform(
  payload: unknown,
  step: FlowStep,
  ctx: EngineCtx,
): StepResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  const cfg = step.config as TransformStepConfig;

  // Designated text field: `input` or `text`.
  const textValue = p.input ?? p.text;
  if (textValue === undefined || textValue === null) {
    return { payload, error: "transform: payload has no text field" };
  }

  // Resolve placeholders: {{input}} → original input (p.input or p.text),
  // {{field}} → any named field value.
  let result = cfg.template;
  const originalInput = p.input !== undefined ? String(p.input) : String(p.text);
  result = result.replaceAll("{{input}}", originalInput);
  for (const [k, v] of Object.entries(p)) {
    if (k === "input" || k === "text") continue;
    if (typeof v === "string") {
      result = result.replaceAll(`{{${k}}}`, v);
    }
  }

  return { payload: { ...p, text: result } };
}

/**
 * CLASSIFY — keyword-rule classifier.
 * For each label → keywords entry, case-insensitively scan `payload.text`.
 * First matching label wins; appended to `payload.labels` (deduped).
 * No match → no label, not a failure.
 */
export function runClassify(
  payload: unknown,
  step: FlowStep,
  ctx: EngineCtx,
): StepResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  const cfg = step.config as ClassifyStepConfig;

  const text = String(p.text ?? "");
  const textLower = text.toLowerCase();
  const existingLabels: string[] = Array.isArray(p.labels) ? (p.labels as string[]) : [];

  // First matching label wins (iterates labels in insertion order).
  let matchedLabel: string | null = null;
  for (const [label, keywords] of Object.entries(cfg.rules)) {
    if (existingLabels.includes(label)) continue; // already have this label
    const matched = keywords.some((kw) => textLower.includes(kw.toLowerCase()));
    if (matched) {
      matchedLabel = label;
      break; // first match wins
    }
  }
  if (matchedLabel) {
    existingLabels.push(matchedLabel);
  }

  return { payload: { ...p, labels: existingLabels } };
}

/**
 * ENRICH — shallow-merge `config.fields` onto the payload.
 * Existing keys are preserved; new keys are added. Never fails.
 */
export function runEnrich(
  payload: unknown,
  step: FlowStep,
  ctx: EngineCtx,
): StepResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  const cfg = step.config as EnrichStepConfig;
  // Shallow merge: config.fields are added to payload; payload keys take precedence on conflict.
  return { payload: { ...cfg.fields, ...p } };
}

/**
 * BRANCH — evaluate when-clauses against the payload.
 * Never mutates the payload; the engine resolves the target.
 * Returns the payload unchanged (the engine inspects the config directly).
 */
export function runBranch(
  payload: unknown,
  step: FlowStep,
  ctx: EngineCtx,
): StepResult {
  // The branch step passes the payload through unchanged.
  // Target resolution happens in engine.resolveBranch().
  void ctx;
  void step;
  return { payload };
}

/**
 * NOTIFY — push a notification entry onto the run.
 * Never fails. The run's notifications array is the delivery target.
 */
export function runNotify(
  payload: unknown,
  step: FlowStep,
  ctx: EngineCtx,
  run: Run,
): StepResult {
  const cfg = step.config as NotifyStepConfig;
  const message = cfg.message ?? step.name;
  run.notifications.push({ stepId: step.id, message, at: ctx.now() });
  return { payload };
}

