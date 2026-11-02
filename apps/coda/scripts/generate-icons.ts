#!/usr/bin/env bun
/**
 * Generates apps/coda/public/icon-192.png and icon-512.png — zero dependencies
 * (node:zlib + a hand-written PNG chunk encoder; no canvas, no network).
 *
 * The mark mirrors public/icon.svg: a #1f6feb rounded square (radius 18/100,
 * inset 4/100) with a white "C" drawn as a ring sector (outer r 0.36, inner r
 * 0.19, 80° gap on the right). Supersampled 2x2 → alpha-aware blend.
 *
 * Run: bun apps/coda/scripts/generate-icons.ts
 * The PNGs are committed (shipped install assets); keep this script so they
 * are reproducible from a clean checkout.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// ---------- PNG encoding (hand-rolled, minimal valid RGBA-8) ----------

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  new DataView(out.buffer, 8 + data.length, 4).setUint32(0, crc32(out.subarray(4, 8 + data.length)), true);
  return out;
}

function encodePng(size: number, rgba: Uint8Array): Uint8Array {
  const stride = size * 4 + 1; // filter byte 0 (None) per row
  const raw = new Uint8Array(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * stride + 1);
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, size);
  new DataView(ihdr.buffer).setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = deflateSync(raw);
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(idat.buffer, idat.byteOffset, idat.byteLength)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------- the mark ----------

// #1f6feb, from src/coda.css light-scheme --c-accent.
const A: [number, number, number] = [0x1f, 0x6f, 0xeb];
const WHITE: [number, number, number] = [255, 255, 255];

function inSquare(x: number, y: number, s: number): boolean {
  // rounded square in 0..s: inset 4/100 of s, corner radius 18/100 of s
  const i = 0.04 * s;
  const r = 0.18 * s;
  const u = x - i;
  const v = y - i;
  const w = s - 2 * i;
  if (u < 0 || u >= w || v < 0 || v >= w) return false;
  const cornerX = u < r ? r : u > w - r ? w - r : -1;
  const cornerY = v < r ? r : v > w - r ? w - r : -1;
  if (cornerX >= 0 && cornerY >= 0) {
    const dx = u - cornerX;
    const dy = v - cornerY;
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function inGlyph(x: number, y: number, s: number): boolean {
  // "C" = ring sector centred in the tile: r in [0.19s, 0.36s], 80° gap
  // (±40°) around the +x axis.
  const dx = x - 0.5 * s;
  const dy = y - 0.5 * s;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.36 * s || dist < 0.19 * s) return false;
  return Math.abs(Math.atan2(dy, dx)) > ((80 / 3) * Math.PI) / 180;
}

function render(size: number): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  const SS = 2; // 2x2 supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inSq = 0;
      let inGl = 0;
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) / SS;
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          if (inSquare(px, py, size)) {
            inSq++;
            if (inGlyph(px, py, size)) inGl++;
          }
        }
      }
      const n = SS * SS;
      const cov = inSq / n;
      const gl = inSq > 0 ? inGl / inSq : 0;
      const o = (y * size + x) * 4;
      if (cov === 0) {
        buf[o + 3] = 0; // transparent corner
        continue;
      }
      // glyph = white, else accent; pre-multiplied-style blend into
      // transparent for sub-100% coverage pixels.
      const rgb = gl >= 0.5 ? WHITE : A;
      const a = Math.round(cov * 255);
      buf[o] = rgb[0];
      buf[o + 1] = rgb[1];
      buf[o + 2] = rgb[2];
      buf[o + 3] = a;
    }
  }
  return buf;
}

for (const size of [192, 512] as const) {
  const png = encodePng(size, render(size));
  const dest = join(outDir, `icon-${size}.png`);
  writeFileSync(dest, png);
  console.log(`wrote ${dest} (${png.length} bytes, ${size}x${size})`);
}
