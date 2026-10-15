#!/usr/bin/env node
/**
 * vlm_review.mjs — design QA loop: sends images to the local llm-bridge
 * (qwen3.7-plus, thinking auto-disabled for snappy turns) and prints a
 * strict design critique for each. Uses sharp to downscale oversized
 * inputs before upload.
 *
 * Usage: bun scripts/vlm_review.mjs <image1> [image2 ...]
 * Bridge: http://127.0.0.1:3031/v1/chat/completions (open on localhost)
 */
import sharp from "sharp";

const BRIDGE = process.env.VLM_BRIDGE ?? "http://127.0.0.1:3031/v1/chat/completions";
const MODEL = process.env.VLM_MODEL ?? "qwen3.7-plus";

const CONTEXTS = {
  "banner": "README hero banner for a GitHub repo (renders at ~1012px wide, dark zinc theme, emerald accent; brand: unown, self-improving coding agent)",
  "social": "GitHub social preview image 1280x640 (renders SMALL inside Slack/Twitter link cards; brand: unown)",
  "mermaid": "a Mermaid architecture/flow diagram as GitHub will render it in light mode",
  "dashboard": "dark analytics dashboard screenshot destined for a README gallery (zinc-950 bg, emerald accents)",
  "gif-frame": "a frame from an animated GIF tour of a dashboard (800px wide)",
};

function contextFor(path) {
  const p = path.toLowerCase();
  if (p.includes("banner")) return CONTEXTS.banner;
  if (p.includes("social")) return CONTEXTS.social;
  if (p.includes("mermaid")) return CONTEXTS.mermaid;
  if (p.includes("tour_f")) return CONTEXTS["gif-frame"];
  return CONTEXTS.dashboard;
}

async function prepImage(path) {
  const buf = await sharp(path).resize({ width: 1400, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  return buf.toString("base64");
}

async function review(path) {
  const b64 = await prepImage(path);
  const body = {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a meticulous senior design reviewer for open-source brand visuals. The image is: ${contextFor(path)}. Reply in this exact terse format:\nVERDICT: PASS or FIX\nDEFECTS: up to 3 concrete defects if any (text truncation, overlap, illegible at small size, misalignment, cramped spacing, low contrast, ugly artifacting) — else "none"\nIMPROVE: one concrete improvement (max 15 words)\nNo preamble, no other text.`,
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    max_tokens: 300,
  };
  const t0 = Date.now();
  const resp = await fetch(BRIDGE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`bridge ${resp.status}: ${await resp.text().catch(() => "")}`);
  const json = await resp.json();
  const text = json.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 300);
  console.log(`\n=== ${path.split("/").pop()} (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
  console.log(text.trim());
}

for (const p of process.argv.slice(2)) {
  try {
    await review(p);
  } catch (e) {
    console.error(`\n=== ${p} ===\nREVIEW FAILED: ${e.message}`);
  }
}
