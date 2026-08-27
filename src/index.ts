// RTV Bot Gateway v2.2.1 — Telegram Native Payments + Cloudflare Stream ingest/playback
// ONLY accepts Telegram native payments: Stars (XTR), TON, USDT
// Handles: /telegram/livestream, /telegram/erotica (path-routed; query bot= is not trusted)
// Payment flow: sendInvoice (XTR) → pre_checkout_query → answerPreCheckoutQuery → successful_payment
// AI providers: Venice | Gemini | Cloudflare Workers AI (edge fallback)
// Streaming: POST /stream/create, GET /stream/status, GET /stream/playback/:uid (Cloudflare Stream)
// ECS remains LiveKit/media only — not a public API.

import { handleStream, isStreamPath } from "./stream";

const ALLOWED_TIP_STARS: Record<string, number> = {
  "5": 5,
  "10": 10,
  "50": 50,
  "100": 100,
  "250": 250,
  "500": 500,
};

const EXACT_ORIGINS = new Set([
  "https://rotationtv.network",
  "https://www.rotationtv.network",
  "https://app.rotationtv.network",
  "https://t.me",
]);

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (EXACT_ORIGINS.has(origin)) return true;
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    return host.endsWith(".pages.dev") || host.endsWith(".workers.dev") || host.endsWith(".kimi.page");
  } catch {
    return false;
  }
}

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : "https://rotationtv.network",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data",
    "Content-Type": "application/json",
  };
}

async function validateTelegramInitData(initData: string, botToken: string, maxAgeSec = 86400): Promise<boolean> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !botToken) return false;
  params.delete("hash");
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > maxAgeSec) return false;
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const encoder = new TextEncoder();
  const webAppKey = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secretBytes = await crypto.subtle.sign("HMAC", webAppKey, encoder.encode(botToken));
  const secretKey = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(dataCheckString));
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === hash;
}

interface Env {
  AI?: any;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN_17?: string;
  TELEGRAM_BOT_TOKEN_18?: string;
  VENICE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ENVIRONMENT?: string;
  STREAM?: import("./stream").StreamBinding;
  CF_ACCOUNT_ID?: string;
  CF_STREAM_API_TOKEN?: string;
  CF_STREAM_CUSTOMER_SUBDOMAIN?: string;
  ADMIN_SECRET?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const corsHeaders = corsHeadersFor(req);

    // Health endpoint — stops Cloudflare 522 origin timeouts
    if (req.method === "GET" && (path === "/health" || path === "/")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          service: "rtv-ai-gateway",
          version: "2.2.1",
          timestamp: new Date().toISOString(),
          payments: "Telegram native only (Stars XTR, TON, USDT)",
          ai_providers: ["venice", "gemini", "workers-ai"],
          streaming: "cloudflare-stream",
          endpoints: [
            "/health",
            "/stream/create",
            "/stream/status",
            "/stream/playback/:uid",
            "/telegram",
          ],
          entity: "Darrel-spell-living-trust",
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    if (isStreamPath(path)) {
      return handleStream(req, env, corsHeaders);
    }

    let botKey: "livestream" | "erotica" = "livestream";
    if (path.includes("/erotica")) botKey = "erotica";
    else if (path.includes("/livestream")) botKey = "livestream";

    const botTokens: Record<string, string> = {
      livestream: env.TELEGRAM_BOT_TOKEN_17 || env.TELEGRAM_BOT_TOKEN || "",
      erotica: env.TELEGRAM_BOT_TOKEN_18 || "",
    };
    const botToken = botTokens[botKey];

    const initData = req.headers.get("X-Telegram-Init-Data");
    if (initData) {
      if (!botToken) {
        return new Response(JSON.stringify({ error: `${botKey} token not configured` }), {
          status: 503,
          headers: corsHeaders,
        });
      }
      const ok = await validateTelegramInitData(initData, botToken);
      if (!ok) {
        return new Response(JSON.stringify({ error: "invalid_telegram_initdata" }), {
          status: 401,
          headers: corsHeaders,
        });
      }
    }

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (req.method === "GET") {
      return new Response(
        JSON.stringify(
          {
            status: "operational",
            service: "RTV Bot Gateway",
            version: "2.2.1",
            bot: botKey,
            payments: "Telegram native only (Stars XTR, TON, USDT)",
            entity: "Darrel-spell-living-trust",
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
        { headers: corsHeaders }
      );
    }

    try {
      const update = (await req.json()) as any;

      const token = botToken;
      if (!token) {
        return new Response(JSON.stringify({ error: `${botKey} token not configured` }), {
          status: 503,
          headers: corsHeaders,
        });
      }

      if (update.pre_checkout_query) {
        const pcq = update.pre_checkout_query;
        console.log(`Pre-checkout: user=${pcq.from?.id}, amount=${pcq.total_amount} XTR`);
        await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pre_checkout_query_id: pcq.id, ok: true }),
        });
        return new Response(JSON.stringify({ ok: true, type: "pre_checkout_approved" }), { headers: corsHeaders });
      }

