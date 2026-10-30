/**
 * settings/registry.ts — the settings catalog: every configurable capability
 * as a registry item, organized by user intent (docs/settings_ia_redesign.md).
 *
 * Grounding rules:
 *   - Getters/setters ride the OWNING surface (addons.json, pi settings.json
 *     via SettingsManager, hub prefs, env display). The hub is a lens, not a
 *     second source of truth.
 *   - Env-only knobs are catalogued READ-ONLY (visible + searchable + risk-
 *     badged — already better than the status quo) unless a safe write path
 *     exists; their `env` field links them to .env documentation.
 *   - Every item states where it persists and how to revert (help text).
 *   - Actions launch the owning flow; "launch" actions pre-fill the editor
 *     with the command (keyboard-first, ctx.ui.setEditorText).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadAddonsConfig, saveAddonsConfig } from "../addons/config.ts";
import { resolveUnownHome } from "../unown-home.ts";
import { loadHubPrefs, saveHubPrefs } from "./prefs.ts";
import {
        SETTINGS_SECTIONS,
        type SettingsItem,
        type SettingsSectionId,
        type SettingsValue,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Env display helper — "set" vs "default (unset)" honesty
// ---------------------------------------------------------------------------

function envState(name: string, whenUnset: string): string {
        const raw = process.env[name];
        if (raw === undefined) return `default (${whenUnset})`;
        if (raw === "") return `set (empty) — same as unset`;
        return raw;
}

function envBool(name: string, whenUnset: string): string {
        const raw = process.env[name];
        if (raw === undefined || raw === "") return `default (${whenUnset})`;
        return raw === "0" || raw === "false" || raw === "off" ? `${raw} — DISABLED` : `${raw} — ACTIVE`;
}

// ---------------------------------------------------------------------------
// Lazy pi SettingsManager (read-merge-write under lock is manager-owned, so
// a hub-side instance can never clobber the interactive mode's writes and
// vice versa — persistScopedSettings merges only modified fields).
// ---------------------------------------------------------------------------

let piManager: SettingsManager | null = null;
function pi(): SettingsManager {
        if (!piManager) piManager = SettingsManager.create(process.cwd(), join(resolveUnownHome(), "agent"));
        return piManager;
}

/** Reset the cached manager (tests + after import/reset flows). */
export function resetPiManagerCache(): void {
        piManager = null;
}

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function toggle(
        base: Omit<SettingsItem, "kind"> & { get: () => SettingsValue; set: (v: SettingsValue) => void },
): SettingsItem {
        return { ...base, kind: "toggle" };
}

function readonly(base: Omit<SettingsItem, "kind" | "set">): SettingsItem {
        return { ...base, kind: "readonly" };
}

function action(base: Omit<SettingsItem, "kind" | "get" | "set">): SettingsItem {
        return { ...base, kind: "action" };
}

// ---------------------------------------------------------------------------
// AGENT — what this agent is, and how a session behaves
// ---------------------------------------------------------------------------

