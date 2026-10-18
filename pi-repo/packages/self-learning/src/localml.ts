/**
 * localml.ts — the verified NON-LLM dream-input lanes, wired into AutoDream
 * (H15 integration; evidence: benchmarks/nonllm H9-H14 + the campaign-1 rerun,
 * cross-platform CI run 39156669131, local Bun+Node).
 *
 * WHAT THIS IS: pre-processors around the UNCHANGED LLM call. None of these
 * lanes replace a generation call; they dedup / order / compress the note
 * inputs BEFORE the dream prompt is assembled. Every lane is individually
 * disableable, all are OFF by default (unset = byte-identical prompts), and
 * the whole stack degrades gracefully:
 *
 *   PI_NOTE_DEDUP=union    near-dup collapse: MinHash est-Jaccard >= 0.5 OR
 *                          bge cosine >= 0.92 (embedding tier only when the
 *                          optional local-ml package is installed; without it
 *                          the lane is MinHash-only — the structural tier that
 *                          measured 100% recall on perturbation-class dups at
 *                          0.18ms/doc; the cosine tier exists for the
 *                          paraphrase class, N2 receipts).
 *   PI_MEMORY_RANK=activation
 *                          no-recency activation ordering (the N4 recipe:
 *                          relevance x log-frequency x structural, recency as
 *                          tiebreaker — Park-2023 recency decay measured
 *                          ANTI-correlated with consolidation value here).
 *   PI_DREAM_CURATE=hybrid top-30% activation-ranked notes full + LexRank-
 *                          compressed tail (the N5-hybrid shape: 19.9% prompt
 *                          token cut, judge-preferred over full).
 *   PI_LOCAL_ML=shadow     shadow mode: lanes COMPUTE and REPORT (bus events
 *                          + receipts) but the assembled prompt stays
 *                          byte-identical to the unset path — the registry's
 *                          "shadow-mode replay before any cutover" gate.
 *   PI_LOCAL_ML=1|live     live mode: lanes alter the dream input.
 *   PI_LOCAL_ML_DIR        where the optional embedding sub-package lives
 *                          (default: <this package>/local-ml — NOT a bun
 *                          workspace member, so the repo stays
 *                          native-addon-free; install it with npm install
 *                          inside that dir).
 *
 * GUARDS (binding):
 *   - Guard banners (§5.3) are prepended by the CALLER after lanes run, so
 *     curation can never touch them; compression also always keeps the first
 *     line (run header carries the outcome facts).
 *   - The "other" note kind has no exemplars — kNN triage (H10) is NOT wired
 *     into ingestion by this change; it stays bench-verified only.
 *   - Deterministic: MinHash permutations and LexRank are seeded — same
 *     input, same output, every run.
 *
 * Ported from benchmarks/nonllm/lib/{minhash,lexrank,activation}.mjs with
 * the verified parameters; keep them in sync (bench is the evidence holder).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { emit } from "./bus.ts";

// ---------------------------------------------------------------- config

/** Call-time env reads (the mint-cascade / llm.ts bridgeUrl pattern). */
export function localmlConfig(env: NodeJS.ProcessEnv = process.env) {
        const modeRaw = String(env.PI_LOCAL_ML ?? "").trim().toLowerCase();
        const mode: "off" | "shadow" | "live" =
                modeRaw === "shadow" ? "shadow" : modeRaw === "1" || modeRaw === "live" ? "live" : "off";
        return {
                mode,
                dedup: String(env.PI_NOTE_DEDUP ?? "").trim().toLowerCase() === "union",
                rank: String(env.PI_MEMORY_RANK ?? "").trim().toLowerCase() === "activation",
                curate: String(env.PI_DREAM_CURATE ?? "").trim().toLowerCase() === "hybrid",
                dir: String(env.PI_LOCAL_ML_DIR ?? "").trim() || join(import.meta.dirname, "..", "local-ml"),
        };
}

// ---------------------------------------------------------------- MinHash

const MH_K = 3;
const MH_PERMS = 128;
const MH_BANDS = 16;

