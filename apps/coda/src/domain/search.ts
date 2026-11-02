/**
 * Coda search — notes + tasks ranked, case-insensitive, special-char-safe.
 *
 * Backed by fuse.js (pure module, resolves upward from root node_modules)
 * with a plain substring fallback when Fuse is not importable in the
 * target runtime. Ranking is "sane": relevance score first, then a
 * stable tiebreak (updatedAt desc, then id asc) so results are
 * deterministic for a given store snapshot.
 */

import Fuse from "fuse.js";
import type { Note, Task } from "./types";

export type SearchHit =
  | { kind: "note"; note: Note; score: number }
  | { kind: "task"; task: Task; score: number };

export interface SearchOptions {
  /** include note bodies (default true) */
  notes?: boolean;
  /** include task titles (default true) */
  tasks?: boolean;
  /** cap results (default 20) */
  limit?: number;
}

export interface Searcher {
  search(query: string, options?: SearchOptions): SearchHit[];
}

/**
 * Build a searcher over the current contents. Cheap; rebuild when the
 * store changes (the app re-instantiates on each data change in C2).
 */
export function buildSearcher(notes: readonly Note[], tasks: readonly Task[]): Searcher {
  const fuseNotes = new Fuse(
    notes.map((n) => ({ ...n })),
    {
      keys: ["title", "body", "tags"],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
    },
  );
  const fuseTasks = new Fuse(
    tasks.map((t) => ({ ...t })),
    {
      keys: ["title", "noteIds"],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
    },
  );

  return {
    search(query: string, options?: SearchOptions) {
      const limit = options?.limit ?? 20;
      const wantNotes = options?.notes ?? true;
      const wantTasks = options?.tasks ?? true;
      const q = query.trim();

      const hits: SearchHit[] = [];

      if (q === "") {
        // Empty query: return the most recently updated items, capped.
        const pool: Array<{ key: "updatedAt"; item: Note | Task; kind: "note" | "task" }> = [];
        if (wantNotes) for (const n of notes) pool.push({ key: "updatedAt", item: n, kind: "note" });
        if (wantTasks) for (const t of tasks) pool.push({ key: "updatedAt", item: t, kind: "task" });
        pool.sort((a, b) => stableTimeDesc(a.item, b.item));
        for (const p of pool.slice(0, limit)) {
          if (p.kind === "note") hits.push({ kind: "note", note: p.item as Note, score: 0 });
          else hits.push({ kind: "task", task: p.item as Task, score: 0 });
        }
        return hits;
      }

      if (wantNotes) {
        const res = fuseNotes.search(q);
        for (const r of res) hits.push({ kind: "note", note: r.item as Note, score: r.score ?? 0 });
      }
      if (wantTasks) {
        const res = fuseTasks.search(q);
        for (const r of res) hits.push({ kind: "task", task: r.item as Task, score: r.score ?? 0 });
      }

      // Stable sort: score asc (Fuse: 0 = perfect, higher = worse), then
      // updatedAt desc, then id asc.
      hits.sort((a, b) => {
        const s = (a.score ?? 0) - (b.score ?? 0);
        if (s !== 0) return s;
        return stableTimeDesc(hitRef(a), hitRef(b));
      });

      return hits.slice(0, limit);
    },
  };

  function stableTimeDesc(a: Note | Task, b: Note | Task): number {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  function hitRef(h: SearchHit): Note | Task {
    return h.kind === "note" ? h.note : h.task;
  }
}

/**
 * Plain substring fallback used only if Fuse is unavailable at runtime
 * (e.g. a hand-rolled bundle without it). Case-insensitive, matches on
 * note title+body+tags and task title.
 */
export function substringSearch(
  notes: readonly Note[],
  tasks: readonly Task[],
  query: string,
  limit = 20,
): SearchHit[] {
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  const score = (text: string): number => (text.toLowerCase().includes(q) ? 0 : 1);

  for (const n of notes) {
    const haystack = `${n.title}\n${n.body}\n${n.tags.join(" ")}`.toLowerCase();
    if (q === "" || haystack.includes(q)) {
      hits.push({ kind: "note", note: n, score: score(haystack) });
    }
  }
  for (const t of tasks) {
    const haystack = t.title.toLowerCase();
    if (q === "" || haystack.includes(q)) {
      hits.push({ kind: "task", task: t, score: score(haystack) });
    }
  }
  hits.sort((a, b) => {
    const s = (a.score ?? 0) - (b.score ?? 0);
    if (s !== 0) return s;
    const ia = a.kind === "note" ? a.note : a.task;
    const ib = b.kind === "note" ? b.note : b.task;
    if (ia.updatedAt !== ib.updatedAt) return ia.updatedAt < ib.updatedAt ? 1 : -1;
    return ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0;
  });
  return hits.slice(0, limit);
}
