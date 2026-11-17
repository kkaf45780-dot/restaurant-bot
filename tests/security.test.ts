import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RESTAURANT_ID,
  INITIAL_CATEGORIES,
  INITIAL_COUPONS,
  INITIAL_DELIVERY_ZONES,
  INITIAL_MENU_ITEMS,
  INITIAL_ORDERS,
  INITIAL_RESTAURANT,
  INITIAL_BRANCHES,
} from '../src/data/restaurant.ts';
import {
  CHAT_TTL_MS,
  getChatStorageKey,
  loadStoredChat,
  saveStoredChat,
  setChatOptOut,
  stripPiiFromText,
} from '../src/lib/chat-storage.ts';
import type { RestaurantBundle } from '../src/types/restaurant.ts';
import {
  authenticateBearerRequest,
  hashPasswordBcrypt,
  signAdminJwt,
  verifyAdminJwt,
  verifyPasswordAgainstHash,
} from '../worker/auth.ts';
import { clearRateLimitMemory } from '../worker/middleware/rate-limit.ts';
import {
  SECURITY_HEADERS,
  applySecurityHeaders,
  isKnownSpaRoute,
  resolveAllowedCorsOrigin,
} from '../worker/middleware/security.ts';
import { handleAdminLogin } from '../worker/routes/admin-login.ts';
import { handlePublicChat } from '../worker/routes/chat.ts';
import { handlePublicConfigStatus } from '../worker/routes/config-status.ts';
import { handlePublicOrderTrack } from '../worker/routes/orders-track.ts';

const TEST_SECRET = 'super_secret_test_key_at_least_32_bytes_long';
const TEST_OWNER_EMAIL = 'owner@meshweyat-test.eg';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(k: string) {
      return map.has(k) ? map.get(k)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(k: string) {
      map.delete(k);
    },
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
  };
}

const TEST_BUNDLE: RestaurantBundle = {
  restaurant: INITIAL_RESTAURANT,
  categories: INITIAL_CATEGORIES,
  items: INITIAL_MENU_ITEMS,
  deliveryZones: INITIAL_DELIVERY_ZONES,
  branches: INITIAL_BRANCHES,
  activeCoupons: INITIAL_COUPONS,
};

