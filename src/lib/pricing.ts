import type {
  Coupon,
  DeliveryZone,
  FulfillmentType,
  MenuItem,
  OrderDraftItem,
  OrderItem,
} from '../types/restaurant.ts';

/**
 * Decimal-safe integer piaster representation (1 EGP = 100 piasters).
 * Prevents IEEE-754 floating-point drift in order totals.
 */
export function toPiasters(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function fromPiasters(piasters: number): number {
  return Math.round(piasters) / 100;
}

export function formatCurrency(amount: number, currencyLabel = 'ج.م'): string {
  const rounded = fromPiasters(toPiasters(amount));
  const formatted = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currencyLabel}`;
}

export function buildDraftLineKey(entry: {
  itemId: string;
  selectedSizeId?: string;
  selectedExtraIds?: string[];
  itemNotes?: string;
}): string {
  const extrasPart = [...(entry.selectedExtraIds ?? [])].sort().join(',');
  const notePart = (entry.itemNotes ?? '').trim();
  return `${entry.itemId}__${entry.selectedSizeId ?? 'default'}__${extrasPart}__${notePart}`;
}

export interface CouponEvaluation {
  valid: boolean;
  coupon: Coupon | null;
  discountAmount: number;
  errorMessage?: string;
}

export function evaluateCoupon(
  code: string | undefined,
  coupons: Coupon[],
  validItems: OrderItem[],
  catalogItems: MenuItem[],
  subtotalPiasters: number
): CouponEvaluation {
  const trimmed = (code || '').trim().toUpperCase();
  if (!trimmed) {
    return { valid: false, coupon: null, discountAmount: 0 };
  }

  const coupon = coupons.find((c) => c.code.toUpperCase() === trimmed);
  if (!coupon) {
    return {
      valid: false,
      coupon: null,
      discountAmount: 0,
      errorMessage: 'كود الخصم غير موجود.',
    };
  }

  if (!coupon.isActive) {
    return {
      valid: false,
      coupon,
      discountAmount: 0,
      errorMessage: 'كود الخصم غير مفعل حالياً.',
    };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  if (coupon.validFrom && todayStr < coupon.validFrom) {
    return {
      valid: false,
      coupon,
      discountAmount: 0,
      errorMessage: 'لم يبدأ موعد سريان هذا الكود بعد.',
    };
  }
  if (coupon.validUntil && todayStr > coupon.validUntil) {
    return {
      valid: false,
      coupon,
      discountAmount: 0,
      errorMessage: 'انتهت صلاحية كود الخصم.',
    };
  }

  const usageLimit = coupon.usageLimit ?? 0;
  const usedCount = coupon.usedCount ?? 0;
  if (usageLimit > 0 && usedCount >= usageLimit) {
    return {
      valid: false,
      coupon,
      discountAmount: 0,
      errorMessage: 'تم استنفاد الحد الأقصى لاستخدام هذا الكود.',
    };
  }

  const minPiasters = toPiasters(coupon.minOrderAmount || 0);
  if (subtotalPiasters < minPiasters) {
    return {
      valid: false,
      coupon,
      discountAmount: 0,
      errorMessage: `الحد الأدنى لتطبيق الكود هو ${formatCurrency(coupon.minOrderAmount)}.`,
    };
  }

  // Filter eligible subtotal if category/product restriction exists
  let eligiblePiasters = subtotalPiasters;
  const hasCatScope = Boolean(coupon.applicableCategoryIds?.length);
  const hasItemScope = Boolean(coupon.applicableItemIds?.length);

  if (hasCatScope || hasItemScope) {
    const itemMap = new Map(catalogItems.map((i) => [i.id, i]));
    eligiblePiasters = 0;
    for (const oi of validItems) {
      const catItem = itemMap.get(oi.itemId);
      if (!catItem) continue;
      const inItems = hasItemScope && coupon.applicableItemIds!.includes(oi.itemId);
      const inCats = hasCatScope && coupon.applicableCategoryIds!.includes(catItem.categoryId);
      if (inItems || inCats) {
        eligiblePiasters += toPiasters(oi.lineTotal);
      }
    }
    if (eligiblePiasters <= 0) {
      return {
        valid: false,
        coupon,
        discountAmount: 0,
        errorMessage: 'هذا الكود لا ينطبق على الأصناف الموجودة في السلة.',
      };
    }
  }

  let discountPiasters = 0;
  if (coupon.discountType === 'percentage') {
    discountPiasters = Math.round((eligiblePiasters * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount && coupon.maxDiscountAmount > 0) {
      discountPiasters = Math.min(discountPiasters, toPiasters(coupon.maxDiscountAmount));
    }
  } else {
    discountPiasters = toPiasters(coupon.discountValue);
  }

  discountPiasters = Math.min(discountPiasters, subtotalPiasters);

  return {
    valid: discountPiasters > 0,
    coupon,
    discountAmount: fromPiasters(discountPiasters),
  };
}

export interface CalculatedOrderResult {
  validItems: OrderItem[];
  unavailableItemNames: string[];
  outOfStockItemNames: string[];
  unknownItemIds: string[];
  subtotal: number;
  discountAmount: number;
  appliedCoupon: Coupon | null;
  couponError?: string;
  deliveryFee: number;
  total: number;
  deliveryZone: DeliveryZone | null;
  belowZoneMinimum: boolean;
}

export function calculateOrderTotals(
  draftItems: OrderDraftItem[],
  catalogItems: MenuItem[],
  deliveryZoneId: string | undefined,
  deliveryZones: DeliveryZone[],
  options?: {
    fulfillmentType?: FulfillmentType;
    couponCode?: string;
    coupons?: Coupon[];
  }
): CalculatedOrderResult {
  const catalogMap = new Map<string, MenuItem>();
  for (const item of catalogItems) {
    catalogMap.set(item.id, item);
  }

  const fulfillmentType: FulfillmentType = options?.fulfillmentType ?? 'delivery';

  // Merge entries with identical lineKey (itemId + size + extras + note)
  const mergedLines = new Map<string, OrderDraftItem>();
  for (const entry of draftItems) {
    const qty = Math.floor(Number(entry.quantity) || 0);
    if (qty <= 0) continue;
    const key = entry.lineKey || buildDraftLineKey(entry);
    const existing = mergedLines.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      mergedLines.set(key, { ...entry, lineKey: key, quantity: qty });
    }
  }

  const validItems: OrderItem[] = [];
  const unavailableItemNames: string[] = [];
  const outOfStockItemNames: string[] = [];
  const unknownItemIds: string[] = [];
  let subtotalPiasters = 0;

  for (const [lineKey, entry] of mergedLines.entries()) {
    const catalogItem = catalogMap.get(entry.itemId);
    if (!catalogItem) {
      unknownItemIds.push(entry.itemId);
      continue;
    }
    if (!catalogItem.isAvailable) {
      unavailableItemNames.push(catalogItem.name);
      continue;
    }
    if (
      typeof catalogItem.stockQuantity === 'number' &&
      catalogItem.stockQuantity >= 0 &&
      catalogItem.stockQuantity < entry.quantity
    ) {
      outOfStockItemNames.push(`${catalogItem.name} (المتوفر: ${catalogItem.stockQuantity})`);
    }

    const sizes = catalogItem.sizes ?? [];
    const matchedSize =
      sizes.find((s) => s.id === entry.selectedSizeId) ??
      sizes.find((s) => s.isDefault) ??
      sizes[0];
    const sizeDeltaPiasters = matchedSize ? toPiasters(matchedSize.priceDelta) : 0;

    const extrasCatalog = catalogItem.extras ?? [];
    const selectedExtraIds = entry.selectedExtraIds ?? [];
    const resolvedExtras: Array<{ id: string; label: string; price: number }> = [];
    let extrasPiasters = 0;
    for (const exId of selectedExtraIds) {
      const ex = extrasCatalog.find((e) => e.id === exId);
      if (ex) {
        const price = ex.isFree ? 0 : ex.price;
        resolvedExtras.push({ id: ex.id, label: ex.label, price });
        extrasPiasters += toPiasters(price);
      }
    }

    const basePiasters = toPiasters(catalogItem.price);
    const unitPricePiasters = Math.max(0, basePiasters + sizeDeltaPiasters + extrasPiasters);
    const lineTotalPiasters = unitPricePiasters * entry.quantity;
    subtotalPiasters += lineTotalPiasters;

    validItems.push({
      lineKey,
      itemId: catalogItem.id,
      name: catalogItem.name,
      unitPrice: fromPiasters(unitPricePiasters),
      quantity: entry.quantity,
      lineTotal: fromPiasters(lineTotalPiasters),
      selectedSizeId: matchedSize?.id,
      selectedSizeLabel: matchedSize?.label,
      sizePriceDelta: matchedSize?.priceDelta,
      selectedExtras: resolvedExtras,
      itemNotes: entry.itemNotes?.trim() || undefined,
    });
  }

  const couponEval = evaluateCoupon(
    options?.couponCode,
    options?.coupons ?? [],
    validItems,
    catalogItems,
    subtotalPiasters
  );
  const discountPiasters = couponEval.valid ? toPiasters(couponEval.discountAmount) : 0;

  const matchedZone =
    fulfillmentType === 'delivery' && deliveryZoneId
      ? deliveryZones.find((z) => z.id === deliveryZoneId && z.isActive) ?? null
      : null;

  const deliveryFeePiasters =
    fulfillmentType === 'delivery' && matchedZone ? toPiasters(matchedZone.fee) : 0;

  const belowZoneMinimum = Boolean(
    fulfillmentType === 'delivery' &&
      matchedZone &&
      matchedZone.minOrderAmount > 0 &&
      subtotalPiasters < toPiasters(matchedZone.minOrderAmount)
  );

  const totalPiasters = Math.max(0, subtotalPiasters - discountPiasters) + deliveryFeePiasters;

  return {
    validItems,
    unavailableItemNames,
    outOfStockItemNames,
    unknownItemIds,
    subtotal: fromPiasters(subtotalPiasters),
    discountAmount: fromPiasters(discountPiasters),
    appliedCoupon: couponEval.valid ? couponEval.coupon : null,
    couponError: couponEval.errorMessage,
    deliveryFee: fromPiasters(deliveryFeePiasters),
    total: fromPiasters(totalPiasters),
    deliveryZone: matchedZone,
    belowZoneMinimum,
  };
}
