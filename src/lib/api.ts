import type {
  ActivityLog,
  AdminNotification,
  AILogEntry,
  ChatChallengeResponse,
  ChatVerificationPayload,
  Coupon,
  Customer,
  DeliveryZone,
  Employee,
  EmployeeRole,
  FulfillmentType,
  InventoryMovement,
  MenuCategory,
  MenuItem,
  Order,
  OrderDraft,
  OrderDraftDiff,
  OrderDraftItem,
  OrderStatus,
  PublicConfigStatus,
  Restaurant,
  RestaurantBranch,
  RestaurantBundle,
  ServiceConfigStatus,
  SuggestedChatAction,
} from '../types/restaurant.ts';
import type { RestaurantHoursStatus } from './hours.ts';
import type { AdminTabPermission } from './permissions.ts';
import type { CalculatedOrderResult } from './pricing.ts';

const ADMIN_TOKEN_KEY = 'moazzaf_admin_token';
const DEFAULT_TIMEOUT_MS = 12_000;
const AUTH_TIMEOUT_MS = 10_000;
const LONG_TIMEOUT_MS = 30_000;

export function getStoredAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Ignore storage quota issues
  }
}

export class ApiError extends Error {
  status: number;
  captchaRequired?: boolean;
  mustChangePassword?: boolean;
  constructor(
    message: string,
    status: number,
    captchaRequired?: boolean,
    mustChangePassword?: boolean
  ) {
    super(message);
    this.status = status;
    this.captchaRequired = captchaRequired;
    this.mustChangePassword = mustChangePassword;
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retry?: boolean; maxRetries?: number; timeoutMs?: number }
): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const canRetry = options?.retry ?? method === 'GET';
  const maxRetries = canRetry ? (options?.maxRetries ?? 2) : 0;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const delays = [350, 850];

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    const upstreamSignal = init?.signal;
    const onUpstreamAbort = () => controller.abort();
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        globalThis.clearTimeout(timer);
        throw new ApiError('تم إلغاء الطلب.', 0);
      }
      upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true });
    }

    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      if (res.status >= 400 && res.status < 500) {
        return res;
      }
      if (
        canRetry &&
        (res.status === 502 || res.status === 503 || res.status === 504) &&
        attempt < maxRetries
      ) {
        await new Promise((r) => setTimeout(r, delays[attempt] ?? 850));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError('انتهت مهلة الاتصال بالخادم. حاول مرة أخرى.', 0);
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delays[attempt] ?? 850));
        continue;
      }
    } finally {
      globalThis.clearTimeout(timer);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener('abort', onUpstreamAbort);
      }
    }
  }
  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.', 0);
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    captchaRequired?: boolean;
    mustChangePassword?: boolean;
  };
  if (!res.ok) {
    throw new ApiError(
      data.error || 'حدث خطأ أثناء الاتصال بالخادم.',
      res.status,
      Boolean(data.captchaRequired),
      Boolean(data.mustChangePassword)
    );
  }
  return data as T;
}

export async function fetchConfigStatus(): Promise<PublicConfigStatus> {
  const res = await fetchWithRetry('/api/config/status');
  return parseJsonOrThrow<PublicConfigStatus>(res);
}

export async function fetchRestaurantBundle(slug?: string): Promise<{
  bundle: RestaurantBundle;
  hoursStatus: RestaurantHoursStatus;
}> {
  const url = slug ? `/api/restaurant/${encodeURIComponent(slug)}` : '/api/restaurant';
  const res = await fetchWithRetry(url);
  return parseJsonOrThrow(res);
}

