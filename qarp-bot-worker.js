// qarp-bot-worker.js — Cloudflare Worker that proxies the QARP dashboard chat bot
// to the Anthropic API. The browser sends {system, messages}; this Worker adds the
// secret API key and streams Claude's reply back as SSE. The key never reaches the
// browser or the public site.
//
// LOCKED 2026-10-30 (site audit): the first version answered any website, with no secret
// and no limit, on the owner's prepaid balance. Now a request is served only when
//   (a) its Origin is the QARP site itself, AND
//   (b) it carries header x-qarp-bot equal to the Worker secret BOT_KEY.
// The site learns BOT_KEY from the encrypted payload (meta.bot_key, set by the build from the
// GitHub secret QARP_BOT_KEY), so only someone who can unlock the site can use the bot.
// Until BOT_KEY is set on the Worker, rule (a) alone applies (no open-internet access either way).
//
// DEPLOY (one time):
//   1. Create a Worker (Cloudflare dash → Workers & Pages → Create → paste this file),
//      OR `wrangler deploy` from a project containing this as the entry.
//   2. Add the secrets:  Settings → Variables → `ANTHROPIC_API_KEY` (encrypted) and `BOT_KEY` (encrypted,
//      the same random string as the GitHub secret QARP_BOT_KEY).
//   3. Copy the Worker URL (e.g. https://qarp-bot.<you>.workers.dev) into app.js → BOT_PROXY.
//   4. Optional but recommended: Cloudflare dashboard → Security → WAF → Rate limiting rule on this
//      Worker's hostname, e.g. 30 requests per minute per IP.
//
// MODEL / COST: defaults to Claude Opus 4.8 (best quality, $5/$25 per Mtok).
// For a cheaper personal bot, change MODEL to "claude-haiku-4-5" ($1/$5) — one line.

const MODEL = "claude-opus-4-8";        // or "claude-haiku-4-5" (cheapest) / "claude-sonnet-4-6"
const MAX_TOKENS = 1200;
const SITE_ORIGINS = ["https://billionaretrading.github.io"];   // the only origin allowed to call this Worker

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const siteOk = SITE_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": siteOk ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-qarp-bot",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: siteOk ? 204 : 403, headers: cors });
    if (!siteOk) return new Response("forbidden", { status: 403, headers: cors });
    if (env.BOT_KEY && request.headers.get("x-qarp-bot") !== env.BOT_KEY) {
      return new Response("forbidden", { status: 403, headers: cors });
    }
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    if (!env.ANTHROPIC_API_KEY) return new Response("Worker missing ANTHROPIC_API_KEY secret", { status: 500, headers: cors });

    const raw = await request.text();
    if (raw.length > 60000) return new Response("too large", { status: 413, headers: cors });
    let body;
    try { body = JSON.parse(raw); } catch (e) { return new Response("bad json", { status: 400, headers: cors }); }

    const system = String(body.system || "").slice(0, 24000);          // bound the context
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
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
