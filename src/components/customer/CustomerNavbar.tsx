import {
  Bot,
  Download,
  Heart,
  History,
  Lock,
  Menu,
  Moon,
  PackageSearch,
  QrCode,
  ShoppingBag,
  Store,
  Sun,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { RestaurantHoursStatus } from '../../lib/hours.ts';
import { resolveAssetUrl } from '../../lib/imageAssets.ts';
import type { Restaurant } from '../../types/restaurant.ts';

export type CustomerRoute =
  | 'home'
  | 'menu'
  | 'chat'
  | 'checkout'
  | 'track'
  | 'orders'
  | 'favorites'
  | 'about'
  | 'privacy'
  | 'terms';

interface CustomerNavbarProps {
  restaurant: Restaurant;
  hoursStatus: RestaurantHoursStatus;
  activeRoute: CustomerRoute;
  cartCount: number;
  favoritesCount: number;
  isDark: boolean;
  canShowInstall?: boolean;
  onToggleDark: () => void;
  onOpenShareQr: () => void;
  onInstallApp?: () => void;
  onNavigate: (route: CustomerRoute) => void;
  onNavigateAdmin: () => void;
}

export function CustomerNavbar({
  restaurant,
  hoursStatus,
  activeRoute,
  cartCount,
  favoritesCount,
  isDark,
  canShowInstall,
  onToggleDark,
  onOpenShareQr,
  onInstallApp,
  onNavigate,
  onNavigateAdmin,
}: CustomerNavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  const logoSrc = resolveAssetUrl(restaurant.logoUrl);

  const navLinks: Array<{ id: CustomerRoute; label: string }> = [
    { id: 'home', label: 'الرئيسية' },
    { id: 'menu', label: 'القائمة' },
    { id: 'chat', label: 'المساعد الذكي' },
    { id: 'track', label: 'تتبع الطلب' },
    { id: 'orders', label: 'طلباتي' },
    { id: 'about', label: 'عن المطعم' },
  ];

  const handleNavClick = (id: CustomerRoute) => {
    setMobileMenuOpen(false);
    onNavigate(id);
  };

  return (
    <header className="bg-white/95 dark:bg-[#101A15]/95 backdrop-blur-sm border-b border-[#176B45]/10 dark:border-[#2A3F35] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-3">
        {/* Brand Logo (Right side in RTL) */}
        <button
          type="button"
          onClick={() => handleNavClick('home')}
          className="flex items-center gap-3 min-w-0 text-right cursor-pointer group shrink-0"
        >
          <div className="w-11 h-11 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] border border-[#176B45]/15 dark:border-[#2A3F35] overflow-hidden shrink-0 flex items-center justify-center">
            {logoSrc && !logoBroken ? (
              <img
                src={logoSrc}
                alt={restaurant.name}
                referrerPolicy="no-referrer"
                onError={() => setLogoBroken(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <Store className="w-5 h-5 text-[#176B45]" />
            )}
          </div>
          <div className="min-w-0">
            <span className="block text-base sm:text-lg font-extrabold text-[#104B34] dark:text-[#ECF3EF] truncate group-hover:text-[#176B45] transition-colors">
              {restaurant.name}
            </span>
            <span className="block text-[11px] font-semibold text-[#5C6B63] dark:text-[#A3B8AE] truncate">
              موظف المطعم الذكي
            </span>
          </div>
        </button>

        {/* Center Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = activeRoute === link.id;
            return (
              <button
                key={link.id}
                type="button"
                onClick={() => handleNavClick(link.id)}
                className={`px-3 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#176B45]/10 text-[#176B45] dark:bg-[#176B45]/25 dark:text-[#4ADE80]'
                    : 'text-[#2D3B34] dark:text-[#D1DFD8] hover:text-[#176B45] hover:bg-[#F7F3E9] dark:hover:bg-[#192822]'
                }`}
              >
                {link.label}
              </button>
            );
          })}
        </nav>

        {/* Left Action Cluster */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Open/Closed Status Pill */}
          <div
            className={`hidden xl:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap ${
              hoursStatus.isOpen
                ? 'bg-[#F0FDF4] dark:bg-[#0D2A1A] border-[#176B45]/20 text-[#15803D] dark:text-[#4ADE80]'
                : 'bg-[#FEF2F2] dark:bg-[#2B1215] border-[#B91C1C]/20 text-[#B91C1C] dark:text-[#F87171]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                hoursStatus.isOpen ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
              }`}
            />
            <span>{hoursStatus.isOpen ? 'مفتوح الآن' : 'مغلق الآن'}</span>
          </div>

          {/* Install PWA button when eligible */}
          {canShowInstall && onInstallApp && (
            <button
              type="button"
              onClick={onInstallApp}
              title="تثبيت التطبيق"
              aria-label="تثبيت التطبيق"
              className="hidden sm:inline-flex h-10 px-3 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] border border-[#176B45]/20 text-[#104B34] dark:text-[#4ADE80] text-xs font-bold items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">تثبيت التطبيق</span>
            </button>
          )}

          {/* QR Share Button */}
          <button
            type="button"
            onClick={onOpenShareQr}
            title="مشاركة المنيو ورمز QR"
            aria-label="مشاركة المنيو ورمز QR"
            className="w-10 h-10 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] border border-[#176B45]/15 dark:border-[#2A3F35] hover:bg-[#EFE9DC] flex items-center justify-center cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
          </button>

          {/* Night Mode Toggle */}
          <button
            type="button"
            onClick={onToggleDark}
            title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
            aria-label={isDark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
            className="w-10 h-10 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#FBBF24] border border-[#176B45]/15 dark:border-[#2A3F35] hover:bg-[#EFE9DC] flex items-center justify-center cursor-pointer"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Favorites Button */}
          <button
            type="button"
            onClick={() => handleNavClick('favorites')}
            title="الأطباق المفضلة"
            aria-label="الأطباق المفضلة"
            className={`relative w-10 h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
              activeRoute === 'favorites'
                ? 'bg-[#176B45] text-white border-[#176B45]'
                : 'bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] border-[#176B45]/15 dark:border-[#2A3F35] hover:bg-[#EFE9DC]'
            }`}
          >
            <Heart className="w-4 h-4" />
            {favoritesCount > 0 && (
              <span className="absolute -top-1.5 -left-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C5A46D] text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                {favoritesCount}
              </span>
            )}
          </button>

          {/* Cart / Checkout Button */}
          <button
            type="button"
            onClick={() => handleNavClick('checkout')}
            aria-label={`السلة (${cartCount})`}
            className={`relative h-10 px-3 rounded-xl border flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              activeRoute === 'checkout'
                ? 'bg-[#104B34] text-white border-[#104B34]'
                : 'bg-[#F7F3E9] dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] border-[#176B45]/15 dark:border-[#2A3F35] hover:bg-[#EFE9DC]'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="hidden sm:inline">السلة</span>
            {cartCount > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#176B45] text-white text-[11px] font-extrabold flex items-center justify-center tabular-nums">
                {cartCount}
              </span>
            )}
          </button>

          {/* Primary Start Order CTA */}
          <button
            type="button"
            onClick={() => handleNavClick('chat')}
            className="hidden md:inline-flex h-10 px-4 rounded-full bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-extrabold items-center gap-1.5 border border-[#C5A46D]/60 transition-colors cursor-pointer whitespace-nowrap"
          >
            <span>ابدأ الطلب</span>
          </button>

          {/* Admin Portal Link */}
          <button
            type="button"
            onClick={onNavigateAdmin}
            title="لوحة تحكم المدير"
            aria-label="لوحة تحكم المدير"
            className="hidden sm:inline-flex h-10 px-3 rounded-xl border border-[#176B45]/20 dark:border-[#2A3F35] hover:bg-[#F7F3E9] dark:hover:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] text-xs font-bold items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">لوحة المدير</span>
          </button>

          {/* Mobile Drawer Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="القائمة الرئيسية"
            className="lg:hidden w-10 h-10 rounded-xl bg-[#F7F3E9] dark:bg-[#192822] border border-[#176B45]/15 dark:border-[#2A3F35] flex items-center justify-center text-[#104B34] dark:text-[#ECF3EF] cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white dark:bg-[#14201B] border-t border-[#176B45]/10 dark:border-[#2A3F35] px-4 py-3 space-y-2 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'home' as CustomerRoute, label: 'الرئيسية', Icon: Store },
              { id: 'menu' as CustomerRoute, label: 'القائمة', Icon: UtensilsCrossed },
              { id: 'chat' as CustomerRoute, label: 'المساعد الذكي', Icon: Bot },
              { id: 'track' as CustomerRoute, label: 'تتبع الطلب', Icon: PackageSearch },
              { id: 'orders' as CustomerRoute, label: 'طلباتي السابقة', Icon: History },
              { id: 'about' as CustomerRoute, label: 'عن المطعم', Icon: Store },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleNavClick(id)}
                className={`min-h-[42px] px-3 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer ${
                  activeRoute === id
                    ? 'bg-[#176B45] text-white'
                    : 'bg-[#F7F3E9] dark:bg-[#0E1713] text-[#18221D] dark:text-[#ECF3EF]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {canShowInstall && onInstallApp && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onInstallApp();
              }}
              className="w-full min-h-[42px] rounded-xl bg-[#176B45]/10 text-[#104B34] dark:text-[#4ADE80] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تثبيت التطبيق على جهازك</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onNavigateAdmin();
            }}
            className="w-full min-h-[42px] rounded-xl border border-[#176B45]/20 dark:border-[#2A3F35] text-[#104B34] dark:text-[#ECF3EF] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>دخول لوحة تحكم المدير</span>
          </button>
        </div>
      )}
    </header>
  );
}

