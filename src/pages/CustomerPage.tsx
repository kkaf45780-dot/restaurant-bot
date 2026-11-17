import { WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AIChatView } from '../components/customer/AIChatView.tsx';
import { AboutView, LegalPageView } from '../components/customer/AboutAndLegalViews.tsx';
import { CheckoutView } from '../components/customer/CheckoutView.tsx';
import {
  CustomerNavbar,
  type CustomerRoute,
} from '../components/customer/CustomerNavbar.tsx';
import { HomepageView } from '../components/customer/HomepageView.tsx';
import { MenuCatalogView } from '../components/customer/MenuCatalogView.tsx';
import {
  OrderHistoryAndFavoritesView,
  OrderTrackingView,
} from '../components/customer/OrderTrackingAndHistoryView.tsx';
import { ProductDetailsModal } from '../components/customer/ProductDetailsModal.tsx';
import { ShareMenuModal } from '../components/customer/ShareMenuModal.tsx';
import {
  useDarkMode,
  useOnlineStatus,
  usePWAInstall,
} from '../hooks/usePWAOnlineTheme.ts';
import {
  ApiError,
  fetchChatChallenge,
  fetchRestaurantBundle,
  sendChatMessage,
} from '../lib/api.ts';
import {
  clearChatHistory,
  getChatOptOut,
  loadChatHistory,
  saveChatHistory,
  sanitizeDraftForStorage,
  setChatOptOut,
} from '../lib/chatStorage.ts';
import type { RestaurantHoursStatus } from '../lib/hours.ts';
import { buildDraftLineKey } from '../lib/pricing.ts';
import type {
  ChatChallengeResponse,
  ChatMessage,
  ChatVerificationPayload,
  MenuItem,
  Order,
  OrderDraft,
  OrderDraftItem,
  RestaurantBundle,
} from '../types/restaurant.ts';

interface CustomerPageProps {
  route: CustomerRoute;
  initialTrackOrderNumber?: string;
  initialTrackOrderToken?: string;
  onNavigateRoute: (route: CustomerRoute, trackOrder?: string, trackToken?: string) => void;
  onNavigateAdmin: () => void;
}

const EMPTY_DRAFT: OrderDraft = {
  items: [],
  fulfillmentType: 'delivery',
  deliveryZoneId: '',
  branchId: '',
  couponCode: '',
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  notes: '',
};

const FAVORITES_KEY = 'moazzaf_favorites_v1';
const ORDER_HISTORY_KEY = 'moazzaf_order_history_v1';
const ORDER_TOKENS_KEY = 'moazzaf_order_tokens_v1';
const CACHED_BUNDLE_KEY = 'moazzaf_cached_bundle_v1';
const CHAT_SESSION_STORAGE_KEY = 'moazzaf_chat_session_v1';

