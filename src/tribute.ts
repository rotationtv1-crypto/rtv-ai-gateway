const HEX_SIGNATURE = /^[0-9a-fA-F]{64}$/;
const BASE64_SIGNATURE = /^[A-Za-z0-9+/]{43}={0,2}$/;

function normalizeSignature(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("sha256=") ? trimmed.slice(7).trim() : trimmed;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Verify Tribute's HMAC-SHA256 signature over the exact raw request body. */
export async function verifyTributeSignature(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string | undefined,
): Promise<boolean> {
  if (!apiKey || !signatureHeader) return false;

  const normalized = normalizeSignature(signatureHeader);
  if (!HEX_SIGNATURE.test(normalized) && !BASE64_SIGNATURE.test(normalized)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const expected = HEX_SIGNATURE.test(normalized)
    ? hexToBytes(normalized)
    : base64ToBytes(normalized);

  return crypto.subtle.verify("HMAC", key, expected, new TextEncoder().encode(rawBody));
}
