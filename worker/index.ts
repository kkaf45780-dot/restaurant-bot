/**
 * Cloudflare Worker entry point (referenced by `main` in wrangler.jsonc).
 *
 * Static SPA assets are served from the ASSETS binding. Requests matching
 * `run_worker_first` (/api/*, /uploads/*) reach this handler first; the
 * Express API in server.ts has not been ported to the Worker runtime yet,
 * so those routes return 501 for now.
 *
 * This file is not used by the Netlify build (the Cloudflare Vite plugin is
 * disabled when NETLIFY=true).
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
      return new Response(
        JSON.stringify({ error: 'Not implemented on Cloudflare Workers yet' }),
        { status: 501, headers: { 'content-type': 'application/json' } },
      );
    }

    return env.ASSETS.fetch(request);
  },
};
