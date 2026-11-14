/**
 * memory-doctor.ts — the memory audit pass (Memory Divertimento round CP5,
 * 2026-11-14): `unown memory doctor`, the deferred gap #4 from the
 * comparative research — "an audit pass over a project's memory reporting
 * duplication, derivable-from-repo content, placement, token budget".
 *
 * The memU `doctor` law (ADR-0015's stablemate): a doctor that PROVES the
 * loop — a live retrieval probe on the recall path, not just file
 * existence. Unown's pre-Divertimento `unown doctor` checked that the
 * memory FILES exist; this module audits WHAT IS IN THEM and what the
 * engine says about the store:
 *
 *   tiers          — per-tier size vs cap, the resolved injection vs the
 *                    total budget (the same stack sessions inject —
 *                    terminal-side, engine-down safe), the stale count;
 *   recall seal     — a LIVE search probe: no superseded row may answer a
 *                    default recall bare (the CP1 seal, proven per-run);
 *   store health    — duplicates / conflicts / superseded / dormant /
 *                    sro-tagged + the review-queue depth (engine-side,
 *                    degraded-to-absent when the engine is down);
 *   placement       — user-tier bullets carrying file paths (paths are
 *                    project-bound; the user tier is injected into EVERY
 *                    project) and project-tier bullets that read as pure
 *                    workflow discipline (the hoist's class — "candidates
 *                    for the user tier once a second project agrees",
 *                    report-only, never auto-hoisted);
 *   derivable       — project-tier bullets that merely restate a
 *                    package.json script ("run <script>…" — package.json
 *                    is in context; a memory for it is noise).
 *
 * Store-free by construction (the CLI side of the detached contract):
 * the tier audit reads the terminal resolution (term.ts), the engine
 * surfaces come through an injectable `MemoryDoctorEngine` (the real one
 * is engineFetch-based; tests inject fakes). Nothing here imports the
 * engine DB.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countProjectRules, countProjectStaleRules } from "./engine-status.ts";
import { projectMemoryPath, resolveTerminalMemory, terminalMemoryForAgentDetailed, readTerminalUserTier, UNOWN_HOME } from "./term.ts";

/** One audit line: a class, a severity, the detail, and the remedy. */
export interface MemoryDoctorFinding {
        class: string;
        severity: "ok" | "warn" | "info";
        detail: string;
        remedy?: string;
}

/** The engine surfaces the audit reads (injectable; null = engine-down). */
export interface MemoryDoctorEngine {
        /** The health card; null when unreachable. */
        health(): Promise<null | {
                duplicateCount: number;
                conflictCount: number;
                supersededCount: number;
                dormantCount: number;
                sroTaggedCount: number;
                memoryCount: number;
        }>;
        /** The review queue's pending depth; null when unreachable. */
        reviewDepth(): Promise<number | null>;
        /** A live search probe (the recall-seal proof); null when unreachable. */
        searchProbe(query: string): Promise<null | Array<{ id: string; metadata?: Record<string, any> }>>;
}

export interface MemoryDoctorReport {
        project: string;
        engine: "up" | "down";
        tiers: Array<{ tier: string; path: string; chars: number; cap: number; stale: number; rules: number }>;
        injection: null | { chars: number; cap: number; prunedBlocks: number; truncatedTiers: string[]; overflow: boolean };
        store: null | {
                duplicates: number;
                conflicts: number;
                superseded: number;
                dormant: number;
                sroTagged: number;
                memoryCount: number;
        };
        reviewQueue: number | null;
        recallSeal: "sealed" | "leak" | "unverified";
        placement: { misplacedUserTier: string[]; hoistCandidates: string[] };
        derivable: string[];
        findings: MemoryDoctorFinding[];
}

/** The per-tier write cap (PI_MEMORY_MAX_TIER_CHARS default 48000) — the
 *  same parse memory.ts owns; mirrored store-free here (kept in sync). */
function maxTierChars(): number {
        const n = Number(process.env.PI_MEMORY_MAX_TIER_CHARS ?? 48_000);
        return Number.isFinite(n) && n > 0 ? n : 48_000;
}

/** A live engine backed by engineFetch-style getters (the CLI builds it
 *  with ENGINE_URL); tests build their own. */
