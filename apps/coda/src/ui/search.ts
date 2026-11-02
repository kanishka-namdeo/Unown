/**
 * Coda UI — global search (Fuse path via the domain's buildSearcher).
 *
 * The empty-query contract lives in the domain: an empty query returns
 * the most-recently-updated items, not an error. Results render below
 * the toolbar; clicking a hit selects the note / scrolls the task.
 */

import { buildSearcher, type SearchHit } from "../domain/search";
import type { Note, Task } from "../domain/types";
import type { UI } from "./shell";

export function renderSearch(
  ui: UI,
  query: string,
  notes: Note[],
  tasks: Task[],
  onSelectNote: (id: string) => void,
  onOpenTask: (id: string) => void,
): void {
  const box = ui.searchResults;
  box.textContent = "";
  const q = query.trim();
  if (q === "") return; // empty query: no results panel, full lists show recency

  const searcher = buildSearcher(notes, tasks);
  const hits: SearchHit[] = searcher.search(q);

  if (hits.length === 0) {
    const empty = document.createElement("div");
    empty.className = "coda-search-empty";
    empty.textContent = `No matches for “${q}”.`;
    box.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "coda-search-list";
  for (const hit of hits) {
    const row = document.createElement("button");
    row.className = "coda-search-row";
    row.type = "button";
    if (hit.kind === "note") {
      row.textContent = `Note: ${hit.note.title || "(untitled)"}`;
      row.onclick = () => onSelectNote(hit.note.id);
    } else {
      row.textContent = `Task: ${hit.task.title}`;
      row.onclick = () => onOpenTask(hit.task.id);
    }
    list.append(row);
  }
  box.append(list);
}
