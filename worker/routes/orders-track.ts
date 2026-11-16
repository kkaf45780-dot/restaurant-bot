import type { Order, PublicOrderTracking } from '../../src/types/restaurant.ts';
import type { KVNamespaceLike } from '../../src/server/edgeStore.ts';
import { checkTrackRateLimit, rateLimitResponse } from '../middleware/rate-limit.ts';

const UUID_OR_TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidOrderTokenFormat(token: string): boolean {
  const clean = token.trim();
  return UUID_OR_TOKEN_REGEX.test(clean) || /^[a-zA-Z0-9_-]{24,80}$/.test(clean);
}

export function maskCustomerName(name: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'عميل';
  const firstChar = Array.from(trimmed)[0] ?? 'ع';
  return `${firstChar}***`;
}

export function maskOrderNumber(orderNumber: string): string {
  const digits = String(orderNumber || '').trim();
  if (digits.length <= 2) return `#${digits}`;
  return `#**${digits.slice(-2)}`;
}

export function toPublicOrderTracking(order: Order): PublicOrderTracking {
  const itemsCount = order.items.reduce((acc, item) => acc + Math.max(0, Number(item.quantity) || 0), 0);
  return {
    orderToken: order.orderToken,
    orderNumberMasked: maskOrderNumber(order.orderNumber),
    customerNameMasked: maskCustomerName(order.customerName),
    fulfillmentType: order.fulfillmentType,
    status: order.status,
    statusHistory: order.statusHistory,
    estimatedDeliveryText: order.estimatedDeliveryText,
    itemsCount,
    total: order.total,
    deliveryZoneName: order.deliveryZoneName || undefined,
    branchName: order.branchName || undefined,
    rating: order.rating,
    ratingComment: order.ratingComment,
    ratedAt: order.ratedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export async function handlePublicOrderTrack(params: {
  kv?: KVNamespaceLike;
  ip: string;
  token: string;
  hasLegacyParam?: boolean;
  findByToken: (token: string) => Promise<Order | null>;
}): Promise<Response> {
  const rate = await checkTrackRateLimit({ kv: params.kv, ip: params.ip });
  if (!rate.allowed) {
    return rateLimitResponse(
      rate.retryAfterSeconds,
      'تم إرسال طلبات متابعة كثيرة في وقت قصير، يُرجى الانتظار قليلاً.'
    );
  }

  if (params.hasLegacyParam && !params.token.trim()) {
    return Response.json(
      { error: 'تم إيقاف البحث برقم الطلب المتسلسل أو الهاتف لحماية الخصوصية. استخدم رمز التتبع الآمن (orderToken).' },
      { status: 400 }
    );
  }

  const cleanToken = params.token.trim();
  if (!cleanToken || !isValidOrderTokenFormat(cleanToken)) {
    return Response.json(
      { error: 'رمز التتبع غير صالح. يُرجى استخدام رابط أو رمز التتبع الصحيح.' },
      { status: 400 }
    );
  }

  const order = await params.findByToken(cleanToken);
  if (!order) {
    return Response.json({ error: 'لم يتم العثور على طلب بهذا الرمز.' }, { status: 404 });
  }

  return Response.json({ tracking: toPublicOrderTracking(order) });
}
