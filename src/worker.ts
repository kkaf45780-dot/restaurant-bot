import { handleAdminLogin } from '../worker/routes/admin-login.ts';
import { handlePublicChat } from '../worker/routes/chat.ts';
import {
  getAdminServiceConfigStatus,
  handlePublicConfigStatus,
} from '../worker/routes/config-status.ts';
import {
  handlePublicOrderTrack,
  isValidOrderTokenFormat,
  toPublicOrderTracking,
} from '../worker/routes/orders-track.ts';
import {
  authenticateBearerRequest,
  getEffectiveSessionSecret,
  hashPasswordBcrypt,
  isStrongAdminPassword,
  signAdminJwt,
  verifyPasswordAgainstHash,
} from '../worker/auth.ts';
import {
  checkCouponRateLimit,
  checkFixedWindowRateLimit,
  checkTrackRateLimit,
  getClientIp,
  rateLimitResponse,
} from '../worker/middleware/rate-limit.ts';
import {
  applySecurityHeaders,
  handleCorsPreflight,
  isKnownSpaRoute,
  isStaticAssetPath,
  safeErrorResponse,
} from '../worker/middleware/security.ts';
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
  findOrderByToken,
  getRestaurantBundle,
  incrementCouponUsage,
  isOwnerPasswordOverridden,
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
} from './server/edgeStore.ts';
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
} from './types/restaurant.ts';

const VALID_ROLES: EmployeeRole[] = ['owner', 'manager', 'cashier', 'kitchen'];

function getKvStore(env: EdgeEnv) {
  return env.RATE_LIMIT_KV || env.RESTAURANT_DB;
}

function checkPermission(role: EmployeeRole, ...allowed: AdminTabPermission[]): Response | null {
  if (allowed.some((perm) => hasPermission(role, perm))) return null;
  return Response.json(
    { error: 'ليس لديك صلاحية تنفيذ هذا الإجراء بدورك الوظيفي الحالي.' },
    { status: 403 }
  );
}