export async function validateCouponCode(payload: {
  restaurantId: string;
  code: string;
  items: OrderDraftItem[];
  deliveryZoneId: string;
  fulfillmentType: FulfillmentType;
}): Promise<{
  valid: boolean;
  coupon: Coupon;
  discountAmount: number;
  totals: CalculatedOrderResult;
}> {
  const res = await fetchWithRetry(
    '/api/coupons/validate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function trackOrderByNumber(
  restaurantId: string,
  orderNumber: string,
  token: string
): Promise<{ order: Order }> {
  const qs = new URLSearchParams({
    restaurantId,
    orderNumber,
    token,
  });
  const res = await fetchWithRetry(`/api/orders/track?${qs.toString()}`);
  return parseJsonOrThrow(res);
}

export async function submitOrderRating(
  restaurantId: string,
  orderNumber: string,
  rating: number,
  comment: string,
  token?: string
): Promise<{ order: Order }> {
  const res = await fetchWithRetry(
    `/api/orders/${encodeURIComponent(orderNumber)}/rate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId, rating, comment, token }),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function fetchChatChallenge(sessionId: string): Promise<ChatChallengeResponse> {
  const res = await fetchWithRetry(
    `/api/chat/challenge?sessionId=${encodeURIComponent(sessionId)}`
  );
  return parseJsonOrThrow(res);
}

export async function sendChatMessage(payload: {
  restaurantId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  orderDraft: OrderDraft;
  sessionId?: string;
  verification?: ChatVerificationPayload;
}): Promise<{
  reply: string;
  suggestedAction: SuggestedChatAction;
  updatedDraft: OrderDraft;
  totals: CalculatedOrderResult;
  appliedChanges: string[];
  rejectedChanges: string[];
  unknownItemIds: string[];
  diff: OrderDraftDiff;
  usedFallback: boolean;
}> {
  const res = await fetchWithRetry(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { retry: false, timeoutMs: LONG_TIMEOUT_MS }
  );
  return parseJsonOrThrow(res);
}

export async function submitOrder(payload: {
  restaurantId: string;
  items: OrderDraftItem[];
  fulfillmentType: FulfillmentType;
  deliveryZoneId: string;
  branchId?: string;
  couponCode?: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
  idempotencyKey?: string;
}): Promise<{
  order: Order;
  whatsappUrl: string;
  orderToken?: string;
  deduplicated?: boolean;
}> {
  const res = await fetchWithRetry(
    '/api/orders',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { retry: Boolean(payload.idempotencyKey), timeoutMs: DEFAULT_TIMEOUT_MS }
  );
  return parseJsonOrThrow(res);
}

// =========================================================
// Admin API Calls
// =========================================================

function adminHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function adminLoginLocal(
  email: string,
  password: string,
  restaurantId?: string
): Promise<{
  token: string;
  email: string;
  role?: EmployeeRole;
  restaurantId?: string;
  mustChangePassword?: boolean;
  permissions?: AdminTabPermission[];
}> {
  const res = await fetchWithRetry(
    '/api/admin/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...(restaurantId ? { restaurantId } : {}) }),
    },
    { retry: false, timeoutMs: AUTH_TIMEOUT_MS }
  );
  return parseJsonOrThrow(res);
}

export async function adminLogout(token: string): Promise<void> {
  await fetchWithRetry(
    '/api/admin/logout',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    { retry: false, timeoutMs: AUTH_TIMEOUT_MS }
  ).catch(() => undefined);
}

export async function fetchAdminMe(token: string): Promise<{
  authenticated: boolean;
  email: string;
  role?: EmployeeRole;
  restaurantId?: string;
  mustChangePassword?: boolean;
  permissions?: AdminTabPermission[];
}> {
  const res = await fetchWithRetry(
    '/api/admin/me',
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    { retry: true, timeoutMs: AUTH_TIMEOUT_MS }
  );
  return parseJsonOrThrow(res);
}

export async function fetchAdminOverview(
  token: string,
  restaurantId?: string
): Promise<{
  bundle: RestaurantBundle;
  hoursStatus: RestaurantHoursStatus;
  orders: Order[];
  aiLogs: AILogEntry[];
  coupons: Coupon[];
  inventoryMovements: InventoryMovement[];
  employees: Employee[];
  activityLogs: ActivityLog[];
  notifications: AdminNotification[];
  customers?: Customer[];
  configStatus?: ServiceConfigStatus;
}> {
  const qs = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : '';
  const res = await fetchWithRetry(`/api/admin/overview${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonOrThrow(res);
}

export async function adminUpdateRestaurant(
  token: string,
  restaurantId: string,
  patch: Partial<Restaurant>
): Promise<{ restaurant: Restaurant; hoursStatus: RestaurantHoursStatus }> {
  const res = await fetchWithRetry(
    '/api/admin/restaurant',
    {
      method: 'PUT',
      headers: adminHeaders(token),
      body: JSON.stringify({ restaurantId, ...patch }),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminUpsertCategory(
  token: string,
  category: Partial<MenuCategory> & { restaurantId: string; name: string }
): Promise<{ category: MenuCategory }> {
  const res = await fetchWithRetry(
    '/api/admin/categories',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(category),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminDeleteCategory(
  token: string,
  restaurantId: string,
  categoryId: string
): Promise<void> {
  const res = await fetchWithRetry(
    `/api/admin/categories/${encodeURIComponent(categoryId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: 'DELETE', headers: adminHeaders(token) },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminUpsertMenuItem(
  token: string,
  item: Partial<MenuItem> & { restaurantId: string; categoryId: string; name: string; price: number }
): Promise<{ item: MenuItem }> {
  const res = await fetchWithRetry(
    '/api/admin/items',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(item),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminReorderItems(
  token: string,
  restaurantId: string,
  orderedIds: string[]
): Promise<void> {
  const res = await fetchWithRetry(
    '/api/admin/items/reorder',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ restaurantId, orderedIds }),
    },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminDeleteMenuItem(
  token: string,
  restaurantId: string,
  itemId: string
): Promise<void> {
  const res = await fetchWithRetry(
    `/api/admin/items/${encodeURIComponent(itemId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: 'DELETE', headers: adminHeaders(token) },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminAdjustStock(
  token: string,
  payload: { restaurantId: string; itemId: string; delta: number; reason: string }
): Promise<{ item: MenuItem }> {
  const res = await fetchWithRetry(
    '/api/admin/inventory/adjust',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(payload),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminUpsertDeliveryZone(
  token: string,
  zone: Partial<DeliveryZone> & { restaurantId: string; name: string; fee: number }
): Promise<{ zone: DeliveryZone }> {
  const res = await fetchWithRetry(
    '/api/admin/delivery-zones',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(zone),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminDeleteDeliveryZone(
  token: string,
  restaurantId: string,
  zoneId: string
): Promise<void> {
  const res = await fetchWithRetry(
    `/api/admin/delivery-zones/${encodeURIComponent(zoneId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: 'DELETE', headers: adminHeaders(token) },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminUpsertBranch(
  token: string,
  branch: Partial<RestaurantBranch> & { restaurantId: string; name: string }
): Promise<{ branch: RestaurantBranch }> {
  const res = await fetchWithRetry(
    '/api/admin/branches',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(branch),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminDeleteBranch(
  token: string,
  restaurantId: string,
  branchId: string
): Promise<void> {
  const res = await fetchWithRetry(
    `/api/admin/branches/${encodeURIComponent(branchId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: 'DELETE', headers: adminHeaders(token) },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminUpsertCoupon(
  token: string,
  coupon: Partial<Coupon> & { restaurantId: string; code: string; discountValue: number }
): Promise<{ coupon: Coupon }> {
  const res = await fetchWithRetry(
    '/api/admin/coupons',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(coupon),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminDeleteCoupon(
  token: string,
  restaurantId: string,
  couponId: string
): Promise<void> {
  const res = await fetchWithRetry(
    `/api/admin/coupons/${encodeURIComponent(couponId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: 'DELETE', headers: adminHeaders(token) },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminUpsertEmployee(
  token: string,
  employee: Partial<Employee> & {
    restaurantId: string;
    name: string;
    email: string;
    password?: string;
  }
): Promise<{ employee: Employee }> {
  const res = await fetchWithRetry(
    '/api/admin/employees',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(employee),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminDeleteEmployee(
  token: string,
  restaurantId: string,
  employeeId: string
): Promise<void> {
  const res = await fetchWithRetry(
    `/api/admin/employees/${encodeURIComponent(employeeId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: 'DELETE', headers: adminHeaders(token) },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminMarkNotificationsRead(
  token: string,
  restaurantId: string
): Promise<void> {
  const res = await fetchWithRetry(
    '/api/admin/notifications/read',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ restaurantId }),
    },
    { retry: false }
  );
  await parseJsonOrThrow(res);
}

export async function adminUpdateOrderStatus(
  token: string,
  restaurantId: string,
  orderId: string,
  status: OrderStatus
): Promise<{ order: Order }> {
  const res = await fetchWithRetry(
    `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
    {
      method: 'PATCH',
      headers: adminHeaders(token),
      body: JSON.stringify({ restaurantId, status }),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminUpdateOrderPaymentStatus(
  token: string,
  restaurantId: string,
  orderId: string,
  paymentStatus: 'pending' | 'paid'
): Promise<{ order: Order }> {
  const res = await fetchWithRetry(
    `/api/admin/orders/${encodeURIComponent(orderId)}/payment`,
    {
      method: 'PATCH',
      headers: adminHeaders(token),
      body: JSON.stringify({ restaurantId, paymentStatus }),
    },
    { retry: false }
  );
  return parseJsonOrThrow(res);
}

export async function adminDownloadOrdersCsv(
  token: string,
  restaurantId: string
): Promise<void> {
  const res = await fetchWithRetry(
    `/api/admin/orders/export?restaurantId=${encodeURIComponent(restaurantId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { retry: true, timeoutMs: LONG_TIMEOUT_MS }
  );
  if (!res.ok) throw new Error('تعذر تصدير تقرير الطلبات.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders-${restaurantId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function adminUpdatePassword(
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; token?: string; mustChangePassword?: boolean }> {
  const res = await fetchWithRetry(
    '/api/admin/password',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ currentPassword, newPassword }),
    },
    { retry: false, timeoutMs: AUTH_TIMEOUT_MS }
  );
  const data = await parseJsonOrThrow<{
    ok: boolean;
    token?: string;
    mustChangePassword?: boolean;
  }>(res);
  if (data.token) {
    setStoredAdminToken(data.token);
  }
  return data;
}

export async function adminUploadImage(
  token: string,
  file: File
): Promise<{ url: string }> {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
    reader.readAsDataURL(file);
  });

  const res = await fetchWithRetry(
    '/api/admin/upload',
    {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || 'image/jpeg',
        dataBase64,
      }),
    },
    { retry: false, timeoutMs: LONG_TIMEOUT_MS }
  );
  return parseJsonOrThrow(res);
}
