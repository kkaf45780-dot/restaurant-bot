import {
  Bot,
  Clock,
  Flame,
  Heart,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Sparkles,
  Store,
  Tag,
  UtensilsCrossed,
} from 'lucide-react';
import { useState } from 'react';
import type { RestaurantHoursStatus } from '../../lib/hours.ts';
import { formatTimeArabic12h } from '../../lib/hours.ts';
import { HERO_PLATTER_IMAGE_PATH, resolveAssetUrl } from '../../lib/imageAssets.ts';
import { formatCurrency } from '../../lib/pricing.ts';
import { buildWhatsAppInquiryUrl } from '../../lib/whatsapp.ts';
import type {
  Coupon,
  MenuCategory,
  MenuItem,
  Restaurant,
  RestaurantBranch,
} from '../../types/restaurant.ts';

interface HomepageViewProps {
  restaurant: Restaurant;
  hoursStatus: RestaurantHoursStatus;
  categories: MenuCategory[];
  items: MenuItem[];
  branches: RestaurantBranch[];
  activeCoupons: Coupon[];
  favoriteIds: string[];
  onToggleFavorite: (itemId: string) => void;
  onSelectItemDetails: (item: MenuItem) => void;
  onQuickAddItem: (item: MenuItem) => void;
  onNavigateChat: () => void;
  onNavigateMenuCategory: (categoryId: string) => void;
}