const agentItems: SettingsItem[] = [
        action({
                id: "agent.capabilities",
                section: "agent",
                name: "Capability map",
                risk: "low",
                summary: "Everything Unown can do — the five mechanisms + the tool set",
                help: "Opens the capability map: tiered memory, self-improving harness, AutoDreaming + skill acquisition, routing and hooks, plus the session tool set. The answer to \"what can Unown do?\".",
                actionLabel: "opens the capability map card",
        }),
        readonly({
                id: "agent.permission-mode",
                section: "agent",
                name: "Session permission mode",
                risk: "med",
                summary: "The effective permission envelope for THIS session",
                help: "Shows the session's permission mode (default / acceptEdits / plan / bypassPermissions). Session-scoped: it does not persist. Change it with /permissions mode <m>; the launch flag --permission-mode pins it. bypassPermissions is refused under strict hooks.",
                related: ["/permissions", "docs/permissions.md"],
                env: "UNOWN_PERMISSIONS_MODE (flag)",
                get: () => process.env.UNOWN_PERMISSION_MODE ?? "default (session-scoped — /permissions mode to change)",
        }),
        readonly({
                id: "agent.goal-status",
                section: "agent",
                name: "Active goal",
                risk: "low",
                summary: "The evidence-verified objective riding every turn",
                help: "Goals persist as session entries and survive /new, /resume and /fork. Completion requires the [GOAL:COMPLETE] tag plus real evidence (changed files AND command output). Use /goal <text>, /goal pause, /goal clear.",
                related: ["/goal"],
                get: () => "check /goal status (session state)",
        }),
        {
                id: "agent.goal-budget",
                section: "agent",
                name: "Goal budget (turns)",
                kind: "number",
                risk: "low",
                summary: "Auto-pause a goal after N turns (0 = off) — the runaway-grind guard",
                help: "Impossible or looping goals burn tokens with no ceiling in interactive sessions (--max-turns only guards headless runs). When a goal exceeds the budget it is auto-paused with a notice; /goal resume continues it. Default 0 (off).",
                persistedIn: "~/.unown/agent/settings-hub.json",
                related: ["/goal"],
                tags: ["goal", "budget", "turns", "loop", "guard"],
                integer: true,
                min: 0,
                max: 10000,
                default: 0,
                get: () => loadHubPrefs().goalBudgetTurns,
                set: (v) => {
                        const prefs = loadHubPrefs();
                        prefs.goalBudgetTurns = Math.min(Math.max(Math.trunc(Number(v) || 0), 0), 10000);
                        saveHubPrefs(prefs);
                },
        },
        toggle({
                id: "agent.autocompact",
                section: "agent",
                name: "Auto-compact context",
                risk: "med",
                summary: "Compact automatically when context fills (pi layer)",
                help: "The pi-layer compactor. Unown's terminal layer adds its own thresholds (UNOWN_AUTO_COMPACT_THRESHOLD / HARD_LIMIT — see Advanced). Turning this off risks context-overflow errors on long sessions.",
                persistedIn: "~/.unown/agent/settings.json",
                related: ["/compact", "/context"],
                tags: ["compaction", "context"],
                default: true,
                get: () => pi().getCompactionEnabled(),
                set: (v) => pi().setCompactionEnabled(Boolean(v)),
        }),
        toggle({
                id: "agent.quiet-startup",
                section: "agent",
                name: "Quiet startup",
                risk: "low",
                summary: "Skip the startup splash and notices",
                help: "Also disables the unown splash animation. Pure preference; /reload applies it.",
                persistedIn: "~/.unown/agent/settings.json",
                env: "UNOWN_NO_SPLASH (the splash-specific twin)",
                reloadNote: "/reload applies it",
                default: false,
                get: () => pi().getQuietStartup(),
                set: (v) => pi().setQuietStartup(Boolean(v)),
        }),
        toggle({
                id: "agent.addon-ask",
                section: "agent",
                name: "ask_user_question addon",
                risk: "low",
                summary: "Structured mid-run questionnaires",
                help: "The questionnaire addon. Disabling removes the tool from the session. Changes need /reload to rebind.",
                persistedIn: "~/.unown/agent/addons.json",
                related: ["/addons"],
                reloadNote: "/reload applies it",
                default: true,
                get: () => loadAddonsConfig().askUserQuestion.enabled,
                set: (v) => {
                        const c = loadAddonsConfig();
                        c.askUserQuestion.enabled = Boolean(v);
                        saveAddonsConfig(c);
                },
        }),
        toggle({
                id: "agent.addon-todo",
                section: "agent",
                name: "todo addon",
                risk: "low",
                summary: "Live task-graph panel above the editor",
                help: "The todo overlay. maxWidgetLines caps its height; the panel re-reads that on every render.",
                persistedIn: "~/.unown/agent/addons.json",
                related: ["/addons", "/todos"],
                reloadNote: "/reload applies it",
                default: true,
                get: () => loadAddonsConfig().todo.enabled,
                set: (v) => {
                        const c = loadAddonsConfig();
                        c.todo.enabled = Boolean(v);
                        saveAddonsConfig(c);
                },
        }),
        {
                id: "agent.addon-todo-lines",
                section: "agent",
                name: "Todo widget lines",
                kind: "number",
                risk: "low",
                summary: "Max content rows the todo panel may use (3-64)",
                help: "Hot-reloadable: the panel re-reads it on every render, no /reload needed.",
                persistedIn: "~/.unown/agent/addons.json",
                related: ["/addons"],
                tags: ["todo", "panel", "height"],
                integer: true,
                min: 3,
                max: 64,
                default: 12,
                get: () => loadAddonsConfig().todo.maxWidgetLines,
                set: (v) => {
                        const c = loadAddonsConfig();
                        c.todo.maxWidgetLines = Math.min(Math.max(Math.trunc(Number(v) || 12), 3), 64);
                        saveAddonsConfig(c);
                },
        },
        toggle({
                id: "agent.addon-advisor",
                section: "agent",
                name: "advisor addon (second model)",
                risk: "med",
                summary: "A second model watches the session and sends mid-run advice",
                help: "Ships OFF by default: a second model doubles token traffic per turn. Flat-rate deployments are the topology where it is cheap. Configure cadence/model via /addons.",
                persistedIn: "~/.unown/agent/addons.json",
                related: ["/addons", "/advisor"],
                reloadNote: "/reload applies it",
                default: false,
                get: () => loadAddonsConfig().advisor.enabled,
                set: (v) => {
                        const c = loadAddonsConfig();
                        c.advisor.enabled = Boolean(v);
                        saveAddonsConfig(c);
                },
        }),
        readonly({
                id: "agent.worktree-isolation",
                section: "agent",
                name: "Worktree isolation",
                risk: "low",
                summary: "Run sessions inside a managed git worktree (-w / --worktree)",
                help: "A session started with --worktree runs at the repo HEAD in its own worktree; an untouched tree is removed on exit, a changed one is kept for review (unown worktrees list|remove).",
                related: ["--worktree", "unown worktrees"],
                env: "UNOWN_WORKTREE_ISOLATION",
                get: () => envBool("UNOWN_WORKTREE_ISOLATION", "per-session flag"),
        }),
        readonly({
                id: "agent.auto-verify",
                section: "agent",
                name: "Auto-verify after edits",
                risk: "med",
                summary: "Run the project's check command after edits (aider-style loop)",
                help: "PostToolUse quality gate: detects the project's check command and runs it after edits, with a cooldown. Costs tokens; catches regressions early.",
                env: "UNOWN_AUTO_VERIFY",
                get: () => envBool("UNOWN_AUTO_VERIFY", "on"),
        }),
        readonly({
                id: "agent.auto-test",
                section: "agent",
                name: "Auto-test after edits",
                risk: "med",
                summary: "Also run the project's tests after edits",
                help: "Heavier than auto-verify; default off. Bound by UNOWN_AUTO_TEST_TIMEOUT_MS (5 min).",
                env: "UNOWN_AUTO_TEST",
                get: () => envBool("UNOWN_AUTO_TEST", "off"),
        }),
        action({
                id: "agent.output-style",
                section: "agent",
                name: "Output style",
                risk: "low",
                summary: "The response format directive (built-ins + .unown/styles/*.md)",
                help: "Output styles are markdown directives with name/description frontmatter. The active pointer persists in .unown/output-style.json (project) or the user twin; project beats user.",
                related: ["/output-style"],
                actionLabel: "runs /output-style",
        }),
];

// ---------------------------------------------------------------------------
// MEMORY — what Unown remembers
// ---------------------------------------------------------------------------

const memoryItems: SettingsItem[] = [
        action({
                id: "memory.stack",
                section: "memory",
                name: "Memory stack (4 tiers)",
                risk: "low",
                summary: "The effective policy → project → user → local stack, with staleness + budget",
                help: "Shows what is actually injected every turn: the four tiers, their caps, what was pruned at injection, and the 80k budget meter. Read-only view (the /learning surface).",
                related: ["/learning"],
                actionLabel: "runs /learning",
        }),
        action({
                id: "memory.search",
                section: "memory",
                name: "Search memories",
                risk: "low",
                summary: "Cross-project semantic recall",
                help: "Search is pull-only: nothing is auto-injected from search results, so a bad hit only matters if you or the agent ask for it. Deletes and rollbacks live in the dashboard Memory screen.",
                related: ["/memory search", "unown dashboard memory"],
                actionLabel: "asks for a query, then runs /memory search",
        }),
        readonly({
                id: "memory.tier-cap",
                section: "memory",
                name: "Per-tier write cap",
                risk: "med",
                summary: "Max chars per memory tier before writes are refused (48k default)",
                help: "A tier at cap refuses growth (a dream converts that into a gated outcome — nothing is lost). Raise it only with a consolidation plan; the injection budget prunes anyway.",
                env: "PI_MEMORY_MAX_TIER_CHARS",
                get: () => envState("PI_MEMORY_MAX_TIER_CHARS", "48000"),
        }),
        readonly({
                id: "memory.total-budget",
                section: "memory",
                name: "Injection budget",
                risk: "med",
                summary: "Hard cap on memory injected per turn (80k default; oldest pruned first)",
                help: "At injection time the four tiers are summed; over budget, the oldest rule blocks drop first (policy/guide protected) and a visible pruned-footer records it. At-rest memory is untouched.",
                env: "PI_MEMORY_TOTAL_CHARS",
                get: () => envState("PI_MEMORY_TOTAL_CHARS", "80000"),
        }),
        readonly({
                id: "memory.hoist",
                section: "memory",
                name: "Cross-project hoist",
                risk: "med",
                summary: "Promote rules seen in ≥2 projects into the user tier (opt-in)",
                help: "Fully opt-in. Hoisted rules are additive bullets; delete by editing ~/.unown/memory/user.md. The hoist receipt lands in the dream note.",
                env: "PI_USER_TIER_HOIST",
                get: () => envBool("PI_USER_TIER_HOIST", "off (opt-in)"),
        }),
        readonly({
                id: "memory.project-identity",
                section: "memory",
                name: "Project identity",
                risk: "low",
                summary: "How this project's memory is keyed (git remote / path)",
                help: "Git projects key on the normalized remote — stable across clones, renames and worktrees. Non-git projects key on the real path: MOVING a non-git directory strands its old memory scope (known gap, settings_edge_case_catalogue.md §1).",
                tags: ["rename", "migration", "scope"],
                get: () => "shown in the Memory screen (dashboard); git projects are remote-keyed",
        }),
        readonly({
                id: "memory.manual-notes",
                section: "memory",
                name: "Manual notes protection",
                risk: "low",
                summary: "The '## Manual notes' lane survives every AutoDream re-render",
                help: "Hand-written content under that heading is preserved verbatim; the provenance sidecar records authorship. This is the safe place for corrections AutoDream keeps missing.",
                persistedIn: ".unown/memory/project.md",
                get: () => "protected lane (see .unown/memory/project.md)",
        }),
        action({
                id: "memory.edit-rollback",
                section: "memory",
                name: "Edit / roll back memory",
                risk: "med",
                summary: "The dashboard Memory screen: browse, edit, roll back versions",
                help: "Rollbacks write a NEW version — history is never destroyed. The engine's memory_versions table is the authority; .md files self-heal from it.",
                related: ["unown dashboard memory"],
                actionLabel: "runs /dashboard memory",
        }),
];

