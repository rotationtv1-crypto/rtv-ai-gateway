# RotationTV AI Gateway

Unified AI Gateway for the RotationTV ecosystem. Routes requests to Gemini, Venice, and Claude AI models with automatic fallback.

## Live Endpoints

- **Health:** https://rtv-ai-gateway.rotationtvaicom.workers.dev/health
- **AI Chat:** POST /ai/chat — `{ "message": "...", "model": "auto|gemini|venice|claude" }`
- **AI Ensemble:** POST /ai/ensemble — Multi-model parallel inference
- **Content Moderation:** POST /ai/moderate
- **Stream Create:** POST /stream/create
- **Stream Status:** GET /stream/status?id=xxx
- **Telegram Webhook:** POST /telegram/webhook

## Telegram Commands

- `/start` — Welcome + command list
- `/ask <text>` — Venice AI inference
- `/ai <text>` — Gemini AI inference
- `/stream` — Stream instructions
- `/wallet` — Wallet status
- `/status` — System status
- Plain text — Auto-routed (Venice preferred, Gemini fallback)

## Secrets Required

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put VENICE_API_KEY
wrangler secret put VENICE_API_KEY_2
wrangler secret put VENICE_API_KEY_3
wrangler secret put CLAUDE_API_KEY
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
```

## Deploy

```bash
npx wrangler deploy
```

## Architecture

```
Telegram User → Bot → /telegram/webhook → AI Router → Venice (primary)
                                                    ↓ fallback
                                                  Gemini 2.5 Flash
                                                    ↓ fallback
                                                  Claude
                                                    ↓
                                              Supabase (logs + streams)
```


---

## 🚀 Full Scale Deployment (2026-07-18 23:23)

This repository is part of the RotationTV Network Full Scale Deployment.

### Deploy to Cloudflare Workers:
```bash
npm install
npx wrangler deploy
```

### Environment Secrets Required:
```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CLAUDE_API_KEY
npx wrangler secret put VENICE_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

### Status: 🟢 PRODUCTION
