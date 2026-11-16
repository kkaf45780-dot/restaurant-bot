import {
  Heart,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { resolveAssetUrl } from '../../lib/imageAssets.ts';
import { buildDraftLineKey, calculateOrderTotals, formatCurrency } from '../../lib/pricing.ts';
import type {
  Coupon,
  DeliveryZone,
  MenuCategory,
  MenuItem,
  OrderDraft,
} from '../../types/restaurant.ts';

interface MenuCatalogViewProps {
  categories: MenuCategory[];
  items: MenuItem[];
  deliveryZones: DeliveryZone[];
  activeCoupons: Coupon[];
  currencyLabel: string;
  draft: OrderDraft;
  favoriteIds: string[];
  initialCategoryId?: string;
  onToggleFavorite: (itemId: string) => void;
  onSelectItemDetails: (item: MenuItem) => void;
  onQuickAddItem: (item: MenuItem) => void;
  onUpdateLineQty: (lineKey: string, nextQty: number) => void;
  onEditCartLine?: (item: MenuItem, line: OrderDraft['items'][number]) => void;
  onClearCart: () => void;
  onGoCheckout: () => void;
}

export function MenuCatalogView({
  categories,
  items,
  deliveryZones,
  activeCoupons,
  currencyLabel,
  draft,
  favoriteIds,
  initialCategoryId = 'all',
  onToggleFavorite,
  onSelectItemDetails,
  onQuickAddItem,
  onUpdateLineQty,
  onEditCartLine,
  onClearCart,
  onGoCheckout,
}: MenuCatalogViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategoryId);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const isItemAvailable = (item: MenuItem) =>
    item.isAvailable && (typeof item.stockQuantity !== 'number' || item.stockQuantity > 0);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) return false;
      if (onlyAvailable && !isItemAvailable(item)) return false;
      if (q) {
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, selectedCategory, searchQuery, onlyAvailable]);

  const totals = useMemo(
    () =>
      calculateOrderTotals(draft.items, items, draft.deliveryZoneId, deliveryZones, {
        fulfillmentType: draft.fulfillmentType,
        couponCode: draft.couponCode,
        coupons: activeCoupons,
      }),
    [draft, items, deliveryZones, activeCoupons]
  );

  return (
    <div
      className={`max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6 ${
        totals.validItems.length > 0 ? 'pb-24 lg:pb-8' : 'pb-8'
      }`}
    >
      {/* Search + Category Filter Strip matching Food_menu_website_layout */}
      <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-4 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-between">
          <div className="relative flex-1 max-w-lg">
            <Search className="w-4 h-4 text-[#5C6B63] dark:text-[#A3B8AE] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="ابحث عن صنف في القائمة"
              placeholder="ابحث عن صنف... (مثال: كباب، حواوشي، أم علي)"
              className="w-full h-11 pr-10 pl-4 rounded-xl bg-[#F7F3E9] dark:bg-[#0E1713] border border-[#176B45]/15 dark:border-[#2A3F35] text-sm text-[#18221D] dark:text-[#ECF3EF] placeholder:text-[#4A5850] dark:placeholder:text-[#A3B8AE] focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
            />
          </div>

          <button
            type="button"
            onClick={() => setOnlyAvailable((v) => !v)}
            className={`h-11 px-4 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              onlyAvailable
                ? 'bg-[#176B45] text-white border-[#176B45]'
                : 'bg-[#F7F3E9] dark:bg-[#0E1713] text-[#104B34] dark:text-[#ECF3EF] border-[#176B45]/15 dark:border-[#2A3F35]'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>المتوفر الآن فقط</span>
          </button>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`min-h-[40px] px-5 rounded-full text-xs sm:text-sm font-extrabold whitespace-nowrap transition-colors cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-[#176B45] text-white'
                : 'bg-[#F7F3E9] dark:bg-[#0E1713] text-[#2D3B34] dark:text-[#D1DFD8] hover:bg-[#EFE9DC] dark:hover:bg-[#192822]'
            }`}
          >
            الكل ({items.length})
          </button>
          {categories.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`min-h-[40px] px-5 rounded-full text-xs sm:text-sm font-extrabold whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#176B45] text-white'
                    : 'bg-[#F7F3E9] dark:bg-[#0E1713] text-[#2D3B34] dark:text-[#D1DFD8] hover:bg-[#EFE9DC] dark:hover:bg-[#192822]'
                }`}
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Layout: 3-column Product Grid + Left Sticky Current Order Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Product Grid */}
        <div className="lg:col-span-8 xl:col-span-9">
          {filteredItems.length === 0 ? (
            <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-12 text-center space-y-2">
              <UtensilsCrossed className="w-10 h-10 text-[#176B45]/30 dark:text-[#4ADE80]/30 mx-auto" />
              <p className="font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
                لا توجد أصناف مطابقة لبحثك
              </p>
              <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
                جرّب كتابة كلمة أخرى أو اختيار قسم "الكل".
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                const available = isItemAvailable(item);
                const isFav = favoriteIds.includes(item.id);
                const imgSrc = resolveAssetUrl(item.imageUrl);
                const inCartQty = draft.items
                  .filter((d) => d.itemId === item.id)
                  .reduce((sum, d) => sum + d.quantity, 0);

                return (
                  <div
                    key={item.id}
                    className={`bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] overflow-hidden shadow-xs flex flex-col justify-between transition-shadow hover:shadow-md ${
                      !available ? 'opacity-70' : ''
                    }`}
                  >
                    <div>
                      <div
                        onClick={() => onSelectItemDetails(item)}
                        className="relative h-44 bg-[#F7F3E9] dark:bg-[#0E1713] cursor-pointer overflow-hidden group"
                      >
                        <img
                          src={imgSrc}
                          alt={item.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <span
                          className={`absolute bottom-2.5 right-2.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            available
                              ? 'bg-[#176B45] text-white'
                              : 'bg-neutral-700 text-white'
                          }`}
                        >
                          {available ? 'متوفر' : 'غير متوفر'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(item.id);
                          }}
                          aria-label="المفضلة"
                          className={`absolute top-2.5 left-2.5 w-8 h-8 rounded-full flex items-center justify-center shadow-sm cursor-pointer ${
                            isFav
                              ? 'bg-rose-500 text-white'
                              : 'bg-white/90 text-[#5C6B63] hover:text-rose-500'
                          }`}
                        >
                          <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                        </button>
                      </div>

                      <div className="p-4 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <h3
                            onClick={() => onSelectItemDetails(item)}
                            className="font-extrabold text-sm text-[#18221D] dark:text-[#ECF3EF] cursor-pointer hover:text-[#176B45]"
                          >
                            {item.name}
                          </h3>
                          <span className="font-extrabold text-sm text-[#176B45] dark:text-[#4ADE80] tabular-nums shrink-0">
                            {formatCurrency(item.price, currencyLabel)}
                          </span>
                        </div>
                        <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE] leading-relaxed line-clamp-2">
                          {item.description}
                        </p>
                        {(item.sizes.length > 1 || item.extras.length > 0) && (
                          <p className="text-[11px] font-semibold text-[#7C5A1E] dark:text-[#E7C98F]">
                            يتوفر أحجام وإضافات اختيارية
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="px-4 pb-4 pt-1 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!available}
                        onClick={() => onQuickAddItem(item)}
                        className="flex-1 min-h-[40px] px-3 rounded-xl bg-[#104B34] hover:bg-[#176B45] disabled:bg-neutral-300 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>{inCartQty > 0 ? `أضف آخر (${inCartQty})` : 'إضافة للطلب'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectItemDetails(item)}
                        title="تخصيص الحجم والإضافات"
                        aria-label="تخصيص الصنف"
                        className="w-10 h-10 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] hover:bg-[#EFE9DC] dark:hover:bg-[#22352D] border border-[#176B45]/15 dark:border-[#2A3F35] text-[#104B34] dark:text-[#ECF3EF] flex items-center justify-center cursor-pointer shrink-0"
                      >
                        <SlidersHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky Current Order Sidebar matching Food_menu_website_layout */}
        <aside className="lg:col-span-4 xl:col-span-3 lg:sticky lg:top-24">
          <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/15 dark:border-[#2A3F35] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#176B45]/10 dark:border-[#2A3F35] pb-3">
              <div>
                <h2 className="text-base font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
                  الطلب الحالي
                </h2>
                <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
                  {draft.fulfillmentType === 'pickup' ? 'استلام من الفرع' : 'توصيل للمنزل'}
                </p>
              </div>
              <ShoppingBag className="w-5 h-5 text-[#176B45]" />
            </div>

            {totals.validItems.length === 0 ? (
              <div className="py-8 text-center space-y-2 text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
                <p className="font-bold text-[#18221D] dark:text-[#ECF3EF]">سلتك فارغة حالياً</p>
                <p>أضف أطباقاً من القائمة للبدء في طلبك.</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 max-h-[340px] overflow-y-auto pl-1">
                  {totals.validItems.map((line) => {
                    const key = line.lineKey || buildDraftLineKey(line);
                    const catalogItem = items.find((i) => i.id === line.itemId);
                    return (
                      <div
                        key={key}
                        className="pb-2.5 border-b border-[#F3F4F2] dark:border-[#2A3F35] last:border-b-0 space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
                              {line.quantity} × {line.name}
                            </p>
                            {line.selectedSizeLabel && (
                              <p className="text-[11px] text-[#5C6B63] dark:text-[#A3B8AE]">
                                الحجم: {line.selectedSizeLabel}
                              </p>
                            )}
                            {line.selectedExtras && line.selectedExtras.length > 0 && (
                              <p className="text-[11px] text-[#5C6B63] dark:text-[#A3B8AE]">
                                + {line.selectedExtras.map((e) => e.label).join('، ')}
                              </p>
                            )}
                          </div>
                          <span className="font-extrabold text-[#104B34] dark:text-[#4ADE80] tabular-nums shrink-0">
                            {formatCurrency(line.lineTotal, currencyLabel)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onUpdateLineQty(key, line.quantity - 1)}
                              aria-label="تقليل الكمية"
                              className="w-7 h-7 rounded-lg bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] flex items-center justify-center hover:bg-[#EFE9DC] cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center text-xs font-bold tabular-nums dark:text-[#ECF3EF]">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => onUpdateLineQty(key, line.quantity + 1)}
                              aria-label="زيادة الكمية"
                              className="w-7 h-7 rounded-lg bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] flex items-center justify-center hover:bg-[#EFE9DC] cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            {catalogItem && onEditCartLine && (
                              <button
                                type="button"
                                onClick={() => onEditCartLine(catalogItem, { ...line, lineKey: key })}
                                className="text-[11px] font-bold text-[#176B45] dark:text-[#4ADE80] hover:underline cursor-pointer"
                              >
                                تعديل
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onUpdateLineQty(key, 0)}
                              aria-label="حذف"
                              className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-[#176B45]/10 dark:border-[#2A3F35] pt-3 space-y-2 text-xs">
                  <div className="flex justify-between text-[#5C6B63] dark:text-[#A3B8AE]">
                    <span>المجموع الفرعي</span>
                    <span className="font-bold text-[#18221D] dark:text-[#ECF3EF] tabular-nums">
                      {formatCurrency(totals.subtotal, currencyLabel)}
                    </span>
                  </div>
                  {totals.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-bold">
                      <span>الخصم</span>
                      <span className="tabular-nums">
                        -{formatCurrency(totals.discountAmount, currencyLabel)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-extrabold text-[#104B34] dark:text-[#ECF3EF] pt-1">
                    <span>الإجمالي التقديري</span>
                    <span className="tabular-nums dark:text-[#4ADE80]">
                      {formatCurrency(totals.total, currencyLabel)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={onGoCheckout}
                    className="w-full min-h-[44px] rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-sm font-extrabold cursor-pointer transition-colors"
                  >
                    إتمام الطلب والدفع
                  </button>
                  <button
                    type="button"
                    onClick={onClearCart}
                    className="w-full min-h-[40px] rounded-xl border border-[#176B45]/20 dark:border-[#2A3F35] hover:bg-[#F7F3E9] dark:hover:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] text-xs font-bold cursor-pointer transition-colors"
                  >
                    إفراغ السلة
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Sticky Mobile Cart Bar */}
      {totals.validItems.length > 0 && (
        <div className="lg:hidden fixed bottom-3 inset-x-3 z-30">
          <div className="bg-[#104B34] dark:bg-[#14201B] text-white rounded-2xl border border-[#C5A46D]/40 shadow-xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-4 h-4 text-[#C5A46D]" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-white/80 font-bold">
                  {totals.validItems.reduce((sum, l) => sum + l.quantity, 0)} أصناف في السلة
                </p>
                <p className="text-sm font-extrabold tabular-nums truncate">
                  {formatCurrency(totals.total, currencyLabel)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onGoCheckout}
              className="min-h-[42px] px-4 rounded-xl bg-[#C5A46D] hover:bg-[#b5935b] text-[#104B34] text-xs font-extrabold whitespace-nowrap cursor-pointer shrink-0"
            >
              عرض السلة وإتمام الطلب
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
