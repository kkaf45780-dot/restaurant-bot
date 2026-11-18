import { createClient } from '@supabase/supabase-js';
import { DEFAULT_RESTAURANT_ID } from './data/restaurant.ts';
import { evaluateRestaurantHours } from './lib/hours.ts';
import {
  ROLE_PERMISSIONS,
  hasPermission,
  type AdminTabPermission,
} from './lib/permissions.ts';
import { calculateOrderTotals } from './lib/pricing.ts';
import { buildWhatsAppOrderUrl } from './lib/whatsapp.ts';
import {
  type EdgeEnv,
  adjustItemStock,
  appendActivityLog,
  appendAiLog,
  createOrder,
  deleteBranch,
  deleteCategory,
  deleteCoupon,
  deleteDeliveryZone,
  deleteEmployee,
  deleteMenuItem,
  findEmployeeByEmail,
  findOrderByIdempotencyKey,
  findOrderByNumberOrId,
  findRestaurantBundle,
  getRestaurantBundle,
  incrementCouponUsage,
  isSupabaseBackendActive,
  listActivityLogs,
  listAiLogs,
  listCoupons,
  listCustomers,
  listEmployees,
  listInventoryMovements,
  listNotifications,
  listOrders,
  markNotificationsRead,
  rateOrder,
  reorderMenuItems,
  setAdminPassword,
  updateOrderStatus,
  updateRestaurant,
  uploadImageAsset,
  upsertBranch,
  upsertCategory,
  upsertCoupon,
  upsertDeliveryZone,
  upsertEmployee,
  upsertMenuItem,
  verifyAdminPassword,
  verifySupabaseAdminAccess,
} from './server/edgeStore.ts';
import {
  type KVStoreLike,
  checkSlidingRateLimit,
  extractClientIpFromHeaders,
  getSessionUnverifiedTurns,
  hashIpForLog,
  incrementDailyCounter,
  isForbiddenBypassToken,
  issueHumanChallenge,
  setSessionUnverifiedTurns,
  signOrderToken,
  verifyHumanChallenge,
  verifyOrderToken,
} from './server/chatSecurity.ts';
import { sanitizePublicBundle } from './server/publicSanitizer.ts';
import { runReceptionistChatCore } from './server/geminiCore.ts';
import {
  ALLOWED_AI_MODELS,
  type Coupon,
  type DeliveryZone,
  type Employee,
  type EmployeeRole,
  type FulfillmentType,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderDraftItem,
  type OrderStatus,
  type PublicConfigStatus,
  type RestaurantBranch,
  type ServiceConfigStatus,
} from './types/restaurant.ts';

const VALID_ROLES: EmployeeRole[] = ['owner', 'manager', 'cashier', 'kitchen'];
const DEFAULT_SESSION_SECRET = 'meshweyat-elhara-local-session-secret-2026';

function createKvAdapter(env: EdgeEnv): KVStoreLike | undefined {
  if (!env.RESTAURANT_DB) return undefined;
  return {
    get: async (key: string) => {
      const val = await env.RESTAURANT_DB!.get(key, 'text');
      return typeof val === 'string' ? val : null;
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      await env.RESTAURANT_DB!.put(key, value, options);
    },
  };
}

function withSecurityHeaders(
  response: Response,
  options?: { noStore?: boolean; isHtml?: boolean }
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'"
  );
  if (options?.noStore) {
    headers.set('Cache-Control', 'no-store');
  } else if (options?.isHtml) {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toBase64Url(new Uint8Array(sigBuffer));
}

