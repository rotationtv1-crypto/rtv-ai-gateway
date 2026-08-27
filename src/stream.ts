// Cloudflare Stream ingest + playback for the live AI gateway.
// Telegram payment handling stays in index.ts. ECS is LiveKit/media only.

export interface StreamBinding {
  video(id: string): {
    generateToken(options?: { exp?: number }): Promise<string>;
  };
}

export interface StreamEnv {
  STREAM?: StreamBinding;
  CF_ACCOUNT_ID?: string;
  CF_STREAM_API_TOKEN?: string;
  CF_STREAM_CUSTOMER_SUBDOMAIN?: string;
  ADMIN_SECRET?: string;
}

const UID_RE = /^[a-zA-Z0-9_-]{8,128}$/;
const TOKEN_TTL_SEC = 3600;

export function isStreamPath(path: string): boolean {
  return (
    path === "/stream/create" ||
    path === "/stream/status" ||
    path.startsWith("/stream/status/") ||
    path.startsWith("/stream/playback/")
  );
}

export function customerBaseFrom(value?: string, webrtcUrl?: string): string | null {
  const candidate = value || webrtcUrl;
  if (!candidate) return null;
  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    if (!url.hostname.endsWith(".cloudflarestream.com")) return null;
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

export function playbackUrls(base: string, assetId: string): { hls: string; dash: string } {
  return {
    hls: `${base}/${assetId}/manifest/video.m3u8`,
    dash: `${base}/${assetId}/manifest/video.mpd`,
  };
}

function json(data: unknown, status: number, headers: Record<string, string>, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": extra?.["Cache-Control"] || "no-store",
    },
  });
}

function requireAdmin(req: Request, env: StreamEnv, headers: Record<string, string>): Response | null {
  if (!env.ADMIN_SECRET) {
    return json({ error: "stream_admin_not_configured" }, 503, headers);
  }
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== env.ADMIN_SECRET) {
    return json({ error: "unauthorized" }, 401, headers);
  }
  return null;
}

class StreamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamConfigError";
  }
}

async function cfStream<T>(env: StreamEnv, path: string, init?: RequestInit): Promise<T> {
  if (!env.CF_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) {
    throw new StreamConfigError("Cloudflare Stream credentials are not configured");
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    result?: T;
    errors?: Array<{ message: string }>;
  };
  if (!res.ok || !body.success) {
    const message = body.errors?.[0]?.message || `Cloudflare Stream API ${res.status}`;
    throw new Error(message);
  }
  return body.result as T;
}

interface CfLiveInput {
  uid: string;
  rtmps?: { url: string; streamKey: string };
  srt?: { url: string; streamId?: string };
  webRTC?: { url: string };
  webRTCPlayback?: { url: string };
  status?: { current?: { state?: string; reason?: string } };
  meta?: Record<string, string>;
  created?: string;
}

interface CfVideo {
  uid: string;
  status?: { state?: string };
  playback?: { hls: string; dash: string };
  thumbnail?: string;
  liveInput?: string;
  requireSignedURLs?: boolean;
}

async function handleCreate(req: Request, env: StreamEnv, headers: Record<string, string>): Promise<Response> {
  const denied = requireAdmin(req, env, headers);
  if (denied) return denied;

  let body: { name?: string; creator_id?: string; channel_id?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400, headers);
  }

  const name = (body.name || body.creator_id || "").trim();
  if (!name) {
    return json({ error: "creator_id required" }, 400, headers);
  }

  try {
    const input = await cfStream<CfLiveInput>(env, "/live_inputs", {
      method: "POST",
      body: JSON.stringify({
        meta: {
          name,
          creator_id: body.creator_id || "",
          channel_id: body.channel_id || "",
        },
        recording: {
          mode: "automatic",
          timeoutSeconds: 10,
          requireSignedURLs: Boolean(env.STREAM),
        },
      }),
    });

    const base = customerBaseFrom(env.CF_STREAM_CUSTOMER_SUBDOMAIN, input.webRTC?.url);
    const urls = base ? playbackUrls(base, input.uid) : { hls: "", dash: "" };

    return json(
      {
        stream_id: input.uid,
        uid: input.uid,
        stream_key: input.rtmps?.streamKey || "",
        rtmp_url: input.rtmps?.url || "",
        rtmps_url: input.rtmps?.url || "",
        srt_url: input.srt?.url || "",
        webrtc_url: input.webRTC?.url || "",
        hls_playback: urls.hls,
        hls: urls.hls,
        dash: urls.dash,
        status: "created",
        provider: "cloudflare-stream",
        message: "Stream session created. Use the RTMPS URL + stream_key (OBS) or the WebRTC WHIP URL to go live. ECS is LiveKit/media only.",
      },
      201,
      headers
    );
  } catch (err) {
    if (err instanceof StreamConfigError) {
      return json({ error: "stream_not_configured", message: err.message }, 503, headers);
    }
    return json({ error: "stream_create_failed", message: (err as Error).message }, 502, headers);
  }
}

