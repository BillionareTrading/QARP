// qarp-grok-worker.js — Cloudflare Worker that proxies Grok (xAI) reads for the QARP site.
// TWO MODES, one secret key (XAI_API_KEY), both fixed server-side prompts so the key can
// never be used for arbitrary questions:
//   (default)          "Social Pulse"  — live X sentiment for the drawer + cloud refresh job.
//   mode: "catalyst"   "Catalyst Desk" — live web+X search for the nearest DATED catalyst;
//                      called once per market day by the build for holdings + unheld SBs.
// DEPLOY: Cloudflare -> Workers -> qarp-grok -> paste this -> Deploy. Secret unchanged.

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
    const mode = String(body.mode || "pulse");

    let prompt, tools;
    if (mode === "catalyst") {
      // ---- Catalyst Desk v2: dated events, breakdown fields, the earnings rule ----
      tools = [{ type: "web_search" }, { type: "x_search" }];
      prompt =
        `You are a catalyst analyst for a value desk. Search the live web (and X only if it surfaces ` +
        `something material) for ${name} ($${symbol}). Run AT MOST 2 searches total. Find:\n` +
        `1. The NEAREST REAL upcoming catalyst: a dated or credibly-windowed event with asymmetric ` +
        `re-rating potential — regulatory/clinical decisions, product launches, investor days, ` +
        `announced deal closings, activist deadlines, macro rulings that hit THIS name.\n` +
        `2. The next scheduled earnings date (always report it separately as next_print).\n` +
        `3. Any MATERIAL news from the last 72 hours (contract, guidance, M&A, thesis-changing action).\n` +
        `THE EARNINGS RULE: every company has earnings — a scheduled print is a CALENDAR item, not a ` +
        `catalyst. Earnings may be THE catalyst ONLY when something specific and identifiable rides on ` +
        `that print (a guidance inflection the street doubts, first profitable quarter, a binary ` +
        `disclosure expected inside it, proof point of a disputed thesis). If you claim earnings as the ` +
        `catalyst, the "why" MUST name what rides on it — otherwise put the print in next_print only ` +
        `and find the real catalyst or say NONE.\n` +
        `OTHER RULES (strict): only facts you actually found with a source; NEVER invent an event or ` +
        `date; price levels / "breakouts" are NOT catalysts; analyst target changes alone are NOT ` +
        `catalysts unless the thesis changed; honest NONE is a finding.\n` +
        (context ? `Desk context: ${context}\n` : "") +
        `\nLABELS: "SET" = real catalyst, dated, within 45 days. "WATCH" = credible catalyst path, ` +
        `undated or beyond 45 days. "NONE" = no real catalyst found (next_print may still exist).\n` +
        `Return ONLY a JSON object (no prose, no code fences):\n` +
        `{"symbol":"${symbol}","catalyst_label":"SET|WATCH|NONE",` +
        `"event":"<the catalyst in <=8 words, or null>",` +
        `"event_type":"earnings-loaded|regulatory|clinical|product|deal-close|capital-return|macro|activist|other",` +
        `"event_date":"YYYY-MM-DD or null","window":"<e.g. 'mid-September' when undated, or null>",` +
        `"next_print":"YYYY-MM-DD or null",` +
        `"why":"<<=180 chars: the MECHANISM — what specifically re-rates the stock if this lands>",` +
        `"risk":"<<=140 chars: what kills this catalyst / makes it a dud>",` +
        `"news_72h":"<one line of fresh material news, or null>",` +
        `"confidence":"HIGH|MED|LOW","as_of":"<ISO time>"}`;
    } else {
      // ---- Social Pulse (unchanged) ----
      tools = [{ type: "x_search" }];
      prompt =
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
    }

    const payload = {
      model: MODEL,
      input: [{ role: "user", content: prompt }],
      tools: tools,
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
    let out = null;
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) { try { out = JSON.parse(text.slice(a, b + 1)); out.symbol = symbol; } catch (e) {} }
    if (!out) return J({ error: "parse failed", text: text.slice(0, 600), raw_keys: Object.keys(j) });

    // usage/citations surfaced so the build can log the real cost per call
    const key = mode === "catalyst" ? "catalyst" : "pulse";
    return J({ [key]: out, usage: j.usage || null, citations: j.citations || j.sources || null });
  },
};