// ---------------------------------------------------------------------------
// LEARNING — what it learned, and what it may learn automatically
// ---------------------------------------------------------------------------

const learningItems: SettingsItem[] = [
        action({
                id: "learning.feed",
                section: "learning",
                name: "Learning feed",
                risk: "low",
                summary: "What Unown learned this session: dreams, versions, notes",
                help: "The session-local view of the learning system's output — every dream with its verdict (ship/sanitize/gate) and the notes that fed it.",
                related: ["/feed"],
                actionLabel: "runs /feed",
        }),
        toggle({
                id: "learning.review-mode",
                section: "learning",
                name: "Dream review mode",
                risk: "low",
                summary: "Dreams land as pending diffs; apply only after your approval",
                help: "OFF by default (dreams ship automatically, guarded by the canary). When ON, each dream's rendered diff waits in the review inbox below — approve to apply, discard to drop. Mirrors the skills staging lane (SA-B2), the pattern Gemini Auto Memory made standard.",
                persistedIn: "~/.unown/agent/settings-hub.json",
                related: ["learning.pending-dreams"],
                tags: ["dream", "approval", "inbox", "autodream"],
                default: false,
                get: () => loadHubPrefs().learningReviewMode,
                set: (v) => {
                        const prefs = loadHubPrefs();
                        prefs.learningReviewMode = Boolean(v);
                        saveHubPrefs(prefs);
                },
        }),
        action({
                id: "learning.pending-dreams",
                section: "learning",
                name: "Dream review inbox",
                risk: "med",
                summary: "Pending dream diffs awaiting approval (review mode)",
                help: "In review mode every dream parks its diff here. Approve applies it (and records the approval in the ledger); discard drops it. The engine's automatic canary still guards approved dreams.",
                related: ["learning.review-mode"],
                actionLabel: "opens the pending-diff list",
        }),
        readonly({
                id: "learning.dream-gate",
                section: "learning",
                name: "Dream canary gate",
                risk: "high",
                summary: "Re-run passing tasks under new memory; auto-rollback on regression",
                help: "HIGH RISK to disable: with the gate off, dreams ship with zero regression detection (the project path already lacks a canary — settings_edge_case_catalogue.md §2). The gate rolls the memory version back automatically when the canary fails.",
                env: "PI_DREAM_GATE",
                get: () => envBool("PI_DREAM_GATE", "on — keep it on"),
        }),
        readonly({
                id: "learning.canary-k",
                section: "learning",
                name: "Canary sample size",
                risk: "low",
                summary: "How many recent passing tasks the dream canary re-runs (K=3)",
                help: "Stratified sample of the K most-recent passing tasks. 0 = guard-only (no samples → the gate skips and the dream ships — beware).",
                env: "PI_DREAM_CANARY_K",
                get: () => envState("PI_DREAM_CANARY_K", "3"),
        }),
        action({
                id: "learning.skills-staged",
                section: "learning",
                name: "Staged skills inbox",
                risk: "med",
                summary: "Minted skills awaiting YOUR promotion (they never auto-load)",
                help: "The minter stages proposals in .unown/skills-staged/ — they are inert until a human moves them into .unown/skills/. This inbox replaces the raw mv: promote or discard each staged skill with a diff preview. Any guard flag rejects a proposal outright.",
                related: ["unown dashboard skills"],
                tags: ["skills", "staging", "approve", "promote"],
                actionLabel: "opens the staged-skills list",
        }),
        action({
                id: "learning.skills-screen",
                section: "learning",
                name: "Skills (shipped)",
                risk: "low",
                summary: "The loaded skill set, versions, health",
                help: "Shipped skills ride the prompt (index ceiling 24/project). Retirement is manual by design; rollback restores any recorded version.",
                related: ["unown dashboard skills"],
                actionLabel: "runs /dashboard skills",
        }),
        readonly({
                id: "learning.mint-caps",
                section: "learning",
                name: "Mint caps",
                risk: "low",
                summary: "Max active minted tasks, skills/dream, body size",
                help: "≤2 skills per dream, body ≤120 lines / 8k chars; mint failures never break the dream.",
                env: "UNOWN_MAX_MINTED_TASKS",
                get: () => envState("UNOWN_MAX_MINTED_TASKS", "8"),
        }),
        readonly({
                id: "learning.standing-orders",
                section: "learning",
                name: "Standing orders",
                risk: "med",
                summary: "Durable programs injected into every session (project + user)",
                help: "Order files live at .unown/standing-orders.md (project — overrides per id) and ~/.unown/agent/standing-orders.md (user). /promote drafts them from a session; digest budgets are fixed (2k/10k chars).",
                related: ["/promote"],
                get: () => "check /promote and docs/standing-orders.md",
        }),
];

// ---------------------------------------------------------------------------
// AUTOMATION — what runs unattended
// ---------------------------------------------------------------------------

