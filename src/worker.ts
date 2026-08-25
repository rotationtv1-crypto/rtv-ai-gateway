import gateway from "./index";
import { verifyTributeSignature } from "./tribute";

type Env = Record<string, unknown> & {
  TRIBUTE_WEBHOOK_SECRET?: string;
  TRIBUTE?: string;
  TRIBUTE_WEBHOOK_PROCESSOR_ENABLED?: string;
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/tribute/webhook") {
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", Allow: "POST" },
        });
      }

      const rawBody = await req.text();
      const secret = env.TRIBUTE_WEBHOOK_SECRET || env.TRIBUTE;
      if (!secret) {
        return new Response(JSON.stringify({ error: "tribute_webhook_not_configured" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      const signature = req.headers.get("trbt-signature") ?? req.headers.get("X-Tribute-Signature");
      const valid = await verifyTributeSignature(rawBody, signature, secret);
      if (!valid) {
        return new Response(JSON.stringify({ error: "invalid_webhook_signature" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (env.TRIBUTE_WEBHOOK_PROCESSOR_ENABLED !== "true") {
        return new Response(JSON.stringify({ error: "webhook_verified_processor_not_enabled" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, verified: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return gateway.fetch(req, env as never, ctx);
  },
};
