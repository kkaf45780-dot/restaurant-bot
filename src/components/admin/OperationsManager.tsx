import { Edit3, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { formatCurrency } from '../../lib/pricing.ts';
import { SafeImage } from '../SafeImage.tsx';
import type {
  DaySchedule,
  DeliveryZone,
  ManualRestaurantStatus,
  Restaurant,
  RestaurantBranch,
  ScheduleException,
} from '../../types/restaurant.ts';

interface DeliveryAndBranchesSectionProps {
  restaurant: Restaurant;
  zones: DeliveryZone[];
  branches: RestaurantBranch[];
  onSaveZone: (zone: Partial<DeliveryZone> & { name: string; fee: number }) => Promise<void>;
  onDeleteZone: (zoneId: string) => Promise<void>;
  onSaveBranch: (branch: Partial<RestaurantBranch> & { name: string }) => Promise<void>;
  onDeleteBranch: (branchId: string) => Promise<void>;
}

export function DeliveryAndBranchesSection({
  restaurant,
  zones,
  branches,
  onSaveZone,
  onDeleteZone,
  onSaveBranch,
  onDeleteBranch,
}: DeliveryAndBranchesSectionProps) {
  const currency = restaurant.systemSettings.currencyLabel;

  // Delivery Zone Modal / Inline Form
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneFee, setZoneFee] = useState('30');
  const [zoneMinOrder, setZoneMinOrder] = useState('150');
  const [zoneEta, setZoneEta] = useState('٣٠ - ٤٥ دقيقة');
  const [zoneActive, setZoneActive] = useState(true);

  // Branch Form
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchHours, setBranchHours] = useState('١٢:٠٠ م - ١٢:٠٠ ص');
  const [branchOpen, setBranchOpen] = useState(true);

  const [saving, setSaving] = useState(false);

  const handleZoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numFee = Number(zoneFee);
    const numMin = Math.max(0, Number(zoneMinOrder) || 0);
    if (!zoneName.trim() || !Number.isFinite(numFee) || numFee < 0) return;
    setSaving(true);
    try {
      await onSaveZone({
        id: editingZoneId ?? undefined,
        name: zoneName.trim(),
        fee: numFee,
        minOrderAmount: numMin,
        estimatedMinutes: zoneEta.trim(),
        isActive: zoneActive,
      });
      setShowZoneForm(false);
      setEditingZoneId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) return;
    setSaving(true);
    try {
      await onSaveBranch({
        id: editingBranchId ?? undefined,
        name: branchName.trim(),
        address: branchAddress.trim(),
        phone: branchPhone.trim(),
        hoursText: branchHours.trim(),
        isOpen: branchOpen,
      });
      setShowBranchForm(false);
      setEditingBranchId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-[#18221D]">إدارة التوصيل والفروع</h2>
        <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
          إدارة مناطق التوصيل والرسوم والحد الأدنى للطلب، إلى جانب فروع المطعم للاستلام.
        </p>
      </div>

      {/* Card 1: Delivery Zones matching Delivery_and_branch_management_dashboard */}
      <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-extrabold text-[#18221D]">مناطق التوصيل</h3>
          <button
            type="button"
            onClick={() => {
              setEditingZoneId(null);
              setZoneName('');
              setZoneFee('30');
              setZoneMinOrder('150');
              setZoneEta('٣٠ - ٤٥ دقيقة');
              setZoneActive(true);
              setShowZoneForm((v) => !v);
            }}
            className="min-h-[42px] px-4 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة منطقة توصيل</span>
          </button>
        </div>

        {showZoneForm && (
          <form
            onSubmit={handleZoneSubmit}
            className="rounded-2xl bg-[#F7F3E9] border border-[#176B45]/15 p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-bold text-[#5C6B63] mb-1">اسم المنطقة</label>
              <input
                type="text"
                required
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                placeholder="مثال: الزمالك"
                className="w-full h-10 px-3 rounded-xl bg-white border border-[#176B45]/15 text-sm text-[#18221D] placeholder:text-[#7A8880]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#5C6B63] mb-1">
                رسوم التوصيل ({currency})
              </label>
              <input
                type="number"
                min="0"
                required
                value={zoneFee}
                onChange={(e) => setZoneFee(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white border border-[#176B45]/15 text-sm text-[#18221D] tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#5C6B63] mb-1">
                الحد الأدنى للطلب ({currency})
              </label>
              <input
                type="number"
                min="0"
                value={zoneMinOrder}
                onChange={(e) => setZoneMinOrder(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white border border-[#176B45]/15 text-sm text-[#18221D] tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#5C6B63] mb-1">
                وقت التوصيل المقدر
              </label>
              <input
                type="text"
                value={zoneEta}
                onChange={(e) => setZoneEta(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white border border-[#176B45]/15 text-sm text-[#18221D]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 h-10 rounded-xl bg-[#104B34] text-white text-xs font-bold cursor-pointer"
              >
                {editingZoneId ? 'حفظ' : 'إضافة'}
              </button>
              <button
                type="button"
                onClick={() => setShowZoneForm(false)}
                className="px-3 h-10 rounded-xl bg-white text-[#18221D] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto border border-[#176B45]/10 rounded-xl">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F3F4F2] text-xs font-bold text-[#5C6B63]">
              <tr>
                <th className="py-3 px-4">اسم المنطقة</th>
                <th className="py-3 px-4">رسوم التوصيل</th>
                <th className="py-3 px-4">وقت التوصيل المقدر</th>
                <th className="py-3 px-4">الحد الأدنى للطلب</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#176B45]/10">
              {zones.map((zone) => (
                <tr key={zone.id} className="hover:bg-[#F7F3E9]/50">
                  <td className="py-3.5 px-4 font-bold text-[#18221D]">{zone.name}</td>
                  <td className="py-3.5 px-4 font-bold tabular-nums text-[#104B34]">
                    {formatCurrency(zone.fee, currency)}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-[#5C6B63]">{zone.estimatedMinutes}</td>
                  <td className="py-3.5 px-4 font-bold tabular-nums text-[#35443C]">
                    {formatCurrency(zone.minOrderAmount ?? 0, currency)}
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      type="button"
                      onClick={() => onSaveZone({ ...zone, isActive: !zone.isActive })}
                      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold cursor-pointer ${
                        zone.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-neutral-200 text-neutral-700'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          zone.isActive ? 'bg-emerald-600' : 'bg-neutral-500'
                        }`}
                      />
                      <span>{zone.isActive ? 'نشط' : 'غير نشط'}</span>
                    </button>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingZoneId(zone.id);
                          setZoneName(zone.name);
                          setZoneFee(String(zone.fee));
                          setZoneMinOrder(String(zone.minOrderAmount ?? 0));
                          setZoneEta(zone.estimatedMinutes);
                          setZoneActive(zone.isActive);
                          setShowZoneForm(true);
                        }}
                        className="w-8 h-8 rounded-lg hover:bg-[#F7F3E9] text-[#176B45] flex items-center justify-center cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteZone(zone.id)}
                        className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card 2: Restaurant Branches matching Delivery_and_branch_management_dashboard */}
      <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-extrabold text-[#18221D]">فروع المطعم</h3>
          <button
            type="button"
            onClick={() => {
              setEditingBranchId(null);
              setBranchName('');
              setBranchAddress('');
              setBranchPhone('');
              setBranchHours('١٢:٠٠ م - ١٢:٠٠ ص');
              setBranchOpen(true);
              setShowBranchForm((v) => !v);
            }}
            className="min-h-[42px] px-4 rounded-xl bg-[#176B45] hover:bg-[#104B34] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة فرع</span>
          </button>
        </div>

        {showBranchForm && (
          <form
            onSubmit={handleBranchSubmit}
            className="rounded-2xl bg-[#F7F3E9] border border-[#176B45]/15 p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-bold text-[#5C6B63] mb-1">اسم الفرع</label>
              <input
                type="text"
                required
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="مثال: فرع المعادي"
                className="w-full h-10 px-3 rounded-xl bg-white border border-[#176B45]/15 text-sm text-[#18221D] placeholder:text-[#7A8880]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-[#5C6B63] mb-1">العنوان</label>
              <input
                type="text"
                value={branchAddress}
                onChange={(e) => setBranchAddress(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white border border-[#176B45]/15 text-sm text-[#18221D]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#5C6B63] mb-1">ساعات العمل</label>
              <input
                type="text"
                value={branchHours}
                onChange={(e) => setBranchHours(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white border border-[#176B45]/15 text-sm text-[#18221D]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 h-10 rounded-xl bg-[#104B34] text-white text-xs font-bold cursor-pointer"
              >
                {editingBranchId ? 'حفظ' : 'إضافة'}
              </button>
              <button
                type="button"
                onClick={() => setShowBranchForm(false)}
                className="px-3 h-10 rounded-xl bg-white text-[#18221D] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto border border-[#176B45]/10 rounded-xl">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F3F4F2] text-xs font-bold text-[#5C6B63]">
              <tr>
                <th className="py-3 px-4">اسم الفرع</th>
                <th className="py-3 px-4">العنوان</th>
                <th className="py-3 px-4">ساعات العمل</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#176B45]/10">
              {branches.map((br) => (
                <tr key={br.id} className="hover:bg-[#F7F3E9]/50">
                  <td className="py-3.5 px-4 font-bold text-[#18221D]">{br.name}</td>
                  <td className="py-3.5 px-4 text-xs text-[#35443C]">{br.address}</td>
                  <td className="py-3.5 px-4 text-xs text-[#5C6B63] tabular-nums">
                    {br.hoursText}
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      type="button"
                      onClick={() => onSaveBranch({ ...br, isOpen: !br.isOpen })}
                      className={`px-3 py-1 rounded-full text-xs font-bold cursor-pointer ${
                        br.isOpen
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {br.isOpen ? 'مفتوح' : 'مغلق'}
                    </button>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBranchId(br.id);
                          setBranchName(br.name);
                          setBranchAddress(br.address);
                          setBranchPhone(br.phone);
                          setBranchHours(br.hoursText);
                          setBranchOpen(br.isOpen);
                          setShowBranchForm(true);
                        }}
                        className="w-8 h-8 rounded-lg hover:bg-[#F7F3E9] text-[#176B45] flex items-center justify-center cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteBranch(br.id)}
                        className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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

interface RestaurantSettingsSectionProps {
  restaurant: Restaurant;
  onSave: (patch: Partial<Restaurant>) => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
}

export function RestaurantSettingsSection({
  restaurant,
  onSave,
  onUploadImage,
}: RestaurantSettingsSectionProps) {
  const [name, setName] = useState(restaurant.name);
  const [description, setDescription] = useState(restaurant.description);
  const [address, setAddress] = useState(restaurant.address);
  const [phone, setPhone] = useState(restaurant.phone);
  const [whatsappNumber, setWhatsappNumber] = useState(restaurant.whatsappNumber);
  const [logoUrl, setLogoUrl] = useState(restaurant.logoUrl);

  const [manualStatus, setManualStatus] = useState<ManualRestaurantStatus>(
    restaurant.manualStatus
  );
  const [schedule, setSchedule] = useState<DaySchedule[]>(restaurant.weeklySchedule);
  const [exceptions, setExceptions] = useState<ScheduleException[]>(
    restaurant.scheduleExceptions
  );

  const [excDate, setExcDate] = useState('');
  const [excLabel, setExcLabel] = useState('');
  const [excClosed, setExcClosed] = useState(true);
  const [excOpen, setExcOpen] = useState('12:00');
  const [excClose, setExcClose] = useState('01:00');

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      setLogoUrl(url);
    } finally {
      setUploading(false);
    }
  };

  const updateDay = (idx: number, patch: Partial<DaySchedule>) => {
    setSchedule((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const addException = () => {
    if (!excDate || !excLabel.trim()) return;
    setExceptions((prev) => [
      ...prev,
      {
        id: `exc_${Date.now()}`,
        date: excDate,
        label: excLabel.trim(),
        isClosed: excClosed,
        openTime: excClosed ? undefined : excOpen,
        closeTime: excClosed ? undefined : excClose,
      },
    ]);
    setExcDate('');
    setExcLabel('');
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        address: address.trim(),
        phone: phone.trim(),
        whatsappNumber: whatsappNumber.trim(),
        logoUrl,
        manualStatus,
        weeklySchedule: schedule,
        scheduleExceptions: exceptions,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSaveAll} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#18221D]">إعدادات المطعم والمواعيد</h2>
          <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
            تحديث بيانات المطعم، الشعار، أرقام التواصل، جدول العمل الأسبوعي، والإجازات.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving || uploading}
          className="min-h-[44px] px-6 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-sm font-extrabold cursor-pointer disabled:opacity-50"
        >
          {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
        </button>
      </div>

      {/* Top 3-Column Grid matching Restaurant_settings_dashboard_interface */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Card 1: Basic Restaurant Info */}
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-4">
          <h3 className="text-base font-extrabold text-[#18221D]">بيانات المطعم الأساسية</h3>

          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">اسم المطعم</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm text-[#18221D]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">حالة المطعم</label>
            <select
              value={manualStatus}
              onChange={(e) => setManualStatus(e.target.value as ManualRestaurantStatus)}
              className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-xs font-bold text-[#18221D]"
            >
              <option value="auto">تلقائي حسب جدول العمل</option>
              <option value="force_open">مفتوح (تجاوز يدوي)</option>
              <option value="force_closed">مغلق مؤقتاً (تجاوز يدوي)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1.5">شعار المطعم</label>
            <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-[#176B45]/25 bg-[#F7F3E9]/40">
              <SafeImage
                src={logoUrl}
                alt={name}
                className="w-14 h-14 rounded-full object-cover border border-[#176B45]/15 shrink-0 bg-[#EFE9DC]"
                fallbackIconClassName="w-6 h-6"
              />
              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-[#176B45] cursor-pointer hover:underline">
                <Upload className="w-4 h-4" />
                <span>{uploading ? 'جاري الرفع...' : 'اسحب الشعار هنا أو تصفح'}</span>
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </label>
            </div>
          </div>
        </div>

        {/* Card 2: Contact & Location */}
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-4">
          <h3 className="text-base font-extrabold text-[#18221D]">معلومات الاتصال والموقع</h3>
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">العنوان بالتفصيل</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm text-[#18221D]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">رقم الهاتف</label>
            <input
              type="tel"
              dir="ltr"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm text-[#18221D] text-left tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">
              رقم الواتساب (بدون +)
            </label>
            <input
              type="tel"
              dir="ltr"
              required
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm text-[#18221D] text-left tabular-nums"
            />
          </div>
        </div>

        {/* Card 3: Restaurant Bio & Slug */}
        <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-4">
          <h3 className="text-base font-extrabold text-[#18221D]">وصف المطعم والنبذة</h3>
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">معرّف المطعم (Slug)</label>
            <input
              type="text"
              disabled
              value={restaurant.slug}
              className="w-full h-11 px-3 rounded-xl bg-[#F3F4F2] border border-[#176B45]/10 text-xs text-[#5C6B63] tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">وصف المطعم</label>
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm text-[#18221D]"
            />
          </div>
        </div>
      </div>

      {/* Bottom 2-Column Section: Weekly Working Hours & Holidays */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-3">
          <h3 className="text-base font-extrabold text-[#18221D]">أوقات العمل الأسبوعية</h3>
          <div className="divide-y divide-[#176B45]/10">
            {schedule.map((day, idx) => (
              <div
                key={day.day}
                className="py-2.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 w-36">
                  <button
                    type="button"
                    onClick={() => updateDay(idx, { isClosed: !day.isClosed })}
                    aria-label={`تبديل ${day.labelAr}`}
                    className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer flex items-center ${
                      !day.isClosed ? 'bg-[#16A34A] justify-start' : 'bg-neutral-300 justify-end'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white" />
                  </button>
                  <span className="text-sm font-bold text-[#18221D]">{day.labelAr}</span>
                </div>

                {!day.isClosed ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#5C6B63]">من</span>
                    <input
                      type="time"
                      value={day.openTime}
                      onChange={(e) => updateDay(idx, { openTime: e.target.value })}
                      className="h-9 px-2.5 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-[#18221D] tabular-nums"
                    />
                    <span className="text-[#5C6B63]">إلى</span>
                    <input
                      type="time"
                      value={day.closeTime}
                      onChange={(e) => updateDay(idx, { closeTime: e.target.value })}
                      className="h-9 px-2.5 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-[#18221D] tabular-nums"
                    />
                  </div>
                ) : (
                  <span className="text-xs font-bold text-red-700">إجازة أسبوعية</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#176B45]/10 p-5 shadow-xs space-y-4">
          <h3 className="text-base font-extrabold text-[#18221D]">العطلات والإجازات</h3>
          <div className="space-y-2.5">
            <input
              type="date"
              value={excDate}
              onChange={(e) => setExcDate(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm text-[#18221D] tabular-nums"
            />
            <input
              type="text"
              value={excLabel}
              onChange={(e) => setExcLabel(e.target.value)}
              placeholder="المناسبة (مثال: أول أيام العيد)"
              className="w-full h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm text-[#18221D] placeholder:text-[#7A8880]"
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-bold text-[#18221D] cursor-pointer">
                <input
                  type="checkbox"
                  checked={excClosed}
                  onChange={(e) => setExcClosed(e.target.checked)}
                  className="accent-[#176B45]"
                />
                <span>إغلاق كامل</span>
              </label>
              {!excClosed && (
                <div className="flex items-center gap-1">
                  <input
                    type="time"
                    value={excOpen}
                    onChange={(e) => setExcOpen(e.target.value)}
                    className="h-8 px-2 rounded-lg bg-[#F7F3E9] border border-[#176B45]/15 text-xs text-[#18221D]"
                  />
                  <input
                    type="time"
                    value={excClose}
                    onChange={(e) => setExcClose(e.target.value)}
                    className="h-8 px-2 rounded-lg bg-[#F7F3E9] border border-[#176B45]/15 text-xs text-[#18221D]"
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={addException}
              disabled={!excDate || !excLabel.trim()}
              className="w-full h-10 rounded-xl bg-[#F7F3E9] hover:bg-[#EFE9DC] border border-[#176B45]/20 text-xs font-extrabold text-[#104B34] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة عطلة أو إجازة</span>
            </button>
          </div>

          {exceptions.length > 0 && (
            <div className="divide-y divide-[#176B45]/10 border border-[#176B45]/10 rounded-xl overflow-hidden">
              {exceptions.map((exc) => (
                <div
                  key={exc.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <p className="font-bold text-[#18221D]">{exc.label}</p>
                    <p className="text-[#5C6B63] tabular-nums">
                      {exc.date} · {exc.isClosed ? 'مغلق' : `${exc.openTime} - ${exc.closeTime}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setExceptions((prev) => prev.filter((item) => item.id !== exc.id))
                    }
                    className="text-red-600 hover:text-red-800 p-1 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