export function liveMemoryDoctorEngine(fetchJson: (path: string) => Promise<null | any>): MemoryDoctorEngine {
        return {
                async health() {
                        const body = await fetchJson("/api/memory/health");
                        return body?.health ?? null;
                },
                async reviewDepth() {
                        const body = await fetchJson("/api/memory/review");
                        return typeof body?.depth === "number" ? body.depth : null;
                },
                async searchProbe(query) {
                        const body = await fetchJson(`/api/memories?across=1&q=${encodeURIComponent(query)}&limit=8`);
                        return Array.isArray(body?.memories) ? body.memories : null;
                },
        };
}

/** Run the audit for one project directory. Pure + the injectable engine
 *  and user-tier text (the test seam — term.ts resolves UNOWN_HOME at module
 *  load, so a per-test redirect cannot reach it; the CLI passes nothing and
 *  reads the real file). */
export async function auditProjectMemory(
        projectDir: string,
        engine: MemoryDoctorEngine,
        opts: { userTierText?: string } = {},
): Promise<MemoryDoctorReport> {
        const findings: MemoryDoctorFinding[] = [];

        // ---- tiers: the terminal resolution (the same stack sessions inject)
        const files = resolveTerminalMemory(projectDir);
        const detailed = terminalMemoryForAgentDetailed(projectDir);
        const tiers = files.map((f) => ({
                tier: f.tier,
                path: f.path,
                chars: f.content.length,
                cap: maxTierChars(),
                // the project tier's stale/rules counts read the render's own grammar
                stale: f.tier === "project" ? countProjectStaleRules(f.content) : 0,
                rules: f.tier === "project" ? countProjectRules(f.content) : 0,
        }));
        for (const t of tiers) {
                const pct = Math.round((t.chars / t.cap) * 100);
                findings.push({
                        class: `tier ${t.tier}`,
                        severity: pct >= 100 ? "warn" : "ok",
                        detail: `${t.chars.toLocaleString()}/${t.cap.toLocaleString()} chars (${pct}%)${t.rules > 0 ? ` · ${t.rules} rules${t.stale > 0 ? ` · ${t.stale} stale` : ""}` : ""}`,
                        remedy: pct >= 100 ? "at the write cap — dreams stop shipping until consolidated (edit/rollback from the dashboard, or prune under ## Manual notes rules that moved to the platform)" : undefined,
                });
        }
        const injection = detailed.report
                ? {
                          chars: detailed.report.totalAfter,
                          cap: detailed.report.cap,
                          prunedBlocks: detailed.report.prunedBlocks.length,
                          truncatedTiers: detailed.report.truncatedTiers,
                          overflow: detailed.report.overflow,
                  }
                : null;
        if (injection) {
                findings.push({
                        class: "injection budget",
                        severity: injection.overflow ? "warn" : injection.prunedBlocks > 0 ? "info" : "ok",
                        detail: `${injection.chars.toLocaleString()}/${injection.cap.toLocaleString()} chars${injection.prunedBlocks > 0 ? ` · ${injection.prunedBlocks} oldest block(s) pruned` : ""}${injection.truncatedTiers.length > 0 ? ` · head-truncated: ${injection.truncatedTiers.join(", ")}` : ""}${injection.overflow ? " — OVERFLOW" : ""}`,
                        remedy: injection.prunedBlocks > 0 || injection.overflow ? "the oldest dated blocks were pruned to fit — /memory show prints the exact stack the model received" : undefined,
                });
        }

        // ---- the store's health + review queue (engine-side, degraded-to-absent)
        const health = await engine.health().catch(() => null);
        const reviewDepth = await engine.reviewDepth().catch(() => null);
        let store: MemoryDoctorReport["store"] = null;
        if (health) {
                store = {
                        duplicates: health.duplicateCount ?? 0,
                        conflicts: health.conflictCount ?? 0,
                        superseded: health.supersededCount ?? 0,
                        dormant: health.dormantCount ?? 0,
                        sroTagged: health.sroTaggedCount ?? 0,
                        memoryCount: health.memoryCount ?? 0,
                };
                findings.push({
                        class: "store health",
                        severity: health.conflictCount > 0 ? "warn" : "ok",
                        detail: `${health.memoryCount} memories · ${health.duplicateCount ?? 0} dupe(s) · ${health.conflictCount ?? 0} conflict(s) · ${health.superseded ?? 0} superseded · ${health.dormant ?? 0} dormant · ${health.sroTagged ?? 0} sro-tagged`,
                        remedy: health.conflictCount > 0 ? "unresolved contradictions — let a dream run the reconcile (the engine's dream lane) or /memory search --all to audit them" : undefined,
                });
        } else {
                findings.push({ class: "store health", severity: "info", detail: "engine unreachable — the store audit is skipped (unown engine start)" });
        }
        if (reviewDepth !== null) {
                findings.push({
                        class: "review queue",
                        severity: reviewDepth > 0 ? "warn" : "ok",
                        detail: reviewDepth > 0 ? `${reviewDepth} candidate(s) awaiting your decision` : "empty",
                        remedy: reviewDepth > 0 ? "decide with /memory review (or unown memory review) — approve ships to both user tiers, discard keeps the verdict for audit" : undefined,
                });
        }

        // ---- the recall seal: a LIVE retrieval probe (the memU doctor law —
        // prove the loop, don't just check files exist). A benign probe term
        // that typically hits the learned store; zero hits = unverified (honest).
        const PROBE = "test";
        let recallSeal: MemoryDoctorReport["recallSeal"] = "unverified";
        const probe = await engine.searchProbe(PROBE).catch(() => null);
        if (probe && probe.length > 0) { // zero hits = unverified (honest), never a fake sealed
                const leaked = probe.filter((h) => h?.metadata?.supersededBy);
                recallSeal = leaked.length > 0 ? "leak" : "sealed";
                findings.push({
                        class: "recall seal",
                        severity: leaked.length > 0 ? "warn" : "ok",
                        detail: leaked.length > 0
                                ? `LEAK — ${leaked.length} superseded row(s) answered a default recall bare (the soft-delete-leak class)`
                                : `sealed — the "${PROBE}" probe returned ${probe.length} hit(s), none superseded bare`,
                        remedy: leaked.length > 0 ? "superseded memories must never answer a recall as current — this is a regression of the CP1 seal; file it" : undefined,
                });
        }

        // ---- placement: report-only, deterministic heuristics
        const placement = auditPlacement();
        if (placement.misplacedUserTier.length > 0) {
                findings.push({
                        class: "placement (user tier)",
                        severity: "info",
                        detail: `${placement.misplacedUserTier.length} bullet(s) carry file paths — paths are project-bound; the user tier is injected into EVERY project`,
                        remedy: "move them to the project tier (or local.md for machine specifics)",
                });
        }
        if (placement.hoistCandidates.length > 0) {
                findings.push({
                        class: "placement (project tier)",
                        severity: "info",
                        detail: `${placement.hoistCandidates.length} bullet(s) read as pure workflow discipline — candidates for the user tier once a second project agrees (the hoist gate; never auto-shipped)`,
                        remedy: "leave them — the cross-project hoist (PI_USER_TIER_HOIST=1) parks them for review when the evidence arrives",
                });
        }

        // ---- derivable: project-tier bullets restating package.json scripts
        const derivable = auditDerivable();
        if (derivable.length > 0) {
                findings.push({
                        class: "derivable from repo",
                        severity: "info",
                        detail: `${derivable.length} bullet(s) restate a package.json script — package.json is already in context; a memory for it is noise`,
                        remedy: "prune them under ## Manual notes (the preserved hand-edit lane) at the next cleanup",
                });
        }

        return {
                project: projectDir,
                engine: health ? "up" : "down",
                tiers,
                injection,
                store,
                reviewQueue: reviewDepth,
                recallSeal,
                placement,
                derivable,
                findings,
        };

        // ---- the placement/derivable heuristics (closure over projectDir)
        function auditPlacement(): { misplacedUserTier: string[]; hoistCandidates: string[] } {
                const misplacedUserTier: string[] = [];
                const hoistCandidates: string[] = [];
                try {
                        const user = opts.userTierText ?? readTerminalUserTier();
                        for (const line of user.split(/\r?\n/)) {
                                const bullet = line.trim().replace(/^[-*]\s+/, "");
                                if (!bullet) continue;
                                // a path token (~/ ./ ../ or a bare src/file.ts-looking token) is
                                // project/machine-bound — the user tier reaches every project
                                if (/~\/|\.{\/|^\w+\/[\w.-]+\.(ts|js|tsx|py|sh|md)\b/.test(bullet) || /\/[\w.-]+\//.test(bullet)) {
                                        misplacedUserTier.push(bullet.slice(0, 100));
                                }
                        }
                        const projectFile = existsSync(projectMemoryPath(projectDir)) ? readFileSync(projectMemoryPath(projectDir), "utf8") : "";
                        let inSection = false;
                        for (const line of projectFile.split(/\r?\n/)) {
                                if (/^##\s/.test(line)) {
                                        inSection = true;
                                        continue;
                                }
                                if (!inSection) continue;
                                if (/^##\s+Manual notes/.test(line)) break; // the hand-edit lane is the user's own
                                const bullet = line.trim().replace(/^[-*]\s+/, "");
                                if (!bullet) continue;
                                const body = bullet.replace(/·\s*[\d-]+\s*(·\s*(stale|superseded))?$/, "").trim();
                                // the hoist's class: pure workflow discipline, no path, no
                                // project name, no version numbers — report-only
                                if (
                                        /^(run|use|prefer|always|never|write|verify|read)\b/i.test(body) &&
                                        !/~\/|\.{\/|\/[\w.-]+\//.test(body) &&
                                        !/\d+\.\d+/.test(body)
                                ) {
                                        hoistCandidates.push(body.slice(0, 100));
                                }
                        }
                } catch {
                        /* unreadable tiers — the placement audit degrades to absent */
                }
                return { misplacedUserTier, hoistCandidates };
        }

        function auditDerivable(): string[] {
                const out: string[] = [];
                try {
                        const pkgPath = join(projectDir, "package.json");
                        if (!existsSync(pkgPath) || !existsSync(projectMemoryPath(projectDir))) return out;
                        const scripts = new Set(Object.keys((JSON.parse(readFileSync(pkgPath, "utf8")) ?? {}).scripts ?? {}));
                        if (scripts.size === 0) return out;
                        const content = readFileSync(projectMemoryPath(projectDir), "utf8");
                        let inSection = false;
                        for (const line of content.split(/\r?\n/)) {
                                if (/^##\s/.test(line)) {
                                        inSection = true;
                                        continue;
                                }
                                if (!inSection) continue;
                                if (/^##\s+Manual notes/.test(line)) break; // the user's own lane is never "derivable noise"
                                const bullet = line.trim().replace(/^[-*]\s+/, "");
                                if (!bullet) continue;
                                const body = bullet.replace(/·\s*[\d-]+\s*(·\s*(stale|superseded))?$/, "").trim();
                                // "run <script>…" where <script> is a package.json script — the
                                // model already reads package.json; the bullet is noise
                                const m = /^run\s+([\w:-]+)/i.exec(body);
                                if (m && scripts.has(m[1])) out.push(body.slice(0, 100));
                        }
                } catch {
                        /* unreadable — degrade to absent */
                }
                return out;
        }
}

/** Render the report for the terminal (the ✓/⚠/✗ lines + the summary). */
export function renderMemoryDoctorReport(report: MemoryDoctorReport): string {
        const mark = (s: MemoryDoctorFinding["severity"]) => (s === "ok" ? "✓" : s === "warn" ? "✗" : "·");
        const lines: string[] = [];
        lines.push(`memory doctor — ${report.project}`);
        lines.push(`engine ${report.engine === "up" ? "up (store audited)" : "down (store audit skipped — unown engine start)"}`);
        lines.push("");
        for (const f of report.findings) {
                lines.push(`${mark(f.severity)} ${f.class}: ${f.detail}`);
                if (f.remedy) lines.push(`    → ${f.remedy}`);
        }
        const warns = report.findings.filter((f) => f.severity === "warn").length;
        lines.push("");
        lines.push(
                warns > 0
                        ? `${warns} item(s) need attention · decide with /memory review, /memory search --all, or the dashboard Memory screen`
                        : "memory is healthy — nothing needs attention",
        );
        return lines.join("\n");
}
