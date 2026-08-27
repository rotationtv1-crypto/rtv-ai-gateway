# RotationTV AI Gateway

Unified AI Gateway for the RotationTV ecosystem. Routes requests to Gemini, Venice, and Claude AI models with automatic fallback.

## Live Endpoints

- **Health:** https://rtv-ai-gateway.rotationtvaicom.workers.dev/health
- **AI Chat:** POST /ai/chat — `{ "message": "...", "model": "auto|gemini|venice|claude" }` *(live v2.1.0; GitHub source is the Telegram-native v2.2 Worker plus Stream routes)*
- **Stream Create:** POST /stream/create — Cloudflare Stream live input. Requires `Authorization: Bearer $ADMIN_SECRET` and JSON `{ "creator_id": "...", "name": "optional" }`.
- **Stream Status:** GET /stream/status?id=<uid>
- **Stream Playback:** GET /stream/playback/:uid — short-lived HLS/DASH URLs. Tokens come from the native `STREAM` Worker binding when attached.
- **Telegram Webhook:** POST /telegram/webhook

ECS hosts LiveKit/media only. Do not point the Mini App at an ECS public API.

## Secrets Required

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
wrangler secret put ADMIN_SECRET
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_STREAM_API_TOKEN
wrangler secret put CF_STREAM_CUSTOMER_SUBDOMAIN
```

## Deploy

```bash
npx wrangler deploy
```

## Architecture

```
Mini App / OBS → POST /stream/create → Cloudflare Stream live input (RTMPS / WHIP)
Viewer → GET /stream/playback/:uid → signed HLS
Telegram User → Bot → /telegram/webhook → AI Router → Venice (primary)
                                                    ↓ fallback
                                                  Gemini 2.5 Flash
                                                    ↓ fallback
                                              Workers AI
ECS → LiveKit / media workers only
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
