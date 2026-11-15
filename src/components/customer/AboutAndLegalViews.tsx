import {
  Clock,
  FileText,
  MapPin,
  MessageCircle,
  Phone,
  QrCode,
  ShieldCheck,
  Store,
  Truck,
} from 'lucide-react';
import { formatTimeArabic12h, type RestaurantHoursStatus } from '../../lib/hours.ts';
import type { DeliveryZone, Restaurant, RestaurantBranch } from '../../types/restaurant.ts';

interface AboutViewProps {
  restaurant: Restaurant;
  hoursStatus: RestaurantHoursStatus;
  branches: RestaurantBranch[];
  deliveryZones: DeliveryZone[];
  onOpenShareQr: () => void;
  onGoMenu: () => void;
  onGoChat: () => void;
}

export function AboutView({
  restaurant,
  hoursStatus,
  branches,
  deliveryZones,
  onOpenShareQr,
  onGoMenu,
  onGoChat,
}: AboutViewProps) {
  const cleanWhatsapp = restaurant.whatsappNumber.replace(/[^\d]/g, '');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header Banner */}
      <div className="bg-[#104B34] text-white rounded-3xl p-7 sm:p-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-8 space-y-3">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-bold">
            <Store className="w-3.5 h-3.5 text-[#C5A46D]" />
            <span>نبذة عن المطعم ومناطق الخدمة</span>
          </span>
          <h1 className="text-2xl sm:text-4xl font-extrabold">{restaurant.name}</h1>
          <p className="text-sm sm:text-base text-white/85 leading-relaxed max-w-2xl">
            {restaurant.description}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={onGoMenu}
              className="h-11 px-6 rounded-full bg-white text-[#104B34] hover:bg-[#F7F3E9] text-xs font-extrabold cursor-pointer"
            >
              تصفح القائمة
            </button>
            <button
              type="button"
              onClick={onGoChat}
              className="h-11 px-6 rounded-full bg-[#176B45] hover:bg-[#197B4F] border border-white/20 text-white text-xs font-extrabold cursor-pointer"
            >
              تحدث مع الموظف الذكي
            </button>
            <button
              type="button"
              onClick={onOpenShareQr}
              className="h-11 px-5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
              <span>مشاركة ورمز QR</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white/10 border border-white/15 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/75">الحالة الآن</span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                hoursStatus.isOpen ? 'bg-[#16A34A] text-white' : 'bg-[#DC2626] text-white'
              }`}
            >
              {hoursStatus.isOpen ? 'مفتوح الآن' : 'مغلق الآن'}
            </span>
          </div>
          <p className="text-xs text-white/90 leading-relaxed">{hoursStatus.reasonText}</p>
          <div className="pt-2 border-t border-white/15 space-y-2 text-xs">
            <p className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-[#C5A46D]" />
              <span dir="ltr">{restaurant.phone}</span>
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#C5A46D]" />
              <span>{restaurant.address}</span>
            </p>
            {cleanWhatsapp && (
              <a
                href={`https://wa.me/${cleanWhatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#4ADE80] hover:underline font-bold pt-1"
              >
                <MessageCircle className="w-4 h-4" />
                <span>تواصل مباشر عبر واتساب</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Branches + Weekly Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Branches */}
        <div className="lg:col-span-7 bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-6 space-y-4">
          <h2 className="text-lg font-extrabold text-[#18221D] dark:text-[#ECF3EF] flex items-center gap-2">
            <MapPin className="w-5 h-5 text-[#176B45]" />
            <span>فروع المطعم ({branches.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {branches.map((branch) => (
              <div
                key={branch.id}
                className="bg-[#F7F3E9] dark:bg-[#0E1713] rounded-xl p-4 border border-[#176B45]/10 dark:border-[#2A3F35] space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
                    {branch.name}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      branch.isOpen
                        ? 'bg-[#DCFCE7] text-[#15803D]'
                        : 'bg-[#FEE2E2] text-[#B91C1C]'
                    }`}
                  >
                    {branch.isOpen ? 'متاح' : 'مغلق'}
                  </span>
                </div>
                <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">{branch.address}</p>
                <p className="text-xs text-[#18221D] dark:text-[#ECF3EF]" dir="ltr">
                  {branch.phone}
                </p>
                <p className="text-[11px] font-semibold text-[#176B45] dark:text-[#4ADE80]">
                  {branch.hoursText}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Weekly Hours */}
        <div className="lg:col-span-5 bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-6 space-y-4">
          <h2 className="text-lg font-extrabold text-[#18221D] dark:text-[#ECF3EF] flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#176B45]" />
            <span>مواعيد العمل الأسبوعية</span>
          </h2>
          <div className="divide-y divide-[#176B45]/10 dark:divide-[#2A3F35]">
            {restaurant.weeklySchedule.map((slot) => (
              <div key={slot.day} className="py-2.5 flex items-center justify-between text-xs">
                <span className="font-bold text-[#18221D] dark:text-[#ECF3EF]">{slot.labelAr}</span>
                {!slot.isClosed ? (
                  <span className="font-semibold text-[#176B45] dark:text-[#4ADE80]">
                    {formatTimeArabic12h(slot.openTime)} - {formatTimeArabic12h(slot.closeTime)}
                  </span>
                ) : (
                  <span className="text-[#B91C1C] font-bold">إجازة</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Delivery Zones */}
      <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-6 space-y-4">
        <h2 className="text-lg font-extrabold text-[#18221D] dark:text-[#ECF3EF] flex items-center gap-2">
          <Truck className="w-5 h-5 text-[#176B45]" />
          <span>مناطق ورسوم التوصيل</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead>
              <tr className="bg-[#F7F3E9] dark:bg-[#0E1713] text-[#5C6B63] dark:text-[#A3B8AE]">
                <th className="py-3 px-4 rounded-r-xl">المنطقة</th>
                <th className="py-3 px-4">رسوم التوصيل</th>
                <th className="py-3 px-4">الحد الأدنى للطلب</th>
                <th className="py-3 px-4 rounded-l-xl">الوقت المتوقع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#176B45]/10 dark:divide-[#2A3F35]">
              {deliveryZones
                .filter((z) => z.isActive)
                .map((zone) => (
                  <tr key={zone.id}>
                    <td className="py-3 px-4 font-bold text-[#18221D] dark:text-[#ECF3EF]">
                      {zone.name}
                    </td>
                    <td className="py-3 px-4 font-bold text-[#176B45] dark:text-[#4ADE80] tabular-nums">
                      {zone.fee} {restaurant.systemSettings.currencyLabel}
                    </td>
                    <td className="py-3 px-4 text-[#5C6B63] dark:text-[#A3B8AE] tabular-nums">
                      {zone.minOrderAmount} {restaurant.systemSettings.currencyLabel}
                    </td>
                    <td className="py-3 px-4 text-[#5C6B63] dark:text-[#A3B8AE]">
                      {zone.estimatedMinutes}
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

interface LegalPageViewProps {
  mode: 'privacy' | 'terms';
  restaurant: Restaurant;
  onGoMenu: () => void;
}

export function LegalPageView({ mode, restaurant, onGoMenu }: LegalPageViewProps) {
  const isPrivacy = mode === 'privacy';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#176B45]/10 text-[#176B45] dark:text-[#4ADE80] flex items-center justify-center">
            {isPrivacy ? <ShieldCheck className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
              {isPrivacy ? 'سياسة الخصوصية' : 'شروط الاستخدام'}
            </h1>
            <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
              {restaurant.name} — نظام موظف المطعم
            </p>
          </div>
        </div>

        {isPrivacy ? (
          <div className="space-y-4 text-sm text-[#2D3B34] dark:text-[#D1DFD8] leading-relaxed">
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                1. البيانات التي نجمعها
              </h2>
              <p>
                نجمع فقط البيانات اللازمة لتنفيذ طلبك وتوصيله إليك، وتشمل: الاسم، رقم الهاتف للتواصل،
                عنوان التوصيل، تفاصيل الطلب، والملاحظات التي تضيفها بنفسك.
              </p>
            </section>
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                2. عدم تخزين بيانات بطاقات الدفع
              </h2>
              <p>
                الدفع متاح نقداً عند الاستلام، ولا يطلب التطبيق أو يخزن أي بيانات خاصة بالبطاقات
                البنكية.
              </p>
            </section>
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                3. التخزين المحلي والعمل دون إنترنت
              </h2>
              <p>
                يحتفظ متصفحك بنسخة محلية من السلة، الأطباق المفضلة، سجل طلباتك، وآخر قائمة طعام
                متاحة حتى تتمكن من تصفح المنيو عند انقطاع الإنترنت. لا يتم إرسال أي طلب إلا عند وجود
                اتصال فعلي بالخادم.
              </p>
            </section>
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">4. التواصل</h2>
              <p>
                لأي استفسار حول بيانات طلباتك يمكنك التواصل مع إدارة {restaurant.name} على الرقم:{' '}
                <span dir="ltr" className="font-bold">
                  {restaurant.phone}
                </span>
                .
              </p>
            </section>
          </div>
        ) : (
          <div className="space-y-4 text-sm text-[#2D3B34] dark:text-[#D1DFD8] leading-relaxed">
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                1. تأكيد الطلبات والأسعار
              </h2>
              <p>
                تُحتسب جميع الأسعار، الإضافات، الخصومات، ورسوم التوصيل تلقائياً داخل النظام وفق
                الأسعار المعتمدة في قائمة الطعام. يعد تسجيل الطلب استلاماً مبدئياً ويتم اعتماده
                وتحضيره من قِبل فريق المطعم.
              </p>
            </section>
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                2. التوصيل والحد الأدنى للطلب
              </h2>
              <p>
                تختلف رسوم التوصيل والوقت المتوقع والحد الأدنى للطلب حسب منطقة التوصيل المختارة.
                في حالة اختيار الاستلام من الفرع لا تُفرض أي رسوم توصيل.
              </p>
            </section>
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                3. استخدام المساعد الذكي
              </h2>
              <p>
                يعرض المساعد الذكي الأسعار والمواعيد والتوافر المباشر من قاعدة بيانات المطعم. يُرجى
                مراجعة ملخص الطلب النهائي في صفحة إتمام الطلب قبل الإرسال.
              </p>
            </section>
            <section className="space-y-1.5">
              <h2 className="font-extrabold text-[#104B34] dark:text-[#4ADE80]">
                4. التعديلات والإلغاء
              </h2>
              <p>
                لطلب تعديل أو إلغاء بعد إرسال الطلب يُرجى التواصل مباشرة عبر واتساب المطعم قبل بدء
                تجهيز الطلب.
              </p>
            </section>
          </div>
        )}

        <div className="pt-4 border-t border-[#176B45]/10 dark:border-[#2A3F35]">
          <button
            type="button"
            onClick={onGoMenu}
            className="min-h-[42px] px-6 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-bold cursor-pointer"
          >
            العودة إلى قائمة الطعام
          </button>
        </div>
      </div>
    </div>
  );
}
