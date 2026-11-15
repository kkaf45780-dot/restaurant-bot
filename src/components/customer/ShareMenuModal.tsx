import { Check, Copy, QrCode, Share2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

interface ShareMenuModalProps {
  restaurantName: string;
  onClose: () => void;
}

export function ShareMenuModal({ restaurantName, onClose }: ShareMenuModalProps) {
  const [targetPath, setTargetPath] = useState<'/menu' | '/chat' | '/'>('/menu');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${targetPath}` : targetPath;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#104B34', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [shareUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: restaurantName,
          text: `تصفح قائمة الطعام واطلب مباشرة من ${restaurantName}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled share
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#14201B] w-full max-w-md rounded-2xl border border-[#176B45]/15 dark:border-[#2A3F35] shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#176B45]/10 text-[#176B45] dark:text-[#4ADE80] flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
                مشاركة قائمة {restaurantName}
              </h2>
              <p className="text-xs text-[#5C6B63] dark:text-[#A3B8AE]">
                امسح رمز QR لفتح القائمة فوراً أو انسخ الرابط.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-9 h-9 rounded-xl bg-[#F3F4F2] dark:bg-[#1C2B25] text-[#5C6B63] dark:text-[#A3B8AE] flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target Switch */}
        <div className="grid grid-cols-3 gap-2 bg-[#F7F3E9] dark:bg-[#0E1713] p-1 rounded-xl">
          {[
            { path: '/menu' as const, label: 'قائمة الطعام' },
            { path: '/chat' as const, label: 'المساعد الذكي' },
            { path: '/' as const, label: 'الرئيسية' },
          ].map((opt) => (
            <button
              key={opt.path}
              type="button"
              onClick={() => setTargetPath(opt.path)}
              className={`py-2 px-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                targetPath === opt.path
                  ? 'bg-[#176B45] text-white'
                  : 'text-[#5C6B63] dark:text-[#A3B8AE] hover:text-[#18221D] dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* QR Code Preview */}
        <div className="bg-[#F7F3E9] dark:bg-[#0E1713] rounded-2xl p-6 flex flex-col items-center justify-center border border-[#176B45]/10 dark:border-[#2A3F35]">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`رمز QR لـ ${restaurantName}`}
              className="w-48 h-48 rounded-xl bg-white p-2 shadow-sm"
            />
          ) : (
            <div className="w-48 h-48 rounded-xl bg-white flex items-center justify-center text-xs text-[#5C6B63]">
              جاري إنشاء الرمز...
            </div>
          )}
          <p className="text-[11px] font-mono text-[#5C6B63] dark:text-[#A3B8AE] mt-3 break-all text-center">
            {shareUrl}
          </p>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[44px] rounded-xl bg-[#F3F4F2] dark:bg-[#1C2B25] hover:bg-[#E7EBE8] text-[#18221D] dark:text-[#ECF3EF] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-[#16A34A]" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'تم النسخ!' : 'نسخ الرابط'}</span>
          </button>
          <button
            type="button"
            onClick={handleNativeShare}
            className="min-h-[44px] rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>مشاركة سريعة</span>
          </button>
        </div>
      </div>
    </div>
  );
}
