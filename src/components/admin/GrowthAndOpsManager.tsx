import {
  Activity,
  AlertTriangle,
  BarChart3,
  Download,
  Package,
  Plus,
  Tag,
  Trash2,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  ROLE_LABELS_AR,
  ROLE_PERMISSIONS,
  type AdminTabPermission,
} from '../../lib/permissions.ts';
import { formatCurrency } from '../../lib/pricing.ts';
import type {
  ActivityLog,
  Coupon,
  Employee,
  EmployeeRole,
  InventoryMovement,
  MenuItem,
  Order,
  Restaurant,
} from '../../types/restaurant.ts';

// 1. Inventory & Movement History
interface InventorySectionProps {
  items: MenuItem[];
  movements: InventoryMovement[];
  onAdjustStock: (itemId: string, delta: number, reason: string) => Promise<void>;
}

export function InventorySection({
  items,
  movements,
  onAdjustStock,
}: InventorySectionProps) {
  const [selectedItemId, setSelectedItemId] = useState(items[0]?.id ?? '');
  const [delta, setDelta] = useState('10');
  const [reason, setReason] = useState('توريد مخزون جديد');
  const [saving, setSaving] = useState(false);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Math.trunc(Number(delta));
    if (!selectedItemId || !Number.isFinite(num) || num === 0) return;
    setSaving(true);
    try {
      await onAdjustStock(selectedItemId, num, reason.trim() || 'تعديل يدوي');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-[#18221D]">إدارة المخزون</h2>
        <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
          الكميات المتاحة وتنبيهات انخفاض المخزون مع خصم تلقائي عند قبول الطلبات.
        </p>
      </div>

      {/* Quick Adjust Form */}
      <form
        onSubmit={handleAdjust}
        className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">الصنف</label>
          <select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm font-bold"
          >
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} (الحالي: {it.stockQuantity})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">
            التعديل (+ إضافة أو - خصم)
          </label>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm font-bold tabular-nums"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">السبب</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="h-11 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
        >
          {saving ? 'جاري التحديث...' : 'تحديث الكمية'}
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Current Stock Table */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-[#176B45]/10 flex items-center gap-2 font-extrabold text-sm">
            <Package className="w-4 h-4 text-[#176B45]" />
            <span>أرصدة الأصناف الحالية</span>
          </div>
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-xs text-right">
              <thead className="bg-[#F3F4F2] font-bold text-[#5C6B63]">
                <tr>
                  <th className="py-2.5 px-4">الصنف</th>
                  <th className="py-2.5 px-4">المتوفر</th>
                  <th className="py-2.5 px-4">إجراء سريع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#176B45]/10">
                {items.map((it) => {
                  const isLow = it.stockQuantity <= it.lowStockThreshold;
                  return (
                    <tr key={it.id}>
                      <td className="py-3 px-4 font-bold text-[#18221D]">{it.name}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold tabular-nums ${
                            isLow ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isLow && <AlertTriangle className="w-3 h-3" />}
                          {it.stockQuantity}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onAdjustStock(it.id, 10, 'تزويد سريع +10')}
                          className="px-2.5 py-1 rounded-lg bg-[#F7F3E9] hover:bg-[#EFE9DC] text-[#104B34] font-bold cursor-pointer"
                        >
                          +١٠ وحدات
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Movements Log */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-[#176B45]/10 font-extrabold text-sm">
            سجل حركات المخزون
          </div>
          <div className="divide-y divide-[#176B45]/10 max-h-[420px] overflow-y-auto">
            {movements.length === 0 ? (
              <p className="p-6 text-center text-xs text-[#5C6B63]">لا توجد حركات مسجلة بعد.</p>
            ) : (
              movements.map((mv) => (
                <div key={mv.id} className="px-4 py-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-extrabold text-[#18221D]">{mv.itemName}</p>
                    <p className="text-[#5C6B63]">{mv.reason}</p>
                    <p className="text-[10px] text-[#7A8880] tabular-nums">
                      {new Date(mv.createdAt).toLocaleString('ar-EG')}
                    </p>
                  </div>
                  <div className="text-left">
                    <span
                      className={`font-extrabold tabular-nums ${
                        mv.change >= 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {mv.change >= 0 ? `+${mv.change}` : mv.change}
                    </span>
                    <p className="text-[11px] text-[#5C6B63] tabular-nums">
                      الرصيد: {mv.newQty}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 2. Coupons & Offers Section
interface CouponsSectionProps {
  restaurant: Restaurant;
  coupons: Coupon[];
  onSaveCoupon: (
    coupon: Partial<Coupon> & { code: string; discountValue: number }
  ) => Promise<void>;
  onDeleteCoupon: (couponId: string) => Promise<void>;
}

export function CouponsSection({
  restaurant,
  coupons,
  onSaveCoupon,
  onDeleteCoupon,
}: CouponsSectionProps) {
  const currency = restaurant.systemSettings.currencyLabel;
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('15');
  const [minOrderAmount, setMinOrderAmount] = useState('150');
  const [validUntil, setValidUntil] = useState('2027-12-31');
  const [usageLimit, setUsageLimit] = useState('100');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(discountValue);
    if (!code.trim() || !Number.isFinite(val) || val <= 0) return;
    setSaving(true);
    try {
      await onSaveCoupon({
        code: code.trim().toUpperCase(),
        description: description.trim() || `خصم خاص بالكود ${code.trim().toUpperCase()}`,
        discountType,
        discountValue: val,
        minOrderAmount: Math.max(0, Number(minOrderAmount) || 0),
        validFrom: new Date().toISOString().slice(0, 10),
        validUntil,
        usageLimit: Math.max(1, Number(usageLimit) || 100),
        isActive: true,
      });
      setCode('');
      setDescription('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-[#18221D]">إدارة العروض وكوبونات الخصم</h2>
        <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
          أنشئ أكواد خصم بنسبة مئوية أو مبلغ ثابت وحدد الحد الأدنى وتاريخ الانتهاء.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">كود الخصم</label>
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="GRILL20"
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm uppercase font-bold"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">نوع الخصم</label>
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed')}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-xs font-bold"
          >
            <option value="percentage">نسبة مئوية (٪)</option>
            <option value="fixed">مبلغ ثابت ({currency})</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">القيمة</label>
          <input
            type="number"
            min="1"
            required
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm tabular-nums"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">الحد الأدنى</label>
          <input
            type="number"
            min="0"
            value={minOrderAmount}
            onChange={(e) => setMinOrderAmount(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm tabular-nums"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">صالح حتى</label>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-xs tabular-nums"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="h-10 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة كوبون</span>
        </button>
        <div className="sm:col-span-3 lg:col-span-6">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="وصف العرض للعملاء (مثال: خصم ١٥٪ على جميع الطلبات)"
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-xs"
          />
        </div>
      </form>

      <div className="bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F3F4F2] text-xs font-bold text-[#5C6B63]">
              <tr>
                <th className="py-3 px-4">الكود</th>
                <th className="py-3 px-4">القيمة</th>
                <th className="py-3 px-4">الحد الأدنى</th>
                <th className="py-3 px-4">الاستخدام</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#176B45]/10">
              {coupons.map((cp) => (
                <tr key={cp.id}>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center gap-1.5 font-extrabold text-[#104B34] bg-[#F7F3E9] px-2.5 py-1 rounded-lg">
                      <Tag className="w-3.5 h-3.5" />
                      {cp.code}
                    </span>
                    <p className="text-[11px] text-[#5C6B63] mt-1">{cp.description}</p>
                  </td>
                  <td className="py-3.5 px-4 font-bold tabular-nums">
                    {cp.discountType === 'percentage'
                      ? `${cp.discountValue}٪`
                      : formatCurrency(cp.discountValue, currency)}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums">
                    {formatCurrency(cp.minOrderAmount, currency)}
                  </td>
                  <td className="py-3.5 px-4 text-xs tabular-nums">
                    {cp.usedCount} / {cp.usageLimit || '∞'}
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      type="button"
                      onClick={() => onSaveCoupon({ ...cp, isActive: !cp.isActive })}
                      className={`px-3 py-1 rounded-full text-xs font-bold cursor-pointer ${
                        cp.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-neutral-200 text-neutral-700'
                      }`}
                    >
                      {cp.isActive ? 'مفعل' : 'متوقف'}
                    </button>
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      type="button"
                      onClick={() => onDeleteCoupon(cp.id)}
                      className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 3. Analytics & Reports Section
interface AnalyticsSectionProps {
  restaurant: Restaurant;
  items: MenuItem[];
  orders: Order[];
  onExportCsv: () => Promise<void>;
}

export function AnalyticsSection({
  restaurant,
  items,
  orders,
  onExportCsv,
}: AnalyticsSectionProps) {
  const currency = restaurant.systemSettings.currencyLabel;
  const [timeframe, setTimeframe] = useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');

  const filteredOrders = useMemo(() => {
    if (timeframe === 'all') return orders;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const cutoffDays = timeframe === 'weekly' ? 7 : timeframe === 'monthly' ? 30 : 0;
    const cutoffTs = now.getTime() - cutoffDays * 24 * 60 * 60 * 1000;

    return orders.filter((o) => {
      if (!o.createdAt) return false;
      if (timeframe === 'daily') {
        return o.createdAt.slice(0, 10) === todayStr;
      }
      const ts = new Date(o.createdAt).getTime();
      return Number.isFinite(ts) && ts >= cutoffTs;
    });
  }, [orders, timeframe]);

  const report = useMemo(() => {
    const valid = filteredOrders.filter((o) => o.status !== 'cancelled');
    const cancelled = filteredOrders.filter((o) => o.status === 'cancelled').length;
    const delivered = filteredOrders.filter((o) => o.status === 'delivered').length;
    const revenue = valid.reduce((sum, o) => sum + o.total, 0);
    const aov = valid.length ? revenue / valid.length : 0;

    const dishStats = new Map<string, { id: string; name: string; qty: number; rev: number }>();
    for (const it of items) {
      dishStats.set(it.id, { id: it.id, name: it.name, qty: 0, rev: 0 });
    }
    for (const o of valid) {
      for (const line of o.items) {
        const cur = dishStats.get(line.itemId) ?? {
          id: line.itemId,
          name: line.name,
          qty: 0,
          rev: 0,
        };
        cur.qty += line.quantity;
        cur.rev += line.lineTotal;
        dishStats.set(line.itemId, cur);
      }
    }
    const sorted = Array.from(dishStats.values()).sort((a, b) => b.qty - a.qty);
    return {
      totalOrders: filteredOrders.length,
      delivered,
      cancelled,
      revenue,
      aov,
      mostPopular: sorted.slice(0, 5),
      leastPopular: [...sorted].reverse().slice(0, 5),
    };
  }, [items, filteredOrders]);

  const TIMEFRAME_OPTIONS: Array<{ id: 'all' | 'daily' | 'weekly' | 'monthly'; label: string }> = [
    { id: 'all', label: 'الكل' },
    { id: 'daily', label: 'اليوم' },
    { id: 'weekly', label: 'هذا الأسبوع' },
    { id: 'monthly', label: 'هذا الشهر' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#18221D]">التقارير والتحليلات</h2>
          <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
            مبيعات الفترة، متوسط قيمة الطلب، الأصناف الأكثر والأقل طلباً، وتصدير التقارير.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center bg-white border border-[#176B45]/15 rounded-xl p-1 gap-1">
            {TIMEFRAME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTimeframe(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                  timeframe === opt.id
                    ? 'bg-[#104B34] text-white'
                    : 'text-[#5C6B63] hover:bg-[#F7F3E9]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onExportCsv}
            className="min-h-[42px] px-4 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-extrabold flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تصدير تقرير المبيعات CSV</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs">
          <p className="text-xs font-bold text-[#5C6B63]">إجمالي الإيرادات</p>
          <p className="text-2xl font-extrabold text-[#104B34] mt-1 tabular-nums">
            {formatCurrency(report.revenue, currency)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs">
          <p className="text-xs font-bold text-[#5C6B63]">متوسط قيمة الطلب</p>
          <p className="text-2xl font-extrabold text-[#18221D] mt-1 tabular-nums">
            {formatCurrency(report.aov, currency)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs">
          <p className="text-xs font-bold text-[#5C6B63]">الطلبات المكتملة</p>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
            {report.delivered} / {report.totalOrders}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs">
          <p className="text-xs font-bold text-[#5C6B63]">الطلبات الملغاة</p>
          <p className="text-2xl font-extrabold text-red-700 mt-1 tabular-nums">
            {report.cancelled}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 font-extrabold text-base text-[#104B34]">
            <BarChart3 className="w-5 h-5" />
            <h3>الأطباق الأكثر شعبية</h3>
          </div>
          <div className="space-y-2.5">
            {report.mostPopular.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#F7F3E9]/70 text-xs"
              >
                <span className="font-bold text-[#18221D]">{d.name}</span>
                <span className="font-extrabold text-[#176B45] tabular-nums">
                  {d.qty} وحدة · {formatCurrency(d.rev, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 font-extrabold text-base text-[#5C6B63]">
            <BarChart3 className="w-5 h-5" />
            <h3>الأطباق الأقل طلباً (تحتاج ترويجاً)</h3>
          </div>
          <div className="space-y-2.5">
            {report.leastPopular.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#F3F4F2] text-xs"
              >
                <span className="font-bold text-[#18221D]">{d.name}</span>
                <span className="font-bold text-[#5C6B63] tabular-nums">{d.qty} وحدة</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. Employees, Roles & Activity Logs Section
interface EmployeesAndLogsSectionProps {
  employees: Employee[];
  activityLogs: ActivityLog[];
  onSaveEmployee: (
    emp: Partial<Employee> & { name: string; email: string }
  ) => Promise<void>;
  onDeleteEmployee: (employeeId: string) => Promise<void>;
}

const PERMISSION_LABELS_AR: Record<AdminTabPermission, string> = {
  overview: 'الرئيسية',
  orders: 'الطلبات',
  menu: 'المنيو',
  delivery: 'التوصيل',
  inventory: 'المخزون',
  coupons: 'الكوبونات',
  analytics: 'التقارير',
  employees: 'الموظفون',
  settings: 'الإعدادات',
  ai: 'الموظف الذكي',
  system: 'النظام',
};

export function EmployeesAndLogsSection({
  employees,
  activityLogs,
  onSaveEmployee,
  onDeleteEmployee,
}: EmployeesAndLogsSectionProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<EmployeeRole>('cashier');
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSaving(true);
    try {
      await onSaveEmployee({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role,
        isActive: true,
      });
      setName('');
      setEmail('');
      setPhone('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-[#18221D]">الموظفون وسجل النشاط</h2>
        <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
          إدارة فريق العمل وصلاحيات الوصول، ومراجعة سجل العمليات الإدارية.
        </p>
      </div>

      <form
        onSubmit={handleAdd}
        className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">اسم الموظف</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">البريد الإلكتروني</label>
          <input
            type="email"
            required
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm text-left"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">الهاتف</label>
          <input
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm text-left tabular-nums"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">الدور الوظيفي</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as EmployeeRole)}
            className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-xs font-bold"
          >
            {(Object.keys(ROLE_LABELS_AR) as EmployeeRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS_AR[r]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="h-10 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-extrabold cursor-pointer"
        >
          + إضافة موظف
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-[#176B45]/10 flex items-center gap-2 font-extrabold text-sm">
            <Users className="w-4 h-4 text-[#176B45]" />
            <span>فريق العمل ({employees.length})</span>
          </div>
          <div className="divide-y divide-[#176B45]/10">
            {employees.map((emp) => {
              const perms = ROLE_PERMISSIONS[emp.role] ?? [];
              return (
                <div key={emp.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-extrabold text-sm text-[#18221D]">{emp.name}</p>
                    <p className="text-xs text-[#5C6B63]" dir="ltr">
                      {emp.email}
                    </p>
                    <p className="text-[11px] text-[#176B45] mt-1 truncate">
                      الصلاحيات: {perms.map((p) => PERMISSION_LABELS_AR[p]).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-3 py-1 rounded-full bg-[#F7F3E9] text-[#104B34] text-xs font-bold">
                      {ROLE_LABELS_AR[emp.role]}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteEmployee(emp.id)}
                      className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-[#176B45]/10 flex items-center gap-2 font-extrabold text-sm">
            <Activity className="w-4 h-4 text-[#176B45]" />
            <span>سجل النشاط الأخير</span>
          </div>
          <div className="divide-y divide-[#176B45]/10 max-h-[380px] overflow-y-auto">
            {activityLogs.map((log) => (
              <div key={log.id} className="px-4 py-3 text-xs space-y-0.5">
                <p className="font-extrabold text-[#18221D]">{log.action}</p>
                <p className="text-[#5C6B63]">{log.details}</p>
                <p className="text-[10px] text-[#7A8880] tabular-nums">
                  {log.actorName} · {new Date(log.createdAt).toLocaleString('ar-EG')}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