function mhTokenize(text: string): string[] {
        return String(text ?? "")
                .toLowerCase()
                .replace(/`{3}[\s\S]*?`{3}/g, " ")
                .split(/[^a-z0-9_+#.-]+/)
                .filter((w) => w.length > 1 && !/^[.-]+$/.test(w));
}

function shingles(text: string, k = MH_K): Set<string> {
        const words = mhTokenize(text);
        const kk = words.length >= k ? k : Math.max(1, words.length);
        const out = new Set<string>();
        for (let i = 0; i + kk <= words.length; i++) out.add(words.slice(i, i + kk).join(" "));
        if (words.length) out.add(words.join(" "));
        return out;
}

function fnv1a(s: string): number {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
}

function mulberry32(seed: number): () => number {
        let a = seed >>> 0;
        return () => {
                a |= 0;
                a = (a + 0x6d2b79f5) | 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
}

const MH_PERM_TABLE = (() => {
        const rand = mulberry32(0x9e3779b9);
        const a = new Uint32Array(MH_PERMS);
        const b = new Uint32Array(MH_PERMS);
        for (let i = 0; i < MH_PERMS; i++) {
                a[i] = (Math.floor(rand() * 0xfffffff) * 2 + 1) >>> 0;
                b[i] = Math.floor(rand() * 0xffffffff) >>> 0;
        }
        return { a, b };
})();

/** MinHash signature (deterministic across runs — seeded permutations). */
function minhashSig(text: string): Uint32Array {
        const base = [...shingles(text)].map(fnv1a);
        const sig = new Uint32Array(MH_PERMS);
        for (let i = 0; i < MH_PERMS; i++) {
                let m = 0xffffffff;
                for (const x of base) {
                        const h = (Math.imul(x, MH_PERM_TABLE.a[i]) + MH_PERM_TABLE.b[i]) >>> 0;
                        if (h < m) m = h;
                }
                sig[i] = m;
        }
        return sig;
}

/** Estimated Jaccard via signature agreement (estMAE 0.020 vs exact, N2). */
function estJaccard(s1: Uint32Array, s2: Uint32Array): number {
        let eq = 0;
        for (let i = 0; i < s1.length; i++) if (s1[i] === s2[i]) eq++;
        return eq / s1.length;
}

/**
 * UNION near-dup detection over note contents (N2's production shape):
 * pairs with est-Jaccard >= 0.5 (structural tier, always available) OR
 * cosine >= 0.92 (semantic tier, only when an embedder is supplied — the
 * paraphrase class). Returns pairs of indices.
 */
export function nearDupPairs(
        texts: string[],
        opts: { minHashThreshold?: number; cosineThreshold?: number; embed?: (t: string) => number[] | null } = {},
): Array<[number, number, number]> {
        const mh = opts.minHashThreshold ?? 0.5;
        const ct = opts.cosineThreshold ?? 0.92;
        const sigs = texts.map((t) => minhashSig(t));
        const vecs = opts.embed ? texts.map((t) => opts.embed!(t)) : null;
        const out: Array<[number, number, number]> = [];
        for (let i = 0; i < texts.length; i++) {
                for (let j = i + 1; j < texts.length; j++) {
                        const est = estJaccard(sigs[i], sigs[j]);
                        if (est >= mh) {
                                out.push([i, j, est]);
                                continue;
                        }
                        if (vecs && vecs[i] && vecs[j]) {
                                const c = cosine32(vecs[i]!, vecs[j]!);
                                if (c >= ct) out.push([i, j, c]);
                        }
                }
        }
        return out;
}

// ---------------------------------------------------------------- LexRank

const STOPWORDS = new Set(
        "a an the and or but if then else when while of to in on at for with without from by as is are was were be been being this that these those it its his her their our your my i we you they he she them us not no nor so too very can will just should now do does did done have has had having about into over under again further once here there all any both each few more most other some such only own same than s t d ll m o re ve y".split(
                /\s+/,
        ),
);

function splitSentences(text: string): string[] {
        return String(text ?? "")
                .replace(/```[\s\S]*?```/g, (m) => m.replace(/\n/g, " "))
                .split(/(?<=[.!?])\s+|\n+/)
                .map((s) => s.trim())
                .filter((s) => s.length > 8);
}

function lrTokens(s: string): string[] {
        return String(s)
                .toLowerCase()
                .split(/[^a-z0-9_+#.-]+/)
                .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^[.-]+$/.test(w));
}

/**
 * Compress a session note for dream input (the N5 lane): LexRank top
 * sentences + first line, with a floor so nothing collapses to nothing.
 * Returns { text, kept, total }.
 */
export function compressNote(text: string, topK = 2, minRatio = 0.35): { text: string; kept: number; total: number } {
        const firstLine = String(text ?? "").split("\n")[0] ?? "";
        const sentences = splitSentences(text);
        if (sentences.length === 0) return { text: String(text ?? ""), kept: 0, total: 0 };

        // --- LexRank (IDF-modified cosine + power iteration, d=0.85)
        const n = sentences.length;
        if (n === 1) return { text: firstLine, kept: 1, total: 1 };
        const df = new Map<string, number>();
        const perSent = sentences.map((s) => new Set(lrTokens(s)));
        for (const set of perSent) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
        const vecs = sentences.map((s) => {
                const v = new Map<string, number>();
                for (const t of lrTokens(s)) {
                        const d = df.get(t) ?? 1;
                        v.set(t, (v.get(t) ?? 0) + Math.log((1 + n) / (1 + d)) + 1);
                }
                let norm = 0;
                for (const x of v.values()) norm += x * x;
                norm = Math.sqrt(norm) || 1;
                for (const [k, x] of v) v.set(k, x / norm);
                return v;
        });
        const sim: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
        const rowSum = new Float64Array(n);
        for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                        if (i === j) continue;
                        let dot = 0;
                        const [small, big] = vecs[i]!.size < vecs[j]!.size ? [vecs[i]!, vecs[j]!] : [vecs[j]!, vecs[i]!];
                        for (const [k, x] of small) {
                                const y = big.get(k);
                                if (y !== undefined) dot += x * y;
                        }
                        sim[i]![j] = dot;
                        rowSum[i]! += dot;
                }
        }
        const damping = 0.85;
        let p = new Float64Array(n).fill(1 / n);
        for (let it = 0; it < 30; it++) {
                const next = new Float64Array(n);
                for (let j = 0; j < n; j++) {
                        let acc = (1 - damping) / n;
                        for (let i = 0; i < n; i++) {
                                if (i === j) continue;
                                const pij = rowSum[i]! > 0 ? (damping * sim[i]![j]!) / rowSum[i]! : damping / n;
                                acc += p[i]! * pij;
                        }
                        next[j] = acc;
                }
                let delta = 0;
                for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(next[i]! - p[i]!));
                p = next;
                if (delta < 1e-6) break;
        }
        const ranked = sentences
                .map((sentence, index) => ({ index, sentence, score: p[index]! }))
                .sort((a, b) => b.score - a.score);

        // --- selection: first line + topK, floored
        const keep = new Set<string>([firstLine]);
        for (const r of ranked.slice(0, topK)) keep.add(r.sentence);
        let chosen = sentences.filter((s) => keep.has(s));
        const floor = Math.max(1, Math.round(sentences.length * minRatio));
        if (chosen.length < floor) chosen = sentences.slice(0, floor);
        return { text: chosen.join("\n"), kept: chosen.length, total: sentences.length };
}

// ---------------------------------------------------------------- activation

/** Structural importance (the N4 non-LLM importance proxy). */
export function structuralScore(content: string): number {
        const text = String(content ?? "");
        let s = 0.35;
        if (/\bpas(s|ed|ses)\b|\bfail(ed|ure)?\b|\berror\b/i.test(text)) s += 0.25;
        if (/\bPASSED\b|\bFAILED\b|\bERROR\b/.test(text)) s += 0.1;
        if (/\btool\b|\bbash\b|\btest/i.test(text)) s += 0.1;
        if (text.length > 400) s += 0.1;
        if (text.length < 80) s -= 0.15;
        return Math.max(0, Math.min(1, s));
}

function relevanceFromCosine(cos: number | null): number {
        if (cos === null || Number.isNaN(cos)) return 0.5;
        return Math.max(0, Math.min(1, (cos + 1) / 2));
}

/**
 * The N4 no-recency activation recipe: relevance (cosine to the goal when an
 * embedder is supplied, else neutral 0.5) x log-frequency (caller-supplied
 * `freq`, log-scaled) x structural, recency as tiebreaker only. Returns
 * scores per note index, higher = dream earlier / keep full.
 */
export function activationScores(
        notes: Array<{ content: string; created_at?: number; freq?: number }>,
        opts: { goalEmbedding?: number[] | null; embed?: (t: string) => number[] | null } = {},
): number[] {
        const maxFreq = Math.max(0, ...notes.map((n) => n.freq ?? 0));
        const rows = notes.map((n) => {
                let relevance = 0.5;
                if (opts.goalEmbedding && opts.embed) {
                        const emb = opts.embed(n.content);
                        if (emb) relevance = relevanceFromCosine(cosine32(emb, opts.goalEmbedding));
                }
                const frequency = maxFreq > 0 ? Math.log1p(n.freq ?? 0) / Math.log1p(maxFreq) : 0;
                const structural = structuralScore(n.content);
                return { relevance, frequency, structural, activation: 0.6 * (0.5 * relevance + 0.5 * frequency) + 0.4 * structural };
        });
        // recency as tiebreaker only: stable sort by activation desc, then newer first
        return notes.map((_, i) => rows[i]!.activation);
}

// ---------------------------------------------------------------- embedder

export interface Embedder {
        embed(text: string): number[] | null;
        backend: string;
}

let embedderCache: Embedder | null | undefined;

/**
 * The OPTIONAL ONNX embedding lane. The sub-package at PI_LOCAL_ML_DIR
 * (default <pkg>/local-ml, NOT a workspace member) owns the native deps;
 * it is installed on demand (npm install in that dir) and probed with a
 * guarded dynamic import — absent/failed = null and the symbolic lanes run
 * in their degraded (still-verified) shapes. Never throws.
 */
export async function getEmbedder(dir?: string): Promise<Embedder | null> {
        if (embedderCache !== undefined) return embedderCache;
        const cfg = localmlConfig();
        const root = dir ?? cfg.dir;
        try {
                if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "lib", "index.mjs"))) {
                        embedderCache = null;
                        return null;
                }
                const mod = (await import(`${root}/lib/index.mjs`)) as {
                        embedText?: (t: string) => Promise<{ ok: boolean; vec?: number[] }>;
                        backend?: string;
                };
                if (typeof mod.embedText !== "function") throw new Error("no embedText export");
                const backend = String(mod.backend ?? "local-ml");
                embedderCache = {
                        backend,
                        embed(text: string): number[] | null {
                                // synchronous surface over the async lane: callers on the dream
                                // path pre-warm via warmEmbedder; a cold miss returns null
                                // (degrades that one note's signal, never blocks the dream)
                                const warmed = warmedVectors.get(text);
                                if (warmed) return warmed;
                                void warmOne(mod, text);
                                return null;
                        },
                };
                await warmEmbedder(mod);
                return embedderCache;
        } catch (err) {
                emit("lane:embed", { ok: false, error: String((err as Error)?.message ?? err) });
                embedderCache = null;
                return null;
        }
}

