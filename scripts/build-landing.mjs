#!/usr/bin/env node
// Build the landing artifact at dist-landing/.
//
// The landing is a single self-contained HTML file (no Vite, no modules,
// no bundling). We just copy index.html + the public/ static assets,
// then rewrite the in-app links to point at the app subdomain.
//
//   index.html  + public/*  →  dist-landing/

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC_HTML = resolve(ROOT, "index.html");
const PUBLIC_DIR = resolve(ROOT, "public");
const OUT_DIR = resolve(ROOT, "dist-landing");

// In prod the landing lives at orbee.chat and the app at app.orbee.chat,
// so cross-deploy links must be absolute. In dev `vite dev` serves both
// from one origin and the route-rewriter middleware handles `/n`-style
// paths, so this rewrite is a build-step concern only.
const APP_ORIGIN = process.env.ORBEE_APP_ORIGIN ?? "https://app.orbee.chat";

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// Copy public/ first so html overrides anything that might collide.
cpSync(PUBLIC_DIR, OUT_DIR, { recursive: true });

let html = readFileSync(SRC_HTML, "utf8");
// Rewrite app-pointing hrefs to the absolute subdomain URL. Favicon /
// manifest hrefs are NOT touched - those resources live on the
// landing's own domain.
html = html.replace(/href="\/n(?=["?])/g, `href="${APP_ORIGIN}/n`);
writeFileSync(resolve(OUT_DIR, "index.html"), html);

console.log(`built dist-landing/  (links → ${APP_ORIGIN})`);
