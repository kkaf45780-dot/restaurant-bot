import { beforeEach, describe, expect, it } from 'vitest';
import { resetEdgeMemoryStateForTest, type EdgeEnv } from '../src/server/edgeStore.ts';
import worker from '../src/worker.ts';

const WORKER_SECRET = 'worker_test_session_secret_at_least_32_chars';
const OWNER_PASS = 'WorkerOwner#2026';

function makeEnv(overrides?: Partial<EdgeEnv>): EdgeEnv {
  return {
    ADMIN_EMAIL: 'admin@hara-grill.eg',
    ADMIN_PASSWORD: OWNER_PASS,
    ADMIN_SESSION_SECRET: WORKER_SECRET,
    ALLOWED_ORIGINS: 'https://allowed.example.com',
    ...overrides,
  };
}

let ipCounter = 1;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 200) + 1}`;
}

async function callWorker(
  path: string,
  init: RequestInit = {},
  env: EdgeEnv = makeEnv(),
  ip = nextIp()
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('CF-Connecting-IP')) {
    headers.set('CF-Connecting-IP', ip);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const req = new Request(`https://app.example.com${path}`, {
    ...init,
    headers,
  });
  return worker.fetch(req, env);
}

async function loginWorker(email: string, password: string, env = makeEnv()) {
  const res = await callWorker(
    '/api/admin/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
    env
  );
  const body = (await res.json()) as {
    token: string;
    role: string;
    mustChangePassword?: boolean;
  };
  return { status: res.status, ...body };
}

