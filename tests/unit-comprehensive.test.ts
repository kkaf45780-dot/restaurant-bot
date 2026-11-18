import { describe, expect, it } from 'vitest';
import {
  INITIAL_BRANCHES,
  INITIAL_CATEGORIES,
  INITIAL_COUPONS,
  INITIAL_DELIVERY_ZONES,
  INITIAL_MENU_ITEMS,
  INITIAL_RESTAURANT,
} from '../src/data/restaurant.ts';
import { stripPiiFromText } from '../src/lib/chat-storage.ts';
import { evaluateRestaurantHours } from '../src/lib/hours.ts';
import { hasPermission } from '../src/lib/permissions.ts';
import {
  buildDraftLineKey,
  calculateOrderTotals,
  evaluateCoupon,
  fromPiasters,
  toPiasters,
} from '../src/lib/pricing.ts';
import { detectValidImageFromBytes, isSafeMediaUrl } from '../src/lib/uploadValidation.ts';
import { isValidRestaurantIdOrSlug, sanitizePublicBundle } from '../src/server/publicSanitizer.ts';
import type { Coupon, MenuItem, Restaurant, RestaurantBundle } from '../src/types/restaurant.ts';

describe('Pricing, Stock & Coupon Logic', () => {
  it('prevents split-line stock bypass by aggregating quantity across item variants', () => {
    const lowStockItem: MenuItem = {
      ...INITIAL_MENU_ITEMS[0],
      id: 'item_limited_test',
      name: 'مشكل محدود',
      price: 200,
      stockQuantity: 3,
      isAvailable: true,
    };

    const res = calculateOrderTotals(
      [
        {
          itemId: 'item_limited_test',
          quantity: 2,
          selectedSizeId: lowStockItem.sizes?.[0]?.id,
          lineKey: 'tampered_same_key',
        },
        {
          itemId: 'item_limited_test',
          quantity: 2,
          selectedSizeId: lowStockItem.sizes?.[1]?.id ?? 'other_sz',
          itemNotes: 'بدون بصل',
          lineKey: 'tampered_same_key',
        },
      ],
      [lowStockItem],
      'zone_nasr_city',
      INITIAL_DELIVERY_ZONES,
      { fulfillmentType: 'pickup' }
    );

    expect(res.outOfStockItemNames).toHaveLength(1);
    expect(res.outOfStockItemNames[0]).toContain('مشكل محدود');
    expect(res.validItems).toHaveLength(2);
  });

  it('ignores untrusted caller lineKey and deduplicates selectedExtraIds', () => {
    const item = INITIAL_MENU_ITEMS[0];
    const extraId = item.extras?.[0]?.id;
    const extraPrice = item.extras?.[0]?.price ?? 0;

    const k1 = buildDraftLineKey({
      itemId: item.id,
      selectedSizeId: item.sizes?.[0]?.id,
      selectedExtraIds: extraId ? [extraId, extraId] : [],
      itemNotes: '  ملاحظة  ',
    });
    const k2 = buildDraftLineKey({
      itemId: item.id,
      selectedSizeId: item.sizes?.[0]?.id,
      selectedExtraIds: extraId ? [extraId] : [],
      itemNotes: 'ملاحظة',
    });
    expect(k1).toBe(k2);

    const calc = calculateOrderTotals(
      [
        {
          itemId: item.id,
          quantity: 1,
          selectedSizeId: item.sizes?.[0]?.id,
          selectedExtraIds: extraId ? [extraId, extraId, extraId] : [],
          lineKey: 'forged_key',
        },
      ],
      INITIAL_MENU_ITEMS,
      'zone_nasr_city',
      INITIAL_DELIVERY_ZONES,
      { fulfillmentType: 'pickup' }
    );

    expect(calc.validItems[0].selectedExtras).toHaveLength(extraId ? 1 : 0);
    const sizeDelta = item.sizes?.[0]?.priceDelta ?? 0;
    expect(calc.subtotal).toBe(fromPiasters(toPiasters(item.price + sizeDelta + extraPrice)));
  });

  it('rejects non-finite, zero, negative, and >500 quantities and avoids float drift', () => {
    const floatItem: MenuItem = {
      ...INITIAL_MENU_ITEMS[0],
      id: 'item_float',
      price: 0.1,
      sizes: [],
      extras: [],
      stockQuantity: 1000,
    };

    const res = calculateOrderTotals(
      [
        { itemId: 'item_float', quantity: Number.NaN },
        { itemId: 'item_float', quantity: 0 },
        { itemId: 'item_float', quantity: -3 },
        { itemId: 'item_float', quantity: 501 },
        { itemId: 'item_float', quantity: 3 },
      ],
      [floatItem],
      'zone_nasr_city',
      INITIAL_DELIVERY_ZONES,
      { fulfillmentType: 'pickup' }
    );

    expect(res.validItems).toHaveLength(1);
    expect(res.validItems[0].quantity).toBe(3);
    expect(res.subtotal).toBe(0.3);
  });

  it('validates coupon constraints: >100% percentage, expired, limit reached, category scope', () => {
    const baseCoupon: Coupon = {
      ...INITIAL_COUPONS[0],
      id: 'cpn_test',
      code: 'TEST20',
      discountType: 'percentage',
      discountValue: 20,
      minOrderAmount: 100,
      validFrom: '2020-01-01',
      validUntil: '2099-12-31',
      usageLimit: 5,
      usedCount: 0,
      isActive: true,
    };

    const sampleOrderItems = [
      {
        lineKey: 'k1',
        itemId: INITIAL_MENU_ITEMS[0].id,
        name: INITIAL_MENU_ITEMS[0].name,
        unitPrice: 300,
        quantity: 1,
        lineTotal: 300,
      },
    ];

    const over100 = evaluateCoupon(
      'TEST20',
      [{ ...baseCoupon, discountValue: 150 }],
      sampleOrderItems,
      INITIAL_MENU_ITEMS,
      toPiasters(300)
    );
    expect(over100.valid).toBe(false);

    const inactive = evaluateCoupon(
      'TEST20',
      [{ ...baseCoupon, isActive: false }],
      sampleOrderItems,
      INITIAL_MENU_ITEMS,
      toPiasters(300)
    );
    expect(inactive.valid).toBe(false);

    const expired = evaluateCoupon(
      'TEST20',
      [{ ...baseCoupon, validUntil: '2021-01-01' }],
      sampleOrderItems,
      INITIAL_MENU_ITEMS,
      toPiasters(300)
    );
    expect(expired.valid).toBe(false);

    const exhausted = evaluateCoupon(
      'TEST20',
      [{ ...baseCoupon, usedCount: 5, usageLimit: 5 }],
      sampleOrderItems,
      INITIAL_MENU_ITEMS,
      toPiasters(300)
    );
    expect(exhausted.valid).toBe(false);

    const wrongCategory = evaluateCoupon(
      'TEST20',
      [{ ...baseCoupon, applicableCategoryIds: ['non_matching_cat'] }],
      sampleOrderItems,
      INITIAL_MENU_ITEMS,
      toPiasters(300)
    );
    expect(wrongCategory.valid).toBe(false);

    const capped = evaluateCoupon(
      'TEST20',
      [{ ...baseCoupon, maxDiscountAmount: 40 }],
      sampleOrderItems,
      INITIAL_MENU_ITEMS,
      toPiasters(300)
    );
    expect(capped.valid).toBe(true);
    expect(capped.discountAmount).toBe(40);
  });
});

