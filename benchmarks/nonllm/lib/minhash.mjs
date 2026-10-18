/**
 * minhash.mjs — hand-rolled MinHash + LSH banding for near-duplicate detection
 * over session notes (research nonllm-memory.md Q5: no well-maintained pure-JS
 * MinHash library exists; ~100 LOC with typed arrays is the recommended lane).
 *
 * Method: word k-gram shingles -> 32-bit FNV-1a base hash -> K universal
 * permutations h_i(x) = (a_i*x + b_i) mod 2^32 (Math.imul wraparound) ->
 * signature of K minima. Jaccard is estimated by signature agreement; LSH
 * bands (b bands x r rows) bucket signatures so only candidate pairs that
 * share a band need a (cheap) exact check. datasketch documents 0.92-1.0
 * precision/recall bands on near-dup corpora at these parameters.
 */

const DEFAULTS = {
  k: 3, // word k-gram shingle size (notes are short: 3-grams, fallback 2)
  perms: 128, // signature length
  bands: 16, // 16 bands x 8 rows -> LSH threshold ~ (1/16)^(1/8) = 0.63
};

// ---------------------------------------------------------------- shingles

/** Tokenize for shingling: lowercase words (digits kept, punctuation dropped). */
export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/`{3}[\s\S]*?`{3}/g, " ") // strip fenced code blocks (structure, not content)
    .split(/[^a-z0-9_+#.-]+/)
    .filter((w) => w.length > 1 && !/^[.-]+$/.test(w));
}

/** Word k-gram shingles as strings (falls back to lower k for very short texts). */
export function shingles(text, k = DEFAULTS.k) {
  const words = tokenize(text);
  const kk = words.length >= k ? k : Math.max(1, words.length);
  const out = new Set();
  for (let i = 0; i + kk <= words.length; i++) out.add(words.slice(i, i + kk).join(" "));
  // Very short notes: also add the full text as one shingle so identical stubs match.
  if (words.length) out.add(words.join(" "));
  return out;
}

// ---------------------------------------------------------------- hashing

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) so signatures are reproducible run-to-run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Universal hash family params: h_i(x) = (a_i*x + b_i) >>> 0 (a odd, 32-bit). */
function makePerms(count, seed = 0x9e3779b9) {
  const rand = rng(seed);
  const a = new Uint32Array(count);
  const b = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    a[i] = (Math.floor(rand() * 0xfffffff) * 2 + 1) >>> 0; // odd
    b[i] = Math.floor(rand() * 0xffffffff) >>> 0;
  }
  return { a, b };
}

// ---------------------------------------------------------------- signatures

export class MinHasher {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.perms = makePerms(this.opts.perms);
  }

  /** MinHash signature (Uint32Array of length perms) of a text's shingle set. */
  signature(text) {
    const set = shingles(text, this.opts.k);
    const base = [...set].map(fnv1a);
    const sig = new Uint32Array(this.opts.perms);
    const { a, b } = this.perms;
    for (let i = 0; i < this.opts.perms; i++) {
      let m = 0xffffffff;
      for (const x of base) {
        const h = (Math.imul(x, a[i]) + b[i]) >>> 0;
        if (h < m) m = h;
      }
      sig[i] = m;
    }
    return { sig, size: base.length };
  }

  /** Estimated Jaccard similarity of two signatures (fraction of equal minima). */
  similarity(sig1, sig2) {
    let eq = 0;
    for (let i = 0; i < sig1.length; i++) if (sig1[i] === sig2[i]) eq++;
    return eq / sig1.length;
  }
}

/** Exact Jaccard over shingle sets (ground truth for calibration). */
export function exactJaccard(text1, text2, k = DEFAULTS.k) {
  const s1 = shingles(text1, k);
  const s2 = shingles(text2, k);
  if (!s1.size && !s2.size) return 1;
  if (!s1.size || !s2.size) return 0;
  let inter = 0;
  for (const x of s1) if (s2.has(x)) inter++;
  return inter / (s1.size + s2.size - inter);
}

// ---------------------------------------------------------------- LSH index

/**
 * LSH banding index: insert {id, text}, then candidatePairs(threshold) returns
 * id pairs sharing at least one band bucket. Threshold only gates the final
 * estimated-Jaccard check; banding itself is parameter-free (b x r sets it).
 */
export class LshIndex {
  constructor(hasher) {
    this.hasher = hasher ?? new MinHasher();
    this.bands = this.hasher.opts.bands;
    this.rows = this.hasher.opts.perms / this.hasher.opts.bands;
    this.buckets = new Map(); // band -> Map(bandHash -> ids[])
    this.items = new Map(); // id -> sig
  }

  insert(id, text) {
    const { sig } = this.hasher.signature(text);
    this.items.set(id, sig);
    for (let band = 0; band < this.bands; band++) {
      const key = this.bandKey(sig, band);
      const bandMap = this.buckets.get(band) ?? new Map();
      const ids = bandMap.get(key) ?? [];
      ids.push(id);
      bandMap.set(key, ids);
      this.buckets.set(band, bandMap);
    }
  }

  bandKey(sig, band) {
    const start = band * this.rows;
    let h = 0x9e3779b9;
    for (let i = start; i < start + this.rows; i++) {
      h = (Math.imul(h ^ sig[i], 0x85ebca6b) ^ (sig[i] >>> 13)) >>> 0;
    }
    return h.toString(36);
  }

  /** All candidate pairs (shared band), deduped, with estimated Jaccard >= threshold. */
  candidatePairs(threshold = 0) {
    const seen = new Set();
    const pairs = [];
    for (const [band, bandMap] of this.buckets) {
      for (const ids of bandMap.values()) {
        if (ids.length < 2) continue;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const key = ids[i] < ids[j] ? `${ids[i]}\u0000${ids[j]}` : `${ids[j]}\u0000${ids[i]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const est = this.hasher.similarity(this.items.get(ids[i]), this.items.get(ids[j]));
            if (est >= threshold) pairs.push({ a: ids[i], b: ids[j], est });
          }
        }
      }
    }
    return pairs;
  }
}

// ---------------------------------------------------------------- perturbations

/** Deterministic note perturbations used to SEED the near-dup evaluation corpus (N2). */
export function perturbations(text) {
  const sentences = String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines = String(text ?? "").split("\n");
  const out = {};

  if (sentences.length > 2) {
    out.dropSentence = sentences.slice(0, -1).join(" "); // drop last sentence
    out.shuffleSentences = [...sentences].reverse().join(" "); // reorder
  }
  if (lines.length > 3) {
    out.appendNoise = text + "\nLatency note: 2.1s wall clock on this run."; // append benign noise line
    out.dropLine = lines.filter((_, i) => i !== Math.floor(lines.length / 2)).join("\n"); // drop a middle line
  }
  return out; // caller labels each as a near-dup of the base note
}