function getOrCreateChatSessionId(): string {
  try {
    const existing = sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
    if (existing && existing.length >= 6) return existing;
    const generated = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function CustomerPage({
  route,
  initialTrackOrderNumber,
  initialTrackOrderToken,
  onNavigateRoute,
  onNavigateAdmin,
}: CustomerPageProps) {
  const isOnline = useOnlineStatus();
  const { isDark, toggleDark } = useDarkMode();
  const { canShowInstall, promptInstall } = usePWAInstall();

  const [bundle, setBundle] = useState<RestaurantBundle | null>(null);
  const [hoursStatus, setHoursStatus] = useState<RestaurantHoursStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUsingCachedBundle, setIsUsingCachedBundle] = useState(false);

  const [menuInitialCat, setMenuInitialCat] = useState<string>('all');
  const [selectedProductModal, setSelectedProductModal] = useState<MenuItem | null>(null);
  const [editingCartLine, setEditingCartLine] = useState<OrderDraftItem | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const [sessionId] = useState<string>(() => getOrCreateChatSessionId());
  const [chatOptOut, setChatOptOutState] = useState<boolean>(() => getChatOptOut());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingChallenge, setPendingChallenge] = useState<ChatChallengeResponse | null>(null);
  const [pendingRetryMessage, setPendingRetryMessage] = useState<string | null>(null);
  const [challengeSubmitting, setChallengeSubmitting] = useState(false);

  const [orderDraft, setOrderDraft] = useState<OrderDraft>(EMPTY_DRAFT);
  const [confirmedOrderState, setConfirmedOrderState] = useState<{
    order: Order;
    whatsappUrl: string;
    orderToken?: string;
  } | null>(null);

  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [localOrderHistory, setLocalOrderHistory] = useState<Order[]>(() => {
    try {
      const saved = localStorage.getItem(ORDER_HISTORY_KEY);
      return saved ? (JSON.parse(saved) as Order[]) : [];
    } catch {
      return [];
    }
  });

  const [orderTokens, setOrderTokens] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(ORDER_TOKENS_KEY);
      return saved ? (JSON.parse(saved) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });

  const [toastText, setToastText] = useState<string | null>(null);
  const showToast = useCallback((text: string) => {
    setToastText(text);
    setTimeout(() => {
      setToastText((prev) => (prev === text ? null : prev));
    }, 3000);
  }, []);

  const hydrateAfterBundle = useCallback((loadedBundle: RestaurantBundle) => {
    document.title = `موظف المطعم — ${loadedBundle.restaurant.name}`;
    const restId = loadedBundle.restaurant.id;
    // Remove legacy unscrubbed chat cache if present
    try {
      localStorage.removeItem(`chat_${restId}`);
    } catch {
      // Ignore storage access errors
    }

    const restoredHistory = loadChatHistory(restId);
    if (restoredHistory.length > 0) {
      setMessages(restoredHistory);
    } else {
      setMessages([
        {
          id: 'welcome_1',
          role: 'assistant',
          text: loadedBundle.restaurant.aiSettings.welcomeMessage,
          timestamp: new Date().toISOString(),
        },
      ]);
    }

    const savedDraft = localStorage.getItem(`draft_${restId}`);
    if (savedDraft) {
      try {
        const parsedDraft = JSON.parse(savedDraft) as OrderDraft;
        setOrderDraft(sanitizeDraftForStorage({ ...EMPTY_DRAFT, ...parsedDraft }));
      } catch {
        setOrderDraft(EMPTY_DRAFT);
      }
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await fetchRestaurantBundle();
      setBundle(data.bundle);
      setHoursStatus(data.hoursStatus);
      setIsUsingCachedBundle(false);
      hydrateAfterBundle(data.bundle);
      try {
        localStorage.setItem(CACHED_BUNDLE_KEY, JSON.stringify(data));
      } catch {
        // Ignore quota exceeded
      }
    } catch (err) {
      // Fallback to offline read-only cached menu snapshot if present
      try {
        const rawCached = localStorage.getItem(CACHED_BUNDLE_KEY);
        if (rawCached) {
          const cached = JSON.parse(rawCached) as {
            bundle: RestaurantBundle;
            hoursStatus: RestaurantHoursStatus;
          };
          if (cached?.bundle && cached?.hoursStatus) {
            setBundle(cached.bundle);
            setHoursStatus(cached.hoursStatus);
            setIsUsingCachedBundle(true);
            hydrateAfterBundle(cached.bundle);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Ignore cache parse error
      }
      setLoadError(
        err instanceof Error ? err.message : 'تعذر تحميل صفحة المطعم حالياً، حاول تحديث الصفحة.'
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateAfterBundle]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!bundle) return;
    saveChatHistory(bundle.restaurant.id, messages);
  }, [bundle, messages]);

  useEffect(() => {
    if (!bundle) return;
    try {
      // Strip PII before persisting cart draft locally
      localStorage.setItem(
        `draft_${bundle.restaurant.id}`,
        JSON.stringify(sanitizeDraftForStorage(orderDraft))
      );
    } catch {
      // Ignore
    }
  }, [bundle, orderDraft]);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds));
    } catch {
      // Ignore
    }
  }, [favoriteIds]);

  const totalItemsCount = useMemo(
    () => orderDraft.items.reduce((acc, item) => acc + item.quantity, 0),
    [orderDraft.items]
  );

  const handleToggleFavorite = (itemId: string) => {
    setFavoriteIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const handleToggleChatOptOut = (nextOptOut: boolean) => {
    setChatOptOutState(nextOptOut);
    setChatOptOut(nextOptOut, bundle?.restaurant.id);
    if (nextOptOut) {
      showToast('تم تفعيل عدم حفظ سجل المحادثة محلياً وحذف السجل السابق.');
    } else {
      showToast('تم تفعيل الحفظ المؤقت للمحادثة (٢٤ ساعة مع إزالة البيانات الشخصية).');
    }
  };

  const handleAddConfiguredItem = (entry: OrderDraftItem) => {
    setConfirmedOrderState(null);
    const key = entry.lineKey || buildDraftLineKey(entry);
    setOrderDraft((prev) => {
      const existing = prev.items.find((i) => (i.lineKey || buildDraftLineKey(i)) === key);
      if (existing) {
        return {
          ...prev,
          items: prev.items.map((i) =>
            (i.lineKey || buildDraftLineKey(i)) === key
              ? { ...i, quantity: i.quantity + entry.quantity }
              : i
          ),
        };
      }
      return {
        ...prev,
        items: [...prev.items, { ...entry, lineKey: key }],
      };
    });
    showToast('تمت إضافة الصنف إلى السلة.');
  };

  const handleSaveEditedLine = (previousLineKey: string, updatedEntry: OrderDraftItem) => {
    setConfirmedOrderState(null);
    const nextKey = buildDraftLineKey(updatedEntry);
    setOrderDraft((prev) => {
      const withoutOld = prev.items.filter(
        (i) => (i.lineKey || buildDraftLineKey(i)) !== previousLineKey
      );
      const duplicateTarget = withoutOld.find(
        (i) => (i.lineKey || buildDraftLineKey(i)) === nextKey
      );
      if (duplicateTarget) {
        return {
          ...prev,
          items: withoutOld.map((i) =>
            (i.lineKey || buildDraftLineKey(i)) === nextKey
              ? { ...i, quantity: i.quantity + updatedEntry.quantity }
              : i
          ),
        };
      }
      return {
        ...prev,
        items: [...withoutOld, { ...updatedEntry, lineKey: nextKey }],
      };
    });
    showToast('تم تحديث خيارات الصنف بنجاح.');
  };

  const handleQuickAddItem = (item: MenuItem) => {
    if (!item.isAvailable || (typeof item.stockQuantity === 'number' && item.stockQuantity <= 0)) {
      return;
    }
    const defaultSize = item.sizes?.find((s) => s.isDefault) ?? item.sizes?.[0];
    handleAddConfiguredItem({
      itemId: item.id,
      quantity: 1,
      selectedSizeId: defaultSize?.id,
      selectedExtraIds: [],
    });
  };

  const handleUpdateLineQty = (lineKey: string, nextQty: number) => {
    setConfirmedOrderState(null);
    setOrderDraft((prev) => {
      if (nextQty <= 0) {
        return {
          ...prev,
          items: prev.items.filter((i) => (i.lineKey || buildDraftLineKey(i)) !== lineKey),
        };
      }
      return {
        ...prev,
        items: prev.items.map((i) =>
          (i.lineKey || buildDraftLineKey(i)) === lineKey ? { ...i, quantity: nextQty } : i
        ),
      };
    });
  };

  const handleReorder = (pastOrder: Order) => {
    if (!bundle) return;
    const catalogMap = new Map(bundle.items.map((i) => [i.id, i]));
    const nextLines: OrderDraftItem[] = [];
    let skippedCount = 0;

    for (const oi of pastOrder.items) {
      const catalogItem = catalogMap.get(oi.itemId);
      if (
        !catalogItem ||
        !catalogItem.isAvailable ||
        (typeof catalogItem.stockQuantity === 'number' && catalogItem.stockQuantity <= 0)
      ) {
        skippedCount += 1;
        continue;
      }
      const draftEntry: OrderDraftItem = {
        itemId: oi.itemId,
        quantity: Math.max(1, oi.quantity),
        selectedSizeId: oi.selectedSizeId,
        selectedExtraIds: oi.selectedExtras?.map((ex) => ex.id) ?? [],
        itemNotes: oi.itemNotes,
      };
      draftEntry.lineKey = buildDraftLineKey(draftEntry);
      nextLines.push(draftEntry);
    }

    if (nextLines.length === 0) {
      showToast('عذراً، أصناف هذا الطلب غير متوفرة حالياً.');
      return;
    }

    setConfirmedOrderState(null);
    setOrderDraft((prev) => ({
      ...prev,
      items: nextLines,
      fulfillmentType: pastOrder.fulfillmentType || prev.fulfillmentType,
      deliveryZoneId: pastOrder.deliveryZoneId || prev.deliveryZoneId,
      customerName: pastOrder.customerName || prev.customerName,
      customerPhone: pastOrder.customerPhone || prev.customerPhone,
      customerAddress:
        pastOrder.fulfillmentType === 'delivery'
          ? pastOrder.customerAddress || prev.customerAddress
          : prev.customerAddress,
    }));

    showToast(
      skippedCount > 0
        ? `تمت إضافة ${nextLines.length} أصناف إلى السلة (تم تخطي ${skippedCount} أصناف غير متاحة).`
        : 'تم تجهيز طلبك السابق في السلة!'
    );
    onNavigateRoute('checkout');
  };

  const dispatchChatRequest = async (
    text: string,
    historyForRequest: ChatMessage[],
    verification?: ChatVerificationPayload
  ) => {
    if (!bundle || !isOnline) return;
    try {
      const res = await sendChatMessage({
        restaurantId: bundle.restaurant.id,
        message: text,
        history: historyForRequest.map((m) => ({ role: m.role, text: m.text })),
        orderDraft,
        sessionId,
        verification,
      });

      setPendingChallenge(null);
      setPendingRetryMessage(null);
      setOrderDraft(res.updatedDraft);
      const assistantMsg: ChatMessage = {
        id: `ast_${Date.now()}`,
        role: 'assistant',
        text: res.reply,
        timestamp: new Date().toISOString(),
        suggestedAction: res.suggestedAction,
        appliedChanges: res.appliedChanges,
        rejectedChanges: res.rejectedChanges,
        diff: res.diff,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (err instanceof ApiError && err.captchaRequired) {
        try {
          const challenge = await fetchChatChallenge(sessionId);
          setPendingChallenge(challenge);
          setPendingRetryMessage(text);
          return;
        } catch {
          // Fall through to normal error message
        }
      }
      const fallbackMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        text:
          err instanceof Error
            ? err.message
            : 'معلش، حصل مشكلة في الاتصال. تقدر تراجع المنيو أو تكلمنا على واتساب.',
        timestamp: new Date().toISOString(),
        suggestedAction: 'show_whatsapp',
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!bundle || !isOnline) return;
    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setChatLoading(true);
    try {
      await dispatchChatRequest(text, nextHistory);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSubmitChallengeVerification = async (verification: ChatVerificationPayload) => {
    if (!pendingRetryMessage) return;
    setChallengeSubmitting(true);
    setChatLoading(true);
    try {
      await dispatchChatRequest(pendingRetryMessage, messages, verification);
    } finally {
      setChallengeSubmitting(false);
      setChatLoading(false);
    }
  };

  const handleResetChat = () => {
    if (!bundle) return;
    clearChatHistory(bundle.restaurant.id);
    setPendingChallenge(null);
    setPendingRetryMessage(null);
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        role: 'assistant',
        text: bundle.restaurant.aiSettings.welcomeMessage,
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  const handleOrderConfirmed = (order: Order, whatsappUrl: string, orderToken?: string) => {
    setConfirmedOrderState({ order, whatsappUrl, orderToken });
    setOrderDraft(EMPTY_DRAFT);
    const nextHistory = [order, ...localOrderHistory].slice(0, 20);
    setLocalOrderHistory(nextHistory);
    try {
      localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(nextHistory));
      if (orderToken) {
        const nextTokens = { ...orderTokens, [order.orderNumber]: orderToken };
        setOrderTokens(nextTokens);
        localStorage.setItem(ORDER_TOKENS_KEY, JSON.stringify(nextTokens));
      }
    } catch {
      // Ignore
    }
  };

  const handleInstallClick = async () => {
    const outcome = await promptInstall();
    if (outcome === 'ios') {
      showToast('لتثبيت التطبيق على iPhone: اضغط زر المشاركة ثم "إضافة إلى الشاشة الرئيسية".');
    } else if (outcome === 'accepted') {
      showToast('تم تثبيت تطبيق موظف المطعم بنجاح!');
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] flex flex-col"
        aria-busy="true"
        aria-label="جاري تحميل بيانات المطعم"
      >
        <div className="h-[72px] bg-white/90 dark:bg-[#101A15] border-b border-[#176B45]/10 px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#176B45]/15 animate-pulse" />
            <div className="space-y-2">
              <div className="w-28 h-4 rounded bg-[#176B45]/15 animate-pulse" />
              <div className="w-20 h-3 rounded bg-[#176B45]/10 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-[#176B45]/10 animate-pulse" />
            <div className="w-24 h-10 rounded-xl bg-[#176B45]/15 animate-pulse" />
          </div>
        </div>
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-10 space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 space-y-4">
              <div className="w-56 h-7 rounded-full bg-white/80 dark:bg-[#14201B] animate-pulse" />
              <div className="w-3/4 h-12 rounded-xl bg-[#176B45]/15 animate-pulse" />
              <div className="w-full h-16 rounded-xl bg-white/70 dark:bg-[#14201B] animate-pulse" />
              <div className="flex gap-3 pt-2">
                <div className="w-32 h-12 rounded-full bg-[#176B45]/25 animate-pulse" />
                <div className="w-36 h-12 rounded-full bg-white/80 dark:bg-[#14201B] animate-pulse" />
              </div>
            </div>
            <div className="lg:col-span-6">
              <div className="w-full max-w-[490px] aspect-[4/3] mx-auto rounded-3xl bg-[#176B45]/15 animate-pulse" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 overflow-hidden p-4 space-y-3"
              >
                <div className="h-40 rounded-xl bg-[#176B45]/10 animate-pulse" />
                <div className="w-2/3 h-4 rounded bg-[#176B45]/15 animate-pulse" />
                <div className="w-full h-3 rounded bg-[#176B45]/10 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !bundle || !hoursStatus) {
    return (
      <div className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] flex items-center justify-center p-6">
        <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-red-200 dark:border-red-800 p-8 text-center max-w-md w-full space-y-4">
          <h1 className="text-lg font-bold text-[#18221D] dark:text-[#ECF3EF]">
            تعذر تحميل التطبيق
          </h1>
          <p className="text-sm text-[#5C6B63] dark:text-[#A3B8AE]">{loadError}</p>
          <button
            type="button"
            onClick={loadData}
            className="min-h-[44px] px-6 rounded-xl bg-[#104B34] text-white text-sm font-bold hover:bg-[#176B45] cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  const { restaurant, categories, items, deliveryZones, branches, activeCoupons } = bundle;
  const resolvedTrackOrderNumber =
    initialTrackOrderNumber || localOrderHistory[0]?.orderNumber || '';
  const resolvedTrackOrderToken =
    initialTrackOrderToken ||
    (resolvedTrackOrderNumber ? orderTokens[resolvedTrackOrderNumber] : '') ||
    '';

  return (
    <div className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] text-[#18221D] dark:text-[#ECF3EF] flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#104B34] focus:text-white focus:text-sm focus:font-bold focus:shadow-lg"
      >
        انتقل إلى المحتوى
      </a>
      <CustomerNavbar
        restaurant={restaurant}
        hoursStatus={hoursStatus}
        activeRoute={route}
        cartCount={totalItemsCount}
        favoritesCount={favoriteIds.length}
        isDark={isDark}
        canShowInstall={canShowInstall}
        onToggleDark={toggleDark}
        onOpenShareQr={() => setShareModalOpen(true)}
        onInstallApp={handleInstallClick}
        onNavigate={(nextRoute) => {
          if (nextRoute === 'menu') {
            setMenuInitialCat('all');
          }
          if (nextRoute === 'checkout') {
            setConfirmedOrderState(null);
          }
          if (nextRoute === 'track' && localOrderHistory[0]?.orderNumber) {
            const firstNum = localOrderHistory[0].orderNumber;
            onNavigateRoute('track', firstNum, orderTokens[firstNum]);
            return;
          }
          onNavigateRoute(nextRoute);
        }}
        onNavigateAdmin={onNavigateAdmin}
      />

      {(!isOnline || isUsingCachedBundle) && (
        <div className="bg-amber-600 text-white px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 text-center">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            أنت تتصفح آخر نسخة محفوظة من القائمة (وضع القراءة بدون إنترنت) — إرسال الطلبات متوقف
            حتى عودة الاتصال.
          </span>
        </div>
      )}

      {toastText && (
        <div className="fixed bottom-24 lg:bottom-5 left-4 right-4 sm:right-auto sm:left-5 z-50 bg-[#104B34] text-white px-5 py-3 rounded-2xl shadow-lg text-xs font-extrabold border border-[#C5A46D]/40 text-center sm:text-right">
          {toastText}
        </div>
      )}

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {route === 'home' && (
          <HomepageView
            restaurant={restaurant}
            hoursStatus={hoursStatus}
            categories={categories}
            items={items}
            branches={branches}
            activeCoupons={activeCoupons}
            favoriteIds={favoriteIds}
            onToggleFavorite={handleToggleFavorite}
            onSelectItemDetails={(it) => {
              setEditingCartLine(null);
              setSelectedProductModal(it);
            }}
            onQuickAddItem={handleQuickAddItem}
            onNavigateChat={() => onNavigateRoute('chat')}
            onNavigateMenuCategory={(catId) => {
              setMenuInitialCat(catId);
              onNavigateRoute('menu');
            }}
          />
        )}

        {route === 'about' && (
          <AboutView
            restaurant={restaurant}
            hoursStatus={hoursStatus}
            branches={branches}
            deliveryZones={deliveryZones}
            onOpenShareQr={() => setShareModalOpen(true)}
            onGoMenu={() => onNavigateRoute('menu')}
            onGoChat={() => onNavigateRoute('chat')}
          />
        )}

        {(route === 'privacy' || route === 'terms') && (
          <LegalPageView
            mode={route}
            restaurant={restaurant}
            onGoMenu={() => onNavigateRoute('menu')}
          />
        )}

        {route === 'menu' && (
          <MenuCatalogView
            categories={categories}
            items={items}
            deliveryZones={deliveryZones}
            activeCoupons={activeCoupons}
            currencyLabel={restaurant.systemSettings.currencyLabel}
            draft={orderDraft}
            favoriteIds={favoriteIds}
            initialCategoryId={menuInitialCat}
            onToggleFavorite={handleToggleFavorite}
            onSelectItemDetails={(it) => {
              setEditingCartLine(null);
              setSelectedProductModal(it);
            }}
            onQuickAddItem={handleQuickAddItem}
            onUpdateLineQty={handleUpdateLineQty}
            onEditCartLine={(item, line) => {
              setEditingCartLine(line);
              setSelectedProductModal(item);
            }}
            onClearCart={() => setOrderDraft((prev) => ({ ...prev, items: [] }))}
            onGoCheckout={() => {
              setConfirmedOrderState(null);
              onNavigateRoute('checkout');
            }}
          />
        )}

        {route === 'chat' && (
          <AIChatView
            restaurant={restaurant}
            hoursStatus={hoursStatus}
            deliveryZones={deliveryZones}
            items={items}
            messages={messages}
            isLoading={chatLoading}
            isOnline={isOnline}
            chatOptOut={chatOptOut}
            onToggleChatOptOut={handleToggleChatOptOut}
            pendingChallenge={pendingChallenge}
            challengeSubmitting={challengeSubmitting}
            onSubmitChallengeVerification={handleSubmitChallengeVerification}
            onCancelChallenge={() => {
              setPendingChallenge(null);
              setPendingRetryMessage(null);
            }}
            onSendMessage={handleSendMessage}
            onResetChat={handleResetChat}
            onQuickAddItem={handleQuickAddItem}
            onGoMenu={() => onNavigateRoute('menu')}
            onGoCheckout={() => {
              setConfirmedOrderState(null);
              onNavigateRoute('checkout');
            }}
          />
        )}

        {route === 'checkout' && (
          <CheckoutView
            restaurant={restaurant}
            hoursStatus={hoursStatus}
            items={items}
            deliveryZones={deliveryZones}
            branches={branches}
            activeCoupons={activeCoupons}
            draft={orderDraft}
            isOnline={isOnline}
            onUpdateDraft={setOrderDraft}
            onUpdateLineQty={handleUpdateLineQty}
            onEditCartLine={(item, line) => {
              setEditingCartLine(line);
              setSelectedProductModal(item);
            }}
            onOrderConfirmed={handleOrderConfirmed}
            confirmedOrderState={confirmedOrderState}
            onStartNewOrder={() => {
              setConfirmedOrderState(null);
              onNavigateRoute('menu');
            }}
            onGoMenu={() => onNavigateRoute('menu')}
            onTrackOrder={(ordNum, ordTok) => onNavigateRoute('track', ordNum, ordTok)}
          />
        )}

        {route === 'track' && (
          <OrderTrackingView
            restaurant={restaurant}
            initialOrderNumber={resolvedTrackOrderNumber}
            initialOrderToken={resolvedTrackOrderToken}
          />
        )}

        {(route === 'orders' || route === 'favorites') && (
          <OrderHistoryAndFavoritesView
            mode={route}
            restaurant={restaurant}
            items={items}
            favoriteIds={favoriteIds}
            localOrderHistory={localOrderHistory}
            orderTokens={orderTokens}
            onToggleFavorite={handleToggleFavorite}
            onSelectItemDetails={(it) => {
              setEditingCartLine(null);
              setSelectedProductModal(it);
            }}
            onTrackOrder={(ordNum, ordTok) => onNavigateRoute('track', ordNum, ordTok)}
            onReorder={handleReorder}
            onGoMenu={() => onNavigateRoute('menu')}
          />
        )}
      </main>

      <footer className="bg-[#104B34] text-white/85 py-6 px-4 sm:px-6 text-xs border-t border-white/10">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-bold">
            © {new Date().getFullYear()} {restaurant.name} — مدعوم بنظام موظف المطعم الذكي
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => onNavigateRoute('menu')}
              className="hover:text-white cursor-pointer"
            >
              قائمة الطعام
            </button>
            <button
              type="button"
              onClick={() => onNavigateRoute('track')}
              className="hover:text-white cursor-pointer"
            >
              تتبع الطلب
            </button>
            <button
              type="button"
              onClick={() => onNavigateRoute('about')}
              className="hover:text-white cursor-pointer"
            >
              عن المطعم
            </button>
            <button
              type="button"
              onClick={() => onNavigateRoute('privacy')}
              className="hover:text-white cursor-pointer"
            >
              سياسة الخصوصية
            </button>
            <button
              type="button"
              onClick={() => onNavigateRoute('terms')}
              className="hover:text-white cursor-pointer"
            >
              شروط الاستخدام
            </button>
            <button
              type="button"
              onClick={onNavigateAdmin}
              className="hover:text-white cursor-pointer"
            >
              لوحة تحكم المدير
            </button>
          </div>
        </div>
      </footer>

      {selectedProductModal && (
        <ProductDetailsModal
          item={selectedProductModal}
          currencyLabel={restaurant.systemSettings.currencyLabel}
          editingLine={editingCartLine}
          onClose={() => {
            setSelectedProductModal(null);
            setEditingCartLine(null);
          }}
          onAddConfiguredItem={handleAddConfiguredItem}
          onSaveEditedLine={handleSaveEditedLine}
        />
      )}

      {shareModalOpen && (
        <ShareMenuModal
          restaurantName={restaurant.name}
          onClose={() => setShareModalOpen(false)}
        />
      )}
    </div>
  );
}