const automationItems: SettingsItem[] = [
        action({
                id: "automation.list",
                section: "automation",
                name: "Routines",
                risk: "med",
                summary: "Every routine with its schedule, state and last run",
                help: "Routines live in the engine DB (never in the repo). Default mode is read-only (no bash/write/edit). This card lists them with lifecycle + last run outcome.",
                related: ["unown routines list"],
                actionLabel: "reads the engine's routine list",
        }),
        action({
                id: "automation.stop",
                section: "automation",
                name: "Stop a running routine (kill switch)",
                risk: "high",
                summary: "SIGKILL a live unattended run and close its record",
                help: "Before this switch a running automation could only be waited out (30-min hard timeout) or killed by restarting the engine. Stopping records the run as stopped-by-user with whatever output existed. Pausing the routine stops FUTURE runs only.",
                related: ["unown routines pause"],
                tags: ["kill", "stop", "cancel", "runaway"],
                actionLabel: "picks a running routine and stops it",
        }),
        action({
                id: "automation.runs",
                section: "automation",
                name: "Run history & spend",
                risk: "low",
                summary: "Recent runs with turns, tokens and outcome — the cost view",
                help: "Automation runs record tokens_in/tokens_out per run. Note: this spend is NOT inside the engine governor's ledger (known gap — the governor covers engine learning jobs only), so this view is where unattended cost is actually visible.",
                actionLabel: "reads recent runs with their token spend",
        }),
        readonly({
                id: "automation.default-mode",
                section: "automation",
                name: "Default run mode",
                risk: "med",
                summary: "New routines default to read-only (no bash/write/edit)",
                help: "The trust story: read-only default, nothing auto-merges, changes land in the working tree for git review. 'standard' mode gets the full session toolset behind the terminal deny-list.",
                get: () => "read-only (create with --mode standard to override per-routine)",
        }),
        readonly({
                id: "automation.misfire",
                section: "automation",
                name: "Misfire policy",
                risk: "low",
                summary: "What happens to runs missed while asleep/offline (skip after 5-min grace)",
                help: "Default: a slot more than 5 minutes late is skipped and recorded. UNOWN_AUTOMATION_MISFIRE_CATCHUP=1 switches to catch-up-once (under 24h lag); per-routine misfire overrides the env.",
                env: "UNOWN_AUTOMATION_MISFIRE_CATCHUP",
                get: () => envState("UNOWN_AUTOMATION_MISFIRE_CATCHUP", "skip"),
        }),
        readonly({
                id: "automation.chain-depth",
                section: "automation",
                name: "Chain depth cap",
                risk: "low",
                summary: "routine.finished events chain routines, capped at 3 hops",
                help: "Recursive workflows are bounded by MAX_CHAIN_DEPTH=3; the internal event namespace is reserved so webhook senders cannot forge engine events.",
                get: () => "3 hops (hardcoded, visible in history rows)",
        }),
];

// ---------------------------------------------------------------------------
// SAFETY — what Unown is allowed to do, and who decides
// ---------------------------------------------------------------------------

const safetyItems: SettingsItem[] = [
        action({
                id: "safety.envelope",
                section: "safety",
                name: "Effective permission envelope",
                risk: "low",
                summary: "The one-screen answer to \"what is it allowed to do?\"",
                help: "Composes: permission mode, permission rules (count + origins), write roots, OS sandbox state, strict-hooks state, and the defense stack — the five layers that decide every action, in precedence order.",
                tags: ["permissions", "envelope", "layers"],
                actionLabel: "renders the envelope card",
        }),
        action({
                id: "safety.trust-manifest",
                section: "safety",
                name: "Trust manifest (this project)",
                risk: "high",
                summary: "Everything this project's configs would activate — before you trust them",
                help: "Enumerates the project's .unown/ configs (mcp servers, hooks, lsp, permissions, settings) with their trust state and what each grants. Untrusted configs are withheld until approved through their /x trust flow. The Gemini trusted-folders pattern: informed consent at the moment of highest leverage.",
                tags: ["trust", "manifest", "project", "approve"],
                actionLabel: "renders the trust manifest",
        }),
        action({
                id: "safety.permissions",
                section: "safety",
                name: "Permission rules",
                risk: "high",
                summary: "Granular allow/deny/ask rules (user + trusted project)",
                help: "Rules are {tool, effect, pattern} entries in permissions.json; project rules are trust-gated. /permissions status shows the effective set. Auto-learn (UNOWN_PERMISSIONS_LEARN) appends allow rules for passed bash commands — off by default.",
                related: ["/permissions"],
                actionLabel: "runs /permissions status",
        }),
        action({
                id: "safety.add-dir",
                section: "safety",
                name: "Extra writable directories",
                risk: "high",
                summary: "Grant the session a write root beyond the project (--add-dir)",
                help: "Each grant extends the write jail for THIS session only. The instruction-set write gate stays final either way. /add-dir list shows current grants.",
                related: ["/add-dir"],
                actionLabel: "runs /add-dir list",
        }),
        {
                id: "safety.default-project-trust",
                section: "safety",
                name: "Default project trust",
                kind: "select",
                risk: "high",
                summary: "How unopened projects are treated (Ask / Always trust / Never trust)",
                help: "HIGH RISK: 'Always trust' auto-accepts every new project — including cloned repos with hostile .unown/ configs (they are still refuse-first, but the gate is your backstop). Keep 'Ask'.",
                persistedIn: "~/.unown/agent/settings.json",
                choices: [
                        { label: "Ask (recommended)", value: "ask" },
                        { label: "Always trust", value: "always" },
                        { label: "Never trust", value: "never" },
                ],
                default: "ask",
                get: () => pi().getDefaultProjectTrust(),
                set: (v) => pi().setDefaultProjectTrust(String(v) as "ask" | "always" | "never"),
        },
        readonly({
                id: "safety.strict-hooks",
                section: "safety",
                name: "Strict hooks",
                risk: "high",
                summary: "Sandbox-grade hook deny-list: blocks network, git push, sudo; refuses bypassPermissions",
                help: "HIGH RISK to disable: the strict list is what stops a hooked command from pushing to git or curling the network. Default terminal list still blocks catastrophic rm/fork-bombs either way.",
                env: "UNOWN_STRICT_HOOKS",
                get: () => envBool("UNOWN_STRICT_HOOKS", "on"),
        }),
        readonly({
                id: "safety.sandbox",
                section: "safety",
                name: "OS sandbox (bubblewrap)",
                risk: "high",
                summary: "Kernel isolation for engine sandbox commands",
                help: "HIGH RISK to disable. The vendored bwrap binary provides fs+net isolation for unattended sandbox runs. UNOWN_SANDBOX_NET=1 lets sandboxed code reach the bridge/LAN — leave shared-net off unless the sandbox needs network.",
                env: "UNOWN_OS_SANDBOX",
                get: () => envBool("UNOWN_OS_SANDBOX", "on where bwrap exists"),
        }),
        readonly({
                id: "safety.shield",
                section: "safety",
                name: "Injection shield",
                risk: "high",
                summary: "Flags injection-pattern content in tool output + subagent deliveries",
                help: "Fail-open by design (advisory banners, never a crash). Disabling it removes the only in-loop signal that a tool result or fleet delivery carries prompt-injection payload.",
                env: "UNOWN_INJECTION_SHIELD",
                get: () => envBool("UNOWN_INJECTION_SHIELD", "on"),
        }),
        readonly({
                id: "safety.scanner",
                section: "safety",
                name: "Injection scanner",
                risk: "high",
                summary: "Regex pattern scan of untrusted text (builtin + user patterns)",
                help: "Patterns live in ~/.config/unown/injection-scanner.json (or $UNOWN_HOME). Regex-only — a benign paraphrase can evade it; the dream guard + shield are the deeper layers.",
                env: "UNOWN_INJECTION_SCANNER",
                get: () => envBool("UNOWN_INJECTION_SCANNER", "on"),
        }),
        readonly({
                id: "safety.adversary",
                section: "safety",
                name: "Adversary review",
                risk: "high",
                summary: "A second model reviews suspicious turns",
                help: "Gate file at ~/.config/unown/adversary.md (or $UNOWN_HOME). Costs an LLM call when triggered; catches what regex cannot.",
                env: "UNOWN_ADVERSARY",
                get: () => envBool("UNOWN_ADVERSARY", "on"),
        }),
        readonly({
                id: "safety.permissions-layer",
                section: "safety",
                name: "Permissions layer",
                risk: "high",
                summary: "The granular permissions layer itself (deny-list + jail stay on regardless)",
                help: "Turning the layer off (UNOWN_PERMISSIONS=0) drops rule-based gating but the bash deny-list and write jail remain. Prefer rules over disabling.",
                env: "UNOWN_PERMISSIONS",
                get: () => envBool("UNOWN_PERMISSIONS", "on"),
        }),
        readonly({
                id: "safety.trust-bypass",
                section: "safety",
                name: "Project-config trust bypass",
                risk: "high",
                summary: "UNOWN_TRUST_PROJECT_CONFIG=1 skips the trust gate for cloned configs",
                help: "NEVER set this outside CI: it is the RCE/prompt-injection vector for hostile cloned repos (their mcp/hooks/lsp/permissions activate unreviewed). CI/headless lanes only.",
                env: "UNOWN_TRUST_PROJECT_CONFIG",
                get: () => envBool("UNOWN_TRUST_PROJECT_CONFIG", "off — keep it off"),
        }),
        readonly({
                id: "safety.elicitation",
                section: "safety",
                name: "MCP elicitation policy",
                risk: "med",
                summary: "Per-server autoAccept/autoDecline for MCP questions (default: decline)",
                help: "Default autoDecline is safe. autoAccept on a destructive server silently confirms deletes with a schema-valid dummy answer — the escalation gap (edge-case catalogue §5). Review per server: /mcp elicitation <server>.",
                related: ["/mcp elicitation"],
                get: () => "default: auto-decline (per-server override via /mcp elicitation)",
        }),
        readonly({
                id: "safety.instruction-guard",
                section: "safety",
                name: "Instruction-set write guard",
                risk: "high",
                summary: "In-session writes to AGENTS.md/skills/memory/hooks are DENIED",
                help: "The agent cannot rewrite its own instructions: AGENTS.md/CLAUDE.md at any depth, .unown/skills/**, .unown/memory/project.md, hooks/permissions configs. Redirect escapes are treated the same. Changes go through a PR.",
                get: () => "enforced (always on)",
        }),
];