describe('Media URL & Upload Magic-Byte Validation', () => {
  it('blocks javascript:, vbscript:, protocol-relative //, and data:image/svg+xml URLs', () => {
    expect(isSafeMediaUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeMediaUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeMediaUrl('//attacker.example/evil.png')).toBe(false);
    expect(isSafeMediaUrl('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+')).toBe(false);
    expect(isSafeMediaUrl('data:text/html,<script>alert(1)</script>')).toBe(false);

    expect(isSafeMediaUrl('/uploads/burger.png')).toBe(true);
    expect(isSafeMediaUrl('https://cdn.example.com/dish.webp')).toBe(true);
    expect(
      isSafeMediaUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
    ).toBe(true);
  });

  it('validates real raster headers and rejects spoofed MIME types', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpgHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const svgBytes = new TextEncoder().encode('<svg onload=alert(1)></svg>');

    expect(detectValidImageFromBytes(pngHeader, 'image/png')?.extension).toBe('png');
    expect(detectValidImageFromBytes(jpgHeader, 'image/jpeg')?.extension).toBe('jpg');
    expect(detectValidImageFromBytes(svgBytes, 'image/png')).toBeNull();
    expect(detectValidImageFromBytes(pngHeader, 'image/svg+xml')).toBeNull();
  });
});

