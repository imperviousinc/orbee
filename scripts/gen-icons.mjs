#!/usr/bin/env node
/**
 * Generate favicon/PWA icons from the Orbee mascot pixel grid.
 * No dependencies — uses Node built-in zlib for PNG compression.
 */

import { writeFileSync, mkdirSync } from "fs";
import { deflateSync } from "zlib";
import { join } from "path";

// ── Mascot data (matches SpacesLogo DEFAULT_GRID + DEFAULT_COLORS) ──

const GRID = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,0,1,1,1,1,0,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,0,1,0,1,1,1,1,1,1,1,1,0,1,0,0,0,0],
  [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0],
  [0,0,0,0,1,0,1,0,3,1,1,3,0,1,0,1,0,0,0,0],
  [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,0,0,1,1,1,1,5,5,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0],
];

const GW = 20;
const GH = 16;

// Mirrors src/lib/orbeeExpressions.ts ORBEE_PALETTE so favicons
// match the in-app mascot exactly.
const COLORS = {
  0: [0, 0, 0, 0],          // transparent
  1: [217, 70, 239, 255],   // #d946ef hot magenta body
  2: [58, 10, 58, 255],     // #3a0a3a deep plum shadow
  3: [255, 255, 255, 255],  // #ffffff eye white
  5: [139, 26, 139, 255],   // #8b1a8b mid magenta (mouth shading)
  6: [34, 34, 34, 255],     // #222222 dark slate
};

// BG color for non-transparent versions (favicon.ico needs solid bg).
// Matches the app's --bg-deep (#151513) so the icon backplate looks
// the same as the surface the app paints onto.
const BG = [21, 21, 19, 255]; // --bg-deep #151513

// ── PNG encoder (minimal, no dependencies) ──

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function createPNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data with filter byte (0 = none) per row
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + width * 4) + 1 + x * 4;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      raw[di + 3] = rgba[si + 3];
    }
  }

  const compressed = deflateSync(raw);

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Render mascot to RGBA buffer at given size ──

function renderMascot(size, transparent = true) {
  const px = size / GW; // pixel scale (GW is wider, use it for square canvas)
  const rgba = new Uint8Array(size * size * 4);

  // Fill background
  if (!transparent) {
    for (let i = 0; i < size * size; i++) {
      rgba[i * 4] = BG[0];
      rgba[i * 4 + 1] = BG[1];
      rgba[i * 4 + 2] = BG[2];
      rgba[i * 4 + 3] = BG[3];
    }
  }

  // Center vertically
  const yOff = Math.floor((size - GH * px) / 2);

  // Glow pass (slight expansion)
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const v = GRID[gy][gx];
      if (!v || !COLORS[v]) continue;
      const [r, g, b] = COLORS[v];
      const x0 = Math.max(0, Math.floor(gx * px - px * 0.3));
      const y0 = Math.max(0, Math.floor(gy * px + yOff - px * 0.3));
      const x1 = Math.min(size, Math.ceil((gx + 1) * px + px * 0.3));
      const y1 = Math.min(size, Math.ceil((gy + 1) * px + yOff + px * 0.3));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * size + x) * 4;
          // Blend glow at ~15% opacity
          const a = 0.15;
          rgba[i] = Math.min(255, rgba[i] + r * a | 0);
          rgba[i + 1] = Math.min(255, rgba[i + 1] + g * a | 0);
          rgba[i + 2] = Math.min(255, rgba[i + 2] + b * a | 0);
          rgba[i + 3] = Math.max(rgba[i + 3], 40);
        }
      }
    }
  }

  // Main pixels
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const v = GRID[gy][gx];
      if (!v || !COLORS[v]) continue;
      const [r, g, b, a] = COLORS[v];
      const x0 = Math.floor(gx * px);
      const y0 = Math.floor(gy * px + yOff);
      const x1 = Math.floor((gx + 1) * px);
      const y1 = Math.floor((gy + 1) * px + yOff);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * size + x) * 4;
          rgba[i] = r;
          rgba[i + 1] = g;
          rgba[i + 2] = b;
          rgba[i + 3] = a;
        }
      }
    }
  }

  return rgba;
}

// ── SVG favicon ──

function createSVG() {
  const px = 1;
  let rects = "";
  // Glow rects
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const v = GRID[y][x];
      if (!v || !COLORS[v]) continue;
      const [r, g, b] = COLORS[v];
      const yOff = (GW - GH) / 2;
      rects += `<rect x="${x * px - 0.3}" y="${(y + yOff) * px - 0.3}" width="${px + 0.6}" height="${px + 0.6}" fill="rgb(${r},${g},${b})" opacity="0.18"/>`;
    }
  }
  // Main rects
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const v = GRID[y][x];
      if (!v || !COLORS[v]) continue;
      const [r, g, b] = COLORS[v];
      const yOff = (GW - GH) / 2;
      rects += `<rect x="${x * px}" y="${(y + yOff) * px}" width="${px}" height="${px}" fill="rgb(${r},${g},${b})"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GW} ${GW}" shape-rendering="crispEdges">${rects}</svg>`;
}

// ── ICO (single 32x32 PNG inside ICO container) ──

function createICO(pngBuf) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(1, 4);      // 1 image

  // Directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry[0] = 32;                   // width
  entry[1] = 32;                   // height
  entry[2] = 0;                    // colors (0 = no palette)
  entry[3] = 0;                    // reserved
  entry.writeUInt16LE(1, 4);       // color planes
  entry.writeUInt16LE(32, 6);      // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);  // size
  entry.writeUInt32LE(22, 12);     // offset (6 header + 16 entry)

  return Buffer.concat([header, entry, pngBuf]);
}

// ── Generate all icons ──

const outDir = join(import.meta.dirname, "..", "public");
mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: "favicon-32.png", size: 32, transparent: false },
  { name: "apple-touch-icon.png", size: 180, transparent: false },
  { name: "icon-192.png", size: 192, transparent: false },
  { name: "icon-512.png", size: 512, transparent: false },
  { name: "icon-192-maskable.png", size: 192, transparent: false },
  { name: "icon-512-maskable.png", size: 512, transparent: false },
];

for (const { name, size, transparent } of sizes) {
  const rgba = renderMascot(size, transparent);
  const png = createPNG(size, size, rgba);
  writeFileSync(join(outDir, name), png);
  console.log(`  ${name} (${size}x${size}) — ${png.length} bytes`);
}

// SVG
const svg = createSVG();
writeFileSync(join(outDir, "favicon.svg"), svg);
console.log(`  favicon.svg — ${svg.length} bytes`);

// ICO from 32x32
const ico32 = createPNG(32, 32, renderMascot(32, false));
const ico = createICO(ico32);
writeFileSync(join(outDir, "favicon.ico"), ico);
console.log(`  favicon.ico — ${ico.length} bytes`);

console.log("\nDone!");
