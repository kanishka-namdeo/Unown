/**
 * memory.ts — the tiered-memory view (F-7 chunk 2, the learning band).
 *
 * DOM-free render + pure helpers (the dreams.ts kin). Data comes from
 * the adapter seam ONLY (`adapter.memories()` via the memory route's
 * load helper, which merges GET /api/memory + /api/memory/health) —
 * the UI never fetches directly.
 *
 * Honesty rules (V-41 / E-02):
 *   - zero tiers → the honest empty list ("no tiers yet"), never a
 *     seeded placeholder.
 *   - the health card renders the DEGRADED lane when the health call
 *     failed (available=false, empty backend/model): the card says so,
 *     a missing health object NEVER reads as a healthy one.
 *   - the tier content previews the first ~200 chars inside an
 *     expandable details/summary (keyboard accessible).
 */
import type {
  MemoryView,
  MemoryTier,
  MemoryHealthView,
} from "../adapter/engine-adapter.js";

export interface MemoryOptions {
  memory: MemoryView | null; // null = the load failed (the honest catch)
  /** The tier name the cursor sits on (optional). */
  selectedTier?: string | null;
}

/** The tier content preview: first ~200 chars (whitespace-collapsed),
 *  or the honest empty line. */
export function tierContentPreview(t: MemoryTier, limit = 200): string {
  const text = t.content.trim();
  if (text === "") return "(empty tier)";
  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1)}…`;
}

/** One tier row's HTML. data-tier carries the RAW tier name. */
export function renderTierRow(t: MemoryTier): string {
  const hasContent = t.content.trim() !== "";
  const details = hasContent
    ? `<details class="fugue-tier-output" data-tier-output="${escapeHtml(t.tier)}"><summary class="fugue-tier-preview">${escapeHtml(tierContentPreview(t))}</summary><pre class="fugue-tier-output-full">${escapeHtml(t.content)}</pre></details>`
    : `<p class="fugue-tier-preview fugue-tier-output-empty">empty tier</p>`;
  return `<li class="fugue-tier-row" data-tier="${escapeHtml(t.tier)}" data-version="${t.version}">
    <span class="fugue-tier-name">${escapeHtml(t.tier)}</span>
    <span class="fugue-tier-version">v${t.version}</span>
    <span class="fugue-tier-chars">${t.chars} chars</span>
    ${details}
  </li>`;
}

/** The health card HTML. The degraded lane (available=false, empty
 *  backend) carries an honest "health unavailable" line instead of
 *  pretending the numbers are live (the E-02 honesty law). */
export function renderHealthCard(h: MemoryHealthView): string {
  const degraded = !h.available || h.backend === "";
  const warningsList =
    h.warnings.length > 0
      ? `<ul class="fugue-memory-warnings">${h.warnings
          .map((w) => `<li class="fugue-memory-warning">${escapeHtml(w)}</li>`)
          .join("\n")}</ul>`
      : "";
  const lastReconcile =
    h.lastReconcile > 0 ? new Date(h.lastReconcile).toISOString() : "never";
  return `<div class="fugue-health-card" data-healthy="${degraded ? "false" : "true"}">
    <h3>Memory health</h3>
    ${degraded ? `<p class="fugue-health-degraded">health unavailable (the /api/memory/health lane failed or the platform is off)</p>` : ""}
    <dl class="fugue-health-stats">
      <div><dt>backend</dt><dd>${escapeHtml(h.backend || "—")}</dd></div>
      <div><dt>model</dt><dd>${escapeHtml(h.model || "—")}</dd></div>
      <div><dt>memories</dt><dd>${h.memoryCount}</dd></div>
      <div><dt>duplicates</dt><dd>${h.duplicateCount}</dd></div>
      <div><dt>conflicts</dt><dd>${h.conflictCount}</dd></div>
      <div><dt>max rendered</dt><dd>${h.maxRendered}</dd></div>
      <div><dt>last reconcile</dt><dd>${escapeHtml(lastReconcile)}</dd></div>
    </dl>
    ${warningsList}
  </div>`;
}

/** Render the full memory view HTML. `memory === null` → the honest
 *  load-failed panel (the E-02 law, the loadMemory catch lane). */
export function renderMemory(opts: MemoryOptions): string {
  const { memory, selectedTier = null } = opts;
  if (memory === null) {
    return `<section class="fugue-route" data-route="memory" aria-label="Memory"><div class="fugue-panel fugue-panel-error" data-panel="memory-load-failed"><h2>Memory load failed</h2><p class="fugue-panel-body">The /api/memory lane rejected or failed. Nothing was silently substituted — retry when the engine is reachable.</p></div></section>`;
  }
  const sel = selectedTier !== null ? ` data-selected="${escapeHtml(selectedTier)}"` : "";
  const tiersHtml =
    memory.tiers.length === 0
      ? `<p class="fugue-tier-empty">no tiers yet</p>`
      : `<ul class="fugue-tiers">${memory.tiers.map(renderTierRow).join("\n")}</ul>`;
  return `<section class="fugue-route" data-route="memory" aria-label="Memory"${sel}>
    <h2>Memory</h2>
    <p class="fugue-memory-meta">${memory.tiers.length} tier${memory.tiers.length === 1 ? "" : "s"} · ${memory.health.memoryCount} memories</p>
    ${tiersHtml}
    ${renderHealthCard(memory.health)}
  </section>`;
}

/** Build the view model (the dreams kin: flat tier names + selection). */
export function memoryViewModel(opts: MemoryOptions) {
  const memory = opts.memory;
  const tierNames: string[] = memory ? memory.tiers.map((t) => t.tier) : [];
  let selectedIndex = -1;
  if (memory && opts.selectedTier !== null && opts.selectedTier !== undefined) {
    tierNames.forEach((name, i) => {
      if (name === opts.selectedTier) selectedIndex = i;
    });
  }
  return {
    totalTiers: tierNames.length,
    tierNames,
    selectedIndex,
  };
}

/** Move the cursor one step over the tier rows (the arrow-key
 *  navigation, DOM-free). */
export function moveTierSelection(current: number, total: number, dir: 1 | -1): number {
  const next = current + dir;
  if (next < 0) return 0;
  if (next >= total) return total - 1;
  return next;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
