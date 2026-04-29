// Tiny edge router for the orbee.chat landing deployment.
//
// The landing is otherwise pure static. This Worker exists ONLY to
// catch app-pointing paths that leaked into the wrong domain (typos,
// shared screenshots, old print material, etc.) and 301 them to the
// app subdomain so the user lands where they intended.
//
//   orbee.chat/n?pick=foo       → app.orbee.chat/n?pick=foo
//   orbee.chat/s/host'id        → app.orbee.chat/s/host'id
//   orbee.chat/anything else    → static asset (or 404)

const APP_ORIGIN = "https://app.orbee.chat";

// Paths that belong on the app subdomain. Add new entries as new
// in-app deep-link routes are added.
const APP_PATH_RE = /^\/(?:n|app|s\/.+)(?:\/|$|\?)/;

// Cloudflare Workers `Fetcher` shape (avoids pulling in
// @cloudflare/workers-types just for this tiny worker).
type Fetcher = { fetch: (request: Request) => Promise<Response> };

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (APP_PATH_RE.test(url.pathname)) {
      return Response.redirect(APP_ORIGIN + url.pathname + url.search, 301);
    }
    return env.ASSETS.fetch(req);
  },
};