describe('Security Hardening Suite', () => {
  beforeEach(() => {
    clearRateLimitMemory();
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
  });

  it('rejects legacy default credentials (admin@hara-grill.eg / Admin@1234)', async () => {
    const res = await handleAdminLogin({
      env: {
        ADMIN_EMAIL: TEST_OWNER_EMAIL,
        ADMIN_SESSION_SECRET: TEST_SECRET,
      },
      email: 'admin@hara-grill.eg',
      password: 'Admin@1234',
      ip: '203.0.113.10',
      lookupEmployee: async () => null,
      verifyOwnerPassword: async () => false,
      isOwnerPasswordOverridden: async () => false,
    });
    expect(res.status).toBe(401);
  });

  it('enforces login rate limiting (5/min) and 15-min lockout (429 + Retry-After)', async () => {
    const ip = '203.0.113.25';
    for (let i = 0; i < 5; i++) {
      const res = await handleAdminLogin({
        env: { ADMIN_EMAIL: TEST_OWNER_EMAIL, ADMIN_SESSION_SECRET: TEST_SECRET },
        email: TEST_OWNER_EMAIL,
        password: 'WrongPassword!99',
        ip,
        lookupEmployee: async () => null,
        verifyOwnerPassword: async () => false,
        isOwnerPasswordOverridden: async () => false,
      });
      expect([401, 429]).toContain(res.status);
    }

    const lockedRes = await handleAdminLogin({
      env: { ADMIN_EMAIL: TEST_OWNER_EMAIL, ADMIN_SESSION_SECRET: TEST_SECRET },
      email: TEST_OWNER_EMAIL,
      password: 'WrongPassword!99',
      ip,
      lookupEmployee: async () => null,
      verifyOwnerPassword: async () => false,
      isOwnerPasswordOverridden: async () => false,
    });
    expect(lockedRes.status).toBe(429);
    expect(Number(lockedRes.headers.get('Retry-After'))).toBeGreaterThanOrEqual(60);
  });

  it('issues HS256 JWT, verifies bcrypt hashes, rejects forged/legacy local tokens, and enforces mustChangePassword', async () => {
    const strongPass = 'StrongOwner#2026!';
    const hash = await hashPasswordBcrypt(strongPass);
    expect(await verifyPasswordAgainstHash(strongPass, hash)).toBe(true);
    expect(await verifyPasswordAgainstHash('WrongPass#1', hash)).toBe(false);

    const token = await signAdminJwt({
      secret: TEST_SECRET,
      email: TEST_OWNER_EMAIL,
      role: 'owner',
      mustChangePassword: true,
    });
    expect(token.split('.')).toHaveLength(3);
    const verified = await verifyAdminJwt(TEST_SECRET, token);
    expect(verified?.email).toBe(TEST_OWNER_EMAIL);
    expect(verified?.mustChangePassword).toBe(true);

    // Reject legacy local.* token
    const legacyAuth = await authenticateBearerRequest({
      requestHeaders: new Headers({ Authorization: 'Bearer local.eyJlbWFpbCI6ImFkbWluQGhhcmEtZ3JpbGwuZWcifQ==.sig' }),
      env: { ADMIN_SESSION_SECRET: TEST_SECRET },
      resolveRole: async () => ({ role: 'owner', mustChangePassword: false }),
    });
    expect(legacyAuth.ok).toBe(false);
    if (!legacyAuth.ok) {
      expect(legacyAuth.response.status).toBe(401);
    }

    // Block overview when mustChangePassword = true -> 403
    const blockedAuth = await authenticateBearerRequest({
      requestHeaders: new Headers({ Authorization: `Bearer ${token}` }),
      env: { ADMIN_SESSION_SECRET: TEST_SECRET },
      resolveRole: async () => ({ role: 'owner', mustChangePassword: true }),
      allowPendingPasswordChange: false,
    });
    expect(blockedAuth.ok).toBe(false);
    if (!blockedAuth.ok) {
      expect(blockedAuth.response.status).toBe(403);
    }
  });

  it('hides internal infrastructure fields & demoAdminEmail on /api/config/status', async () => {
    const cfg = handlePublicConfigStatus({ APP_VERSION: '2.0.0' });
    expect(cfg).toEqual({ ok: true, version: '2.0.0' });
    expect((cfg as unknown as Record<string, unknown>).demoAdminEmail).toBeUndefined();
    expect((cfg as unknown as Record<string, unknown>).storageMode).toBeUndefined();
    expect((cfg as unknown as Record<string, unknown>).geminiConfigured).toBeUndefined();
  });

  it('prevents IDOR & PII leaks in /api/orders/track: rejects orderNumber/phone and masks orderToken results', async () => {
    const legacyRes = await handlePublicOrderTrack({
      ip: '203.0.113.30',
      token: '',
      hasLegacyParam: true,
      findByToken: async () => null,
    });
    expect(legacyRes.status).toBe(400);

    const sampleOrder = INITIAL_ORDERS[0];
    const validRes = await handlePublicOrderTrack({
      ip: '203.0.113.30',
      token: sampleOrder.orderToken,
      findByToken: async (t) => (t === sampleOrder.orderToken ? sampleOrder : null),
    });
    expect(validRes.status).toBe(200);
    const body = (await validRes.json()) as { tracking: Record<string, unknown> };
    expect(body.tracking.orderNumberMasked).toMatch(/^#\*\*\d{2}$/);
    expect(body.tracking.customerNameMasked).toMatch(/\*\*\*$/);
    expect(body.tracking.customerPhone).toBeUndefined();
    expect(body.tracking.customerAddress).toBeUndefined();
    expect(body.tracking.notes).toBeUndefined();
    expect(body.tracking.items).toBeUndefined();
  });

  it('enforces chat CAPTCHA after 5 requests (403) and rate limit after 20 requests (429)', async () => {
    const ip = '203.0.113.45';
    for (let i = 0; i < 5; i++) {
      const res = await handlePublicChat({
        ip,
        message: 'السلام عليكم',
        loadBundle: async () => TEST_BUNDLE,
      });
      expect(res.status).toBe(200);
    }

    // 6th request without CAPTCHA -> 403 captchaRequired
    const captchaPromptRes = await handlePublicChat({
      ip,
      message: 'ممكن المنيو؟',
      loadBundle: async () => TEST_BUNDLE,
    });
    expect(captchaPromptRes.status).toBe(403);
    const captchaBody = (await captchaPromptRes.json()) as { captchaRequired?: boolean };
    expect(captchaBody.captchaRequired).toBe(true);

    // Forged human_verified_* bypass token must be rejected -> 403
    const forgedBypassRes = await handlePublicChat({
      ip,
      captchaToken: `human_verified_${Date.now()}`,
      message: 'تجاوز التحقق',
      loadBundle: async () => TEST_BUNDLE,
    });
    expect(forgedBypassRes.status).toBe(403);

    // 8th..20th requests WITH valid opaque challenge token -> 200 (since #6 was missing & #7 was forged)
    for (let i = 8; i <= 20; i++) {
      const okRes = await handlePublicChat({
        ip,
        captchaToken: `cf_turnstile_valid_token_${i}_abcdefghij`,
        message: 'إيه مواعيد العمل؟',
        loadBundle: async () => TEST_BUNDLE,
      });
      expect(okRes.status).toBe(200);
    }

    // 21st request -> 429 rate limited
    const throttledRes = await handlePublicChat({
      ip,
      captchaToken: 'cf_turnstile_valid_token_21_abcdefghij',
      message: 'طلب زيادة',
      loadBundle: async () => TEST_BUNDLE,
    });
    expect(throttledRes.status).toBe(429);
    expect(Number(throttledRes.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  it('applies full security headers on HTML/API/404, locks CORS, and catches unknown routes', async () => {
    const htmlRes = new Response('<html></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    const req = new Request('https://restaurant-bot.kkaf45780.workers.dev/menu', {
      headers: { Origin: 'https://evil-attacker.example' },
    });
    const secured = applySecurityHeaders(htmlRes, req);

    for (const [hdr, expected] of Object.entries(SECURITY_HEADERS)) {
      expect(secured.headers.get(hdr)).toBe(expected);
    }
    expect(secured.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(
      resolveAllowedCorsOrigin(
        'https://restaurant-bot.kkaf45780.workers.dev',
        'https://restaurant-bot.kkaf45780.workers.dev'
      )
    ).toBe('https://restaurant-bot.kkaf45780.workers.dev');

    expect(isKnownSpaRoute('/menu')).toBe(true);
    expect(isKnownSpaRoute('/track')).toBe(true);
    expect(isKnownSpaRoute('/admin')).toBe(true);
    expect(isKnownSpaRoute('/wp-admin.php')).toBe(false);
    expect(isKnownSpaRoute('/random-nonexistent-page')).toBe(false);
  });

  it('redacts PII in chat storage, enforces 24h TTL, and respects opt-out toggle', () => {
    const clean = stripPiiFromText('رقمي 01012345678 وبريدي user@example.com شارع الطيران 10');
    expect(clean).not.toContain('01012345678');
    expect(clean).not.toContain('user@example.com');
    expect(clean).toContain('[رقم محذوف]');
    expect(clean).toContain('[بريد محذوف]');

    const now = 1_700_000_000_000;
    saveStoredChat(
      DEFAULT_RESTAURANT_ID,
      [{ id: 'm1', role: 'user', text: 'تليفوني 01099887766', timestamp: new Date(now).toISOString() }],
      now
    );

    const loaded = loadStoredChat(DEFAULT_RESTAURANT_ID, now + 1000);
    expect(loaded).toHaveLength(1);
    expect(loaded![0].text).not.toContain('01099887766');

    // After 24h TTL -> auto-expired
    const expired = loadStoredChat(DEFAULT_RESTAURANT_ID, now + CHAT_TTL_MS + 10);
    expect(expired).toBeNull();

    // Opt-out prevents writing and deletes key
    saveStoredChat(
      DEFAULT_RESTAURANT_ID,
      [{ id: 'm2', role: 'user', text: 'مرحبا', timestamp: new Date(now).toISOString() }],
      now
    );
    expect(localStorage.getItem(getChatStorageKey(DEFAULT_RESTAURANT_ID))).not.toBeNull();
    setChatOptOut(DEFAULT_RESTAURANT_ID, true);
    expect(localStorage.getItem(getChatStorageKey(DEFAULT_RESTAURANT_ID))).toBeNull();
  });
});
