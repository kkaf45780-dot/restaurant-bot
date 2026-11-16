import {
  buildDraftLineKey,
  calculateOrderTotals,
  evaluateCoupon,
  toPiasters,
} from '../lib/pricing.ts';
import type {
  MenuItem,
  OrderDraft,
  OrderDraftDiff,
  OrderDraftItem,
  OrderDraftSnapshotLine,
  RestaurantBundle,
  ToolCall,
} from '../types/restaurant.ts';

export interface OrderToolExecutionResult {
  updatedDraft: OrderDraft;
  appliedChanges: string[];
  rejectedChanges: string[];
  unknownItemIds: string[];
  diff: OrderDraftDiff;
  totals: ReturnType<typeof calculateOrderTotals>;
}

function getDefaultSizeId(item: MenuItem): string | undefined {
  return item.sizes?.find((s) => s.isDefault)?.id ?? item.sizes?.[0]?.id;
}

function resolveLineIndex(
  draftItems: OrderDraftItem[],
  itemId: string,
  catalogItem: MenuItem | undefined,
  preferredSizeId?: string
): number {
  const defaultSizeId = catalogItem ? getDefaultSizeId(catalogItem) : undefined;
  const targetSize = preferredSizeId || defaultSizeId;

  if (preferredSizeId) {
    const exactIdx = draftItems.findIndex(
      (l) => l.itemId === itemId && (l.selectedSizeId || defaultSizeId) === targetSize
    );
    if (exactIdx !== -1) return exactIdx;
  }

  return draftItems.findIndex((l) => l.itemId === itemId);
}

function makeSnapshot(
  draft: OrderDraft,
  bundle: RestaurantBundle
): {
  snapshot: {
    items: OrderDraftSnapshotLine[];
    total: number;
    fulfillmentType: 'delivery' | 'pickup';
    couponCode?: string;
  };
  totals: ReturnType<typeof calculateOrderTotals>;
} {
  const totals = calculateOrderTotals(
    draft.items,
    bundle.items,
    draft.deliveryZoneId,
    bundle.deliveryZones,
    {
      fulfillmentType: draft.fulfillmentType,
      couponCode: draft.couponCode,
      coupons: bundle.activeCoupons,
    }
  );
  return {
    totals,
    snapshot: {
      items: totals.validItems.map((vi) => ({
        itemId: vi.itemId,
        name: vi.name,
        sizeLabel: vi.selectedSizeLabel,
        extrasLabels: (vi.selectedExtras ?? []).map((e) => e.label),
        quantity: vi.quantity,
        lineTotal: vi.lineTotal,
      })),
      total: totals.total,
      fulfillmentType: draft.fulfillmentType ?? 'delivery',
      couponCode: totals.appliedCoupon?.code,
    },
  };
}