// ---------------------------------------------------------------------------
// MODELS & COST
// ---------------------------------------------------------------------------

const modelsItems: SettingsItem[] = [
        action({
                id: "models.providers",
                section: "models",
                name: "Providers",
                risk: "high",
                summary: "The provider registry: list, add, key, test, defaults",
                help: "Providers persist in ~/.unown/agent/models.json (registry) + auth.json (keys, 0600). Keys referenced as $VAR never land in registry files.",
                related: ["/providers", "unown providers", "unown setup"],
                actionLabel: "runs /providers",
        }),
        readonly({
                id: "models.default",
                section: "models",
                name: "Default model",
                risk: "med",
                summary: "The effective model with its precedence chain",
                help: "Precedence: --model flag > project .unown/settings.json > user default > PI_MODEL_ID env. The hub shows the resolved value; change it with /model (session) or here (persisted).",
                persistedIn: "~/.unown/agent/settings.json",
                related: ["/model", "/scoped-models"],
                get: () => {
                        const provider = pi().getDefaultProvider();
                        const model = pi().getDefaultModel();
                        if (provider && model) return `${provider}/${model}`;
                        return model ?? "(env PI_MODEL_ID default)";
                },
        }),
        action({
                id: "models.thinking",
                section: "models",
                name: "Thinking level",
                risk: "med",
                summary: "Reasoning effort for this session + per-model defaults",
                help: "/thinking sets the session level; per-model defaults persist in settings.json (modelThinkingLevels). Budgets per level live in thinkingBudgets (Advanced).",
                related: ["/thinking"],
                actionLabel: "runs /thinking",
        }),
        action({
                id: "models.usage",
                section: "models",
                name: "Usage & cost",
                risk: "low",
                summary: "This session's tokens + the bridge's windowed report",
                help: "Session totals use the same attribution as /session; the bridge window is the same pure core `unown usage` runs. Pricing resolution: UNOWN_PRICE_* env > verified spec sidecar > shipped estimates.",
                related: ["/usage", "unown usage"],
                actionLabel: "runs /usage",
        }),
        readonly({
                id: "models.spec-status",
                section: "models",
                name: "Model spec verification",
                risk: "med",
                summary: "Context-window / max-tokens provenance (verified / estimate / unverified)",
                help: "A model no verifiable source knows fails setup unless UNOWN_ALLOW_UNVERIFIED_SPECS=1 (it then runs on the conservative floor, labeled unverified). unown models verify runs the explicit detection pass.",
                related: ["unown models verify"],
                get: () => {
                        try {
                                const path = join(resolveUnownHome(), "agent", "model-specs.json");
                                if (!existsSync(path)) return "no verified record yet — run unown models verify";
                                const specs = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
                                const count = Object.keys(specs).length;
                                return count > 0 ? `${count} verified record(s) in model-specs.json` : "empty — run unown models verify";
                        } catch {
                                return "unreadable — run unown models verify";
                        }
                },
        }),
        readonly({
                id: "models.governor",
                section: "models",
                name: "Governor ceilings (engine jobs)",
                risk: "high",
                summary: "Per-hour/day call + token ceilings for unattended learning jobs",
                help: "0 = UNLIMITED (dangerous: unattended spend with no ceiling). NOTE: these cover ENGINE learning jobs only — automation-run spend is not in this ledger (see Automation → Run history & spend).",
                env: "PI_ENGINE_MAX_TOKENS_DAY",
                get: () => {
                        const hour = envState("PI_ENGINE_MAX_CALLS_HOUR", "60 calls");
                        const tokH = envState("PI_ENGINE_MAX_TOKENS_HOUR", "200000");
                        const tokD = envState("PI_ENGINE_MAX_TOKENS_DAY", "2000000");
                        return `calls/h: ${hour} · tok/h: ${tokH} · tok/day: ${tokD}`;
                },
        }),
        readonly({
                id: "models.update-channel",
                section: "models",
                name: "Update channel",
                risk: "high",
                summary: "Release feed base URL + experimental archives",
                help: "Updates verify manifest + SHA-256 and support --rollback. Pointing the base URL anywhere but the official feed is a supply-chain risk; experimental archives are unsigned.",
                env: "UNOWN_RELEASES_BASE_URL",
                get: () =>
                        `base: ${envState("UNOWN_RELEASES_BASE_URL", "GitHub releases")} · experimental: ${envBool("UNOWN_ALLOW_EXPERIMENTAL", "off")}`,
        }),
];

