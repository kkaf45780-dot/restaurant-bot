import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_RESTAURANT_ID } from './src/data/restaurant.ts';
import { evaluateRestaurantHours } from './src/lib/hours.ts';
import {
  ROLE_PERMISSIONS,
  hasPermission,
  type AdminTabPermission,
} from './src/lib/permissions.ts';
import { calculateOrderTotals } from './src/lib/pricing.ts';
import { buildWhatsAppOrderUrl } from './src/lib/whatsapp.ts';
import { runReceptionistChat } from './src/server/geminiReceptionist.ts';
import {
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
} from './src/server/chatSecurity.ts';
import { sanitizePublicBundle } from './src/server/publicSanitizer.ts';
import {
  UPLOADS_DIR,
  adjustItemStock,
  appendActivityLog,
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
  listEmployees,
  listInventoryMovements,
  listNotifications,
  listOrders,
  markNotificationsRead,
  rateOrder,
  reorderMenuItems,
  setLocalAdminPassword,
  updateOrderStatus,
  updateRestaurant,
  uploadImageAsset,
  upsertBranch,
  upsertCategory,
  upsertCoupon,
  upsertDeliveryZone,
  upsertEmployee,
  upsertMenuItem,
  verifyLocalAdminPassword,
} from './src/server/store.ts';
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
} from './src/types/restaurant.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? crypto.randomBytes(32).toString('hex')
    : 'meshweyat-elhara-local-session-secret-2026');

if (process.env.NODE_ENV === 'production') {
  const missingSecurityVars = ['ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET'].filter(
    (name) => !process.env[name]?.trim()
  );
  if (missingSecurityVars.length > 0) {
    console.warn(
      `[Security Warning] Missing production environment variables (${missingSecurityVars.join(', ')}); using fallback configuration.`
    );
  }
}

function getRequestClientIp(req: Request): string {
  return extractClientIpFromHeaders(
    { get: (name) => req.get(name) ?? null },
    req.ip || req.socket.remoteAddress || '127.0.0.1'
  );
}

interface AdminRequest extends Request {
  adminEmail?: string;
  adminRole?: EmployeeRole;
}

const VALID_ROLES: EmployeeRole[] = ['owner', 'manager', 'cashier', 'kitchen'];

