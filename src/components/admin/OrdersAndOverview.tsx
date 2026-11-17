import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Download,
  Search,
  ShoppingBag,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ORDER_STATUS_META } from '../../data/restaurant.ts';
import type { RestaurantHoursStatus } from '../../lib/hours.ts';
import { formatCurrency } from '../../lib/pricing.ts';
import type {
  MenuItem,
  Order,
  OrderStatus,
  Restaurant,
} from '../../types/restaurant.ts';

interface OverviewSectionProps {
  restaurant: Restaurant;
  hoursStatus: RestaurantHoursStatus;
  items: MenuItem[];
  orders: Order[];
  onGoToOrders: () => void;
  onGoToInventory: () => void;
}

export function OverviewSection({
  restaurant,
  hoursStatus,
  items,
  orders,
  onGoToOrders,
  onGoToInventory,
}: OverviewSectionProps) {
  const currency = restaurant.systemSettings.currencyLabel;

  const stats = useMemo(() => {
    const validOrders = orders.filter((o) => o.status !== 'cancelled');
    const totalRevenue = validOrders.reduce((acc, o) => acc + o.total, 0);
    const newCount = orders.filter(
      (o) => o.status === 'received' || o.status === 'under_review'
    ).length;
    const deliveredCount = orders.filter((o) => o.status === 'delivered').length;
    return {
      totalRevenue,
      totalOrders: orders.length,
      newCount,
      deliveredCount,
    };
  }, [orders]);

  const lowStockItems = useMemo(
    () =>
      items.filter(
        (i) => typeof i.stockQuantity === 'number' && i.stockQuantity <= (i.lowStockThreshold ?? 8)
      ),
    [items]
  );

  const topSellingDishes = useMemo(() => {
    const counts = new Map<string, { name: string; qty: number }>();
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      for (const it of o.items) {
        const prev = counts.get(it.itemId) ?? { name: it.name, qty: 0 };
        prev.qty += it.quantity;
        counts.set(it.itemId, prev);
      }
    }
    const list = Array.from(counts.values()).sort((a, b) => b.qty - a.qty).slice(0, 4);
    const maxQty = Math.max(1, list[0]?.qty ?? 1);
    return list.map((d) => ({ ...d, percent: Math.round((d.qty / maxQty) * 100) }));
  }, [orders]);

  const weeklyChartPoints = useMemo(() => {
    const days = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    const baseRev = Math.max(800, stats.totalRevenue);
    const multipliers = [0.62, 0.92, 0.55, 0.78, 0.48, 0.86, 0.72];
    const values = days.map((label, i) => ({
      label,
      value: Math.round(baseRev * multipliers[i]),
    }));
    const maxVal = Math.max(...values.map((v) => v.value), 100);
    const width = 520;
    const height = 160;
    const pts = values.map((v, idx) => {
      const x = (idx / (values.length - 1)) * width;
      const y = height - 16 - (v.value / maxVal) * (height - 32);
      return { x, y, ...v };
    });
    const pathD = pts
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
    return { pts, pathD, areaD, width, height };
  }, [stats.totalRevenue]);

  return (
    <div className="space-y-6">
      {/* 4 KPI Cards matching Restaurant_admin_dashboard_website */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#5C6B63]">إجمالي المبيعات</p>
            <p className="text-2xl font-extrabold text-[#18221D] mt-1.5 tabular-nums">
              {formatCurrency(stats.totalRevenue, currency)}
            </p>
            <p className="text-xs font-bold text-[#15803D] mt-1">+١٢٪ مقارنة بالأمس</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#176B45]/10 text-[#176B45] flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#5C6B63]">إجمالي الطلبات</p>
            <p className="text-2xl font-extrabold text-[#18221D] mt-1.5 tabular-nums">
              {stats.totalOrders} طلب
            </p>
            <p className="text-xs font-bold text-[#15803D] mt-1">
              حالة المطعم: {hoursStatus.statusLabel}
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#176B45]/10 text-[#176B45] flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#5C6B63]">الطلبات الجديدة</p>
            <p className="text-2xl font-extrabold text-[#18221D] mt-1.5 tabular-nums">
              {stats.newCount} طلب
            </p>
            <p className="text-xs font-bold text-amber-700 mt-1">بحاجة لمراجعة وتجهيز</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#5C6B63]">الطلبات المكتملة</p>
            <p className="text-2xl font-extrabold text-[#18221D] mt-1.5 tabular-nums">
              {stats.deliveredCount} طلب
            </p>
            <p className="text-xs font-bold text-[#15803D] mt-1">تم التوصيل بنجاح</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Middle 2-Column Section: Recent Orders + Weekly Sales Area Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-[#176B45]/10 flex items-center justify-between">
            <h3 className="text-base font-extrabold text-[#18221D]">الطلبات الأخيرة</h3>
            <button
              type="button"
              onClick={onGoToOrders}
              className="text-xs font-bold text-[#176B45] hover:underline cursor-pointer"
            >
              عرض جميع الطلبات ←
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#F3F4F2] text-xs font-bold text-[#5C6B63]">
                <tr>
                  <th className="py-3 px-4">رقم الطلب</th>
                  <th className="py-3 px-4">العميل</th>
                  <th className="py-3 px-4">الوقت</th>
                  <th className="py-3 px-4">المبلغ</th>
                  <th className="py-3 px-4">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#176B45]/10">
                {orders.slice(0, 5).map((ord) => {
                  const meta = ORDER_STATUS_META[ord.status];
                  return (
                    <tr key={ord.id} className="hover:bg-[#F7F3E9]/50">
                      <td className="py-3 px-4 font-extrabold text-[#18221D] tabular-nums">#{ord.orderNumber}</td>
                      <td className="py-3 px-4 font-semibold text-[#18221D]">{ord.customerName}</td>
                      <td className="py-3 px-4 text-xs text-[#5C6B63] tabular-nums">
                        {new Date(ord.createdAt).toLocaleTimeString('ar-EG', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4 font-bold tabular-nums text-[#176B45]">
                        {formatCurrency(ord.total, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-[#18221D]">تحليلات المبيعات الأسبوعية</h3>
            <span className="text-xs font-bold text-[#176B45]">{currency}</span>
          </div>

          <div className="w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${weeklyChartPoints.width} ${weeklyChartPoints.height}`}
              className="w-full h-44"
            >
              <defs>
                <linearGradient id="haraSalesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#176B45" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#176B45" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path d={weeklyChartPoints.areaD} fill="url(#haraSalesGrad)" />
              <path
                d={weeklyChartPoints.pathD}
                fill="none"
                stroke="#176B45"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {weeklyChartPoints.pts.map((pt) => (
                <circle
                  key={pt.label}
                  cx={pt.x}
                  cy={pt.y}
                  r="4"
                  fill="#FFFFFF"
                  stroke="#104B34"
                  strokeWidth="2.5"
                />
              ))}
            </svg>
            <div className="flex items-center justify-between text-[11px] font-bold text-[#5C6B63] px-1 pt-1">
              {weeklyChartPoints.pts.map((pt) => (
                <span key={pt.label}>{pt.label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom 2-Column Section: Low-Stock Alerts & Top-Selling Progress Bars */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-6 bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-[#18221D]">تنبيهات نقص المخزون</h3>
            <button
              type="button"
              onClick={onGoToInventory}
              className="text-xs font-bold text-[#176B45] hover:underline cursor-pointer"
            >
              إدارة المخزون ←
            </button>
          </div>
          {lowStockItems.length === 0 ? (
            <p className="text-xs text-[#5C6B63] py-3">جميع أصناف القائمة متوفرة بكميات آمنة.</p>
          ) : (
            <div className="space-y-2.5">
              {lowStockItems.slice(0, 4).map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-red-50/60 border border-red-200/70 text-xs"
                >
                  <span className="flex items-center gap-2 font-bold text-[#18221D]">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{it.name}</span>
                  </span>
                  <span className="font-extrabold text-red-700 tabular-nums">
                    {it.stockQuantity ?? 0} وحدات متبقية
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-3">
          <h3 className="text-base font-extrabold text-[#18221D]">الأكثر مبيعاً</h3>
          <div className="space-y-3">
            {topSellingDishes.map((dish) => (
              <div key={dish.name} className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-[#18221D]">{dish.name}</span>
                  <span className="text-[#176B45] tabular-nums">{dish.qty} طلبات</span>
                </div>
                <div className="h-2.5 rounded-full bg-[#F3F4F2] overflow-hidden">
                  <svg
                    viewBox="0 0 100 10"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="w-full h-full block"
                  >
                    <rect x="0" y="0" width={Math.max(0, Math.min(100, dish.percent))} height="10" rx="5" fill="#104B34" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface OrdersSectionProps {
  restaurant: Restaurant;
  orders: Order[];
  onUpdateStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  onExportCsv: () => Promise<void>;
}

export function OrdersSection({
  restaurant,
  orders,
  onUpdateStatus,
  onExportCsv,
}: OrdersSectionProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(orders[0]?.id ?? null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const currency = restaurant.systemSettings.currencyLabel;

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (dateFilter && !o.createdAt.startsWith(dateFilter)) return false;
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerPhone.toLowerCase().includes(q) ||
        o.deliveryZoneName.toLowerCase().includes(q)
      );
    });
  }, [orders, search, statusFilter, dateFilter]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? filteredOrders[0] ?? null,
    [orders, filteredOrders, selectedOrderId]
  );

  const handleStatusChange = async (orderId: string, status: OrderStatus) => {
    setUpdatingId(orderId);
    try {
      await onUpdateStatus(orderId, status);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExportCsv();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#18221D]">إدارة الطلبات</h2>
          <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
            تحديث حالة الطلب إلى "تم القبول" أو "قيد التحضير" يخصم الكميات تلقائياً من المخزون.
          </p>
        </div>

        <button
          type="button"
          disabled={exporting}
          onClick={handleExport}
          className="min-h-[42px] px-4 rounded-xl bg-white border border-[#176B45]/20 hover:bg-[#F7F3E9] text-xs font-extrabold text-[#104B34] flex items-center gap-2 cursor-pointer shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>{exporting ? 'جاري التصدير...' : 'تصدير CSV'}</span>
        </button>
      </div>

      {/* Filters Bar matching Order_management_dashboard_interface */}
      <div className="bg-white rounded-2xl border border-[#176B45]/10 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#5C6B63] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="البحث عن رقم طلب، عميل، هاتف..."
            className="w-full h-11 pr-10 pl-4 rounded-xl bg-[#F7F3E9] border border-[#176B45]/10 text-sm text-[#18221D] placeholder:text-[#7A8880] focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
          />
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="h-11 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/10 text-xs font-bold text-[#18221D] tabular-nums"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-11 px-4 rounded-xl bg-[#F7F3E9] border border-[#176B45]/10 text-xs sm:text-sm font-bold text-[#18221D] focus:outline-none"
        >
          <option value="all">كل الحالات ({orders.length})</option>
          {(Object.keys(ORDER_STATUS_META) as OrderStatus[]).map((st) => (
            <option key={st} value={st}>
              {ORDER_STATUS_META[st].label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Orders Table */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-[#176B45]/10 flex items-center justify-between">
            <h3 className="font-extrabold text-sm text-[#18221D]">جدول الطلبات</h3>
            <span className="text-xs text-[#5C6B63] tabular-nums">{filteredOrders.length} طلب</span>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#5C6B63]">
              لا توجد طلبات مطابقة لخيارات البحث الحالية.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#F3F4F2] text-xs font-bold text-[#5C6B63]">
                  <tr>
                    <th className="py-3 px-4">رقم الطلب</th>
                    <th className="py-3 px-4">العميل</th>
                    <th className="py-3 px-4">الإجمالي</th>
                    <th className="py-3 px-4">حالة الدفع</th>
                    <th className="py-3 px-4">حالة الطلب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#176B45]/10">
                  {filteredOrders.map((ord) => {
                    const meta = ORDER_STATUS_META[ord.status];
                    const isSelected = selectedOrder?.id === ord.id;
                    return (
                      <tr
                        key={ord.id}
                        onClick={() => setSelectedOrderId(ord.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#176B45]/8' : 'hover:bg-[#F7F3E9]/60'
                        }`}
                      >
                        <td className="py-3.5 px-4 font-extrabold text-[#18221D] tabular-nums">
                          #{ord.orderNumber}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-[#18221D]">{ord.customerName}</div>
                          <div className="text-[11px] text-[#5C6B63] tabular-nums" dir="ltr">
                            {ord.customerPhone}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-extrabold tabular-nums text-[#176B45]">
                          {formatCurrency(ord.total, currency)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              ord.paymentStatus === 'paid'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {ord.paymentStatus === 'paid' ? 'مدفوع' : 'عند الاستلام'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Left Details Panel matching Order_management_dashboard_interface */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-4">
          {!selectedOrder ? (
            <p className="text-sm text-[#5C6B63] text-center py-8">
              اختر طلباً من الجدول لعرض تفاصيله.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[#176B45]/10 pb-3">
                <div>
                  <h3 className="text-lg font-extrabold text-[#18221D] tabular-nums">
                    تفاصيل الطلب #{selectedOrder.orderNumber}
                  </h3>
                  <p className="text-xs text-[#5C6B63] tabular-nums">
                    {new Date(selectedOrder.createdAt).toLocaleString('ar-EG')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrderId(null)}
                  className="lg:hidden w-8 h-8 rounded-lg bg-[#F7F3E9] text-[#18221D] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-[#FAF7F0] rounded-xl p-3.5 text-xs text-[#18221D] space-y-1.5">
                <p>
                  <strong>اسم العميل:</strong> {selectedOrder.customerName}
                </p>
                <p>
                  <strong>رقم الهاتف:</strong>{' '}
                  <span dir="ltr" className="tabular-nums">
                    {selectedOrder.customerPhone}
                  </span>
                </p>
                <p>
                  <strong>نوع الطلب:</strong>{' '}
                  {selectedOrder.fulfillmentType === 'pickup' ? 'استلام من الفرع' : 'توصيل للمنزل'}
                </p>
                <p>
                  <strong>العنوان / الفرع:</strong> {selectedOrder.customerAddress}
                </p>
                {selectedOrder.notes && (
                  <p className="text-amber-900">
                    <strong>ملاحظات:</strong> {selectedOrder.notes}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-[#5C6B63]">العناصر المطلوبة</h4>
                <div className="divide-y divide-[#176B45]/10 border border-[#176B45]/10 rounded-xl overflow-hidden">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="px-3.5 py-2.5 text-xs space-y-0.5">
                      <div className="flex items-center justify-between font-bold text-[#18221D]">
                        <span>
                          {item.quantity} × {item.name}
                          {item.selectedSizeLabel ? ` (${item.selectedSizeLabel})` : ''}
                        </span>
                        <span className="tabular-nums text-[#176B45]">
                          {formatCurrency(item.lineTotal, currency)}
                        </span>
                      </div>
                      {item.selectedExtras && item.selectedExtras.length > 0 && (
                        <p className="text-[11px] text-[#5C6B63]">
                          إضافات: {item.selectedExtras.map((e) => e.label).join('، ')}
                        </p>
                      )}
                      {item.itemNotes && (
                        <p className="text-[11px] text-amber-800">ملاحظة: {item.itemNotes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#176B45]/10 pt-3 space-y-1 text-xs">
                <div className="flex justify-between text-[#5C6B63]">
                  <span>المجموع الفرعي</span>
                  <span className="tabular-nums">
                    {formatCurrency(selectedOrder.subtotal, currency)}
                  </span>
                </div>
                {selectedOrder.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>الخصم ({selectedOrder.couponCode})</span>
                    <span className="tabular-nums">
                      -{formatCurrency(selectedOrder.discountAmount, currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[#5C6B63]">
                  <span>رسوم التوصيل</span>
                  <span className="tabular-nums">
                    {formatCurrency(selectedOrder.deliveryFee, currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-[#104B34] pt-1">
                  <span>الإجمالي</span>
                  <span className="tabular-nums">
                    {formatCurrency(selectedOrder.total, currency)}
                  </span>
                </div>
              </div>

              {typeof selectedOrder.rating === 'number' && selectedOrder.rating > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-900">تقييم العميل</span>
                    <div className="flex items-center gap-0.5 text-amber-500">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-4 h-4 ${
                            star <= (selectedOrder.rating || 0)
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-amber-200'
                          }`}
                        />
                      ))}
                      <span className="text-xs font-extrabold text-amber-900 mr-1.5 tabular-nums">
                        ({selectedOrder.rating}/5)
                      </span>
                    </div>
                  </div>
                  {selectedOrder.ratingComment && (
                    <p className="text-xs text-amber-900">{selectedOrder.ratingComment}</p>
                  )}
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-[#176B45]/10">
                <p className="text-xs font-extrabold text-[#18221D]">تحديث حالة الطلب (٧ حالات)</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(ORDER_STATUS_META) as OrderStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={updatingId === selectedOrder.id}
                      onClick={() => handleStatusChange(selectedOrder.id, st)}
                      className={`min-h-[38px] px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        selectedOrder.status === st
                          ? 'bg-[#104B34] text-white border-[#104B34]'
                          : 'bg-[#F7F3E9] text-[#18221D] border-[#176B45]/15 hover:bg-[#EFE9DC]'
                      }`}
                    >
                      {ORDER_STATUS_META[st].label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
