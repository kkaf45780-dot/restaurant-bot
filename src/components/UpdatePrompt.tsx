import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 lg:bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-50 bg-[#104B34] dark:bg-[#14201B] text-white rounded-2xl border border-[#C5A46D]/50 shadow-xl p-4 flex items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <p className="text-xs sm:text-sm font-extrabold">يتوفر تحديث جديد للتطبيق</p>
        <p className="text-[11px] text-white/80 mt-0.5">
          حدّث الآن للحصول على أحدث الميزات وإصلاحات الأمان.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="min-h-[38px] px-3.5 rounded-xl bg-[#C5A46D] hover:bg-[#b5945d] text-[#104B34] text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>تحديث الآن</span>
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          aria-label="إغلاق إشعار التحديث"
          className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
