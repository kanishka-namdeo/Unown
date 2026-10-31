#!/usr/bin/env bun
/**
 * audit-registry.mjs — BM-7's static half + BM-4's coverage half: the
 * settings-registry audit, read from RUNTIME TRUTH (the real vendored
 * module), never from source regexes on our own registry.
 *
 * What it checks (the trust framework's data contract, §"every high-risk
 * setting carries a badge"):
 *   1. registry integrity (the module's own checker) — must be ok
 *   2. every item: non-empty name, summary, help, persistedIn, risk badge
 *   3. risk distribution + the settable subset (has a safe write path)
 *   4. pi-selector cross-check: the vendored pi settings selector's row
 *      inventory (settings-selector.ts `id:` entries, dialog chrome rows
 *      excluded by the pinned DIALOG_IDS list) minus the rows the hub
 *      mirrors ⇒ the machine count of TUI-unreachable settings (S2-1's
 *      evidence, correcting the ledger's hand count if they differ)
 *   5. ledger-contract preconditions: every settable item must name a
 *      persistence location (the change ledger's revert needs it)
 *
 * Output: JSON on stdout (the receipt). Exit 0 always — the RUNNER decides
 * pass/fail from the receipt, so a red audit is a recorded finding, not a
 * crash. Run from the repo root:
 *   bun benchmarks/settings-ux/audit-registry.mjs [--out path.json]
 */

import { SETTINGS_REGISTRY, registryIntegrity } from "../../pi-repo/packages/self-learning/src/settings/registry.ts";
import { readFileSync } from "node:fs";

// Dialog-internal rows of pi's selector that are UI chrome, not settings
// ("Apply" = save-and-go-back, "Change mode" = the theme-picker's
// single/dual toggle button). light-theme/dark-theme ARE settings rows
// (the automatic-mode theme submenus), as are warnings/model-thinking/
// anthropic-extra-usage (each opens a real config submenu) — verified
// against the selector source, not guessed.
const DIALOG_IDS = new Set(["apply", "single-mode"]);
// pi selector rows the hub mirrors with a working setter (verified by
// BM-2's reachable tasks; the ids are the pi-side keys).
const HUB_MIRRORED = new Set(["autocompact", "quiet-startup", "default-project-trust"]);

const items = SETTINGS_REGISTRY.map((i) => ({
        id: i.id,
        section: i.section,
        name: i.name,
        risk: i.risk ?? null,
        kind: i.kind,
        summary: i.summary ?? null,
        help: i.help ?? null,
        persistedIn: i.persistedIn ?? null,
        tags: i.tags ?? [],
        settable: typeof i.set === "function",
}));

const integrity = registryIntegrity();

const fieldGaps = items
        .filter((i) => !i.name || !i.summary || !i.help || !i.risk)
        .map((i) => ({ id: i.id, missing: ["name", "summary", "help", "risk"].filter((k) => !i[k]) }));
// Informational: read-only/action items legitimately persist nothing — the
// contract is that every SETTABLE item names its persistence location (the
// change ledger's revert depends on it); that is settableWithoutPersistence.
const persistenceNotNamed = items.filter((i) => !i.persistedIn).map((i) => i.id);
const settableWithoutPersistence = items.filter((i) => i.settable && !i.persistedIn).map((i) => i.id);

const riskCounts = { low: 0, med: 0, high: 0 };
for (const i of items) if (i.risk in riskCounts) riskCounts[i.risk]++;

// --- pi selector cross-check (S2-1 evidence) ---
const selectorSrc = readFileSync(
        new URL("../../pi-repo/packages/coding-agent/src/modes/interactive/components/settings-selector.ts", import.meta.url),
        "utf8",
);
const piIds = [...selectorSrc.matchAll(/^\s*id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);
const piSettingsRows = piIds.filter((id) => !DIALOG_IDS.has(id));
const unreachable = piSettingsRows.filter((id) => !HUB_MIRRORED.has(id));

const audit = {
        ranAt: new Date().toISOString(),
        registryCount: items.length,
        registryIntegrity: integrity,
        riskCounts,
        settable: items.filter((i) => i.settable).map((i) => i.id),
        fieldGaps,
        persistenceNotNamedCount: persistenceNotNamed.length,
        settableWithoutPersistence,
        piSelector: {
                rowsFound: piIds.length,
                settingsRows: piSettingsRows.length,
                dialogChromeExcluded: piIds.filter((id) => DIALOG_IDS.has(id)),
                hubMirrored: piSettingsRows.filter((id) => HUB_MIRRORED.has(id)),
                unreachableCount: unreachable.length,
                unreachableRows: unreachable,
        },
        coverage: {
                settableOverTotal: items.length ? items.filter((i) => i.settable).length / items.length : 0,
                hubReachablePlusPi: (items.filter((i) => i.settable).length + unreachable.length) > 0
                        ? items.filter((i) => i.settable).length / (items.filter((i) => i.settable).length + unreachable.length)
                        : 0,
        },
};

// --out: also write the receipt file
const outIdx = process.argv.indexOf("--out");
if (outIdx !== -1 && process.argv[outIdx + 1]) {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        mkdirSync(dirname(process.argv[outIdx + 1]), { recursive: true });
        writeFileSync(process.argv[outIdx + 1], JSON.stringify(audit, null, 1) + "\n");
}

console.log(JSON.stringify(audit));
