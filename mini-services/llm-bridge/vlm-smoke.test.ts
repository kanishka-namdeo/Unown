// Env-gated VLM smoke test for the llm-bridge vision path.
//
// Backlog reference: docs/testing-strategy.md §7 I — "VLM (qwen3.7-plus).
// Screenshot-to-code and image-understanding smoke tests through the bridge;
// currently the only multimodal path is untested beyond
// scripts/probe_vision.py."
//
// What this file adds on top of pure.test.ts:
//   - pure.test.ts pins that buildUpstreamBody forwards image_url content
//     parts VERBATIM (unit level, no network).
//   - THIS file exercises the full live path: bridge serving layer →
//     Dashscope upstream → qwen3.7-plus vision → non-empty grounded answer.
//
// Gating: the live tests are SKIPPED unless UNOWN_VLM_SMOKE=1, so `bun test`
// (and CI, which runs `bun test src` — this file is not even in that path)
// stays offline, free, and green by default. Only the pure payload-shaping
// tests run unconditionally.
//
// Run the live smoke once (bridge must be up; it is already authenticated via
// its own BRIDGE_UPSTREAM_KEY — no API keys are ever set or read here):
//
//   cd mini-services/llm-bridge
//   UNOWN_VLM_SMOKE=1 \
//     UNOWN_VLM_SMOKE_URL=http://127.0.0.1:3031 \
//     UNOWN_VLM_SMOKE_MODEL=qwen3.7-plus \
//     UNOWN_VLM_SMOKE_RECEIPT=/abs/path/benchmarks/vlm-smoke/results/receipt-<date>.json \
//     bun test vlm-smoke.test.ts
//
// Environment:
//   UNOWN_VLM_SMOKE          "1" = run the live smoke (hard gate; anything
//                            else, including unset, skips)
//   UNOWN_VLM_SMOKE_URL      bridge base URL (default http://127.0.0.1:3031)
//   UNOWN_VLM_SMOKE_MODEL    model id (default qwen3.7-plus, the historical
//                            Dashscope vision model; agnes-3.0-flash is the
//                            vision-capable model on the Agnes upstream — pass
//                            whichever your bridge serves)
//   UNOWN_VLM_SMOKE_RECEIPT  optional path; when set, the raw response JSON,
//                            usage, duration, date, model and request-shape
//                            summary are written there (parent dirs are
//                            created). No secrets exist in the receipt: the
//                            bridge requires no Authorization when
//                            BRIDGE_API_KEY is unset, and only the response
//                            side is captured.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Gate + configuration (env-gated: default = fully skipped live suite)
// ---------------------------------------------------------------------------
const SMOKE_ENABLED = process.env.UNOWN_VLM_SMOKE === "1";
const BASE_URL = (process.env.UNOWN_VLM_SMOKE_URL ?? "http://127.0.0.1:3031").replace(/\/+$/, "");
const MODEL = process.env.UNOWN_VLM_SMOKE_MODEL ?? "qwen3.7-plus";
const RECEIPT_PATH = process.env.UNOWN_VLM_SMOKE_RECEIPT ?? "";

// ---------------------------------------------------------------------------
// PNG crafting — pure code, no fixtures, no dependencies.
// Same request shape as scripts/probe_vision.py: a 100x100 solid truecolor
// PNG embedded as a data URL in an image_url content part. 100x100 (not
// smaller) is deliberate: probe_vision.py was written to re-test vision with
// a larger image after smaller ones proved unreliable.
// ---------------------------------------------------------------------------
const IMG_W = 100;
const IMG_H = 100;
const IMG_RGB: [number, number, number] = [0xff, 0x00, 0x00]; // solid red
const PROMPT = "What color is this image? Answer in one word.";
const MAX_TOKENS = 2000;

const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                table[n] = c >>> 0;
        }
        return table;
})();

function crc32(buf: Uint8Array): number {
        let c = ~0;
        for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
        return (~c) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
        const body = new Uint8Array(type.length + data.length);
        for (let i = 0; i < type.length; i++) body[i] = type.charCodeAt(i);
        body.set(data, type.length);
        // layout: length(4) + body(type + data) + CRC(4) — body already contains
        // the type bytes, so the total is 4 + body.length + 4.
        const out = new Uint8Array(4 + body.length + 4);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, data.length, false);
        out.set(body, 4);
        dv.setUint32(out.length - 4, crc32(body), false);
        return out;
}