async function handleStatus(id: string, env: StreamEnv, headers: Record<string, string>): Promise<Response> {
  if (!UID_RE.test(id)) {
    return json({ error: "id parameter required" }, 400, headers);
  }

  try {
    try {
      const input = await cfStream<CfLiveInput>(env, `/live_inputs/${id}`);
      const state = input.status?.current?.state || "unknown";
      const live = state === "connected" || state === "live-inprogress";
      const base = customerBaseFrom(env.CF_STREAM_CUSTOMER_SUBDOMAIN, input.webRTC?.url);
      const urls = base ? playbackUrls(base, input.uid) : { hls: "", dash: "" };
      return json(
        {
          uid: input.uid,
          type: "live",
          status: state,
          live,
          connected: live,
          hls: urls.hls,
          hls_playback: urls.hls,
          webrtc_url: input.webRTC?.url,
          provider: "cloudflare-stream",
        },
        200,
        headers
      );
    } catch {
      const video = await cfStream<CfVideo>(env, `/${id}`);
      return json(
        {
          uid: video.uid,
          type: "vod",
          status: video.status?.state || "unknown",
          live: video.status?.state === "live-inprogress",
          connected: video.status?.state !== "error",
          hls: video.playback?.hls,
          hls_playback: video.playback?.hls,
          provider: "cloudflare-stream",
        },
        200,
        headers
      );
    }
  } catch (err) {
    if (err instanceof StreamConfigError) {
      return json({ error: "stream_not_configured", message: err.message }, 503, headers);
    }
    return json({ error: "not_found", message: (err as Error).message }, 404, headers);
  }
}

async function handlePlayback(uid: string, env: StreamEnv, headers: Record<string, string>): Promise<Response> {
  if (!UID_RE.test(uid)) {
    return json({ error: "Invalid stream id" }, 400, headers);
  }

  const privateHeaders = { "Cache-Control": "private, no-store" };

  try {
    let token: string | undefined;
    if (env.STREAM) {
      token = await env.STREAM.video(uid).generateToken({
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
      });
    }

    let base = customerBaseFrom(env.CF_STREAM_CUSTOMER_SUBDOMAIN);
    let type: "live" | "vod" = "live";
    let videoHls: string | undefined;
    let videoDash: string | undefined;
    let thumbnail: string | undefined;

    try {
      const input = await cfStream<CfLiveInput>(env, `/live_inputs/${uid}`);
      if (!base) base = customerBaseFrom(undefined, input.webRTC?.url);
    } catch {
      const video = await cfStream<CfVideo>(env, `/${uid}`);
      type = "vod";
      videoHls = video.playback?.hls;
      videoDash = video.playback?.dash;
      thumbnail = video.thumbnail;
      if (!base && videoHls) base = customerBaseFrom(undefined, videoHls);
    }

    if (!base && !videoHls) {
      return json({ error: "Cloudflare Stream customer hostname is not configured" }, 503, headers, privateHeaders);
    }

    const assetId = token || uid;
    const fromBase = base ? playbackUrls(base, assetId) : { hls: "", dash: "" };
    const hls = token && base ? fromBase.hls : videoHls || fromBase.hls;
    const dash = token && base ? fromBase.dash : videoDash || fromBase.dash;

    return json(
      {
        uid,
        type,
        hls,
        dash,
        hls_playback: hls,
        ...(thumbnail ? { thumbnail } : {}),
        expiresIn: token ? TOKEN_TTL_SEC : undefined,
        requiresToken: Boolean(token),
        provider: "cloudflare-stream",
      },
      200,
      headers,
      privateHeaders
    );
  } catch (err) {
    if (err instanceof StreamConfigError) {
      return json({ error: "stream_not_configured", message: err.message }, 503, headers, privateHeaders);
    }
    return json({ error: "playback_failed", message: (err as Error).message }, 502, headers, privateHeaders);
  }
}

export async function handleStream(
  req: Request,
  env: StreamEnv,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (path === "/stream/create" && req.method === "POST") {
    return handleCreate(req, env, corsHeaders);
  }

  if ((path === "/stream/status" || path.startsWith("/stream/status/")) && req.method === "GET") {
    const id = path.startsWith("/stream/status/")
      ? decodeURIComponent(path.slice("/stream/status/".length))
      : url.searchParams.get("id") || "";
    if (!id) return json({ error: "id parameter required" }, 400, corsHeaders);
    return handleStatus(id, env, corsHeaders);
  }

  if (path.startsWith("/stream/playback/") && req.method === "GET") {
    const uid = decodeURIComponent(path.slice("/stream/playback/".length));
    return handlePlayback(uid, env, corsHeaders);
  }

  return json(
    {
      error: "not_found",
      available: ["/stream/create", "/stream/status", "/stream/playback/:uid"],
    },
    404,
    corsHeaders
  );
}
