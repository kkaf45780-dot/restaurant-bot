import { ArrowRight, KeyRound, Lock } from 'lucide-react';
import { useState } from 'react';
import { adminLoginLocal } from '../../lib/api.ts';
import { isSupabaseClientConfigured, supabase } from '../../lib/supabase.ts';

interface AdminLoginProps {
  demoAdminEmail: string;
  onSuccess: (token: string, email: string) => void;
  onBackToStore: () => void;
}

export function AdminLogin({
  demoAdminEmail,
  onSuccess,
  onBackToStore,
}: AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password) {
      setErrorMsg('يُرجى إدخال البريد الإلكتروني وكلمة المرور.');
      return;
    }

    setLoading(true);
    try {
      if (isSupabaseClientConfigured && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (!error && data.session?.access_token) {
          onSuccess(data.session.access_token, data.user?.email ?? email.trim());
          return;
        }
        if (error) {
          // Allow fallback to local admin check if configured for demo testing
          try {
            const localRes = await adminLoginLocal(email.trim(), password);
            onSuccess(localRes.token, localRes.email);
            return;
          } catch {
            throw new Error('بيانات الدخول غير صحيحة. تأكد من البريد الإلكتروني وكلمة المرور.');
          }
        }
      }

      const res = await adminLoginLocal(email.trim(), password);
      onSuccess(res.token, res.email);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر تسجيل الدخول، حاول مرة أخرى.'
      );
    } finally {
      setLoading(false);
    }
  };

  const fillDemoCredentials = () => {
    setEmail(demoAdminEmail || 'admin@hara-grill.eg');
    setPassword('Admin@1234');
  };

  return (
    <div className="min-h-screen bg-[#F8F5EE] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#1B4D3E]/15 p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="w-11 h-11 rounded-xl bg-[#1B4D3E] text-white flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <button
            type="button"
            onClick={onBackToStore}
            className="min-h-[40px] px-3 rounded-xl text-xs font-bold text-[#1B4D3E] hover:bg-[#FAF7F0] flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة لواجهة العميل</span>
          </button>
        </div>

        <div>
          <h1 className="text-xl font-extrabold text-[#18221D]">لوحة تحكم مدير المطعم</h1>
          <p className="text-sm text-[#5C6B63] mt-1">
            سجّل الدخول لإدارة المنيو، الأسعار، الطلبات، ومواعيد العمل وإعدادات الموظف الذكي.
          </p>
        </div>

        {!isSupabaseClientConfigured && (
          <div className="rounded-xl bg-[#FAF7F0] border border-[#1B4D3E]/15 p-3.5 text-xs text-[#35443C] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[#1B4D3E] flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                <span>الوضع التجريبي المحلي مفعّل</span>
              </span>
              <button
                type="button"
                onClick={fillDemoCredentials}
                className="text-xs font-bold text-[#1B4D3E] underline cursor-pointer"
              >
                تعبئة بيانات الدخول التجريبية
              </button>
            </div>
            <p className="text-[#5C6B63] leading-relaxed">
              البريد: <span dir="ltr" className="font-mono font-semibold">{demoAdminEmail}</span> · كلمة المرور الافتراضية: <span dir="ltr" className="font-mono font-semibold">Admin@1234</span>
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#35443C] mb-1.5">
              البريد الإلكتروني للمدير
            </label>
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@hara-grill.eg"
              className="w-full h-11 px-3.5 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/15 text-sm text-[#18221D] text-left focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]/25"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#35443C] mb-1.5">
              كلمة المرور
            </label>
            <input
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 px-3.5 rounded-xl bg-[#F8F5EE] border border-[#1B4D3E]/15 text-sm text-[#18221D] text-left focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]/25"
            />
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-[#FEE2E2]/70 border border-[#B91C1C]/20 p-3 text-xs font-semibold text-[#991B1B]">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[48px] rounded-xl bg-[#1B4D3E] hover:bg-[#143B2F] disabled:opacity-50 text-white text-sm font-bold transition-colors cursor-pointer"
          >
            {loading ? 'جاري التحقق...' : 'دخول إلى لوحة التحكم'}
          </button>
        </form>
      </div>
    </div>
  );
}
