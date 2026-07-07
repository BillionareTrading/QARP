// qarp-grok-worker.js — Cloudflare Worker that proxies "Social Pulse" reads to xAI (Grok)
// using the Agent Tools API with the server-side x_search tool (live X / Twitter). The browser
// drawer (and the cloud refresh job) POST a ticker; this Worker adds the secret key, asks Grok
// to read X, and returns a compact JSON pulse. The xAI key never reaches the browser/public site.
//
// DEPLOY: Cloudflare -> Workers -> paste this -> Deploy; add secret XAI_API_KEY (Settings ->
// Variables and Secrets -> type Secret) -> Deploy again. Endpoint: POST /v1/responses.

const MODEL = "grok-4.3";

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    if (!env.XAI_API_KEY) return new Response("Worker missing XAI_API_KEY secret", { status: 500, headers: cors });
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });

    let body;
    try { body = await request.json(); } catch (e) { return J({ error: "bad json" }, 400); }
    const symbol = String(body.symbol || "").trim().toUpperCase().slice(0, 8);
    const name = String(body.name || symbol).trim().slice(0, 60);
    if (!symbol) return J({ error: "no symbol" }, 400);

    const context = String(body.context || "").slice(0, 400);   // optional: day move, headline, sector
    const prompt =
      `Search X (Twitter) in real time for the latest posts about ${name} ($${symbol}). Report the SOCIAL ` +
      `PULSE. Use ONLY real posts you actually find — never invent a post, handle, number, or sentiment. ` +
      `Prioritise posts with real engagement (replies/reposts), and weigh accounts with real followings.\n` +
      (context ? `Context (react to it if X is discussing it): ${context}\n` : "") +
      `\nCOUNT what you read: bullish vs bearish vs neutral posts from the last 24h.\n` +
      `SCORING RULES (strict):\n` +
      `- If you find FEWER THAN 5 substantive posts in 24h: buzz="quiet", sentiment_score=null, ` +
      `sentiment_label="Quiet". A quiet name is a real finding — do NOT dress it up as Neutral 50.\n` +
      `- NEVER default to 50. Scores near 50 are reserved for genuine two-sided arguments with ` +
      `comparable numbers and conviction on both sides.\n` +
      `- Otherwise score from the mix and conviction: 80+ bulls dominate loudly; 60-79 clearly ` +
      `leaning bullish; 40-59 genuinely contested; 21-39 clearly leaning bearish; <=20 bears dominate.\n\n` +
      `Return ONLY a JSON object (no prose, no code fences):\n` +
      `{"symbol":"${symbol}","sentiment_label":"Bullish|Leaning bullish|Contested|Leaning bearish|Bearish|Quiet",` +
      `"sentiment_score":<0-100 or null>,"bullish_n":<int>,"bearish_n":<int>,"neutral_n":<int>,` +
      `"buzz":"surging|rising|flat|quiet","posts_24h":<int or null>,` +
      `"theme":"<one sentence: WHAT the crowd is actually talking about>",` +
      `"posts":[{"handle":"@...","text":"<short paraphrase, never verbatim>"}],"as_of":"<ISO time>"}`;

    const payload = {
      model: MODEL,
      input: [{ role: "user", content: prompt }],
      tools: [{ type: "x_search" }],
      stream: false,
    };

    let upstream, raw;
    try {
      upstream = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.XAI_API_KEY}` },
        body: JSON.stringify(payload),
      });
      raw = await upstream.text();
    } catch (e) {
      return J({ error: "xai unreachable", detail: String(e) }, 502);
    }
    if (!upstream.ok) return J({ error: "xai error", status: upstream.status, detail: raw.slice(0, 600) }, upstream.status);

    // pull the model's final text out of the Responses object, then the JSON pulse out of that
    let j, text = "";
    try { j = JSON.parse(raw); } catch (e) { return J({ error: "non-json from xai", detail: raw.slice(0, 600) }); }
    if (typeof j.output_text === "string") text = j.output_text;
    else if (Array.isArray(j.output)) {
      for (const item of j.output) {
        const c = item && item.content;
        if (Array.isArray(c)) for (const p of c) { if (p && typeof p.text === "string") text += p.text; }
        else if (typeof c === "string") text += c;
      }
    }
    let pulse = null;
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) { try { pulse = JSON.parse(text.slice(a, b + 1)); pulse.symbol = symbol; } catch (e) {} }
    if (!pulse) return J({ error: "parse failed", text: text.slice(0, 600), raw_keys: Object.keys(j) });

    // surface usage/citations so we can measure the real cost-per-pulse from the first live call
    return J({ pulse, usage: j.usage || null, citations: j.citations || j.sources || null });
  },
};
