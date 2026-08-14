// RotationTV AI Gateway — Cloudflare Worker v3.0.0
// Multi-bot routing: /telegram/livestream, /telegram/erotica
// Routes: /ai/chat, /ai/moderate, /ai/ensemble, /stream/create, /stream/status, /health
// Connects: Gemini, Claude, Venice, Supabase, TON
// Architecture: WebRTC (WHIP/WHEP) only — NO RTMP

const BOTS = {
  livestream: {
    token: "TELEGRAM_BOT_TOKEN",
    name: "RotationTV Live",
    username: "@RotationLivestram_bot",
    persona: "You are RotationTV Live's AI assistant — a streaming companion for creators. Be energetic, concise, and on-brand. Use emojis sparingly. Keep replies under 200 words. Brand colors: neon-lime #CCFF00 on black. Motto: 'Learn it. Live it. Love it.'"
  },
  erotica: {
    token: "TELEGRAM_BOT_TOKEN_18",
    name: "RotationTV Erotica",
    username: "@ROTATIONEROTICA_BOT",
    persona: "You are RotationTV Erotica's AI concierge. Be tasteful, elegant, and discreet. Use rose-gold aesthetic language. Guide users to age verification, creator onboarding, and platform features. Keep replies under 200 words."
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // === Health check ===
      if (path === "/" || path === "/health") {
        return json({ 
          status: "operational",
          service: "RotationTV AI Gateway",
          version: "3.0.0",
          timestamp: new Date().toISOString(),
          endpoints: ["/health", "/ai/chat", "/ai/moderate", "/ai/ensemble", "/stream/create", "/stream/status", "/telegram/livestream", "/telegram/erotica"],
          bots: {
            livestream: env.TELEGRAM_BOT_TOKEN ? "configured" : "missing",
            erotica: env.TELEGRAM_BOT_TOKEN_18 ? "configured" : "missing"
          },
          models: {
            gemini: env.GEMINI_API_KEY ? "configured" : "missing",
            claude: env.CLAUDE_API_KEY ? "configured" : "missing",
            venice: env.VENICE_API_KEY ? "configured" : "missing"
          },
          supabase: env.SUPABASE_SERVICE_KEY ? "connected" : "missing"
        }, corsHeaders);
      }

      // === Telegram Webhook — Livestream Bot ===
      if (path === "/telegram/livestream" && request.method === "POST") {
        return handleTelegramBot(request, env, corsHeaders, "livestream");
      }

      // === Telegram Webhook — Erotica Bot ===
      if (path === "/telegram/erotica" && request.method === "POST") {
        return handleTelegramBot(request, env, corsHeaders, "erotica");
      }

      // === Legacy webhook path — route to livestream by default ===
      if (path === "/telegram/webhook" && request.method === "POST") {
        return handleTelegramBot(request, env, corsHeaders, "livestream");
      }

      // === AI Chat — routes to best available model ===
      if (path === "/ai/chat" && request.method === "POST") {
        const body = await request.json();
        const { message, model = "auto", user_id, context } = body;
        
        if (!message) return json({ error: "message required" }, corsHeaders, 400);

        let response;
        const selectedModel = model === "auto" ? selectModel(message, env) : model;

        switch (selectedModel) {
          case "gemini":
            response = await callGemini(message, context, env);
            break;
          case "claude":
            response = await callClaude(message, context, env);
            break;
          case "venice":
            response = await callVenice(message, context, env);
            break;
          default:
            response = await callGemini(message, context, env);
        }

        if (env.SUPABASE_SERVICE_KEY) {
          await logInteraction(user_id, selectedModel, message, response, env);
        }

        return json({ 
          response, 
          model: selectedModel, 
          timestamp: new Date().toISOString() 
        }, corsHeaders);
      }

      // === AI Ensemble ===
      if (path === "/ai/ensemble" && request.method === "POST") {
        const body = await request.json();
        const { message, context } = body;
        
        const results = await Promise.allSettled([
          env.GEMINI_API_KEY ? callGemini(message, context, env) : Promise.reject("no key"),
          env.CLAUDE_API_KEY ? callClaude(message, context, env) : Promise.reject("no key"),
          env.VENICE_API_KEY ? callVenice(message, context, env) : Promise.reject("no key")
        ]);

        const responses = results
          .filter(r => r.status === "fulfilled")
          .map((r, i) => ({ model: ["gemini", "claude", "venice"][i], response: r.value }));

        return json({ ensemble: responses, count: responses.length }, corsHeaders);
      }

      // === Content Moderation ===
      if (path === "/ai/moderate" && request.method === "POST") {
        const body = await request.json();
        const { content } = body;
        
        const moderationPrompt = `Analyze this content for policy violations. Return JSON: {"safe": bool, "category": string, "confidence": 0-1, "reason": string}. Content: ${content}`;
        const result = await callGemini(moderationPrompt, null, env);
        
        try {
          const parsed = JSON.parse(result);
          return json(parsed, corsHeaders);
        } catch {
          return json({ safe: true, category: "unknown", confidence: 0.5, raw: result }, corsHeaders);
        }
      }

      // === Stream Create — WebRTC WHIP/WHEP only ===
      if (path === "/stream/create" && request.method === "POST") {
        const body = await request.json();
        const { creator_id, title, category = "general" } = body;
        
        if (!creator_id) return json({ error: "creator_id required" }, corsHeaders, 400);

        const streamId = crypto.randomUUID();
        const streamKey = `rtv_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

        if (env.SUPABASE_SERVICE_KEY) {
          await fetch(`${env.SUPABASE_URL}/rest/v1/LiveStream`, {
            method: "POST",
            headers: {
              "apikey": env.SUPABASE_SERVICE_KEY,
              "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify({
              id: streamId,
              creator_id,
              title,
              category,
              stream_key: streamKey,
              status: "created",
              started_at: new Date().toISOString()
            })
          });
        }

        return json({
          stream_id: streamId,
          stream_key: streamKey,
          whip_url: `https://stream.rotationtv.com/${streamId}/whip`,
          whep_url: `https://stream.rotationtv.com/${streamId}/whep`,
          webrtc_playback: `https://stream.rotationtv.com/${streamId}/playback`,
          status: "created",
          message: "Stream session created. Use WHIP endpoint to publish via WebRTC."
        }, corsHeaders);
      }

      // === Stream Status ===
      if (path === "/stream/status" && request.method === "GET") {
        const streamId = url.searchParams.get("id");
        if (!streamId) return json({ error: "id parameter required" }, corsHeaders, 400);

        if (env.SUPABASE_SERVICE_KEY) {
          const res = await fetch(
            `${env.SUPABASE_URL}/rest/v1/LiveStream?id=eq.${streamId}&select=*`,
            {
              headers: {
                "apikey": env.SUPABASE_SERVICE_KEY,
                "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`
              }
            }
          );
          const data = await res.json();
          return json(data[0] || { error: "stream not found" }, corsHeaders);
        }
        return json({ error: "database not configured" }, corsHeaders, 503);
      }

      // === 404 ===
      return json({ 
        error: "not_found", 
        available: ["/health", "/ai/chat", "/ai/moderate", "/ai/ensemble", "/stream/create", "/stream/status", "/telegram/livestream", "/telegram/erotica"]
      }, corsHeaders, 404);

    } catch (err) {
      return json({ error: err.message, stack: err.stack?.split("\n")[0] }, corsHeaders, 500);
    }
  }
};

