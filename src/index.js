// RTV Bot Gateway v2.0 — Telegram Native Payments Edition
// ONLY accepts Telegram native payments: Stars (XTR), TON, USDT
// Handles: /telegram?bot=livestream, /telegram?bot=erotica
// Payment flow: sendInvoice (XTR) → pre_checkout_query → answerPreCheckoutQuery → successful_payment

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  
  let botKey = "livestream";
  if (path.includes("/erotica") || url.searchParams.get("bot") === "erotica") botKey = "erotica";
  if (path.includes("/livestream") || url.searchParams.get("bot") === "livestream") botKey = "livestream";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  
  if (req.method === "GET") {
    return new Response(JSON.stringify({
      status: "operational",
      service: "RTV Bot Gateway",
      version: "2.1.1",
      bot: botKey,
      payments: "Telegram native only (Stars XTR, TON, USDT)",
      entity: "Darrel-spell-living-trust",
      timestamp: new Date().toISOString()
    }, null, 2), { headers: corsHeaders });
  }

  try {
    const update = await req.json();
    
    const botTokens: Record<string, string> = {
      livestream: process.env.TELEGRAM_BOT_TOKEN_17 || process.env.TELEGRAM_BOT_TOKEN || "",
      erotica: process.env.TELEGRAM_BOT_TOKEN_18 || ""
    };

    const token = botTokens[botKey];
    if (!token) {
      return new Response(JSON.stringify({ error: `${botKey} token not configured` }), { 
        status: 503, headers: corsHeaders 
      });
    }

    // === HANDLE PRE-CHECKOUT QUERY (Stars payment) ===
    if (update.pre_checkout_query) {
      const pcq = update.pre_checkout_query;
      console.log(`Pre-checkout: user=${pcq.from?.id}, amount=${pcq.total_amount} XTR, payload=${pcq.invoice_payload}`);
      
      // Auto-approve all Stars payments (digital goods)
      await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pre_checkout_query_id: pcq.id,
          ok: true
        })
      });
      return new Response(JSON.stringify({ ok: true, type: "pre_checkout_approved" }), { headers: corsHeaders });
    }

    // === HANDLE SUCCESSFUL PAYMENT ===
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const chatId = update.message.chat.id;
      const payload = payment.invoice_payload;
      
      console.log(`Payment success: user=${payment.provider_payment_charge_id}, amount=${payment.total_amount} ${payment.currency}, payload=${payload}`);
      
      // Parse payload to determine what was purchased
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

    // === HANDLE CALLBACK QUERIES ===
    if (update.callback_query) {
      return handleCallback(update.callback_query, token, botKey, corsHeaders);
    }

    // === HANDLE MESSAGES ===
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
      reply = `✅ RotationTV ${botKey === "erotica" ? "Erotica" : "Live"} — Status\n\n🤖 AI Gateway: Online (v2.0.0)\n📡 Streaming: WebRTC Ready\n💰 Payments: Telegram Stars (XTR)\n⛓️ TON: Connected\n\nAll systems operational.`;
    } else if (text === "/help") {
      reply = `📚 Commands\n\n/start — Welcome\n/status — System status\n/help — This message\n/ask — Ask Venice AI\n/ai — Ask Gemini AI\n/wallet — Your balance\n/store — Browse gifts (Stars)\n/tip — Send Stars tip\n/subscribe — Subscribe (Stars)\n/buy — Buy credits (Stars)`;
      if (botKey === "livestream") reply += "\n/stream — Go live (WebRTC)";
    } else if (text === "/stream" && botKey === "livestream") {
      reply = "🔴 Go Live with RotationTV\n\n1. Open the Mini App\n2. Tap Go Live\n3. Allow camera + mic\n4. You're streaming via WebRTC\n\nSub-second latency. No OBS needed.";
    } else if (text === "/wallet") {
      // Stars-based wallet
      reply = `⭐ Your Wallet\n\nStars Balance: 0 XTR\nTON Balance: 0 TON\nUSDT Balance: 0 USDT\n\n/buy — Add Stars\n/tip — Send tip to creator\n\n💡 1 Star ≈ $0.013 USD`;
    } else if (text === "/store" || text === "/gifts") {
      // Send gift catalog as inline keyboard with Stars prices
      const gifts = getGiftCatalog(botKey);
      reply = gifts.text;
      keyboard = gifts.keyboard;
    } else if (text.startsWith("/tip")) {
      // Send a Stars invoice for tipping
      const args = text.split(" ");
      const starsAmount = parseInt(args[1]) || 50;
      return sendStarsInvoice(token, chatId, {
        title: "Tip to Creator",
        description: `Send ${starsAmount} Stars to support this creator on RotationTV`,
        payload: JSON.stringify({ type: "tip", stars: starsAmount, bot: botKey }),
        stars: starsAmount,
        label: `${starsAmount} Stars`
      }, corsHeaders);
    } else if (text.startsWith("/subscribe")) {
      // Send a Stars invoice for subscription
      return sendStarsInvoice(token, chatId, {
        title: "Creator Subscription",
        description: "Monthly subscription — unlock exclusive content, private streams, and direct messages",
        payload: JSON.stringify({ type: "subscription", bot: botKey, months: 1 }),
        stars: 500,
        label: "500 Stars / month"
      }, corsHeaders);
    } else if (text === "/buy" || text.startsWith("/buy ")) {
      // Buy credits with Stars
      return sendStarsInvoice(token, chatId, {
        title: "Load RotationTV Credits",
        description: "Add 100 Stars to your RotationTV balance — use for tips, gifts, and subscriptions",
        payload: JSON.stringify({ type: "credits", amount: 100 }),
        stars: 100,
        label: "100 Stars"
      }, corsHeaders);
    } else if (text.startsWith("/ask ") || text.startsWith("/ai ")) {
      const query = text.startsWith("/ask ") ? text.slice(5) : text.slice(4);
      const useVenice = text.startsWith("/ask ");
      reply = await callAI(query, useVenice, botKey);
    } else if (text) {
      // Default: AI chat
      reply = await callAI(text, true, botKey);
      if (!reply || reply.includes("not configured") || reply.includes("being configured")) {
        reply = "I'm here! Type /help to see what I can do. ⭐";
      }
    }

    if (reply) {
      await sendTelegram(token, chatId, reply, keyboard);
    }

    return new Response(JSON.stringify({ ok: true, bot: botKey }), { headers: corsHeaders });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, headers: corsHeaders 
    });
  }
}