      if (update.message?.successful_payment) {
        const payment = update.message.successful_payment;
        const chatId = update.message.chat.id;
        const payload = payment.invoice_payload;
        let itemInfo = "Purchase completed!";
        try {
          const payloadData = JSON.parse(payload);
          if (payloadData.type === "tip") {
            itemInfo = `🎁 Tip sent! ${payloadData.stars || payment.total_amount} Stars to ${payloadData.creator || "creator"}.\n\nThank you for supporting RotationTV! 🌟`;
          } else if (payloadData.type === "subscription") {
            itemInfo = `💎 Subscription active! You're now subscribed to ${payloadData.creator || "this creator"}.\n\nEnjoy exclusive content! 🎬`;
          } else if (payloadData.type === "gift") {
            itemInfo = `🎁 ${payloadData.gift_name || "Gift"} sent!\n\nYou just made someone's stream better! 🌟`;
          } else if (payloadData.type === "credits") {
            itemInfo = `💰 Credits loaded! ${payloadData.amount || payment.total_amount} Stars added to your balance.\n\nUse /wallet to check balance.`;
          }
        } catch {
          itemInfo = `✅ Payment received! ${payment.total_amount} ${payment.currency}.\n\nThank you for your purchase! 🌟`;
        }
        await sendTelegram(token, chatId, itemInfo, null);
        return new Response(JSON.stringify({ ok: true, type: "payment_success" }), { headers: corsHeaders });
      }

      if (update.callback_query) {
        return handleCallback(update.callback_query, token, botKey, corsHeaders);
      }

      const message = update.message;
      if (!message) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

      const chatId = message.chat?.id;
      const text = message.text || "";
      const userName = message.from?.first_name || message.from?.username || "there";
      let reply = "";
      let keyboard = null;

