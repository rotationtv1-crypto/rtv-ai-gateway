import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");

describe("HTTP gateway security regression patterns", () => {
  it("does not use wildcard CORS", () => {
    expect(source).not.toMatch(/Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/);
  });

  it("does not derive authoritative Stars prices from free-form /tip input", () => {
    expect(source).not.toMatch(/text\.startsWith\(["']\/tip["']\)[\s\S]{0,800}parseInt\(args\[1\]\)/);
  });

  it("does not construct payment amounts directly from request text", () => {
    expect(source).not.toMatch(/starsAmount\s*=\s*parseInt\(args\[1\]\)/);
  });

  it("requires an explicit Telegram initData validation path before protected payment handling", () => {
    const hasValidator = /validateTelegram|verifyTelegram|initData.*HMAC|telegram.*HMAC/i.test(source);
    const hasProtectedPaymentPath = /successful_payment|sendInvoice|\/tip|\/subscribe/.test(source);
    expect(hasProtectedPaymentPath).toBe(true);
    expect(hasValidator).toBe(true);
  });

  it("does not allow unrestricted query parameters to select bot credentials", () => {
    const queryBotSelection = /searchParams\.get\(["']bot["']\)/.test(source);
    const credentialSelection = /TELEGRAM_BOT_TOKEN_17|TELEGRAM_BOT_TOKEN_18/.test(source);
    if (queryBotSelection && credentialSelection) {
      throw new Error("Bot credential selection is coupled directly to untrusted query routing");
    }
  });
});
