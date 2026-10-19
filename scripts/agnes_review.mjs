#!/usr/bin/env node
/**
 * agnes_review.mjs — VLM design critique of landing screenshots via the
 * Agnes AI lane on the llm-bridge (agnes-3.0-flash, vision-capable).
 *
 * Usage: node scripts/agnes_review.mjs <image...>
 * Env:   VLM_BRIDGE (default http://127.0.0.1:3031/v1/chat/completions)
 *        VLM_MODEL  (default agnes-3.0-flash)
 */
import sharp from "sharp";

const BRIDGE = process.env.VLM_BRIDGE ?? "http://127.0.0.1:3031/v1/chat/completions";
const MODEL = process.env.VLM_MODEL ?? "agnes-3.0-flash";
const BRIEF = process.env.VLM_BRIEF ?? "";

async function review(path) {
  const buf = await sharp(path).resize({ width: 1400, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  const body = {
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text:
            `You are a senior landing-page design reviewer. This is a screenshot of the landing page of "Unown", an open-source self-improving coding agent (brand: hand-drawn Unown-alphabet glyphs, warm paper/ink/gold, Game-Boy-inspired). ${BRIEF}\n` +
            "Answer in this exact format:\nVERDICT: PASS or FIX\nDEFECTS: up to 5 concrete defects (layout, density, hierarchy, contrast, alignment, wasted space)\nIMPROVE: the 3 highest-leverage improvements, each max 15 words\nNo preamble.",
        },
        { type: "image_url", image_url: { url: `data:image/png;base64,${buf.toString("base64")}` } },
      ],
    }],
    max_tokens: 500,
  };
  const t0 = Date.now();
  const resp = await fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json = await resp.json();
  const out = json.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 300);
  console.log(`\n=== ${path} (${((Date.now() - t0) / 1000).toFixed(1)}s) ===\n${out}`);
}

for (const p of process.argv.slice(2)) {
  try { await review(p); } catch (e) { console.error(`${p}: ${e.message}`); }
}