// ---------------------------------------------------------------------------
// TOOLS & INTEGRATIONS
// ---------------------------------------------------------------------------

const toolsItems: SettingsItem[] = [
        action({
                id: "tools.mcp",
                section: "tools",
                name: "MCP servers",
                risk: "high",
                summary: "Status, reconnect, trust, elicitation per server",
                help: "Servers live in ~/.unown/agent/mcp.json (user) + .unown/mcp.json (project, trust-gated). Failed servers stay out of the way; reconnect cooldown 30s blocks spawn storms.",
                related: ["/mcp", "unown mcp list"],
                actionLabel: "runs /mcp",
        }),
        readonly({
                id: "tools.mcp-count",
                section: "tools",
                name: "Configured MCP servers",
                risk: "low",
                summary: "How many servers are configured (user + project scope)",
                help: "Per-server tool cap is 100; tool names are namespaced mcp__<server>__<tool> with collision suffixes. Every result flows through the injection shield.",
                get: () => {
                        const count = (p: string): number => {
                                try {
                                        if (!existsSync(p)) return 0;
                                        const parsed = JSON.parse(readFileSync(p, "utf8")) as { mcpServers?: Record<string, unknown> };
                                        return Object.keys(parsed.mcpServers ?? {}).length;
                                } catch {
                                        return 0;
                                }
                        };
                        const user = count(join(resolveUnownHome(), "agent", "mcp.json"));
                        const project = count(join(process.cwd(), ".unown", "mcp.json"));
                        return `user: ${user} · project: ${project} (project is trust-gated)`;
                },
        }),
        action({
                id: "tools.hooks",
                section: "tools",
                name: "Hooks",
                risk: "high",
                summary: "The user-hook layer: 13 events × 5 handler types",
                help: "Hook handlers live in hooks.json (user) + .unown/hooks.json (project, trust-gated). Default is fail-open; per-handler failClosed opts in. Project handlers need /hooks trust.",
                related: ["/hooks", "/hooks trust"],
                actionLabel: "runs /hooks",
        }),
        {
                id: "tools.hook-depth",
                section: "tools",
                name: "Hook loop breaker (max depth)",
                kind: "number",
                risk: "low",
                summary: "Bound hook→agent→hook recursion before it runs away (default 3)",
                help: "A hook command that spawns unown in the same project re-runs the same hooks — previously unbounded recursion (the edge-case catalogue's #3 gap). Hook children carry UNOWN_HOOK_DEPTH; at max depth hooks are skipped with a warning. 1-10.",
                persistedIn: "~/.unown/agent/settings-hub.json",
                related: ["tools.hooks"],
                tags: ["hook", "loop", "recursion", "breaker"],
                integer: true,
                min: 1,
                max: 10,
                default: 3,
                get: () => loadHubPrefs().hookMaxDepth,
                set: (v) => {
                        const prefs = loadHubPrefs();
                        prefs.hookMaxDepth = Math.min(Math.max(Math.trunc(Number(v) || 3), 1), 10);
                        saveHubPrefs(prefs);
                },
        },
        action({
                id: "tools.lsp",
                section: "tools",
                name: "LSP servers",
                risk: "med",
                summary: "Language servers: status + project config trust",
                help: "Overrides live in ~/.unown/agent/lsp.json + .unown/lsp.json (project, trust-gated). Timeouts: 10s wait / 15s request; crash cooldown 30s.",
                related: ["/lsp", "/lsp trust"],
                actionLabel: "runs /lsp",
        }),
        action({
                id: "tools.subagents",
                section: "tools",
                name: "Subagents",
                risk: "med",
                summary: "The catalog: built-ins + .unown/agents/*.md",
                help: "Custom agents declare model/effort/timeouts in frontmatter. Delegation level sets how eagerly the parent spawns (UNOWN_DELEGATION_LEVEL).",
                related: ["/agents", "/tasks", "/delegation"],
                actionLabel: "runs /agents",
        }),
        readonly({
                id: "tools.subagent-turns",
                section: "tools",
                name: "Subagent turn cap",
                risk: "high",
                summary: "UNOWN_SUBAGENT_MAX_TURNS — the runaway-fan-out guard (default OFF)",
                help: "Sync subagent spawns are wall-clock bounded (5 min default) but turn-capped only when this is set. Recommended: set a cap (e.g. 40). 0 = unlimited fleet concurrency is a separate, riskier escape.",
                env: "UNOWN_SUBAGENT_MAX_TURNS",
                get: () => envState("UNOWN_SUBAGENT_MAX_TURNS", "off — set a cap (e.g. 40)"),
        }),
        readonly({
                id: "tools.fleet",
                section: "tools",
                name: "Fleet concurrency & timeout",
                risk: "high",
                summary: "Async fleet: live-children cap (8) + hard timeout (15 min)",
                help: "UNOWN_FLEET_MAX_CONCURRENT=0 means UNLIMITED children — the cost-explosion escape. The reaper sweeps orphans on boot; task_control stop is the in-run brake.",
                env: "UNOWN_FLEET_MAX_CONCURRENT",
                get: () =>
                        `concurrency: ${envState("UNOWN_FLEET_MAX_CONCURRENT", "8")} · timeout: ${envState("UNOWN_FLEET_TIMEOUT_MS", "900000ms")}`,
        }),
        readonly({
                id: "tools.websearch",
                section: "tools",
                name: "Web search & fetch",
                risk: "med",
                summary: "Providers, timeouts, cache (webcache) — and the SSRF guard",
                help: "UNOWN_WEBFETCH_ALLOW_PRIVATE=1 disables SSRF protection (fetch into LAN/internal docs) — high risk. Cached results save repeat requests (unown webcache stats).",
                env: "UNOWN_WEB_SEARCH_PROVIDER",
                get: () => `provider: ${envState("UNOWN_WEB_SEARCH_PROVIDER", "auto")} · cache: ${envBool("UNOWN_WEB_CACHE", "on")}`,
        }),
        readonly({
                id: "tools.browser",
                section: "tools",
                name: "Browser lane",
                risk: "med",
                summary: "Headless browser: stealth tier, captcha, profile persistence",
                help: "The persistent profile (~/.unown/browser/profile) keeps logins across sessions — treat it like a logged-in browser. Host deny glob: UNOWN_BROWSER_BLOCK.",
                env: "UNOWN_BROWSER_HEADLESS",
                get: () => `headless: ${envState("UNOWN_BROWSER_HEADLESS", "on")} · profile persists logins`,
        }),
];

// ---------------------------------------------------------------------------
// OBSERVABILITY
// ---------------------------------------------------------------------------

