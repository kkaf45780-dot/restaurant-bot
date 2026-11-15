import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  INITIAL_COUPONS,
  INITIAL_DELIVERY_ZONES,
  INITIAL_MENU_ITEMS,
  INITIAL_RESTAURANT,
} from '../src/data/restaurant.ts';
import { evaluateRestaurantHours } from '../src/lib/hours.ts';
import { hasPermission } from '../src/lib/permissions.ts';
import { calculateOrderTotals } from '../src/lib/pricing.ts';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const DB_PATH = path.resolve(process.cwd(), '.data', 'db.json');

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
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

async function runUnitTests(): Promise<void> {
  await runTest('pricing: calculates size delta, paid & free extras, percentage coupon & delivery fee', () => {
    // item_kebab_kofta_mix: base 340, sz_kilo (+320) -> 660; ex_extra_tahini (+15), ex_grilled_onion (0 free) -> 675 * 1 = 675
    // HARA10: 10% off 675 = 67.5, maxDiscountAmount = 80 -> 67.5
    // zone_nasr_city fee = 25 -> total = 675 - 67.5 + 25 = 632.5
    const result = calculateOrderTotals(
      [
        {
          itemId: 'item_kebab_kofta_mix',
          quantity: 1,
          selectedSizeId: 'sz_kilo',
          selectedExtraIds: ['ex_extra_tahini', 'ex_grilled_onion'],
        },
      ],
      INITIAL_MENU_ITEMS,
      'zone_nasr_city',
      INITIAL_DELIVERY_ZONES,
      {
        fulfillmentType: 'delivery',
        couponCode: 'hara10',
        coupons: INITIAL_COUPONS,
      }
    );

    assert.equal(result.subtotal, 675);
    assert.equal(result.discountAmount, 67.5);
    assert.equal(result.deliveryFee, 25);
    assert.equal(result.total, 632.5);
    assert.equal(result.belowZoneMinimum, false);
    assert.equal(result.appliedCoupon?.code, 'HARA10');
  });

  await runTest('pricing: pickup waives delivery fee, fixed coupon applies, detects zone minimum', () => {
    const pickupRes = calculateOrderTotals(
      [{ itemId: 'item_kofta_hati', quantity: 1, selectedSizeId: 'sz_half' }],
      INITIAL_MENU_ITEMS,
      'zone_fifth_settlement',
      INITIAL_DELIVERY_ZONES,
      {
        fulfillmentType: 'pickup',
        couponCode: 'WELCOME30',
        coupons: INITIAL_COUPONS,
      }
    );
    assert.equal(pickupRes.subtotal, 250);
    assert.equal(pickupRes.discountAmount, 30);
    assert.equal(pickupRes.deliveryFee, 0);
    assert.equal(pickupRes.total, 220);

    // Fifth settlement minOrderAmount is 200 -> 135 should trigger belowZoneMinimum
    const lowRes = calculateOrderTotals(
      [{ itemId: 'item_kofta_hati', quantity: 1, selectedSizeId: 'sz_quarter' }],
      INITIAL_MENU_ITEMS,
      'zone_fifth_settlement',
      INITIAL_DELIVERY_ZONES,
      { fulfillmentType: 'delivery' }
    );
    assert.equal(lowRes.subtotal, 135);
    assert.equal(lowRes.belowZoneMinimum, true);
  });

  await runTest('hours: evaluates open, overnight after midnight, closed, holiday exception, and manual overrides', () => {
    // Africa/Cairo is UTC+2 (no DST active in November)
    // Saturday 2026-11-14: opens 12:00, closes 01:30 overnight
    // 14:00 Cairo = 12:00 UTC on 2026-11-14 -> open
    const openRes = evaluateRestaurantHours(INITIAL_RESTAURANT, new Date('2026-11-14T12:00:00.000Z'));
    assert.equal(openRes.isOpen, true);

    // Sunday 2026-11-15 00:45 Cairo = 2026-11-14T22:45:00Z -> still inside Saturday overnight shift (until 01:30)
    const overnightRes = evaluateRestaurantHours(
      INITIAL_RESTAURANT,
      new Date('2026-11-14T22:45:00.000Z')
    );
    assert.equal(overnightRes.isOpen, true);

    // Sunday 2026-11-15 09:00 Cairo = 07:00 UTC -> closed, opens today at 12:00
    const closedRes = evaluateRestaurantHours(
      INITIAL_RESTAURANT,
      new Date('2026-11-15T07:00:00.000Z')
    );
    assert.equal(closedRes.isOpen, false);
    assert.ok(closedRes.nextOpenText);

    // Holiday exception closed
    const holidayRestaurant = {
      ...INITIAL_RESTAURANT,
      scheduleExceptions: [
        {
          id: 'exc_test_closed',
          date: '2026-11-15',
          label: 'إجازة صيانة',
          isClosed: true,
        },
      ],
    };
    const holidayRes = evaluateRestaurantHours(
      holidayRestaurant,
      new Date('2026-11-15T12:00:00.000Z')
    );
    assert.equal(holidayRes.isOpen, false);

    // Manual force_open & force_closed
    assert.equal(
      evaluateRestaurantHours(
        { ...INITIAL_RESTAURANT, manualStatus: 'force_open' },
        new Date('2026-11-15T07:00:00.000Z')
      ).isOpen,
      true
    );
    assert.equal(
      evaluateRestaurantHours(
        { ...INITIAL_RESTAURANT, manualStatus: 'force_closed' },
        new Date('2026-11-14T12:00:00.000Z')
      ).isOpen,
      false
    );
  });

  await runTest('rbac: verifies role permission matrix across owner, manager, cashier, kitchen', () => {
    assert.equal(hasPermission('owner', 'system'), true);
    assert.equal(hasPermission('owner', 'employees'), true);
    assert.equal(hasPermission('manager', 'menu'), true);
    assert.equal(hasPermission('manager', 'system'), false);
    assert.equal(hasPermission('manager', 'employees'), false);
    assert.equal(hasPermission('cashier', 'orders'), true);
    assert.equal(hasPermission('cashier', 'coupons'), true);
    assert.equal(hasPermission('cashier', 'menu'), false);
    assert.equal(hasPermission('kitchen', 'orders'), true);
    assert.equal(hasPermission('kitchen', 'settings'), false);
    assert.equal(hasPermission('kitchen', 'coupons'), false);
  });
}