export function executeOrderToolCalls(
  currentDraft: OrderDraft,
  toolCalls: ToolCall[],
  bundle: RestaurantBundle
): OrderToolExecutionResult {
  const beforeData = makeSnapshot(currentDraft, bundle);

  const catalogMap = new Map(bundle.items.map((i) => [i.id, i]));
  const items: OrderDraftItem[] = currentDraft.items.map((i) => ({
    ...i,
    selectedExtraIds: [...(i.selectedExtraIds ?? [])],
  }));

  let fulfillmentType = currentDraft.fulfillmentType ?? 'delivery';
  let deliveryZoneId = currentDraft.deliveryZoneId ?? '';
  let branchId = currentDraft.branchId || undefined;
  let couponCode = currentDraft.couponCode?.trim() || undefined;
  let customerName = currentDraft.customerName ?? '';
  let customerPhone = currentDraft.customerPhone ?? '';
  let customerAddress = currentDraft.customerAddress ?? '';
  let notes = currentDraft.notes ?? '';

  const appliedChanges: string[] = [];
  const rejectedChanges: string[] = [];
  const unknownItemIds: string[] = [];

  const aiOrderIntakeEnabled =
    (bundle.restaurant.aiSettings.aiOrderIntake ?? true) &&
    (bundle.restaurant.aiSettings.allowedTopics?.orderIntake ?? true);

  for (const call of toolCalls) {
    if (!call || typeof call.name !== 'string') continue;

    if (!aiOrderIntakeEnabled) {
      rejectedChanges.push('استقبال أو تعديل الطلبات عبر المحادثة متوقف حالياً من إدارة المطعم.');
      continue;
    }

    switch (call.name) {
      case 'add_item': {
        const catItem = catalogMap.get(call.itemId);
        if (!catItem) {
          unknownItemIds.push(call.itemId);
          rejectedChanges.push(`الصنف (${call.itemId}) غير موجود في قائمة المطعم.`);
          break;
        }
        const availableStock =
          typeof catItem.stockQuantity === 'number' ? catItem.stockQuantity : 999;
        if (!catItem.isAvailable || availableStock <= 0) {
          rejectedChanges.push(`صنف "${catItem.name}" غير متوفر حالياً.`);
          break;
        }

        const requestedQty = Math.floor(Number(call.quantity ?? 1) || 0);
        if (requestedQty <= 0) {
          rejectedChanges.push(`الكمية المطلوبة لصنف "${catItem.name}" غير صالحة.`);
          break;
        }

        const matchedSize = call.selectedSizeId
          ? catItem.sizes?.find((s) => s.id === call.selectedSizeId)
          : catItem.sizes?.find((s) => s.isDefault) ?? catItem.sizes?.[0];

        if (call.selectedSizeId && !matchedSize) {
          rejectedChanges.push(`الحجم المحدد غير متوفر لصنف "${catItem.name}".`);
          break;
        }
        const sizeId = matchedSize?.id;

        const validExtras = Array.from(
          new Set(
            (call.selectedExtraIds ?? []).filter((exId) =>
              catItem.extras?.some((e) => e.id === exId)
            )
          )
        );
        if ((call.selectedExtraIds ?? []).length > validExtras.length) {
          rejectedChanges.push(`بعض الإضافات المطلوبة لصنف "${catItem.name}" غير موجودة في المنيو.`);
        }

        // Enforce unique (itemId, sizeId) line key for AI mutations
        const existingIdx = items.findIndex(
          (l) =>
            l.itemId === catItem.id &&
            (l.selectedSizeId || getDefaultSizeId(catItem)) === (sizeId || getDefaultSizeId(catItem))
        );

        if (existingIdx !== -1) {
          const existing = items[existingIdx];
          const nextQty = existing.quantity + requestedQty;
          if (nextQty > availableStock) {
            rejectedChanges.push(
              `الكمية المطلوبة من "${catItem.name}" تتجاوز المتاح حالياً (${availableStock}).`
            );
            break;
          }
          const mergedExtras = Array.from(
            new Set([...(existing.selectedExtraIds ?? []), ...validExtras])
          );
          const nextNotes = call.itemNotes?.trim() || existing.itemNotes;
          existing.quantity = nextQty;
          existing.selectedExtraIds = mergedExtras;
          existing.itemNotes = nextNotes;
          existing.lineKey = buildDraftLineKey({
            itemId: catItem.id,
            selectedSizeId: sizeId,
            selectedExtraIds: mergedExtras,
            itemNotes: nextNotes,
          });
        } else {
          if (requestedQty > availableStock) {
            rejectedChanges.push(
              `الكمية المطلوبة من "${catItem.name}" (${requestedQty}) تتجاوز المتاح (${availableStock}).`
            );
            break;
          }
          const itemNotes = call.itemNotes?.trim() || undefined;
          items.push({
            lineKey: buildDraftLineKey({
              itemId: catItem.id,
              selectedSizeId: sizeId,
              selectedExtraIds: validExtras,
              itemNotes,
            }),
            itemId: catItem.id,
            quantity: requestedQty,
            selectedSizeId: sizeId,
            selectedExtraIds: validExtras,
            itemNotes,
          });
        }
        appliedChanges.push(
          `إضافة ${requestedQty} × ${catItem.name}${matchedSize ? ` (${matchedSize.label})` : ''}`
        );
        break;
      }

      case 'set_quantity': {
        const catItem = catalogMap.get(call.itemId);
        if (!catItem) {
          unknownItemIds.push(call.itemId);
          rejectedChanges.push(`الصنف (${call.itemId}) غير موجود في القائمة.`);
          break;
        }
        const qty = Math.floor(Number(call.quantity) || 0);
        const availableStock =
          typeof catItem.stockQuantity === 'number' ? catItem.stockQuantity : 999;

        if (qty < 1) {
          rejectedChanges.push(`الكمية يجب أن تكون ١ على الأقل (أو استخدم الحذف لإزالة "${catItem.name}").`);
          break;
        }
        if (!catItem.isAvailable || qty > availableStock) {
          rejectedChanges.push(
            `الكمية المطلوبة (${qty}) من "${catItem.name}" غير متاحة (المتوفر: ${availableStock}).`
          );
          break;
        }

        const idx = resolveLineIndex(items, catItem.id, catItem, call.selectedSizeId);
        if (idx === -1) {
          const sizeId = call.selectedSizeId
            ? catItem.sizes?.find((s) => s.id === call.selectedSizeId)?.id ?? getDefaultSizeId(catItem)
            : getDefaultSizeId(catItem);
          items.push({
            lineKey: buildDraftLineKey({
              itemId: catItem.id,
              selectedSizeId: sizeId,
              selectedExtraIds: [],
            }),
            itemId: catItem.id,
            quantity: qty,
            selectedSizeId: sizeId,
            selectedExtraIds: [],
          });
        } else {
          items[idx].quantity = qty;
        }
        appliedChanges.push(`تعديل كمية ${catItem.name} إلى ${qty}`);
        break;
      }

      case 'set_size': {
        const catItem = catalogMap.get(call.itemId);
        if (!catItem) {
          unknownItemIds.push(call.itemId);
          rejectedChanges.push(`الصنف (${call.itemId}) غير موجود.`);
          break;
        }
        const targetSize = catItem.sizes?.find((s) => s.id === call.selectedSizeId);
        if (!targetSize) {
          rejectedChanges.push(`الحجم المطلوب غير متاح لصنف "${catItem.name}".`);
          break;
        }

        const idx = resolveLineIndex(items, catItem.id, catItem, call.fromSizeId);
        if (idx === -1) {
          rejectedChanges.push(`صنف "${catItem.name}" غير موجود حالياً في السلة لتغيير حجمه.`);
          break;
        }

        const duplicateTargetIdx = items.findIndex(
          (l, i) =>
            i !== idx &&
            l.itemId === catItem.id &&
            (l.selectedSizeId || getDefaultSizeId(catItem)) === targetSize.id
        );

        if (duplicateTargetIdx !== -1) {
          // Merge into existing line of target size instead of leaving duplicate rows
          const availableStock =
            typeof catItem.stockQuantity === 'number' ? catItem.stockQuantity : 999;
          const combinedQty = Math.min(
            availableStock,
            items[duplicateTargetIdx].quantity + items[idx].quantity
          );
          items[duplicateTargetIdx].quantity = combinedQty;
          items[duplicateTargetIdx].selectedExtraIds = Array.from(
            new Set([
              ...(items[duplicateTargetIdx].selectedExtraIds ?? []),
              ...(items[idx].selectedExtraIds ?? []),
            ])
          );
          items[duplicateTargetIdx].lineKey = buildDraftLineKey(items[duplicateTargetIdx]);
          items.splice(idx, 1);
        } else {
          items[idx].selectedSizeId = targetSize.id;
          items[idx].lineKey = buildDraftLineKey(items[idx]);
        }
        appliedChanges.push(`تغيير حجم ${catItem.name} إلى ${targetSize.label}`);
        break;
      }

      case 'add_extra': {
        const catItem = catalogMap.get(call.itemId);
        if (!catItem) {
          unknownItemIds.push(call.itemId);
          rejectedChanges.push(`الصنف (${call.itemId}) غير موجود.`);
          break;
        }
        const extra = catItem.extras?.find((e) => e.id === call.extraId);
        if (!extra) {
          rejectedChanges.push(`الإضافة (${call.extraId}) غير موجودة ضمن إضافات "${catItem.name}".`);
          break;
        }

        const idx = resolveLineIndex(items, catItem.id, catItem, call.selectedSizeId);
        if (idx === -1) {
          rejectedChanges.push(`أضف "${catItem.name}" للسلة أولاً ثم أضف "${extra.label}".`);
          break;
        }

        const prevExtras = items[idx].selectedExtraIds ?? [];
        if (!prevExtras.includes(extra.id)) {
          items[idx].selectedExtraIds = [...prevExtras, extra.id];
          items[idx].lineKey = buildDraftLineKey(items[idx]);
        }
        appliedChanges.push(`إضافة "${extra.label}" إلى ${catItem.name}`);
        break;
      }

      case 'remove_extra': {
        const catItem = catalogMap.get(call.itemId);
        if (!catItem) {
          unknownItemIds.push(call.itemId);
          rejectedChanges.push(`الصنف (${call.itemId}) غير موجود.`);
          break;
        }
        const extra = catItem.extras?.find((e) => e.id === call.extraId);
        const idx = resolveLineIndex(items, catItem.id, catItem, call.selectedSizeId);
        if (idx === -1) {
          rejectedChanges.push(`صنف "${catItem.name}" غير موجود في السلة.`);
          break;
        }
        items[idx].selectedExtraIds = (items[idx].selectedExtraIds ?? []).filter(
          (id) => id !== call.extraId
        );
        items[idx].lineKey = buildDraftLineKey(items[idx]);
        appliedChanges.push(`إزالة "${extra?.label ?? call.extraId}" من ${catItem.name}`);
        break;
      }

      case 'remove_item': {
        const beforeLen = items.length;
        const catItem = catalogMap.get(call.itemId);
        for (let i = items.length - 1; i >= 0; i--) {
          const matchesItem = items[i].itemId === call.itemId;
          const matchesSize =
            !call.selectedSizeId ||
            (items[i].selectedSizeId || (catItem ? getDefaultSizeId(catItem) : undefined)) ===
              call.selectedSizeId;
          if (matchesItem && matchesSize) {
            items.splice(i, 1);
          }
        }
        if (items.length < beforeLen) {
          appliedChanges.push(`إزالة ${catItem?.name ?? call.itemId} من السلة`);
        } else {
          rejectedChanges.push(`الصنف غير موجود في السلة لإزالته.`);
        }
        break;
      }

      case 'set_fulfillment': {
        if (call.fulfillmentType !== 'delivery' && call.fulfillmentType !== 'pickup') {
          rejectedChanges.push('نوع الاستلام غير صالح.');
          break;
        }
        fulfillmentType = call.fulfillmentType;
        if (call.fulfillmentType === 'delivery' && call.deliveryZoneId) {
          const zone = bundle.deliveryZones.find(
            (z) => z.id === call.deliveryZoneId && z.isActive
          );
          if (zone) {
            deliveryZoneId = zone.id;
            appliedChanges.push(`تحديد التوصيل إلى ${zone.name}`);
          } else {
            rejectedChanges.push('منطقة التوصيل غير متاحة أو غير مفعلة.');
          }
        } else if (call.fulfillmentType === 'pickup' && call.branchId) {
          const branch = bundle.branches.find((b) => b.id === call.branchId && b.isOpen);
          if (branch) {
            branchId = branch.id;
            appliedChanges.push(`تحديد الاستلام من ${branch.name}`);
          } else {
            rejectedChanges.push('الفرع المختار غير متاح حالياً للاستلام.');
          }
        } else {
          appliedChanges.push(
            call.fulfillmentType === 'pickup' ? 'اختيار الاستلام من الفرع' : 'اختيار التوصيل للمنزل'
          );
        }
        break;
      }

      case 'set_customer': {
        const updatedFields: string[] = [];
        if (call.customerName?.trim()) {
          customerName = call.customerName.trim().slice(0, 80);
          updatedFields.push('الاسم');
        }
        if (call.customerPhone?.trim()) {
          customerPhone = call.customerPhone.trim().slice(0, 25);
          updatedFields.push('الهاتف');
        }
        if (call.customerAddress?.trim()) {
          customerAddress = call.customerAddress.trim().slice(0, 220);
          updatedFields.push('العنوان');
        }
        if (call.notes?.trim()) {
          notes = call.notes.trim().slice(0, 250);
          updatedFields.push('الملاحظات');
        }
        if (call.deliveryZoneId) {
          const zone = bundle.deliveryZones.find(
            (z) => z.id === call.deliveryZoneId && z.isActive
          );
          if (zone) {
            deliveryZoneId = zone.id;
            updatedFields.push(`منطقة ${zone.name}`);
          } else {
            rejectedChanges.push('منطقة التوصيل المذكورة غير متاحة حالياً.');
          }
        }
        if (call.branchId) {
          const branch = bundle.branches.find((b) => b.id === call.branchId && b.isOpen);
          if (branch) {
            branchId = branch.id;
            updatedFields.push(branch.name);
          } else {
            rejectedChanges.push('الفرع المحدد مغلق حالياً.');
          }
        }
        if (updatedFields.length > 0) {
          appliedChanges.push(`تحديث بيانات العميل (${updatedFields.join('، ')})`);
        }
        break;
      }

      case 'apply_coupon': {
        const rawCode = (call.couponCode || '').trim().toUpperCase();
        if (!rawCode) {
          rejectedChanges.push('برجاء كتابة كود خصم صحيح.');
          break;
        }
        const draftEval = calculateOrderTotals(
          items,
          bundle.items,
          deliveryZoneId,
          bundle.deliveryZones,
          {
            fulfillmentType,
            couponCode: undefined,
            coupons: bundle.activeCoupons,
          }
        );
        const subtotalPiasters = toPiasters(draftEval.subtotal);
        const couponCheck = evaluateCoupon(
          rawCode,
          bundle.activeCoupons,
          draftEval.validItems,
          bundle.items,
          subtotalPiasters
        );
        if (couponCheck.valid && couponCheck.coupon) {
          couponCode = couponCheck.coupon.code;
          appliedChanges.push(
            `تطبيق كوبون ${couponCheck.coupon.code} (خصم ${couponCheck.discountAmount} ${bundle.restaurant.systemSettings.currencyLabel})`
          );
        } else {
          rejectedChanges.push(
            couponCheck.errorMessage || `كود الخصم "${rawCode}" غير صالح.`
          );
        }
        break;
      }

      case 'remove_coupon': {
        if (couponCode) {
          appliedChanges.push(`إلغاء كوبون ${couponCode}`);
          couponCode = undefined;
        }
        break;
      }
    }
  }

  const updatedDraft: OrderDraft = {
    items,
    fulfillmentType,
    deliveryZoneId,
    branchId,
    couponCode,
    customerName,
    customerPhone,
    customerAddress,
    notes,
  };

  const afterData = makeSnapshot(updatedDraft, bundle);

  return {
    updatedDraft,
    appliedChanges,
    rejectedChanges,
    unknownItemIds,
    diff: {
      before: beforeData.snapshot,
      after: afterData.snapshot,
    },
    totals: afterData.totals,
  };
}
