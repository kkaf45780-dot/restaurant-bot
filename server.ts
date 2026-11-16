import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  authenticateBearerRequest,
  getEffectiveSessionSecret,
  hashPasswordBcrypt,
  isStrongAdminPassword,
  signAdminJwt,
  verifyPasswordAgainstHash,
} from './worker/auth.ts';
import {
  checkCouponRateLimit,
  checkFixedWindowRateLimit,
  checkTrackRateLimit,
  getClientIp,
} from './worker/middleware/rate-limit.ts';
import {
  SECURITY_HEADERS,
  isKnownSpaRoute,
  isStaticAssetPath,
  resolveAllowedCorsOrigin,
} from './worker/middleware/security.ts';
import { handleAdminLogin } from './worker/routes/admin-login.ts';
import { handlePublicChat } from './worker/routes/chat.ts';
import {
  getAdminServiceConfigStatus,
  handlePublicConfigStatus,
} from './worker/routes/config-status.ts';
import {
  handlePublicOrderTrack,
  isValidOrderTokenFormat,
  toPublicOrderTracking,
} from './worker/routes/orders-track.ts';
import { DEFAULT_RESTAURANT_ID } from './src/data/restaurant.ts';
import { evaluateRestaurantHours } from './src/lib/hours.ts';
import {
  ROLE_PERMISSIONS,
  hasPermission,
  type AdminTabPermission,
} from './src/lib/permissions.ts';
import { calculateOrderTotals } from './src/lib/pricing.ts';
import { buildWhatsAppOrderUrl } from './src/lib/whatsapp.ts';
import {
  UPLOADS_DIR,
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
  findOrderByToken,
  getRestaurantBundle,
  incrementCouponUsage,
  isLocalOwnerPasswordOverridden,
  isSupabaseBackendActive,
  listActivityLogs,
  listAiLogs,
  listCoupons,
  listEmployees,
  listInventoryMovements,
  listNotifications,
  listOrders,
  markNotificationsRead,
  rateOrderByToken,
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
  type RestaurantBranch,
} from './src/types/restaurant.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SESSION_SECRET?.trim()) {
  console.warn(
    '[Security Warning] ADMIN_SESSION_SECRET is missing in production environment.'
  );
}

interface AdminRequest extends Request {
  adminEmail?: string;
  adminRole?: EmployeeRole;
  mustChangePassword?: boolean;
}

const VALID_ROLES: EmployeeRole[] = ['owner', 'manager', 'cashier', 'kitchen'];

function getAuthEnv() {
  return {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_VERSION: process.env.APP_VERSION || '2.0.0',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  };
}

function sanitizeCsvCell(val: unknown): string {
  const str = String(val ?? '');
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

async function sendWebResponse(res: Response, webRes: globalThis.Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const text = await webRes.text();
  res.send(text);
}

async function resolveRoleForEmail(
  email: string
): Promise<{ role: EmployeeRole; mustChangePassword: boolean } | null> {
  const clean = email.trim().toLowerCase();
  const expectedOwner = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (expectedOwner && clean === expectedOwner) {
    return { role: 'owner', mustChangePassword: !isLocalOwnerPasswordOverridden() };
  }
  const emp = await findEmployeeByEmail(DEFAULT_RESTAURANT_ID, clean);
  if (!emp) return null;
  return { role: emp.role, mustChangePassword: Boolean(emp.mustChangePassword) };
}

async function verifyAdminRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const allowPendingPasswordChange =
    req.path === '/api/admin/password' || req.path === '/api/admin/me';

  const result = await authenticateBearerRequest({
    requestHeaders: req.headers,
    env: getAuthEnv(),
    resolveRole: resolveRoleForEmail,
    allowPendingPasswordChange,
  });

  if (!result.ok) {
    await sendWebResponse(res, result.response);
    return;
  }

  (req as AdminRequest).adminEmail = result.email;
  (req as AdminRequest).adminRole = result.role;
  (req as AdminRequest).mustChangePassword = result.mustChangePassword;
  next();
}

