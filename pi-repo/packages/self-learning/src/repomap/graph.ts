/**
 * graph.ts — the reference graph + definition ranking (aider's repomap
 * core, ported). Pure: no fs, no pi imports, deterministic.
 *
 * Edge direction matters: edges point REFERENCER → DEFINER — rank flows
 * toward files that define things others use (a repo's "load-bearing"
 * files), which is the opposite of the intuitive "imports" direction.
 *
 * Aider's weight multipliers (repomap.py get_ranked_tags), preserved:
 *   ×10   the ident was mentioned by the user (mentionedIdents)
 *   ×10   the ident "looks meaningful" (snake/kebab/camel, ≥8 chars)
 *   ×0.1  the ident starts with `_` (private noise)
 *   ×0.1  the ident is defined in >5 files (ubiquitous: `run`, `get`, …)
 *   ×50   the REFERENCER is a chat file (files already in context get to
 *         nominate what they depend on)
 *   refs  edge weight also scales with sqrt(reference count) — damp high-
 *         frequency mentions
 *   0.1   self-edge for defs that nothing references (keep them ranked)
 *   swap  if the repo produced ZERO references, references := defines (a
 *         defs-only repo still yields a well-defined graph)
 */

import type { Tag } from "./tags.ts";
import { looksMeaningful } from "./tags.ts";

/** The digestible graph: merged multi-edges with per-ident weights. */
export interface RefGraph {
        /** All files that produced tags (graph nodes). */
        files: string[];
        /** src → (dst → (ident → weight)). */
        edges: Map<string, Map<string, Map<string, number>>>;
        /** Sum of out-edge weights per node (PageRank normalizer). */
        outSum: Map<string, number>;
        /** (file, ident) → the def tags for that definition site. */
        definitions: Map<string, Tag[]>;
        /** PageRank personalization (already a full vector over `files`). */
        personalization: Map<string, number>;
}

export interface GraphOptions {
        /** Files already "in the chat" (context files): their refs get the ×50
         * multiplier and their OWN defs are skipped at render time. */
        chatFiles?: Set<string>;
        /** Files mentioned by the user (personalization boost). */
        mentionedFiles?: Set<string>;
        /** Identifiers mentioned by the user (edge ×10 + personalization by
         * path-component match). */
        mentionedIdents?: Set<string>;
}

const KEY = (file: string, ident: string) => `${file}\0${ident}`;

/** Add (or merge) one weighted, identified edge. */
function addEdge(g: RefGraph, src: string, dst: string, ident: string, weight: number): void {
        let byDst = g.edges.get(src);
        if (!byDst) {
                byDst = new Map();
                g.edges.set(src, byDst);
        }
        let byIdent = byDst.get(dst);
        if (!byIdent) {
                byIdent = new Map();
                byDst.set(dst, byIdent);
        }
        byIdent.set(ident, (byIdent.get(ident) ?? 0) + weight);
        g.outSum.set(src, (g.outSum.get(src) ?? 0) + weight);
}

/** Build the reference graph from tags (pure, deterministic: Map iteration
 * order follows insertion, which follows tag order — stable for a stable
 * file list). */
export function buildRefGraph(files: string[], tags: Tag[], opts: GraphOptions = {}): RefGraph {
        const chatFiles = opts.chatFiles ?? new Set<string>();
        const mentionedFiles = opts.mentionedFiles ?? new Set<string>();
        const mentionedIdents = opts.mentionedIdents ?? new Set<string>();

        const defines = new Map<string, Set<string>>();
        const references = new Map<string, string[]>();
        const definitions = new Map<string, Tag[]>();
        const fileSet = new Set<string>(files);

        for (const tag of tags) {
                fileSet.add(tag.relFname);
                if (tag.kind === "def") {
                        let d = defines.get(tag.name);
                        if (!d) {
                                d = new Set();
                                defines.set(tag.name, d);
                        }
                        d.add(tag.relFname);
                        const key = KEY(tag.relFname, tag.name);
                        const list = definitions.get(key);
                        if (list) list.push(tag);
                        else definitions.set(key, [tag]);
                } else {
                        const list = references.get(tag.name);
                        if (list) list.push(tag.relFname);
                        else references.set(tag.name, [tag.relFname]);
                }
        }
        // Sort each definition site by line (aider renders them in file order).
        for (const list of definitions.values()) {
                list.sort((a, b) => a.line - b.line);
        }

        // The zero-refs repo: references := defines (every defining file
        // "references" its own def) — keeps PageRank well-defined.
        if (references.size === 0) {
                for (const [name, dfiles] of defines) {
                        references.set(name, [...dfiles]);
                }
        }

        const graph: RefGraph = {
                files: [...fileSet],
                edges: new Map(),
                outSum: new Map(),
                definitions,
                personalization: new Map(),
        };

        // Reference edges with aider's multipliers.
        for (const [ident, referencers] of references) {
                const definers = defines.get(ident);
                if (!definers || definers.size === 0) continue;
                let useMul = 1;
                if (mentionedIdents.has(ident)) useMul *= 10;
                if (looksMeaningful(ident)) useMul *= 10;
                if (ident.startsWith("_")) useMul *= 0.1;
                if (definers.size > 5) useMul *= 0.1;
                const numRefs = Math.sqrt(referencers.length);
                for (const referencer of referencers) {
                        const mul = chatFiles.has(referencer) ? useMul * 50 : useMul;
                        for (const definer of definers) {
                                addEdge(graph, referencer, definer, ident, mul * numRefs);
                        }
                }
        }

        // Self-edges for defs whose ident has no references (still absent from
        // the references map — the zero-refs swap above already handled the
        // fully-degenerate repo, making this a no-op there).
        for (const [name, dfiles] of defines) {
                if (references.has(name)) continue;
                for (const f of dfiles) addEdge(graph, f, f, name, 0.1);
        }

        // Personalization: chat/mentioned files, plus files whose path
        // components match a mentioned ident (aider's filename↔ident matching;
        // stems shorter than 5 chars don't count — too ambiguous).
        const personalize = 100 / Math.max(1, graph.files.length);
        for (const file of graph.files) {
                if (chatFiles.has(file) || mentionedFiles.has(file)) {
                        graph.personalization.set(file, personalize);
                        continue;
                }
                const base = file.slice(file.lastIndexOf("/") + 1);
                const stem = base.slice(0, base.lastIndexOf(".") !== -1 ? base.lastIndexOf(".") : undefined);
                const parts = [...file.split("/").slice(0, -1), base, stem].filter((p) => p.length >= 5);
                if (parts.some((p) => mentionedIdents.has(p))) {
                        graph.personalization.set(file, personalize);
                }
        }

        return graph;
}