async function signAdminToken(
  secret: string,
  email: string,
  role: EmployeeRole = 'owner'
): Promise<string> {
  const payloadJson = JSON.stringify({
    email,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
  const payload = toBase64Url(new TextEncoder().encode(payloadJson));
  const sig = await hmacSign(secret, payload);
  return `local.${payload}.${sig}`;
}

async function verifyLocalAdminToken(
  secret: string,
  token: string
): Promise<{ email: string; role: EmployeeRole } | null> {
  if (!token.startsWith('local.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payload, sig] = parts;
  const expectedSig = await hmacSign(secret, payload);
  if (sig !== expectedSig) return null;
  try {
    const decodedStr = new TextDecoder().decode(fromBase64Url(payload));
    const decoded = JSON.parse(decodedStr) as {
      email: string;
      role?: EmployeeRole;
      exp: number;
    };
    if (decoded.exp < Date.now()) return null;
    const role: EmployeeRole =
      decoded.role && VALID_ROLES.includes(decoded.role) ? decoded.role : 'owner';
    return { email: decoded.email, role };
  } catch {
    return null;
  }
}

function getSessionSecret(env: EdgeEnv): string {
  return env.ADMIN_SESSION_SECRET || DEFAULT_SESSION_SECRET;
}

async function verifyAdminRequest(
  request: Request,
  env: EdgeEnv
): Promise<{ email: string; role: EmployeeRole } | Response> {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return Response.json(
      { error: 'غير مصرح لك بالوصول. يُرجى تسجيل الدخول كمدير أولاً.' },
      { status: 401 }
    );
  }

  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey && !token.startsWith('local.')) {
    try {
      const sb = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await sb.auth.getUser(token);
      if (!error && data.user) {
        const userEmail = data.user.email ?? '';
        const access = await verifySupabaseAdminAccess(
          env,
          data.user.id,
          userEmail,
          DEFAULT_RESTAURANT_ID
        );
        if (!access.allowed) {
          return Response.json(
            { error: 'هذا الحساب غير مصرح له بإدارة لوحة التحكم.' },
            { status: 403 }
          );
        }
        return { email: userEmail || 'admin', role: access.role ?? 'owner' };
      }
    } catch {
      // Fall through to 401
    }
  }

  const localAdmin = await verifyLocalAdminToken(getSessionSecret(env), token);
  if (localAdmin) {
    return localAdmin;
  }

  return Response.json(
    { error: 'انتهت جلسة المدير أو بيانات الدخول غير صالحة.' },
    { status: 401 }
  );
}

function checkPermission(role: EmployeeRole, ...allowed: AdminTabPermission[]): Response | null {
  if (allowed.some((perm) => hasPermission(role, perm))) return null;
  return Response.json(
    { error: 'ليس لديك صلاحية تنفيذ هذا الإجراء بدورك الوظيفي الحالي.' },
    { status: 403 }
  );
}

function getServiceConfigStatus(env: EdgeEnv): ServiceConfigStatus {
  const geminiConfigured = Boolean(
    env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY;
  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnon);

  return {
    geminiConfigured,
    supabaseConfigured,
    storageMode: isSupabaseBackendActive(env) ? 'supabase' : 'local',
    authMode: supabaseConfigured ? 'supabase' : 'local',
  };
}

function getPublicConfigStatus(): PublicConfigStatus {
  return {
    ok: true,
    version: '2.0.0',
  };
}

async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

async function handleApiRequest(request: Request, env: EdgeEnv): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'GET' && pathname === '/api/health') {
    return Response.json({ ok: true, service: 'moazzaf-almatam', runtime: 'cloudflare-workers' });
  }

  if (method === 'GET' && pathname === '/api/config/status') {
    return Response.json(getPublicConfigStatus());
  }

  const kv = createKvAdapter(env);
  const clientIp = extractClientIpFromHeaders(request.headers);
  const secret = getSessionSecret(env);

  if (
    method === 'GET' &&
    (pathname === '/api/restaurant' || pathname.startsWith('/api/restaurant/'))
  ) {
    try {
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`rest:${ipHash}`, 60, 60, kv);
      if (!rl.allowed) {
        return Response.json(
          { error: 'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.' },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSeconds) },
          }
        );
      }
      const slug = pathname.slice('/api/restaurant'.length).replace(/^\//, '');
      const slugOrId = slug ? decodeURIComponent(slug) : DEFAULT_RESTAURANT_ID;
      const bundle = await findRestaurantBundle(env, slugOrId);
      if (!bundle) {
        return Response.json({ error: 'المطعم غير موجود' }, { status: 404 });
      }
      const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
      return Response.json({ bundle: sanitizePublicBundle(bundle), hoursStatus });
    } catch (err) {
      console.error('Error loading restaurant:', err);
      return Response.json(
        { error: 'تعذر تحميل بيانات المطعم حالياً، يُرجى المحاولة لاحقاً.' },
        { status: 500 }
      );
    }
  }

  if (method === 'POST' && pathname === '/api/coupons/validate') {
    try {
      const body = await readJsonBody<{
        restaurantId?: string;
        code?: string;
        items?: OrderDraftItem[];
        deliveryZoneId?: string;
        fulfillmentType?: FulfillmentType;
      }>(request);
      const {
        restaurantId = DEFAULT_RESTAURANT_ID,
        code,
        items = [],
        deliveryZoneId = '',
        fulfillmentType = 'delivery',
      } = body;
      const bundle = await findRestaurantBundle(env, String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        return Response.json({ error: 'المطعم غير موجود' }, { status: 404 });
      }
      const calc = calculateOrderTotals(
        items,
        bundle.items,
        deliveryZoneId,
        bundle.deliveryZones,
        {
          fulfillmentType,
          couponCode: code,
          coupons: bundle.activeCoupons,
        }
      );
      if (!calc.appliedCoupon) {
        return Response.json(
          { valid: false, error: calc.couponError || 'كود الخصم غير صالح.' },
          { status: 400 }
        );
      }
      return Response.json({
        valid: true,
        coupon: {
          id: calc.appliedCoupon.id,
          code: calc.appliedCoupon.code,
          description: calc.appliedCoupon.description,
          discountType: calc.appliedCoupon.discountType,
          discountValue: calc.appliedCoupon.discountValue,
        },
        discountAmount: calc.discountAmount,
        totals: calc,
      });
    } catch {
      return Response.json({ error: 'تعذر التحقق من كود الخصم حالياً.' }, { status: 500 });
    }
  }

  if (method === 'GET' && pathname === '/api/orders/track') {
    try {
      const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
      const orderNumber = (url.searchParams.get('orderNumber') || '').trim();
      const token = (url.searchParams.get('token') || '').trim();

      const bundle = await findRestaurantBundle(env, restaurantId);
      if (!bundle) {
        return Response.json({ error: 'المطعم غير موجود' }, { status: 404 });
      }

      if (!orderNumber) {
        return Response.json({ error: 'يُرجى إدخال رقم الطلب.' }, { status: 400 });
      }

      if (!token) {
        return Response.json(
          { error: 'رمز التتبع السري (orderToken) مطلوب.' },
          { status: 400 }
        );
      }

      const validToken = await verifyOrderToken(secret, token, bundle.restaurant.id, orderNumber);
      if (!validToken) {
        return Response.json(
          { error: 'رمز التتبع غير صالح أو منتهي الصلاحية.' },
          { status: 403 }
        );
      }

      const order = await findOrderByNumberOrId(env, bundle.restaurant.id, orderNumber);
      if (!order) {
        return Response.json({ error: 'لم يتم العثور على طلب بهذا الرقم.' }, { status: 404 });
      }
      return Response.json({ order });
    } catch {
      return Response.json({ error: 'تعذر البحث عن الطلب حالياً.' }, { status: 500 });
    }
  }

  const rateMatch = pathname.match(/^\/api\/orders\/([^/]+)\/rate$/);
  if (method === 'POST' && rateMatch) {
    try {
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`rate:${ipHash}`, 20, 60, kv);
      if (!rl.allowed) {
        return Response.json(
          { error: 'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.' },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSeconds) },
          }
        );
      }

      const orderNumber = decodeURIComponent(rateMatch[1]);
      const body = await readJsonBody<{
        restaurantId?: string;
        rating?: number;
        comment?: string;
        token?: string;
      }>(request);
      const { restaurantId = DEFAULT_RESTAURANT_ID, rating, comment = '', token = '' } = body;
      const bundle = await findRestaurantBundle(env, String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        return Response.json({ error: 'المطعم غير موجود' }, { status: 404 });
      }

      const cleanToken = String(token || '').trim();
      if (!cleanToken) {
        return Response.json(
          { error: 'رمز التتبع السري (orderToken) مطلوب لتقييم الطلب.' },
          { status: 400 }
        );
      }

      const validToken = await verifyOrderToken(secret, cleanToken, bundle.restaurant.id, orderNumber);
      if (!validToken) {
        return Response.json(
          { error: 'رمز التتبع غير صالح لتقييم هذا الطلب.' },
          { status: 403 }
        );
      }

      const numRating = Math.trunc(Number(rating));
      if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
        return Response.json({ error: 'يُرجى اختيار تقييم من 1 إلى 5 نجوم.' }, { status: 400 });
      }
      const updated = await rateOrder(
        env,
        bundle.restaurant.id,
        cleanToken,
        numRating,
        String(comment || ''),
        orderNumber
      );
      if (!updated) {
        return Response.json({ error: 'لم يتم العثور على الطلب.' }, { status: 404 });
      }
      return Response.json({ order: updated });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'تعذر تسجيل التقييم حالياً.' },
        { status: 400 }
      );
    }
  }

  if (method === 'GET' && pathname === '/api/chat/challenge') {
    try {
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`challenge:${ipHash}`, 20, 60, kv);
      if (!rl.allowed) {
        return Response.json(
          { error: 'تم إرسال طلبات تحقق كثيرة، يُرجى الانتظار قليلاً.' },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSeconds) },
          }
        );
      }
      const rawSessionId = (url.searchParams.get('sessionId') || '').trim();
      const sessionId = rawSessionId || `ip_${ipHash}`;
      const challenge = await issueHumanChallenge({
        secret,
        sessionId,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
        turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
      });
      return Response.json(challenge);
    } catch {
      return Response.json({ error: 'تعذر إنشاء تحدي التحقق البشري.' }, { status: 500 });
    }
  }

  if (method === 'POST' && pathname === '/api/chat') {
    try {
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`chat:${ipHash}`, 20, 60, kv);
      if (!rl.allowed) {
        console.warn(`[Security] Chat rate limit hit ipHash=${ipHash}`);
        return Response.json(
          {
            error:
              'تم إرسال رسائل كثيرة في وقت قصير. يُرجى الانتظار دقيقة ثم المحاولة مرة أخرى.',
          },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSeconds) },
          }
        );
      }

      const body = await readJsonBody<{
        restaurantId?: string;
        message?: string;
        history?: Array<{ role: 'user' | 'assistant'; text: string }>;
        orderDraft?: {
          items: OrderDraftItem[];
          fulfillmentType?: FulfillmentType;
          deliveryZoneId: string;
          branchId?: string;
          couponCode?: string;
          customerName: string;
          customerPhone: string;
          customerAddress: string;
          notes: string;
        };
        sessionId?: string;
        verification?: { mode?: string; token?: string; answer?: string };
        humanVerified?: boolean;
        verificationToken?: string;
      }>(request);

      const {
        restaurantId = DEFAULT_RESTAURANT_ID,
        message,
        history = [],
        orderDraft = {
          items: [],
          fulfillmentType: 'delivery',
          deliveryZoneId: '',
          customerName: '',
          customerPhone: '',
          customerAddress: '',
          notes: '',
        },
        sessionId: rawSessionId,
        verification,
        humanVerified,
        verificationToken,
      } = body;

      if (!message || typeof message !== 'string' || !message.trim()) {
        return Response.json({ error: 'يُرجى كتابة رسالة قبل الإرسال.' }, { status: 400 });
      }

      if (
        humanVerified === true ||
        isForbiddenBypassToken(verification?.token) ||
        isForbiddenBypassToken(verificationToken)
      ) {
        console.warn(`[Security] Rejected forged human verification token ipHash=${ipHash}`);
        return Response.json(
          { error: 'رمز التحقق البشري مرفوض وغير صالح.', captchaRequired: true },
          { status: 403 }
        );
      }

      const sessionKey =
        typeof rawSessionId === 'string' && rawSessionId.trim().length >= 4
          ? rawSessionId.trim().slice(0, 64)
          : `ip_${ipHash}`;

      const dailyIpCap = await incrementDailyCounter(`chat_ip:${ipHash}`, 200, kv);
      if (!dailyIpCap.allowed) {
        return Response.json(
          { error: 'تم تجاوز الحد اليومي للمحادثات لهذا العنوان.' },
          { status: 429 }
        );
      }
      const dailySessionCap = await incrementDailyCounter(`chat_sess:${sessionKey}`, 80, kv);
      if (!dailySessionCap.allowed) {
        return Response.json(
          { error: 'تم تجاوز الحد اليومي للرسائل في هذه الجلسة.' },
          { status: 429 }
        );
      }

      const unverifiedTurns = await getSessionUnverifiedTurns(sessionKey, kv);
      if (verification && typeof verification === 'object') {
        const check = await verifyHumanChallenge({
          secret,
          sessionId: sessionKey,
          verification,
          turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
          remoteIp: clientIp,
          kv,
        });
        if (!check.ok) {
          return Response.json(
            { error: check.error || 'فشل التحقق البشري.', captchaRequired: true },
            { status: 403 }
          );
        }
        await setSessionUnverifiedTurns(sessionKey, 0, kv);
      } else if (unverifiedTurns >= 5) {
        return Response.json(
          {
            error:
              'تم استنفاد الرسائل المجانية المتتالية للجلسة. يرجى إكمال التحقق البشري للمتابعة.',
            captchaRequired: true,
          },
          { status: 403 }
        );
      } else {
        await setSessionUnverifiedTurns(sessionKey, unverifiedTurns + 1, kv);
      }

      const globalDailyBudget = await incrementDailyCounter('gemini_calls_global', 1000, kv);
      if (!globalDailyBudget.allowed) {
        return Response.json(
          {
            error:
              'تم الوصول للحد اليومي لخدمة المساعد الذكي، يمكنك الطلب مباشرة من المنيو أو واتساب.',
          },
          { status: 429 }
        );
      }
      if (globalDailyBudget.usageRatio >= 0.8) {
        console.warn(
          `[Quota Alert] Global daily Gemini usage reached ${Math.round(globalDailyBudget.usageRatio * 100)}% (${globalDailyBudget.count}/1000)`
        );
      }

      const bundle = await findRestaurantBundle(env, String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        return Response.json({ error: 'المطعم غير موجود' }, { status: 404 });
      }

      const result = await runReceptionistChatCore({
        bundle,
        userMessage: message.trim(),
        history: Array.isArray(history) ? history : [],
        currentDraft: {
          fulfillmentType: 'delivery',
          ...orderDraft,
        },
        apiKey: env.GEMINI_API_KEY,
        onAiLog: (entry) => appendAiLog(env, entry),
      });

      return Response.json(result);
    } catch (err) {
      console.error('Chat endpoint error:', err);
      return Response.json(
        {
          error: 'حدث خطأ أثناء معالجة الرسالة، يمكنك التواصل معنا مباشرة عبر واتساب.',
        },
        { status: 500 }
      );
    }
  }

  if (method === 'POST' && pathname === '/api/orders') {
    try {
      const body = await readJsonBody<{
        restaurantId?: string;
        items?: OrderDraftItem[];
        fulfillmentType?: FulfillmentType;
        deliveryZoneId?: string;
        branchId?: string;
        couponCode?: string;
        customerName?: string;
        customerPhone?: string;
        customerAddress?: string;
        notes?: string;
        idempotencyKey?: string;
      }>(request);

      const {
        restaurantId = DEFAULT_RESTAURANT_ID,
        items = [],
        fulfillmentType = 'delivery',
        deliveryZoneId = '',
        branchId = '',
        couponCode = '',
        customerName,
        customerPhone,
        customerAddress = '',
        notes = '',
        idempotencyKey = '',
      } = body;

      const bundle = await findRestaurantBundle(env, String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        return Response.json({ error: 'المطعم غير موجود' }, { status: 404 });
      }

      if (idempotencyKey && typeof idempotencyKey === 'string') {
        const existing = await findOrderByIdempotencyKey(env, bundle.restaurant.id, idempotencyKey);
        if (existing) {
          const whatsappUrl = buildWhatsAppOrderUrl(
            bundle.restaurant.whatsappNumber,
            existing,
            bundle.restaurant.name,
            bundle.restaurant.systemSettings.currencyLabel
          );
          const orderToken = await signOrderToken(
            secret,
            bundle.restaurant.id,
            existing.orderNumber
          );
          return Response.json({ order: existing, whatsappUrl, orderToken, deduplicated: true });
        }
      }

      const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
      if (!hoursStatus.isOpen && !bundle.restaurant.systemSettings.allowOrdersWhenClosed) {
        return Response.json(
          {
            error: `عذراً، المطعم مغلق حالياً. ${hoursStatus.nextOpenText ? `نفتح ${hoursStatus.nextOpenText}.` : ''}`,
          },
          { status: 400 }
        );
      }

      if (!Array.isArray(items) || items.length === 0) {
        return Response.json(
          { error: 'سلة الطلبات فارغة. أضف صنفاً واحداً على الأقل.' },
          { status: 400 }
        );
      }

      if (!customerName || !String(customerName).trim()) {
        return Response.json({ error: 'يُرجى إدخال اسم العميل.' }, { status: 400 });
      }

      const cleanPhone = String(customerPhone || '').trim();
      if (!cleanPhone || cleanPhone.replace(/[^\d]/g, '').length < 8) {
        return Response.json(
          { error: 'يُرجى إدخال رقم هاتف صحيح للتواصل.' },
          { status: 400 }
        );
      }

      const cleanFulfillment: FulfillmentType =
        fulfillmentType === 'pickup' ? 'pickup' : 'delivery';

      if (cleanFulfillment === 'delivery' && (!customerAddress || !String(customerAddress).trim())) {
        return Response.json({ error: 'يُرجى إدخال العنوان بالتفصيل.' }, { status: 400 });
      }

      const calc = calculateOrderTotals(
        items,
        bundle.items,
        deliveryZoneId,
        bundle.deliveryZones,
        {
          fulfillmentType: cleanFulfillment,
          couponCode: String(couponCode || ''),
          coupons: bundle.activeCoupons,
        }
      );

      if (calc.unavailableItemNames.length > 0) {
        return Response.json(
          {
            error: `بعض الأصناف لم تعد متوفرة حالياً: ${calc.unavailableItemNames.join('، ')}`,
          },
          { status: 400 }
        );
      }

      if (calc.outOfStockItemNames.length > 0) {
        return Response.json(
          {
            error: `الكمية المطلوبة غير متوفرة في المخزون لـ: ${calc.outOfStockItemNames.join('، ')}`,
          },
          { status: 400 }
        );
      }

      if (calc.validItems.length === 0) {
        return Response.json({ error: 'لم يتم العثور على أصناف صالحة في الطلب.' }, { status: 400 });
      }

      if (cleanFulfillment === 'delivery' && !calc.deliveryZone) {
        return Response.json(
          {
            error: 'منطقة التوصيل المختارة غير متاحة حالياً. يُرجى اختيار منطقة متاحة.',
          },
          { status: 400 }
        );
      }

      if (cleanFulfillment === 'delivery' && calc.belowZoneMinimum && calc.deliveryZone) {
        return Response.json(
          {
            error: `الحد الأدنى للطلب في منطقة ${calc.deliveryZone.name} هو ${calc.deliveryZone.minOrderAmount} ${bundle.restaurant.systemSettings.currencyLabel}.`,
          },
          { status: 400 }
        );
      }

      const matchedBranch =
        bundle.branches.find((b) => b.id === branchId && b.isOpen) ??
        bundle.branches.find((b) => b.isOpen) ??
        bundle.branches[0];

      const nowIso = new Date().toISOString();
      const orderNumber = String(Math.floor(10000 + Math.random() * 89999));
      const orderToken = await signOrderToken(
        secret,
        bundle.restaurant.id,
        orderNumber
      );
      const newOrder: Order = {
        id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        orderNumber,
        orderToken,
        restaurantId: bundle.restaurant.id,
        customerName: String(customerName).trim(),
        customerPhone: cleanPhone,
        fulfillmentType: cleanFulfillment,
        deliveryZoneId: calc.deliveryZone?.id ?? '',
        deliveryZoneName:
          cleanFulfillment === 'pickup' ? 'استلام من الفرع' : calc.deliveryZone?.name ?? '',
        branchId: matchedBranch?.id,
        branchName: matchedBranch?.name ?? bundle.restaurant.name,
        customerAddress:
          cleanFulfillment === 'pickup'
            ? `استلام من: ${matchedBranch?.address ?? bundle.restaurant.address}`
            : String(customerAddress).trim(),
        notes: String(notes || '').trim(),
        items: calc.validItems,
        subtotal: calc.subtotal,
        discountAmount: calc.discountAmount,
        couponCode: calc.appliedCoupon?.code,
        deliveryFee: calc.deliveryFee,
        total: calc.total,
        paymentMethod: 'cash_on_delivery',
        paymentStatus: 'pending',
        estimatedDeliveryText:
          cleanFulfillment === 'pickup'
            ? '٢٠ - ٣٠ دقيقة للاستلام'
            : calc.deliveryZone?.estimatedMinutes ?? '٣٠ - ٤٥ دقيقة',
        stockDeducted: false,
        idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined,
        status: 'received',
        statusHistory: [{ status: 'received', timestamp: nowIso }],
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const savedOrder = await createOrder(env, newOrder);
      if (calc.appliedCoupon) {
        await incrementCouponUsage(env, bundle.restaurant.id, calc.appliedCoupon.code);
      }

      const whatsappUrl = buildWhatsAppOrderUrl(
        bundle.restaurant.whatsappNumber,
        savedOrder,
        bundle.restaurant.name,
        bundle.restaurant.systemSettings.currencyLabel
      );

      return Response.json(
        { order: savedOrder, whatsappUrl: whatsappUrl || '', orderToken },
        { status: 201 }
      );
    } catch (err) {
      console.error('Create order error:', err);
      return Response.json(
        { error: 'حدث خطأ غير متوقع أثناء تسجيل الطلب. حاول مرة أخرى.' },
        { status: 500 }
      );
    }
  }

  // =========================================================
  // Admin Auth & Protected Endpoints (/api/admin/*)
  // =========================================================

  if (method === 'POST' && pathname === '/api/admin/login') {
    try {
      const ipHash = await hashIpForLog(clientIp);
      const loginRl = await checkSlidingRateLimit(`admin_login:${ipHash}`, 10, 900, kv);
      if (!loginRl.allowed) {
        return Response.json(
          { error: 'تم تجاوز عدد محاولات تسجيل الدخول المسموح بها. يُرجى المحاولة لاحقاً.' },
          {
            status: 429,
            headers: { 'Retry-After': String(loginRl.retryAfterSeconds) },
          }
        );
      }

      const body = await readJsonBody<{ email?: string; password?: string }>(request);
      const cleanEmail = String(body.email || '').trim().toLowerCase();
      const cleanPass = String(body.password || '');
      const expectedEmail = (env.ADMIN_EMAIL || 'admin@hara-grill.eg').toLowerCase();
      const isPasswordValid = await verifyAdminPassword(env, cleanPass);

      if (cleanEmail === expectedEmail && isPasswordValid) {
        const role: EmployeeRole = 'owner';
        const token = await signAdminToken(secret, expectedEmail, role);
        return Response.json({
          token,
          email: expectedEmail,
          role,
          permissions: ROLE_PERMISSIONS[role],
        });
      }

      const employee = await findEmployeeByEmail(env, DEFAULT_RESTAURANT_ID, cleanEmail);
      if (employee && isPasswordValid) {
        const token = await signAdminToken(secret, employee.email, employee.role);
        return Response.json({
          token,
          email: employee.email,
          role: employee.role,
          permissions: ROLE_PERMISSIONS[employee.role],
        });
      }

      return Response.json(
        { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
        { status: 401 }
      );
    } catch {
      return Response.json({ error: 'تعذر التحقق من بيانات الدخول حالياً.' }, { status: 500 });
    }
  }

  if (pathname.startsWith('/api/admin/')) {
    const auth = await verifyAdminRequest(request, env);
    if (auth instanceof Response) return auth;

    if (method === 'GET' && pathname === '/api/admin/me') {
      return Response.json({
        authenticated: true,
        email: auth.email,
        role: auth.role,
        permissions: ROLE_PERMISSIONS[auth.role],
      });
    }

    if (method === 'GET' && pathname === '/api/admin/overview') {
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        const [
          bundle,
          orders,
          aiLogs,
          coupons,
          inventoryMovements,
          employees,
          activityLogs,
          notifications,
          customers,
        ] = await Promise.all([
          getRestaurantBundle(env, restaurantId),
          listOrders(env, restaurantId),
          listAiLogs(env, restaurantId),
          listCoupons(env, restaurantId),
          listInventoryMovements(env, restaurantId),
          listEmployees(env, restaurantId),
          listActivityLogs(env, restaurantId),
          listNotifications(env, restaurantId),
          listCustomers(env, restaurantId),
        ]);
        const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
        return Response.json({
          bundle,
          hoursStatus,
          orders,
          aiLogs,
          coupons,
          inventoryMovements,
          employees,
          activityLogs,
          notifications,
          customers,
          configStatus: getServiceConfigStatus(env),
        });
      } catch (err) {
        console.error('Admin overview error:', err);
        return Response.json({ error: 'تعذر تحميل بيانات لوحة التحكم.' }, { status: 500 });
      }
    }

    if (method === 'PUT' && pathname === '/api/admin/restaurant') {
      const denied = checkPermission(auth.role, 'settings', 'ai', 'system');
      if (denied) return denied;
      try {
        const body = await readJsonBody<{ restaurantId?: string } & Record<string, unknown>>(request);
        const { restaurantId = DEFAULT_RESTAURANT_ID, ...patch } = body;
        const aiPatch = patch.aiSettings as { model?: string } | undefined;
        if (aiPatch?.model && !(ALLOWED_AI_MODELS as readonly string[]).includes(String(aiPatch.model))) {
          return Response.json(
            { error: 'نموذج الذكاء الاصطناعي المختار غير مسموح به.' },
            { status: 400 }
          );
        }
        const updated = await updateRestaurant(env, restaurantId, patch);
        const hoursStatus = evaluateRestaurantHours(updated);
        await appendActivityLog(env, {
          id: `act_${Date.now()}`,
          restaurantId,
          actorName: auth.email || 'المدير',
          action: 'تحديث إعدادات المطعم',
          details: 'تم تعديل معلومات المطعم أو المواعيد أو إعدادات المساعد الذكي.',
          createdAt: new Date().toISOString(),
        });
        return Response.json({ restaurant: updated, hoursStatus });
      } catch {
        return Response.json({ error: 'تعذر حفظ بيانات المطعم.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/categories') {
      const denied = checkPermission(auth.role, 'menu');
      if (denied) return denied;
      try {
        const body = await readJsonBody<Record<string, unknown>>(request);
        const cat: MenuCategory = {
          id: String(body.id || `cat_${Date.now()}`),
          restaurantId: String(body.restaurantId || DEFAULT_RESTAURANT_ID),
          name: String(body.name || '').trim(),
          description: String(body.description || '').trim(),
          sortOrder: Number(body.sortOrder ?? 99),
        };
        if (!cat.name) return Response.json({ error: 'اسم القسم مطلوب.' }, { status: 400 });
        const saved = await upsertCategory(env, cat);
        return Response.json({ category: saved });
      } catch (err) {
        console.error('Upsert category error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر حفظ القسم.' },
          { status: 500 }
        );
      }
    }

    const delCatMatch = pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
    if (method === 'DELETE' && delCatMatch) {
      const denied = checkPermission(auth.role, 'menu');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        await deleteCategory(env, restaurantId, decodeURIComponent(delCatMatch[1]));
        return Response.json({ ok: true });
      } catch (err) {
        console.error('Delete category error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر حذف القسم.' },
          { status: 500 }
        );
      }
    }

    if (method === 'POST' && pathname === '/api/admin/items') {
      const denied = checkPermission(auth.role, 'menu');
      if (denied) return denied;
      try {
        const body = await readJsonBody<Record<string, unknown>>(request);
        const price = Number(body.price);
        if (!String(body.name || '').trim() || !Number.isFinite(price) || price < 0) {
          return Response.json({ error: 'يُرجى إدخال اسم الصنف وسعر صحيح.' }, { status: 400 });
        }
        const item: MenuItem = {
          id: String(body.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`),
          restaurantId: String(body.restaurantId || DEFAULT_RESTAURANT_ID),
          categoryId: String(body.categoryId),
          name: String(body.name).trim(),
          description: String(body.description || '').trim(),
          price,
          imageUrl: String(body.imageUrl || ''),
          isAvailable: body.isAvailable !== false,
          isPopular: Boolean(body.isPopular),
          stockQuantity: Math.max(0, Math.floor(Number(body.stockQuantity ?? 40))),
          lowStockThreshold: Math.max(1, Math.floor(Number(body.lowStockThreshold ?? 8))),
          sizes: Array.isArray(body.sizes) ? (body.sizes as MenuItem['sizes']) : [],
          extras: Array.isArray(body.extras) ? (body.extras as MenuItem['extras']) : [],
          sortOrder: Number(body.sortOrder ?? 99),
        };
        const saved = await upsertMenuItem(env, item);
        return Response.json({ item: saved });
      } catch (err) {
        console.error('Upsert item error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر حفظ الصنف.' },
          { status: 500 }
        );
      }
    }

    if (method === 'POST' && pathname === '/api/admin/items/reorder') {
      const denied = checkPermission(auth.role, 'menu');
      if (denied) return denied;
      try {
        const body = await readJsonBody<{ restaurantId?: string; orderedIds?: string[] }>(request);
        const { restaurantId = DEFAULT_RESTAURANT_ID, orderedIds = [] } = body;
        if (!Array.isArray(orderedIds)) {
          return Response.json({ error: 'بيانات الترتيب غير صالحة.' }, { status: 400 });
        }
        await reorderMenuItems(env, restaurantId, orderedIds);
        return Response.json({ ok: true });
      } catch (err) {
        console.error('Reorder items error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر حفظ ترتيب الأصناف.' },
          { status: 500 }
        );
      }
    }

    const delItemMatch = pathname.match(/^\/api\/admin\/items\/([^/]+)$/);
    if (method === 'DELETE' && delItemMatch) {
      const denied = checkPermission(auth.role, 'menu');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        await deleteMenuItem(env, restaurantId, decodeURIComponent(delItemMatch[1]));
        return Response.json({ ok: true });
      } catch (err) {
        console.error('Delete item error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر حذف الصنف.' },
          { status: 500 }
        );
      }
    }

    if (method === 'POST' && pathname === '/api/admin/inventory/adjust') {
      const denied = checkPermission(auth.role, 'inventory');
      if (denied) return denied;
      try {
        const body = await readJsonBody<{
          restaurantId?: string;
          itemId?: string;
          delta?: number;
          reason?: string;
        }>(request);
        const {
          restaurantId = DEFAULT_RESTAURANT_ID,
          itemId,
          delta,
          reason = 'تعديل مخزون يدوي',
        } = body;
        const numDelta = Math.trunc(Number(delta));
        if (!itemId || !Number.isFinite(numDelta) || numDelta === 0) {
          return Response.json(
            { error: 'يُرجى تحديد الصنف وكمية التعديل.' },
            { status: 400 }
          );
        }
        const updated = await adjustItemStock(env, {
          restaurantId,
          itemId: String(itemId),
          delta: numDelta,
          reason: String(reason).trim() || 'تعديل مخزون يدوي',
        });
        if (!updated) return Response.json({ error: 'الصنف غير موجود.' }, { status: 404 });
        return Response.json({ item: updated });
      } catch {
        return Response.json({ error: 'تعذر تعديل المخزون.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/delivery-zones') {
      const denied = checkPermission(auth.role, 'delivery');
      if (denied) return denied;
      try {
        const body = await readJsonBody<Record<string, unknown>>(request);
        const fee = Number(body.fee);
        const minOrderAmount = Math.max(0, Number(body.minOrderAmount ?? 0));
        if (!String(body.name || '').trim() || !Number.isFinite(fee) || fee < 0) {
          return Response.json(
            { error: 'يُرجى إدخال اسم المنطقة ورسوم توصيل صحيحة.' },
            { status: 400 }
          );
        }
        const zone: DeliveryZone = {
          id: String(body.id || `zone_${Date.now()}`),
          restaurantId: String(body.restaurantId || DEFAULT_RESTAURANT_ID),
          name: String(body.name).trim(),
          fee,
          minOrderAmount,
          estimatedMinutes: String(body.estimatedMinutes || '٣٠ - ٤٥ دقيقة').trim(),
          isActive: body.isActive !== false,
        };
        const saved = await upsertDeliveryZone(env, zone);
        return Response.json({ zone: saved });
      } catch {
        return Response.json({ error: 'تعذر حفظ منطقة التوصيل.' }, { status: 500 });
      }
    }

    const delZoneMatch = pathname.match(/^\/api\/admin\/delivery-zones\/([^/]+)$/);
    if (method === 'DELETE' && delZoneMatch) {
      const denied = checkPermission(auth.role, 'delivery');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        await deleteDeliveryZone(env, restaurantId, decodeURIComponent(delZoneMatch[1]));
        return Response.json({ ok: true });
      } catch {
        return Response.json({ error: 'تعذر حذف منطقة التوصيل.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/branches') {
      const denied = checkPermission(auth.role, 'delivery');
      if (denied) return denied;
      try {
        const body = await readJsonBody<Record<string, unknown>>(request);
        if (!String(body.name || '').trim()) {
          return Response.json({ error: 'يُرجى إدخال اسم الفرع.' }, { status: 400 });
        }
        const branch: RestaurantBranch = {
          id: String(body.id || `br_${Date.now()}`),
          restaurantId: String(body.restaurantId || DEFAULT_RESTAURANT_ID),
          name: String(body.name).trim(),
          address: String(body.address || '').trim(),
          phone: String(body.phone || '').trim(),
          hoursText: String(body.hoursText || '١٢:٠٠ م - ١٢:٠٠ ص').trim(),
          isOpen: body.isOpen !== false,
        };
        const saved = await upsertBranch(env, branch);
        return Response.json({ branch: saved });
      } catch {
        return Response.json({ error: 'تعذر حفظ بيانات الفرع.' }, { status: 500 });
      }
    }

    const delBranchMatch = pathname.match(/^\/api\/admin\/branches\/([^/]+)$/);
    if (method === 'DELETE' && delBranchMatch) {
      const denied = checkPermission(auth.role, 'delivery');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        await deleteBranch(env, restaurantId, decodeURIComponent(delBranchMatch[1]));
        return Response.json({ ok: true });
      } catch {
        return Response.json({ error: 'تعذر حذف الفرع.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/coupons') {
      const denied = checkPermission(auth.role, 'coupons');
      if (denied) return denied;
      try {
        const body = await readJsonBody<Record<string, unknown>>(request);
        const val = Number(body.discountValue);
        if (!String(body.code || '').trim() || !Number.isFinite(val) || val <= 0) {
          return Response.json(
            { error: 'يُرجى إدخال كود الخصم وقيمة خصم صحيحة.' },
            { status: 400 }
          );
        }
        const coupon: Coupon = {
          id: String(body.id || `cpn_${Date.now()}`),
          restaurantId: String(body.restaurantId || DEFAULT_RESTAURANT_ID),
          code: String(body.code).trim().toUpperCase(),
          description: String(body.description || '').trim(),
          discountType: body.discountType === 'fixed' ? 'fixed' : 'percentage',
          discountValue: val,
          minOrderAmount: Math.max(0, Number(body.minOrderAmount ?? 0)),
          maxDiscountAmount: body.maxDiscountAmount ? Number(body.maxDiscountAmount) : undefined,
          validFrom: String(body.validFrom || '2026-01-01'),
          validUntil: String(body.validUntil || '2027-12-31'),
          usageLimit: Math.max(0, Math.floor(Number(body.usageLimit ?? 100))),
          usedCount: Math.max(0, Math.floor(Number(body.usedCount ?? 0))),
          isActive: body.isActive !== false,
          applicableCategoryIds: Array.isArray(body.applicableCategoryIds)
            ? (body.applicableCategoryIds as string[])
            : [],
          applicableItemIds: Array.isArray(body.applicableItemIds)
            ? (body.applicableItemIds as string[])
            : [],
        };
        const saved = await upsertCoupon(env, coupon);
        return Response.json({ coupon: saved });
      } catch {
        return Response.json({ error: 'تعذر حفظ كوبون الخصم.' }, { status: 500 });
      }
    }

    const delCouponMatch = pathname.match(/^\/api\/admin\/coupons\/([^/]+)$/);
    if (method === 'DELETE' && delCouponMatch) {
      const denied = checkPermission(auth.role, 'coupons');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        await deleteCoupon(env, restaurantId, decodeURIComponent(delCouponMatch[1]));
        return Response.json({ ok: true });
      } catch {
        return Response.json({ error: 'تعذر حذف الكوبون.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/employees') {
      const denied = checkPermission(auth.role, 'employees');
      if (denied) return denied;
      try {
        const body = await readJsonBody<Record<string, unknown>>(request);
        if (!String(body.name || '').trim() || !String(body.email || '').trim()) {
          return Response.json(
            { error: 'اسم الموظف والبريد الإلكتروني مطلوبان.' },
            { status: 400 }
          );
        }
        const rawRole = String(body.role || 'cashier') as EmployeeRole;
        const employee: Employee = {
          id: String(body.id || `emp_${Date.now()}`),
          restaurantId: String(body.restaurantId || DEFAULT_RESTAURANT_ID),
          name: String(body.name).trim(),
          email: String(body.email).trim(),
          phone: String(body.phone || '').trim(),
          role: VALID_ROLES.includes(rawRole) ? rawRole : 'cashier',
          isActive: body.isActive !== false,
          createdAt: String(body.createdAt || new Date().toISOString()),
        };
        const saved = await upsertEmployee(env, employee);
        return Response.json({ employee: saved });
      } catch {
        return Response.json({ error: 'تعذر حفظ بيانات الموظف.' }, { status: 500 });
      }
    }

    const delEmpMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)$/);
    if (method === 'DELETE' && delEmpMatch) {
      const denied = checkPermission(auth.role, 'employees');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        await deleteEmployee(env, restaurantId, decodeURIComponent(delEmpMatch[1]));
        return Response.json({ ok: true });
      } catch {
        return Response.json({ error: 'تعذر حذف الموظف.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/notifications/read') {
      try {
        const body = await readJsonBody<{ restaurantId?: string }>(request);
        await markNotificationsRead(env, body.restaurantId || DEFAULT_RESTAURANT_ID);
        return Response.json({ ok: true });
      } catch {
        return Response.json({ error: 'تعذر تحديث الإشعارات.' }, { status: 500 });
      }
    }

    const getOrderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (method === 'GET' && getOrderMatch && getOrderMatch[1] !== 'export') {
      const denied = checkPermission(auth.role, 'orders');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        const order = await findOrderByNumberOrId(
          env,
          restaurantId,
          decodeURIComponent(getOrderMatch[1])
        );
        if (!order) return Response.json({ error: 'الطلب غير موجود.' }, { status: 404 });
        return Response.json({ order });
      } catch (err) {
        console.error('Get admin order error:', err);
        return Response.json({ error: 'تعذر تحميل بيانات الطلب.' }, { status: 500 });
      }
    }

    const orderStatusMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (method === 'PATCH' && orderStatusMatch) {
      const denied = checkPermission(auth.role, 'orders');
      if (denied) return denied;
      try {
        const body = await readJsonBody<{ restaurantId?: string; status?: OrderStatus }>(request);
        const { restaurantId = DEFAULT_RESTAURANT_ID, status } = body;
        const validStatuses: OrderStatus[] = [
          'received',
          'under_review',
          'accepted',
          'preparing',
          'out_for_delivery',
          'delivered',
          'cancelled',
        ];
        if (!status || !validStatuses.includes(status)) {
          return Response.json({ error: 'حالة الطلب غير صالحة.' }, { status: 400 });
        }
        const updated = await updateOrderStatus(
          env,
          restaurantId,
          decodeURIComponent(orderStatusMatch[1]),
          status,
          auth.email || 'المدير'
        );
        if (!updated) return Response.json({ error: 'الطلب غير موجود.' }, { status: 404 });
        return Response.json({ order: updated });
      } catch (err) {
        console.error('Update order status error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر تحديث حالة الطلب.' },
          { status: 500 }
        );
      }
    }

    if (method === 'GET' && pathname === '/api/admin/orders/export') {
      const denied = checkPermission(auth.role, 'orders', 'analytics');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        const orders = await listOrders(env, restaurantId);
        const header = [
          'رقم الطلب',
          'اسم العميل',
          'رقم الهاتف',
          'نوع الطلب',
          'المنطقة / الفرع',
          'العنوان',
          'المجموع الفرعي',
          'الخصم',
          'التوصيل',
          'الإجمالي',
          'الحالة',
          'التقييم',
          'تاريخ الإنشاء',
        ].join(',');
        const escapeCsv = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
        const rows = orders.map((o) =>
          [
            escapeCsv(o.orderNumber),
            escapeCsv(o.customerName),
            escapeCsv(o.customerPhone),
            escapeCsv(o.fulfillmentType === 'pickup' ? 'استلام من الفرع' : 'توصيل'),
            escapeCsv(o.deliveryZoneName || o.branchName || ''),
            escapeCsv(o.customerAddress),
            o.subtotal,
            o.discountAmount,
            o.deliveryFee,
            o.total,
            escapeCsv(o.status),
            o.rating ? `${o.rating}/5` : '',
            escapeCsv(o.createdAt),
          ].join(',')
        );
        const csv = '\uFEFF' + [header, ...rows].join('\n');
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="orders-report.csv"',
          },
        });
      } catch {
        return Response.json({ error: 'تعذر تصدير تقرير الطلبات.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/password') {
      const denied = checkPermission(auth.role, 'system');
      if (denied) return denied;
      const body = await readJsonBody<{ currentPassword?: string; newPassword?: string }>(request);
      const currentOk = await verifyAdminPassword(env, String(body.currentPassword || ''));
      if (!currentOk) {
        return Response.json({ error: 'كلمة المرور الحالية غير صحيحة.' }, { status: 400 });
      }
      const nextPass = String(body.newPassword || '');
      if (nextPass.length < 8 || !/[A-Z]/.test(nextPass) || !/\d/.test(nextPass)) {
        return Response.json(
          {
            error:
              'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير ورقم واحد على الأقل.',
          },
          { status: 400 }
        );
      }
      await setAdminPassword(env, nextPass);
      return Response.json({ ok: true });
    }

    if (method === 'POST' && pathname === '/api/admin/upload') {
      try {
        const body = await readJsonBody<{
          filename?: string;
          mimeType?: string;
          dataBase64?: string;
        }>(request);
        const { filename = 'image.jpg', mimeType = 'image/jpeg', dataBase64 } = body;
        if (!dataBase64 || typeof dataBase64 !== 'string') {
          return Response.json({ error: 'لم يتم إرسال ملف الصورة.' }, { status: 400 });
        }
        const cleanBase64 = dataBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        const approxBytes = Math.floor((cleanBase64.length * 3) / 4);
        if (approxBytes > 5 * 1024 * 1024) {
          return Response.json(
            { error: 'حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت).' },
            { status: 400 }
          );
        }
        const uploadedUrl = await uploadImageAsset(
          env,
          String(filename),
          String(mimeType),
          cleanBase64
        );
        return Response.json({ url: uploadedUrl });
      } catch (err) {
        console.error('Upload image error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر رفع الصورة حالياً.' },
          { status: 500 }
        );
      }
    }
  }

  return Response.json({ error: 'Endpoint not found' }, { status: 404 });
}

export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const res = await handleApiRequest(request, env);
      const noStore =
        url.pathname.startsWith('/api/chat') ||
        url.pathname.startsWith('/api/orders') ||
        url.pathname.startsWith('/api/admin');
      return withSecurityHeaders(res, { noStore });
    }

    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      const contentType = assetRes.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        return withSecurityHeaders(assetRes, { isHtml: true });
      }
      return assetRes;
    }

    return new Response('Static assets binding (ASSETS) is not configured.', { status: 500 });
  },
};
