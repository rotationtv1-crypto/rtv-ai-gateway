// Web checkout on the live AI gateway. Tribute is retired (payout denied).
// Stripe: hosted Checkout + Customer Portal + admin Payouts.
// PayPal: Checkout Orders + admin Payouts.
// Amounts come from catalog sku only — never from free-form client numbers.
// Secrets stay in Worker env. Telegram Stars remain bot-only (not Mini App).

import { catalogBySku, CHECKOUT_CATALOG, type CatalogItem } from "./catalog";

export interface PayEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_SECRET?: string;
  PAYPAL_MODE?: string;
  PAYPAL_PAYOUT_EMAIL?: string;
  ADMIN_SECRET?: string;
  MEMORY?: KVNamespace;
  DB?: D1Database;
}

const encoder = new TextEncoder();

export function isPayPath(path: string): boolean {
  return (
    path === "/pay/catalog" ||
    path === "/pay/checkout" ||
    path === "/pay/portal" ||
    path === "/pay/payout" ||
    path === "/pay/stripe/webhook" ||
    path === "/pay/paypal/capture"
  );
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=")];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(nowSec - t) > 300) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

function requireAdmin(req: Request, env: PayEnv, headers: Record<string, string>): Response | null {
  if (!env.ADMIN_SECRET) return json({ error: "stream_admin_not_configured" }, 503, headers);
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== env.ADMIN_SECRET) return json({ error: "unauthorized" }, 401, headers);
  return null;
}

function paypalBase(env: PayEnv): string {
  return env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(env: PayEnv): Promise<string> {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) {
    throw new Error("paypal_not_configured");
  }
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`);
  const res = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = (await res.json()) as { access_token?: string };
  if (!res.ok || !data.access_token) throw new Error("paypal_auth_failed");
  return data.access_token;
}

async function writeLedger(
  env: PayEnv,
  row: {
    id: string;
    provider: string;
    sku: string;
    amount_cents: number;
    channel_id: string;
    status: string;
  },
): Promise<void> {
  if (env.MEMORY) {
    await env.MEMORY.put(`pay:${row.id}`, JSON.stringify({ ...row, at: new Date().toISOString() }), {
      expirationTtl: 60 * 60 * 24 * 90,
    });
  }
  if (env.DB) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO pay_events (id, provider, sku, amount_cents, currency, channel_id, status, created_at)
       VALUES (?, ?, ?, ?, 'usd', ?, ?, datetime('now'))`,
    )
      .bind(row.id, row.provider, row.sku, row.amount_cents, row.channel_id, row.status)
      .run();
  }
}

async function stripeCheckout(item: CatalogItem, channelId: string, successUrl: string, cancelUrl: string, env: PayEnv) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("stripe_not_configured");
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", successUrl);
  body.set("cancel_url", cancelUrl);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "usd");
  body.set("line_items[0][price_data][unit_amount]", String(item.cents));
  body.set("line_items[0][price_data][product_data][name]", `RotationTV ${item.label}`);
  body.set("metadata[sku]", item.id);
  body.set("metadata[channel_id]", channelId);
  body.set("payment_intent_data[metadata][sku]", item.id);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) throw new Error(data.error?.message || "stripe_checkout_failed");
  return { id: data.id, url: data.url };
}

async function paypalCheckout(item: CatalogItem, channelId: string, successUrl: string, cancelUrl: string, env: PayEnv) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: `${item.id}:${channelId}`,
          amount: { currency_code: "USD", value: item.usd.toFixed(2) },
          description: `RotationTV ${item.label}`,
        },
      ],
      application_context: {
        brand_name: "RotationTV",
        user_action: "PAY_NOW",
        return_url: successUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  const data = (await res.json()) as {
    id?: string;
    links?: Array<{ rel: string; href: string }>;
    message?: string;
  };
  const url = data.links?.find((l) => l.rel === "approve")?.href;
  if (!res.ok || !data.id || !url) throw new Error(data.message || "paypal_checkout_failed");
  return { id: data.id, url };
}