const observabilityItems: SettingsItem[] = [
        action({
                id: "obs.status",
                section: "observability",
                name: "Status card",
                risk: "low",
                summary: "One glance: model, thinking, permissions, memory, engine, worktree",
                help: "The /status card composes the session's live facts.",
                related: ["/status"],
                actionLabel: "runs /status",
        }),
        action({
                id: "obs.context",
                section: "observability",
                name: "Context window",
                risk: "low",
                summary: "The utilization bar + where the window goes + compaction advice",
                help: "Shows memory stack size, conversation estimate, system+tools residual — the /context grid.",
                related: ["/context"],
                actionLabel: "runs /context",
        }),
        action({
                id: "obs.insights",
                section: "observability",
                name: "Insights",
                risk: "low",
                summary: "Cross-session analytics: files, tools, tokens, friction",
                help: "Aggregates over session history (unown insights is the CLI twin).",
                related: ["/insights"],
                actionLabel: "runs /insights",
        }),
        action({
                id: "obs.recent-changes",
                section: "observability",
                name: "Settings change ledger",
                risk: "low",
                summary: "Who changed what, when, via which surface — with revert",
                help: "Every hub-mediated write lands in ~/.unown/agent/settings-history.jsonl (append-only, capped). This is the audit trail the trust framework requires; each entry can be reverted in place.",
                related: ["/settings recent"],
                actionLabel: "opens Recently changed",
        }),
        readonly({
                id: "obs.turn-meter",
                section: "observability",
                name: "Turn meter",
                risk: "low",
                summary: "Per-turn footer chip: time, TTFT, context %, tokens",
                help: "Cosmetic observability; hides nothing. UNOWN_TURN_METER=0 hides it.",
                env: "UNOWN_TURN_METER",
                get: () => envBool("UNOWN_TURN_METER", "on"),
        }),
        readonly({
                id: "obs.mission-panel",
                section: "observability",
                name: "Mission panel",
                risk: "low",
                summary: "The objective/progress/confidence panel (goal > /mission pin > auto-title)",
                help: "Progress and confidence derive from receipts only — the panel never invents numbers. UNOWN_MISSION_PANEL=0 hides it; /mission off is the in-session switch.",
                env: "UNOWN_MISSION_PANEL",
                get: () => envBool("UNOWN_MISSION_PANEL", "on"),
        }),
        readonly({
                id: "obs.telemetry",
                section: "observability",
                name: "Install telemetry",
                risk: "med",
                summary: "Anonymous update ping (opt-in)",
                help: "The install ping reports version on update checks. DO_NOT_TRACK also disables it. Analytics (enableAnalytics) is a separate, also-off-by-default key.",
                env: "NO_UPDATE_NOTIFIER",
                get: () => `install ping: ${pi().getEnableInstallTelemetry() ? "on" : "off"} (opt-in)`,
        }),
];

// ---------------------------------------------------------------------------
// RECOVERY
// ---------------------------------------------------------------------------

const recoveryItems: SettingsItem[] = [
        action({
                id: "rec.undo",
                section: "recovery",
                name: "Undo file changes",
                risk: "med",
                summary: "Revert the last N turns' file changes (crash-safe, journaled)",
                help: "Checkpoints seal per turn; /undo n reverts n turns, /redo re-applies. COVERAGE: bash-tool file changes are NOT checkpointed (commands are ledger-recorded, files are not) — use git for those. Files over 64 MiB are never blobbed (honest oversized marker).",
                related: ["/undo", "/redo", "/checkpoints", "/receipts"],
                actionLabel: "pre-fills /undo",
        }),
        action({
                id: "rec.restore",
                section: "recovery",
                name: "Restore a checkpoint",
                risk: "med",
                summary: "Named snapshots of every file the session touched",
                help: "/checkpoint [label] snapshots on demand; /restore <id|label> returns to it. Restores verify sha256 against the manifest and refuse outside the project jail.",
                related: ["/checkpoint", "/restore"],
                actionLabel: "pre-fills /checkpoints",
        }),
        action({
                id: "rec.recovery",
                section: "recovery",
                name: "Recovery triage",
                risk: "low",
                summary: "What needs attention: tool errors, verify failures, engine, dead letters",
                help: "The /recovery card ranks by severity with per-kind FIX lines; the ambient footer chip counts unfixed items.",
                related: ["/recovery"],
                actionLabel: "runs /recovery",
        }),
        action({
                id: "rec.dream-rollback",
                section: "recovery",
                name: "Roll back learned memory",
                risk: "med",
                summary: "Version rollback for any dream-applied memory tier",
                help: "Rollbacks write a NEW version — history is never destroyed. The engine path also auto-rolls when the canary fails; this is the manual surface.",
                related: ["unown dashboard memory"],
                actionLabel: "runs /dashboard memory",
        }),
        action({
                id: "rec.update-rollback",
                section: "recovery",
                name: "Roll back an update",
                risk: "med",
                summary: "unown update --rollback returns to the previous binary",
                help: "Updates verify manifest + SHA-256 before installing; rollback restores the prior version. Skip/snooze specific versions with unown update --skip <v>.",
                related: ["unown update --rollback"],
                actionLabel: "pre-fills the command hint",
        }),
        action({
                id: "rec.reset",
                section: "recovery",
                name: "Reset settings (scoped)",
                risk: "high",
                summary: "Per-section reset to defaults — with an automatic backup first",
                help: "Scoped resets (hub prefs / addons / pi settings / all). Every reset writes a timestamped bundle to ~/.unown/agent/settings-backups/ before touching anything (last 5 kept). Nothing here is all-or-nothing.",
                related: ["/settings reset"],
                actionLabel: "opens the reset flow",
        }),
        action({
                id: "rec.transfer",
                section: "recovery",
                name: "Export / import settings",
                risk: "med",
                summary: "A portable JSON bundle of user-owned settings (no secrets)",
                help: "Exports addons, pi user settings, ui layout, output-style pointer, hub prefs and user permission rules — never auth.json, models.json keys or .env. Import validates the schema, backs up current state, and merges (never clobbers unknown keys).",
                related: ["/settings export", "/settings import"],
                actionLabel: "opens the transfer flow",
        }),
];

// ---------------------------------------------------------------------------
// ADVANCED — power knobs (visible + searchable, behind the gate)
// ---------------------------------------------------------------------------

