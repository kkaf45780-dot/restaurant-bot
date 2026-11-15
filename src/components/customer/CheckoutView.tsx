import {
  AlertCircle,
  Check,
  CheckCircle2,
  ExternalLink,
  MapPin,
  Minus,
  PackageCheck,
  Pencil,
  Plus,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
  Truck,
  WifiOff,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { submitOrder, validateCouponCode } from '../../lib/api.ts';
import type { RestaurantHoursStatus } from '../../lib/hours.ts';
import { resolveAssetUrl } from '../../lib/imageAssets.ts';
import { buildDraftLineKey, calculateOrderTotals, formatCurrency } from '../../lib/pricing.ts';
import type {
  Coupon,
  DeliveryZone,
  FulfillmentType,
  MenuItem,
  Order,
  OrderDraft,
  OrderDraftItem,
  Restaurant,
  RestaurantBranch,
} from '../../types/restaurant.ts';

interface CheckoutViewProps {
  restaurant: Restaurant;
  hoursStatus: RestaurantHoursStatus;
  items: MenuItem[];
  deliveryZones: DeliveryZone[];
  branches: RestaurantBranch[];
  activeCoupons: Coupon[];
  draft: OrderDraft;
  isOnline?: boolean;
  onUpdateDraft: (updater: (prev: OrderDraft) => OrderDraft) => void;
  onUpdateLineQty: (lineKey: string, nextQty: number) => void;
  onEditCartLine?: (item: MenuItem, line: OrderDraftItem) => void;
  onOrderConfirmed: (order: Order, whatsappUrl: string) => void;
  confirmedOrderState: { order: Order; whatsappUrl: string } | null;
  onStartNewOrder: () => void;
  onGoMenu: () => void;
  onTrackOrder: (orderNumber: string) => void;
}

export function CheckoutView({
  restaurant,
  hoursStatus,
  items,
  deliveryZones,
  branches,
  activeCoupons,
  draft,
  isOnline = true,
  onUpdateDraft,
  onUpdateLineQty,
  onEditCartLine,
  onOrderConfirmed,
  confirmedOrderState,
  onStartNewOrder,
  onGoMenu,
  onTrackOrder,
}: CheckoutViewProps) {
  const [couponInput, setCouponInput] = useState(draft.couponCode || '');
  const [couponFeedback, setCouponFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencyKey] = useState(
    () => `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const currencyLabel = restaurant.systemSettings.currencyLabel;
  const activeZones = deliveryZones.filter((z) => z.isActive);
  const openBranches = branches.filter((b) => b.isOpen);
  const itemCatalogMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const totals = useMemo(
    () =>
      calculateOrderTotals(draft.items, items, draft.deliveryZoneId, deliveryZones, {
        fulfillmentType: draft.fulfillmentType,
        couponCode: draft.couponCode,
        coupons: activeCoupons,
      }),
    [draft, items, deliveryZones, activeCoupons]
  );

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      onUpdateDraft((prev) => ({ ...prev, couponCode: undefined }));
      setCouponFeedback(null);
      return;
    }
    setValidatingCoupon(true);
    setCouponFeedback(null);
    try {
      const res = await validateCouponCode({
        restaurantId: restaurant.id,
        code,
        items: draft.items,
        deliveryZoneId: draft.deliveryZoneId,
        fulfillmentType: draft.fulfillmentType,
      });
      onUpdateDraft((prev) => ({ ...prev, couponCode: res.coupon.code }));
      setCouponFeedback({
        type: 'success',
        text: `تم تطبيق الكود ${res.coupon.code} — خصم ${formatCurrency(res.discountAmount, currencyLabel)}`,
      });
    } catch (err) {
      onUpdateDraft((prev) => ({ ...prev, couponCode: undefined }));
      setCouponFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'كود الخصم غير صالح.',
      });
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleConfirmOrder = async () => {
    setSubmitError(null);
    if (!isOnline) {
      setSubmitError('لا يوجد اتصال بالإنترنت حالياً. يمكنك تعديل السلة وسيتم إرسال الطلب فور عودة الاتصال.');
      return;
    }
    if (!hoursStatus.isOpen && !restaurant.systemSettings.allowOrdersWhenClosed) {
      setSubmitError(
        `المطعم مغلق حالياً. ${hoursStatus.nextOpenText ? `نفتح ${hoursStatus.nextOpenText}.` : ''}`
      );
      return;
    }
    if (totals.validItems.length === 0) {
      setSubmitError('السلة فارغة. أضف صنفاً واحداً على الأقل.');
      return;
    }
    if (!draft.customerName.trim()) {
      setSubmitError('يُرجى كتابة الاسم بالكامل.');
      return;
    }
    if (!draft.customerPhone.trim() || draft.customerPhone.replace(/[^\d]/g, '').length < 8) {
      setSubmitError('يُرجى إدخال رقم هاتف صحيح للتواصل.');
      return;
    }
    if (draft.fulfillmentType === 'delivery') {
      if (!draft.deliveryZoneId || !totals.deliveryZone) {
        setSubmitError('يُرجى اختيار منطقة التوصيل.');
        return;
      }
      if (!draft.customerAddress.trim()) {
        setSubmitError('يُرجى إدخال العنوان بالتفصيل.');
        return;
      }
      if (totals.belowZoneMinimum) {
        setSubmitError(
          `الحد الأدنى للطلب في ${totals.deliveryZone.name} هو ${formatCurrency(totals.deliveryZone.minOrderAmount, currencyLabel)}.`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await submitOrder({
        restaurantId: restaurant.id,
        items: draft.items,
        fulfillmentType: draft.fulfillmentType,
        deliveryZoneId: draft.deliveryZoneId,
        branchId: draft.branchId || openBranches[0]?.id,
        couponCode: draft.couponCode,
        customerName: draft.customerName.trim(),
        customerPhone: draft.customerPhone.trim(),
        customerAddress: draft.customerAddress.trim(),
        notes: draft.notes.trim(),
        idempotencyKey,
      });
      onOrderConfirmed(res.order, res.whatsappUrl);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'تعذر تسجيل الطلب حالياً.');
    } finally {
      setSubmitting(false);
    }
  };

  // Post-Submission Confirmation Screen
  if (confirmedOrderState) {
    const { order, whatsappUrl } = confirmedOrderState;
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="bg-white rounded-3xl border border-[#176B45]/20 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#16A34A]/15 text-[#15803D] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#104B34]">
                تم استلام طلبك بنجاح — رقم #{order.orderNumber}
              </h1>
              <p className="text-sm text-[#5C6B63] mt-1 leading-relaxed">
                تنبيه مهم: تم حفظ الطلب في النظام وهو الآن <strong>بانتظار مراجعة وتأكيد المطعم</strong>.
                للمتابعة السريعة يمكنك إرسال تفاصيل الطلب عبر واتساب أو تتبع الحالة مباشرة.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#F7F3E9] border border-[#176B45]/10 p-5 space-y-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-[#5C6B63]">
              <span>
                العميل: <strong className="text-[#18221D]">{order.customerName}</strong>
              </span>
              <span className="tabular-nums">
                الهاتف: <strong className="text-[#18221D]">{order.customerPhone}</strong>
              </span>
            </div>
            <p className="text-xs text-[#5C6B63]">
              {order.fulfillmentType === 'pickup' ? 'فرع الاستلام: ' : 'العنوان: '}
              <strong className="text-[#18221D]">{order.customerAddress}</strong>
            </p>
            <div className="border-t border-[#176B45]/10 pt-3 space-y-1.5">
              {order.items.map((it, idx) => (
                <div key={idx} className="flex justify-between text-xs">
                  <span className="font-bold text-[#18221D]">
                    {it.quantity} × {it.name}
                    {it.selectedSizeLabel ? ` (${it.selectedSizeLabel})` : ''}
                  </span>
                  <span className="font-bold tabular-nums">
                    {formatCurrency(it.lineTotal, currencyLabel)}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-[#176B45]/10 pt-3 flex justify-between font-extrabold text-base text-[#104B34]">
              <span>الإجمالي النهائي</span>
              <span className="tabular-nums">{formatCurrency(order.total, currencyLabel)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[48px] px-5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-sm font-extrabold flex items-center justify-center gap-2 transition-colors"
              >
                <span>إرسال الطلب عبر واتساب</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => onTrackOrder(order.orderNumber)}
              className="min-h-[48px] px-5 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <PackageCheck className="w-4 h-4" />
              <span>تتبع حالة الطلب الآن</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onStartNewOrder}
            className="w-full min-h-[42px] rounded-xl border border-[#176B45]/20 hover:bg-[#F7F3E9] text-xs font-bold text-[#104B34] cursor-pointer"
          >
            العودة للقائمة وبدء طلب جديد
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
          سلة المشتريات والدفع
        </h1>
        <button
          type="button"
          onClick={onGoMenu}
          className="text-xs sm:text-sm font-bold text-[#176B45] dark:text-[#4ADE80] hover:underline cursor-pointer"
        >
          + إضافة أصناف أخرى
        </button>
      </div>

      {!isOnline && (
        <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 rounded-2xl p-4 flex items-center gap-3 text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-200">
          <WifiOff className="w-5 h-5 shrink-0" />
          <span>
            أنت غير متصل بالإنترنت حالياً. تم حفظ سلتك محلياً، ولكن تأكيد الطلب يتطلب اتصالاً بالإنترنت.
          </span>
        </div>
      )}

      {totals.validItems.length === 0 ? (
        <div className="bg-white dark:bg-[#14201B] rounded-3xl border border-[#176B45]/10 dark:border-[#2A3F35] p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-[#F7F3E9] dark:bg-[#0E1713] text-[#176B45] flex items-center justify-center mx-auto">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
            سلة المشتريات فارغة
          </h2>
          <p className="text-sm text-[#5C6B63] dark:text-[#A3B8AE]">
            تصفح قائمة الطعام وأضف وجباتك المفضلة لإتمام الطلب.
          </p>
          <button
            type="button"
            onClick={onGoMenu}
            className="min-h-[44px] px-6 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-sm font-bold cursor-pointer"
          >
            استعراض قائمة الطعام
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Right Column: Cart Items + Customer & Delivery Form (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Cart Card matching Desktop_checkout_website_page_layout */}
            <section className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/15 dark:border-[#2A3F35] p-5 sm:p-6 shadow-xs space-y-4">
              <h2 className="text-lg font-extrabold text-[#104B34] dark:text-[#ECF3EF]">السلة</h2>

              <div className="space-y-3">
                {totals.validItems.map((line) => {
                  const catalogItem = itemCatalogMap.get(line.itemId);
                  const key = line.lineKey || buildDraftLineKey(line);
                  const thumb = resolveAssetUrl(catalogItem?.imageUrl);
                  return (
                    <div
                      key={key}
                      className="rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] bg-[#FAF7F0]/60 dark:bg-[#0E1713] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <img
                          src={thumb}
                          alt={line.name}
                          className="w-16 h-14 rounded-xl object-cover shrink-0 bg-[#F7F3E9]"
                        />
                        <div className="min-w-0">
                          <p className="font-extrabold text-sm text-[#18221D] dark:text-[#ECF3EF]">
                            {line.name}{' '}
                            <span className="text-[#176B45] dark:text-[#4ADE80] tabular-nums">
                              ({formatCurrency(line.unitPrice, currencyLabel)})
                            </span>
                          </p>
                          {line.selectedSizeLabel && (
                            <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
                              الحجم: {line.selectedSizeLabel}
                            </p>
                          )}
                          {line.selectedExtras && line.selectedExtras.length > 0 && (
                            <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
                              إضافات: {line.selectedExtras.map((e) => e.label).join('، ')}
                            </p>
                          )}
                          {line.itemNotes && (
                            <p className="text-xs text-amber-800 dark:text-amber-300">
                              ملاحظة: {line.itemNotes}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        {catalogItem && onEditCartLine && (
                          <button
                            type="button"
                            onClick={() => onEditCartLine(catalogItem, { ...line, lineKey: key })}
                            title="تعديل الخيارات والملاحظات"
                            className="h-8 px-2.5 rounded-lg border border-[#176B45]/20 dark:border-[#2A3F35] bg-white dark:bg-[#192822] text-[#104B34] dark:text-[#4ADE80] text-[11px] font-bold inline-flex items-center gap-1 hover:bg-[#F7F3E9] cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>تعديل</span>
                          </button>
                        )}

                        <div className="flex items-center gap-1 bg-white dark:bg-[#14201B] border border-[#176B45]/15 dark:border-[#2A3F35] rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => onUpdateLineQty(key, line.quantity + 1)}
                            aria-label="زيادة"
                            className="w-8 h-8 rounded-lg bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] flex items-center justify-center hover:bg-[#EFE9DC] cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-extrabold tabular-nums dark:text-[#ECF3EF]">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateLineQty(key, line.quantity - 1)}
                            aria-label="إنقاص"
                            className="w-8 h-8 rounded-lg bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] flex items-center justify-center hover:bg-[#EFE9DC] cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <span className="font-extrabold text-sm text-[#104B34] dark:text-[#4ADE80] tabular-nums min-w-[74px] text-left">
                          {formatCurrency(line.lineTotal, currencyLabel)}
                        </span>

                        <button
                          type="button"
                          onClick={() => onUpdateLineQty(key, 0)}
                          aria-label="حذف الصنف"
                          className="w-9 h-9 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Coupon Code Box */}
              <div className="pt-2 border-t border-[#176B45]/10 space-y-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Tag className="w-4 h-4 text-[#176B45] absolute right-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="هل لديك كود خصم؟ (مثال: HARA10 أو WELCOME30)"
                      className="w-full h-11 pr-10 pl-4 rounded-xl bg-[#F7F3E9]/70 border border-[#176B45]/15 text-sm text-[#18221D] uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={validatingCoupon}
                    onClick={handleApplyCoupon}
                    className="h-11 px-5 rounded-xl bg-[#176B45] hover:bg-[#104B34] text-white text-xs font-extrabold cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {validatingCoupon ? 'جاري التحقق...' : 'تطبيق الكود'}
                  </button>
                </div>

                {couponFeedback && (
                  <p
                    className={`text-xs font-bold ${
                      couponFeedback.type === 'success' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {couponFeedback.text}
                  </p>
                )}
              </div>
            </section>

            {/* Customer & Delivery Details Card matching Desktop_checkout_website_page_layout */}
            <section className="bg-white rounded-2xl border border-[#176B45]/15 p-5 sm:p-6 shadow-xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold text-[#104B34]">بيانات العميل والتوصيل</h2>

                {/* Fulfillment Type Toggle */}
                <div className="inline-grid grid-cols-2 gap-1.5 bg-[#F7F3E9] p-1 rounded-xl border border-[#176B45]/15">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        fulfillmentType: 'delivery' as FulfillmentType,
                      }))
                    }
                    className={`min-h-[38px] px-4 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      draft.fulfillmentType === 'delivery'
                        ? 'bg-[#104B34] text-white'
                        : 'text-[#35443C]'
                    }`}
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>توصيل للمنزل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        fulfillmentType: 'pickup' as FulfillmentType,
                      }))
                    }
                    className={`min-h-[38px] px-4 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      draft.fulfillmentType === 'pickup'
                        ? 'bg-[#104B34] text-white'
                        : 'text-[#35443C]'
                    }`}
                  >
                    <Store className="w-3.5 h-3.5" />
                    <span>استلام من الفرع</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">
                    الاسم بالكامل
                  </label>
                  <input
                    type="text"
                    value={draft.customerName}
                    onChange={(e) =>
                      onUpdateDraft((p) => ({ ...p, customerName: e.target.value }))
                    }
                    placeholder="اكتب اسمك بالكامل"
                    className="w-full h-11 px-4 rounded-xl bg-white border border-[#176B45]/20 text-sm focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">
                    رقم الهاتف
                  </label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={draft.customerPhone}
                    onChange={(e) =>
                      onUpdateDraft((p) => ({ ...p, customerPhone: e.target.value }))
                    }
                    placeholder="01012345678"
                    className="w-full h-11 px-4 rounded-xl bg-white border border-[#176B45]/20 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                  />
                </div>
              </div>

              {draft.fulfillmentType === 'delivery' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">
                      منطقة التوصيل
                    </label>
                    <select
                      value={draft.deliveryZoneId}
                      onChange={(e) =>
                        onUpdateDraft((p) => ({ ...p, deliveryZoneId: e.target.value }))
                      }
                      className="w-full h-11 px-4 rounded-xl bg-white border border-[#176B45]/20 text-sm focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                    >
                      <option value="">اختر منطقة التوصيل...</option>
                      {activeZones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name} — رسوم التوصيل {formatCurrency(zone.fee, currencyLabel)} (الحد الأدنى {formatCurrency(zone.minOrderAmount, currencyLabel)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">
                      العنوان بالتفصيل
                    </label>
                    <input
                      type="text"
                      value={draft.customerAddress}
                      onChange={(e) =>
                        onUpdateDraft((p) => ({ ...p, customerAddress: e.target.value }))
                      }
                      placeholder="اسم الشارع، رقم العمارة، الدور، الشقة، وأقرب معلم"
                      className="w-full h-11 px-4 rounded-xl bg-white border border-[#176B45]/20 text-sm focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">
                    اختر فرع الاستلام (بدون رسوم توصيل)
                  </label>
                  <select
                    value={draft.branchId || openBranches[0]?.id || ''}
                    onChange={(e) =>
                      onUpdateDraft((p) => ({ ...p, branchId: e.target.value }))
                    }
                    className="w-full h-11 px-4 rounded-xl bg-white border border-[#176B45]/20 text-sm focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                  >
                    {openBranches.map((br) => (
                      <option key={br.id} value={br.id}>
                        {br.name} — {br.address}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">
                  ملاحظات الطلب
                </label>
                <input
                  type="text"
                  value={draft.notes}
                  onChange={(e) => onUpdateDraft((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="مثال: زيادة طحينة، بدون بصل، الاتصال عند الوصول..."
                  className="w-full h-11 px-4 rounded-xl bg-white border border-[#176B45]/20 text-sm focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                />
              </div>
            </section>
          </div>

          {/* Left Column: Sticky Order Summary Card (4 cols) */}
          <aside className="lg:col-span-4 lg:sticky lg:top-24">
            <div className="bg-white rounded-2xl border border-[#176B45]/15 p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-extrabold text-[#104B34]">ملخص الطلب</h2>

              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between text-[#35443C]">
                  <span>المجموع الفرعي</span>
                  <span className="font-bold tabular-nums">
                    {formatCurrency(totals.subtotal, currencyLabel)}
                  </span>
                </div>

                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>الخصم ({totals.appliedCoupon?.code})</span>
                    <span className="tabular-nums">
                      -{formatCurrency(totals.discountAmount, currencyLabel)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-[#35443C]">
                  <span>رسوم التوصيل</span>
                  <span className="font-bold tabular-nums">
                    {draft.fulfillmentType === 'pickup'
                      ? 'مجاناً (استلام من الفرع)'
                      : totals.deliveryZone
                        ? formatCurrency(totals.deliveryFee, currencyLabel)
                        : 'اختر المنطقة'}
                  </span>
                </div>

                <div className="border-t border-dashed border-[#176B45]/20 pt-3 flex justify-between items-center text-lg font-extrabold text-[#104B34]">
                  <span>الإجمالي</span>
                  <span className="tabular-nums">
                    {formatCurrency(totals.total, currencyLabel)}
                  </span>
                </div>
              </div>

              {totals.belowZoneMinimum && totals.deliveryZone && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs font-bold text-amber-900 flex items-start gap-2">
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    الحد الأدنى للطلب في {totals.deliveryZone.name} هو{' '}
                    {formatCurrency(totals.deliveryZone.minOrderAmount, currencyLabel)}.
                  </span>
                </div>
              )}

              {submitError && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              <button
                type="button"
                disabled={submitting || !isOnline}
                onClick={handleConfirmOrder}
                className="w-full min-h-[48px] px-5 rounded-xl bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Check className="w-4 h-4" />
                <span>
                  {!isOnline
                    ? 'غير متاح بدون اتصال بالإنترنت'
                    : submitting
                      ? 'جاري تسجيل الطلب...'
                      : 'تأكيد الطلب'}
                </span>
              </button>

              <p className="text-[11px] text-[#5C6B63] dark:text-[#A3B8AE] text-center leading-relaxed">
                الدفع نقداً عند الاستلام. بعد التأكيد يمكنك إرسال الطلب عبر واتساب ومتابعة حالته
                لحظة بلحظة.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