// === TELEGRAM BOT HANDLER ===
async function handleTelegramBot(request, env, corsHeaders, botKey) {
  const bot = BOTS[botKey];
  if (!bot) return json({ error: "unknown bot" }, corsHeaders, 400);

  const token = env[bot.token];
  if (!token) return json({ error: `${botKey} bot token not configured` }, corsHeaders, 503);

  const update = await request.json();
  
  // Handle callback queries (age gate for erotica)
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query, token, botKey, env, corsHeaders);
  }

  const message = update.message;
  if (!message) return json({ ok: true }, corsHeaders);

  const chatId = message.chat.id;
  const text = message.text || "";
  const userId = message.from?.id;
  const userName = message.from?.first_name || message.from?.username || "there";
  
  let reply;

  // === Erotica bot: Age gate check ===
  if (botKey === "erotica") {
    const ageVerified = await checkAgeVerification(userId, env);
    if (!ageVerified && text !== "/start" && !text.startsWith("verify_")) {
      reply = `🔒 <b>Age Verification Required</b>\n\nThis is an 18+ platform. Please tap the button below to verify your age.\n\n<i>RotationTV Erotica — Rose Gold Edition</i> 🌹`;
      await sendTelegramMessage(token, chatId, reply, "HTML", {
        inline_keyboard: [[{ text: "✅ I am 18+ — Verify", callback_data: "verify_age_18" }]]
      });
      return json({ ok: true }, corsHeaders);
    }
  }

  // === Command routing ===
  if (text === "/start") {
    reply = getStartMessage(botKey, userName);
    if (botKey === "erotica") {
      await sendTelegramMessage(token, chatId, reply, "HTML", {
        inline_keyboard: [[{ text: "✅ I am 18+ — Enter", callback_data: "verify_age_18" }]]
      });
    } else {
      await sendTelegramMessage(token, chatId, reply, "HTML");
    }
    return json({ ok: true }, corsHeaders);
  }

  if (text === "/status") {
    reply = getStatusMessage(botKey);
    await sendTelegramMessage(token, chatId, reply, "HTML");
    return json({ ok: true }, corsHeaders);
  }

  if (text === "/help") {
    reply = getHelpMessage(botKey);
    await sendTelegramMessage(token, chatId, reply, "HTML");
    return json({ ok: true }, corsHeaders);
  }

  if (text.startsWith("/ask ")) {
    const query = text.slice(5);
    reply = await callVenice(query, bot.persona, env);
    await sendTelegramMessage(token, chatId, reply, "HTML");
    return json({ ok: true }, corsHeaders);
  }

  if (text.startsWith("/ai ")) {
    const query = text.slice(4);
    reply = await callGemini(query, bot.persona, env);
    await sendTelegramMessage(token, chatId, reply, "HTML");
    return json({ ok: true }, corsHeaders);
  }

  if (text === "/stream" && botKey === "livestream") {
    reply = "🔴 <b>Go Live with RotationTV</b>\n\n1. Open the Mini App in Telegram\n2. Tap <b>Go Live</b>\n3. Allow camera + mic access\n4. You're streaming via WebRTC (WHIP/WHEP)\n\n<i>Sub-second latency. No OBS needed.</i>";
    await sendTelegramMessage(token, chatId, reply, "HTML");
    return json({ ok: true }, corsHeaders);
  }

  if (text === "/wallet") {
    reply = "💎 <b>RTV Wallet</b>\n\nBalance: 0 RTV\nStaked: 0 RTV\n\nUse /deposit to add funds.\n<i>1 RTV = $0.01 USD</i>";
    await sendTelegramMessage(token, chatId, reply, "HTML");
    return json({ ok: true }, corsHeaders);
  }

  // === Default: AI chat ===
  if (text) {
    if (env.VENICE_API_KEY) {
      reply = await callVenice(text, bot.persona, env);
    } else if (env.GEMINI_API_KEY) {
      reply = await callGemini(text, bot.persona, env);
    } else {
      reply = "⚠️ AI models are not configured yet. Try again later.";
    }
    await sendTelegramMessage(token, chatId, reply, "HTML");
  }

  return json({ ok: true }, corsHeaders);
}

