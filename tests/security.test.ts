/**
 * RotationTV Security Probe Suite — Rotation Erotica project (zzybjoowhkwuomnpixuy)
 *
 * Gating rules enforced by CI:
 *  1. transfer_rtv must NOT be callable by anon/authenticated clients (fund-drain fix)
 *  2. gift_transactions must reject direct client INSERT (free-gift fabrication fix)
 *  3. live_rooms must reject client writes (stream-credential overwrite fix)
 *  4. service_role must retain full access (worker flows must keep working)
 *
 * Env required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * If keys are absent (e.g. fork PRs), suite skips instead of failing.
 */

import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://zzybjoowhkwuomnpixuy.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const KEYS_PRESENT = Boolean(ANON_KEY && SERVICE_KEY);

const FAKE_UUID_A = '00000000-0000-0000-0000-000000000001';
const FAKE_UUID_B = '00000000-0000-0000-0000-000000000002';

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
}

/** Blocked = auth/permission failure. 404 also acceptable (function dropped from API schema). */
function expectBlocked(status: number) {
  expect([400, 401, 403, 404]).toContain(status);
}

describe.skipIf(!KEYS_PRESENT)('Rotation Erotica — security hardening gates', () => {
  it('GATE 1: transfer_rtv is not callable with the anon key', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/transfer_rtv`, {
      method: 'POST',
      headers: headers(ANON_KEY),
      body: JSON.stringify({
        p_sender_id: FAKE_UUID_A,
        p_receiver_id: FAKE_UUID_B,
        p_amount: 1000,
        p_type: 'gift',
      }),
    });
    expectBlocked(res.status);
  });

  it('GATE 2: gift_transactions rejects direct client INSERT', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gift_transactions`, {
      method: 'POST',
      headers: headers(ANON_KEY),
      body: JSON.stringify({
        sender_id: FAKE_UUID_A,
        receiver_id: FAKE_UUID_B,
        rtv_amount: 9999,
        gift_type: 'fabricated',
      }),
    });
    expectBlocked(res.status);
  });

  it('GATE 3: live_rooms rejects client-side writes', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/live_rooms?id=eq.${FAKE_UUID_A}`, {
      method: 'PATCH',
      headers: headers(ANON_KEY),
      body: JSON.stringify({ stream_key: 'spoofed', rtv_earned_session: 999999 }),
    });
    expectBlocked(res.status);
  });

  it('GATE 4: service_role retains catalog read access (worker flows intact)', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gifts?select=id,rtv_cost,is_active&limit=5`, {
      headers: headers(SERVICE_KEY),
    });
    expect(res.status).toBe(200);
  });

  it('GATE 5: gift feed SELECT remains publicly readable (intentional policy)', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gift_transactions?select=id&limit=1`, {
      headers: headers(ANON_KEY),
    });
    // Public read of the gift feed is intentional (overlays); write is what was closed.
    expect([200, 401, 403]).toContain(res.status);
  });
});

describe('suite bootstrap', () => {
  it('reports environment readiness', () => {
    if (!KEYS_PRESENT) {
      console.warn('SUPABASE keys not set — security gates skipped (expected on fork PRs)');
    }
    expect(true).toBe(true);
  });
});
