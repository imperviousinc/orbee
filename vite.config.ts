import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// Dev-only routing: mimics the prod two-domain split on a single origin.
//   /              → index.html (landing)
//   asset path     → static file
//   Vite-internal  → passthrough
//   anything else  → app.html (SPA shell)
// In prod the landing and app live on separate Worker deployments
// (orbee.chat vs app.orbee.chat), so this middleware only runs in dev.

const ASSET_EXT_RE = /\.(?:html|js|mjs|cjs|ts|tsx|jsx|css|map|json|svg|ico|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|eot|wasm|txt|webmanifest)$/i;
const VITE_INTERNAL_RE = /^\/(?:@vite|@id|@fs|@react-refresh|@solid-refresh|src|node_modules|public)\b/;

export default defineConfig({
  appType: "mpa",
  plugins: [
    {
      name: "orbee-route-rewriter",
      // Sync registration runs BEFORE Vite's internal middlewares so we
      // can rewrite req.url before Vite tries to resolve it.
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const raw = req.url || "/";
          const qIdx = raw.indexOf("?");
          const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
          const tail = qIdx >= 0 ? raw.slice(qIdx) : "";
          if (path === "/" || path === "") {
            req.url = "/index.html" + tail;
            return next();
          }
          if (ASSET_EXT_RE.test(path) || VITE_INTERNAL_RE.test(path)) {
            return next();
          }
          req.url = "/app.html" + tail;
          next();
        });
      },
    },
    solid(),
    tailwindcss(),
  ],
  build: {
    // Only the app shell goes through Vite - the landing is static and
    // gets copied straight into dist-landing/ by scripts/build-landing.mjs.
    rollupOptions: {
      input: {
        app: resolve(__dirname, "app.html"),
      },
    },
  },
});