describe('Cloudflare Worker Runtime Integration & Security Tests', () => {
  beforeEach(() => {
    resetEdgeMemoryStateForTest();
  });

  it('fails closed with 503 when REQUIRE_SUPABASE=true without Supabase credentials', async () => {
    const prodEnv = makeEnv({ REQUIRE_SUPABASE: 'true' });
    const restRes = await callWorker('/api/restaurant', {}, prodEnv);
    expect(restRes.status).toBe(503);

    const healthRes = await callWorker('/api/health', {}, prodEnv);
    expect(healthRes.status).toBe(503);
  });

  it('exposes Turnstile directives in CSP, locks CORS, and returns 404 on unknown tenant', async () => {
    const preflightAllowed = await callWorker(
      '/api/restaurant',
      {
        method: 'OPTIONS',
        headers: { Origin: 'https://allowed.example.com' },
      },
      makeEnv()
    );
    expect(preflightAllowed.status).toBe(204);
    expect(preflightAllowed.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://allowed.example.com'
    );

    const evilRes = await callWorker(
      '/api/config/status',
      { headers: { Origin: 'https://evil-attacker.example' } },
      makeEnv()
    );
    expect(evilRes.status).toBe(200);
    expect(evilRes.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const csp = evilRes.headers.get('Content-Security-Policy') || '';
    expect(csp).toContain('https://challenges.cloudflare.com');
    const cfg = (await evilRes.json()) as Record<string, unknown>;
    expect(cfg).toEqual({ ok: true, version: '2.0.0' });

    const unknownTenant = await callWorker('/api/restaurant/nonexistent_slug_xyz');
    expect(unknownTenant.status).toBe(404);
  });

  it('supports login, logout revocation (401), RBAC overview filtering, fired user rejection, and password rotation invalidation', async () => {
    const env = makeEnv();
    const owner = await loginWorker('admin@hara-grill.eg', OWNER_PASS, env);
    expect(owner.status).toBe(200);
    expect(owner.token).toBeTruthy();

    // Create active kitchen employee (allowed: overview, orders; denied: coupons, ai, inventory, employees)
    const createKitchenRes = await callWorker(
      '/api/admin/employees',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
          id: 'emp_worker_kitchen',
          name: 'شيف اختبار',
          email: 'kitchen.worker@hara-grill.eg',
          role: 'kitchen',
          password: 'KitchenTemp#1',
          mustChangePassword: false,
          isActive: true,
        }),
      },
      env
    );
    expect(createKitchenRes.status).toBe(200);

    const kitchen = await loginWorker('kitchen.worker@hara-grill.eg', 'KitchenTemp#1', env);
    expect(kitchen.status).toBe(200);

    // Kitchen overview omits sensitive admin tabs & customInstructions
    const kOverviewRes = await callWorker(
      '/api/admin/overview',
      { headers: { Authorization: `Bearer ${kitchen.token}` } },
      env
    );
    expect(kOverviewRes.status).toBe(200);
    const kOverview = (await kOverviewRes.json()) as {
      bundle: { restaurant: { aiSettings: Record<string, unknown> }; activeCoupons: unknown[] };
      aiLogs: unknown[];
      coupons: unknown[];
      inventoryMovements: unknown[];
      employees: unknown[];
      activityLogs: unknown[];
      customers: unknown[];
      configStatus?: unknown;
    };
    expect(kOverview.configStatus).toBeUndefined();
    expect(kOverview.coupons).toEqual([]);
    expect(kOverview.bundle.activeCoupons).toEqual([]);
    expect(kOverview.employees).toEqual([]);
    expect(kOverview.aiLogs).toEqual([]);
    expect(kOverview.customers).toEqual([]);
    expect(kOverview.bundle.restaurant.aiSettings.customInstructions).toBeUndefined();

    // Kitchen password rotation invalidates the old kitchen token
    const kRotateRes = await callWorker(
      '/api/admin/password',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${kitchen.token}` },
        body: JSON.stringify({
          currentPassword: 'KitchenTemp#1',
          newPassword: 'KitchenNew#2026',
        }),
      },
      env
    );
    expect(kRotateRes.status).toBe(200);
    const kRotateBody = (await kRotateRes.json()) as { token: string };
    expect(kRotateBody.token).toBeTruthy();

    const oldTokenUse = await callWorker(
      '/api/admin/me',
      { headers: { Authorization: `Bearer ${kitchen.token}` } },
      env
    );
    expect(oldTokenUse.status).toBe(401);

    const newTokenUse = await callWorker(
      '/api/admin/me',
      { headers: { Authorization: `Bearer ${kRotateBody.token}` } },
      env
    );
    expect(newTokenUse.status).toBe(200);

    // Owner disables kitchen employee -> active token must immediately return 401
    const disableRes = await callWorker(
      '/api/admin/employees',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
          id: 'emp_worker_kitchen',
          name: 'شيف اختبار',
          email: 'kitchen.worker@hara-grill.eg',
          role: 'kitchen',
          isActive: false,
        }),
      },
      env
    );
    expect(disableRes.status).toBe(200);

    const disabledMe = await callWorker(
      '/api/admin/me',
      { headers: { Authorization: `Bearer ${kRotateBody.token}` } },
      env
    );
    expect(disabledMe.status).toBe(401);

    // Owner logout revokes owner token immediately
    const logoutRes = await callWorker(
      '/api/admin/logout',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner.token}` },
      },
      env
    );
    expect(logoutRes.status).toBe(200);

    const postLogoutMe = await callWorker(
      '/api/admin/me',
      { headers: { Authorization: `Bearer ${owner.token}` } },
      env
    );
    expect(postLogoutMe.status).toBe(401);
  });

  it('prevents concurrent duplicate orders, coupon usage race, and double stock deduction in Worker', async () => {
    const env = makeEnv();
    const owner = await loginWorker('admin@hara-grill.eg', OWNER_PASS, env);

    // Force restaurant open and seed coupon + low-stock item
    await callWorker(
      '/api/admin/restaurant',
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ manualStatus: 'force_open' }),
      },
      env
    );

    const oneUseCoupon = `RACE1_${Date.now()}`;
    const cpnRes = await callWorker(
      '/api/admin/coupons',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
          code: oneUseCoupon,
          discountType: 'fixed',
          discountValue: 25,
          minOrderAmount: 50,
          usageLimit: 1,
          usedCount: 0,
          isActive: true,
        }),
      },
      env
    );
    expect(cpnRes.status).toBe(200);

    // 1) 5 concurrent identical idempotencyKey submissions -> 1 created + 4 deduplicated
    const idemKey = `worker_idem_${Date.now()}`;
    const parallelIdem = await Promise.all(
      Array.from({ length: 5 }, (_, idx) =>
        callWorker(
          '/api/orders',
          {
            method: 'POST',
            body: JSON.stringify({
              items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1, selectedSizeId: 'sz_half' }],
              fulfillmentType: 'pickup',
              customerName: `عميل تزامن ${idx}`,
              customerPhone: '01012345678',
              idempotencyKey: idemKey,
            }),
          },
          env
        )
      )
    );
    const statuses = parallelIdem.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 201]);
    const bodies = await Promise.all(
      parallelIdem.map((r) => r.json() as Promise<{ order: { id: string } }>)
    );
    const uniqueOrderIds = new Set(bodies.map((b) => b.order.id));
    expect(uniqueOrderIds.size).toBe(1);

    // 2) Concurrent coupon limit=1 race -> only 1 succeeds, 1 returns 409
    const couponRace = await Promise.all([
      callWorker(
        '/api/orders',
        {
          method: 'POST',
          body: JSON.stringify({
            items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1, selectedSizeId: 'sz_half' }],
            fulfillmentType: 'pickup',
            couponCode: oneUseCoupon,
            customerName: 'عميل كوبون ١',
            customerPhone: '01022223333',
          }),
        },
        env
      ),
      callWorker(
        '/api/orders',
        {
          method: 'POST',
          body: JSON.stringify({
            items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1, selectedSizeId: 'sz_half' }],
            fulfillmentType: 'pickup',
            couponCode: oneUseCoupon,
            customerName: 'عميل كوبون ٢',
            customerPhone: '01044445555',
          }),
        },
        env
      ),
    ]);
    const couponStatuses = couponRace.map((r) => r.status).sort();
    expect(couponStatuses).toEqual([201, 409]);

    // 3) Concurrent PATCH accepted on same order -> stock deducted ONLY once
    const firstOrderId = Array.from(uniqueOrderIds)[0];
    const beforeOverview = (await (
      await callWorker(
        '/api/admin/overview',
        { headers: { Authorization: `Bearer ${owner.token}` } },
        env
      )
    ).json()) as { bundle: { items: Array<{ id: string; stockQuantity: number }> } };
    const beforeStock =
      beforeOverview.bundle.items.find((i) => i.id === 'item_kebab_kofta_mix')?.stockQuantity ?? 0;

    await Promise.all([
      callWorker(
        `/api/admin/orders/${firstOrderId}/status`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${owner.token}` },
          body: JSON.stringify({ status: 'accepted' }),
        },
        env
      ),
      callWorker(
        `/api/admin/orders/${firstOrderId}/status`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${owner.token}` },
          body: JSON.stringify({ status: 'accepted' }),
        },
        env
      ),
    ]);

    const afterOverview = (await (
      await callWorker(
        '/api/admin/overview',
        { headers: { Authorization: `Bearer ${owner.token}` } },
        env
      )
    ).json()) as { bundle: { items: Array<{ id: string; stockQuantity: number }> } };
    const afterStock =
      afterOverview.bundle.items.find((i) => i.id === 'item_kebab_kofta_mix')?.stockQuantity ?? 0;
    expect(afterStock).toBe(beforeStock - 1);
  });
});
