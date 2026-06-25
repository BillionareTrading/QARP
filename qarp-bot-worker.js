// qarp-bot-worker.js — Cloudflare Worker that proxies the QARP dashboard chat bot
// to the Anthropic API. The browser sends {system, messages}; this Worker adds the
// secret API key and streams Claude's reply back as SSE. The key never reaches the
// browser or the public site.
//
// DEPLOY (one time):
//   1. Create a Worker (Cloudflare dash → Workers & Pages → Create → paste this file),
//      OR `wrangler deploy` from a project containing this as the entry.
//   2. Add the secret:  Settings → Variables → add `ANTHROPIC_API_KEY` (encrypted).
//      (CLI: `wrangler secret put ANTHROPIC_API_KEY`)
//   3. Copy the Worker URL (e.g. https://qarp-bot.<you>.workers.dev) into app.js → BOT_PROXY.
//
// MODEL / COST: defaults to Claude Opus 4.8 (best quality, $5/$25 per Mtok).
// For a cheaper personal bot, change MODEL to "claude-haiku-4-5" ($1/$5) — one line.

const MODEL = "claude-opus-4-8";        // or "claude-haiku-4-5" (cheapest) / "claude-sonnet-4-6"
const MAX_TOKENS = 1200;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    if (!env.ANTHROPIC_API_KEY) return new Response("Worker missing ANTHROPIC_API_KEY secret", { status: 500, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) { return new Response("bad json", { status: 400, headers: cors }); }

    const system = String(body.system || "").slice(0, 24000);          // bound the context
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-16);                                                       // keep recent turns only
    if (!messages.length) return new Response("no messages", { status: 400, headers: cors });

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, stream: true, system, messages }),
    });

    // pass Anthropic's SSE stream straight back to the browser
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
    });
  },
};
