// Shared KV/D1 memory for broadcast + control. No local JSON dumps.
// Bindings are optional until the owner creates the namespace / database.

export interface MemoryEnv {
  MEMORY?: KVNamespace;
  DB?: D1Database;
  ADMIN_SECRET?: string;
}

const CHANNEL_RE = /^[a-z0-9-]{2,64}$/;
const DEVICE_RE = /^[a-zA-Z0-9_-]{8,128}$/;
const TYPES = new Set(["chat", "tune", "checkout", "status"]);

export function isMemoryPath(path: string): boolean {
  return path === "/memory/event" || path.startsWith("/memory/channel/") || path === "/memory/health";
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type MemoryEvent = {
  id: string;
  type: string;
  channel_id: string;
  device_id: string;
  text?: string;
  at: string;
};

export async function handleMemory(
  req: Request,
  env: MemoryEnv,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (path === "/memory/health" && req.method === "GET") {
    return json(
      {
        kv: Boolean(env.MEMORY),
        d1: Boolean(env.DB),
        persistence: env.MEMORY || env.DB ? "cloudflare" : "unconfigured",
      },
      200,
      corsHeaders,
    );
  }

  if (!env.MEMORY) {
    return json({ error: "memory_not_configured", persistence: "unconfigured" }, 503, corsHeaders);
  }

  if (path === "/memory/event" && req.method === "POST") {
    let body: { type?: string; channel_id?: string; device_id?: string; text?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "invalid_json" }, 400, corsHeaders);
    }
    if (!TYPES.has(body.type || "")) return json({ error: "unknown_type" }, 400, corsHeaders);
    if (!CHANNEL_RE.test(body.channel_id || "")) return json({ error: "invalid_channel" }, 400, corsHeaders);
    if (!DEVICE_RE.test(body.device_id || "")) return json({ error: "invalid_device" }, 400, corsHeaders);
    const event: MemoryEvent = {
      id: crypto.randomUUID(),
      type: body.type as string,
      channel_id: body.channel_id as string,
      device_id: body.device_id as string,
      text: (body.text || "").slice(0, 280) || undefined,
      at: new Date().toISOString(),
    };
    const key = `ch:${event.channel_id}`;
    const prev = ((await env.MEMORY.get(key, "json")) as MemoryEvent[] | null) || [];
    const next = [...prev, event].slice(-50);
    await env.MEMORY.put(key, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 14 });
    await env.MEMORY.put(`dev:${event.device_id}:channel`, event.channel_id, { expirationTtl: 60 * 60 * 24 * 14 });
    if (env.DB && event.type === "checkout") {
      await env.DB.prepare(
        `INSERT INTO memory_events (id, type, channel_id, device_id, text, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      )
        .bind(event.id, event.type, event.channel_id, event.device_id, event.text || "")
        .run()
        .catch(() => undefined);
    }
    return json({ ok: true, id: event.id, persisted: "kv" }, 201, corsHeaders);
  }

  if (path.startsWith("/memory/channel/") && req.method === "GET") {
    const channelId = decodeURIComponent(path.slice("/memory/channel/".length));
    if (!CHANNEL_RE.test(channelId)) return json({ error: "invalid_channel" }, 400, corsHeaders);
    const events = ((await env.MEMORY.get(`ch:${channelId}`, "json")) as MemoryEvent[] | null) || [];
    return json({ channel_id: channelId, events, persisted: "kv" }, 200, corsHeaders);
  }

  return json({ error: "not_found" }, 404, corsHeaders);
}