function signLocalAdminToken(email: string, role: EmployeeRole = 'owner'): string {
  const payload = Buffer.from(
    JSON.stringify({ email, role, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `local.${payload}.${sig}`;
}

function verifyLocalAdminToken(token: string): { email: string; role: EmployeeRole } | null {
  if (!token.startsWith('local.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
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

async function resolveRoleForEmail(email: string): Promise<EmployeeRole> {
  const expectedOwner = (process.env.ADMIN_EMAIL || 'admin@hara-grill.eg').toLowerCase();
  if (email.trim().toLowerCase() === expectedOwner) return 'owner';
  const emp = await findEmployeeByEmail(DEFAULT_RESTAURANT_ID, email);
  return emp?.role ?? 'owner';
}

async function verifyAdminRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({ error: 'غير مصرح لك بالوصول. يُرجى تسجيل الدخول كمدير أولاً.' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey && !token.startsWith('local.')) {
    try {
      const sb = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await sb.auth.getUser(token);
      if (!error && data.user) {
        const userEmail = data.user.email ?? 'admin';
        (req as AdminRequest).adminEmail = userEmail;
        (req as AdminRequest).adminRole = await resolveRoleForEmail(userEmail);
        next();
        return;
      }
    } catch {
      // Fall through
    }
  }

  const localAdmin = verifyLocalAdminToken(token);
  if (localAdmin) {
    (req as AdminRequest).adminEmail = localAdmin.email;
    (req as AdminRequest).adminRole = localAdmin.role;
    next();
    return;
  }

  res.status(401).json({ error: 'انتهت جلسة المدير أو بيانات الدخول غير صالحة.' });
}

function requirePermission(...allowed: AdminTabPermission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role: EmployeeRole = (req as AdminRequest).adminRole || 'owner';
    if (allowed.some((perm) => hasPermission(role, perm))) {
      next();
      return;
    }
    res.status(403).json({
      error: 'ليس لديك صلاحية تنفيذ هذا الإجراء بدورك الوظيفي الحالي.',
    });
  };
}

function getServiceConfigStatus(): ServiceConfigStatus {
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY;
  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnon);

  return {
    geminiConfigured,
    supabaseConfigured,
    storageMode: isSupabaseBackendActive() ? 'supabase' : 'local',
    authMode: supabaseConfigured ? 'supabase' : 'local',
  };
}

function getPublicConfigStatus(): PublicConfigStatus {
  return {
    ok: true,
    version: '2.0.0',
  };
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'"
      );
    }
    if (
      req.path.startsWith('/api/chat') ||
      req.path.startsWith('/api/orders') ||
      req.path.startsWith('/api/admin')
    ) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'moazzaf-almatam' });
  });

  app.get('/api/config/status', (_req, res) => {
    res.json(getPublicConfigStatus());
  });

  // Public Restaurant Bundle + Computed Hours (Minimized & Exact ID Lookup)
  app.get('/api/restaurant/:slug?', async (req, res) => {
    try {
      const clientIp = getRequestClientIp(req);
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`rest:${ipHash}`, 60, 60);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        res.status(429).json({ error: 'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.' });
        return;
      }
      const slugOrId = req.params.slug || DEFAULT_RESTAURANT_ID;
      const bundle = await findRestaurantBundle(slugOrId);
      if (!bundle) {
        res.status(404).json({ error: 'المطعم غير موجود' });
        return;
      }
      const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
      res.json({ bundle: sanitizePublicBundle(bundle), hoursStatus });
    } catch (err) {
      console.error('Error loading restaurant:', err);
      res.status(500).json({ error: 'تعذر تحميل بيانات المطعم حالياً، يُرجى المحاولة لاحقاً.' });
    }
  });

  // Public Coupon Validation
  app.post('/api/coupons/validate', async (req, res) => {
    try {
      const {
        restaurantId = DEFAULT_RESTAURANT_ID,
        code,
        items = [],
        deliveryZoneId = '',
        fulfillmentType = 'delivery',
      } = req.body ?? {};
      const bundle = await findRestaurantBundle(String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        res.status(404).json({ error: 'المطعم غير موجود' });
        return;
      }
      const calc = calculateOrderTotals(
        items as OrderDraftItem[],
        bundle.items,
        deliveryZoneId,
        bundle.deliveryZones,
        {
          fulfillmentType: fulfillmentType as FulfillmentType,
          couponCode: code,
          coupons: bundle.activeCoupons,
        }
      );
      if (!calc.appliedCoupon) {
        res.status(400).json({
          valid: false,
          error: calc.couponError || 'كود الخصم غير صالح.',
        });
        return;
      }
      res.json({
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
      res.status(500).json({ error: 'تعذر التحقق من كود الخصم حالياً.' });
    }
  });

  // Public Order Tracking (Protected by signed HMAC orderToken — prevents IDOR)
  app.get('/api/orders/track', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
      const orderNumber = String(req.query.orderNumber || '').trim();
      const token = String(req.query.token || '').trim();

      const bundle = await findRestaurantBundle(restaurantId);
      if (!bundle) {
        res.status(404).json({ error: 'المطعم غير موجود' });
        return;
      }

      if (!orderNumber) {
        res.status(400).json({ error: 'يُرجى إدخال رقم الطلب.' });
        return;
      }

      if (!token) {
        res.status(400).json({ error: 'رمز التتبع السري (orderToken) مطلوب.' });
        return;
      }

      const validToken = await verifyOrderToken(
        SESSION_SECRET,
        token,
        bundle.restaurant.id,
        orderNumber
      );
      if (!validToken) {
        res.status(403).json({ error: 'رمز التتبع غير صالح أو منتهي الصلاحية.' });
        return;
      }

      const order = await findOrderByNumberOrId(bundle.restaurant.id, orderNumber);
      if (!order) {
        res.status(404).json({ error: 'لم يتم العثور على طلب بهذا الرقم.' });
        return;
      }
      res.json({ order });
    } catch {
      res.status(500).json({ error: 'تعذر البحث عن الطلب حالياً.' });
    }
  });

  // Public Order Rating (available after delivery, protected by signed orderToken)
  app.post('/api/orders/:orderNumber/rate', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const clientIp = getRequestClientIp(req);
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`rate:${ipHash}`, 20, 60);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        res.status(429).json({ error: 'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.' });
        return;
      }

      const {
        restaurantId = DEFAULT_RESTAURANT_ID,
        rating,
        comment = '',
        token = '',
      } = req.body ?? {};
      const bundle = await findRestaurantBundle(String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        res.status(404).json({ error: 'المطعم غير موجود' });
        return;
      }

      const cleanToken = String(token || '').trim();
      if (!cleanToken) {
        res.status(400).json({ error: 'رمز التتبع السري (orderToken) مطلوب لتقييم الطلب.' });
        return;
      }

      const validToken = await verifyOrderToken(
        SESSION_SECRET,
        cleanToken,
        bundle.restaurant.id,
        req.params.orderNumber
      );
      if (!validToken) {
        res.status(403).json({ error: 'رمز التتبع غير صالح لتقييم هذا الطلب.' });
        return;
      }

      const numRating = Math.trunc(Number(rating));
      if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
        res.status(400).json({ error: 'يُرجى اختيار تقييم من 1 إلى 5 نجوم.' });
        return;
      }
      const updated = await rateOrder(
        bundle.restaurant.id,
        cleanToken,
        numRating,
        String(comment || ''),
        req.params.orderNumber
      );
      if (!updated) {
        res.status(404).json({ error: 'لم يتم العثور على الطلب.' });
        return;
      }
      res.json({ order: updated });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر تسجيل التقييم حالياً.',
      });
    }
  });

  // Public Chat Human Challenge Endpoint (Turnstile config + single-use HMAC challenge)
  app.get('/api/chat/challenge', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const clientIp = getRequestClientIp(req);
      const ipHash = await hashIpForLog(clientIp);
      const rl = await checkSlidingRateLimit(`challenge:${ipHash}`, 20, 60);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        res.status(429).json({ error: 'تم إرسال طلبات تحقق كثيرة، يُرجى الانتظار قليلاً.' });
        return;
      }
      const rawSessionId = String(req.query.sessionId || '').trim();
      const sessionId = rawSessionId || `ip_${ipHash}`;
      const challenge = await issueHumanChallenge({
        secret: SESSION_SECRET,
        sessionId,
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
        turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
      });
      res.json(challenge);
    } catch {
      res.status(500).json({ error: 'تعذر إنشاء تحدي التحقق البشري.' });
    }
  });

  // Public AI Receptionist Chat with Rate Limiting, Daily Quota & Single-Use Human Verification
  app.post('/api/chat', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const clientIp = getRequestClientIp(req);
      const ipHash = await hashIpForLog(clientIp);

      const rl = await checkSlidingRateLimit(`chat:${ipHash}`, 20, 60);
      if (!rl.allowed) {
        console.warn(`[Security] Chat rate limit hit ipHash=${ipHash}`);
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        res.status(429).json({
          error: 'تم إرسال رسائل كثيرة في وقت قصير. يُرجى الانتظار دقيقة ثم المحاولة مرة أخرى.',
        });
        return;
      }

      const body = req.body ?? {};
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
      } = body;

      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'يُرجى كتابة رسالة قبل الإرسال.' });
        return;
      }

      // Reject forged / bypass human verification tokens unconditionally
      if (
        humanVerified === true ||
        isForbiddenBypassToken(verification?.token) ||
        isForbiddenBypassToken(body?.verificationToken)
      ) {
        console.warn(`[Security] Rejected forged human verification token ipHash=${ipHash}`);
        res.status(403).json({
          error: 'رمز التحقق البشري مرفوض وغير صالح.',
          captchaRequired: true,
        });
        return;
      }

      const sessionKey =
        typeof rawSessionId === 'string' && rawSessionId.trim().length >= 4
          ? rawSessionId.trim().slice(0, 64)
          : `ip_${ipHash}`;

      // Daily caps
      const dailyIpCap = await incrementDailyCounter(`chat_ip:${ipHash}`, 200);
      if (!dailyIpCap.allowed) {
        res.status(429).json({ error: 'تم تجاوز الحد اليومي للمحادثات لهذا العنوان.' });
        return;
      }
      const dailySessionCap = await incrementDailyCounter(`chat_sess:${sessionKey}`, 80);
      if (!dailySessionCap.allowed) {
        res.status(429).json({ error: 'تم تجاوز الحد اليومي للرسائل في هذه الجلسة.' });
        return;
      }

      const unverifiedTurns = await getSessionUnverifiedTurns(sessionKey);

      if (verification && typeof verification === 'object') {
        const check = await verifyHumanChallenge({
          secret: SESSION_SECRET,
          sessionId: sessionKey,
          verification,
          turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
          remoteIp: clientIp,
        });
        if (!check.ok) {
          res.status(403).json({
            error: check.error || 'فشل التحقق البشري.',
            captchaRequired: true,
          });
          return;
        }
        await setSessionUnverifiedTurns(sessionKey, 0);
      } else if (unverifiedTurns >= 5) {
        res.status(403).json({
          error: 'تم استنفاد الرسائل المجانية المتتالية للجلسة. يرجى إكمال التحقق البشري للمتابعة.',
          captchaRequired: true,
        });
        return;
      } else {
        await setSessionUnverifiedTurns(sessionKey, unverifiedTurns + 1);
      }

      const globalDailyBudget = await incrementDailyCounter('gemini_calls_global', 1000);
      if (!globalDailyBudget.allowed) {
        res.status(429).json({
          error: 'تم الوصول للحد اليومي لخدمة المساعد الذكي، يمكنك الطلب مباشرة من المنيو أو واتساب.',
        });
        return;
      }
      if (globalDailyBudget.usageRatio >= 0.8) {
        console.warn(
          `[Quota Alert] Global daily Gemini usage reached ${Math.round(globalDailyBudget.usageRatio * 100)}% (${globalDailyBudget.count}/1000)`
        );
      }

      const bundle = await findRestaurantBundle(String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        res.status(404).json({ error: 'المطعم غير موجود' });
        return;
      }

      const result = await runReceptionistChat({
        bundle,
        userMessage: message.trim(),
        history: Array.isArray(history) ? history : [],
        currentDraft: {
          fulfillmentType: 'delivery',
          ...orderDraft,
        },
      });

      res.json(result);
    } catch (err) {
      console.error('Chat endpoint error:', err);
      res.status(500).json({
        error: 'حدث خطأ أثناء معالجة الرسالة، يمكنك التواصل معنا مباشرة عبر واتساب.',
      });
    }
  });

  // Public Order Creation (Always computes prices and totals programmatically in TypeScript)
  app.post('/api/orders', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
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
      } = req.body ?? {};

      const bundle = await findRestaurantBundle(String(restaurantId || DEFAULT_RESTAURANT_ID));
      if (!bundle) {
        res.status(404).json({ error: 'المطعم غير موجود' });
        return;
      }

      // Duplicate order submission guard
      if (idempotencyKey && typeof idempotencyKey === 'string') {
        const existing = await findOrderByIdempotencyKey(bundle.restaurant.id, idempotencyKey);
        if (existing) {
          const whatsappUrl = buildWhatsAppOrderUrl(
            bundle.restaurant.whatsappNumber,
            existing,
            bundle.restaurant.name,
            bundle.restaurant.systemSettings.currencyLabel
          );
          const orderToken = await signOrderToken(
            SESSION_SECRET,
            bundle.restaurant.id,
            existing.orderNumber
          );
          res.status(200).json({ order: existing, whatsappUrl, orderToken, deduplicated: true });
          return;
        }
      }

      const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
      if (!hoursStatus.isOpen && !bundle.restaurant.systemSettings.allowOrdersWhenClosed) {
        res.status(400).json({
          error: `عذراً، المطعم مغلق حالياً. ${hoursStatus.nextOpenText ? `نفتح ${hoursStatus.nextOpenText}.` : ''}`,
        });
        return;
      }

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'سلة الطلبات فارغة. أضف صنفاً واحداً على الأقل.' });
        return;
      }

      if (!customerName || !String(customerName).trim()) {
        res.status(400).json({ error: 'يُرجى إدخال اسم العميل.' });
        return;
      }

      const cleanPhone = String(customerPhone || '').trim();
      if (!cleanPhone || cleanPhone.replace(/[^\d]/g, '').length < 8) {
        res.status(400).json({ error: 'يُرجى إدخال رقم هاتف صحيح للتواصل.' });
        return;
      }

      const cleanFulfillment: FulfillmentType =
        fulfillmentType === 'pickup' ? 'pickup' : 'delivery';

      if (cleanFulfillment === 'delivery' && (!customerAddress || !String(customerAddress).trim())) {
        res.status(400).json({ error: 'يُرجى إدخال العنوان بالتفصيل.' });
        return;
      }

      const calc = calculateOrderTotals(
        items as OrderDraftItem[],
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
        res.status(400).json({
          error: `بعض الأصناف لم تعد متوفرة حالياً: ${calc.unavailableItemNames.join('، ')}`,
        });
        return;
      }

      if (calc.outOfStockItemNames.length > 0) {
        res.status(400).json({
          error: `الكمية المطلوبة غير متوفرة في المخزون لـ: ${calc.outOfStockItemNames.join('، ')}`,
        });
        return;
      }

      if (calc.validItems.length === 0) {
        res.status(400).json({ error: 'لم يتم العثور على أصناف صالحة في الطلب.' });
        return;
      }

      if (cleanFulfillment === 'delivery' && !calc.deliveryZone) {
        res.status(400).json({
          error: 'منطقة التوصيل المختارة غير متاحة حالياً. يُرجى اختيار منطقة متاحة.',
        });
        return;
      }

      if (cleanFulfillment === 'delivery' && calc.belowZoneMinimum && calc.deliveryZone) {
        res.status(400).json({
          error: `الحد الأدنى للطلب في منطقة ${calc.deliveryZone.name} هو ${calc.deliveryZone.minOrderAmount} ${bundle.restaurant.systemSettings.currencyLabel}.`,
        });
        return;
      }

      const matchedBranch =
        bundle.branches.find((b) => b.id === branchId && b.isOpen) ??
        bundle.branches.find((b) => b.isOpen) ??
        bundle.branches[0];

      const nowIso = new Date().toISOString();
      const orderNumber = String(Math.floor(10000 + Math.random() * 89999));
      const orderToken = await signOrderToken(
        SESSION_SECRET,
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

      const savedOrder = await createOrder(newOrder);
      if (calc.appliedCoupon) {
        await incrementCouponUsage(bundle.restaurant.id, calc.appliedCoupon.code);
      }

      const whatsappUrl = buildWhatsAppOrderUrl(
        bundle.restaurant.whatsappNumber,
        savedOrder,
        bundle.restaurant.name,
        bundle.restaurant.systemSettings.currencyLabel
      );

      res.status(201).json({ order: savedOrder, whatsappUrl: whatsappUrl || '', orderToken });
    } catch (err) {
      console.error('Create order error:', err);
      res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء تسجيل الطلب. حاول مرة أخرى.' });
    }
  });

  // =========================================================
  // Admin Auth & Protected Endpoints (/api/admin/*)
  // =========================================================

  app.post('/api/admin/login', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const clientIp = getRequestClientIp(req);
      const ipHash = await hashIpForLog(clientIp);
      const loginRl = await checkSlidingRateLimit(`admin_login:${ipHash}`, 10, 900);
      if (!loginRl.allowed) {
        res.setHeader('Retry-After', String(loginRl.retryAfterSeconds));
        res.status(429).json({
          error: 'تم تجاوز عدد محاولات تسجيل الدخول المسموح بها. يُرجى المحاولة لاحقاً.',
        });
        return;
      }

      const { email, password } = req.body ?? {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanPass = String(password || '');
      const expectedEmail = (process.env.ADMIN_EMAIL || 'admin@hara-grill.eg').toLowerCase();
      const isPasswordValid = await verifyLocalAdminPassword(cleanPass);

      if (cleanEmail === expectedEmail && isPasswordValid) {
        const role: EmployeeRole = 'owner';
        const token = signLocalAdminToken(expectedEmail, role);
        res.json({ token, email: expectedEmail, role, permissions: ROLE_PERMISSIONS[role] });
        return;
      }

      const employee = await findEmployeeByEmail(DEFAULT_RESTAURANT_ID, cleanEmail);
      if (employee && isPasswordValid) {
        const token = signLocalAdminToken(employee.email, employee.role);
        res.json({
          token,
          email: employee.email,
          role: employee.role,
          permissions: ROLE_PERMISSIONS[employee.role],
        });
        return;
      }

      res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    } catch {
      res.status(500).json({ error: 'تعذر التحقق من بيانات الدخول حالياً.' });
    }
  });

  app.get('/api/admin/me', verifyAdminRequest, (req, res) => {
    const adminReq = req as AdminRequest;
    const role: EmployeeRole = adminReq.adminRole || 'owner';
    res.json({
      authenticated: true,
      email: adminReq.adminEmail,
      role,
      permissions: ROLE_PERMISSIONS[role],
    });
  });

  app.get('/api/admin/overview', verifyAdminRequest, async (req, res) => {
    try {
      const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
      const [
        bundle,
        orders,
        aiLogs,
        coupons,
        inventoryMovements,
        employees,
        activityLogs,
        notifications,
      ] = await Promise.all([
        getRestaurantBundle(restaurantId),
        listOrders(restaurantId),
        listAiLogs(restaurantId),
        listCoupons(restaurantId),
        listInventoryMovements(restaurantId),
        listEmployees(restaurantId),
        listActivityLogs(restaurantId),
        listNotifications(restaurantId),
      ]);
      const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
      res.json({
        bundle,
        hoursStatus,
        orders,
        aiLogs,
        coupons,
        inventoryMovements,
        employees,
        activityLogs,
        notifications,
        configStatus: getServiceConfigStatus(),
      });
    } catch (err) {
      console.error('Admin overview error:', err);
      res.status(500).json({ error: 'تعذر تحميل بيانات لوحة التحكم.' });
    }
  });

  app.put(
    '/api/admin/restaurant',
    verifyAdminRequest,
    requirePermission('settings', 'ai', 'system'),
    async (req, res) => {
      try {
        const { restaurantId = DEFAULT_RESTAURANT_ID, ...patch } = req.body ?? {};
        if (
          patch?.aiSettings?.model &&
          !(ALLOWED_AI_MODELS as readonly string[]).includes(String(patch.aiSettings.model))
        ) {
          res.status(400).json({ error: 'نموذج الذكاء الاصطناعي المختار غير مسموح به.' });
          return;
        }
        const updated = await updateRestaurant(restaurantId, patch);
        const hoursStatus = evaluateRestaurantHours(updated);
        await appendActivityLog({
          id: `act_${Date.now()}`,
          restaurantId,
          actorName: (req as AdminRequest).adminEmail || 'المدير',
          action: 'تحديث إعدادات المطعم',
          details: 'تم تعديل معلومات المطعم أو المواعيد أو إعدادات المساعد الذكي.',
          createdAt: new Date().toISOString(),
        });
        res.json({ restaurant: updated, hoursStatus });
      } catch (err) {
        console.error('Update restaurant error:', err);
        res.status(500).json({ error: 'تعذر حفظ بيانات المطعم.' });
      }
    }
  );

  app.post(
    '/api/admin/categories',
    verifyAdminRequest,
    requirePermission('menu'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const cat: MenuCategory = {
          id: body.id || `cat_${Date.now()}`,
          restaurantId: body.restaurantId || DEFAULT_RESTAURANT_ID,
          name: String(body.name || '').trim(),
          description: String(body.description || '').trim(),
          sortOrder: Number(body.sortOrder ?? 99),
        };
        if (!cat.name) {
          res.status(400).json({ error: 'اسم القسم مطلوب.' });
          return;
        }
        const saved = await upsertCategory(cat);
        res.json({ category: saved });
      } catch {
        res.status(500).json({ error: 'تعذر حفظ القسم.' });
      }
    }
  );

  app.delete(
    '/api/admin/categories/:id',
    verifyAdminRequest,
    requirePermission('menu'),
    async (req, res) => {
      try {
        const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
        await deleteCategory(restaurantId, req.params.id);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'تعذر حذف القسم.' });
      }
    }
  );

  app.post(
    '/api/admin/items',
    verifyAdminRequest,
    requirePermission('menu'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const price = Number(body.price);
        if (!String(body.name || '').trim() || !Number.isFinite(price) || price < 0) {
          res.status(400).json({ error: 'يُرجى إدخال اسم الصنف وسعر صحيح.' });
          return;
        }
        const item: MenuItem = {
          id: body.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          restaurantId: body.restaurantId || DEFAULT_RESTAURANT_ID,
          categoryId: String(body.categoryId),
          name: String(body.name).trim(),
          description: String(body.description || '').trim(),
          price,
          imageUrl: String(body.imageUrl || ''),
          isAvailable: body.isAvailable !== false,
          isPopular: Boolean(body.isPopular),
          stockQuantity: Math.max(0, Math.floor(Number(body.stockQuantity ?? 40))),
          lowStockThreshold: Math.max(1, Math.floor(Number(body.lowStockThreshold ?? 8))),
          sizes: Array.isArray(body.sizes) ? body.sizes : [],
          extras: Array.isArray(body.extras) ? body.extras : [],
          sortOrder: Number(body.sortOrder ?? 99),
        };
        const saved = await upsertMenuItem(item);
        res.json({ item: saved });
      } catch {
        res.status(500).json({ error: 'تعذر حفظ الصنف.' });
      }
    }
  );

  app.post(
    '/api/admin/items/reorder',
    verifyAdminRequest,
    requirePermission('menu'),
    async (req, res) => {
      try {
        const { restaurantId = DEFAULT_RESTAURANT_ID, orderedIds = [] } = req.body ?? {};
        if (!Array.isArray(orderedIds)) {
          res.status(400).json({ error: 'بيانات الترتيب غير صالحة.' });
          return;
        }
        await reorderMenuItems(restaurantId, orderedIds);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'تعذر حفظ ترتيب الأصناف.' });
      }
    }
  );

  app.delete(
    '/api/admin/items/:id',
    verifyAdminRequest,
    requirePermission('menu'),
    async (req, res) => {
      try {
        const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
        await deleteMenuItem(restaurantId, req.params.id);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'تعذر حذف الصنف.' });
      }
    }
  );

  app.post(
    '/api/admin/inventory/adjust',
    verifyAdminRequest,
    requirePermission('inventory'),
    async (req, res) => {
    try {
      const {
        restaurantId = DEFAULT_RESTAURANT_ID,
        itemId,
        delta,
        reason = 'تعديل مخزون يدوي',
      } = req.body ?? {};
      const numDelta = Math.trunc(Number(delta));
      if (!itemId || !Number.isFinite(numDelta) || numDelta === 0) {
        res.status(400).json({ error: 'يُرجى تحديد الصنف وكمية التعديل.' });
        return;
      }
      const updated = await adjustItemStock({
        restaurantId,
        itemId: String(itemId),
        delta: numDelta,
        reason: String(reason).trim() || 'تعديل مخزون يدوي',
      });
      if (!updated) {
        res.status(404).json({ error: 'الصنف غير موجود.' });
        return;
      }
      res.json({ item: updated });
    } catch {
      res.status(500).json({ error: 'تعذر تعديل المخزون.' });
    }
  });

  app.post(
    '/api/admin/delivery-zones',
    verifyAdminRequest,
    requirePermission('delivery'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const fee = Number(body.fee);
        const minOrderAmount = Math.max(0, Number(body.minOrderAmount ?? 0));
        if (!String(body.name || '').trim() || !Number.isFinite(fee) || fee < 0) {
          res.status(400).json({ error: 'يُرجى إدخال اسم المنطقة ورسوم توصيل صحيحة.' });
          return;
        }
        const zone: DeliveryZone = {
          id: body.id || `zone_${Date.now()}`,
          restaurantId: body.restaurantId || DEFAULT_RESTAURANT_ID,
          name: String(body.name).trim(),
          fee,
          minOrderAmount,
          estimatedMinutes: String(body.estimatedMinutes || '٣٠ - ٤٥ دقيقة').trim(),
          isActive: body.isActive !== false,
        };
        const saved = await upsertDeliveryZone(zone);
        res.json({ zone: saved });
      } catch {
        res.status(500).json({ error: 'تعذر حفظ منطقة التوصيل.' });
      }
    }
  );

  app.delete(
    '/api/admin/delivery-zones/:id',
    verifyAdminRequest,
    requirePermission('delivery'),
    async (req, res) => {
      try {
        const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
        await deleteDeliveryZone(restaurantId, req.params.id);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'تعذر حذف منطقة التوصيل.' });
      }
    }
  );

  app.post(
    '/api/admin/branches',
    verifyAdminRequest,
    requirePermission('delivery'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        if (!String(body.name || '').trim()) {
          res.status(400).json({ error: 'يُرجى إدخال اسم الفرع.' });
          return;
        }
        const branch: RestaurantBranch = {
          id: body.id || `br_${Date.now()}`,
          restaurantId: body.restaurantId || DEFAULT_RESTAURANT_ID,
          name: String(body.name).trim(),
          address: String(body.address || '').trim(),
          phone: String(body.phone || '').trim(),
          hoursText: String(body.hoursText || '١٢:٠٠ م - ١٢:٠٠ ص').trim(),
          isOpen: body.isOpen !== false,
        };
        const saved = await upsertBranch(branch);
        res.json({ branch: saved });
      } catch {
        res.status(500).json({ error: 'تعذر حفظ بيانات الفرع.' });
      }
    }
  );

  app.delete(
    '/api/admin/branches/:id',
    verifyAdminRequest,
    requirePermission('delivery'),
    async (req, res) => {
      try {
        const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
        await deleteBranch(restaurantId, req.params.id);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'تعذر حذف الفرع.' });
      }
    }
  );

  app.post(
    '/api/admin/coupons',
    verifyAdminRequest,
    requirePermission('coupons'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const val = Number(body.discountValue);
        if (!String(body.code || '').trim() || !Number.isFinite(val) || val <= 0) {
          res.status(400).json({ error: 'يُرجى إدخال كود الخصم وقيمة خصم صحيحة.' });
          return;
        }
        const coupon: Coupon = {
          id: body.id || `cpn_${Date.now()}`,
          restaurantId: body.restaurantId || DEFAULT_RESTAURANT_ID,
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
            ? body.applicableCategoryIds
            : [],
          applicableItemIds: Array.isArray(body.applicableItemIds) ? body.applicableItemIds : [],
        };
        const saved = await upsertCoupon(coupon);
        res.json({ coupon: saved });
      } catch {
        res.status(500).json({ error: 'تعذر حفظ كوبون الخصم.' });
      }
    }
  );

  app.delete(
    '/api/admin/coupons/:id',
    verifyAdminRequest,
    requirePermission('coupons'),
    async (req, res) => {
      try {
        const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
        await deleteCoupon(restaurantId, req.params.id);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'تعذر حذف الكوبون.' });
      }
    }
  );

  app.post(
    '/api/admin/employees',
    verifyAdminRequest,
    requirePermission('employees'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        if (!String(body.name || '').trim() || !String(body.email || '').trim()) {
          res.status(400).json({ error: 'اسم الموظف والبريد الإلكتروني مطلوبان.' });
          return;
        }
        const employee: Employee = {
          id: body.id || `emp_${Date.now()}`,
          restaurantId: body.restaurantId || DEFAULT_RESTAURANT_ID,
          name: String(body.name).trim(),
          email: String(body.email).trim(),
          phone: String(body.phone || '').trim(),
          role: ['owner', 'manager', 'cashier', 'kitchen'].includes(body.role)
            ? body.role
            : 'cashier',
          isActive: body.isActive !== false,
          createdAt: body.createdAt || new Date().toISOString(),
        };
        const saved = await upsertEmployee(employee);
        res.json({ employee: saved });
      } catch {
        res.status(500).json({ error: 'تعذر حفظ بيانات الموظف.' });
      }
    }
  );

  app.delete(
    '/api/admin/employees/:id',
    verifyAdminRequest,
    requirePermission('employees'),
    async (req, res) => {
      try {
        const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
        await deleteEmployee(restaurantId, req.params.id);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'تعذر حذف الموظف.' });
      }
    }
  );

  app.post('/api/admin/notifications/read', verifyAdminRequest, async (req, res) => {
    try {
      const restaurantId = String(req.body?.restaurantId || DEFAULT_RESTAURANT_ID);
      await markNotificationsRead(restaurantId);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'تعذر تحديث الإشعارات.' });
    }
  });

  app.patch(
    '/api/admin/orders/:id/status',
    verifyAdminRequest,
    requirePermission('orders'),
    async (req, res) => {
      try {
        const { restaurantId = DEFAULT_RESTAURANT_ID, status } = req.body ?? {};
        const validStatuses: OrderStatus[] = [
          'received',
          'under_review',
          'accepted',
          'preparing',
          'out_for_delivery',
          'delivered',
          'cancelled',
        ];
        if (!validStatuses.includes(status)) {
          res.status(400).json({ error: 'حالة الطلب غير صالحة.' });
          return;
        }
        const actor = (req as AdminRequest).adminEmail || 'المدير';
        const updated = await updateOrderStatus(restaurantId, req.params.id, status, actor);
        if (!updated) {
          res.status(404).json({ error: 'الطلب غير موجود.' });
          return;
        }
        res.json({ order: updated });
      } catch {
        res.status(500).json({ error: 'تعذر تحديث حالة الطلب.' });
      }
    }
  );

  app.get(
    '/api/admin/orders/export',
    verifyAdminRequest,
    requirePermission('orders', 'analytics'),
    async (req, res) => {
      try {
        const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
        const orders = await listOrders(restaurantId);
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
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="orders-report.csv"');
        res.send(csv);
      } catch {
        res.status(500).json({ error: 'تعذر تصدير تقرير الطلبات.' });
      }
    }
  );

  app.post(
    '/api/admin/password',
    verifyAdminRequest,
    requirePermission('system'),
    async (req, res) => {
      const { currentPassword, newPassword } = req.body ?? {};
      if (!(await verifyLocalAdminPassword(String(currentPassword || '')))) {
        res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
        return;
      }
      const nextPass = String(newPassword || '');
      if (nextPass.length < 8 || !/[A-Z]/.test(nextPass) || !/\d/.test(nextPass)) {
        res.status(400).json({
          error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير ورقم واحد على الأقل.',
        });
        return;
      }
      await setLocalAdminPassword(nextPass);
      res.json({ ok: true });
    }
  );

  app.post('/api/admin/upload', verifyAdminRequest, async (req, res) => {
    try {
      const { filename = 'image.jpg', mimeType = 'image/jpeg', dataBase64 } = req.body ?? {};
      if (!dataBase64 || typeof dataBase64 !== 'string') {
        res.status(400).json({ error: 'لم يتم إرسال ملف الصورة.' });
        return;
      }
      const cleanBase64 = dataBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length > 5 * 1024 * 1024) {
        res.status(400).json({ error: 'حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت).' });
        return;
      }
      const url = await uploadImageAsset(String(filename), String(mimeType), buffer);
      res.json({ url });
    } catch {
      res.status(500).json({ error: 'تعذر رفع الصورة حالياً.' });
    }
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    if (hmrDisabled) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const transformed = await vite.transformRequest('/@vite/client');
          if (!transformed) {
            next();
            return;
          }
          const patched = transformed.code.replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR disabled: WebSocket connection skipped */'
          );
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.send(patched);
        } catch {
          next();
        }
      });
    }
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
