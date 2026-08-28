# rtv-ai-gateway

RotationTV AI Gateway — Unified API bridge for AI operations.

## Features

- Routes requests through Cloudflare AI Gateway
- Supports Workers AI (Llama 3.3) and Kimi API
- Intelligent model fallback
- Streaming support

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completion (OpenAI-compatible) |
| POST | `/v1/generate` | Content generation |
| GET | `/v1/health` | Gateway health |

## Configuration

- Account ID: `$CLOUDFLARE_ACCOUNT_ID`
- Gateway: `default`
- Base: `https://gateway.ai.cloudflare.com/v1/$ACCOUNT_ID/default`

## Secrets

```bash
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put KIMI_API_KEY
wrangler secret put ADMIN_SECRET
```