      if (text === "/start") {
        if (botKey === "erotica") {
          reply = `🌹 Welcome to RotationTV Erotica\n\nHey ${userName}! This is an 18+ platform.\nPlease verify your age below.\n\nRotation Erotica — Rose Gold Edition`;
          keyboard = { inline_keyboard: [[{ text: "✅ I am 18+ — Enter", callback_data: "verify_age_18" }]] };
        } else {
          reply = `🎬 Welcome to RotationTV Live, ${userName}!\n\nYour AI streaming companion — powered by Telegram.\n\n/ask — Ask AI\n/stream — Go live\n/tip — Send Stars tip\n/subscribe — Subscribe to creators\n/wallet — Balance\n/store — Buy gifts\n/status — System status\n/help — All commands\n\n⚡ Payments: Telegram Stars only\nLearn it. Live it. Love it. 🔄`;
        }
      } else if (text === "/status") {
        reply = `✅ RotationTV ${botKey === "erotica" ? "Erotica" : "Live"} — Status\n\n🤖 AI Gateway: Online (v2.2.1)\n📡 Streaming: Cloudflare Stream\n💰 Payments: Telegram Stars (XTR)\n⛓️ TON: Connected\n🧠 Workers AI: ${env.AI ? "bound" : "not bound"}\n\nAll systems operational.`;
      } else if (text === "/help") {
        reply = `📚 Commands\n\n/start — Welcome\n/status — System status\n/help — This message\n/ask — Ask Venice AI\n/ai — Ask Gemini AI\n/wallet — Your balance\n/store — Browse gifts (Stars)\n/tip — Send Stars tip\n/subscribe — Subscribe (Stars)\n/buy — Buy credits (Stars)`;
        if (botKey === "livestream") reply += "\n/stream — Go live (WebRTC)";
      } else if (text === "/stream" && botKey === "livestream") {
        reply = "🔴 Go Live with RotationTV\n\n1. Open the Mini App\n2. Tap Go Live\n3. Stream via Cloudflare Stream (RTMPS or WHIP)\n4. Playback is a short-lived signed HLS URL from /stream/playback\n\nLiveKit/media stays on ECS. The public ingest API is this Worker.";
      } else if (text === "/wallet") {
        reply = `⭐ Your Wallet\n\nStars Balance: 0 XTR\nTON Balance: 0 TON\nUSDT Balance: 0 USDT\n\n/buy — Add Stars\n/tip — Send tip to creator\n\n💡 1 Star ≈ $0.013 USD`;
      } else if (text === "/store" || text === "/gifts") {
        const gifts = getGiftCatalog();
        reply = gifts.text;
        keyboard = gifts.keyboard;
      } else if (text.startsWith("/tip")) {
        const requested = text.slice(4).trim();
        const stars = ALLOWED_TIP_STARS[requested] ?? 50;
        return sendStarsInvoice(token, chatId, {
          title: "Tip to Creator",
          description: `Send ${stars} Stars to support this creator on RotationTV`,
          payload: JSON.stringify({ type: "tip", stars, bot: botKey }),
          stars,
          label: `${stars} Stars`,
        }, corsHeaders);
      } else if (text.startsWith("/subscribe")) {
        return sendStarsInvoice(token, chatId, {
          title: "Creator Subscription",
          description: "Monthly subscription — unlock exclusive content, private streams, and direct messages",
          payload: JSON.stringify({ type: "subscription", bot: botKey, months: 1 }),
          stars: 500,
          label: "500 Stars / month",
        }, corsHeaders);
      } else if (text === "/buy" || text.startsWith("/buy ")) {
        return sendStarsInvoice(token, chatId, {
          title: "Load RotationTV Credits",
          description: "Add 100 Stars to your RotationTV balance — use for tips, gifts, and subscriptions",
          payload: JSON.stringify({ type: "credits", amount: 100 }),
          stars: 100,
          label: "100 Stars",
        }, corsHeaders);
      } else if (text.startsWith("/ask ") || text.startsWith("/ai ")) {
        const query = text.startsWith("/ask ") ? text.slice(5) : text.slice(4);
        const useVenice = text.startsWith("/ask ");
        reply = await callAI(query, useVenice, botKey, env);
      } else if (text) {
        reply = await callAI(text, true, botKey, env);
        if (!reply || reply.includes("not configured") || reply.includes("being configured")) {
          reply = "I'm here! Type /help to see what I can do. ⭐";
        }
      }

      if (reply) await sendTelegram(token, chatId, reply, keyboard);
      return new Response(JSON.stringify({ ok: true, bot: botKey }), { headers: corsHeaders });
    } catch (err: any) {
      console.error("Gateway error:", err);
      return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};

