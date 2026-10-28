/**
 * Field-addressed flow validation.
 * Shared by the API (400 field errors) and the UI editor.
 * PLAN.md §3.
 */
import type {
  BranchStepConfig,
  BranchWhen,
  ClassifyStepConfig,
  EnrichStepConfig,
  FieldError,
  Flow,
  FlowDraft,
  FlowStep,
  NotifyStepConfig,
  StepConfig,
  StepType,
  TransformStepConfig,
  ValidationResult,
} from "./types";
import { STEP_TYPES } from "./types";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a single step config against its type.
 * Returns an array of FieldError with paths relative to the step.
 */
function validateStepConfig(type: StepType, config: unknown, stepIndex: number): FieldError[] {
  const base = `steps[${stepIndex}]`;
  const errors: FieldError[] = [];

  if (!isObject(config)) {
    errors.push({ path: `${base}.config`, message: "config must be an object" });
    return errors;
  }

  switch (type) {
    case "transform": {
      const cfg = config as unknown as TransformStepConfig;
      if (typeof cfg.template !== "string" || cfg.template.length === 0) {
        errors.push({ path: `${base}.config.template`, message: "template must be a non-empty string" });
      }
      break;
    }
    case "classify": {
      const cfg = config as unknown as ClassifyStepConfig;
      if (!isObject(cfg.rules)) {
        errors.push({ path: `${base}.config.rules`, message: "rules must be an object" });
      } else {
        for (const [label, keywords] of Object.entries(cfg.rules)) {
          if (!Array.isArray(keywords)) {
            errors.push({
              path: `${base}.config.rules.${label}`,
              message: "keywords must be an array of strings",
            });
          } else {
            keywords.forEach((k, i) => {
              if (typeof k !== "string") {
                errors.push({
                  path: `${base}.config.rules.${label}[${i}]`,
                  message: "keyword must be a string",
                });
              }
            });
          }
        }
        if (Object.keys(cfg.rules).length === 0) {
          errors.push({ path: `${base}.config.rules`, message: "rules must not be empty" });
        }
      }
      break;
    }
    case "enrich": {
      const cfg = config as unknown as EnrichStepConfig;
      if (!isObject(cfg.fields)) {
        errors.push({ path: `${base}.config.fields`, message: "fields must be an object" });
      }
      break;
    }
    case "branch": {
      const cfg = config as unknown as BranchStepConfig;
      if (!Array.isArray(cfg.when)) {
        errors.push({ path: `${base}.config.when`, message: "when must be an array" });
        break;
      }
      cfg.when.forEach((clause, ci) => {
        if (!isObject(clause)) {
          errors.push({ path: `${base}.config.when[${ci}]`, message: "clause must be an object" });
          return;
        }
        const c = clause as BranchWhen;
        if (!isString(c.field) || c.field.length === 0) {
          errors.push({
            path: `${base}.config.when[${ci}].field`,
            message: "field must be a non-empty string",
          });
        }
        if (c.target !== undefined && !isString(c.target)) {
          errors.push({
            path: `${base}.config.when[${ci}].target`,
            message: "target must be a step id or 'end'",
          });
        }
      });
      break;
    }
    case "notify": {
      // No required fields; message is optional.
      break;
    }
  }
  return errors;
}

/**
 * Validate a flow draft. All step ids are checked for uniqueness
 * and branch targets for existence (or "end").
 */
export function validateFlow(
  draft: FlowDraft,
  ctx: { id: string; workspaceId: string; now: string; enabled?: boolean },
): ValidationResult {
  const errors: FieldError[] = [];

  // flow-level fields
  if (!isString(draft.name) || draft.name.trim().length === 0) {
    errors.push({ path: "name", message: "name must be a non-empty string" });
  }
  if (!isString(draft.description)) {
    errors.push({ path: "description", message: "description must be a string" });
  }

  // steps
  if (!Array.isArray(draft.steps)) {
    errors.push({ path: "steps", message: "steps must be an array" });
    return { ok: false, errors };
  }

  const stepIds = new Set<string>();
  for (let i = 0; i < draft.steps.length; i++) {
    const s = draft.steps[i];
    const base = `steps[${i}]`;

    // id
    if (s.id !== undefined) {
      if (!isString(s.id) || s.id.length === 0) {
        errors.push({ path: `${base}.id`, message: "step id must be a non-empty string" });
      } else if (stepIds.has(s.id)) {
        errors.push({ path: `${base}.id`, message: `duplicate step id '${s.id}'` });
      } else {
        stepIds.add(s.id);
      }
    } else {
      errors.push({ path: `${base}.id`, message: "step id is required" });
    }

    // type
    if (!isString(s.type) || !STEP_TYPES.includes(s.type as StepType)) {
      errors.push({ path: `${base}.type`, message: `type must be one of: ${STEP_TYPES.join(", ")}` });
    } else {
      // config
      const configErrors = validateStepConfig(s.type as StepType, (s as FlowStep).config, i);
      errors.push(...configErrors);
    }

    // name
    if (!isString((s as FlowStep).name) || (s as FlowStep).name!.trim().length === 0) {
      errors.push({ path: `${base}.name`, message: "name must be a non-empty string" });
    }

    // retry
    const retry = (s as FlowStep).retry;
    if (!retry || !Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) {
      errors.push({
        path: `${base}.retry.maxAttempts`,
        message: "retry.maxAttempts must be an integer ≥ 1",
      });
    }
  }

  // branch targets
  for (let i = 0; i < draft.steps.length; i++) {
    const s = draft.steps[i] as unknown as FlowStep;
    if (s.type !== "branch") continue;
    const cfg = s.config as BranchStepConfig;
    if (!Array.isArray(cfg?.when)) continue;
    for (let ci = 0; ci < cfg.when.length; ci++) {
      const clause = cfg.when[ci];
      if (!isObject(clause)) continue;
      const target = (clause as BranchWhen).target;
      if (target === undefined || target === "end") continue;
      if (!isString(target) || !stepIds.has(target)) {
        errors.push({
          path: `steps[${i}].config.when[${ci}].target`,
          message: `branch target '${target}' is not a valid step id or 'end'`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Build the valid Flow (fill in missing step ids with generated suffixes).
  const steps: FlowStep[] = draft.steps.map((s, i) => ({
    id: s.id ?? `st_generated_${i}`,
    type: s.type as StepType,
    name: (s as FlowStep).name ?? `step ${i + 1}`,
    config: (s as FlowStep).config,
    retry: (s as FlowStep).retry ?? { maxAttempts: 1 },
  }));

  return {
    ok: true,
    flow: {
      id: ctx.id,
      workspaceId: ctx.workspaceId,
      name: draft.name,
      description: draft.description ?? "",
      enabled: ctx.enabled ?? false,
      updatedAt: ctx.now,
      steps,
    },
  };
}
