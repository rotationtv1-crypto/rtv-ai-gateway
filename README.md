# RotationTV AI Gateway

Unified AI Gateway for the RotationTV ecosystem. Routes requests to Gemini, Claude, and Venice AI models with automatic fallback.

## Live Endpoints

- **Health:** https://rtv-ai-gateway.rotationtvaicom.workers.dev/health
- **AI Chat:** POST /ai/chat
- **AI Ensemble:** POST /ai/ensemble
- **Content Moderation:** POST /ai/moderate
- **Stream Create:** POST /stream/create
- **Stream Status:** GET /stream/status?id=xxx
- **Telegram Webhook:** POST /telegram/webhook

## Secrets Required

```bash
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put SUPABASE_URL
wrangler secret put GEMINI_API_KEY
wrangler secret put CLAUDE_API_KEY
wrangler secret put VENICE_API_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
```

## Deploy

```bash
npx wrangler deploy
```

## Architecture

```
Telegram User → Bot → /telegram/webhook → AI Router → Gemini/Claude/Venice
                                                    ↓
                                              Supabase (logs + streams)
```