async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function sanitizeCsvCell(val: unknown): string {
  const str = String(val ?? '');
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

async function resolveRoleForEmail(
  env: EdgeEnv,
  email: string
): Promise<{ role: EmployeeRole; mustChangePassword: boolean } | null> {
  const clean = email.trim().toLowerCase();
  const expectedOwner = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (expectedOwner && clean === expectedOwner) {
    const overridden = await isOwnerPasswordOverridden(env);
    return { role: 'owner', mustChangePassword: !overridden };
  }
  const emp = await findEmployeeByEmail(env, DEFAULT_RESTAURANT_ID, clean);
  if (!emp) return null;
  return { role: emp.role, mustChangePassword: Boolean(emp.mustChangePassword) };
}

async function handleApiRequest(request: Request, env: EdgeEnv): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();
  const clientIp = getClientIp(request.headers);
  const kv = getKvStore(env);

  if (method === 'GET' && pathname === '/api/health') {
    return Response.json({ ok: true, service: 'moazzaf-almatam', runtime: 'cloudflare-workers' });
  }

  if (method === 'GET' && pathname === '/api/config/status') {
    return Response.json(handlePublicConfigStatus(env));
  }

  if (
    method === 'GET' &&
    (pathname === '/api/restaurant' || pathname.startsWith('/api/restaurant/'))
  ) {
    try {
      const rate = await checkFixedWindowRateLimit({
        kv,
        prefix: 'restaurant',
        key: clientIp,
        limit: 60,
        windowSeconds: 60,
      });
      if (!rate.allowed) {
        return rateLimitResponse(
          rate.retryAfterSeconds,
          'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.'
        );
      }
      const slug = pathname.slice('/api/restaurant'.length).replace(/^\//, '');
      const slugOrId = slug ? decodeURIComponent(slug) : DEFAULT_RESTAURANT_ID;
      const bundle = await getRestaurantBundle(env, slugOrId);
      const hoursStatus = evaluateRestaurantHours(bundle.restaurant);
      return Response.json({ bundle, hoursStatus });
    } catch (err) {
      return safeErrorResponse(
        500,
        'تعذر تحميل بيانات المطعم حالياً، يُرجى المحاولة لاحقاً.',
        err
      );
    }
  }

  if (method === 'POST' && pathname === '/api/coupons/validate') {
    try {
      const rate = await checkCouponRateLimit({ kv, ip: clientIp });
      if (!rate.allowed) {
        return rateLimitResponse(
          rate.retryAfterSeconds,
          'تم إرسال محاولات كثيرة للتحقق من الكوبون، يُرجى الانتظار دقيقة.'
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
      const bundle = await getRestaurantBundle(env, restaurantId);
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
        coupon: calc.appliedCoupon,
        discountAmount: calc.discountAmount,
        totals: calc,
      });
    } catch (err) {
      return safeErrorResponse(500, 'تعذر التحقق من كود الخصم حالياً.', err);
    }
  }

  if (method === 'GET' && pathname === '/api/orders/track') {
    try {
      const restaurantId = url.searchParams.get('restaurantId') || DEFAULT_RESTAURANT_ID;
      const token = (
        url.searchParams.get('token') ||
        url.searchParams.get('orderToken') ||
        ''
      ).trim();
      const hasLegacyParam = Boolean(
        url.searchParams.get('orderNumber') || url.searchParams.get('phone')
      );
      return await handlePublicOrderTrack({
        kv,
        ip: clientIp,
        token,
        hasLegacyParam,
        findByToken: (t) => findOrderByToken(env, restaurantId, t),
      });
    } catch (err) {
      return safeErrorResponse(500, 'تعذر البحث عن الطلب حالياً.', err);
    }
  }

  const rateMatch = pathname.match(/^\/api\/orders\/([^/]+)\/rate$/);
  if (method === 'POST' && rateMatch) {
    try {
      const rate = await checkTrackRateLimit({ kv, ip: clientIp });
      if (!rate.allowed) {
        return rateLimitResponse(
          rate.retryAfterSeconds,
          'تم إرسال طلبات كثيرة، يُرجى الانتظار دقيقة.'
        );
      }
      const orderToken = decodeURIComponent(rateMatch[1]);
      if (!isValidOrderTokenFormat(orderToken)) {
        return Response.json({ error: 'رمز التتبع غير صالح.' }, { status: 400 });
      }
      const body = await readJsonBody<{
        restaurantId?: string;
        rating?: number;
        comment?: string;
      }>(request);
      const { restaurantId = DEFAULT_RESTAURANT_ID, rating, comment = '' } = body;
      const numRating = Math.trunc(Number(rating));
      if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
        return Response.json({ error: 'يُرجى اختيار تقييم من 1 إلى 5 نجوم.' }, { status: 400 });
      }
      const updated = await rateOrderByToken(
        env,
        String(restaurantId),
        orderToken,
        numRating,
        String(comment || '')
      );
      if (!updated) {
        return Response.json({ error: 'لم يتم العثور على الطلب.' }, { status: 404 });
      }
      return Response.json({ tracking: toPublicOrderTracking(updated) });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'تعذر تسجيل التقييم حالياً.' },
        { status: 400 }
      );
    }
  }

  if (method === 'POST' && pathname === '/api/chat') {
    try {
      const body = await readJsonBody<{
        restaurantId?: string;
        message?: unknown;
        history?: unknown;
        captchaToken?: string;
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
      }>(request);

      const captchaToken =
        body.captchaToken || request.headers.get('x-captcha-token') || undefined;
      const restaurantId = body.restaurantId || DEFAULT_RESTAURANT_ID;

      return await handlePublicChat({
        kv,
        ip: clientIp,
        captchaToken,
        turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
        geminiApiKey: env.GEMINI_API_KEY,
        message: body.message,
        history: body.history,
        orderDraft: body.orderDraft,
        loadBundle: () => getRestaurantBundle(env, restaurantId),
        onAiLog: (entry) => appendAiLog(env, entry),
      });
    } catch (err) {
      return safeErrorResponse(
        500,
        'حدث خطأ أثناء معالجة الرسالة، يمكنك التواصل معنا مباشرة عبر واتساب.',
        err
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

      const bundle = await getRestaurantBundle(env, restaurantId);

      if (idempotencyKey && typeof idempotencyKey === 'string') {
        const existing = await findOrderByIdempotencyKey(env, bundle.restaurant.id, idempotencyKey);
        if (existing) {
          const whatsappUrl = buildWhatsAppOrderUrl(
            bundle.restaurant.whatsappNumber,
            existing,
            bundle.restaurant.name,
            bundle.restaurant.systemSettings.currencyLabel
          );
          return Response.json({ order: existing, whatsappUrl, deduplicated: true });
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

      return Response.json({ order: savedOrder, whatsappUrl: whatsappUrl || '' }, { status: 201 });
    } catch (err) {
      return safeErrorResponse(
        500,
        'حدث خطأ غير متوقع أثناء تسجيل الطلب. حاول مرة أخرى.',
        err
      );
    }
  }

  // =========================================================
  // Admin Auth & Protected Endpoints (/api/admin/*)
  // =========================================================

  if (method === 'POST' && pathname === '/api/admin/login') {
    try {
      const body = await readJsonBody<{ email?: string; password?: string }>(request);
      return await handleAdminLogin({
        kv,
        env,
        email: String(body.email || ''),
        password: String(body.password || ''),
        ip: clientIp,
        lookupEmployee: (email) => findEmployeeByEmail(env, DEFAULT_RESTAURANT_ID, email),
        verifyOwnerPassword: (pass) => verifyAdminPassword(env, pass),
        isOwnerPasswordOverridden: () => isOwnerPasswordOverridden(env),
        onAuditLog: (actorEmail, details) =>
          appendActivityLog(env, {
            id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            restaurantId: DEFAULT_RESTAURANT_ID,
            actorName: actorEmail,
            action: 'تسجيل دخول لوحة الإدارة',
            details,
            createdAt: new Date().toISOString(),
          }),
      });
    } catch (err) {
      return safeErrorResponse(500, 'تعذر التحقق من بيانات الدخول حالياً.', err);
    }
  }

  if (pathname.startsWith('/api/admin/')) {
    const allowPendingPasswordChange =
      pathname === '/api/admin/password' || pathname === '/api/admin/me';
    const authResult = await authenticateBearerRequest({
      requestHeaders: request.headers,
      env,
      resolveRole: (email) => resolveRoleForEmail(env, email),
      allowPendingPasswordChange,
    });
    if (!authResult.ok) return authResult.response;
    const auth = authResult;

    if (method === 'GET' && pathname === '/api/admin/me') {
      return Response.json({
        authenticated: true,
        email: auth.email,
        role: auth.role,
        mustChangePassword: auth.mustChangePassword,
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
        ] = await Promise.all([
          getRestaurantBundle(env, restaurantId),
          listOrders(env, restaurantId),
          listAiLogs(env, restaurantId),
          listCoupons(env, restaurantId),
          listInventoryMovements(env, restaurantId),
          listEmployees(env, restaurantId),
          listActivityLogs(env, restaurantId),
          listNotifications(env, restaurantId),
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
          configStatus: getAdminServiceConfigStatus(env, isSupabaseBackendActive(env)),
        });
      } catch (err) {
        return safeErrorResponse(500, 'تعذر تحميل بيانات لوحة التحكم.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حفظ بيانات المطعم.', err);
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
        return safeErrorResponse(500, 'تعذر حفظ القسم.', err);
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
        return safeErrorResponse(500, 'تعذر حذف القسم.', err);
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
        return safeErrorResponse(500, 'تعذر حفظ الصنف.', err);
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
        return safeErrorResponse(500, 'تعذر حفظ ترتيب الأصناف.', err);
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
        return safeErrorResponse(500, 'تعذر حذف الصنف.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر تعديل المخزون.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حفظ منطقة التوصيل.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حذف منطقة التوصيل.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حفظ بيانات الفرع.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حذف الفرع.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حفظ كوبون الخصم.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حذف الكوبون.', err);
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
        const plainPassword = typeof body.password === 'string' ? body.password : '';
        let passwordHash: string | undefined;
        let mustChangePassword: boolean | undefined;
        if (plainPassword) {
          if (!isStrongAdminPassword(plainPassword)) {
            return Response.json(
              {
                error:
                  'كلمة مرور الموظف يجب أن تكون 10 أحرف على الأقل وتحتوي على أحرف كبيرة وصغيرة ورقم ولا تكون كلمة افتراضية.',
              },
              { status: 400 }
            );
          }
          passwordHash = await hashPasswordBcrypt(plainPassword);
          mustChangePassword = body.mustChangePassword !== false;
        }
        const employee: Employee = {
          id: String(body.id || `emp_${Date.now()}`),
          restaurantId: String(body.restaurantId || DEFAULT_RESTAURANT_ID),
          name: String(body.name).trim(),
          email: String(body.email).trim().toLowerCase(),
          phone: String(body.phone || '').trim(),
          role: VALID_ROLES.includes(rawRole) ? rawRole : 'cashier',
          isActive: body.isActive !== false,
          passwordHash,
          mustChangePassword,
          createdAt: String(body.createdAt || new Date().toISOString()),
        };
        const saved = await upsertEmployee(env, employee);
        return Response.json({ employee: saved });
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حفظ بيانات الموظف.', err);
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
      } catch (err) {
        return safeErrorResponse(500, 'تعذر حذف الموظف.', err);
      }
    }

    if (method === 'POST' && pathname === '/api/admin/notifications/read') {
      try {
        const body = await readJsonBody<{ restaurantId?: string }>(request);
        await markNotificationsRead(env, body.restaurantId || DEFAULT_RESTAURANT_ID);
        return Response.json({ ok: true });
      } catch (err) {
        return safeErrorResponse(500, 'تعذر تحديث الإشعارات.', err);
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
        return safeErrorResponse(500, 'تعذر تحديث حالة الطلب.', err);
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
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="orders-report.csv"',
          },
        });
      } catch (err) {
        return safeErrorResponse(500, 'تعذر تصدير تقرير الطلبات.', err);
      }
    }

    if (method === 'POST' && pathname === '/api/admin/password') {
      const isSelfForceChange = auth.mustChangePassword;
      if (!isSelfForceChange) {
        const denied = checkPermission(auth.role, 'system');
        if (denied) return denied;
      }

      const body = await readJsonBody<{ currentPassword?: string; newPassword?: string }>(request);
      const currentPass = String(body.currentPassword || '');
      const nextPass = String(body.newPassword || '');

      const expectedOwner = (env.ADMIN_EMAIL || '').trim().toLowerCase();
      const isOwnerAccount = expectedOwner && auth.email.toLowerCase() === expectedOwner;

      if (isOwnerAccount) {
        const currentOk = await verifyAdminPassword(env, currentPass);
        if (!currentOk) {
          return Response.json({ error: 'كلمة المرور الحالية غير صحيحة.' }, { status: 400 });
        }
      } else {
        const emp = await findEmployeeByEmail(env, DEFAULT_RESTAURANT_ID, auth.email);
        if (!emp || !emp.passwordHash || !(await verifyPasswordAgainstHash(currentPass, emp.passwordHash))) {
          return Response.json({ error: 'كلمة المرور الحالية غير صحيحة.' }, { status: 400 });
        }
      }

      if (!isStrongAdminPassword(nextPass)) {
        return Response.json(
          {
            error:
              'كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم ولا تكون من كلمات المرور الافتراضية.',
          },
          { status: 400 }
        );
      }

      if (isOwnerAccount) {
        await setAdminPassword(env, nextPass);
      } else {
        const emp = await findEmployeeByEmail(env, DEFAULT_RESTAURANT_ID, auth.email);
        if (emp) {
          await upsertEmployee(env, {
            ...emp,
            passwordHash: await hashPasswordBcrypt(nextPass),
            mustChangePassword: false,
          });
        }
      }

      await appendActivityLog(env, {
        id: `act_${Date.now()}`,
        restaurantId: DEFAULT_RESTAURANT_ID,
        actorName: auth.email,
        action: 'تغيير كلمة المرور',
        details: 'تم تحديث كلمة المرور بنجاح.',
        createdAt: new Date().toISOString(),
      });

      const secret = getEffectiveSessionSecret(env);
      const refreshedToken = secret
        ? await signAdminJwt({
            secret,
            email: auth.email,
            role: auth.role,
            mustChangePassword: false,
          })
        : undefined;

      return Response.json({ ok: true, token: refreshedToken, mustChangePassword: false });
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
        return safeErrorResponse(500, 'تعذر رفع الصورة حالياً.', err);
      }
    }
  }

  return Response.json({ error: 'Endpoint not found' }, { status: 404 });
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

