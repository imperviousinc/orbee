#!/usr/bin/env node
// Move Vite's build output into dist-app/ with `app.html` renamed to
// `index.html` so the app subdomain root serves the SPA shell directly
// (and Workers' SPA fallback for unknown paths lands on it too).

import { cpSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "dist");
const OUT = resolve(ROOT, "dist-app");

rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, { recursive: true });
renameSync(resolve(OUT, "app.html"), resolve(OUT, "index.html"));

console.log("built dist-app/  (app.html → index.html)");
