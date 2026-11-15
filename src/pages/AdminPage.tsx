import {
  BarChart3,
  Bell,
  Bot,
  Check,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Settings,
  ShoppingBag,
  Sliders,
  Tag,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminLogin } from '../components/admin/AdminLogin.tsx';
import {
  AISettingsSection,
  SystemSettingsSection,
} from '../components/admin/AISystemManager.tsx';
import {
  AnalyticsSection,
  CouponsSection,
  EmployeesAndLogsSection,
  InventorySection,
} from '../components/admin/GrowthAndOpsManager.tsx';
import { MenuManager } from '../components/admin/MenuManager.tsx';
import {
  DeliveryAndBranchesSection,
  RestaurantSettingsSection,
} from '../components/admin/OperationsManager.tsx';
import {
  OrdersSection,
  OverviewSection,
} from '../components/admin/OrdersAndOverview.tsx';
import {
  adminAdjustStock,
  adminDeleteBranch,
  adminDeleteCategory,
  adminDeleteCoupon,
  adminDeleteDeliveryZone,
  adminDeleteEmployee,
  adminDeleteMenuItem,
  adminDownloadOrdersCsv,
  adminMarkNotificationsRead,
  adminReorderItems,
  adminUpdateOrderStatus,
  adminUpdateRestaurant,
  adminUploadImage,
  adminUpsertBranch,
  adminUpsertCategory,
  adminUpsertCoupon,
  adminUpsertDeliveryZone,
  adminUpsertEmployee,
  adminUpsertMenuItem,
  fetchAdminMe,
  fetchAdminOverview,
  fetchConfigStatus,
  getStoredAdminToken,
  setStoredAdminToken,
} from '../lib/api.ts';
import type { RestaurantHoursStatus } from '../lib/hours.ts';
import { resolveAssetUrl } from '../lib/imageAssets.ts';
import { hasPermission, ROLE_LABELS_AR } from '../lib/permissions.ts';
import { supabase } from '../lib/supabase.ts';
import type {
  ActivityLog,
  AdminNotification,
  AILogEntry,
  Coupon,
  DeliveryZone,
  Employee,
  EmployeeRole,
  InventoryMovement,
  ManualRestaurantStatus,
  MenuCategory,
  MenuItem,
  Order,
  OrderStatus,
  Restaurant,
  RestaurantBranch,
  RestaurantBundle,
  ServiceConfigStatus,
} from '../types/restaurant.ts';

type AdminTab =
  | 'overview'
  | 'orders'
  | 'menu'
  | 'delivery'
  | 'inventory'
  | 'coupons'
  | 'analytics'
  | 'employees'
  | 'settings'
  | 'ai'
  | 'system';

interface AdminPageProps {
  onNavigateCustomer: () => void;
}