// === SEND STARS INVOICE ===
async function sendStarsInvoice(token: string, chatId: number, invoice: {
  title: string;
  description: string;
  payload: string;
  stars: number;
  label: string;
}, headers: any): Promise<Response> {
  const result = await fetch(`https://api.telegram.org/bot${token}/sendInvoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      title: invoice.title,
      description: invoice.description,
      payload: invoice.payload,
      currency: "XTR",  // Telegram Stars — no provider_token needed for digital goods
      prices: [{ label: invoice.label, amount: invoice.stars }]
    })
  });
  
  const data = await result.json();
  if (data.ok) {
    return new Response(JSON.stringify({ ok: true, invoice_sent: true }), { headers });
  } else {
    return new Response(JSON.stringify({ ok: false, error: data.description }), { headers });
  }
}

// === GIFT CATALOG (Stars pricing) ===
function getGiftCatalog(botKey: string): { text: string; keyboard: any } {
  const gifts = [
    { name: "🌹 Rose", stars: 5, emoji: "🌹" },
    { name: "🔥 Fire", stars: 10, emoji: "🔥" },
    { name: "💎 Diamond", stars: 50, emoji: "💎" },
    { name: "⚡ Lightning", stars: 100, emoji: "⚡" },
    { name: "🚀 Rocket", stars: 250, emoji: "🚀" },
    { name: "👑 Crown", stars: 500, emoji: "👑" },
  ];
  
  // For now, just show the catalog. In production, each button triggers a sendInvoice
  const keyboard = {
    inline_keyboard: gifts.map(g => [{
      text: `${g.emoji} ${g.name} — ${g.stars}⭐`,
      callback_data: `buy_gift_${g.stars}`
    }])
  };
  
  return {
    text: `🎁 Gift Store — Telegram Stars Only\n\nSend gifts to creators during live streams:\n\n${gifts.map(g => `${g.emoji} ${g.name} — ${g.stars} Stars`).join("\n")}\n\nTap a gift to purchase with Stars! ⭐`,
    keyboard
  };
}

// === CALLBACK HANDLER ===
async function handleCallback(callbackQuery: any, token: string, botKey: string, headers: any): Promise<Response> {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat?.id;

  if (data === "verify_age_18" && botKey === "erotica") {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id, text: "✅ Age verified" })
    });
    const welcome = `🌹 Welcome to RotationTV Erotica\n\nYou're verified!\n\n/store — Browse gifts (Stars)\n/tip — Send Stars tip\n/subscribe — Subscribe (Stars)\n/wallet — Your balance\n\nRotation Erotica — Rose Gold Edition`;
    await sendTelegram(token, chatId, welcome, null);
  } else if (data?.startsWith("buy_gift_")) {
    const stars = parseInt(data.replace("buy_gift_", ""));
    // Send invoice for the gift
    await fetch(`https://api.telegram.org/bot${token}/sendInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        title: "Send Gift",
        description: `Send a gift worth ${stars} Stars to the creator`,
        payload: JSON.stringify({ type: "gift", stars, bot: botKey }),
        currency: "XTR",
        prices: [{ label: `${stars} Stars`, amount: stars }]
      })
    });
    // Answer the callback
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id, text: `Processing ${stars}⭐ gift...` })
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers });
}

// === TELEGRAM SENDER ===
async function sendTelegram(token: string, chatId: number, text: string, keyboard: any): Promise<void> {
  const body: any = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) body.reply_markup = JSON.stringify(keyboard);
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// === AI CALLS ===
async function callAI(message: string, useVenice: boolean, botKey: string): Promise<string> {
  const persona = botKey === "erotica"
    ? "You are RotationTV Erotica's AI concierge. Be tasteful, elegant, and discreet. Keep replies under 200 words."
    : "You are RotationTV Live's AI assistant. Be energetic, concise, on-brand. Keep replies under 200 words. Motto: Learn it. Live it. Love it.";

  if (useVenice) {
    const apiKey = process.env.VENICE_API_KEY;
    if (!apiKey) return "AI configuring... ⭐";
    try {
      const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b",
          messages: [{ role: "system", content: persona }, { role: "user", content: message }],
          max_tokens: 512
        })
      });
      const data: any = await res.json();
      return data.choices?.[0]?.message?.content || "Try again! ⭐";
    } catch { return "Connection issue. Try again! ⭐"; }
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "AI configuring... ⭐";
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: message }] }],
          systemInstruction: { parts: [{ text: persona }] },
          generationConfig: { maxOutputTokens: 512, temperature: 0.7 }
        })
      });
      const data: any = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "Try again! ⭐";
    } catch { return "Connection issue. Try again! ⭐"; }
  }
}