export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
    const preflight = handleCorsPreflight(request, env.ALLOWED_ORIGINS);
    if (preflight) return preflight;

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const res = await handleApiRequest(request, env);
      return applySecurityHeaders(res, request, env.ALLOWED_ORIGINS);
    }

    if (!env.ASSETS) {
      return applySecurityHeaders(
        new Response('Static assets binding (ASSETS) is not configured.', { status: 500 }),
        request,
        env.ALLOWED_ORIGINS
      );
    }

    if (isStaticAssetPath(url.pathname)) {
      const assetRes = await env.ASSETS.fetch(request);
      return applySecurityHeaders(assetRes, request, env.ALLOWED_ORIGINS);
    }

    if (isKnownSpaRoute(url.pathname)) {
      const indexReq = new Request(new URL('/index.html', url.origin).toString(), {
        method: 'GET',
        headers: request.headers,
      });
      const indexRes = await env.ASSETS.fetch(indexReq);
      if (indexRes.ok) {
        return applySecurityHeaders(
          new Response(indexRes.body, {
            status: 200,
            headers: indexRes.headers,
          }),
          request,
          env.ALLOWED_ORIGINS
        );
      }
    }

    // Real 404 for unknown routes (no Soft 404)
    const notFoundReq = new Request(new URL('/404.html', url.origin).toString(), {
      method: 'GET',
      headers: request.headers,
    });
    const notFoundRes = await env.ASSETS.fetch(notFoundReq).catch(() => null);
    if (notFoundRes && notFoundRes.ok) {
      return applySecurityHeaders(
        new Response(notFoundRes.body, {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        }),
        request,
        env.ALLOWED_ORIGINS
      );
    }

    return applySecurityHeaders(
      new Response(FALLBACK_404_HTML, {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
      request,
      env.ALLOWED_ORIGINS
    );
  },
};
