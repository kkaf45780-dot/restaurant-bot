import {
  Bot,
  Clock,
  ExternalLink,
  MapPin,
  Plus,
  RotateCcw,
  Send,
  ShoppingBag,
  Star,
  User,
  UtensilsCrossed,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RestaurantHoursStatus } from '../../lib/hours.ts';
import { formatTimeArabic12h } from '../../lib/hours.ts';
import { resolveAssetUrl } from '../../lib/imageAssets.ts';
import { formatCurrency } from '../../lib/pricing.ts';
import { buildWhatsAppInquiryUrl } from '../../lib/whatsapp.ts';
import type {
  ChatMessage,
  DeliveryZone,
  MenuItem,
  Restaurant,
} from '../../types/restaurant.ts';

interface AIChatViewProps {
  restaurant: Restaurant;
  hoursStatus: RestaurantHoursStatus;
  deliveryZones: DeliveryZone[];
  items: MenuItem[];
  messages: ChatMessage[];
  isLoading: boolean;
  isOnline?: boolean;
  onSendMessage: (text: string) => void;
  onResetChat: () => void;
  onQuickAddItem: (item: MenuItem) => void;
  onGoMenu: () => void;
  onGoCheckout: () => void;
}

export function AIChatView({
  restaurant,
  hoursStatus,
  deliveryZones,
  items,
  messages,
  isLoading,
  isOnline = true,
  onSendMessage,
  onResetChat,
  onQuickAddItem,
  onGoMenu,
  onGoCheckout,
}: AIChatViewProps) {
  const [inputText, setInputText] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isLoading || !isOnline) return;
    setInputText('');
    onSendMessage(trimmed);
  };

  const whatsappInquiryUrl = buildWhatsAppInquiryUrl(
    restaurant.whatsappNumber,
    `السلام عليكم، أستفسر عن طلب في مطعم ${restaurant.name}`
  );

  const popularDishes = items
    .filter((i) => i.isAvailable && i.stockQuantity > 0)
    .slice(0, 3);

  const quickButtons = [
    { label: 'القائمة', onClick: () => onSendMessage('ممكن أشوف المنيو والأسعار؟') },
    { label: 'ساعات العمل', onClick: () => onSendMessage('إيه مواعيد العمل عندكم النهاردة؟') },
    { label: 'مناطق التوصيل', onClick: () => onSendMessage('إيه مناطق التوصيل المتاحة وأسعارها؟') },
    { label: 'اطلب الآن', onClick: () => onSendMessage('عايز أطلب أكل لو سمحت') },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* 2-Column Layout matching AI_restaurant_assistant_chat_interface */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Chat Pane (8 cols) */}
        <section className="lg:col-span-8 bg-white dark:bg-[#14201B] rounded-3xl border border-[#C5A46D]/40 dark:border-[#2A3F35] shadow-sm flex flex-col h-[640px] lg:h-[690px] overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-[#176B45]/10 dark:border-[#2A3F35] bg-[#FAF7F0] dark:bg-[#0E1713] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-[#16A34A]' : 'bg-amber-500'}`} />
              <h1 className="text-base font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
                المساعد الذكي
              </h1>
              <span className="text-xs text-[#5C6B63] dark:text-[#A3B8AE] hidden sm:inline">
                — {restaurant.name}
              </span>
            </div>

            {confirmReset ? (
              <div className="flex items-center gap-1.5" role="group" aria-label="تأكيد مسح المحادثة">
                <span className="text-xs font-bold text-[#104B34] dark:text-[#ECF3EF]">
                  تأكيد المسح؟
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReset(false);
                    onResetChat();
                  }}
                  className="min-h-[34px] px-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                >
                  نعم
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="min-h-[34px] px-2.5 rounded-lg bg-[#EFE9DC] dark:bg-[#192822] text-[#18221D] dark:text-[#ECF3EF] text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="min-h-[38px] px-3 rounded-xl text-xs font-bold text-[#5C6B63] dark:text-[#A3B8AE] hover:text-[#104B34] hover:bg-[#EFE9DC] dark:hover:bg-[#192822] flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>محادثة جديدة</span>
              </button>
            )}
          </div>

          {!isOnline && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>المساعد الذكي يتطلب اتصالاً بالإنترنت. يمكنك تصفح القائمة المحفوظة في وضع القراءة.</span>
            </div>
          )}

          {/* Messages Feed */}
          <div
            ref={scrollContainerRef}
            role="log"
            aria-live="polite"
            aria-busy={isLoading}
            className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#F7F3E9]/60 dark:bg-[#0B120F]"
          >
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}
                >
                  <div
                    className={`flex items-end gap-2.5 max-w-[90%] sm:max-w-[80%] ${
                      isUser ? 'flex-row' : 'flex-row-reverse'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center border ${
                        isUser
                          ? 'bg-[#104B34] text-white border-[#104B34]'
                          : 'bg-white text-[#176B45] border-[#C5A46D]/40'
                      }`}
                    >
                      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>

                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-2xs ${
                        isUser
                          ? 'bg-white border border-[#176B45]/15 text-[#18221D]'
                          : 'bg-[#FAF7F0] border border-[#C5A46D]/40 text-[#18221D]'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>

                  {/* Quick Pill Actions right below welcome message */}
                  {idx === 0 && !isUser && (
                    <div className="mt-3 flex flex-wrap gap-2 justify-end pr-11">
                      {quickButtons.map((btn) => (
                        <button
                          key={btn.label}
                          type="button"
                          disabled={isLoading}
                          onClick={btn.onClick}
                          className="min-h-[40px] px-5 rounded-full bg-[#176B45] hover:bg-[#104B34] text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Contextual Cards */}
                  {!isUser && msg.suggestedAction === 'show_menu' && (
                    <button
                      type="button"
                      onClick={onGoMenu}
                      className="mt-2 mr-11 inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl bg-white border border-[#176B45]/25 text-xs font-bold text-[#104B34] hover:bg-[#F7F3E9] cursor-pointer"
                    >
                      <UtensilsCrossed className="w-3.5 h-3.5" />
                      <span>فتح المنيو الكامل</span>
                    </button>
                  )}

                  {!isUser && msg.suggestedAction === 'show_order_summary' && (
                    <button
                      type="button"
                      onClick={onGoCheckout}
                      className="mt-2 mr-11 inline-flex items-center gap-2 min-h-[40px] px-4 rounded-xl bg-[#104B34] text-white text-xs font-bold hover:bg-[#176B45] cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>الانتقال إلى سلة المشتريات وإتمام الطلب</span>
                    </button>
                  )}

                  {!isUser && msg.suggestedAction === 'show_whatsapp' && whatsappInquiryUrl && (
                    <a
                      href={whatsappInquiryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 mr-11 inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl bg-[#16A34A] text-white text-xs font-bold hover:bg-[#15803D]"
                    >
                      <span>تواصل عبر واتساب</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  {!isUser && msg.suggestedAction === 'show_hours' && (
                    <div className="mt-2 mr-11 w-full max-w-md bg-white border border-[#176B45]/15 rounded-xl p-3 text-xs space-y-1.5">
                      <p className="font-extrabold text-[#104B34]">
                        مواعيد العمل ({hoursStatus.statusLabel})
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[#35443C]">
                        {restaurant.weeklySchedule.map((day) => (
                          <div key={day.day} className="flex justify-between">
                            <span className="font-bold">{day.labelAr}:</span>
                            <span className="tabular-nums text-[#5C6B63]">
                              {day.isClosed
                                ? 'إجازة'
                                : `${formatTimeArabic12h(day.openTime)} - ${formatTimeArabic12h(day.closeTime)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!isUser && msg.suggestedAction === 'show_delivery' && (
                    <div className="mt-2 mr-11 w-full max-w-md bg-white border border-[#176B45]/15 rounded-xl p-3 text-xs space-y-1.5">
                      <p className="font-extrabold text-[#104B34]">مناطق التوصيل المتاحة</p>
                      {deliveryZones
                        .filter((z) => z.isActive)
                        .map((zone) => (
                          <div key={zone.id} className="flex justify-between text-[#35443C]">
                            <span>
                              {zone.name} ({zone.estimatedMinutes})
                            </span>
                            <span className="font-bold tabular-nums text-[#176B45]">
                              {formatCurrency(zone.fee, restaurant.systemSettings.currencyLabel)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-end justify-end gap-2">
                <div className="bg-[#FAF7F0] border border-[#C5A46D]/40 rounded-2xl px-4 py-2.5 text-xs font-bold text-[#5C6B63]">
                  جاري الكتابة...
                </div>
                <div className="w-9 h-9 rounded-full bg-white border border-[#C5A46D]/40 flex items-center justify-center text-[#176B45]">
                  <Bot className="w-4 h-4" />
                </div>
              </div>
            )}
          </div>

          {/* Input Bar matching AI_restaurant_assistant_chat_interface */}
          <form
            onSubmit={handleSubmit}
            className="p-4 bg-[#FAF7F0] dark:bg-[#0E1713] border-t border-[#176B45]/10 dark:border-[#2A3F35] flex items-center gap-3"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              aria-label="اكتب رسالتك"
              placeholder={
                isOnline
                  ? 'اكتب رسالتك هنا... (مثال: هل يوجد توصيل لمدينة نصر؟)'
                  : 'المحادثة غير متاحة بدون إنترنت...'
              }
              disabled={isLoading || !isOnline}
              className="flex-1 h-12 px-5 rounded-full bg-white dark:bg-[#14201B] border border-[#C5A46D]/50 dark:border-[#2A3F35] text-sm text-[#18221D] dark:text-[#ECF3EF] placeholder:text-[#7A8880] focus:outline-none focus:ring-2 focus:ring-[#176B45]/25 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isLoading || !inputText.trim() || !isOnline}
              aria-label="إرسال الرسالة"
              className="w-12 h-12 rounded-full bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white flex items-center justify-center shadow-sm cursor-pointer shrink-0 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </section>

        {/* Left Info Sidebar (4 cols) matching reference */}
        <aside className="lg:col-span-4 space-y-4">
          {/* Card 1: Working Hours */}
          <div className="bg-white rounded-2xl border border-[#C5A46D]/40 p-5 space-y-2.5 shadow-xs">
            <div className="flex items-center gap-2 text-[#104B34] font-extrabold text-base">
              <Clock className="w-5 h-5 text-[#C5A46D]" />
              <h2>ساعات العمل</h2>
            </div>
            <div className="text-xs text-[#35443C] space-y-1">
              <p className="font-bold text-[#176B45]">
                الحالة الآن: {hoursStatus.statusLabel}
              </p>
              <p>اليوم: {hoursStatus.todayHoursText}</p>
              {hoursStatus.nextOpenText && <p>يفتح: {hoursStatus.nextOpenText}</p>}
            </div>
          </div>

          {/* Card 2: Delivery Zones */}
          <div className="bg-white rounded-2xl border border-[#C5A46D]/40 p-5 space-y-2.5 shadow-xs">
            <div className="flex items-center gap-2 text-[#104B34] font-extrabold text-base">
              <MapPin className="w-5 h-5 text-[#176B45]" />
              <h2>مناطق التوصيل</h2>
            </div>
            <div className="space-y-1.5 text-xs text-[#35443C]">
              {deliveryZones
                .filter((z) => z.isActive)
                .map((z) => (
                  <div key={z.id} className="flex items-center justify-between">
                    <span>{z.name}</span>
                    <span className="font-bold text-[#176B45] tabular-nums">
                      {formatCurrency(z.fee, restaurant.systemSettings.currencyLabel)}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Card 3: Popular Dishes */}
          <div className="bg-white rounded-2xl border border-[#C5A46D]/40 p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-[#104B34]">الأطباق الأكثر شعبية</h2>
              <button
                type="button"
                onClick={onGoMenu}
                className="text-xs font-bold text-[#176B45] hover:underline cursor-pointer"
              >
                المنيو ←
              </button>
            </div>
            <div className="space-y-2.5">
              {popularDishes.map((dish) => (
                <div
                  key={dish.id}
                  className="p-2.5 rounded-xl border border-[#176B45]/10 bg-[#FAF7F0]/60 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={resolveAssetUrl(dish.imageUrl)}
                      alt={dish.name}
                      width={56}
                      height={48}
                      loading="lazy"
                      decoding="async"
                      className="w-14 h-12 rounded-lg object-cover shrink-0 bg-[#F7F3E9]"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-[#18221D] truncate">
                        {dish.name}
                      </p>
                      <div className="flex items-center gap-0.5 text-[#C5A46D] my-0.5">
                        <Star className="w-3 h-3 fill-current" />
                        <Star className="w-3 h-3 fill-current" />
                        <Star className="w-3 h-3 fill-current" />
                        <Star className="w-3 h-3 fill-current" />
                      </div>
                      <p className="text-xs font-bold text-[#176B45] tabular-nums">
                        {formatCurrency(dish.price, restaurant.systemSettings.currencyLabel)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onQuickAddItem(dish)}
                    title="إضافة سريعة للطلب"
                    aria-label={`إضافة ${dish.name} للطلب`}
                    className="w-8 h-8 rounded-lg bg-[#104B34] hover:bg-[#176B45] text-white flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