export async function handlePay(req: Request, env: PayEnv, corsHeaders: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (path === "/pay/catalog" && req.method === "GET") {
    return json(
      {
        provider: ["stripe", "paypal"],
        tribute: "retired",
        currency: "usd",
        items: CHECKOUT_CATALOG,
      },
      200,
      corsHeaders,
    );
  }

  if (path === "/pay/checkout" && req.method === "POST") {
    let body: { sku?: string; provider?: string; channel_id?: string; success_url?: string; cancel_url?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "invalid_json" }, 400, corsHeaders);
    }
    const item = catalogBySku(body.sku || "");
    if (!item) return json({ error: "unknown_sku", items: CHECKOUT_CATALOG.map((i) => i.id) }, 400, corsHeaders);
    const provider = body.provider === "paypal" ? "paypal" : body.provider === "stripe" ? "stripe" : "";
    if (!provider) return json({ error: "provider must be stripe or paypal" }, 400, corsHeaders);
    const channelId = (body.channel_id || "rtv-news").slice(0, 64);
    const successUrl = body.success_url || "https://rotationtv.network/?paid=1";
    const cancelUrl = body.cancel_url || "https://rotationtv.network/?paid=0";
    try {
      const session =
        provider === "stripe"
          ? await stripeCheckout(item, channelId, successUrl, cancelUrl, env)
          : await paypalCheckout(item, channelId, successUrl, cancelUrl, env);
      return json(
        {
          provider,
          sku: item.id,
          amount_cents: item.cents,
          checkout_url: session.url,
          session_id: session.id,
        },
        201,
        corsHeaders,
      );
    } catch (err) {
      const message = (err as Error).message;
      const code = message.includes("not_configured") ? 503 : 502;
      return json({ error: message }, code, corsHeaders);
    }
  }

  if (path === "/pay/portal" && req.method === "POST") {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "stripe_not_configured" }, 503, corsHeaders);
    let body: { customer?: string; return_url?: string; device_id?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "invalid_json" }, 400, corsHeaders);
    }
    let customer = (body.customer || "").trim();
    if (!customer && body.device_id && env.MEMORY) {
      const raw = await env.MEMORY.get(`cust:${body.device_id}`);
      if (raw) customer = raw;
    }
    if (!customer) return json({ error: "customer_required" }, 400, corsHeaders);
    const form = new URLSearchParams();
    form.set("customer", customer);
    form.set("return_url", body.return_url || "https://rotationtv.network/");
    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) return json({ error: data.error?.message || "portal_failed" }, 502, corsHeaders);
    return json({ url: data.url }, 200, corsHeaders);
  }

  if (path === "/pay/payout" && req.method === "POST") {
    const denied = requireAdmin(req, env, corsHeaders);
    if (denied) return denied;
    let body: { provider?: string; sku?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "invalid_json" }, 400, corsHeaders);
    }
    const item = catalogBySku(body.sku || "tip-50");
    if (!item) return json({ error: "unknown_sku" }, 400, corsHeaders);
    const provider = body.provider === "paypal" ? "paypal" : "stripe";
    try {
      if (provider === "stripe") {
        if (!env.STRIPE_SECRET_KEY) return json({ error: "stripe_not_configured" }, 503, corsHeaders);
        const form = new URLSearchParams();
        form.set("amount", String(item.cents));
        form.set("currency", "usd");
        const res = await fetch("https://api.stripe.com/v1/payouts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
        });
        const data = (await res.json()) as { id?: string; error?: { message?: string } };
        if (!res.ok) return json({ error: data.error?.message || "payout_failed" }, 502, corsHeaders);
        return json({ provider, id: data.id, amount_cents: item.cents, status: "created" }, 201, corsHeaders);
      }
      if (!env.PAYPAL_PAYOUT_EMAIL) return json({ error: "paypal_payout_email_not_configured" }, 503, corsHeaders);
      const token = await paypalAccessToken(env);
      const res = await fetch(`${paypalBase(env)}/v1/payments/payouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender_batch_header: { sender_batch_id: `rtv-${Date.now()}`, email_subject: "RotationTV payout" },
          items: [
            {
              recipient_type: "EMAIL",
              amount: { value: item.usd.toFixed(2), currency: "USD" },
              receiver: env.PAYPAL_PAYOUT_EMAIL,
              note: `RotationTV catalog ${item.id}`,
            },
          ],
        }),
      });
      const data = (await res.json()) as { batch_header?: { payout_batch_id?: string }; message?: string };
      if (!res.ok) return json({ error: data.message || "payout_failed" }, 502, corsHeaders);
      return json(
        { provider, id: data.batch_header?.payout_batch_id, amount_cents: item.cents, status: "created" },
        201,
        corsHeaders,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 502, corsHeaders);
    }
  }

  if (path === "/pay/stripe/webhook" && req.method === "POST") {
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "stripe_webhook_not_configured" }, 503, corsHeaders);
    const raw = await req.text();
    const header = req.headers.get("Stripe-Signature") || "";
    const ok = await verifyStripeSignature(raw, header, env.STRIPE_WEBHOOK_SECRET);
    if (!ok) return json({ error: "invalid_signature" }, 400, corsHeaders);
    const event = JSON.parse(raw) as {
      id?: string;
      type?: string;
      data?: { object?: { id?: string; customer?: string; metadata?: { sku?: string; channel_id?: string } } };
    };
    if (event.type === "checkout.session.completed") {
      const obj = event.data?.object;
      const sku = obj?.metadata?.sku || "";
      const item = catalogBySku(sku);
      if (item) {
        await writeLedger(env, {
          id: event.id || obj?.id || crypto.randomUUID(),
          provider: "stripe",
          sku: item.id,
          amount_cents: item.cents,
          channel_id: obj?.metadata?.channel_id || "",
          status: "paid",
        });
      }
    }
    return json({ received: true }, 200, corsHeaders);
  }

  if (path === "/pay/paypal/capture" && req.method === "POST") {
    let body: { order_id?: string; channel_id?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "invalid_json" }, 400, corsHeaders);
    }
    const orderId = (body.order_id || "").trim();
    if (!/^[A-Z0-9-]+$/i.test(orderId)) return json({ error: "invalid_order_id" }, 400, corsHeaders);
    try {
      const token = await paypalAccessToken(env);
      const res = await fetch(`${paypalBase(env)}/v2/checkout/orders/${orderId}/capture`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        purchase_units?: Array<{ custom_id?: string; amount?: { value?: string } }>;
      };
      if (!res.ok) return json({ error: "paypal_capture_failed" }, 502, corsHeaders);
      const custom = data.purchase_units?.[0]?.custom_id || "";
      const sku = custom.split(":")[0];
      const item = catalogBySku(sku);
      if (item && data.status === "COMPLETED") {
        await writeLedger(env, {
          id: data.id || orderId,
          provider: "paypal",
          sku: item.id,
          amount_cents: item.cents,
          channel_id: body.channel_id || custom.split(":")[1] || "",
          status: "paid",
        });
      }
      return json({ status: data.status, order_id: data.id }, 200, corsHeaders);
    } catch (err) {
      return json({ error: (err as Error).message }, 502, corsHeaders);
    }
  }

  return json({ error: "not_found", available: ["/pay/catalog", "/pay/checkout", "/pay/portal"] }, 404, corsHeaders);
}
