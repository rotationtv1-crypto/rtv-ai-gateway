import { describe, expect, it } from "vitest";
import { verifyTributeSignature } from "../src/tribute";

const encoder = new TextEncoder();

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Tribute webhook signature verification", () => {
  const secret = "test-tribute-api-key";
  const body = JSON.stringify({ name: "new_digital_product", payload: { product_id: 456, telegram_user_id: 123 } });

  it("accepts a valid HMAC-SHA256 hex signature", async () => {
    const signature = await sign(body, secret);
    await expect(verifyTributeSignature(body, signature, secret)).resolves.toBe(true);
  });

  it("accepts the sha256= prefix", async () => {
    const signature = await sign(body, secret);
    await expect(verifyTributeSignature(body, `sha256=${signature}`, secret)).resolves.toBe(true);
  });

  it("rejects a modified body", async () => {
    const signature = await sign(body, secret);
    await expect(verifyTributeSignature(`${body} `, signature, secret)).resolves.toBe(false);
  });

  it("rejects a modified signature", async () => {
    const signature = await sign(body, secret);
    const modified = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    await expect(verifyTributeSignature(body, modified, secret)).resolves.toBe(false);
  });

  it("fails closed when the secret or header is absent", async () => {
    const signature = await sign(body, secret);
    await expect(verifyTributeSignature(body, signature, undefined)).resolves.toBe(false);
    await expect(verifyTributeSignature(body, null, secret)).resolves.toBe(false);
  });
});