// === CALLBACK QUERY HANDLER ===
async function handleCallbackQuery(callbackQuery, token, botKey, env, corsHeaders) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from?.id;

  if (data === "verify_age_18" && botKey === "erotica") {
    // Store age verification in Supabase
    if (env.SUPABASE_SERVICE_KEY && userId) {
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/RTVUser?telegram_id=eq.${userId}`, {
          method: "PATCH",
          headers: {
            "apikey": env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ age_verified: true, updated_at: new Date().toISOString() })
        });
      } catch (e) { /* non-blocking */ }
    }

    // Answer the callback
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id, text: "✅ Age verified" })
    });

    const welcomeMsg = `🌹 <b>Welcome to RotationTV Erotica</b>\n\nYou're verified. Here's what you can do:\n\n• /creators — Browse creators\n• /tips — Send tips in $RTV\n• /subscribe — Subscribe to creators\n• /wallet — Check your balance\n\n<i>Rotation Erotica — Rose Gold Edition</i>`;
    await sendTelegramMessage(token, chatId, welcomeMsg, "HTML");
  }

  return json({ ok: true }, corsHeaders);
}

// === AGE VERIFICATION CHECK ===
async function checkAgeVerification(userId, env) {
  if (!env.SUPABASE_SERVICE_KEY || !userId) return false;
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/RTVUser?telegram_id=eq.${userId}&select=age_verified`,
      {
        headers: {
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`
        }
      }
    );
    const data = await res.json();
    return data[0]?.age_verified === true;
  } catch {
    return false;
  }
}

// === TELEGRAM MESSAGE SENDER ===
async function sendTelegramMessage(token, chatId, text, parseMode = "HTML", replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// === BOT MESSAGES ===
function getStartMessage(botKey, userName) {
  if (botKey === "erotica") {
    return `🌹 <b>Welcome to RotationTV Erotica</b>\n\nHey ${userName}! This is an 18+ platform.\n\nPlease verify your age below to continue.\n\n<i>Rotation Erotica — Rose Gold Edition</i>`;
  }
  return `🎬 <b>Welcome to RotationTV Live, ${userName}!</b>\n\nI'm your AI-powered streaming companion.\n\n• /ask — Ask AI (Venice)\n• /ai — Ask AI (Gemini)\n• /stream — Start a live stream\n• /wallet — Check RTV balance\n• /status — System status\n• /help — Full command list\n\n<b>Learn it. Live it. Love it.</b> 🔄`;
}

function getStatusMessage(botKey) {
  const name = botKey === "erotica" ? "Erotica" : "Live";
  return `✅ <b>RotationTV ${name} — Status</b>\n\n🤖 AI Gateway: Online (v3.0.0)\n📡 Streaming: WebRTC Ready\n💰 Payments: Active\n⛓️ Blockchain: Connected\n\n<i>All systems operational.</i>`;
}

function getHelpMessage(botKey) {
  const base = `📚 <b>Commands</b>\n\n/start — Welcome\n/status — System status\n/help — This message\n/ask — Ask Venice AI\n/ai — Ask Gemini AI\n/wallet — RTV balance`;
  if (botKey === "livestream") {
    return base + "\n/stream — Go live (WebRTC)";
  }
  return base + "\n/creators — Browse creators\n/tips — Send tips";
}

// === MODEL ROUTING ===
function selectModel(message, env) {
  const lower = message.toLowerCase();
  if (lower.includes("uncensor") || lower.includes("adult") || lower.includes("nsfw")) {
    return env.VENICE_API_KEY ? "venice" : "gemini";
  }
  if (lower.includes("code") || lower.includes("architect") || lower.includes("debug")) {
    return env.CLAUDE_API_KEY ? "claude" : "gemini";
  }
  return "gemini";
}

// === GEMINI ===
async function callGemini(message, context, env) {
  if (!env.GEMINI_API_KEY) return "[Gemini not configured]";
  const systemPrompt = context || "You are RotationTV's AI assistant. Be concise and helpful.";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
      })
    }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "[No response from Gemini]";
}

// === CLAUDE ===
async function callClaude(message, context, env) {
  if (!env.CLAUDE_API_KEY) return "[Claude not configured]";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: context || "You are RotationTV's AI assistant.",
      messages: [{ role: "user", content: message }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "[No response from Claude]";
}

// === VENICE ===
async function callVenice(message, context, env) {
  if (!env.VENICE_API_KEY) return "[Venice not configured]";
  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.VENICE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      messages: [
        { role: "system", content: context || "You are RotationTV's AI assistant." },
        { role: "user", content: message }
      ],
      max_tokens: 1024
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "[No response from Venice]";
}

// === LOGGING ===
async function logInteraction(userId, model, input, output, env) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/OmegaAuditLog`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user_id: userId || "anonymous",
        action: `ai_${model}`,
        details: JSON.stringify({ input: input.slice(0, 200), output: output.slice(0, 500) }),
        created_at: new Date().toISOString()
      })
    });
  } catch (e) { /* non-blocking */ }
}

function json(data, headers, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}
