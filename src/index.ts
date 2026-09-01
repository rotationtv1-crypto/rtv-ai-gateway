/**
 * rtv-ai-gateway Worker
 *
 * Unified AI bridge routing requests through Cloudflare AI Gateway.
 * Also serves GET /v1/epg for rtv-broadcast (same worker, no second router).
 *
 * Routes:
 *   POST /v1/chat/completions — Chat completion (routed via AI Gateway)
 *   POST /v1/generate         — Content generation
 *   GET  /v1/health           — Gateway health check
 *   GET  /v1/epg              — Channel guide + hourly schedule
 */

import { getEpgGuide, type EpgEnv } from './epg';

interface Env extends EpgEnv {
  CLOUDFLARE_API_TOKEN: string;
  KIMI_API_KEY: string;
  ADMIN_SECRET: string;
  ACCOUNT_ID: string;
  GATEWAY_NAME: string;
  AI_GATEWAY_BASE: string;
}

interface ChatRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

const PUBLIC_PATHS = new Set(['/v1/health', '/v1/epg']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!PUBLIC_PATHS.has(path)) {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }
    }

    try {
      if (path === '/v1/health') {
        return Response.json({
          status: 'operational',
          gateway: `${env.AI_GATEWAY_BASE}/${env.ACCOUNT_ID}/${env.GATEWAY_NAME}`,
          models: ['workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'kimi'],
          epg: true,
          timestamp: new Date().toISOString(),
        }, { headers: corsHeaders });
      }

      if (path === '/v1/epg' && request.method === 'GET') {
        const guide = await getEpgGuide(env);
        return Response.json(guide, {
          headers: {
            ...corsHeaders,
            'Cache-Control': 'public, max-age=60',
          },
        });
      }

      if (path === '/v1/chat/completions' && request.method === 'POST') {
        const body: ChatRequest = await request.json();
        const model = body.model || 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';

        const gatewayUrl = `${env.AI_GATEWAY_BASE}/${env.ACCOUNT_ID}/${env.GATEWAY_NAME}`;

        let targetUrl: string;
        let headers: Record<string, string>;

        if (model.startsWith('workers-ai/')) {
          targetUrl = `${gatewayUrl}/workers-ai/${model.replace('workers-ai/', '')}`;
          headers = {
            'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          };
        } else if (model === 'kimi' || model.startsWith('kimi/')) {
          targetUrl = `${gatewayUrl}/universal`;
          headers = {
            'Authorization': `Bearer ${env.KIMI_API_KEY}`,
            'Content-Type': 'application/json',
          };
        } else {
          targetUrl = `${gatewayUrl}/workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`;
          headers = {
            'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          };
        }

        const aiResponse = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            messages: body.messages,
            stream: body.stream || false,
            max_tokens: body.max_tokens || 1024,
            temperature: body.temperature || 0.7,
          }),
        });

        if (!aiResponse.ok) {
          return Response.json(
            { error: `AI Gateway returned ${aiResponse.status}` },
            { status: 502, headers: corsHeaders }
          );
        }

        if (body.stream) {
          return new Response(aiResponse.body, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text-event-stream',
              'Cache-Control': 'no-cache',
            },
          });
        }

        const result = await aiResponse.json();
        return Response.json(result, { headers: corsHeaders });
      }

      if (path === '/v1/generate' && request.method === 'POST') {
        const body = await request.json() as { prompt: string; type?: string };

        const gatewayUrl = `${env.AI_GATEWAY_BASE}/${env.ACCOUNT_ID}/${env.GATEWAY_NAME}`;
        const targetUrl = `${gatewayUrl}/workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`;

        const aiResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: 'You are an AI assistant for RotationTV, a live broadcast platform.' },
              { role: 'user', content: body.prompt },
            ],
            max_tokens: 2048,
          }),
        });

        const result = await aiResponse.json();
        return Response.json(result, { headers: corsHeaders });
      }

      return Response.json(
        { error: 'Not found', routes: ['POST /v1/chat/completions', 'POST /v1/generate', 'GET /v1/health', 'GET /v1/epg'] },
        { status: 404, headers: corsHeaders }
      );
    } catch (err) {
      return Response.json(
        { error: 'Internal server error' },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
