import { describe, expect, it } from "vitest";
import { catalogBySku, CHECKOUT_CATALOG } from "../src/catalog";
import { hmacSha256Hex, isPayPath, timingSafeEqual, verifyStripeSignature } from "../src/pay";

describe("pay path routing", () => {
  it("matches catalog, checkout, portal, payout, webhooks", () => {
    expect(isPayPath("/pay/catalog")).toBe(true);
    expect(isPayPath("/pay/checkout")).toBe(true);
    expect(isPayPath("/pay/portal")).toBe(true);
    expect(isPayPath("/pay/payout")).toBe(true);
    expect(isPayPath("/pay/stripe/webhook")).toBe(true);
    expect(isPayPath("/pay/paypal/capture")).toBe(true);
    expect(isPayPath("/telegram")).toBe(false);
    expect(isPayPath("/stream/create")).toBe(false);
  });
});

describe("catalog lock", () => {
  it("rejects unknown skus", () => {
    expect(catalogBySku("tip-7")).toBeNull();
    expect(catalogBySku("100000")).toBeNull();
  });

  it("only exposes four USD amounts", () => {
    expect(CHECKOUT_CATALOG.map((i) => i.cents)).toEqual([500, 1000, 2500, 5000]);
  });
});

describe("stripe signature", () => {
  it("accepts a valid v1 signature and rejects a bad one", async () => {
    const secret = "whsec_test";
    const body = '{"type":"checkout.session.completed"}';
    const t = 1_700_000_000;
    const v1 = await hmacSha256Hex(secret, `${t}.${body}`);
    expect(await verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, t)).toBe(true);
    expect(await verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)}`, secret, t)).toBe(false);
  });

  it("timing-safe compare rejects length mismatch", () => {
    expect(timingSafeEqual("aa", "a")).toBe(false);
    expect(timingSafeEqual("ab", "ab")).toBe(true);
  });
});
