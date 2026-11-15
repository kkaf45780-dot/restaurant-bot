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
import { fetchRestaurantBundle, sendChatMessage } from '../lib/api.ts';
import type { RestaurantHoursStatus } from '../lib/hours.ts';
import { buildDraftLineKey } from '../lib/pricing.ts';
import type {
  ChatMessage,
  MenuItem,
  Order,
  OrderDraft,
  OrderDraftItem,
  RestaurantBundle,
} from '../types/restaurant.ts';

interface CustomerPageProps {
  route: CustomerRoute;
  initialTrackOrderNumber?: string;
  onNavigateRoute: (route: CustomerRoute, trackOrder?: string) => void;
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
const CACHED_BUNDLE_KEY = 'moazzaf_cached_bundle_v1';

export function CustomerPage({
  route,
  initialTrackOrderNumber,
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [orderDraft, setOrderDraft] = useState<OrderDraft>(EMPTY_DRAFT);
  const [confirmedOrderState, setConfirmedOrderState] = useState<{
    order: Order;
    whatsappUrl: string;
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
    const savedChat = sessionStorage.getItem(`chat_${restId}`);
    const savedDraft = localStorage.getItem(`draft_${restId}`);

    if (savedChat) {
      try {
        const parsed = JSON.parse(savedChat) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
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
      } catch {
        setMessages([
          {
            id: 'welcome_1',
            role: 'assistant',
            text: loadedBundle.restaurant.aiSettings.welcomeMessage,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
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

    if (savedDraft) {
      try {
        setOrderDraft({ ...EMPTY_DRAFT, ...(JSON.parse(savedDraft) as OrderDraft) });
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
    try {
      sessionStorage.setItem(`chat_${bundle.restaurant.id}`, JSON.stringify(messages));
    } catch {
      // Ignore
    }
  }, [bundle, messages]);

  useEffect(() => {
    if (!bundle) return;
    try {
      localStorage.setItem(`draft_${bundle.restaurant.id}`, JSON.stringify(orderDraft));
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
    if (!item.isAvailable || item.stockQuantity <= 0) return;
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
      if (!catalogItem || !catalogItem.isAvailable || catalogItem.stockQuantity <= 0) {
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
      const res = await sendChatMessage({
        restaurantId: bundle.restaurant.id,
        message: text,
        history: nextHistory.map((m) => ({ role: m.role, text: m.text })),
        orderDraft,
      });

      setOrderDraft(res.updatedDraft);
      const assistantMsg: ChatMessage = {
        id: `ast_${Date.now()}`,
        role: 'assistant',
        text: res.reply,
        timestamp: new Date().toISOString(),
        suggestedAction: res.suggestedAction,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
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
    } finally {
      setChatLoading(false);
    }
  };

  const handleResetChat = () => {
    if (!bundle) return;
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        role: 'assistant',
        text: bundle.restaurant.aiSettings.welcomeMessage,
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  const handleOrderConfirmed = (order: Order, whatsappUrl: string) => {
    setConfirmedOrderState({ order, whatsappUrl });
    setOrderDraft(EMPTY_DRAFT);
    const nextHistory = [order, ...localOrderHistory].slice(0, 20);
    setLocalOrderHistory(nextHistory);
    try {
      localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(nextHistory));
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
      <div className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] flex items-center justify-center p-6">
        <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-8 text-center max-w-sm w-full space-y-3">
          <div className="w-10 h-10 rounded-xl bg-[#176B45]/10 text-[#176B45] flex items-center justify-center mx-auto font-bold">
            م
          </div>
          <p className="text-base font-bold text-[#18221D] dark:text-[#ECF3EF]">
            جاري تحميل بيانات المطعم...
          </p>
          <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
            لحظات وتكون القائمة والموظف الذكي جاهزين.
          </p>
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

  return (
    <div className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] text-[#18221D] dark:text-[#ECF3EF] flex flex-col">
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
          if (nextRoute === 'checkout') {
            setConfirmedOrderState(null);
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
        <div className="fixed bottom-5 left-5 z-50 bg-[#104B34] text-white px-5 py-3 rounded-2xl shadow-lg text-xs font-extrabold border border-[#C5A46D]/40">
          {toastText}
        </div>
      )}

      <main className="flex-1">
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
            onTrackOrder={(ordNum) => onNavigateRoute('track', ordNum)}
          />
        )}

        {route === 'track' && (
          <OrderTrackingView
            restaurant={restaurant}
            initialOrderNumber={initialTrackOrderNumber || localOrderHistory[0]?.orderNumber || '1024'}
          />
        )}

        {(route === 'orders' || route === 'favorites') && (
          <OrderHistoryAndFavoritesView
            mode={route}
            restaurant={restaurant}
            items={items}
            favoriteIds={favoriteIds}
            localOrderHistory={localOrderHistory}
            onToggleFavorite={handleToggleFavorite}
            onSelectItemDetails={(it) => {
              setEditingCartLine(null);
              setSelectedProductModal(it);
            }}
            onTrackOrder={(ordNum) => onNavigateRoute('track', ordNum)}
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

