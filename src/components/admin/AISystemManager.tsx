import { useState } from 'react';
import { adminUpdatePassword } from '../../lib/api.ts';
import type {
  AILogEntry,
  AISettings,
  AITone,
  Restaurant,
  ServiceConfigStatus,
  SystemSettings,
} from '../../types/restaurant.ts';

interface AISettingsSectionProps {
  restaurant: Restaurant;
  aiLogs: AILogEntry[];
  configStatus: ServiceConfigStatus;
  onSave: (patch: Partial<Restaurant>) => Promise<void>;
}

export function AISettingsSection({
  restaurant,
  aiLogs,
  configStatus,
  onSave,
}: AISettingsSectionProps) {
  const [ai, setAi] = useState<AISettings>(restaurant.aiSettings);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ aiSettings: ai });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-[#18221D]">إعدادات الموظف الذكي</h2>
        <p className="text-sm text-[#5C6B63] mt-1">
          تحكم في تشغيل الموظف الذكي، رسالة الترحيب، أسلوب الرد، ونموذج الذكاء الاصطناعي.
        </p>
      </div>

      {!configStatus.geminiConfigured && (
        <div className="rounded-2xl bg-[#FEF3C7]/70 border border-[#B45309]/20 p-4 text-xs text-[#92400E] leading-relaxed">
          ملاحظة: لم يتم تعيين متغير البيئة GEMINI_API_KEY على الخادم بعد. يعمل المساعد حالياً برسالة بديلة آمنة، وعند إضافة المفتاح في إعدادات الخادم (Secrets) سيعمل الذكاء الاصطناعي فوراً.
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="bg-white rounded-2xl border border-[#1B4D3E]/10 p-5 space-y-5"
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#1B4D3E]/10">
          <div>
            <p className="text-sm font-bold text-[#18221D]">تفعيل الموظف الذكي للعملاء</p>
            <p className="text-xs text-[#5C6B63]">
              عند الإيقاف، يظهر تنويه للعميل باستخدام المنيو أو واتساب مباشرة.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAi((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold cursor-pointer ${
              ai.enabled ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEE2E2] text-[#991B1B]'
            }`}
          >
            {ai.enabled ? 'مفعّل' : 'متوقف'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">
              نموذج Gemini المستخدم
            </label>
            <select
              value={ai.model}
              onChange={(e) =>
                setAi((prev) => ({
                  ...prev,
                  model: e.target.value as AISettings['model'],
                }))
              }
              className="w-full h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm"
            >
              <option value="gemini-4-hydrogen">gemini-4-hydrogen (الافتراضي المتوازن)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (فائق السرعة)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">أسلوب الرد</label>
            <select
              value={ai.tone}
              onChange={(e) =>
                setAi((prev) => ({ ...prev, tone: e.target.value as AITone }))
              }
              className="w-full h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm"
            >
              <option value="friendly_egyptian">عامية مصرية ودودة وطبيعية</option>
              <option value="concise_practical">مختصر وعملي ومباشر</option>
              <option value="warm_detailed">ترحيبي ومفصل</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">رسالة الترحيب</label>
          <textarea
            rows={2}
            value={ai.welcomeMessage}
            onChange={(e) => setAi((prev) => ({ ...prev, welcomeMessage: e.target.value }))}
            className="w-full p-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-[#5C6B63]">
            المعلومات المسموح للموظف الذكي باستخدامها:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
            {[
              { key: 'menuAndPrices', label: 'عرض المنيو والأسعار' },
              { key: 'workingHours', label: 'الرد عن مواعيد العمل' },
              { key: 'deliveryZones', label: 'توضيح مناطق ورسوم التوصيل' },
              { key: 'orderIntake', label: 'استقبال وتسجيل الطلبات بالمحادثة' },
            ].map((topic) => (
              <label
                key={topic.key}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-[#FAF7F0] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={
                    ai.allowedTopics[topic.key as keyof AISettings['allowedTopics']]
                  }
                  onChange={(e) =>
                    setAi((prev) => ({
                      ...prev,
                      allowedTopics: {
                        ...prev.allowedTopics,
                        [topic.key]: e.target.checked,
                      },
                    }))
                  }
                  className="w-4 h-4 accent-[#1B4D3E]"
                />
                <span className="text-xs font-bold text-[#18221D]">{topic.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#5C6B63] mb-1">
            توجيهات إضافية للموظف الذكي
          </label>
          <textarea
            rows={2}
            value={ai.customInstructions}
            onChange={(e) => setAi((prev) => ({ ...prev, customInstructions: e.target.value }))}
            className="w-full p-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 rounded-xl bg-[#1B4D3E] hover:bg-[#143B2F] text-white text-sm font-bold cursor-pointer disabled:opacity-50"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ إعدادات الموظف الذكي'}
          </button>
        </div>
      </form>

      {/* AI Logs & Monitoring */}
      <div className="bg-white rounded-2xl border border-[#1B4D3E]/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1B4D3E]/10 flex items-center justify-between">
          <h3 className="text-base font-bold text-[#18221D]">
            سجل الاستهلاك والأخطاء للذكاء الاصطناعي
          </h3>
          <span className="text-xs font-semibold text-[#5C6B63] tabular-nums">
            آخر {aiLogs.length} طلبات
          </span>
        </div>

        {aiLogs.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#5C6B63]">
            لم يتم تسجيل محادثات بعد في هذه الجلسة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-[#FAF7F0] font-bold text-[#5C6B63]">
                <tr>
                  <th className="py-2.5 px-4">الوقت</th>
                  <th className="py-2.5 px-4">النموذج</th>
                  <th className="py-2.5 px-4">الحالة</th>
                  <th className="py-2.5 px-4">المدة</th>
                  <th className="py-2.5 px-4">مقتطف الرسالة / الملاحظة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1B4D3E]/10">
                {aiLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 tabular-nums text-[#5C6B63]">
                      {new Date(log.timestamp).toLocaleTimeString('ar-EG')}
                    </td>
                    <td className="py-2.5 px-4 font-mono">{log.model}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          log.status === 'success'
                            ? 'bg-[#DCFCE7] text-[#166534]'
                            : log.status === 'fallback'
                              ? 'bg-[#FEF3C7] text-[#92400E]'
                              : 'bg-[#FEE2E2] text-[#991B1B]'
                        }`}
                      >
                        {log.status === 'success'
                          ? 'ناجح'
                          : log.status === 'fallback'
                            ? 'بديل'
                            : 'خطأ'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 tabular-nums">{log.latencyMs} ms</td>
                    <td className="py-2.5 px-4 text-[#18221D]">
                      {log.errorMessage ? `${log.userMessagePreview} — (${log.errorMessage})` : log.userMessagePreview}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface SystemSettingsSectionProps {
  token: string;
  restaurant: Restaurant;
  configStatus: ServiceConfigStatus;
  onSave: (patch: Partial<Restaurant>) => Promise<void>;
  onNotify: (type: 'success' | 'error', text: string) => void;
}

export function SystemSettingsSection({
  token,
  restaurant,
  configStatus,
  onSave,
  onNotify,
}: SystemSettingsSectionProps) {
  const [sys, setSys] = useState<SystemSettings>(restaurant.systemSettings);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);

  const handleSaveSystem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ systemSettings: sys });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPass(true);
    try {
      await adminUpdatePassword(token, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      onNotify('success', 'تم تحديث كلمة مرور المدير بنجاح.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تغيير كلمة المرور.'
      );
    } finally {
      setChangingPass(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-[#18221D]">إعدادات النظام والربط</h2>
        <p className="text-sm text-[#5C6B63] mt-1">
          ضبط العملة والمنطقة الزمنية وحالة الاتصال بقواعد البيانات والذكاء الاصطناعي.
        </p>
      </div>

      {/* System Settings Form */}
      <form
        onSubmit={handleSaveSystem}
        className="bg-white rounded-2xl border border-[#1B4D3E]/10 p-5 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">رمز العملة الظاهر</label>
            <input
              type="text"
              value={sys.currencyLabel}
              onChange={(e) => setSys((p) => ({ ...p, currencyLabel: e.target.value }))}
              className="w-full h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">كود العملة</label>
            <input
              type="text"
              dir="ltr"
              value={sys.currencyCode}
              onChange={(e) => setSys((p) => ({ ...p, currencyCode: e.target.value }))}
              className="w-full h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm text-left"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">المنطقة الزمنية</label>
            <select
              value={sys.timezone}
              onChange={(e) => setSys((p) => ({ ...p, timezone: e.target.value }))}
              className="w-full h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm"
            >
              <option value="Africa/Cairo">Africa/Cairo (القاهرة)</option>
              <option value="Asia/Riyadh">Asia/Riyadh (الرياض)</option>
              <option value="Asia/Dubai">Asia/Dubai (دبي)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#5C6B63] mb-1">
              بريد الدعم والتواصل
            </label>
            <input
              type="email"
              dir="ltr"
              value={sys.supportEmail}
              onChange={(e) => setSys((p) => ({ ...p, supportEmail: e.target.value }))}
              className="w-full h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm text-left"
            />
          </div>

          <label className="flex items-center gap-2.5 pt-6 cursor-pointer">
            <input
              type="checkbox"
              checked={sys.allowOrdersWhenClosed}
              onChange={(e) =>
                setSys((p) => ({ ...p, allowOrdersWhenClosed: e.target.checked }))
              }
              className="w-4 h-4 accent-[#1B4D3E]"
            />
            <span className="text-sm font-semibold text-[#18221D]">
              السماح بتسجيل الطلبات المسبقة أثناء إغلاق المطعم
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 rounded-xl bg-[#1B4D3E] hover:bg-[#143B2F] text-white text-sm font-bold cursor-pointer disabled:opacity-50"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ إعدادات النظام'}
          </button>
        </div>
      </form>

      {/* External Integrations Status */}
      <div className="bg-white rounded-2xl border border-[#1B4D3E]/10 p-5 space-y-4">
        <h3 className="text-base font-bold text-[#18221D]">حالة ربط الخدمات الخارجية</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="rounded-xl bg-[#FAF7F0] p-4 space-y-1.5">
            <div className="flex justify-between font-bold">
              <span>قاعدة البيانات والتخزين (Supabase)</span>
              <span
                className={
                  configStatus.supabaseConfigured ? 'text-[#15803D]' : 'text-[#B45309]'
                }
              >
                {configStatus.supabaseConfigured ? 'متصل' : 'وضع محلي تجريبي'}
              </span>
            </div>
            <p className="text-[#5C6B63] leading-relaxed">
              {configStatus.supabaseConfigured
                ? 'تم ربط Supabase بنجاح لحفظ البيانات والمصادقة وتخزين الصور.'
                : 'يتم الحفظ حالياً في قاعدة البيانات المحلية الدائمة (.data/db.json). لربط Supabase، أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY ثم نفّذ ملف supabase/schema.sql.'}
            </p>
          </div>

          <div className="rounded-xl bg-[#FAF7F0] p-4 space-y-1.5">
            <div className="flex justify-between font-bold">
              <span>خدمة الذكاء الاصطناعي (Gemini API)</span>
              <span
                className={
                  configStatus.geminiConfigured ? 'text-[#15803D]' : 'text-[#B45309]'
                }
              >
                {configStatus.geminiConfigured ? 'متصل بالخادم' : 'غير مضبوط'}
              </span>
            </div>
            <p className="text-[#5C6B63] leading-relaxed">
              تتم جميع طلبات Gemini بأمان عبر الخادم فقط دون كشف أي مفاتيح في المتصفح.
            </p>
          </div>
        </div>
      </div>

      {/* Password Security (Local Mode) */}
      {configStatus.authMode === 'local' && (
        <form
          onSubmit={handlePasswordChange}
          className="bg-white rounded-2xl border border-[#1B4D3E]/10 p-5 space-y-4"
        >
          <h3 className="text-base font-bold text-[#18221D]">تغيير كلمة مرور المدير</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="password"
              dir="ltr"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="كلمة المرور الحالية"
              className="h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm text-left"
            />
            <input
              type="password"
              dir="ltr"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="كلمة المرور الجديدة (6 أحرف فأكثر)"
              className="h-11 px-3 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/10 text-sm text-left"
            />
          </div>
          <button
            type="submit"
            disabled={changingPass}
            className="min-h-[44px] px-5 rounded-xl bg-[#1B4D3E] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            {changingPass ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
          </button>
        </form>
      )}
    </div>
  );
}