function requirePermission(...allowed: AdminTabPermission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const adminReq = req as AdminRequest;
    if (adminReq.mustChangePassword && req.path === '/api/admin/password') {
      next();
      return;
    }
    const role: EmployeeRole = adminReq.adminRole || 'cashier';
    if (allowed.some((perm) => hasPermission(role, perm))) {
      next();
      return;
    }
    res.status(403).json({
      error: 'ليس لديك صلاحية تنفيذ هذا الإجراء بدورك الوظيفي الحالي.',
    });
  };
}

const FALLBACK_404_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>الصفحة غير موجودة (404) — مشويات الحارة</title>
  </head>
  <body style="font-family: Cairo, system-ui, sans-serif; background:#F7F3E9; color:#18221D; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; text-align:center;">
    <main style="max-width:460px; padding:32px; background:#fff; border-radius:20px; border:1px solid #E5E0D5;">
      <h1 style="font-size:48px; margin:0 0 8px; color:#104B34;">404</h1>
      <p style="font-size:18px; font-weight:700; margin:0 0 8px;">الصفحة غير موجودة</p>
      <p style="font-size:14px; color:#4A5850; margin:0 0 24px;">الرابط الذي طلبته غير متوفر في موقع مشويات الحارة.</p>
      <a href="/" style="display:inline-block; background:#104B34; color:#fff; padding:12px 24px; border-radius:12px; text-decoration:none; font-weight:700;">العودة للرئيسية</a>
    </main>
  </body>
