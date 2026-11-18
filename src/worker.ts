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
  COMPROMISED_DEFAULT_PASSWORDS,
  constantTimeEqual,
  verifyPasswordAgainstHash,
} from '../worker/auth.ts';
import {
  applySecurityHeaders,
  handleCorsPreflight,
  isKnownSpaRoute,
  isStaticAssetPath,
} from '../worker/middleware/security.ts';
import { StoreConflictError } from './lib/errors.ts';
import { escapeCsvCell } from './lib/csv.ts';
import {
  decodeBase64ToBytes,
  detectValidImageFromBytes,
  isSafeMediaUrl,
} from './lib/uploadValidation.ts';
import {
  type EdgeEnv,
  adjustItemStock,
  appendActivityLog,
  appendAiLog,
  deleteBranch,
  deleteCategory,
  deleteCoupon,
  deleteDeliveryZone,
  deleteEmployee,
  deleteMenuItem,
  findEmployeeForLogin,
  findOrderByIdempotencyKey,
  findOrderByNumberOrId,
  findRestaurantBundle,
  getEmployeeAuthState,
  getOwnerPasswordChangedAt,
  getRestaurantBundle,
  isAdminTokenRevoked,
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
  probeBackendHealth,
  rateOrder,
  reorderMenuItems,
  revokeAdminToken,
  setAdminPassword,
  submitOrderAtomic,
  updateEmployeePassword,
  updateOrderPaymentStatus,
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
  const kv = env.RATE_LIMIT_KV || env.RESTAURANT_DB;
  if (!kv) return undefined;
  return {
    get: async (key: string) => {
      const val = await kv.get(key, 'text');
      return typeof val === 'string' ? val : null;
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      await kv.put(key, value, options);
    },
  };
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
  role: EmployeeRole = 'owner',
  restaurantId: string = DEFAULT_RESTAURANT_ID,
  mustChangePassword = false,
  issuedAtMs: number = Date.now()
): Promise<string> {
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be configured with at least 32 characters.');
  }
  const payloadJson = JSON.stringify({
    email,
    role,
    restaurantId,
    mustChangePassword,
    jti: crypto.randomUUID(),
    iat: issuedAtMs,
    exp: issuedAtMs + 1000 * 60 * 60 * 24 * 7,
  });
  const payload = toBase64Url(new TextEncoder().encode(payloadJson));
  const sig = await hmacSign(secret, payload);
  return `local.${payload}.${sig}`;
}

