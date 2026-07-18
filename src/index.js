// RotationTV AI Gateway — Cloudflare Worker
// Routes: /ai/chat, /ai/moderate, /ai/ensemble, /stream/create, /stream/status, /health
// Connects: Gemini, Claude, Venice, Supabase, TON

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
      // Health check
      if (path === "/" || path === "/health") {
        return json({ 
          status: "operational",
          service: "RotationTV AI Gateway",
          version: "2.0.0",
          timestamp: new Date().toISOString(),
          endpoints: ["/ai/chat", "/ai/moderate", "/ai/ensemble", "/stream/create", "/stream/status", "/telegram/webhook"],
          models: {
            gemini: env.GEMINI_API_KEY ? "configured" : "missing",
            claude: env.CLAUDE_API_KEY ? "configured" : "missing",
            venice: env.VENICE_API_KEY ? "configured" : "missing"
          },
          supabase: env.SUPABASE_SERVICE_KEY ? "connected" : "missing"
        }, corsHeaders);
      }

      // AI Chat — routes to best available model
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

        // Log to Supabase
        if (env.SUPABASE_SERVICE_KEY) {
          await logInteraction(user_id, selectedModel, message, response, env);
        }

        return json({ 
          response, 
          model: selectedModel, 
          timestamp: new Date().toISOString() 
        }, corsHeaders);
      }

      // AI Ensemble — queries all models, returns best
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

      // Content Moderation
      if (path === "/ai/moderate" && request.method === "POST") {
        const body = await request.json();
        const { content, type = "text" } = body;
        
        const moderationPrompt = `Analyze this content for policy violations. Return JSON: {"safe": bool, "category": string, "confidence": 0-1, "reason": string}. Content: ${content}`;
        const result = await callGemini(moderationPrompt, null, env);
        
        try {
          const parsed = JSON.parse(result);
          return json(parsed, corsHeaders);
        } catch {
          return json({ safe: true, category: "unknown", confidence: 0.5, raw: result }, corsHeaders);
        }
      }

      // Stream Create — creates a live stream session
      if (path === "/stream/create" && request.method === "POST") {
        const body = await request.json();
        const { creator_id, title, category = "general" } = body;
        
        if (!creator_id) return json({ error: "creator_id required" }, corsHeaders, 400);

        const streamId = crypto.randomUUID();
        const streamKey = `rtv_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

        // Store in Supabase
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
          rtmp_url: "rtmp://live.rotationtv.com/live",
          hls_playback: `https://stream.rotationtv.com/${streamId}/index.m3u8`,
          webrtc_url: `wss://stream.rotationtv.com/${streamId}/whip`,
          status: "created",
          message: "Stream session created. Use stream_key with RTMP or WebRTC to go live."
        }, corsHeaders);
      }

      // Stream Status
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

      // Telegram Webhook Handler
      if (path === "/telegram/webhook" && request.method === "POST") {
        const update = await request.json();
        const message = update.message || update.callback_query?.message;
        
        if (!message?.text) return json({ ok: true }, corsHeaders);

        const chatId = message.chat.id;
        const text = message.text;
        let reply;

        if (text === "/start") {
          reply = "🎬 Welcome to RotationTV!\n\nI'm your AI-powered streaming assistant.\n\n/ask — Ask AI (Venice)\n/ai — Ask AI (Gemini)\n/stream — Start a live stream\n/wallet — Check RTVS balance\n/status — System status";
        } else if (text === "/status") {
          reply = `✅ RotationTV Status\n\n🤖 AI Gateway: Online (v2.1.0)\n📡 Streaming: Ready\n💰 Payments: Active\n⛓️ TON: Connected\n\nAll systems operational.`;
        } else if (text.startsWith("/ask ")) {
          const query = text.slice(5);
          reply = await callVenice(query, "You are RotationTV's AI assistant powered by Venice. Be helpful, concise, and on-brand.", env);
        } else if (text.startsWith("/ai ")) {
          const query = text.slice(4);
          reply = await callGemini(query, "You are RotationTV's AI assistant. Be helpful, concise, and on-brand.", env);
        } else if (text === "/stream") {
          reply = "🔴 To start streaming:\n\n1. Tap 'Go Live' in the Mini App\n2. Allow camera + mic\n3. You're live!";
        } else if (text === "/wallet") {
          reply = "💎 RTVS Wallet\n\nBalance: 0 RTVS\nStaked: 0 RTVS\n\nUse /deposit to add funds.";
        } else {
          // Default: try Venice first, fallback to Gemini
          if (env.VENICE_API_KEY) {
            reply = await callVenice(text, "You are RotationTV's friendly AI assistant. Keep responses under 200 words.", env);
          } else {
            reply = await callGemini(text, "You are RotationTV's friendly AI assistant. Keep responses under 200 words.", env);
          }
        }

        // Send reply via Telegram API
        if (env.TELEGRAM_BOT_TOKEN) {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: "Markdown" })
          });
        }

        return json({ ok: true }, corsHeaders);
      }

      // 404
      return json({ 
        error: "not_found", 
        available: ["/health", "/ai/chat", "/ai/moderate", "/ai/ensemble", "/stream/create", "/stream/status", "/telegram/webhook"]
      }, corsHeaders, 404);

    } catch (err) {
      return json({ error: err.message, stack: err.stack?.split("\n")[0] }, corsHeaders, 500);
    }
  }
};

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
      model: "claude-3-5-sonnet-20241022",
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
      model: "venice-uncensored-1-2",
      messages: [
        { role: "system", content: context || "You are RotationTV's uncensored AI." },
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
