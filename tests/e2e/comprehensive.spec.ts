import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const E2E_PORT = 3109;
const BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${E2E_PORT}`;
const DB_PATH = path.resolve(process.cwd(), '.data', 'db.json');
const OWNER_EMAIL = 'admin@hara-grill.eg';
const OWNER_PASS = 'PlaywrightAudit#2026!';

async function waitForReady(url: string, timeoutMs = 25000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Wait for boot
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Playwright E2E server did not start within ${timeoutMs}ms`);
}

let serverProc: ChildProcess | null = null;
let hadOriginalDb = false;
let originalDbContent: string | null = null;

test.describe('Comprehensive Customer + Admin + Responsive E2E Suite', () => {
  test.beforeAll(async () => {
    hadOriginalDb = fs.existsSync(DB_PATH);
    originalDbContent = hadOriginalDb ? fs.readFileSync(DB_PATH, 'utf-8') : null;

    if (!process.env.TEST_BASE_URL) {
      const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
      serverProc = spawn(tsxBin, ['server.ts'], {
        cwd: process.cwd(),
        detached: true,
        env: {
          ...process.env,
          PORT: String(E2E_PORT),
          DISABLE_HMR: 'true',
          NODE_ENV: 'production',
          ADMIN_EMAIL: OWNER_EMAIL,
          ADMIN_PASSWORD: OWNER_PASS,
          ADMIN_SESSION_SECRET: 'playwright_audit_session_secret_at_least_32!',
        },
        stdio: 'ignore',
      });
      await waitForReady(BASE_URL);
    }

    // Force restaurant open for deterministic checkout E2E regardless of time of day
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASS }),
    });
    const { token } = (await loginRes.json()) as { token: string };
    await fetch(`${BASE_URL}/api/admin/restaurant`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ manualStatus: 'force_open' }),
    });
  });

  test.afterAll(() => {
    if (serverProc?.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch {
        serverProc.kill('SIGKILL');
      }
    }
    if (hadOriginalDb && originalDbContent !== null) {
      fs.writeFileSync(DB_PATH, originalDbContent, 'utf-8');
    } else if (!hadOriginalDb && fs.existsSync(DB_PATH)) {
      fs.rmSync(DB_PATH, { force: true });
    }
  });

  test('customer journey: browse, filter, modal options, cart, coupon validation, checkout, reload track, and favorites', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const server5xx: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 500) server5xx.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(`${BASE_URL}/menu`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading').first()).toBeVisible();

    // Search filter
    const searchInput = page.getByLabel('ابحث عن صنف في القائمة');
    await searchInput.fill('كباب');
    await expect(page.getByText('كباب وكفتة').first()).toBeVisible();
    await searchInput.fill('');

    // Open product details modal via customize button or dish card
    const customizeBtn = page.getByLabel('تخصيص الصنف').first();
    await customizeBtn.click();
    await expect(page.getByLabel('إغلاق النافذة')).toBeVisible();
    await page.getByLabel('زيادة الكمية').click();
    await page.getByRole('button', { name: /أضف للسلة/ }).click();

    // Cart badge should show items; navigate to checkout
    await page.getByLabel(/السلة \(/).click();
    await page.waitForURL(/\/checkout/);

    // Invalid coupon should show clean error
    const couponInput = page.getByPlaceholder(/هل لديك كود خصم/);
    await couponInput.fill('INVALID99');
    await page.getByRole('button', { name: /تطبيق/ }).click();
    await expect(page.getByText(/غير موجود|غير صالح/)).toBeVisible();

    // Valid coupon HARA10
    await couponInput.fill('HARA10');
    await page.getByRole('button', { name: /تطبيق/ }).click();
    await expect(page.getByText(/تم تطبيق كود HARA10/)).toBeVisible();

    // Fill checkout form with pickup mode so delivery zone/address isn't a blocker, then verify
    const pickupBtn = page.getByRole('button', { name: /استلام من الفرع/ });
    await pickupBtn.click();

    await page.getByPlaceholder('اكتب اسمك بالكامل').fill('عميل بلاي رايت');
    await page.getByPlaceholder('01012345678').fill('01099887766');

    await page.getByRole('button', { name: /تأكيد الطلب/ }).click();
    await page.waitForURL(/\/track\?order=.*&token=/, { timeout: 15000 });
    await expect(page.getByText('تم الاستلام').first()).toBeVisible();

    // Reload track page — should persist securely via token URL query
    await page.reload();
    await expect(page.getByText('تم الاستلام').first()).toBeVisible();

    // Favorites route
    await page.goto(`${BASE_URL}/menu`);
    const favBtn = page.getByLabel('المفضلة').first();
    await favBtn.click();
    await page.goto(`${BASE_URL}/favorites`);
    await expect(page.getByRole('heading').first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(server5xx).toEqual([]);
  });

  test('admin flow: login error -> valid login -> menu item CRUD live sync -> delete -> logout', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${BASE_URL}/admin`);
    await page.getByLabel('البريد الإلكتروني للمدير').fill(OWNER_EMAIL);
    await page.getByLabel('كلمة المرور').fill('WrongPass#99');
    await page.getByRole('button', { name: /دخول إلى لوحة التحكم/ }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    await page.getByLabel('كلمة المرور').fill(OWNER_PASS);
    await page.getByRole('button', { name: /دخول إلى لوحة التحكم/ }).click();
    await expect(page.getByText(/أهلاً بك/).first()).toBeVisible({ timeout: 15000 });

    // Open Menu Manager & create a test item
    await page.getByRole('button', { name: /إدارة القائمة/ }).click();
    const dishName = `صنف اختبار E2E ${Date.now()}`;
    await page.getByPlaceholder('مثال: كباب وكفتة مشكل على الفحم').fill(dishName);
    await page.locator('input[type="number"]').first().fill('195');
    await page.getByRole('button', { name: /إضافة الصنف|حفظ الصنف/ }).click();
    await expect(page.getByText(dishName).first()).toBeVisible({ timeout: 10000 });

    // Verify synced item appears in customer storefront menu
    await page.goto(`${BASE_URL}/menu`);
    await expect(page.getByText(dishName).first()).toBeVisible({ timeout: 10000 });

    // Return to Admin, delete the test item, and logout cleanly
    await page.goto(`${BASE_URL}/admin`);
    await page.getByRole('button', { name: /إدارة القائمة/ }).click();
    await expect(page.getByText(dishName).first()).toBeVisible();
    await page.getByRole('button', { name: /حذف/ }).first().click();

    await page.getByRole('button', { name: /تسجيل الخروج/ }).first().click();
    await expect(page.getByLabel('البريد الإلكتروني للمدير')).toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  });

  test('responsive RTL layout has no horizontal overflow across Mobile, Tablet, and Desktop viewports', async ({
    page,
  }) => {
    const viewports = [
      { name: 'Desktop-1366', width: 1366, height: 768 },
      { name: 'Desktop-1440', width: 1440, height: 900 },
      { name: 'Desktop-1920', width: 1920, height: 1080 },
      { name: 'Tablet-Portrait', width: 768, height: 1024 },
      { name: 'Tablet-Landscape', width: 1024, height: 768 },
      { name: 'Mobile-375', width: 375, height: 812 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ['/', '/menu', '/chat', '/admin']) {
        await page.goto(`${BASE_URL}${route}`);
        await page.waitForLoadState('domcontentloaded');
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          dir: document.documentElement.dir,
        }));
        expect(metrics.dir, `${vp.name} ${route} dir`).toBe('rtl');
        expect(
          metrics.scrollWidth,
          `${vp.name} ${route} horizontal overflow (${metrics.scrollWidth} > ${metrics.innerWidth})`
        ).toBeLessThanOrEqual(metrics.innerWidth + 1);
      }
    }
  });
});
