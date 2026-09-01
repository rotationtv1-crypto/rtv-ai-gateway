# rtv-ai-gateway

RotationTV AI Gateway — Unified API bridge for AI operations + broadcast EPG.

## Features

- Routes requests through Cloudflare AI Gateway
- Supports Workers AI (Llama 3.3) and Kimi API
- Intelligent model fallback
- Streaming support
- GET /v1/epg — CH 01-04, 06, 30-33 hourly schedule for rtv-broadcast

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completion (OpenAI-compatible) |
| POST | `/v1/generate` | Content generation |
| GET | `/v1/health` | Gateway health |
| GET | `/v1/epg` | Public EPG (Channel + Program ISO times) |

## EPG

- Programs use UTC hour `startTime` / `endTime` ISO strings, not client `setHours`.
- `streamUrl` from `STREAM_HLS_NN` or `STREAM_CUSTOMER` + `STREAM_UID_NN` (Cloudflare Stream HLS from rtv-control mint).
- Optional `EPG_CACHE` KV key `epg:guide` ttl 120s. Unbound = rebuild each request.

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
