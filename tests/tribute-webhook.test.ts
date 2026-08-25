import { describe, expect, it } from "vitest";
import worker from "../src/worker";

const encoder = new TextEncoder();

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Tribute webhook endpoint", () => {
  const secret = "test-tribute-api-key";
  const body = JSON.stringify({ name: "new_digital_product", payload: { product_id: 456 } });

  it("returns 401 for an invalid signature", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/tribute/webhook", {
        method: "POST",
        body,
        headers: { "trbt-signature": "00".repeat(32) },
      }),
      { TRIBUTE_WEBHOOK_SECRET: secret },
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });

  it("returns 503 when the secret is missing", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/tribute/webhook", { method: "POST", body }),
      {},
      {} as ExecutionContext,
    );
    expect(response.status).toBe(503);
  });

  it("verifies the provider signature before processing", async () => {
    const signature = await sign(body, secret);
    const response = await worker.fetch(
      new Request("https://example.com/api/tribute/webhook", {
        method: "POST",
        body,
        headers: { "trbt-signature": signature },
      }),
      { TRIBUTE_WEBHOOK_SECRET: secret },
      {} as ExecutionContext,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "webhook_verified_processor_not_enabled" });
  });

  it("accepts the documented sha256= prefix", async () => {
    const signature = await sign(body, secret);
    const response = await worker.fetch(
      new Request("https://example.com/api/tribute/webhook", {
        method: "POST",
        body,
        headers: { "X-Tribute-Signature": `sha256=${signature}` },
      }),
      { TRIBUTE_WEBHOOK_SECRET: secret },
      {} as ExecutionContext,
    );
    expect(response.status).toBe(503);
  });
});