/** Minimal valid PNG: single IDAT of filter-0 scanlines, color type 2 (RGB). */
function solidColorPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
        const ihdr = new Uint8Array(13);
        const dv = new DataView(ihdr.buffer);
        dv.setUint32(0, width, false);
        dv.setUint32(4, height, false);
        ihdr[8] = 8; // bit depth
        ihdr[9] = 2; // color type: truecolor RGB
        // bytes 10-12: compression 0, filter 0, interlace 0 (already zero)
        const raw = new Uint8Array(height * (1 + width * 3));
        for (let y = 0; y < height; y++) {
                const row = y * (1 + width * 3);
                raw[row] = 0; // filter: none
                for (let x = 0; x < width; x++) {
                        raw[row + 1 + x * 3] = rgb[0];
                        raw[row + 2 + x * 3] = rgb[1];
                        raw[row + 3 + x * 3] = rgb[2];
                }
        }
        const parts = [
                new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                pngChunk("IHDR", ihdr),
                pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
                pngChunk("IEND", new Uint8Array(0)),
        ];
        const total = parts.reduce((n, p) => n + p.length, 0);
        const png = new Uint8Array(total);
        let off = 0;
        for (const p of parts) {
                png.set(p, off);
                off += p.length;
        }
        return png;
}

function readChunks(png: Uint8Array): { type: string; data: Uint8Array; crc: number }[] {
        const out: { type: string; data: Uint8Array; crc: number }[] = [];
        const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
        let off = 8; // skip the 8-byte signature
        while (off + 12 <= png.length) {
                const len = dv.getUint32(off);
                const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
                const data = png.subarray(off + 8, off + 8 + len);
                const crc = dv.getUint32(off + 8 + len);
                out.push({ type, data, crc });
                off += 12 + len;
        }
        return out;
}

const PNG = solidColorPng(IMG_W, IMG_H, IMG_RGB);
const PNG_B64 = Buffer.from(PNG).toString("base64");
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
const PNG_SHA256 = new Bun.CryptoHasher("sha256").update(PNG).digest("hex");

/** The multimodal request body (OpenAI content-parts shape, same as probe_vision.py). */
function smokeRequestBody() {
        return {
                model: MODEL,
                messages: [
                        {
                                role: "user",
                                content: [
                                        { type: "text", text: PROMPT },
                                        { type: "image_url", image_url: { url: PNG_DATA_URL } },
                                ],
                        },
                ],
                max_tokens: MAX_TOKENS,
        };
}

// ---------------------------------------------------------------------------
// Payload shaping — always-on pure tests (no network, run in every `bun test`)
// ---------------------------------------------------------------------------
describe("vlm-smoke payload (pure)", () => {
        test("crafts a valid 100x100 solid-red truecolor PNG (chunk CRCs, IDAT round-trip, pixel values)", () => {
                const chunks = readChunks(PNG);
                expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
                // every chunk's stored CRC must match a fresh CRC over type+data — a
                // wrong chunk stride or byte order breaks exactly here
                for (const c of chunks) {
                        const body = new Uint8Array(4 + c.data.length);
                        for (let i = 0; i < 4; i++) body[i] = c.type.charCodeAt(i);
                        body.set(c.data, 4);
                        expect(c.crc, `CRC mismatch on chunk ${c.type}`).toBe(crc32(body));
                }
                const ihdr = chunks[0].data;
                const dv = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
                expect(dv.getUint32(0, false)).toBe(IMG_W);
                expect(dv.getUint32(4, false)).toBe(IMG_H);
                expect(ihdr[8]).toBe(8); // bit depth
                expect(ihdr[9]).toBe(2); // color type: RGB
                const raw = new Uint8Array(inflateSync(Buffer.from(chunks[1].data)));
                expect(raw.length).toBe(IMG_H * (1 + IMG_W * 3));
                for (let y = 0; y < IMG_H; y++) {
                        const row = y * (1 + IMG_W * 3);
                        expect(raw[row]).toBe(0); // filter byte
                        for (let x = 0; x < IMG_W; x++) {
                                expect([raw[row + 1 + x * 3], raw[row + 2 + x * 3], raw[row + 3 + x * 3]]).toEqual(IMG_RGB);
                        }
                }
        });

        test("embeds the PNG as an image_url data-URL content part (probe_vision.py request shape)", () => {
                expect(PNG_DATA_URL.startsWith("data:image/png;base64,")).toBe(true);
                const body = smokeRequestBody();
                const parts = (body.messages[0] as { content: { type: string; text?: string; image_url?: { url: string } }[] }).content;
                expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
                expect(parts[0].text).toBe(PROMPT);
                expect(Buffer.from(parts[1].image_url!.url.slice("data:image/png;base64,".length), "base64")).toEqual(
                        Buffer.from(PNG),
                );
        });
});

// ---------------------------------------------------------------------------
// Live smoke — ONLY with UNOWN_VLM_SMOKE=1 (skipped by default)
// ---------------------------------------------------------------------------
let httpStatus = 0;
let durationMs = 0;
let startedAtIso = "";
let responseJson: any = null;
let bridgeHealth: any = null;
let bridgeLogEntry: any = null;