describe('Hours Evaluation, RBAC & Public Sanitization', () => {
  it('evaluates manual overrides, overnight shifts across midnight, and holiday exceptions', () => {
    const base: Restaurant = structuredClone(INITIAL_RESTAURANT);

    expect(evaluateRestaurantHours({ ...base, manualStatus: 'force_open' }).isOpen).toBe(true);
    expect(evaluateRestaurantHours({ ...base, manualStatus: 'force_closed' }).isOpen).toBe(false);

    // Friday closes at 02:00 overnight -> Saturday 00:45 Africa/Cairo (22:45 UTC Friday in winter) should be open
    const cairoWinterMidnight = new Date('2026-01-16T22:45:00Z'); // 00:45 Saturday Cairo time (UTC+2)
    expect(evaluateRestaurantHours(base, cairoWinterMidnight).isOpen).toBe(true);

    // Closed exception day overrides weekly hours
    const withClosedExc: Restaurant = {
      ...base,
      scheduleExceptions: [
        { id: 'e1', date: '2026-06-15', label: 'إجازة العيد', isClosed: true },
      ],
    };
    const closedMoment = new Date('2026-06-15T15:00:00Z'); // Monday 18:00 Cairo
    const closedStatus = evaluateRestaurantHours(withClosedExc, closedMoment);
    expect(closedStatus.isOpen).toBe(false);
    expect(closedStatus.todayHoursText).toContain('إجازة العيد');
  });

  it('enforces RBAC role permissions accurately', () => {
    expect(hasPermission('owner', 'system')).toBe(true);
    expect(hasPermission('owner', 'employees')).toBe(true);
    expect(hasPermission('manager', 'menu')).toBe(true);
    expect(hasPermission('manager', 'employees')).toBe(false);
    expect(hasPermission('cashier', 'orders')).toBe(true);
    expect(hasPermission('cashier', 'coupons')).toBe(true);
    expect(hasPermission('cashier', 'menu')).toBe(false);
    expect(hasPermission('kitchen', 'orders')).toBe(true);
    expect(hasPermission('kitchen', 'coupons')).toBe(false);
  });

  it('strips sensitive fields from public bundles and validates tenant slugs', () => {
    const bundle: RestaurantBundle = {
      restaurant: structuredClone(INITIAL_RESTAURANT),
      categories: structuredClone(INITIAL_CATEGORIES),
      items: [
        { ...INITIAL_MENU_ITEMS[0], stockQuantity: 0, isAvailable: true },
        { ...INITIAL_MENU_ITEMS[1], stockQuantity: 10, isAvailable: true },
      ],
      deliveryZones: structuredClone(INITIAL_DELIVERY_ZONES),
      branches: structuredClone(INITIAL_BRANCHES),
      activeCoupons: structuredClone(INITIAL_COUPONS),
    };

    const sanitized = sanitizePublicBundle(bundle);
    expect(sanitized.restaurant.aiSettings.customInstructions).toBeUndefined();
    expect(sanitized.restaurant.aiSettings.model).toBeUndefined();
    expect(sanitized.items[0].stockQuantity).toBeUndefined();
    expect(sanitized.items[0].isAvailable).toBe(false);
    expect(sanitized.items[1].isAvailable).toBe(true);
    expect(sanitized.activeCoupons[0].usedCount).toBeUndefined();

    expect(isValidRestaurantIdOrSlug('meshweyat-elhara')).toBe(true);
    expect(isValidRestaurantIdOrSlug('../etc/passwd')).toBe(false);
    expect(isValidRestaurantIdOrSlug('rest,status.eq.delivered')).toBe(false);

    const scrubbed = stripPiiFromText('اتصل بي على 01012345678 أو test@mail.com شارع النصر ١٢');
    expect(scrubbed).not.toContain('01012345678');
    expect(scrubbed).not.toContain('test@mail.com');
  });
});