async function runLiveE2ETests(): Promise<void> {
  // Check if server is reachable on BASE_URL
  try {
    const health = await fetch(`${BASE_URL}/api/health`);
    if (!health.ok) throw new Error(`Health returned ${health.status}`);
  } catch {
    console.warn(`SKIP  Live E2E tests (server not reachable at ${BASE_URL})`);
    return;
  }

  // Backup .data/db.json before mutating tests so seed data stays pristine
  const hadDb = fs.existsSync(DB_PATH);
  const originalDbContent = hadDb ? fs.readFileSync(DB_PATH, 'utf-8') : null;

  try {
    await runTest('routes: all customer, legal, and admin SPA routes respond 200', async () => {
      const routes = [
        '/',
        '/menu',
        '/chat',
        '/checkout',
        '/track',
        '/orders',
        '/favorites',
        '/about',
        '/privacy',
        '/terms',
        '/admin',
      ];
      for (const route of routes) {
        const res = await fetch(`${BASE_URL}${route}`);
        assert.equal(res.status, 200, `Expected 200 on ${route}`);
        const html = await res.text();
        assert.ok(html.includes('<div id="root"></div>'), `Missing root mount on ${route}`);
      }
    });

    await runTest('api: GET /api/restaurant and POST /api/coupons/validate work', async () => {
      const restRes = await fetch(`${BASE_URL}/api/restaurant`);
      assert.equal(restRes.status, 200);
      const restData = (await restRes.json()) as {
        bundle: { restaurant: { name: string }; items: Array<{ id: string }> };
      };
      assert.equal(restData.bundle.restaurant.name, 'مشويات الحارة');
      assert.ok(restData.bundle.items.length >= 10);

      const couponRes = await fetch(`${BASE_URL}/api/coupons/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'HARA10',
          items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1 }],
          deliveryZoneId: 'zone_nasr_city',
          fulfillmentType: 'delivery',
        }),
      });
      assert.equal(couponRes.status, 200);
      const couponData = (await couponRes.json()) as { valid: boolean; discountAmount: number };
      assert.equal(couponData.valid, true);
      assert.equal(couponData.discountAmount, 34);
    });

    const ownerPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
    const ownerEmail = process.env.ADMIN_EMAIL || 'admin@hara-grill.eg';

    // Login as owner
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { token: string; role: string };
    const ownerToken = loginData.token;
    assert.ok(ownerToken);
    assert.equal(loginData.role, 'owner');

    // Temporarily force restaurant open so order creation test succeeds 24/7
    const forceOpenRes = await fetch(`${BASE_URL}/api/admin/restaurant`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ manualStatus: 'force_open' }),
    });
    assert.equal(forceOpenRes.status, 200);

    await runTest('rbac live: kitchen employee gets 403 on settings but 200 on overview', async () => {
      const kitchenEmail = 'kitchen@hara-grill.eg';
      const kLogin = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: kitchenEmail, password: ownerPassword }),
      });
      assert.equal(kLogin.status, 200);
      const kData = (await kLogin.json()) as { token: string; role: string };
      assert.equal(kData.role, 'kitchen');

      const forbiddenRes = await fetch(`${BASE_URL}/api/admin/restaurant`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${kData.token}`,
        },
        body: JSON.stringify({ name: 'محاولة غير مصرح بها' }),
      });
      assert.equal(forbiddenRes.status, 403);

      const allowedOverview = await fetch(`${BASE_URL}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${kData.token}` },
      });
      assert.equal(allowedOverview.status, 200);
    });

    await runTest(
      'order lifecycle + stock deduction/restore + idempotency + rating + CSV export',
      async () => {
        // Read initial stock of item_kebab_kofta_mix
        const beforeBundle = (await (await fetch(`${BASE_URL}/api/restaurant`)).json()) as {
          bundle: { items: Array<{ id: string; stockQuantity: number }> };
        };
        const initialStock =
          beforeBundle.bundle.items.find((i) => i.id === 'item_kebab_kofta_mix')?.stockQuantity ?? 0;

        const idempotencyKey = `test_idem_${Date.now()}`;
        const orderPayload = {
          items: [{ itemId: 'item_kebab_kofta_mix', quantity: 2, selectedSizeId: 'sz_half' }],
          fulfillmentType: 'delivery',
          deliveryZoneId: 'zone_nasr_city',
          customerName: 'عميل اختبار آلي',
          customerPhone: '01099887766',
          customerAddress: '١٠ شارع الطيران، مدينة نصر',
          notes: 'اختبار آلي كامل',
          idempotencyKey,
        };

        const createRes = await fetch(`${BASE_URL}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload),
        });
        assert.equal(createRes.status, 201);
        const created = (await createRes.json()) as {
          order: { id: string; orderNumber: string; total: number; status: string };
          whatsappUrl: string;
        };
        assert.equal(created.order.status, 'received');
        assert.equal(created.order.total, 705); // 340 * 2 + 25 delivery
        assert.ok(created.whatsappUrl.includes('wa.me/'));

        // Idempotency check
        const dupRes = await fetch(`${BASE_URL}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload),
        });
        assert.equal(dupRes.status, 200);
        const dupData = (await dupRes.json()) as {
          order: { id: string };
          deduplicated: boolean;
        };
        assert.equal(dupData.deduplicated, true);
        assert.equal(dupData.order.id, created.order.id);

        // Tracking check
        const trackRes = await fetch(
          `${BASE_URL}/api/orders/track?orderNumber=${encodeURIComponent(created.order.orderNumber)}`
        );
        assert.equal(trackRes.status, 200);

        // Accept order -> verify stock deducted by 2
        const acceptRes = await fetch(
          `${BASE_URL}/api/admin/orders/${created.order.id}/status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${ownerToken}`,
            },
            body: JSON.stringify({ status: 'accepted' }),
          }
        );
        assert.equal(acceptRes.status, 200);

        const afterAcceptBundle = (await (await fetch(`${BASE_URL}/api/restaurant`)).json()) as {
          bundle: { items: Array<{ id: string; stockQuantity: number }> };
        };
        const stockAfterAccept =
          afterAcceptBundle.bundle.items.find((i) => i.id === 'item_kebab_kofta_mix')
            ?.stockQuantity ?? 0;
        assert.equal(stockAfterAccept, initialStock - 2);

        // Mark delivered -> submit rating 5 stars
        const deliverRes = await fetch(
          `${BASE_URL}/api/admin/orders/${created.order.id}/status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${ownerToken}`,
            },
            body: JSON.stringify({ status: 'delivered' }),
          }
        );
        assert.equal(deliverRes.status, 200);

        const rateRes = await fetch(`${BASE_URL}/api/orders/${created.order.orderNumber}/rate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 5, comment: 'ممتاز وساخن جداً' }),
        });
        assert.equal(rateRes.status, 200);
        const rated = (await rateRes.json()) as {
          order: { rating: number; ratingComment: string };
        };
        assert.equal(rated.order.rating, 5);
        assert.equal(rated.order.ratingComment, 'ممتاز وساخن جداً');

        // CSV export contains orderNumber and rating header
        const csvRes = await fetch(`${BASE_URL}/api/admin/orders/export`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert.equal(csvRes.status, 200);
        const csvText = await csvRes.text();
        assert.ok(csvText.includes('التقييم'));
        assert.ok(csvText.includes(created.order.orderNumber));
        assert.ok(csvText.includes('5/5'));

        // Cancel order -> verify stock restored to initialStock
        const cancelRes = await fetch(
          `${BASE_URL}/api/admin/orders/${created.order.id}/status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${ownerToken}`,
            },
            body: JSON.stringify({ status: 'cancelled' }),
          }
        );
        assert.equal(cancelRes.status, 200);

        const afterCancelBundle = (await (await fetch(`${BASE_URL}/api/restaurant`)).json()) as {
          bundle: { items: Array<{ id: string; stockQuantity: number }> };
        };
        const stockAfterCancel =
          afterCancelBundle.bundle.items.find((i) => i.id === 'item_kebab_kofta_mix')
            ?.stockQuantity ?? 0;
        assert.equal(stockAfterCancel, initialStock);
      }
    );
  } finally {
    if (hadDb && originalDbContent !== null) {
      fs.writeFileSync(DB_PATH, originalDbContent, 'utf-8');
    }
  }
}

async function main(): Promise<void> {
  console.log('Running موظف المطعم test suite...');
  await runUnitTests();
  await runLiveE2ETests();
  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
