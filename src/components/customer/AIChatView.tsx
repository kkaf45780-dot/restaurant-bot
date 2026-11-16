import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  EyeOff,
  MapPin,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
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
  ChatChallengeResponse,
  ChatMessage,
  ChatVerificationPayload,
  DeliveryZone,
  MenuItem,
  Restaurant,
} from '../../types/restaurant.ts';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback: (token: string) => void;
          'error-callback'?: () => void;
        }
      ) => string;
      remove?: (widgetId: string) => void;
    };
  }
}

interface AIChatViewProps {
  restaurant: Restaurant;
  hoursStatus: RestaurantHoursStatus;
  deliveryZones: DeliveryZone[];
  items: MenuItem[];
  messages: ChatMessage[];
  isLoading: boolean;
  isOnline?: boolean;
  chatOptOut?: boolean;
  onToggleChatOptOut?: (optOut: boolean) => void;
  pendingChallenge?: ChatChallengeResponse | null;
  challengeSubmitting?: boolean;
  onSubmitChallengeVerification?: (verification: ChatVerificationPayload) => void;
  onCancelChallenge?: () => void;
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
  chatOptOut = false,
  onToggleChatOptOut,
  pendingChallenge = null,
  challengeSubmitting = false,
  onSubmitChallengeVerification,
  onCancelChallenge,
  onSendMessage,
  onResetChat,
  onQuickAddItem,
  onGoMenu,
  onGoCheckout,
}: AIChatViewProps) {
  const [inputText, setInputText] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [hmacAnswer, setHmacAnswer] = useState('');
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const turnstileBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading, pendingChallenge]);

  // Dynamically load & render Cloudflare Turnstile only when challenge.mode === 'turnstile'
  useEffect(() => {
    if (!pendingChallenge || pendingChallenge.mode !== 'turnstile' || !pendingChallenge.siteKey) {
      return;
    }
    setTurnstileFailed(false);
    let cancelled = false;
    let widgetId: string | undefined;

    const renderWidget = () => {
      if (cancelled || !turnstileBoxRef.current || !window.turnstile || !pendingChallenge.siteKey) {
        return;
      }
      turnstileBoxRef.current.innerHTML = '';
      widgetId = window.turnstile.render(turnstileBoxRef.current, {
        sitekey: pendingChallenge.siteKey,
        theme: 'auto',
        callback: (token: string) => {
          onSubmitChallengeVerification?.({ mode: 'turnstile', token });
        },
        'error-callback': () => setTurnstileFailed(true),
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const scriptId = 'cf-turnstile-api-script';
      let script = document.getElementById(scriptId) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onerror = () => {
          if (!cancelled) setTurnstileFailed(true);
        };
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderWidget, { once: true });
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [pendingChallenge, onSubmitChallengeVerification]);

  useEffect(() => {
    setHmacAnswer('');
  }, [pendingChallenge]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isLoading || !isOnline || pendingChallenge) return;
    setInputText('');
    onSendMessage(trimmed);
  };

  const handleHmacSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingChallenge?.challengeToken || !hmacAnswer.trim() || challengeSubmitting) return;
    onSubmitChallengeVerification?.({
      mode: 'hmac',
      token: pendingChallenge.challengeToken,
      answer: hmacAnswer.trim(),
    });
  };

  const whatsappInquiryUrl = buildWhatsAppInquiryUrl(
    restaurant.whatsappNumber,
    `السلام عليكم، أستفسر عن طلب في مطعم ${restaurant.name}`
  );

  const popularDishes = items
    .filter((i) => i.isAvailable && (typeof i.stockQuantity !== 'number' || i.stockQuantity > 0))
    .slice(0, 3);

  const quickButtons = [
    { label: 'القائمة', onClick: () => onSendMessage('ممكن أشوف المنيو والأسعار؟') },
    { label: 'ساعات العمل', onClick: () => onSendMessage('إيه مواعيد العمل عندكم النهاردة؟') },
    { label: 'مناطق التوصيل', onClick: () => onSendMessage('إيه مناطق التوصيل المتاحة وأسعارها؟') },
    { label: 'اطلب الآن', onClick: () => onSendMessage('عايز أطلب أكل لو سمحت') },
  ];

  const currencyLabel = restaurant.systemSettings.currencyLabel;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Chat Pane (8 cols) */}
        <section className="lg:col-span-8 bg-white dark:bg-[#14201B] rounded-3xl border border-[#C5A46D]/40 dark:border-[#2A3F35] shadow-sm flex flex-col h-[calc(100dvh-11rem)] min-h-[460px] max-h-[690px] lg:h-[690px] overflow-hidden">
          {/* Header */}
          <div className="px-4 sm:px-5 py-3 border-b border-[#176B45]/10 dark:border-[#2A3F35] bg-[#FAF7F0] dark:bg-[#0E1713] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isOnline ? 'bg-[#16A34A]' : 'bg-amber-500'
                }`}
              />
              <h1 className="text-sm sm:text-base font-extrabold text-[#104B34] dark:text-[#ECF3EF] truncate">
                المساعد الذكي
              </h1>
              <span className="text-xs text-[#5C6B63] dark:text-[#A3B8AE] hidden sm:inline truncate">
                — {restaurant.name}
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {onToggleChatOptOut && (
                <button
                  type="button"
                  onClick={() => onToggleChatOptOut(!chatOptOut)}
                  aria-pressed={chatOptOut}
                  title="عدم حفظ سجل المحادثة محلياً"
                  className={`min-h-[34px] px-2.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border cursor-pointer transition-colors ${
                    chatOptOut
                      ? 'bg-amber-100 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                      : 'bg-white dark:bg-[#14201B] border-[#176B45]/15 dark:border-[#2A3F35] text-[#5C6B63] dark:text-[#A3B8AE] hover:text-[#104B34]'
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {chatOptOut ? 'عدم الحفظ مُفعّل' : 'عدم حفظ المحادثة'}
                  </span>
                </button>
              )}

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
                  className="min-h-[34px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-xl text-xs font-bold text-[#5C6B63] dark:text-[#A3B8AE] hover:text-[#104B34] dark:hover:text-[#ECF3EF] hover:bg-[#EFE9DC] dark:hover:bg-[#192822] flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>محادثة جديدة</span>
                </button>
              )}
            </div>
          </div>

          {!isOnline && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>
                المساعد الذكي يتطلب اتصالاً بالإنترنت. يمكنك تصفح القائمة المحفوظة في وضع القراءة.
              </span>
            </div>
          )}

          {/* Messages Feed */}
          <div
            ref={scrollContainerRef}
            role="log"
            aria-live="polite"
            aria-busy={isLoading}
            className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-[#F7F3E9]/60 dark:bg-[#0B120F]"
          >
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              const hasChanges =
                (msg.appliedChanges && msg.appliedChanges.length > 0) ||
                (msg.rejectedChanges && msg.rejectedChanges.length > 0);
              const totalChanged =
                msg.diff && msg.diff.before.total !== msg.diff.after.total;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}
                >
                  <div
                    className={`flex items-end gap-2.5 max-w-[92%] sm:max-w-[82%] ${
                      isUser ? 'flex-row' : 'flex-row-reverse'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center border ${
                        isUser
                          ? 'bg-[#104B34] text-white border-[#104B34]'
                          : 'bg-white dark:bg-[#14201B] text-[#176B45] dark:text-[#4ADE80] border-[#C5A46D]/40 dark:border-[#2A3F35]'
                      }`}
                    >
                      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>

                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-2xs ${
                        isUser
                          ? 'bg-white dark:bg-[#192822] border border-[#176B45]/15 dark:border-[#2A3F35] text-[#18221D] dark:text-[#ECF3EF]'
                          : 'bg-[#FAF7F0] dark:bg-[#14201B] border border-[#C5A46D]/40 dark:border-[#2A3F35] text-[#18221D] dark:text-[#ECF3EF]'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>

                  {/* Quick Pill Actions right below welcome message */}
                  {idx === 0 && !isUser && (
                    <div className="mt-3 flex flex-wrap gap-2 justify-end pr-0 sm:pr-11">
                      {quickButtons.map((btn) => (
                        <button
                          key={btn.label}
                          type="button"
                          disabled={isLoading || Boolean(pendingChallenge)}
                          onClick={btn.onClick}
                          className="min-h-[40px] px-4 sm:px-5 rounded-full bg-[#176B45] hover:bg-[#104B34] text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Server-validated Order Draft Diff & Mutation Feedback */}
                  {!isUser && hasChanges && (
                    <div className="mt-2 mr-0 sm:mr-11 w-full max-w-md bg-white dark:bg-[#14201B] border border-[#C5A46D]/40 dark:border-[#2A3F35] rounded-xl p-3 text-xs space-y-2 shadow-2xs">
                      {msg.appliedChanges && msg.appliedChanges.length > 0 && (
                        <div className="space-y-1">
                          {msg.appliedChanges.map((chg, i) => (
                            <p
                              key={i}
                              className="flex items-start gap-1.5 font-bold text-[#15803D] dark:text-[#4ADE80]"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{chg}</span>
                            </p>
                          ))}
                        </div>
                      )}

                      {msg.rejectedChanges && msg.rejectedChanges.length > 0 && (
                        <div className="space-y-1">
                          {msg.rejectedChanges.map((rej, i) => (
                            <p
                              key={i}
                              className="flex items-start gap-1.5 font-bold text-amber-700 dark:text-amber-300"
                            >
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{rej}</span>
                            </p>
                          ))}
                        </div>
                      )}

                      {msg.diff && (totalChanged || msg.diff.after.items.length > 0) && (
                        <div className="pt-1.5 border-t border-[#176B45]/10 dark:border-[#2A3F35] flex items-center justify-between text-[11px] text-[#5C6B63] dark:text-[#A3B8AE]">
                          <span>
                            السلة الآن: {msg.diff.after.items.reduce((s, l) => s + l.quantity, 0)}{' '}
                            أصناف
                          </span>
                          <span className="font-extrabold text-[#104B34] dark:text-[#4ADE80] tabular-nums">
                            {totalChanged
                              ? `${formatCurrency(msg.diff.before.total, currencyLabel)} ← ${formatCurrency(msg.diff.after.total, currencyLabel)}`
                              : formatCurrency(msg.diff.after.total, currencyLabel)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Contextual Cards */}
                  {!isUser && msg.suggestedAction === 'show_menu' && (
                    <button
                      type="button"
                      onClick={onGoMenu}
                      className="mt-2 mr-0 sm:mr-11 inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl bg-white dark:bg-[#14201B] border border-[#176B45]/25 dark:border-[#2A3F35] text-xs font-bold text-[#104B34] dark:text-[#4ADE80] hover:bg-[#F7F3E9] dark:hover:bg-[#192822] cursor-pointer"
                    >
                      <UtensilsCrossed className="w-3.5 h-3.5" />
                      <span>فتح المنيو الكامل</span>
                    </button>
                  )}

                  {!isUser && msg.suggestedAction === 'show_order_summary' && (
                    <button
                      type="button"
                      onClick={onGoCheckout}
                      className="mt-2 mr-0 sm:mr-11 inline-flex items-center gap-2 min-h-[40px] px-4 rounded-xl bg-[#104B34] text-white text-xs font-bold hover:bg-[#176B45] cursor-pointer"
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
                      className="mt-2 mr-0 sm:mr-11 inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl bg-[#16A34A] text-white text-xs font-bold hover:bg-[#15803D]"
                    >
                      <span>تواصل عبر واتساب</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  {!isUser && msg.suggestedAction === 'show_hours' && (
                    <div className="mt-2 mr-0 sm:mr-11 w-full max-w-md bg-white dark:bg-[#14201B] border border-[#176B45]/15 dark:border-[#2A3F35] rounded-xl p-3 text-xs space-y-1.5">
                      <p className="font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
                        مواعيد العمل ({hoursStatus.statusLabel})
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[#35443C] dark:text-[#D1DFD8]">
                        {restaurant.weeklySchedule.map((day) => (
                          <div key={day.day} className="flex justify-between">
                            <span className="font-bold">{day.labelAr}:</span>
                            <span className="tabular-nums text-[#5C6B63] dark:text-[#A3B8AE]">
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
                    <div className="mt-2 mr-0 sm:mr-11 w-full max-w-md bg-white dark:bg-[#14201B] border border-[#176B45]/15 dark:border-[#2A3F35] rounded-xl p-3 text-xs space-y-1.5">
                      <p className="font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
                        مناطق التوصيل المتاحة
                      </p>
                      {deliveryZones
                        .filter((z) => z.isActive)
                        .map((zone) => (
                          <div
                            key={zone.id}
                            className="flex justify-between text-[#35443C] dark:text-[#D1DFD8]"
                          >
                            <span>
                              {zone.name} ({zone.estimatedMinutes})
                            </span>
                            <span className="font-bold tabular-nums text-[#176B45] dark:text-[#4ADE80]">
                              {formatCurrency(zone.fee, currencyLabel)}
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
                <div className="bg-[#FAF7F0] dark:bg-[#14201B] border border-[#C5A46D]/40 dark:border-[#2A3F35] rounded-2xl px-4 py-2.5 text-xs font-bold text-[#5C6B63] dark:text-[#A3B8AE]">
                  جاري الكتابة...
                </div>
                <div className="w-9 h-9 rounded-full bg-white dark:bg-[#14201B] border border-[#C5A46D]/40 dark:border-[#2A3F35] flex items-center justify-center text-[#176B45] dark:text-[#4ADE80]">
                  <Bot className="w-4 h-4" />
                </div>
              </div>
            )}
          </div>

          {/* Inline Single-Use Human Verification Challenge Box */}
          {pendingChallenge && (
            <div className="px-4 py-3 bg-[#FAF7F0] dark:bg-[#0E1713] border-t border-[#C5A46D]/40 dark:border-[#2A3F35] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>تأكيد سريع للاستمرار في المحادثة</span>
                </div>
                {onCancelChallenge && (
                  <button
                    type="button"
                    onClick={onCancelChallenge}
                    className="text-[11px] font-bold text-[#5C6B63] dark:text-[#A3B8AE] hover:underline cursor-pointer"
                  >
                    إلغاء
                  </button>
                )}
              </div>

              {pendingChallenge.mode === 'turnstile' ? (
                <div className="space-y-2">
                  <div ref={turnstileBoxRef} className="min-h-[65px]" />
                  {turnstileFailed && (
                    <p className="text-xs font-bold text-red-600 dark:text-red-400">
                      تعذر تحميل التحقق التلقائي. يُرجى المحاولة مجدداً.
                    </p>
                  )}
                </div>
              ) : (
                <form
                  onSubmit={handleHmacSubmit}
                  className="flex flex-col sm:flex-row sm:items-center gap-2"
                >
                  <p className="text-xs font-bold text-[#18221D] dark:text-[#ECF3EF] flex-1">
                    {pendingChallenge.question}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      value={hmacAnswer}
                      onChange={(e) => setHmacAnswer(e.target.value)}
                      placeholder="الإجابة"
                      aria-label="إجابة التحقق البشري"
                      className="w-24 h-9 px-3 rounded-xl bg-white dark:bg-[#14201B] border border-[#176B45]/25 dark:border-[#2A3F35] text-sm font-bold text-center tabular-nums text-[#18221D] dark:text-[#ECF3EF]"
                    />
                    <button
                      type="submit"
                      disabled={challengeSubmitting || !hmacAnswer.trim()}
                      className="h-9 px-4 rounded-xl bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white text-xs font-extrabold cursor-pointer"
                    >
                      {challengeSubmitting ? 'جاري التحقق...' : 'تحقق وأرسل'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="p-3 sm:p-4 bg-[#FAF7F0] dark:bg-[#0E1713] border-t border-[#176B45]/10 dark:border-[#2A3F35] flex items-center gap-2.5 sm:gap-3"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              aria-label="اكتب رسالتك"
              placeholder={
                !isOnline
                  ? 'المحادثة غير متاحة بدون إنترنت...'
                  : pendingChallenge
                    ? 'أكمل التحقق السريع أعلاه لإرسال رسالتك...'
                    : 'اكتب رسالتك هنا... (مثال: عايز نص كيلو كباب ومشاوي)'
              }
              disabled={isLoading || !isOnline || Boolean(pendingChallenge)}
              className="flex-1 h-11 sm:h-12 px-4 sm:px-5 rounded-full bg-white dark:bg-[#14201B] border border-[#C5A46D]/50 dark:border-[#2A3F35] text-sm text-[#18221D] dark:text-[#ECF3EF] placeholder:text-[#7A8880] focus:outline-none focus:ring-2 focus:ring-[#176B45]/25 disabled:opacity-60 min-w-0"
            />
            <button
              type="submit"
              disabled={isLoading || !inputText.trim() || !isOnline || Boolean(pendingChallenge)}
              aria-label="إرسال الرسالة"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white flex items-center justify-center shadow-sm cursor-pointer shrink-0 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </section>

        {/* Left Info Sidebar (4 cols) */}
        <aside className="lg:col-span-4 space-y-4">
          {/* Card 1: Working Hours */}
          <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#C5A46D]/40 dark:border-[#2A3F35] p-5 space-y-2.5 shadow-xs">
            <div className="flex items-center gap-2 text-[#104B34] dark:text-[#ECF3EF] font-extrabold text-base">
              <Clock className="w-5 h-5 text-[#C5A46D]" />
              <h2>ساعات العمل</h2>
            </div>
            <div className="text-xs text-[#35443C] dark:text-[#D1DFD8] space-y-1">
              <p className="font-bold text-[#176B45] dark:text-[#4ADE80]">
                الحالة الآن: {hoursStatus.statusLabel}
              </p>
              <p>اليوم: {hoursStatus.todayHoursText}</p>
              {hoursStatus.nextOpenText && <p>يفتح: {hoursStatus.nextOpenText}</p>}
            </div>
          </div>

          {/* Card 2: Delivery Zones */}
          <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#C5A46D]/40 dark:border-[#2A3F35] p-5 space-y-2.5 shadow-xs">
            <div className="flex items-center gap-2 text-[#104B34] dark:text-[#ECF3EF] font-extrabold text-base">
              <MapPin className="w-5 h-5 text-[#176B45] dark:text-[#4ADE80]" />
              <h2>مناطق التوصيل</h2>
            </div>
            <div className="space-y-1.5 text-xs text-[#35443C] dark:text-[#D1DFD8]">
              {deliveryZones
                .filter((z) => z.isActive)
                .map((z) => (
                  <div key={z.id} className="flex items-center justify-between">
                    <span>{z.name}</span>
                    <span className="font-bold text-[#176B45] dark:text-[#4ADE80] tabular-nums">
                      {formatCurrency(z.fee, currencyLabel)}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Card 3: Popular Dishes */}
          <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#C5A46D]/40 dark:border-[#2A3F35] p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
                الأطباق الأكثر شعبية
              </h2>
              <button
                type="button"
                onClick={onGoMenu}
                className="text-xs font-bold text-[#176B45] dark:text-[#4ADE80] hover:underline cursor-pointer"
              >
                المنيو ←
              </button>
            </div>
            <div className="space-y-2.5">
              {popularDishes.map((dish) => (
                <div
                  key={dish.id}
                  className="p-2.5 rounded-xl border border-[#176B45]/10 dark:border-[#2A3F35] bg-[#FAF7F0]/60 dark:bg-[#0E1713] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={resolveAssetUrl(dish.imageUrl)}
                      alt={dish.name}
                      width={56}
                      height={48}
                      loading="lazy"
                      decoding="async"
                      className="w-14 h-12 rounded-lg object-cover shrink-0 bg-[#F7F3E9] dark:bg-[#14201B]"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-[#18221D] dark:text-[#ECF3EF] truncate">
                        {dish.name}
                      </p>
                      <div className="flex items-center gap-0.5 text-[#C5A46D] my-0.5">
                        <Star className="w-3 h-3 fill-current" />
                        <Star className="w-3 h-3 fill-current" />
                        <Star className="w-3 h-3 fill-current" />
                        <Star className="w-3 h-3 fill-current" />
                      </div>
                      <p className="text-xs font-bold text-[#176B45] dark:text-[#4ADE80] tabular-nums">
                        {formatCurrency(dish.price, currencyLabel)}
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
