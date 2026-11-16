import {
  Bike,
  Check,
  Clock,
  Heart,
  History,
  MapPin,
  MessageCircle,
  Package,
  RotateCcw,
  Search,
  ShieldCheck,
  Star,
  Timer,
  User,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ORDER_STATUS_META, ORDER_TIMELINE_STEPS } from '../../data/restaurant.ts';
import { submitOrderRating, trackOrderByToken } from '../../lib/api.ts';
import { resolveAssetUrl } from '../../lib/imageAssets.ts';
import { formatCurrency } from '../../lib/pricing.ts';
import { supabase } from '../../lib/supabase.ts';
import { buildWhatsAppInquiryUrl } from '../../lib/whatsapp.ts';
import type {
  MenuItem,
  Order,
  PublicOrderTracking,
  Restaurant,
} from '../../types/restaurant.ts';

interface OrderTrackingViewProps {
  restaurant: Restaurant;
  initialOrderToken?: string;
}

export function OrderTrackingView({
  restaurant,
  initialOrderToken = '',
}: OrderTrackingViewProps) {
  const [searchInput, setSearchInput] = useState(initialOrderToken);
  const [tracking, setTracking] = useState<PublicOrderTracking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = useCallback(
    async (token: string, silent = false) => {
      const clean = token.trim();
      if (!clean) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await trackOrderByToken(restaurant.id, clean);
        setTracking(res.tracking);
        setError(null);
      } catch (err) {
        if (!silent) {
          setTracking(null);
          setError(err instanceof Error ? err.message : 'لم يتم العثور على الطلب.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [restaurant.id]
  );

  useEffect(() => {
    if (initialOrderToken) {
      setSearchInput(initialOrderToken);
      fetchOrder(initialOrderToken);
    }
  }, [initialOrderToken, fetchOrder]);

  // Live Supabase Realtime subscription + 5s polling fallback while tracking active order
  useEffect(() => {
    if (
      !tracking ||
      tracking.status === 'delivered' ||
      tracking.status === 'cancelled'
    ) {
      return;
    }

    const timer = setInterval(() => {
      fetchOrder(tracking.orderToken, true);
    }, 5000);

    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    if (supabase) {
      channel = supabase
        .channel(`order-track-${tracking.orderToken}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `order_token=eq.${tracking.orderToken}`,
          },
          () => {
            fetchOrder(tracking.orderToken, true);
          }
        )
        .subscribe();
    }

    return () => {
      clearInterval(timer);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [tracking, fetchOrder]);

  const [selectedStars, setSelectedStars] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [ratingSubmitting, setRatingSubmitting] = useState<boolean>(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tracking) return;
    setRatingSubmitting(true);
    setRatingError(null);
    try {
      const res = await submitOrderRating(
        restaurant.id,
        tracking.orderToken,
        selectedStars,
        ratingComment
      );
      setTracking(res.tracking);
    } catch (err) {
      setRatingError(err instanceof Error ? err.message : 'تعذر حفظ التقييم.');
    } finally {
      setRatingSubmitting(false);
    }
  };

  const statusMeta = tracking ? ORDER_STATUS_META[tracking.status] : null;
  const activeStepIdx = statusMeta ? statusMeta.stepIndex : 0;
  const supportWaUrl = buildWhatsAppInquiryUrl(
    restaurant.whatsappNumber,
    tracking
      ? `السلام عليكم، أستفسر عن حالة طلبي (${tracking.orderNumberMasked}) في ${restaurant.name}`
      : `السلام عليكم، أستفسر عن طلبي في ${restaurant.name}`
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header + Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
            تتبع الطلبات الآمن
          </h1>
          <p className="text-xs sm:text-sm text-[#4A5850] dark:text-[#A3B8AE] mt-0.5">
            أدخل رمز التتبع الخاص بالطلب لمتابعة حالته لحظة بلحظة مع حماية كاملة لبياناتك
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchOrder(searchInput);
          }}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <div className="relative flex-1 sm:w-80">
            <Search className="w-4 h-4 text-[#4A5850] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              dir="ltr"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="رمز التتبع الآمن (orderToken)"
              className="w-full h-11 pr-10 pl-3 rounded-xl bg-white dark:bg-[#14201B] border border-[#176B45]/20 dark:border-[#2A3F35] text-xs sm:text-sm dark:text-[#ECF3EF] font-mono text-left focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !searchInput.trim()}
            className="h-11 px-5 rounded-xl bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white text-xs font-extrabold cursor-pointer shrink-0"
          >
            {loading ? 'جاري البحث...' : 'تتبع'}
          </button>
        </form>
      </div>

      {!tracking && !loading && !error && (
        <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-8 text-center space-y-2.5">
          <ShieldCheck className="w-10 h-10 text-[#104B34] mx-auto" />
          <p className="font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
            أدخل رمز التتبع الخاص بطلبك لعرض الحالة المباشرة
          </p>
          <p className="text-xs text-[#4A5850] dark:text-[#A3B8AE]">
            يظهر رمز ورابط التتبع الآمن فور تأكيد الطلب، أو يمكنك اختيار الطلب من صفحة "طلباتي".
          </p>
        </div>
      )}

      {error && (
        <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-red-200 dark:border-red-800 p-6 text-center text-sm font-bold text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {tracking && statusMeta && (
        <div className="space-y-6">
          {/* Top Order Number & Status Card */}
          <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-2xl sm:text-3xl font-extrabold text-[#18221D] dark:text-[#ECF3EF] tabular-nums">
                طلب {tracking.orderNumberMasked}
              </p>
              <p className="text-xs text-[#4A5850] dark:text-[#A3B8AE]">
                تم الإنشاء:{' '}
                {new Date(tracking.createdAt).toLocaleString('ar-EG', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            <span
              className={`px-6 py-2.5 rounded-xl text-sm sm:text-base font-extrabold border ${statusMeta.badgeClass}`}
            >
              {statusMeta.label}
            </span>
          </div>

          {/* Visual Timeline Card */}
          <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-6 shadow-xs">
            {tracking.status === 'cancelled' ? (
              <div className="py-4 flex items-center justify-center gap-3 text-red-700 font-extrabold">
                <XCircle className="w-6 h-6" />
                <span>تم إلغاء هذا الطلب. تواصل معنا عبر واتساب لأي استفسار.</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
                {ORDER_TIMELINE_STEPS.map((stepKey, idx) => {
                  const meta = ORDER_STATUS_META[stepKey];
                  const isCompleted = idx < activeStepIdx || tracking.status === 'delivered';
                  const isCurrent = idx === activeStepIdx && tracking.status !== 'delivered';
                  const historyMatch = tracking.statusHistory?.find((h) => h.status === stepKey);

                  return (
                    <div
                      key={stepKey}
                      className="flex flex-col items-center text-center gap-2 relative"
                    >
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors ${
                          isCompleted
                            ? 'bg-[#15803D] border-[#15803D] text-white'
                            : isCurrent
                              ? 'bg-[#B45309] border-[#B45309] text-white shadow-md'
                              : 'bg-[#F3F4F2] border-[#D1D5DB] text-[#4B5563]'
                        }`}
                      >
                        {isCompleted ? (
                          <Check className="w-5 h-5" />
                        ) : stepKey === 'out_for_delivery' ? (
                          <Bike className="w-5 h-5" />
                        ) : stepKey === 'preparing' ? (
                          <Timer className="w-5 h-5" />
                        ) : (
                          <Package className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p
                          className={`text-xs font-extrabold ${
                            isCompleted || isCurrent ? 'text-[#18221D]' : 'text-[#4B5563]'
                          }`}
                        >
                          {meta.label}
                        </p>
                        {historyMatch && (
                          <p className="text-[10px] text-[#4A5850] tabular-nums mt-0.5">
                            {new Date(historyMatch.timestamp).toLocaleTimeString('ar-EG', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3-Column Details Grid (PII-Masked for Security) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Column 1: Masked Customer & Fulfillment Info */}
            <div className="bg-white rounded-2xl border border-[#176B45]/10 p-6 shadow-xs space-y-3">
              <h2 className="text-base font-extrabold text-[#104B34]">معلومات الطلب</h2>
              <div className="space-y-2.5 text-sm text-[#35443C]">
                <p className="flex items-center gap-2 font-bold">
                  <User className="w-4 h-4 text-[#176B45]" />
                  <span>العميل: {tracking.customerNameMasked}</span>
                </p>
                <p className="flex items-start gap-2 text-xs leading-relaxed">
                  <MapPin className="w-4 h-4 text-[#176B45] shrink-0 mt-0.5" />
                  <span>
                    {tracking.fulfillmentType === 'pickup'
                      ? `استلام من: ${tracking.branchName || restaurant.name}`
                      : `منطقة التوصيل: ${tracking.deliveryZoneName || 'محددة'}`}
                  </span>
                </p>
                <p className="text-[11px] text-[#4A5850] flex items-center gap-1.5 pt-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                  <span>البيانات الشخصية محمية ومخفية في صفحة التتبع العامة.</span>
                </p>
              </div>
            </div>

            {/* Column 2: Masked Summary */}
            <div className="bg-white rounded-2xl border border-[#176B45]/10 p-6 shadow-xs space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <h2 className="text-base font-extrabold text-[#104B34]">ملخص التكلفة</h2>
                <div className="flex justify-between text-xs text-[#35443C] pt-1">
                  <span>عدد الأصناف</span>
                  <span className="font-bold tabular-nums">{tracking.itemsCount} أصناف</span>
                </div>
              </div>
              <div className="border-t border-[#176B45]/10 pt-3 flex justify-between items-center text-sm font-extrabold text-[#104B34]">
                <span>المجموع النهائي:</span>
                <span className="tabular-nums">
                  {formatCurrency(tracking.total, restaurant.systemSettings.currencyLabel)}
                </span>
              </div>
            </div>

            {/* Column 3: Estimated Time & WhatsApp Support */}
            <div className="bg-white rounded-2xl border border-[#176B45]/10 p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-2 text-center">
                <h2 className="text-base font-extrabold text-[#104B34]">
                  الوقت المقدر للوصول
                </h2>
                <div className="flex items-center justify-center gap-2.5 text-2xl font-extrabold text-[#18221D] pt-1">
                  <Clock className="w-7 h-7 text-[#176B45]" />
                  <span>{tracking.estimatedDeliveryText || '٣٠ - ٤٥ دقيقة'}</span>
                </div>
              </div>

              {supportWaUrl && (
                <a
                  href={supportWaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[46px] px-4 rounded-xl bg-[#15803D] hover:bg-[#104B34] text-white text-sm font-extrabold flex items-center justify-center gap-2 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>الدعم عبر واتساب</span>
                </a>
              )}
            </div>
          </div>

          {/* Customer Rating Card when delivered */}
          {tracking.status === 'delivered' && (
            <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#C5A46D]/40 dark:border-[#2A3F35] p-6 shadow-xs space-y-4">
              {tracking.rating ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                      شكراً لتقييمك طلبك!
                    </h2>
                    {tracking.ratingComment && (
                      <p className="text-sm text-[#35443C] dark:text-[#D1DFD8]">
                        “{tracking.ratingComment}”
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[#7C5A1E]">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={`w-6 h-6 ${n <= (tracking.rating ?? 0) ? 'fill-current' : 'opacity-30'}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitRating} className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
                        قيّم تجربتك مع هذا الطلب
                      </h2>
                      <p className="text-xs text-[#4A5850] dark:text-[#A3B8AE]">
                        رأيك يساعدنا على تقديم جودة أفضل دائماً.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setSelectedStars(star)}
                          aria-label={`${star} نجوم`}
                          className="p-1 cursor-pointer transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-7 h-7 ${
                              star <= selectedStars
                                ? 'text-[#B45309] fill-current'
                                : 'text-neutral-400 dark:text-neutral-600'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {ratingError && (
                    <p className="text-xs font-bold text-red-700">{ratingError}</p>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="text"
                      value={ratingComment}
                      onChange={(e) => setRatingComment(e.target.value)}
                      placeholder="اكتب تعليقك عن جودة الأكل وسرعة التوصيل (اختياري)..."
                      className="flex-1 h-11 px-4 rounded-xl bg-[#F7F3E9] dark:bg-[#0E1713] border border-[#176B45]/15 dark:border-[#2A3F35] text-sm dark:text-[#ECF3EF] focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
                    />
                    <button
                      type="submit"
                      disabled={ratingSubmitting}
                      className="h-11 px-6 rounded-xl bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white text-xs font-extrabold cursor-pointer shrink-0"
                    >
                      {ratingSubmitting ? 'جاري الإرسال...' : 'إرسال التقييم'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OrderHistoryAndFavoritesProps {
  mode: 'orders' | 'favorites';
  restaurant: Restaurant;
  items: MenuItem[];
  favoriteIds: string[];
  localOrderHistory: Order[];
  onToggleFavorite: (itemId: string) => void;
  onSelectItemDetails: (item: MenuItem) => void;
  onTrackOrder: (orderToken: string) => void;
  onReorder?: (order: Order) => void;
  onGoMenu: () => void;
}

export function OrderHistoryAndFavoritesView({
  mode,
  restaurant,
  items,
  favoriteIds,
  localOrderHistory,
  onToggleFavorite,
  onSelectItemDetails,
  onTrackOrder,
  onReorder,
  onGoMenu,
}: OrderHistoryAndFavoritesProps) {
  const [tokenQuery, setTokenQuery] = useState('');

  const handleTokenTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = tokenQuery.trim();
    if (!clean) return;
    onTrackOrder(clean);
  };

  if (mode === 'favorites') {
    const favItems = items.filter((i) => favoriteIds.includes(i.id));
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-[#104B34]">أطباقي المفضلة</h1>
            <p className="text-xs text-[#4A5850] mt-0.5">
              قائمتك المحفوظة للطلب السريع في أي وقت
            </p>
          </div>
          <button
            type="button"
            onClick={onGoMenu}
            className="min-h-[40px] px-4 rounded-xl bg-[#104B34] text-white text-xs font-bold cursor-pointer"
          >
            استعراض المنيو
          </button>
        </div>

        {favItems.length === 0 ? (
          <div className="bg-white rounded-3xl border border-[#176B45]/10 p-12 text-center space-y-3">
            <Heart className="w-10 h-10 text-rose-400 mx-auto" />
            <p className="font-extrabold text-[#18221D]">لا توجد أطباق في المفضلة بعد</p>
            <p className="text-xs text-[#4A5850]">
              اضغط على أيقونة القلب على أي طبق في القائمة لحفظه هنا.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {favItems.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={resolveAssetUrl(item.imageUrl)}
                    alt={item.name}
                    className="w-20 h-16 rounded-xl object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-extrabold text-sm text-[#18221D] truncate">{item.name}</h3>
                    <p className="text-xs font-bold text-[#176B45] tabular-nums mt-0.5">
                      {formatCurrency(item.price, restaurant.systemSettings.currencyLabel)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(item.id)}
                    aria-label="إزالة من المفضلة"
                    className="w-9 h-9 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center cursor-pointer"
                  >
                    <Heart className="w-4 h-4 fill-current" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectItemDetails(item)}
                  className="w-full min-h-[40px] rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-bold cursor-pointer"
                >
                  طلب الصنف الآن
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#104B34]">طلباتي السابقة</h1>
          <p className="text-xs text-[#4A5850] mt-0.5">
            اعرض طلباتك المحفوظة على هذا الجهاز أو تابع برمز التتبع الآمن
          </p>
        </div>

        <form onSubmit={handleTokenTrackSubmit} className="flex items-center gap-2">
          <input
            type="text"
            dir="ltr"
            value={tokenQuery}
            onChange={(e) => setTokenQuery(e.target.value)}
            placeholder="متابعة برمز التتبع الآمن (orderToken)"
            className="h-11 px-4 rounded-xl bg-white border border-[#176B45]/20 text-xs sm:text-sm text-left font-mono"
          />
          <button
            type="submit"
            disabled={!tokenQuery.trim()}
            className="h-11 px-4 rounded-xl bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white text-xs font-bold cursor-pointer shrink-0"
          >
            تتبع
          </button>
        </form>
      </div>

      {localOrderHistory.length === 0 ? (
        <div className="bg-white rounded-3xl border border-[#176B45]/10 p-12 text-center space-y-3">
          <History className="w-10 h-10 text-[#176B45]/50 mx-auto" />
          <p className="font-extrabold text-[#18221D]">لا توجد طلبات مسجلة على هذا الجهاز</p>
          <p className="text-xs text-[#4A5850]">
            يمكنك متابعة أي طلب بإدخال رمز التتبع الآمن (orderToken) بالأعلى أو بدء طلب جديد من القائمة.
          </p>
          <button
            type="button"
            onClick={onGoMenu}
            className="min-h-[42px] px-5 rounded-xl bg-[#104B34] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <UtensilsCrossed className="w-4 h-4" />
            <span>تصفح القائمة</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {localOrderHistory.map((ord) => {
            const meta = ORDER_STATUS_META[ord.status];
            return (
              <div
                key={ord.id}
                className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-extrabold text-base text-[#18221D] dark:text-[#ECF3EF] tabular-nums">
                      طلب #{ord.orderNumber}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </span>
                    {ord.rating && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#7C5A1E]">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        <span>{ord.rating}/5</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#4A5850] dark:text-[#A3B8AE]">
                    {ord.items.map((i) => `${i.quantity}× ${i.name}`).join('، ')}
                  </p>
                  <p className="text-[11px] text-[#4A5850] dark:text-[#A3B8AE]">
                    {new Date(ord.createdAt).toLocaleString('ar-EG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>

                <div className="flex items-center flex-wrap gap-2.5 shrink-0">
                  <span className="font-extrabold text-base text-[#104B34] dark:text-[#4ADE80] tabular-nums ml-1">
                    {formatCurrency(ord.total, restaurant.systemSettings.currencyLabel)}
                  </span>
                  {onReorder && (
                    <button
                      type="button"
                      onClick={() => onReorder(ord)}
                      className="min-h-[40px] px-4 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>إعادة الطلب</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onTrackOrder(ord.orderToken)}
                    className="min-h-[40px] px-4 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] hover:bg-[#EFE9DC] text-[#104B34] dark:text-[#ECF3EF] text-xs font-extrabold cursor-pointer"
                  >
                    تتبع الطلب
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
