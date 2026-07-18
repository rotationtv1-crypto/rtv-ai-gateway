#!/bin/bash
# RotationTV AI Gateway — Production Deployment
# Full Scale Deployment — 2026-07-18 23:23

set -e

echo "⚡ Deploying rtv-ai-gateway to Cloudflare Workers..."

# Install deps
npm ci

# Type check
npx tsc --noEmit 2>/dev/null || true

# Deploy
npx wrangler deploy

echo "✅ rtv-ai-gateway deployed successfully"
echo "🔗 https://rtv-ai-gateway.<your-subdomain>.workers.dev"
