/**
 * settings/health.ts — doctor-lite checks for the hub's Health view and the
 * Recommended list (Phase 7/8 of the Settings Evolution round).
 *
 * Every check is cheap, read-only, and carries a FIX deep-link into a
 * registry item where one exists — the "health checks + recommended
 * settings" surfaces the TUI spec requires (docs/settings_ia_redesign.md §3).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNOWN_AGENT_DIR } from "../term.ts";
import { loadHubPrefs } from "./prefs.ts";
import type { HealthCheck } from "./types.ts";

function envActive(name: string, unsetMeans: "on" | "off"): boolean {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return unsetMeans === "on";
	return !(raw === "0" || raw === "false" || raw === "off");
}

function envNumber(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

/** Run all checks. Order: failures first, then warnings, then info/ok. */
export async function runHealthChecks(cwd: string): Promise<HealthCheck[]> {
	const checks: HealthCheck[] = [];
	const prefs = loadHubPrefs();

	// --- provider / model ------------------------------------------------
	let modelsConfigured = false;
	try {
		const models = JSON.parse(readFileSync(join(UNOWN_AGENT_DIR, "models.json"), "utf8")) as {
			providers?: unknown[];
		};
		modelsConfigured = Array.isArray(models.providers) && models.providers.length > 0;
	} catch {
		/* missing models.json */
	}
	checks.push(
		modelsConfigured
			? { id: "health.provider", status: "ok", label: "Provider configured", detail: "models.json registers at least one provider" }
			: {
					id: "health.provider",
					status: "fail",
					label: "No provider configured",
					detail: "Run unown setup (or /providers) — the agent cannot reach a model",
					fixItemId: "models.providers",
				},
	);

	// --- model spec verification ------------------------------------------
	const specPath = join(UNOWN_AGENT_DIR, "model-specs.json");
	let specCount = 0;
	try {
		if (existsSync(specPath)) {
			specCount = Object.keys(JSON.parse(readFileSync(specPath, "utf8"))).length;
		}
	} catch {
		/* unreadable */
	}
	if (!envActive("UNOWN_ALLOW_UNVERIFIED_SPECS", "off")) {
		checks.push({
			id: "health.spec",
			status: specCount > 0 ? "ok" : "warn",
			label: specCount > 0 ? `Model specs verified (${specCount})` : "Model specs unverified",
			detail:
				specCount > 0
					? "context windows / max tokens have a verifiable provenance record"
					: "the session runs on the conservative floor until verified — run unown models verify",
			fixItemId: "models.spec-status",
		});
	}

	// --- permission posture ------------------------------------------------
	checks.push({
		id: "health.permissions",
		status: envActive("UNOWN_PERMISSIONS", "on") ? "ok" : "warn",
		label: envActive("UNOWN_PERMISSIONS", "on") ? "Permissions layer on" : "Permissions layer DISABLED",
		detail: envActive("UNOWN_PERMISSIONS", "on")
			? "granular allow/deny/ask rules are active (deny-list + write jail always are)"
			: "UNOWN_PERMISSIONS=0 dropped rule-based gating — re-enable it",
		fixItemId: "safety.permissions-layer",
	});
	checks.push({
		id: "health.trust-bypass",
		status: envActive("UNOWN_TRUST_PROJECT_CONFIG", "off") ? "fail" : "ok",
		label: envActive("UNOWN_TRUST_PROJECT_CONFIG", "off")
			? "Project-config trust BYPASSED"
			: "Project-config trust gate active",
		detail: envActive("UNOWN_TRUST_PROJECT_CONFIG", "off")
			? "UNOWN_TRUST_PROJECT_CONFIG=1 lets cloned-repo configs (mcp/hooks/lsp) activate unreviewed — CI only"
			: "untrusted .unown/ configs are withheld until /x trust approves them",
		fixItemId: "safety.trust-bypass",
	});

	// --- defense stack -----------------------------------------------------
	const defense: Array<[id: string, env: string, label: string, unset: "on" | "off"]> = [
		["health.shield", "UNOWN_INJECTION_SHIELD", "Injection shield", "on"],
		["health.scanner", "UNOWN_INJECTION_SCANNER", "Injection scanner", "on"],
		["health.adversary", "UNOWN_ADVERSARY", "Adversary review", "on"],
		["health.dream-gate", "PI_DREAM_GATE", "Dream canary gate", "on"],
	];
	for (const [id, env, label, unset] of defense) {
		const active = envActive(env, unset);
		checks.push({
			id,
			status: active ? "ok" : "warn",
			label: active ? `${label} on` : `${label} DISABLED`,
			detail: active ? "defense layer armed" : `${env}=0 disarms a memory-poisoning / regression defense`,
			fixItemId:
				env === "PI_DREAM_GATE" ? "learning.dream-gate" : env === "UNOWN_INJECTION_SHIELD" ? "safety.shield" : undefined,
		});
	}
	checks.push({
		id: "health.strict-hooks",
		status: envActive("UNOWN_STRICT_HOOKS", "on") ? "ok" : "warn",
		label: envActive("UNOWN_STRICT_HOOKS", "on") ? "Strict hooks on" : "Strict hooks off",
		detail: envActive("UNOWN_STRICT_HOOKS", "on")
			? "hooked commands are denied network / git push / sudo"
			: "hooked commands may reach the network and push git",
		fixItemId: "safety.strict-hooks",
	});

	// --- budgets ------------------------------------------------------------
	const govTokDay = envNumber("PI_ENGINE_MAX_TOKENS_DAY");
	checks.push({
		id: "health.governor",
		status: govTokDay === 0 ? "warn" : "ok",
		label: govTokDay === 0 ? "Governor UNLIMITED" : "Governor ceilings set",
		detail:
			govTokDay === 0
				? "PI_ENGINE_MAX_TOKENS_DAY=0 — unattended learning jobs have no spend ceiling"
				: "engine learning jobs are bounded per hour/day",
		fixItemId: "models.governor",
	});
	if (prefs.goalBudgetTurns === 0) {
		checks.push({
			id: "health.goal-budget",
			status: "info",
			label: "Goal budget off",
			detail: "an impossible or looping goal burns tokens with no ceiling in interactive sessions — consider a turn budget",
			fixItemId: "agent.goal-budget",
		});
	}
	if (envNumber("UNOWN_SUBAGENT_MAX_TURNS") === undefined) {
		checks.push({
			id: "health.subagent-cap",
			status: "warn",
			label: "Subagent turn cap unset",
			detail: "UNOWN_SUBAGENT_MAX_TURNS is off (the runaway-fan-out guard) — set a cap (e.g. 40) in .env",
			fixItemId: "tools.subagent-turns",
		});
	}
	if (envNumber("UNOWN_RETENTION_DAYS") === 0) {
		checks.push({
			id: "health.retention",
			status: "warn",
			label: "Retention pruning off",
			detail: "UNOWN_RETENTION_DAYS=0 — run/notes/hook-log history grows unbounded",
			fixItemId: "adv.retention",
		});
	}

	// --- project surface -----------------------------------------------------
	const projectConfig = existsSync(join(cwd, ".unown"));
	checks.push({
		id: "health.project",
		status: "info",
		label: projectConfig ? "Project .unown/ present" : "No project .unown/ state",
		detail: projectConfig
			? "memory / skills / receipts / config live under .unown/ — review the trust manifest"
			: "no per-project agent surface yet (it appears as sessions run, or via unown init)",
		fixItemId: projectConfig ? "safety.trust-manifest" : undefined,
	});

	const rank: Record<string, number> = { fail: 0, warn: 1, info: 2, ok: 3 };
	return checks.sort((a, b) => rank[a.status] - rank[b.status]);
}

/** The Recommended list: warn/fail checks with a fix, plus proven winners. */
export async function recommendedItems(cwd: string): Promise<HealthCheck[]> {
	const all = await runHealthChecks(cwd);
	return all.filter((c) => (c.status === "warn" || c.status === "fail") && c.fixItemId);
}