export function HomepageView({
  restaurant,
  hoursStatus,
  categories,
  items,
  branches,
  activeCoupons,
  favoriteIds,
  onToggleFavorite,
  onSelectItemDetails,
  onQuickAddItem,
  onNavigateChat,
  onNavigateMenuCategory,
}: HomepageViewProps) {
  const [heroImgBroken, setHeroImgBroken] = useState(false);
  const heroSrc = resolveAssetUrl(HERO_PLATTER_IMAGE_PATH);

  const popularItems = items
    .filter((i) => i.isAvailable && i.stockQuantity > 0 && (i.isPopular || i.sortOrder <= 6))
    .slice(0, 6);

  const categoryRepresentativeImage = (catId: string): string => {
    const match = items.find((i) => i.categoryId === catId && i.imageUrl);
    return resolveAssetUrl(match?.imageUrl || HERO_PLATTER_IMAGE_PATH);
  };

  const whatsappUrl = buildWhatsAppInquiryUrl(
    restaurant.whatsappNumber,
    `السلام عليكم، أستفسر عن مطعم ${restaurant.name}`
  );

  return (
    <div className="space-y-12 pb-16">
      {/* Hero Section matching Restaurant_homepage_desktop_layout */}
      <section className="bg-[#F7F3E9] dark:bg-[#0E1713] border-b border-[#176B45]/10 dark:border-[#2A3F35]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Right Column in RTL: Hero Headline & CTAs */}
          <div className="lg:col-span-6 space-y-6 text-right">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-[#14201B] border border-[#C5A46D]/40 text-xs font-bold text-[#104B34] dark:text-[#4ADE80]">
              <Sparkles className="w-3.5 h-3.5 text-[#7C5A1E] dark:text-[#C5A46D]" />
              <span>{restaurant.name} · استقبال ذكي على مدار ساعات العمل</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-extrabold text-[#104B34] dark:text-[#ECF3EF] leading-[1.22]">
              أهلاً بك!
              <span className="block mt-1">ماذا تحب أن تطلب اليوم؟</span>
            </h1>

            <p className="text-base sm:text-lg text-[#35443C] dark:text-[#A3B8AE] leading-relaxed max-w-xl">
              اكتشف طعم الأصالة مع مساعدنا الذكي الذي يسهل عليك اختيار وطلب ألذ المشويات
              والأطباق الطازجة وتوصيلها لباب بيتك.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onNavigateChat}
                className="min-h-[50px] px-8 rounded-full bg-[#104B34] hover:bg-[#176B45] text-white text-sm font-extrabold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
              >
                <Bot className="w-4 h-4" />
                <span>ابدأ الطلب</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigateMenuCategory('all')}
                className="min-h-[50px] px-8 rounded-full bg-white hover:bg-[#FAF7F0] text-[#104B34] border-2 border-[#C5A46D] text-sm font-extrabold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <UtensilsCrossed className="w-4 h-4" />
                <span>تصفح القائمة</span>
              </button>
            </div>

            {/* Active Promo Banner if any coupons exist */}
            {activeCoupons.length > 0 && (
              <div className="inline-flex flex-wrap items-center gap-2.5 bg-white/90 border border-[#C5A46D]/40 rounded-2xl px-4 py-2.5 text-xs">
                <Tag className="w-4 h-4 text-[#176B45] shrink-0" />
                <span className="font-bold text-[#18221D]">عروض اليوم:</span>
                <span className="font-extrabold text-[#176B45] bg-[#176B45]/10 px-2.5 py-0.5 rounded-lg tracking-wider">
                  {activeCoupons[0].code}
                </span>
                <span className="text-[#5C6B63]">{activeCoupons[0].description}</span>
              </div>
            )}
          </div>

          {/* Left Column in RTL: Grilled Platter on Forest Green Circular Backdrop */}
          <div className="lg:col-span-6 flex items-center justify-center">
            <div className="relative w-full max-w-[490px] aspect-[4/3] flex items-center justify-center">
              <div className="absolute w-[78%] aspect-square rounded-full bg-[#176B45] opacity-95 -translate-x-4 translate-y-2" />
              <div className="absolute w-[66%] aspect-square rounded-full border-2 border-[#C5A46D]/40 translate-x-6 -translate-y-4" />
              <div className="relative z-10 w-[88%] h-[84%] rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-[#104B34]">
                {heroSrc && !heroImgBroken ? (
                  <img
                    src={heroSrc}
                    alt={`صينية ${restaurant.name}`}
                    decoding="async"
                    onError={() => setHeroImgBroken(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-white gap-2">
                    <Flame className="w-12 h-12 text-[#C5A46D]" />
                    <span className="font-extrabold text-lg">{restaurant.name}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Browse by Category Strip matching reference */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
              أشهر الوجبات وتصفح الفئات
            </h2>
            <p className="text-sm text-[#5C6B63] dark:text-[#A3B8AE] mt-1">
              اختر القسم المفضل لديك للانتقال مباشرة إلى أطباقنا الطازجة
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateMenuCategory('all')}
            className="text-sm font-bold text-[#176B45] dark:text-[#4ADE80] hover:underline cursor-pointer shrink-0"
          >
            عرض القائمة كاملة ←
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {categories.map((cat) => {
            const thumb = categoryRepresentativeImage(cat.id);
            const count = items.filter((i) => i.categoryId === cat.id && i.isAvailable).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onNavigateMenuCategory(cat.id)}
                className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] hover:border-[#176B45]/40 p-4 flex items-center justify-between gap-3 text-right shadow-xs hover:shadow-md transition-all cursor-pointer group"
              >
                <div className="min-w-0">
                  <p className="font-extrabold text-sm text-[#18221D] dark:text-[#ECF3EF] group-hover:text-[#176B45] truncate">
                    {cat.name}
                  </p>
                  <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE] mt-0.5 tabular-nums">
                    {count} أصناف
                  </p>
                </div>
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-[#F7F3E9] dark:border-[#2A3F35] shrink-0 bg-[#F7F3E9]">
                  <img
                    src={thumb}
                    alt={cat.name}
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Popular Dishes Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
              الأطباق الأكثر طلباً
            </h2>
            <p className="text-sm text-[#5C6B63] dark:text-[#A3B8AE] mt-1">
              اختيارات عملائنا المفضلة المشوية على الفحم يومياً
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {popularItems.map((item) => {
            const isFav = favoriteIds.includes(item.id);
            const imgSrc = resolveAssetUrl(item.imageUrl);
            return (
              <div
                key={item.id}
                className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div
                    onClick={() => onSelectItemDetails(item)}
                    className="relative h-48 bg-[#F7F3E9] cursor-pointer overflow-hidden group"
                  >
                    <img
                      src={imgSrc}
                      alt={item.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <span className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-[#176B45] text-white text-[11px] font-bold">
                      متوفر
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(item.id);
                      }}
                      aria-label="إضافة للمفضلة"
                      className={`absolute top-3 left-3 w-9 h-9 rounded-full flex items-center justify-center shadow-sm transition-colors cursor-pointer ${
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
                        className="font-extrabold text-base text-[#18221D] dark:text-[#ECF3EF] cursor-pointer hover:text-[#176B45]"
                      >
                        {item.name}
                      </h3>
                      <span className="font-extrabold text-sm text-[#176B45] dark:text-[#4ADE80] tabular-nums shrink-0">
                        {formatCurrency(item.price, restaurant.systemSettings.currencyLabel)}
                      </span>
                    </div>
                    <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE] leading-relaxed line-clamp-2">
                      {item.description}
                    </p>
                  </div>
                </div>

                <div className="px-4 pb-4 pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onQuickAddItem(item)}
                    className="flex-1 min-h-[42px] px-4 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة للطلب</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectItemDetails(item)}
                    className="min-h-[42px] px-3.5 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] hover:bg-[#EFE9DC] text-[#104B34] dark:text-[#ECF3EF] text-xs font-bold cursor-pointer"
                  >
                    تخصيص
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Branches, Working Hours & Direct Contact */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="bg-white dark:bg-[#14201B] rounded-3xl border border-[#176B45]/10 dark:border-[#2A3F35] p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[#104B34] font-extrabold text-lg">
              <Clock className="w-5 h-5 text-[#176B45]" />
              <span>مواعيد العمل</span>
            </div>
            <p className="text-xs font-bold text-[#176B45]">
              الحالة الآن: {hoursStatus.statusLabel} ({hoursStatus.todayHoursText})
            </p>
            <div className="space-y-1.5 text-xs text-[#35443C]">
              {restaurant.weeklySchedule.map((d) => (
                <div key={d.day} className="flex justify-between border-b border-[#F3F4F2] pb-1">
                  <span className="font-bold">{d.labelAr}</span>
                  <span className="tabular-nums text-[#5C6B63]">
                    {d.isClosed
                      ? 'مغلق'
                      : `${formatTimeArabic12h(d.openTime)} - ${formatTimeArabic12h(d.closeTime)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[#104B34] font-extrabold text-lg">
              <Store className="w-5 h-5 text-[#176B45]" />
              <span>فروعنا</span>
            </div>
            <div className="space-y-2.5">
              {branches.map((br) => (
                <div
                  key={br.id}
                  className="p-3 rounded-xl bg-[#F7F3E9]/70 border border-[#176B45]/10 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-[#18221D]">{br.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        br.isOpen
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-neutral-200 text-neutral-700'
                      }`}
                    >
                      {br.isOpen ? 'مفتوح' : 'مغلق'}
                    </span>
                  </div>
                  <p className="text-[#5C6B63] flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-[#176B45] shrink-0" />
                    <span>{br.address}</span>
                  </p>
                  <p className="text-[#5C6B63] tabular-nums">{br.hoursText}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[#104B34] font-extrabold text-lg">
              <Phone className="w-5 h-5 text-[#176B45]" />
              <span>تواصل معنا</span>
            </div>
            <p className="text-sm text-[#5C6B63] leading-relaxed">{restaurant.description}</p>
            <div className="space-y-2.5 pt-1">
              <a
                href={`tel:${restaurant.phone}`}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[#F7F3E9] hover:bg-[#EFE9DC] text-[#104B34] text-sm font-bold flex items-center justify-between transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <span>اتصال مباشر بالمطعم</span>
                </span>
                <span dir="ltr" className="tabular-nums">
                  {restaurant.phone}
                </span>
              </a>
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#15803D] hover:bg-[#104B34] text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>تواصل عبر واتساب</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
