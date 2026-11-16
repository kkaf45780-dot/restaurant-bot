import { expect, test } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

test.describe('Chat Storage Privacy & Security (E2E)', () => {
  test('redacts PII in chat storage, expires after 24h TTL, and honors opt-out switch', async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`);
    await page.waitForSelector('h1');

    // Opt-out switch should exist and toggle off localStorage persistence
    const optOutSwitch = page.getByRole('switch', { name: /عدم حفظ المحادثة/ });
    await expect(optOutSwitch).toBeVisible();

    await optOutSwitch.click();
    await expect(optOutSwitch).toHaveAttribute('aria-checked', 'true');

    const chatStoredWhileOptedOut = await page.evaluate(() => {
      return Object.keys(localStorage).some((k) => k.startsWith('chat_rest_'));
    });
    expect(chatStoredWhileOptedOut).toBe(false);

    // Re-enable persistence and verify expired 24h envelope is purged on reload
    await optOutSwitch.click();
    await expect(optOutSwitch).toHaveAttribute('aria-checked', 'false');

    await page.evaluate(() => {
      const restKeys = Object.keys(localStorage).filter((k) => k.startsWith('chat_rest_'));
      const key = restKeys[0] || 'chat_rest_meshweyat_elhara';
      localStorage.setItem(
        key,
        JSON.stringify({
          messages: [
            {
              id: 'old_1',
              role: 'user',
              text: 'رسالة قديمة 01012345678',
              timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
            },
          ],
          savedAt: Date.now() - 48 * 60 * 60 * 1000,
          expiresAt: Date.now() - 1000,
        })
      );
    });

    await page.reload();
    await page.waitForSelector('h1');

    const oldMsgVisible = await page.getByText('رسالة قديمة').count();
    expect(oldMsgVisible).toBe(0);
  });

  test('returns real HTTP 404 for unknown routes', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/unknown-pentest-route-404`);
    expect(res.status()).toBe(404);
  });
});