export function AdminPage({ onNavigateCustomer }: AdminPageProps) {
  const [token, setToken] = useState<string | null>(() => getStoredAdminToken());
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [adminEmail, setAdminEmail] = useState('admin@hara-grill.eg');
  const [adminRole, setAdminRole] = useState<EmployeeRole>('owner');
  const [demoAdminEmail, setDemoAdminEmail] = useState('admin@hara-grill.eg');

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const [bundle, setBundle] = useState<RestaurantBundle | null>(null);
  const [hoursStatus, setHoursStatus] = useState<RestaurantHoursStatus | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [aiLogs, setAiLogs] = useState<AILogEntry[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [configStatus, setConfigStatus] = useState<ServiceConfigStatus | null>(null);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const notify = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  const loadOverview = useCallback(
    async (activeToken: string) => {
      try {
        const data = await fetchAdminOverview(activeToken);
        setBundle(data.bundle);
        setHoursStatus(data.hoursStatus);
        setOrders(data.orders);
        setAiLogs(data.aiLogs);
        setCoupons(data.coupons);
        setInventoryMovements(data.inventoryMovements);
        setEmployees(data.employees);
        setActivityLogs(data.activityLogs);
        setNotifications(data.notifications);
        setConfigStatus(data.configStatus);
        document.title = `لوحة تحكم المدير — ${data.bundle.restaurant.name}`;
      } catch (err) {
        notify(
          'error',
          err instanceof Error ? err.message : 'تعذر تحميل بيانات لوحة التحكم.'
        );
      }
    },
    [notify]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await fetchConfigStatus();
        if (mounted) setConfigStatus(cfg);
        if (mounted && cfg.demoAdminEmail) setDemoAdminEmail(cfg.demoAdminEmail);
      } catch {
        // Ignore
      }

      const stored = getStoredAdminToken();
      if (stored) {
        try {
          const me = await fetchAdminMe(stored);
          if (mounted) {
            if (me.email) setAdminEmail(me.email);
            if (me.role) setAdminRole(me.role);
            setToken(stored);
            await loadOverview(stored);
          }
        } catch {
          setStoredAdminToken(null);
          if (mounted) setToken(null);
        }
      }
      if (mounted) setCheckingAuth(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadOverview]);

  useEffect(() => {
    if (!supabase || !token) return;
    const channel = supabase
      .channel('admin-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          void loadOverview(token);
        }
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [token, loadOverview]);

  useEffect(() => {
    if (!hasPermission(adminRole, activeTab)) {
      setActiveTab('overview');
    }
  }, [adminRole, activeTab]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const pendingOrdersCount = useMemo(
    () =>
      orders.filter((o) => o.status === 'received' || o.status === 'under_review').length,
    [orders]
  );

  const handleLoginSuccess = async (newToken: string) => {
    setStoredAdminToken(newToken);
    setToken(newToken);
    try {
      const me = await fetchAdminMe(newToken);
      if (me.email) setAdminEmail(me.email);
      if (me.role) setAdminRole(me.role);
    } catch {
      setAdminRole('owner');
    }
    await loadOverview(newToken);
  };

  const handleLogout = async () => {
    setStoredAdminToken(null);
    setToken(null);
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#F7F3E9] flex items-center justify-center p-6">
        <p className="text-sm font-bold text-[#104B34]">جاري التحقق من جلسة المدير...</p>
      </div>
    );
  }

  if (!token) {
    return (
      <AdminLogin
        demoAdminEmail={demoAdminEmail}
        onSuccess={handleLoginSuccess}
        onBackToStore={onNavigateCustomer}
      />
    );
  }

  if (!bundle || !hoursStatus || !configStatus) {
    return (
      <div className="min-h-screen bg-[#F7F3E9] flex items-center justify-center p-6">
        <p className="text-sm font-bold text-[#104B34]">جاري تحميل لوحة التحكم...</p>
      </div>
    );
  }

  const restId = bundle.restaurant.id;

  const handleSaveRestaurant = async (patch: Partial<Restaurant>) => {
    try {
      await adminUpdateRestaurant(token, restId, patch);
      await loadOverview(token);
      notify('success', 'تم حفظ التعديلات بنجاح وظهرت مباشرة للعملاء.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حفظ التعديلات.');
    }
  };

  const handleQuickStatusChange = async (manualStatus: ManualRestaurantStatus) => {
    await handleSaveRestaurant({ manualStatus });
  };

  const handleSaveCategory = async (cat: Partial<MenuCategory> & { name: string }) => {
    try {
      await adminUpsertCategory(token, { ...cat, restaurantId: restId });
      await loadOverview(token);
      notify('success', 'تم حفظ القسم بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حفظ القسم.');
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    try {
      await adminDeleteCategory(token, restId, catId);
      await loadOverview(token);
      notify('success', 'تم حذف القسم والأصناف المرتبطة به.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حذف القسم.');
    }
  };

  const handleSaveItem = async (
    item: Partial<MenuItem> & { categoryId: string; name: string; price: number }
  ) => {
    try {
      await adminUpsertMenuItem(token, { ...item, restaurantId: restId });
      await loadOverview(token);
      notify('success', 'تم حفظ الصنف بنجاح وتحديث المنيو.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حفظ الصنف.');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      await adminDeleteMenuItem(token, restId, itemId);
      await loadOverview(token);
      notify('success', 'تم حذف الصنف من المنيو.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حذف الصنف.');
    }
  };

  const handleReorderItems = async (orderedIds: string[]) => {
    try {
      await adminReorderItems(token, restId, orderedIds);
      await loadOverview(token);
      notify('success', 'تم تحديث ترتيب الأصناف.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر إعادة ترتيب الأصناف.');
    }
  };

  const handleAdjustStock = async (itemId: string, delta: number, reason: string) => {
    try {
      await adminAdjustStock(token, { restaurantId: restId, itemId, delta, reason });
      await loadOverview(token);
      notify('success', 'تم تحديث رصيد المخزون وتسجيل الحركة.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر تحديث المخزون.');
    }
  };

  const handleSaveZone = async (
    zone: Partial<DeliveryZone> & { name: string; fee: number }
  ) => {
    try {
      await adminUpsertDeliveryZone(token, { ...zone, restaurantId: restId });
      await loadOverview(token);
      notify('success', 'تم حفظ منطقة التوصيل بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حفظ منطقة التوصيل.');
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    try {
      await adminDeleteDeliveryZone(token, restId, zoneId);
      await loadOverview(token);
      notify('success', 'تم حذف منطقة التوصيل.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حذف منطقة التوصيل.');
    }
  };

  const handleSaveBranch = async (branch: Partial<RestaurantBranch> & { name: string }) => {
    try {
      await adminUpsertBranch(token, { ...branch, restaurantId: restId });
      await loadOverview(token);
      notify('success', 'تم حفظ بيانات الفرع بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حفظ بيانات الفرع.');
    }
  };

  const handleDeleteBranch = async (branchId: string) => {
    try {
      await adminDeleteBranch(token, restId, branchId);
      await loadOverview(token);
      notify('success', 'تم حذف الفرع بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حذف الفرع.');
    }
  };

  const handleSaveCoupon = async (
    coupon: Partial<Coupon> & { code: string; discountValue: number }
  ) => {
    try {
      await adminUpsertCoupon(token, { ...coupon, restaurantId: restId });
      await loadOverview(token);
      notify('success', 'تم حفظ كوبون الخصم بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حفظ كوبون الخصم.');
    }
  };

  const handleDeleteCoupon = async (couponId: string) => {
    try {
      await adminDeleteCoupon(token, restId, couponId);
      await loadOverview(token);
      notify('success', 'تم حذف الكوبون بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حذف الكوبون.');
    }
  };

  const handleSaveEmployee = async (
    emp: Partial<Employee> & { name: string; email: string }
  ) => {
    try {
      await adminUpsertEmployee(token, { ...emp, restaurantId: restId });
      await loadOverview(token);
      notify('success', 'تم حفظ بيانات الموظف بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حفظ بيانات الموظف.');
    }
  };

  const handleDeleteEmployee = async (employeeId: string) => {
    try {
      await adminDeleteEmployee(token, restId, employeeId);
      await loadOverview(token);
      notify('success', 'تم حذف الموظف.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حذف الموظف.');
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: OrderStatus) => {
    try {
      await adminUpdateOrderStatus(token, restId, orderId, status);
      await loadOverview(token);
      notify('success', 'تم تحديث حالة الطلب بنجاح.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر تحديث حالة الطلب.');
    }
  };

  const handleExportCsv = async () => {
    try {
      await adminDownloadOrdersCsv(token, restId);
      notify('success', 'تم تحميل ملف الطلبات بصيغة CSV.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر تصدير ملف CSV.');
    }
  };

  const handleMarkNotificationsRead = async () => {
    try {
      await adminMarkNotificationsRead(token, restId);
      await loadOverview(token);
    } catch {
      // Ignore silent read mark failure
    }
  };

  const handleUploadImage = async (file: File): Promise<string> => {
    try {
      const res = await adminUploadImage(token, file);
      notify('success', 'تم رفع الصورة بنجاح.');
      return res.url;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر رفع الصورة.');
      throw err;
    }
  };

  const allNavItems: Array<{
    id: AdminTab;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: number;
  }> = [
    { id: 'overview', label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'orders', label: 'الطلبات', icon: ShoppingBag, badge: pendingOrdersCount },
    { id: 'menu', label: 'إدارة القائمة', icon: UtensilsCrossed },
    { id: 'delivery', label: 'التوصيل والفروع', icon: MapPin },
    { id: 'inventory', label: 'المخزون', icon: Package },
    { id: 'coupons', label: 'الكوبونات والعروض', icon: Tag },
    { id: 'analytics', label: 'التقارير والتحليلات', icon: BarChart3 },
    { id: 'employees', label: 'الموظفون والسجل', icon: Users },
    { id: 'settings', label: 'إعدادات المطعم', icon: Sliders },
    { id: 'ai', label: 'الموظف الذكي', icon: Bot },
    { id: 'system', label: 'إعدادات النظام', icon: Settings },
  ];

  const navItems = allNavItems.filter((item) => hasPermission(adminRole, item.id));

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full justify-between p-4 text-white">
      <div className="space-y-5 overflow-y-auto pl-1">
        <div className="flex items-center gap-3 px-2 pt-1">
          <img
            src={resolveAssetUrl(bundle.restaurant.logoUrl)}
            alt={bundle.restaurant.name}
            className="w-10 h-10 rounded-xl object-cover border border-white/25 shrink-0"
          />
          <div className="min-w-0">
            <p className="text-base font-extrabold tracking-tight leading-tight">موظف المطعم</p>
            <p className="text-[11px] text-white/75 truncate mt-0.5">{bundle.restaurant.name}</p>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full min-h-[42px] px-3.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  active
                    ? 'bg-white text-[#104B34] shadow-xs'
                    : 'text-white/85 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold tabular-nums ${
                      active ? 'bg-[#176B45] text-white' : 'bg-[#C5A46D] text-[#104B34]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2 pt-3 border-t border-white/15 shrink-0">
        <button
          type="button"
          onClick={onNavigateCustomer}
          className="w-full min-h-[40px] px-3.5 rounded-xl bg-white/12 hover:bg-white/20 text-xs font-bold flex items-center justify-between cursor-pointer"
        >
          <span>معاينة واجهة العميل</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleLogout}
          className="w-full min-h-[40px] px-3.5 rounded-xl text-white/80 hover:bg-white/10 text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F3F4F2] text-[#18221D] flex">
      {/* Desktop Sidebar (#104B34) */}
      <aside className="hidden lg:block w-64 bg-[#104B34] shrink-0 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-68 bg-[#104B34] h-full relative z-10">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="إغلاق القائمة"
              className="absolute top-3 left-3 w-9 h-9 rounded-lg bg-white/15 text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            {renderSidebarContent()}
          </div>
          <div className="flex-1 bg-black/45" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Greeting Header matching Restaurant_admin_dashboard_website */}
        <header className="bg-white border-b border-[#176B45]/10 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة"
              className="lg:hidden w-10 h-10 rounded-xl bg-[#F7F3E9] flex items-center justify-center cursor-pointer shrink-0"
            >
              <Menu className="w-5 h-5 text-[#104B34]" />
            </button>
            <div className="min-w-0">
              <p className="text-sm sm:text-base font-extrabold text-[#18221D] truncate">
                أهلاً بك، مدير مطعم {bundle.restaurant.name}
              </p>
              <div className="flex items-center gap-2 text-xs text-[#5C6B63]">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    hoursStatus.isOpen ? 'bg-emerald-600' : 'bg-red-600'
                  }`}
                />
                <span>{hoursStatus.statusLabel}</span>
                {hoursStatus.reasonText && (
                  <span className="text-[#5C6B63] font-semibold">· {hoursStatus.reasonText}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Quick Open/Closed Switch */}
            <select
              aria-label="تبديل حالة المطعم"
              value={bundle.restaurant.manualStatus}
              onChange={(e) =>
                handleQuickStatusChange(e.target.value as ManualRestaurantStatus)
              }
              className="hidden sm:block h-9 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-xs font-bold text-[#104B34] cursor-pointer"
            >
              <option value="auto">وضع التشغيل: تلقائي</option>
              <option value="force_open">مفتوح (تجاوز يدوي)</option>
              <option value="force_closed">مغلق مؤقتاً</option>
            </select>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="الإشعارات"
                className="w-10 h-10 rounded-xl bg-[#F7F3E9] hover:bg-[#EFE9DC] text-[#104B34] flex items-center justify-center relative cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                    {unreadNotifications}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute left-0 mt-2 w-80 bg-white rounded-2xl border border-[#176B45]/15 shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#176B45]/10 flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#18221D]">الإشعارات</span>
                    {unreadNotifications > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkNotificationsRead}
                        className="text-[11px] font-bold text-[#176B45] flex items-center gap-1 hover:underline cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        <span>تحديد الكل كمقروء</span>
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#176B45]/10">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-xs text-center text-[#5C6B63]">
                        لا توجد إشعارات جديدة.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`px-4 py-3 text-xs space-y-0.5 ${
                            n.isRead ? 'bg-white' : 'bg-[#F7F3E9]/70'
                          }`}
                        >
                          <p className="font-extrabold text-[#18221D]">{n.title}</p>
                          <p className="text-[#5C6B63]">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onNavigateCustomer}
              className="min-h-[40px] px-3.5 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <span>المتجر</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3F4F2] text-[11px] font-bold text-[#5C6B63]">
              <span className="text-[#104B34]">{ROLE_LABELS_AR[adminRole]}</span>
              <span>·</span>
              <span dir="ltr">{adminEmail}</span>
            </div>
          </div>
        </header>

        {toast && (
          <div className="px-4 sm:px-6 pt-4">
            <div
              className={`rounded-xl px-4 py-3 text-sm font-bold border ${
                toast.type === 'success'
                  ? 'bg-[#DCFCE7] border-[#15803D]/25 text-[#166534]'
                  : 'bg-[#FEE2E2] border-[#B91C1C]/25 text-[#991B1B]'
              }`}
            >
              {toast.text}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewSection
              restaurant={bundle.restaurant}
              hoursStatus={hoursStatus}
              items={bundle.items}
              orders={orders}
              onGoToOrders={() => setActiveTab('orders')}
              onGoToInventory={() => setActiveTab('inventory')}
            />
          )}

          {activeTab === 'orders' && (
            <OrdersSection
              restaurant={bundle.restaurant}
              orders={orders}
              onUpdateStatus={handleUpdateOrderStatus}
              onExportCsv={handleExportCsv}
            />
          )}

          {activeTab === 'menu' && (
            <MenuManager
              restaurant={bundle.restaurant}
              categories={bundle.categories}
              items={bundle.items}
              onSaveCategory={handleSaveCategory}
              onDeleteCategory={handleDeleteCategory}
              onSaveItem={handleSaveItem}
              onDeleteItem={handleDeleteItem}
              onReorderItems={handleReorderItems}
              onUploadImage={handleUploadImage}
            />
          )}

          {activeTab === 'delivery' && (
            <DeliveryAndBranchesSection
              restaurant={bundle.restaurant}
              zones={bundle.deliveryZones}
              branches={bundle.branches}
              onSaveZone={handleSaveZone}
              onDeleteZone={handleDeleteZone}
              onSaveBranch={handleSaveBranch}
              onDeleteBranch={handleDeleteBranch}
            />
          )}

          {activeTab === 'inventory' && (
            <InventorySection
              items={bundle.items}
              movements={inventoryMovements}
              onAdjustStock={handleAdjustStock}
            />
          )}

          {activeTab === 'coupons' && (
            <CouponsSection
              restaurant={bundle.restaurant}
              coupons={coupons}
              onSaveCoupon={handleSaveCoupon}
              onDeleteCoupon={handleDeleteCoupon}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsSection
              restaurant={bundle.restaurant}
              items={bundle.items}
              orders={orders}
              onExportCsv={handleExportCsv}
            />
          )}

          {activeTab === 'employees' && (
            <EmployeesAndLogsSection
              employees={employees}
              activityLogs={activityLogs}
              onSaveEmployee={handleSaveEmployee}
              onDeleteEmployee={handleDeleteEmployee}
            />
          )}

          {activeTab === 'settings' && (
            <RestaurantSettingsSection
              restaurant={bundle.restaurant}
              onSave={handleSaveRestaurant}
              onUploadImage={handleUploadImage}
            />
          )}

          {activeTab === 'ai' && (
            <AISettingsSection
              restaurant={bundle.restaurant}
              aiLogs={aiLogs}
              configStatus={configStatus}
              onSave={handleSaveRestaurant}
            />
          )}

          {activeTab === 'system' && (
            <SystemSettingsSection
              token={token}
              restaurant={bundle.restaurant}
              configStatus={configStatus}
              onSave={handleSaveRestaurant}
              onNotify={notify}
            />
          )}
        </main>
      </div>
    </div>
  );
}