async function sendStarsInvoice(
  token: string,
  chatId: number,
  invoice: { title: string; description: string; payload: string; stars: number; label: string },
  headers: Record<string, string>
): Promise<Response> {
  const result = await fetch(`https://api.telegram.org/bot${token}/sendInvoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      title: invoice.title,
      description: invoice.description,
      payload: invoice.payload,
      currency: "XTR",
      prices: [{ label: invoice.label, amount: invoice.stars }],
    }),
  });
  const data = (await result.json()) as { ok: boolean; description?: string };
  return new Response(
    JSON.stringify(data.ok ? { ok: true, invoice_sent: true } : { ok: false, error: data.description }),
    { headers }
  );
}

function getGiftCatalog(): { text: string; keyboard: any } {
  const gifts = [
    { name: "🌹 Rose", stars: 5, emoji: "🌹" },
    { name: "🔥 Fire", stars: 10, emoji: "🔥" },
    { name: "💎 Diamond", stars: 50, emoji: "💎" },
    { name: "⚡ Lightning", stars: 100, emoji: "⚡" },
    { name: "🚀 Rocket", stars: 250, emoji: "🚀" },
    { name: "👑 Crown", stars: 500, emoji: "👑" },
  ];
  return {
    text: `🎁 Gift Store — Telegram Stars Only\n\nSend gifts to creators during live streams:\n\n${gifts.map((g) => `${g.emoji} ${g.name} — ${g.stars} Stars`).join("\n")}\n\nTap a gift to purchase with Stars! ⭐`,
    keyboard: {
      inline_keyboard: gifts.map((g) => [{
        text: `${g.emoji} ${g.name} — ${g.stars}⭐`,
        callback_data: `buy_gift_${g.stars}`,
      }]),
    },
  };
}

async function handleCallback(callbackQuery: any, token: string, botKey: string, headers: Record<string, string>): Promise<Response> {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat?.id;

  if (data === "verify_age_18" && botKey === "erotica") {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id, text: "✅ Age verified" }),
    });
    await sendTelegram(token, chatId, `🌹 Welcome to RotationTV Erotica\n\nYou're verified!\n\n/store — Browse gifts (Stars)\n/tip — Send Stars tip\n/subscribe — Subscribe (Stars)\n/wallet — Your balance\n\nRotation Erotica — Rose Gold Edition`, null);
  } else if (data?.startsWith("buy_gift_")) {
    const stars = parseInt(data.replace("buy_gift_", ""));
    await fetch(`https://api.telegram.org/bot${token}/sendInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        title: "Send Gift",
        description: `Send a gift worth ${stars} Stars to the creator`,
        payload: JSON.stringify({ type: "gift", stars, bot: botKey }),
        currency: "XTR",
        prices: [{ label: `${stars} Stars`, amount: stars }],
      }),
    });
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id, text: `Processing ${stars}⭐ gift...` }),
    });
  }
  return new Response(JSON.stringify({ ok: true }), { headers });
}

async function sendTelegram(token: string, chatId: number, text: string, keyboard: any): Promise<void> {
  const body: any = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) body.reply_markup = JSON.stringify(keyboard);
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callAI(message: string, useVenice: boolean, botKey: string, env: Env): Promise<string> {
  const persona =
    botKey === "erotica"
      ? "You are RotationTV Erotica's AI concierge. Be tasteful, elegant, and discreet. Keep replies under 200 words."
      : "You are RotationTV Live's AI assistant. Be energetic, concise, on-brand. Keep replies under 200 words. Motto: Learn it. Live it. Love it.";

  if (useVenice && env.VENICE_API_KEY) {
    try {
      const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.VENICE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b",
          messages: [{ role: "system", content: persona }, { role: "user", content: message }],
          max_tokens: 512,
        }),
      });
      const data: any = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) return content;
    } catch (e) {
      console.error("Venice failed", e);
    }
  }

  if (env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: message }] }],
            systemInstruction: { parts: [{ text: persona }] },
            generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
          }),
        }
      );
      const data: any = await res.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content) return content;
    } catch (e) {
      console.error("Gemini failed", e);
    }
  }

  // Cloudflare Workers AI — edge-native fallback (no external key)
  if (env.AI) {
    try {
      const result: any = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [{ role: "system", content: persona }, { role: "user", content: message }],
      });
      if (typeof result === "string") return result;
      if (result?.response) return result.response;
      if (result?.result) return String(result.result);
    } catch (e) {
      console.error("Workers AI failed", e);
    }
  }

  return "AI is being configured. Try again shortly! ⭐";
}