const advancedItems: SettingsItem[] = [
        readonly({
                id: "adv.env-browser",
                section: "advanced",
                name: "Environment variable browser",
                risk: "med",
                summary: "Every env knob the stack reads, with its effective value",
                help: "The .env reference is excellent documentation but invisible from the TUI; this browser makes the ~150 vars searchable and shows which are set. Edit .env (or your shell) to change them — the bridge/engine need a restart.",
                related: [".env.example"],
                actionLabel: "opens the searchable browser",
        }),
        readonly({
                id: "adv.engine-network",
                section: "advanced",
                name: "Engine network exposure",
                risk: "high",
                summary: "Bind host, auth mode, CORS — the loopback-first contract",
                help: "UNOWN_ENGINE_HOST=0.0.0.0 puts the learning surface (notes, memory, providers, automations) on the network behind the token; UNOWN_ENGINE_AUTH=off is REFUSED off-loopback at boot. Keep loopback + token.",
                env: "UNOWN_ENGINE_HOST",
                get: () =>
                        `host: ${envState("UNOWN_ENGINE_HOST", "127.0.0.1")} · auth: ${envState("UNOWN_ENGINE_AUTH", "token")} · cors: ${envState("UNOWN_ENGINE_CORS", "loopback only")}`,
        }),
        readonly({
                id: "adv.retention",
                section: "advanced",
                name: "Retention windows",
                risk: "high",
                summary: "How long run/notes/hook-log/PLM history is kept (permanent deletes)",
                help: "UNOWN_RETENTION_DAYS=0 disables pruning (unbounded growth); small values destroy audit history PERMANENTLY. Precious tables (memory versions, receipts) are never pruned. Changes need an engine restart.",
                env: "UNOWN_RETENTION_DAYS",
                get: () => envState("UNOWN_RETENTION_DAYS", "per-table defaults (runs 30d, history 90d)"),
        }),
        readonly({
                id: "adv.bridge",
                section: "advanced",
                name: "Bridge concurrency & upstream",
                risk: "med",
                summary: "The llm-bridge: spacing, concurrency cap, upstream timeouts",
                help: "BRIDGE_MAX_CONCURRENCY bounds in-flight upstream attempts (interactive admitted first); MIN_SPACING serializes starts; UPSTREAM_TIMEOUT fails fast on a stalled upstream. Bridge restart applies.",
                env: "BRIDGE_MAX_CONCURRENCY",
                get: () =>
                        `concurrency: ${envState("BRIDGE_MAX_CONCURRENCY", "3")} · spacing: ${envState("BRIDGE_MIN_SPACING_MS", "400ms")} · timeout: ${envState("BRIDGE_UPSTREAM_TIMEOUT_MS", "180000ms")}`,
        }),
        readonly({
                id: "adv.compaction",
                section: "advanced",
                name: "Terminal compaction thresholds",
                risk: "med",
                summary: "The unown-layer auto-compact curve (85% trigger / 95% hard limit)",
                help: "Separate from the pi-layer compaction settings — two systems, one concern (a finding from the inventory). Idle compaction: UNOWN_IDLE_COMPACT_MINUTES (45) with min-usage gate.",
                env: "UNOWN_AUTO_COMPACT_THRESHOLD",
                get: () =>
                        `trigger: ${envState("UNOWN_AUTO_COMPACT_THRESHOLD", "85%")} · hard: ${envState("UNOWN_AUTO_COMPACT_HARD_LIMIT", "95%")} · idle: ${envState("UNOWN_IDLE_COMPACT_MINUTES", "45min")}`,
        }),
        readonly({
                id: "adv.local-ml",
                section: "advanced",
                name: "Local-ML dream lanes",
                risk: "med",
                summary: "Non-LLM dream pre-processors: dedup, ranking, curation (off)",
                help: "PI_LOCAL_ML=shadow computes + reports without changing the prompt; 1/live alters dream input. The ONNX embedding sub-package is not installed by default.",
                env: "PI_LOCAL_ML",
                get: () => envState("PI_LOCAL_ML", "off"),
        }),
        readonly({
                id: "adv.spec-overrides",
                section: "advanced",
                name: "Spec & price overrides",
                risk: "med",
                summary: "Unverified-spec acceptance + per-model price pins",
                help: "UNOWN_ALLOW_UNVERIFIED_SPECS=1 runs unknown models on the conservative floor (silent truncation risk). UNOWN_PRICE_<MODEL>_IN/_OUT pin exact USD/1M for /usage math (both or neither).",
                env: "UNOWN_ALLOW_UNVERIFIED_SPECS",
                get: () => envBool("UNOWN_ALLOW_UNVERIFIED_SPECS", "off — prefer unown models verify"),
        }),
];

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const SETTINGS_REGISTRY: SettingsItem[] = [
        ...agentItems,
        ...memoryItems,
        ...learningItems,
        ...automationItems,
        ...safetyItems,
        ...modelsItems,
        ...toolsItems,
        ...observabilityItems,
        ...recoveryItems,
        ...advancedItems,
];

export function itemsBySection(section: SettingsSectionId): SettingsItem[] {
        return SETTINGS_REGISTRY.filter((item) => item.section === section);
}

export function itemById(id: string): SettingsItem | undefined {
        return SETTINGS_REGISTRY.find((item) => item.id === id);
}

/** Integrity invariant, asserted by tests: ids unique, sections valid. */
export function registryIntegrity(): { ok: boolean; errors: string[] } {
        const errors: string[] = [];
        const seen = new Set<string>();
        const validSections = new Set(SETTINGS_SECTIONS);
        for (const item of SETTINGS_REGISTRY) {
                if (seen.has(item.id)) errors.push(`duplicate id: ${item.id}`);
                seen.add(item.id);
                if (!validSections.has(item.section)) errors.push(`unknown section: ${item.id} in ${item.section}`);
                if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(item.id)) errors.push(`malformed id: ${item.id}`);
                if (item.kind === "number" && (item.min === undefined || item.max === undefined)) {
                        errors.push(`number item without bounds: ${item.id}`);
                }
                if (item.kind === "select" && (!item.choices || item.choices.length === 0)) {
                        errors.push(`select item without choices: ${item.id}`);
                }
                if (item.kind === "toggle" && (!item.get || !item.set)) {
                        errors.push(`toggle item without get/set: ${item.id}`);
                }
        }
        return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Staged-skills inbox support (Learning → staged inbox): list/preview/
// promote/discard — the human step of the SA-B2 lane, minus the raw mv.
// ---------------------------------------------------------------------------

export interface StagedSkill {
        name: string;
        dir: string;
        skillMd: string;
}

export function listStagedSkills(cwd: string): StagedSkill[] {
        const dir = join(cwd, ".unown", "skills-staged");
        if (!existsSync(dir)) return [];
        const out: StagedSkill[] = [];
        for (const name of readdirSync(dir)) {
                const skillDir = join(dir, name);
                const skillMd = join(skillDir, "SKILL.md");
                if (!existsSync(skillMd)) continue;
                try {
                        out.push({ name, dir: skillDir, skillMd: readFileSync(skillMd, "utf8") });
                } catch {
                        /* unreadable staged skill — skip */
                }
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        return out;
}

/** Promote a staged skill into .unown/skills/ (the human mv, made safe). */
export function promoteStagedSkill(cwd: string, name: string): { ok: boolean; error?: string } {
        const staged = listStagedSkills(cwd).find((s) => s.name === name);
        if (!staged) return { ok: false, error: `no staged skill named ${name}` };
        const target = join(cwd, ".unown", "skills", name);
        if (existsSync(target)) return { ok: false, error: `.unown/skills/${name} already exists` };
        mkdirSync(join(cwd, ".unown", "skills"), { recursive: true });
        renameSync(staged.dir, target);
        return { ok: true };
}

/** Discard a staged skill (it was never loaded — inert by design). */
export function discardStagedSkill(cwd: string, name: string): { ok: boolean; error?: string } {
        const staged = listStagedSkills(cwd).find((s) => s.name === name);
        if (!staged) return { ok: false, error: `no staged skill named ${name}` };
        rmSync(staged.dir, { recursive: true, force: true });
        return { ok: true };
}