describe.skipIf(!SMOKE_ENABLED)("vlm-smoke (live, env-gated: UNOWN_VLM_SMOKE=1)", () => {
        beforeAll(async () => {
                startedAtIso = new Date().toISOString();
                // Non-fatal health snapshot for the receipt (model allow-list, upstream
                // ok, authRequired) — /health never carries secrets.
                try {
                        const hres = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(8000) });
                        bridgeHealth = await hres.json();
                } catch {
                        bridgeHealth = null;
                }

                // The single live multimodal request. Time-to-headers is capped by the
                // bridge itself (BRIDGE_UPSTREAM_TIMEOUT_MS, default 180s); 100s here
                // is well inside that while keeping the run bounded.
                const t0 = Date.now();
                const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(smokeRequestBody()),
                        signal: AbortSignal.timeout(100_000),
                });
                httpStatus = res.status;
                const text = await res.text();
                durationMs = Date.now() - t0;
                responseJson = JSON.parse(text);

                // The bridge's own request log (stats only: model routing, token
                // counts, duration — no message content, no secrets). Match our
                // request by model + message count + duration to avoid grabbing a
                // concurrent client's entry.
                try {
                        const lres = await fetch(`${BASE_URL}/v1/log`, { signal: AbortSignal.timeout(5000) });
                        const log = (await lres.json())?.log ?? [];
                        bridgeLogEntry =
                                [...log].reverse().find(
                                        (e: any) =>
                                                e.upstreamModel === MODEL &&
                                                e.messages === 1 &&
                                                Math.abs((e.durationMs ?? 0) - durationMs) <= 250,
                                ) ?? null;
                } catch {
                        bridgeLogEntry = null;
                }
        }, 150_000);

        test("bridge returns HTTP 200 with a non-empty text content for the image+text request", () => {
                expect(httpStatus, `bridge responded ${httpStatus}`).toBe(200);
                expect(responseJson?.error, `bridge error payload: ${JSON.stringify(responseJson?.error)}`).toBeUndefined();
                const content = responseJson?.choices?.[0]?.message?.content;
                expect(typeof content, `choices[0].message.content is not a string: ${typeof content}`).toBe("string");
                expect(String(content).trim().length, "content is empty — the vision path returned no text").toBeGreaterThan(0);
        });

        // The image-understanding half of the §7 I smoke: a solid red 100x100 PNG
        // is the most deterministic vision probe available, and probe_vision.py
        // uses exactly this stimulus. If this ever fails while the test above
        // passes, the image part is likely NOT reaching the model (request shape
        // regression in the bridge) or the model lost vision — see the receipt's
        // usage.prompt_tokens_details.image_tokens for direct evidence.
        test("answer is grounded in the image (names its color: red)", () => {
                const content = String(responseJson?.choices?.[0]?.message?.content ?? "");
                expect(content.toLowerCase()).toContain("red");
        });

        test("usage accounting is present (total_tokens > 0)", () => {
                const usage = responseJson?.usage ?? {};
                expect(Number(usage.total_tokens ?? 0)).toBeGreaterThan(0);
        });

        afterAll(async () => {
                if (!RECEIPT_PATH || !responseJson) return;
                const content = String(responseJson?.choices?.[0]?.message?.content ?? "");
                const receipt = {
                        receipt: "vlm-smoke",
                        version: 1,
                        date: startedAtIso,
                        model: MODEL,
                        bridgeUrl: BASE_URL,
                        request: {
                                endpoint: "POST /v1/chat/completions",
                                model: MODEL,
                                messages: 1,
                                contentParts: [
                                        { type: "text", chars: PROMPT.length, text: PROMPT },
                                        {
                                                type: "image_url",
                                                image: {
                                                        mime: "image/png",
                                                        width: IMG_W,
                                                        height: IMG_H,
                                                        color: "#ff0000",
                                                        base64Chars: PNG_B64.length,
                                                        sha256: PNG_SHA256,
                                                        encoding: "data URL in image_url.url (OpenAI multimodal content-part shape, same as scripts/probe_vision.py)",
                                                },
                                        },
                                ],
                                max_tokens: MAX_TOKENS,
                                stream: false,
                                auth: "none (bridge authRequired=false; upstream auth is injected bridge-side and never appears in this receipt)",
                        },
                        bridgeHealth,
                        bridgeLogEntry,
                        durationMs,
                        httpStatus,
                        response: responseJson,
                        usage: responseJson?.usage ?? null,
                        assertions: {
                                nonEmptyTextContent: String(content).trim().length > 0,
                                contentMentionsRed: content.toLowerCase().includes("red"),
                                usageTotalTokensPositive: Number(responseJson?.usage?.total_tokens ?? 0) > 0,
                                contentPreview: content.slice(0, 200),
                        },
                        caveats: [
                                "single-run smoke (n=1), no repetition, no scoring beyond the color-naming check",
                                `only ${MODEL} (single vision-capable model per run; the allow-list is upstream-dependent)`,
                                "non-streaming path only; screenshot-to-code smoke (testing-strategy.md §7 I) still future work",
                        ],
                };
                mkdirSync(RECEIPT_PATH.slice(0, Math.max(RECEIPT_PATH.lastIndexOf("/"), 0)) || ".", { recursive: true });
                await Bun.write(RECEIPT_PATH, JSON.stringify(receipt, null, 2) + "\n");
        }, 30_000);
});
