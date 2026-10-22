/**
 * budget.ts — hard-sum budget on the resolved memory block, with a
 * degradation policy (review §5.2... no: §5.5; strategy §4.8).
 *
 * What shipped before: per-tier caps (PI_MEMORY_MAX_TIER_CHARS, 48k) bound
 * each tier, but the SUM of the four tiers + guide + wrappers could still
 * blow the context-window budget the strategy demands (~20k tokens for the
 * whole block). This module enforces the total:
 *
 *   PI_MEMORY_TOTAL_CHARS (default 80,000 ≈ 20k tokens) on the resolved
 *   block injected into the agent's system prompt — on BOTH injection
 *   surfaces (engine runner via memory.ts, terminal via term.ts).
 *
 * Degradation policy (deterministic, lossless-at-rest):
 *   1. NEVER prune the guide or the policy tier (guardrails) — pruning
 *      guardrails to save budget would be a self-inflicted F4.
 *   2. Drop the OLDEST appendRules blocks first (blocks carry
 *      `<!-- author @ date — note -->` provenance headers; ties break by
 *      file position, earlier = older). The undated base of each tier
 *      (seed + dream rewrites) is kept while droppable blocks remain.
 *   3. If still over budget: head-truncate the prunable tiers (largest
 *      first) with a visible `<!-- budget: pruned ... -->` marker.
 *   4. Degenerate caps (smaller than the protected content) are reported
 *      honestly (truncated: true, overflowChars) rather than silently
 *      dropping guardrails.
 *
 * Pruning happens at INJECTION time only — the SQLite/file memory is never
 * modified, so nothing is lost at rest and the next session (after real
 * consolidation shrinks the tiers) sees the full content again.
 *
 * Store-free and import-light: both the engine and the terminal process
 * can use it without engine dependencies.
 */

export interface BudgetFile {
        path: string;
        content: string;
        tier?: string;
        /** Optional real filesystem path (M6 staleness stats ride it through
         *  pruneToBudget; inline content like the memory guide has none —
         *  callers default it to ""). */
        fsPath?: string;
}

export interface PrunedBlock {
        tier: string;
        note: string;
        date: string;
        chars: number;
}

export interface BudgetReport {
        cap: number;
        totalBefore: number;
        totalAfter: number;
        prunedBlocks: PrunedBlock[];
        truncatedTiers: string[];
        /** True when even full truncation could not reach the cap (protected content alone exceeds it). */
        overflow: boolean;
}

/** Hard sum budget for the whole resolved block (env-tunable). */
export function maxTotalChars(): number {
        const n = Number(process.env.PI_MEMORY_TOTAL_CHARS ?? 80_000);
        return Number.isFinite(n) && n > 0 ? n : 80_000;
}

/** Tiers never pruned: the guide (injection semantics) and policy (guardrails). */
const PROTECTED_TIERS = new Set(["guide", "policy"]);

const BLOCK_MARKER = /^<!--\s*(.+?)\s+@\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+—\s*(.*?)\s*-->/;

interface Block {
        tier: string;
        note: string;
        date: string;
        text: string;
        start: number;
        end: number; // half-open [start, end) in the tier content
}

/** Split a tier's content into (base + dated rule blocks). */
function findBlocks(tier: string, content: string): Block[] {
        const lines = content.split("\n");
        const blocks: Block[] = [];
        let current: Block | null = null;
        let lineStart = 0;
        for (const line of lines) {
                const m = line.match(BLOCK_MARKER);
                if (m) {
                        if (current) current.end = lineStart;
                        current = { tier, note: `${m[1]} — ${m[3]}`, date: m[2], text: "", start: lineStart, end: -1 };
                        blocks.push(current);
                }
                lineStart += line.length + 1;
        }
        if (current) current.end = content.length;
        for (const b of blocks) b.text = content.slice(b.start, b.end);
        return blocks.filter((b) => b.end > b.start);
}

/** Remove [start, end) ranges from a string and tidy blank runs. */
function cutRanges(content: string, ranges: Array<[number, number]>): string {
        if (ranges.length === 0) return content;
        const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
        let out = "";
        let cursor = 0;
        for (const [s, e] of sorted) {
                out += content.slice(cursor, s);
                cursor = Math.max(cursor, e);
        }
        out += content.slice(cursor);
        return out.replace(/\n{3,}/g, "\n\n");
}

/**
 * Enforce the budget on a resolved file set. `opts.cap` overrides the env
 * (tests); `opts.totalOverhead` accounts for wrappers the caller adds
 * around each file (provenance lines / <project_instructions> tags).
 */
export function pruneToBudget(
        files: BudgetFile[],
        opts: { cap?: number; totalOverhead?: number } = {},
): { files: BudgetFile[]; report: BudgetReport } {
        const cap = opts.cap ?? maxTotalChars();
        const overhead = opts.totalOverhead ?? 0;
        const total = (fs: BudgetFile[]) => fs.reduce((sum, f) => sum + f.path.length + f.content.length, 0) + overhead;
        const totalBefore = total(files);
        const report: BudgetReport = {
                cap,
                totalBefore,
                totalAfter: totalBefore,
                prunedBlocks: [],
                truncatedTiers: [],
                overflow: false,
        };
        if (totalBefore <= cap) return { files, report };

        // Pass 1: drop the oldest dated rule blocks (guide/policy exempt).
        const work = files.map((f) => ({ ...f, content: f.content }));
        const blocks: Block[] = [];
        for (const f of work) {
                if (f.tier && PROTECTED_TIERS.has(f.tier)) continue;
                blocks.push(...findBlocks(f.tier ?? "?", f.content));
        }
        blocks.sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1)); // oldest first
        const dropped = new Map<string, Array<[number, number]>>();
        for (const block of blocks) {
                if (total(work) <= cap) break;
                const ranges = dropped.get(block.tier) ?? [];
                ranges.push([block.start, block.end]);
                dropped.set(block.tier, ranges);
                report.prunedBlocks.push({ tier: block.tier, note: block.note, date: block.date, chars: block.text.length });
                const target = work.find((f) => (f.tier ?? "?") === block.tier);
                if (target) target.content = cutRanges(target.content, ranges);
        }
        if (total(work) <= cap) {
                report.totalAfter = total(work);
                return { files: work, report };
        }

        // Pass 2: head-truncate the prunable tiers to a fixpoint — largest
        // first, each step shedding exactly what is still needed (plus the
        // marker's own overhead), keeping a visible stub of every tier.
        const MARKER_OVERHEAD = 160; // headroom for the marker line's own chars
        const prunable = work.filter((f) => !(f.tier && PROTECTED_TIERS.has(f.tier)));
        let rounds = 0;
        while (total(work) > cap && rounds++ < 12) {
                const need = total(work) - cap;
                const candidates = prunable
                        .filter((f) => f.content.length > 200)
                        .sort((a, b) => b.content.length - a.content.length);
                if (candidates.length === 0) break; // every prunable tier is at its stub floor
                const f = candidates[0];
                const original = f.content.length;
                const shed = Math.min(original - 200, need + MARKER_OVERHEAD);
                f.content = `${f.content.slice(0, original - shed)}\n<!-- budget: pruned ${shed} of ${original} chars (PI_MEMORY_TOTAL_CHARS=${cap}) -->\n`;
                report.truncatedTiers.push(f.tier ?? f.path);
        }
        report.truncatedTiers = [...new Set(report.truncatedTiers)];
        if (total(work) > cap) report.overflow = true; // protected content + stubs alone exceed the cap
        report.totalAfter = total(work);
        return { files: work, report };
}