</html>`;

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    const isProd = process.env.NODE_ENV === 'production';
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
    const isAiStudioPreview =
      !isProd || rawHost.endsWith('.run.app') || process.env.ALLOW_IFRAME_PREVIEW === 'true';
    const allowIframeDocument = isAiStudioPreview && !req.path.startsWith('/api/');

    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (key === 'X-Frame-Options' && allowIframeDocument) {
        // AI Studio renders the preview app inside a parent iframe; Cloudflare Workers
        // production still enforces X-Frame-Options: DENY.
        continue;
      }
      if (key === 'Content-Security-Policy') {
        let csp = value;
        if (!isProd && !req.path.startsWith('/api/')) {
          // Vite dev server injects inline @react-refresh preamble during development only;
          // production and Worker enforce strict script-src 'self'.
          csp = csp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
        }
        if (allowIframeDocument) {
          csp = csp.replace(
            "frame-ancestors 'none'",
            "frame-ancestors 'self' https://aistudio.google.com https://*.aistudio.google.com https://*.google.com https://*.googleusercontent.com https://*.usercontent.goog"
          );
        }
        res.setHeader(key, csp);
      } else {
        res.setHeader(key, value);
      }
    }
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    if (req.path.startsWith('/api/admin/') || req.path === '/api/orders/track') {
      res.setHeader('Cache-Control', 'no-store');
    }

    const requestOrigin = req.headers.origin;
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.get('host') || '').trim();
    const hostOrigin = `${forwardedProto}://${forwardedHost}`;
    const allowedOrigin = resolveAllowedCorsOrigin(
      requestOrigin ?? null,
      hostOrigin,
      process.env.ALLOWED_ORIGINS
    );
    if (requestOrigin && !allowedOrigin && req.method === 'OPTIONS') {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Captcha-Token');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.status(204).end();
        return;
      }
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
    res.json(handlePublicConfigStatus(getAuthEnv()));
  });

  // Public Restaurant Bundle + Computed Hours
  app.get('/api/restaurant/:slug?', async (req, res) => {
    try {
      const clientIp = getClientIp(req.headers);
      const rate = await checkFixedWindowRateLimit({
        prefix: 'restaurant',
        key: clientIp,
        limit: 60,
        windowSeconds: 60,
      });
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        res.status(429).json({
          error: 'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.',
          retryAfterSeconds: rate.retryAfterSeconds,
        });
        return;
      }
      const slugOrId = req.params.slug || DEFAULT_RESTAURANT_ID;
      const bundle = await getRestaurantBundle(slugOrId);
      const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
      res.json({ bundle, hoursStatus });
    } catch (err) {
      console.error('Error loading restaurant:', err);
      res.status(500).json({ error: 'تعذر تحميل بيانات المطعم حالياً، يُرجى المحاولة لاحقاً.' });
    }
  });

  // Public Coupon Validation
  app.post('/api/coupons/validate', async (req, res) => {
    try {
      const clientIp = getClientIp(req.headers);
      const rate = await checkCouponRateLimit({ ip: clientIp });
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        res.status(429).json({
          error: 'تم إرسال محاولات كثيرة للتحقق من الكوبون، يُرجى الانتظار دقيقة.',
          retryAfterSeconds: rate.retryAfterSeconds,
        });
        return;
      }

      const {
        restaurantId = DEFAULT_RESTAURANT_ID,
        code,
        items = [],
        deliveryZoneId = '',
        fulfillmentType = 'delivery',
      } = req.body ?? {};
      const bundle = await getRestaurantBundle(restaurantId);
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
        coupon: calc.appliedCoupon,
        discountAmount: calc.discountAmount,
        totals: calc,
      });
    } catch {
      res.status(500).json({ error: 'تعذر التحقق من كود الخصم حالياً.' });
    }
  });

  // Public Order Tracking (token-based only, PII-masked)
  app.get('/api/orders/track', async (req, res) => {
    try {
      const restaurantId = String(req.query.restaurantId || DEFAULT_RESTAURANT_ID);
      const token = String(req.query.token || req.query.orderToken || '').trim();
      const hasLegacyParam = Boolean(req.query.orderNumber || req.query.phone);
      const webRes = await handlePublicOrderTrack({
        ip: getClientIp(req.headers),
        token,
        hasLegacyParam,
        findByToken: (t) => findOrderByToken(restaurantId, t),
      });
      await sendWebResponse(res, webRes);
    } catch {
      res.status(500).json({ error: 'تعذر البحث عن الطلب حالياً.' });
    }
  });

  // Public Order Rating (orderToken only)
  app.post('/api/orders/:orderToken/rate', async (req, res) => {
    try {
      const rate = await checkTrackRateLimit({ ip: getClientIp(req.headers) });
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        res.status(429).json({
          error: 'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.',
          retryAfterSeconds: rate.retryAfterSeconds,
        });
        return;
      }

      const orderToken = String(req.params.orderToken || '').trim();
      if (!isValidOrderTokenFormat(orderToken)) {
        res.status(400).json({ error: 'رمز التتبع غير صالح.' });
        return;
      }

      const { restaurantId = DEFAULT_RESTAURANT_ID, rating, comment = '' } = req.body ?? {};
      const numRating = Math.trunc(Number(rating));
      if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
        res.status(400).json({ error: 'يُرجى اختيار تقييم من 1 إلى 5 نجوم.' });
        return;
      }
      const updated = await rateOrderByToken(
        String(restaurantId),
        orderToken,
        numRating,
        String(comment || '')
      );
      if (!updated) {
        res.status(404).json({ error: 'لم يتم العثور على الطلب.' });
        return;
      }
      res.json({ tracking: toPublicOrderTracking(updated) });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر تسجيل التقييم حالياً.',
      });
    }
  });

  // Public AI Receptionist Chat with Rate Limiting & CAPTCHA
  app.post('/api/chat', async (req, res) => {
    try {
      const body = req.body ?? {};
      const captchaToken =
        body.captchaToken ||
        (typeof req.headers['x-captcha-token'] === 'string'
          ? req.headers['x-captcha-token']
          : undefined);
      const restaurantId = String(body.restaurantId || DEFAULT_RESTAURANT_ID);

      const webRes = await handlePublicChat({
        ip: getClientIp(req.headers),
        captchaToken,
        turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
        geminiApiKey: process.env.GEMINI_API_KEY,
        message: body.message,
        history: body.history,
        orderDraft: body.orderDraft,
        loadBundle: () => getRestaurantBundle(restaurantId),
        onAiLog: (entry) => appendAiLog(entry),
      });
      await sendWebResponse(res, webRes);
    } catch (err) {
      console.error('Chat endpoint error:', err);
      res.status(500).json({
        error: 'حدث خطأ أثناء معالجة الرسالة، يمكنك التواصل معنا مباشرة عبر واتساب.',
      });
    }
  });

  // Public Order Creation
  app.post('/api/orders', async (req, res) => {
    try {
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

      const bundle = await getRestaurantBundle(restaurantId);

      if (idempotencyKey && typeof idempotencyKey === 'string') {
        const existing = await findOrderByIdempotencyKey(bundle.restaurant.id, idempotencyKey);
        if (existing) {
          const whatsappUrl = buildWhatsAppOrderUrl(
            bundle.restaurant.whatsappNumber,
            existing,
            bundle.restaurant.name,
            bundle.restaurant.systemSettings.currencyLabel
          );
          res.status(200).json({ order: existing, whatsappUrl, deduplicated: true });
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
      const newOrder: Order = {
        id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        orderNumber,
        orderToken: crypto.randomUUID(),
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

      res.status(201).json({ order: savedOrder, whatsappUrl: whatsappUrl || '' });
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
      const { email, password } = req.body ?? {};
      const webRes = await handleAdminLogin({
        env: getAuthEnv(),
        email: String(email || ''),
        password: String(password || ''),
        ip: getClientIp(req.headers),
        lookupEmployee: (cleanEmail) => findEmployeeByEmail(DEFAULT_RESTAURANT_ID, cleanEmail),
        verifyOwnerPassword: (pass) => verifyLocalAdminPassword(pass),
        isOwnerPasswordOverridden: async () => isLocalOwnerPasswordOverridden(),
        onAuditLog: (actorEmail, details) =>
          appendActivityLog({
            id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            restaurantId: DEFAULT_RESTAURANT_ID,
            actorName: actorEmail,
            action: 'تسجيل دخول لوحة الإدارة',
            details,
            createdAt: new Date().toISOString(),
          }),
      });
      await sendWebResponse(res, webRes);
    } catch {
      res.status(500).json({ error: 'تعذر التحقق من بيانات الدخول حالياً.' });
    }
  });

  app.get('/api/admin/me', verifyAdminRequest, (req, res) => {
    const adminReq = req as AdminRequest;
    const role: EmployeeRole = adminReq.adminRole || 'cashier';
    res.json({
      authenticated: true,
      email: adminReq.adminEmail,
      role,
      mustChangePassword: Boolean(adminReq.mustChangePassword),
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
        configStatus: getAdminServiceConfigStatus(getAuthEnv(), isSupabaseBackendActive()),
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
    }
  );

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
        const plainPassword = typeof body.password === 'string' ? body.password : '';
        let passwordHash: string | undefined;
        let mustChangePassword: boolean | undefined;
        if (plainPassword) {
          if (!isStrongAdminPassword(plainPassword)) {
            res.status(400).json({
              error:
                'كلمة مرور الموظف يجب أن تكون 10 أحرف على الأقل وتحتوي على أحرف كبيرة وصغيرة ورقم ولا تكون كلمة افتراضية.',
            });
            return;
          }
          passwordHash = await hashPasswordBcrypt(plainPassword);
          mustChangePassword = body.mustChangePassword !== false;
        }
        const rawRole = String(body.role || 'cashier') as EmployeeRole;
        const employee: Employee = {
          id: body.id || `emp_${Date.now()}`,
          restaurantId: body.restaurantId || DEFAULT_RESTAURANT_ID,
          name: String(body.name).trim(),
          email: String(body.email).trim().toLowerCase(),
          phone: String(body.phone || '').trim(),
          role: VALID_ROLES.includes(rawRole) ? rawRole : 'cashier',
          isActive: body.isActive !== false,
          passwordHash,
          mustChangePassword,
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
        const rows = orders.map((o) =>
          [
            sanitizeCsvCell(o.orderNumber),
            sanitizeCsvCell(o.customerName),
            sanitizeCsvCell(o.customerPhone),
            sanitizeCsvCell(o.fulfillmentType === 'pickup' ? 'استلام من الفرع' : 'توصيل'),
            sanitizeCsvCell(o.deliveryZoneName || o.branchName || ''),
            sanitizeCsvCell(o.customerAddress),
            o.subtotal,
            o.discountAmount,
            o.deliveryFee,
            o.total,
            sanitizeCsvCell(o.status),
            o.rating ? `${o.rating}/5` : '',
            sanitizeCsvCell(o.createdAt),
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
      const adminReq = req as AdminRequest;
      const { currentPassword, newPassword } = req.body ?? {};
      const currentPass = String(currentPassword || '');
      const nextPass = String(newPassword || '');
      const actorEmail = (adminReq.adminEmail || '').toLowerCase();
      const expectedOwner = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      const isOwner = expectedOwner && actorEmail === expectedOwner;

      if (isOwner) {
        if (!(await verifyLocalAdminPassword(currentPass))) {
          res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
          return;
        }
      } else {
        const emp = await findEmployeeByEmail(DEFAULT_RESTAURANT_ID, actorEmail);
        if (!emp || !emp.passwordHash || !(await verifyPasswordAgainstHash(currentPass, emp.passwordHash))) {
          res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
          return;
        }
      }

      if (!isStrongAdminPassword(nextPass)) {
        res.status(400).json({
          error:
            'كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم ولا تكون من كلمات المرور الافتراضية.',
        });
        return;
      }

      if (isOwner) {
        await setLocalAdminPassword(nextPass);
      } else {
        const emp = await findEmployeeByEmail(DEFAULT_RESTAURANT_ID, actorEmail);
        if (emp) {
          await upsertEmployee({
            ...emp,
            passwordHash: await hashPasswordBcrypt(nextPass),
            mustChangePassword: false,
          });
        }
      }

      await appendActivityLog({
        id: `act_${Date.now()}`,
        restaurantId: DEFAULT_RESTAURANT_ID,
        actorName: actorEmail,
        action: 'تغيير كلمة المرور',
        details: 'تم تحديث كلمة المرور بنجاح.',
        createdAt: new Date().toISOString(),
      });

      const secret = getEffectiveSessionSecret(getAuthEnv());
      const token = secret
        ? await signAdminJwt({
            secret,
            email: actorEmail,
            role: adminReq.adminRole || 'owner',
            mustChangePassword: false,
          })
        : undefined;

      res.json({ ok: true, token, mustChangePassword: false });
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

  app.use('/api/*', (_req, res) => {
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

    // Reject unknown non-asset, non-SPA routes with real HTTP 404 before Vite SPA fallback
    app.use((req, res, next) => {
      const urlPath = req.path;
      const isViteInternal =
        urlPath.startsWith('/@') ||
        urlPath.startsWith('/src/') ||
        urlPath.startsWith('/node_modules/') ||
        urlPath === '/sw.js' ||
        urlPath === '/manifest.webmanifest' ||
        urlPath.startsWith('/workbox-');
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        !urlPath.startsWith('/api/') &&
        !isViteInternal &&
        !isStaticAssetPath(urlPath) &&
        !isKnownSpaRoute(urlPath)
      ) {
        const custom404 = path.resolve(process.cwd(), 'public/404.html');
        if (fs.existsSync(custom404)) {
          res.status(404).sendFile(custom404);
        } else {
          res.status(404).type('html').send(FALLBACK_404_HTML);
        }
        return;
      }
      next();
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
          res.type('application/javascript').send(patched);
        } catch {
          next();
        }
      });
    }
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (isKnownSpaRoute(req.path)) {
        res.sendFile(path.join(distDir, 'index.html'));
        return;
      }
      const dist404 = path.join(distDir, '404.html');
      if (fs.existsSync(dist404)) {
        res.status(404).sendFile(dist404);
      } else {
        res.status(404).type('html').send(FALLBACK_404_HTML);
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Restaurant Bot server listening on http://localhost:${PORT}`);
  });
}

startServer();