const warmedVectors = new Map<string, number[]>();

async function warmEmbedder(mod: { embedText?: (t: string) => Promise<{ ok: boolean; vec?: number[] }> }) {
        try {
                if (typeof mod.embedText !== "function") return;
                const probe = await mod.embedText("warmup");
                if (probe?.ok && Array.isArray(probe.vec)) emit("lane:embed", { ok: true, backend: "local-ml" });
        } catch {
                /* warmup failure leaves the cache empty; lanes degrade */
        }
}

async function warmOne(mod: { embedText?: (t: string) => Promise<{ ok: boolean; vec?: number[] }> }, text: string) {
        try {
                const r = await mod.embedText!(text);
                if (r?.ok && Array.isArray(r.vec)) warmedVectors.set(text, r.vec);
        } catch {
                /* degrade */
        }
}

/** Reset embedder caches (tests). */
export function resetEmbedder() {
        embedderCache = undefined;
        warmedVectors.clear();
}

// ---------------------------------------------------------------- lanes

export interface DreamNoteInput {
        content: string;
        created_at?: number;
        run_id?: string | null;
        freq?: number;
        /** set by the lanes: index into the ORIGINAL input array (banner safety — the caller derives guard banners from the original note row, never from curated content) */
        origIndex?: number;
}

export interface LaneEvents {
        mode: "off" | "shadow" | "live";
        dedup?: { pairs: number; dropped: number; via: string };
        rank?: { reordered: boolean; scoresTop?: number };
        curate?: { notes: number; compressed: number; tokensBefore: number; tokensAfter: number };
        embedder?: string | null;
}

