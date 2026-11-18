import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.STAGING_BASE_URL || '';

if (!BASE_URL) {
  throw new Error('STAGING_BASE_URL environment variable is required to run this load test.');
}
if (BASE_URL.includes('restaurant-bot.kkaf45780.workers.dev')) {
  throw new Error('Refusing to run k6 load test against production URL.');
}

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '1m', target: 25 },
    { duration: '2m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1200'],
  },
};

export default function () {
  const menuRes = http.get(`${BASE_URL}/api/restaurant`);
  check(menuRes, {
    'GET /api/restaurant 200': (r) => r.status === 200,
  });

  const couponRes = http.post(
    `${BASE_URL}/api/coupons/validate`,
    JSON.stringify({
      code: 'HARA10',
      fulfillmentType: 'pickup',
      deliveryZoneId: '',
      items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1 }],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(couponRes, {
    'POST /api/coupons/validate 200': (r) => r.status === 200,
  });

  const orderRes = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      items: [{ itemId: 'item_kebab_kofta_mix', quantity: 1 }],
      fulfillmentType: 'pickup',
      customerName: `k6 Staging VU ${__VU}`,
      customerPhone: '01099887766',
      idempotencyKey: `k6_${__VU}_${__ITER}_${Date.now()}`,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(orderRes, {
    'POST /api/orders 201 or rate-limited 429': (r) => r.status === 201 || r.status === 429,
  });

  sleep(1);
}
