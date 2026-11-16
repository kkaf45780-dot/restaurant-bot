import type { RestaurantBundle } from '../types/restaurant.ts';

const VALID_ID_OR_SLUG_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidRestaurantIdOrSlug(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return false;
  return VALID_ID_OR_SLUG_REGEX.test(trimmed);
}

/**
 * Verifies that a fetched bundle actually matches the requested restaurantId or slug.
 * Prevents silent fallback to DEFAULT_RESTAURANT_ID for unknown/malformed IDs.
 */
export function resolveExactRestaurantBundle(
  bundle: RestaurantBundle | null | undefined,
  requestedIdOrSlug?: string | null
): RestaurantBundle | null {
  if (!bundle) return null;
  const req = requestedIdOrSlug?.trim();
  if (!req) return bundle;
  if (!isValidRestaurantIdOrSlug(req)) return null;
  if (bundle.restaurant.id === req || bundle.restaurant.slug === req) {
    return bundle;
  }
  return null;
}

/**
 * Minimizes public GET /api/restaurant payload:
 * - Strips internal AI config (model, customInstructions, tone, allowedTopics)
 * - Strips inventory levels (stockQuantity, lowStockThreshold) while keeping accurate isAvailable
 * - Strips coupon operational counters (usedCount, usageLimit)
 */
export function sanitizePublicBundle(bundle: RestaurantBundle): RestaurantBundle {
  const { restaurant, categories, items, deliveryZones, branches, activeCoupons } = bundle;

  const aiOrderIntake =
    restaurant.aiSettings.aiOrderIntake ??
    restaurant.aiSettings.allowedTopics?.orderIntake ??
    true;

  return {
    restaurant: {
      ...restaurant,
      aiSettings: {
        enabled: restaurant.aiSettings.enabled,
        aiOrderIntake,
        welcomeMessage: restaurant.aiSettings.welcomeMessage,
      },
    },
    categories,
    items: items.map((item) => {
      const hasStock =
        typeof item.stockQuantity === 'number' ? item.stockQuantity > 0 : true;
      return {
        id: item.id,
        restaurantId: item.restaurantId,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        price: item.price,
        imageUrl: item.imageUrl,
        isAvailable: Boolean(item.isAvailable && hasStock),
        sortOrder: item.sortOrder,
        isPopular: item.isPopular,
        sizes: item.sizes,
        extras: item.extras,
      };
    }),
    deliveryZones,
    branches,
    activeCoupons: activeCoupons
      .filter((c) => c.isActive)
      .map((c) => ({
        id: c.id,
        restaurantId: c.restaurantId,
        code: c.code,
        description: c.description,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minOrderAmount: c.minOrderAmount,
        maxDiscountAmount: c.maxDiscountAmount,
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        isActive: c.isActive,
        applicableCategoryIds: c.applicableCategoryIds,
        applicableItemIds: c.applicableItemIds,
      })),
  };
}
