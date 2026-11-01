/**
 * Pure page-probe builders for the browser session (the F3 fix, browser
 * autonomy round 2026-11-01).
 *
 * Both probes are expressions evaluated through `pageEval` (returnByValue).
 * They live here — pure string builders, no browser needed — so the unit
 * suite can pin their contracts (test/browser.test.ts) the same way the
 * snapshot script's shape is pinned, and the live suite (browser-live)
 * exercises them against a real Chromium.
 */

/**
 * Combined readiness probe: the TOP document's readyState AND every
 * same-origin iframe's readyState. The old `document.readyState` gate
 * returned ready at `interactive`/`complete` of the top document while a
 * same-origin frame could still be mid-load — refs minted into (and fills
 * targeted at) that frame's loading document were silently discarded when
 * the frame finished loading. Cross-origin frames throw on
 * `contentDocument` access and are exempt (nothing same-origin to lose).
 *
 * Returns the string "complete"/"interactive" ONLY when the top document is
 * ready AND all same-origin frames report "complete"; any other value
 * (including the literal "frame-loading") means keep waiting.
 */
export const PAGE_READY_PROBE = `(() => {
        const rs = document.readyState;
        if (rs !== "complete" && rs !== "interactive") return rs;
        for (const f of Array.from(document.querySelectorAll("iframe"))) {
                try {
                        const d = f.contentDocument;
                        if (!d) return "frame-loading";
                        if (d.readyState !== "complete") return "frame-loading";
                        // a freshly-appended src-bearing frame sits at its INITIAL
                        // about:blank, which reports readyState "complete" before the src
                        // navigation commits — waiting for it would be a no-op while the
                        // real document is still on the wire (measured: a 600 ms fixture)
                        if (f.src && d.URL === "about:blank") return "frame-loading";
                } catch (e) {}
        }
        return rs;
})()`;

export type FieldCheck = { sel: string; value: string };
export type FieldCheckResult = { sel: string; ok: boolean; why: string; got?: string };

/**
 * Post-fill persistence probe: for each {sel, value} pair, re-resolve the
 * element (the same shadow-root + same-origin-iframe piercing findIn the
 * actions use) and verify the value actually landed on a CONNECTED element.
 * A fill that "succeeded" against a document the page was about to discard,
 * or a focus miss that typed into nothing, reads back as a mismatch — the
 * caller retries once and then fails loudly instead of reporting a silent
 * success (the F3 defect class).
 */
export function fieldChecksProbe(checks: FieldCheck[]): string {
        return `(() => {
                const checks = ${JSON.stringify(checks)};
                function findOne(sel) {
                        function find(root) {
                                let el = null;
                                try { el = root.querySelector(sel); } catch (e) { return null; }
                                if (el) return el;
                                for (const k of Array.from(root.querySelectorAll("*"))) {
                                        if (k.shadowRoot) { const hit = find(k.shadowRoot); if (hit) return hit; }
                                }
                                for (const f of Array.from(root.querySelectorAll("iframe"))) {
                                        try {
                                                const doc = f.contentDocument;
                                                if (doc && doc.body) { const hit = find(doc); if (hit) return hit; }
                                        } catch (e) {}
                                }
                                return null;
                        }
                        return find(document);
                }
                const out = [];
                for (const c of checks) {
                        const el = findOne(c.sel);
                        if (!el) { out.push({ sel: c.sel, ok: false, why: "gone" }); continue; }
                        if (!el.isConnected) { out.push({ sel: c.sel, ok: false, why: "detached" }); continue; }
                        const v = el.value == null ? "" : String(el.value);
                        if (v === c.value) { out.push({ sel: c.sel, ok: true, why: "" }); continue; }
                        out.push({ sel: c.sel, ok: false, why: "mismatch", got: v.slice(0, 60) });
                }
                return out;
        })()`;
}