/**
 * Apply the enabled lanes to dream-input notes. Returns the processed notes
 * (live mode) or the originals (shadow/off), plus the lane events for the
 * bus receipt. Order: dedup -> rank -> curate. Guard banners are NOT in
 * content yet (caller prepends after), so curation cannot touch them.
 */
export async function applyDreamNoteLanes(
        notes: DreamNoteInput[],
        opts: { goalText?: string } = {},
): Promise<{ notes: DreamNoteInput[]; events: LaneEvents }> {
        const cfg = localmlConfig();
        const events: LaneEvents = { mode: cfg.mode };
        if (cfg.mode === "off" || !notes.length) return { notes, events };

        let working: DreamNoteInput[] = notes.map((n, i) => ({ ...n, origIndex: i }));

        // -- optional embedding lane (async warm, then sync use)
        let embed: ((t: string) => number[] | null) | undefined;
        if ((cfg.dedup || cfg.rank) && existsSync(join(cfg.dir, "package.json"))) {
                const emb = await getEmbedder(cfg.dir);
                if (emb) {
                        embed = (t: string) => emb.embed(t);
                        events.embedder = emb.backend;
                        // pre-warm all note vectors + the goal vector so the sync
                        // surface below returns real values
                        const texts = working.map((n) => n.content);
                        const mod = await import(`${cfg.dir}/lib/index.mjs`).catch(() => null);
                        if (mod && typeof mod.embedText === "function") {
                                for (const t of texts) await warmOne(mod, t);
                                if (opts.goalText) {
                                        const g = await mod.embedText(opts.goalText).catch(() => null);
                                        if (g?.ok && Array.isArray(g.vec)) warmedVectors.set(opts.goalText, g.vec);
                                }
                        }
                }
        }
        const goalEmbedding = opts.goalText ? warmedVectors.get(opts.goalText) ?? null : null;
        events.embedder = events.embedder ?? null;

        // -- 1) dedup (union: MinHash structural + optional cosine)
        if (cfg.dedup) {
                const texts = working.map((n) => n.content);
                const pairs = nearDupPairs(texts, { embed });
                const drop = new Set<number>();
                for (const [i, j] of pairs) drop.add(j); // keep the earlier note
                if (drop.size) {
                        events.dedup = {
                                pairs: pairs.length,
                                dropped: drop.size,
                                via: embed ? "minhash+cosine-union" : "minhash-only (no local-ml)",
                        };
                        working = working.filter((_, i) => !drop.has(i));
                }
        }

        // -- 2) activation ranking (no-recency recipe; recency tiebreaker)
        if (cfg.rank) {
                const scores = activationScores(working, { goalEmbedding, embed });
                const order = working.map((_, i) => i);
                const created = working.map((n) => n.created_at ?? 0);
                order.sort((a, b) => scores[b]! - scores[a]! || created[b]! - created[a]!);
                const reordered = order.some((v, i) => v !== i);
                working = order.map((i) => working[i]!);
                events.rank = { reordered, scoresTop: working.length ? scores[order[0]!] : undefined };
        }

        // -- 3) hybrid curation (top-30% full, tail compressed)
        if (cfg.curate) {
                const headCount = Math.max(1, Math.ceil(working.length * 0.3));
                let tokensBefore = 0;
                let tokensAfter = 0;
                let compressed = 0;
                working = working.map((n, i) => {
                        tokensBefore += Math.ceil(n.content.length / 4);
                        if (i < headCount) {
                                tokensAfter += Math.ceil(n.content.length / 4);
                                return n;
                        }
                        const c = compressNote(n.content);
                        tokensAfter += Math.ceil(c.text.length / 4);
                        if (c.total > 0 && c.kept < c.total) compressed++;
                        return { ...n, content: c.text };
                });
                events.curate = { notes: working.length, compressed, tokensBefore, tokensAfter };
        }

        // shadow mode: report on the ORIGINAL notes
        return { notes: cfg.mode === "shadow" ? notes : working, events };
}

function cosine32(a: number[], b: number[]): number {
        let dot = 0;
        let na = 0;
        let nb = 0;
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
                dot += a[i]! * b[i]!;
                na += a[i]! * a[i]!;
                nb += b[i]! * b[i]!;
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
