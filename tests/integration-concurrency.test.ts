import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3108;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.resolve(process.cwd(), '.data', 'db.json');
const TEST_OWNER_PASS = 'AuditOwner#2026!';
const TEST_SESSION_SECRET = 'integration_concurrency_test_secret_32_bytes!';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}

async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Waiting for startup
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Test server at ${url} did not become healthy within ${timeoutMs}ms`);
}

let ipCounter = 10;
function uniqueIp(): string {
  ipCounter += 1;
  return `198.18.0.${ipCounter}`;
}

async function apiFetch(route: string, init: RequestInit = {}, ip = uniqueIp()): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', ip);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${BASE_URL}${route}`, { ...init, headers });
}

async function login(email: string, password: string) {
  const res = await apiFetch('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { token?: string; role?: string; mustChangePassword?: boolean };
  return { status: res.status, ...body };
}

async function main(): Promise<void> {
  const hadDb = fs.existsSync(DB_PATH);
  const originalDb = hadDb ? fs.readFileSync(DB_PATH, 'utf-8') : null;

  let serverProc: ChildProcess | null = null;
  try {
    const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    serverProc = spawn(tsxBin, ['server.ts'], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        PORT: String(PORT),
        DISABLE_HMR: 'true',
        NODE_ENV: 'production',
        ADMIN_EMAIL: 'admin@hara-grill.eg',
        ADMIN_PASSWORD: TEST_OWNER_PASS,
        ADMIN_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      stdio: 'ignore',
    });

    await waitForServer(BASE_URL);

    // Log in owner & set restaurant open for deterministic order tests
    const owner = await login('admin@hara-grill.eg', TEST_OWNER_PASS);
    assert.equal(owner.status, 200);
    assert.ok(owner.token);
    const ownerToken = owner.token!;

    await apiFetch('/api/admin/restaurant', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ manualStatus: 'force_open' }),
    });

    await runTest('rejects compromised default passwords on login', async () => {
      for (const weak of ['Admin@1234', 'admin123', '12345678']) {
        const res = await login('admin@hara-grill.eg', weak);
        assert.equal(res.status, 401);
      }
    });

    await runTest('validates input safety: blocks PostgREST injection, unsafe media URLs, >100% coupons, and overlong strings', async () => {
      const fakeTrack = await apiFetch(
        '/api/orders/track?orderNumber=' + encodeURIComponent('1001,status.eq.delivered') + '&token=bad'
      );
      assert.equal(fakeTrack.status, 403);

      const unsafeLogo = await apiFetch('/api/admin/restaurant', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ logoUrl: 'javascript:alert(1)' }),
      });
      assert.equal(unsafeLogo.status, 400);

      const unsafeSvgItem = await apiFetch('/api/admin/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          categoryId: 'cat_grills',
          name: 'طبق خطر',
          price: 100,
          imageUrl: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+',
        }),
      });
      assert.equal(unsafeSvgItem.status, 400);

      const overCoupon = await apiFetch('/api/admin/coupons', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          code: 'HACK999',
          discountType: 'percentage',
          discountValue: 150,
        }),
      });
      assert.equal(overCoupon.status, 400);

      const overlongOrder = await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1 }],
          fulfillmentType: 'pickup',
          customerName: 'A'.repeat(121),
          customerPhone: '01012345678',
        }),
      });
      assert.equal(overlongOrder.status, 400);
    });

    await runTest('enforces RBAC overview data filtering and write isolation for cashier and kitchen', async () => {
      // Create cashier
      const cCreate = await apiFetch('/api/admin/employees', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          id: 'emp_int_cashier',
          name: 'كاشير فحص',
          email: 'cashier.int@hara-grill.eg',
          role: 'cashier',
          password: 'CashierPass#1',
          mustChangePassword: false,
          isActive: true,
        }),
      });
      assert.equal(cCreate.status, 200);

      const cashier = await login('cashier.int@hara-grill.eg', 'CashierPass#1');
      assert.equal(cashier.status, 200);
      const cashierToken = cashier.token!;

      const cOverviewRes = await apiFetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${cashierToken}` },
      });
      assert.equal(cOverviewRes.status, 200);
      const cOverview = (await cOverviewRes.json()) as {
        configStatus?: unknown;
        employees: unknown[];
        aiLogs: unknown[];
        inventoryMovements: unknown[];
        customers: unknown[];
        coupons: unknown[];
        bundle: { restaurant: { aiSettings: Record<string, unknown> } };
      };
      assert.equal(cOverview.configStatus, undefined);
      assert.deepEqual(cOverview.employees, []);
      assert.deepEqual(cOverview.aiLogs, []);
      assert.deepEqual(cOverview.inventoryMovements, []);
      assert.deepEqual(cOverview.customers, []);
      assert.ok(Array.isArray(cOverview.coupons));
      assert.equal(cOverview.bundle.restaurant.aiSettings.customInstructions, undefined);

      // Cashier cannot manage employees, menu items, or restaurant settings
      const deniedEmp = await apiFetch('/api/admin/employees', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cashierToken}` },
        body: JSON.stringify({ name: 'x', email: 'x@x.com', role: 'owner' }),
      });
      assert.equal(deniedEmp.status, 403);

      const deniedItem = await apiFetch('/api/admin/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cashierToken}` },
        body: JSON.stringify({ categoryId: 'cat_grills', name: 'x', price: 10 }),
      });
      assert.equal(deniedItem.status, 403);

      const deniedRest = await apiFetch('/api/admin/restaurant', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${cashierToken}` },
        body: JSON.stringify({ name: 'Hacked' }),
      });
      assert.equal(deniedRest.status, 403);
    });

    await runTest('session revocation on logout, fired employee rejection, and password rotation token invalidation', async () => {
      const mCreate = await apiFetch('/api/admin/employees', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          id: 'emp_int_manager',
          name: 'مدير فحص',
          email: 'mgr.int@hara-grill.eg',
          role: 'manager',
          password: 'ManagerPass#1',
          mustChangePassword: true,
          isActive: true,
        }),
      });
      assert.equal(mCreate.status, 200);

      const mgr = await login('mgr.int@hara-grill.eg', 'ManagerPass#1');
      assert.equal(mgr.status, 200);
      assert.equal(mgr.mustChangePassword, true);
      const oldMgrToken = mgr.token!;

      // Overview blocked while mustChangePassword=true -> 403
      const blocked = await apiFetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${oldMgrToken}` },
      });
      assert.equal(blocked.status, 403);

      // Rotate password -> returns fresh token & revokes old token
      const rot = await apiFetch('/api/admin/password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldMgrToken}` },
        body: JSON.stringify({
          currentPassword: 'ManagerPass#1',
          newPassword: 'ManagerStrong#2',
        }),
      });
      assert.equal(rot.status, 200);
      const rotData = (await rot.json()) as { token: string };

      const oldAfterRot = await apiFetch('/api/admin/me', {
        headers: { Authorization: `Bearer ${oldMgrToken}` },
      });
      assert.equal(oldAfterRot.status, 401);

      const newAfterRot = await apiFetch('/api/admin/me', {
        headers: { Authorization: `Bearer ${rotData.token}` },
      });
      assert.equal(newAfterRot.status, 200);

      // Owner disables manager -> newAfterRot rejected immediately
      await apiFetch('/api/admin/employees', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          id: 'emp_int_manager',
          name: 'مدير فحص',
          email: 'mgr.int@hara-grill.eg',
          role: 'manager',
          isActive: false,
        }),
      });
      const afterDisable = await apiFetch('/api/admin/me', {
        headers: { Authorization: `Bearer ${rotData.token}` },
      });
      assert.equal(afterDisable.status, 401);

      // Logout revokes active session token immediately
      const mLogoutTest = await login('admin@hara-grill.eg', TEST_OWNER_PASS);
      assert.equal(mLogoutTest.status, 200);
      const tempToken = mLogoutTest.token!;
      const logoutRes = await apiFetch('/api/admin/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tempToken}` },
      });
      assert.equal(logoutRes.status, 200);
      const afterLogout = await apiFetch('/api/admin/me', {
        headers: { Authorization: `Bearer ${tempToken}` },
      });
      assert.equal(afterLogout.status, 401);
    });

    await runTest('HTTP Promise.all concurrency: idempotency, coupon usageLimit=1, double-accept deduction, and stock=1 competition', async () => {
      // Seed limited coupon (usageLimit = 1)
      const cpnCode = `CONC1_${Date.now()}`;
      await apiFetch('/api/admin/coupons', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          code: cpnCode,
          discountType: 'fixed',
          discountValue: 30,
          minOrderAmount: 50,
          usageLimit: 1,
          usedCount: 0,
          isActive: true,
        }),
      });

      // Seed item with stockQuantity = 1
      const limitedItemId = `item_conc_${Date.now()}`;
      await apiFetch('/api/admin/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          id: limitedItemId,
          categoryId: 'cat_grills',
          name: 'صنف مخزون ١',
          price: 150,
          stockQuantity: 1,
          isAvailable: true,
        }),
      });

      // Race 1: 5 parallel identical idempotencyKey requests
      const idemKey = `http_idem_${Date.now()}`;
      const idemResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          apiFetch('/api/orders', {
            method: 'POST',
            body: JSON.stringify({
              items: [{ itemId: limitedItemId, quantity: 1 }],
              fulfillmentType: 'pickup',
              customerName: 'عميل ١',
              customerPhone: '01099887766',
              idempotencyKey: idemKey,
            }),
          })
        )
      );
      assert.deepEqual(
        idemResults.map((r) => r.status).sort(),
        [200, 200, 200, 200, 201]
      );
      const idemBodies = await Promise.all(
        idemResults.map((r) => r.json() as Promise<{ order: { id: string } }>)
      );
      assert.equal(new Set(idemBodies.map((b) => b.order.id)).size, 1);

      // Race 2: 2 parallel checkouts racing for usageLimit=1 coupon -> 1 succeeds (201), 1 conflicts (409)
      const cpnRace = await Promise.all([
        apiFetch('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1, selectedSizeId: 'sz_half' }],
            fulfillmentType: 'pickup',
            couponCode: cpnCode,
            customerName: 'سباق ١',
            customerPhone: '01011112222',
          }),
        }),
        apiFetch('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1, selectedSizeId: 'sz_half' }],
            fulfillmentType: 'pickup',
            couponCode: cpnCode,
            customerName: 'سباق ٢',
            customerPhone: '01033334444',
          }),
        }),
      ]);
      assert.deepEqual(
        cpnRace.map((r) => r.status).sort(),
        [201, 409]
      );

      // Race 3: Create second order on limitedItemId, then race two accepts -> 1 succeeds (200), 1 gets 409
      const ord1Id = idemBodies[0].order.id;
      const ord2Res = await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ itemId: limitedItemId, quantity: 1 }],
          fulfillmentType: 'pickup',
          customerName: 'منافس ٢',
          customerPhone: '01055556666',
        }),
      });
      assert.equal(ord2Res.status, 201);
      const ord2Data = (await ord2Res.json()) as { order: { id: string } };

      // First race: double-accept the SAME order -> stock becomes 0 (not -1!)
      await Promise.all([
        apiFetch(`/api/admin/orders/${ord1Id}/status`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${ownerToken}` },
          body: JSON.stringify({ status: 'accepted' }),
        }),
        apiFetch(`/api/admin/orders/${ord1Id}/status`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${ownerToken}` },
          body: JSON.stringify({ status: 'accepted' }),
        }),
      ]);

      // Second order accept must fail with 409 Conflict because stock is 0
      const ord2AcceptRes = await apiFetch(`/api/admin/orders/${ord2Data.order.id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ status: 'accepted' }),
      });
      assert.equal(ord2AcceptRes.status, 409);
    });

    console.log(`\nSummary: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (serverProc?.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch {
        serverProc.kill('SIGKILL');
      }
    }
    if (hadDb && originalDb !== null) {
      fs.writeFileSync(DB_PATH, originalDb, 'utf-8');
    } else if (!hadDb && fs.existsSync(DB_PATH)) {
      fs.rmSync(DB_PATH, { force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