// ---------------------------------------------------------------------------
// PageRank (networkx's fixed point, ported — see the research: d=0.85,
// max_iter 1000/tol 1e-6 in networkx; 40 iterations is far past convergence
// for file-count graphs, and the L1 early-exit keeps it exact).
// ---------------------------------------------------------------------------

export interface PageRankOptions {
        damping?: number;
        maxIterations?: number;
        tolerance?: number;
}

/** Personalized PageRank with dangling mass routed back into the
 * personalization vector (networkx `dangling=personalization` semantics —
 * aider's exact call). Unpersonalized nodes carry the uniform 1/N default
 * (the semantics aider's code comment cites). Deterministic. */
export function pagerank(g: RefGraph, opts: PageRankOptions = {}): Map<string, number> {
        const d = opts.damping ?? 0.85;
        const maxIter = opts.maxIterations ?? 40;
        const tol = opts.tolerance ?? 1e-6;
        const n = g.files.length;
        if (n === 0) return new Map();

        // Full personalization vector: explicit boosts + uniform floor.
        const p = new Map<string, number>();
        let pSum = 0;
        for (const f of g.files) {
                const v = g.personalization.get(f) ?? 1 / n;
                p.set(f, v);
                pSum += v;
        }
        if (pSum <= 0) {
                for (const f of g.files) p.set(f, 1 / n);
                pSum = 1;
        }
        for (const [f, v] of p) p.set(f, v / pSum);

        let x = new Map<string, number>();
        for (const f of g.files) x.set(f, 1 / n);

        for (let iter = 0; iter < maxIter; iter++) {
                const xNew = new Map<string, number>();
                for (const f of g.files) xNew.set(f, (1 - d) * (p.get(f) ?? 0));
                let sinkMass = 0;
                for (const [src, byDst] of g.edges) {
                        const out = g.outSum.get(src) ?? 0;
                        const xu = x.get(src) ?? 0;
                        if (out <= 0) {
                                sinkMass += xu;
                                continue;
                        }
                        for (const [dst, byIdent] of byDst) {
                                let edgeSum = 0;
                                for (const w of byIdent.values()) edgeSum += w;
                                xNew.set(dst, (xNew.get(dst) ?? 0) + d * xu * (edgeSum / out));
                        }
                }
                // Dangling redistribution into the personalization set.
                if (sinkMass > 0) {
                        for (const f of g.files) xNew.set(f, (xNew.get(f) ?? 0) + d * sinkMass * (p.get(f) ?? 0));
                }
                // L1 convergence check.
                let l1 = 0;
                for (const f of g.files) l1 += Math.abs((xNew.get(f) ?? 0) - (x.get(f) ?? 0));
                x = xNew;
                if (l1 < tol) break;
        }
        // Normalize the final vector.
        let sum = 0;
        for (const v of x.values()) sum += v;
        if (sum > 0) for (const [f, v] of x) x.set(f, v / sum);
        return x;
}

// ---------------------------------------------------------------------------
// Ranking (aider's post-PageRank distribution)
// ---------------------------------------------------------------------------

/** One ranked definition site: (file, ident) with its tags and score. */
export interface RankedDef {
        file: string;
        ident: string;
        rank: number;
}

/** Convenience: PageRank + distribution in one call. */
export function rankGraph(g: RefGraph, prOpts?: PageRankOptions): RankedDef[] {
        const x = pagerank(g, prOpts);
        return rankDefinitionsWith(g, x);
}

/** Distribute each node's PageRank across its out-edges proportionally to
 * weight, accumulating into (dst, ident) buckets — then sort descending by
 * (rank, (file, ident)), aider's exact ordering (ascending sort, reversed
 * — ties break by file+ident DESCENDING, which keeps output stable for a
 * stable graph). Pure. */
export function rankDefinitionsWith(g: RefGraph, x: Map<string, number>): RankedDef[] {
        const ranked = new Map<string, number>();
        for (const [src, byDst] of g.edges) {
                const out = g.outSum.get(src) ?? 0;
                const xu = x.get(src) ?? 0;
                if (out <= 0 || xu <= 0) continue;
                for (const [dst, byIdent] of byDst) {
                        for (const [ident, w] of byIdent) {
                                const key = KEY(dst, ident);
                                ranked.set(key, (ranked.get(key) ?? 0) + xu * (w / out));
                        }
                }
        }
        const out: RankedDef[] = [];
        for (const [key, rank] of ranked) {
                const sep = key.indexOf("\0");
                out.push({ file: key.slice(0, sep), ident: key.slice(sep + 1), rank });
        }
        out.sort((a, b) => a.rank - b.rank || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || (a.ident < b.ident ? -1 : a.ident > b.ident ? 1 : 0));
        out.reverse();
        return out;
}