async function verifyLocalAdminToken(
  secret: string,
  token: string
): Promise<{
  email: string;
  role: EmployeeRole;
  restaurantId: string;
  mustChangePassword: boolean;
  jti: string;
  iat: number;
  exp: number;
} | null> {
  if (!secret || secret.length < 32 || !token.startsWith('local.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payload, sig] = parts;
  const expectedSig = await hmacSign(secret, payload);
  if (!constantTimeEqual(sig, expectedSig)) return null;
  try {
    const decodedStr = new TextDecoder().decode(fromBase64Url(payload));
    const decoded = JSON.parse(decodedStr) as {
      email: string;
      role?: EmployeeRole;
      restaurantId?: string;
      mustChangePassword?: boolean;
      jti?: string;
      iat?: number;
      exp: number;
    };
    if (decoded.exp < Date.now()) return null;
    const role: EmployeeRole =
      decoded.role && VALID_ROLES.includes(decoded.role) ? decoded.role : 'owner';
    return {
      email: decoded.email,
      role,
      restaurantId: String(decoded.restaurantId || DEFAULT_RESTAURANT_ID),
      mustChangePassword: Boolean(decoded.mustChangePassword),
      jti: typeof decoded.jti === 'string' ? decoded.jti : '',
      iat: Number(decoded.iat || 0),
      exp: Number(decoded.exp),
    };
  } catch {
    return null;
  }
}

function getSessionSecret(env: EdgeEnv): string {
  // Production mode never uses the bundled development secret.
  if (env.REQUIRE_SUPABASE === 'true') return env.ADMIN_SESSION_SECRET || '';
  return env.ADMIN_SESSION_SECRET || DEFAULT_SESSION_SECRET;
}

interface VerifiedAdminIdentity {
  email: string;
  role: EmployeeRole;
  restaurantId: string;
  mustChangePassword: boolean;
  authType: 'local' | 'supabase';
  tokenJti?: string;
  tokenExp?: number;
  tokenIat?: number;
}

function authorizeRestaurantAccess(
  auth: VerifiedAdminIdentity,
  targetRestaurantId: string
): Response | null {
  if (auth.restaurantId !== targetRestaurantId) {
    return Response.json(
      { error: 'غير مصرح لك بالوصول إلى بيانات هذا المطعم.' },
      { status: 403 }
    );
  }
  return null;
}

async function verifyAdminRequest(
  request: Request,
  env: EdgeEnv,
  pathname: string,
  targetRestaurantId: string
): Promise<VerifiedAdminIdentity | Response> {
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
          targetRestaurantId
        );
        if (!access.allowed) {
          return Response.json(
            { error: 'هذا الحساب غير مصرح له بإدارة هذا المطعم.' },
            { status: 403 }
          );
        }
        return {
          email: userEmail || 'admin',
          role: access.role ?? 'owner',
          restaurantId: targetRestaurantId,
          mustChangePassword: false,
          authType: 'supabase',
        };
      }
    } catch {
      // Fall through to 401
    }
  }

  const localAdmin = await verifyLocalAdminToken(getSessionSecret(env), token);
  if (localAdmin) {
    if (await isAdminTokenRevoked(env, localAdmin.jti)) {
      return Response.json(
        { error: 'تم إنهاء الجلسة. يُرجى تسجيل الدخول مرة أخرى.' },
        { status: 401 }
      );
    }

    const expectedOwnerEmail = (env.ADMIN_EMAIL || 'admin@hara-grill.eg').toLowerCase();
    let resolvedRole = localAdmin.role;
    if (localAdmin.email.toLowerCase() === expectedOwnerEmail && localAdmin.role === 'owner') {
      const ownerChangedAt = await getOwnerPasswordChangedAt(env);
      if (ownerChangedAt && localAdmin.iat < ownerChangedAt) {
        return Response.json(
          { error: 'تم تغيير كلمة المرور. يُرجى إعادة تسجيل الدخول.' },
          { status: 401 }
        );
      }
    } else {
      const empState = await getEmployeeAuthState(
        env,
        localAdmin.restaurantId,
        localAdmin.email
      );
      if (!empState.exists || !empState.isActive) {
        return Response.json(
          { error: 'تم تعطيل هذا الحساب أو حذفه.' },
          { status: 401 }
        );
      }
      if (empState.passwordChangedAt && localAdmin.iat < empState.passwordChangedAt) {
        return Response.json(
          { error: 'تم تغيير كلمة المرور. يُرجى إعادة تسجيل الدخول.' },
          { status: 401 }
        );
      }
      if (empState.role) {
        resolvedRole = empState.role;
      }
    }

    if (
      localAdmin.mustChangePassword &&
      pathname !== '/api/admin/me' &&
      pathname !== '/api/admin/password' &&
      pathname !== '/api/admin/logout'
    ) {
      return Response.json(
        {
          error: 'يجب تغيير كلمة المرور المؤقتة قبل استخدام لوحة التحكم.',
          mustChangePassword: true,
        },
        { status: 403 }
      );
    }
    return {
      email: localAdmin.email,
      role: resolvedRole,
      restaurantId: localAdmin.restaurantId,
      mustChangePassword: localAdmin.mustChangePassword,
      authType: 'local',
      tokenJti: localAdmin.jti,
      tokenExp: localAdmin.exp,
      tokenIat: localAdmin.iat,
    };
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
    const health = await probeBackendHealth(env);
    return Response.json(
      {
        service: 'moazzaf-almatam',
        runtime: 'cloudflare-workers',
        ...health,
      },
      { status: health.ok ? 200 : 503 }
    );
  }

  if (method === 'GET' && pathname === '/api/config/status') {
    return Response.json(getPublicConfigStatus());
  }

  // Fail closed in production: never fall back to in-memory/KV demo data
  // when the required Supabase service credential is missing.
  if (env.REQUIRE_SUPABASE === 'true' && !isSupabaseBackendActive(env)) {
    return Response.json(
      { error: 'Backend is not configured yet. Please add the Supabase server secret.' },
      { status: 503 }
    );
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
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`coupon:${ipHash}`, 20, 60, kv);
      if (!rl.allowed) {
        return Response.json(
          { error: 'تم إرسال محاولات كثيرة، يُرجى الانتظار دقيقة.' },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSeconds) },
          }
        );
      }
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
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`track:${ipHash}`, 30, 60, kv);
      if (!rl.allowed) {
        return Response.json(
          { error: 'تم إرسال طلبات تتبع كثيرة، يُرجى الانتظار دقيقة.' },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSeconds) },
          }
        );
      }
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

      if (message.trim().length > 1000) {
        return Response.json(
          { error: 'الرسالة طويلة جداً (الحد الأقصى ١٠٠٠ حرف).' },
          { status: 400 }
        );
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

      const safeHistory = Array.isArray(history)
        ? history
            .slice(-10)
            .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
            .map((h) => ({ role: h.role, text: h.text.slice(0, 1000) }))
        : [];

      const result = await runReceptionistChatCore({
        bundle,
        userMessage: message.trim(),
        history: safeHistory,
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
      const ipHash = await hashIpForLog(clientIp);
      const orderRl = await checkSlidingRateLimit(`order:${ipHash}`, 15, 60, kv);
      if (!orderRl.allowed) {
        return Response.json(
          { error: 'تم إرسال طلبات كثيرة في وقت قصير، يُرجى الانتظار دقيقة.' },
          {
            status: 429,
            headers: { 'Retry-After': String(orderRl.retryAfterSeconds) },
          }
        );
      }
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

      if (!customerName || !String(customerName).trim() || String(customerName).trim().length > 120) {
        return Response.json(
          { error: 'يُرجى إدخال اسم العميل (بحد أقصى 120 حرفاً).' },
          { status: 400 }
        );
      }

      const cleanPhone = String(customerPhone || '').trim();
      if (!cleanPhone || cleanPhone.replace(/[^\d]/g, '').length < 8 || cleanPhone.length > 30) {
        return Response.json(
          { error: 'يُرجى إدخال رقم هاتف صحيح للتواصل.' },
          { status: 400 }
        );
      }

      const cleanFulfillment: FulfillmentType =
        fulfillmentType === 'pickup' ? 'pickup' : 'delivery';

      if (
        cleanFulfillment === 'delivery' &&
        (!customerAddress ||
          !String(customerAddress).trim() ||
          String(customerAddress).trim().length > 400)
      ) {
        return Response.json(
          { error: 'يُرجى إدخال العنوان بالتفصيل (بحد أقصى 400 حرف).' },
          { status: 400 }
        );
      }

      if (String(notes || '').trim().length > 600) {
        return Response.json(
          { error: 'ملاحظات الطلب طويلة جداً (الحد الأقصى 600 حرف).' },
          { status: 400 }
        );
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

      const { order: savedOrder, deduplicated } = await submitOrderAtomic(env, {
        order: newOrder,
        couponCode: calc.appliedCoupon?.code,
      });

      const responseToken = deduplicated
        ? await signOrderToken(secret, bundle.restaurant.id, savedOrder.orderNumber)
        : orderToken;
      const whatsappUrl = buildWhatsAppOrderUrl(
        bundle.restaurant.whatsappNumber,
        savedOrder,
        bundle.restaurant.name,
        bundle.restaurant.systemSettings.currencyLabel
      );

      return Response.json(
        {
          order: savedOrder,
          whatsappUrl: whatsappUrl || '',
          orderToken: responseToken,
          ...(deduplicated ? { deduplicated: true } : {}),
        },
        { status: deduplicated ? 200 : 201 }
      );
    } catch (err) {
      if (err instanceof StoreConflictError) {
        return Response.json({ error: err.message }, { status: err.statusCode });
      }
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

      const body = await readJsonBody<{
        email?: string;
        password?: string;
        restaurantId?: string;
      }>(request);
      const cleanEmail = String(body.email || '').trim().toLowerCase();
      const cleanPass = String(body.password || '');
      const requestedRestaurantId =
        typeof body.restaurantId === 'string' && body.restaurantId.trim()
          ? body.restaurantId.trim()
          : undefined;
      const expectedEmail = (env.ADMIN_EMAIL || 'admin@hara-grill.eg').toLowerCase();

      if (!cleanEmail || !cleanPass || COMPROMISED_DEFAULT_PASSWORDS.has(cleanPass)) {
        return Response.json(
          { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
          { status: 401 }
        );
      }

      if (cleanEmail === expectedEmail) {
        const ownerValid = await verifyAdminPassword(env, cleanPass);
        if (ownerValid) {
          const role: EmployeeRole = 'owner';
          const tenantId = requestedRestaurantId || DEFAULT_RESTAURANT_ID;
          const token = await signAdminToken(secret, expectedEmail, role, tenantId, false);
          return Response.json({
            token,
            email: expectedEmail,
            role,
            restaurantId: tenantId,
            mustChangePassword: false,
            permissions: ROLE_PERMISSIONS[role],
          });
        }
        return Response.json(
          { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
          { status: 401 }
        );
      }

      const foundEmployee = await findEmployeeForLogin(env, cleanEmail, requestedRestaurantId);
      if (
        foundEmployee &&
        foundEmployee.passwordHash &&
        (await verifyPasswordAgainstHash(cleanPass, foundEmployee.passwordHash))
      ) {
        const { employee } = foundEmployee;
        const mustChangePassword = Boolean(employee.mustChangePassword);
        const token = await signAdminToken(
          secret,
          employee.email,
          employee.role,
          employee.restaurantId,
          mustChangePassword
        );
        return Response.json({
          token,
          email: employee.email,
          role: employee.role,
          restaurantId: employee.restaurantId,
          mustChangePassword,
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
    const queryRestaurantId = url.searchParams.get('restaurantId') || '';
    let targetRestaurantId = queryRestaurantId;
    if (
      !targetRestaurantId &&
      method !== 'GET' &&
      (request.headers.get('content-type') || '').includes('application/json')
    ) {
      try {
        const clonedBody = (await request.clone().json()) as { restaurantId?: unknown };
        if (typeof clonedBody?.restaurantId === 'string' && clonedBody.restaurantId.trim()) {
          targetRestaurantId = clonedBody.restaurantId.trim();
        }
      } catch {
        // Ignore malformed JSON here; route handler handles body parsing safely
      }
    }
    const auth = await verifyAdminRequest(
      request,
      env,
      pathname,
      targetRestaurantId || DEFAULT_RESTAURANT_ID
    );
    if (auth instanceof Response) return auth;

    if (method === 'GET' && pathname === '/api/admin/me') {
      return Response.json({
        authenticated: true,
        email: auth.email,
        role: auth.role,
        restaurantId: auth.restaurantId,
        mustChangePassword: auth.mustChangePassword,
        permissions: ROLE_PERMISSIONS[auth.role],
      });
    }

    if (method === 'POST' && pathname === '/api/admin/logout') {
      if (auth.tokenJti) {
        await revokeAdminToken(
          env,
          auth.tokenJti,
          auth.tokenExp || Date.now() + 1000 * 60 * 60 * 24 * 7
        );
      }
      return Response.json({ ok: true });
    }

    if (method === 'GET' && pathname === '/api/admin/overview') {
      try {
        const restaurantId = queryRestaurantId || DEFAULT_RESTAURANT_ID;
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;

        const canEmployees = hasPermission(auth.role, 'employees');
        const canAi = hasPermission(auth.role, 'ai');
        const canCoupons = hasPermission(auth.role, 'coupons');
        const canInventory = hasPermission(auth.role, 'inventory');
        const canCustomers =
          hasPermission(auth.role, 'analytics') || hasPermission(auth.role, 'settings');
        const canSystemConfig =
          hasPermission(auth.role, 'system') ||
          hasPermission(auth.role, 'settings') ||
          hasPermission(auth.role, 'ai');

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
          canAi ? listAiLogs(env, restaurantId) : Promise.resolve([]),
          canCoupons ? listCoupons(env, restaurantId) : Promise.resolve([]),
          canInventory ? listInventoryMovements(env, restaurantId) : Promise.resolve([]),
          canEmployees ? listEmployees(env, restaurantId) : Promise.resolve([]),
          canEmployees ? listActivityLogs(env, restaurantId) : Promise.resolve([]),
          listNotifications(env, restaurantId),
          canCustomers ? listCustomers(env, restaurantId) : Promise.resolve([]),
        ]);

        const safeBundle = {
          ...bundle,
          restaurant: canAi
            ? bundle.restaurant
            : {
                ...bundle.restaurant,
                aiSettings: {
                  enabled: bundle.restaurant.aiSettings.enabled,
                  aiOrderIntake: bundle.restaurant.aiSettings.aiOrderIntake,
                  welcomeMessage: bundle.restaurant.aiSettings.welcomeMessage,
                },
              },
          activeCoupons: canCoupons ? bundle.activeCoupons : [],
        };

        const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
        return Response.json({
          bundle: safeBundle,
          hoursStatus,
          orders,
          aiLogs,
          coupons,
          inventoryMovements,
          employees,
          activityLogs,
          notifications,
          customers,
          configStatus: canSystemConfig ? getServiceConfigStatus(env) : undefined,
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
        const targetId = String(restaurantId || DEFAULT_RESTAURANT_ID);
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
        if (patch.logoUrl !== undefined && !isSafeMediaUrl(patch.logoUrl)) {
          return Response.json(
            { error: 'رابط شعار المطعم غير صالح أو غير آمن.' },
            { status: 400 }
          );
        }
        const aiPatch = patch.aiSettings as { model?: string } | undefined;
        if (aiPatch?.model && !(ALLOWED_AI_MODELS as readonly string[]).includes(String(aiPatch.model))) {
          return Response.json(
            { error: 'نموذج الذكاء الاصطناعي المختار غير مسموح به.' },
            { status: 400 }
          );
        }
        const updated = await updateRestaurant(env, targetId, patch);
        const hoursStatus = evaluateRestaurantHours(updated);
        await appendActivityLog(env, {
          id: `act_${Date.now()}`,
          restaurantId: targetId,
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
        const targetId = String(body.restaurantId || DEFAULT_RESTAURANT_ID);
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
        const cat: MenuCategory = {
          id: String(body.id || `cat_${Date.now()}`),
          restaurantId: targetId,
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const targetId = String(body.restaurantId || DEFAULT_RESTAURANT_ID);
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
        const price = Number(body.price);
        if (!String(body.name || '').trim() || !Number.isFinite(price) || price < 0) {
          return Response.json({ error: 'يُرجى إدخال اسم الصنف وسعر صحيح.' }, { status: 400 });
        }
        if (body.imageUrl !== undefined && !isSafeMediaUrl(body.imageUrl)) {
          return Response.json(
            { error: 'رابط صورة الصنف غير صالح أو غير آمن.' },
            { status: 400 }
          );
        }
        const rawSizes = Array.isArray(body.sizes) ? (body.sizes as MenuItem['sizes']) : [];
        const rawExtras = Array.isArray(body.extras) ? (body.extras as MenuItem['extras']) : [];
        if (
          rawSizes.some(
            (s) => !Number.isFinite(Number(s?.priceDelta ?? 0)) || Number(s?.priceDelta ?? 0) < 0
          ) ||
          rawExtras.some(
            (ex) => !Number.isFinite(Number(ex?.price ?? 0)) || Number(ex?.price ?? 0) < 0
          )
        ) {
          return Response.json(
            { error: 'أسعار الأحجام والإضافات يجب أن تكون قيماً صالحة غير سالبة.' },
            { status: 400 }
          );
        }
        const item: MenuItem = {
          id: String(body.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`),
          restaurantId: targetId,
          categoryId: String(body.categoryId),
          name: String(body.name).trim(),
          description: String(body.description || '').trim(),
          price,
          imageUrl: String(body.imageUrl || ''),
          isAvailable: body.isAvailable !== false,
          isPopular: Boolean(body.isPopular),
          stockQuantity: Math.max(0, Math.floor(Number(body.stockQuantity ?? 40))),
          lowStockThreshold: Math.max(1, Math.floor(Number(body.lowStockThreshold ?? 8))),
          sizes: rawSizes,
          extras: rawExtras,
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const targetId = String(body.restaurantId || DEFAULT_RESTAURANT_ID);
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
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
          restaurantId: targetId,
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const targetId = String(body.restaurantId || DEFAULT_RESTAURANT_ID);
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
        if (!String(body.name || '').trim()) {
          return Response.json({ error: 'يُرجى إدخال اسم الفرع.' }, { status: 400 });
        }
        const branch: RestaurantBranch = {
          id: String(body.id || `br_${Date.now()}`),
          restaurantId: targetId,
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const targetId = String(body.restaurantId || DEFAULT_RESTAURANT_ID);
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
        const val = Number(body.discountValue);
        const discountType = body.discountType === 'fixed' ? 'fixed' : 'percentage';
        if (
          !String(body.code || '').trim() ||
          !Number.isFinite(val) ||
          val <= 0 ||
          (discountType === 'percentage' && val > 100)
        ) {
          return Response.json(
            {
              error:
                discountType === 'percentage' && val > 100
                  ? 'نسبة الخصم لا يمكن أن تتجاوز ١٠٠٪.'
                  : 'يُرجى إدخال كود الخصم وقيمة خصم صحيحة.',
            },
            { status: 400 }
          );
        }
        const coupon: Coupon = {
          id: String(body.id || `cpn_${Date.now()}`),
          restaurantId: targetId,
          code: String(body.code).trim().toUpperCase(),
          description: String(body.description || '').trim(),
          discountType,
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const targetId = String(body.restaurantId || DEFAULT_RESTAURANT_ID);
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
        if (!String(body.name || '').trim() || !String(body.email || '').trim()) {
          return Response.json(
            { error: 'اسم الموظف والبريد الإلكتروني مطلوبان.' },
            { status: 400 }
          );
        }
        const rawPassword = typeof body.password === 'string' ? body.password.trim() : '';
        if (rawPassword) {
          if (COMPROMISED_DEFAULT_PASSWORDS.has(rawPassword) || rawPassword.length < 8) {
            return Response.json(
              { error: 'كلمة مرور الموظف يجب أن تكون 8 أحرف على الأقل وألا تكون شائعة.' },
              { status: 400 }
            );
          }
        }
        const rawRole = String(body.role || 'cashier') as EmployeeRole;
        const employee: Employee & { password?: string } = {
          id: String(body.id || `emp_${Date.now()}`),
          restaurantId: targetId,
          name: String(body.name).trim(),
          email: String(body.email).trim().toLowerCase(),
          phone: String(body.phone || '').trim(),
          role: VALID_ROLES.includes(rawRole) ? rawRole : 'cashier',
          isActive: body.isActive !== false,
          mustChangePassword:
            rawPassword
              ? body.mustChangePassword !== undefined
                ? Boolean(body.mustChangePassword)
                : true
              : body.mustChangePassword !== undefined
              ? Boolean(body.mustChangePassword)
              : undefined,
          createdAt: String(body.createdAt || new Date().toISOString()),
          ...(rawPassword ? { password: rawPassword } : {}),
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
        await deleteEmployee(env, restaurantId, decodeURIComponent(delEmpMatch[1]));
        return Response.json({ ok: true });
      } catch {
        return Response.json({ error: 'تعذر حذف الموظف.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/notifications/read') {
      try {
        const body = await readJsonBody<{ restaurantId?: string }>(request);
        const targetId = body.restaurantId || DEFAULT_RESTAURANT_ID;
        const tenantDenied = authorizeRestaurantAccess(auth, targetId);
        if (tenantDenied) return tenantDenied;
        await markNotificationsRead(env, targetId);
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        if (err instanceof StoreConflictError) {
          return Response.json({ error: err.message }, { status: err.statusCode });
        }
        console.error('Update order status error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر تحديث حالة الطلب.' },
          { status: 500 }
        );
      }
    }

    const orderPaymentMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/payment$/);
    if (method === 'PATCH' && orderPaymentMatch) {
      const denied = checkPermission(auth.role, 'orders');
      if (denied) return denied;
      try {
        const body = await readJsonBody<{
          restaurantId?: string;
          paymentStatus?: 'pending' | 'paid';
        }>(request);
        const { restaurantId = DEFAULT_RESTAURANT_ID, paymentStatus } = body;
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
        if (paymentStatus !== 'paid' && paymentStatus !== 'pending') {
          return Response.json({ error: 'حالة الدفع غير صالحة.' }, { status: 400 });
        }
        const updated = await updateOrderPaymentStatus(
          env,
          restaurantId,
          decodeURIComponent(orderPaymentMatch[1]),
          paymentStatus,
          auth.email || 'المدير'
        );
        if (!updated) return Response.json({ error: 'الطلب غير موجود.' }, { status: 404 });
        return Response.json({ order: updated });
      } catch (err) {
        console.error('Update order payment error:', err);
        return Response.json(
          { error: err instanceof Error ? err.message : 'تعذر تحديث حالة الدفع.' },
          { status: 500 }
        );
      }
    }

    if (method === 'GET' && pathname === '/api/admin/orders/export') {
      const denied = checkPermission(auth.role, 'orders', 'analytics');
      if (denied) return denied;
      try {
        const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
        const tenantDenied = authorizeRestaurantAccess(auth, restaurantId);
        if (tenantDenied) return tenantDenied;
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
        const rows = orders.map((o) =>
          [
            escapeCsvCell(o.orderNumber),
            escapeCsvCell(o.customerName),
            escapeCsvCell(o.customerPhone),
            escapeCsvCell(o.fulfillmentType === 'pickup' ? 'استلام من الفرع' : 'توصيل'),
            escapeCsvCell(o.deliveryZoneName || o.branchName || ''),
            escapeCsvCell(o.customerAddress),
            o.subtotal,
            o.discountAmount,
            o.deliveryFee,
            o.total,
            escapeCsvCell(o.status),
            o.rating ? `${o.rating}/5` : '',
            escapeCsvCell(o.createdAt),
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
      try {
        const expectedOwnerEmail = (env.ADMIN_EMAIL || 'admin@hara-grill.eg').toLowerCase();
        const body = await readJsonBody<{ currentPassword?: string; newPassword?: string }>(request);
        const nextPass = String(body.newPassword || '');
        if (
          nextPass.length < 8 ||
          !/[A-Z]/.test(nextPass) ||
          !/\d/.test(nextPass) ||
          COMPROMISED_DEFAULT_PASSWORDS.has(nextPass)
        ) {
          return Response.json(
            {
              error:
                'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير ورقم وألا تكون شائعة.',
            },
            { status: 400 }
          );
        }

        if (auth.email.toLowerCase() === expectedOwnerEmail && auth.role === 'owner') {
          const currentOk = await verifyAdminPassword(env, String(body.currentPassword || ''));
          if (!currentOk) {
            return Response.json({ error: 'كلمة المرور الحالية غير صحيحة.' }, { status: 400 });
          }
          const changedAt = await setAdminPassword(env, nextPass, auth.tokenIat || 0);
          if (auth.tokenJti) {
            await revokeAdminToken(
              env,
              auth.tokenJti,
              auth.tokenExp || Date.now() + 1000 * 60 * 60 * 24 * 7
            );
          }
          const freshToken = await signAdminToken(
            secret,
            auth.email,
            auth.role,
            auth.restaurantId,
            false,
            changedAt
          );
          return Response.json({ ok: true, token: freshToken, mustChangePassword: false });
        }

        const foundEmployee = await findEmployeeForLogin(env, auth.email, auth.restaurantId);
        if (
          !foundEmployee ||
          !foundEmployee.passwordHash ||
          !(await verifyPasswordAgainstHash(String(body.currentPassword || ''), foundEmployee.passwordHash))
        ) {
          return Response.json({ error: 'كلمة المرور الحالية غير صحيحة.' }, { status: 400 });
        }
        const empPwdRes = await updateEmployeePassword(
          env,
          auth.restaurantId,
          auth.email,
          nextPass,
          auth.tokenIat || 0
        );
        if (auth.tokenJti) {
          await revokeAdminToken(
            env,
            auth.tokenJti,
            auth.tokenExp || Date.now() + 1000 * 60 * 60 * 24 * 7
          );
        }
        const freshToken = await signAdminToken(
          secret,
          auth.email,
          auth.role,
          auth.restaurantId,
          false,
          empPwdRes.passwordChangedAt || Date.now()
        );
        return Response.json({ ok: true, token: freshToken, mustChangePassword: false });
      } catch {
        return Response.json({ error: 'تعذر تغيير كلمة المرور حالياً.' }, { status: 500 });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/upload') {
      const denied = checkPermission(auth.role, 'menu', 'settings');
      if (denied) return denied;
      try {
        const body = await readJsonBody<{
          filename?: string;
          mimeType?: string;
          dataBase64?: string;
        }>(request);
        const { mimeType = 'image/jpeg', dataBase64 } = body;
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
        const bytes = decodeBase64ToBytes(cleanBase64);
        const detected = detectValidImageFromBytes(bytes, String(mimeType));
        if (!detected) {
          return Response.json(
            { error: 'نوع الملف غير مدعوم. يُسمح فقط بصور JPG أو PNG أو WEBP أو GIF صالحة.' },
            { status: 400 }
          );
        }
        const uploadedUrl = await uploadImageAsset(
          env,
          `image.${detected.extension}`,
          detected.mimeType,
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
    const preflight = handleCorsPreflight(request, env.ALLOWED_ORIGINS);
    if (preflight) return preflight;

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const res = await handleApiRequest(request, env);
      const secured = applySecurityHeaders(res, request, env.ALLOWED_ORIGINS);
      if (
        url.pathname.startsWith('/api/chat') ||
        url.pathname.startsWith('/api/orders') ||
        url.pathname.startsWith('/api/admin')
      ) {
        const headers = new Headers(secured.headers);
        headers.set('Cache-Control', 'no-store');
        return new Response(secured.body, {
          status: secured.status,
          statusText: secured.statusText,
          headers,
        });
      }
      return secured;
    }

    if (env.ASSETS) {
      let assetRes = await env.ASSETS.fetch(request);
      if (
        assetRes.status === 404 &&
        !isStaticAssetPath(url.pathname) &&
        isKnownSpaRoute(url.pathname)
      ) {
        const indexUrl = new URL('/index.html', request.url);
        assetRes = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));
      }

      const contentType = assetRes.headers.get('content-type') || '';
      if (contentType.includes('text/html') || assetRes.status === 404) {
        const secured = applySecurityHeaders(assetRes, request, env.ALLOWED_ORIGINS);
        const headers = new Headers(secured.headers);
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        return new Response(secured.body, {
          status: secured.status,
          statusText: secured.statusText,
          headers,
        });
      }
      return applySecurityHeaders(assetRes, request, env.ALLOWED_ORIGINS);
    }

    return applySecurityHeaders(
      new Response('Static assets binding (ASSETS) is not configured.', { status: 500 }),
      request,
      env.ALLOWED_ORIGINS
    );
  },
};
