import { readFileSync } from "node:fs";

const source = readFileSync("src/index.ts", "utf8");
const findings = [];

const checks = [
  ["WILDCARD_CORS", /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/, "Wildcard CORS is enabled."],
  ["CLIENT_PRICE", /starsAmount\s*=\s*parseInt\(args\[1\]\)/, "Stars price is derived from free-form client input."],
  ["QUERY_BOT_CREDENTIAL_COUPLING", /searchParams\.get\(["']bot["']\)[\s\S]{0,800}(TELEGRAM_BOT_TOKEN_17|TELEGRAM_BOT_TOKEN_18)/, "Untrusted bot routing is coupled to credential selection."],
];

for (const [id, pattern, message] of checks) {
  if (pattern.test(source)) findings.push({ id, message });
}

if (!/validateTelegram|verifyTelegram|initData.*HMAC|telegram.*HMAC/i.test(source)) {
  findings.push({
    id: "MISSING_TELEGRAM_INITDATA_VALIDATION",
    message: "No recognizable server-side Telegram initData/HMAC validation path found.",
  });
}

if (findings.length) {
  console.error(JSON.stringify({ status: "FAIL", findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "PASS", findings: [] }, null, 2));
