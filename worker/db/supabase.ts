import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EdgeEnv } from '../../src/server/edgeStore.ts';
import type { Order, OrderStatus } from '../../src/types/restaurant.ts';

export function getSupabaseServiceClient(env: EdgeEnv): SupabaseClient | null {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isProductionSupabaseRequired(env: EdgeEnv): boolean {
  return (env as Record<string, unknown>).REQUIRE_SUPABASE === 'true';
}

export async function findOrderByTokenSupabase(
  supabase: SupabaseClient,
  restaurantId: string,
  orderToken: string
): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('order_token', orderToken)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    orderNumber: String(data.order_number),
    orderToken: String(data.order_token),
    restaurantId: String(data.restaurant_id),
    customerName: String(data.customer_name),
    customerPhone: String(data.customer_phone),
    fulfillmentType: (data.fulfillment_type as Order['fulfillmentType']) ?? 'delivery',
    deliveryZoneId: String(data.delivery_zone_id ?? ''),
    deliveryZoneName: String(data.delivery_zone_name ?? ''),
    branchId: data.branch_id ? String(data.branch_id) : undefined,
    branchName: data.branch_name ? String(data.branch_name) : undefined,
    customerAddress: String(data.customer_address ?? ''),
    notes: String(data.notes ?? ''),
    items: Array.isArray(data.items) ? (data.items as Order['items']) : [],
    subtotal: Number(data.subtotal ?? 0),
    discountAmount: Number(data.discount_amount ?? 0),
    couponCode: data.coupon_code ? String(data.coupon_code) : undefined,
    deliveryFee: Number(data.delivery_fee ?? 0),
    total: Number(data.total ?? 0),
    paymentMethod: (data.payment_method as Order['paymentMethod']) ?? 'cash_on_delivery',
    paymentStatus: (data.payment_status as Order['paymentStatus']) === 'paid' ? 'paid' : 'pending',
    estimatedDeliveryText: data.estimated_delivery_text
      ? String(data.estimated_delivery_text)
      : undefined,
    stockDeducted: Boolean(data.stock_deducted),
    idempotencyKey: data.idempotency_key ? String(data.idempotency_key) : undefined,
    status: String(data.status) as OrderStatus,
    statusHistory: Array.isArray(data.status_history)
      ? (data.status_history as Order['statusHistory'])
      : [],
    rating: data.rating ? Number(data.rating) : undefined,
    ratingComment: data.rating_comment ? String(data.rating_comment) : undefined,
    ratedAt: data.rated_at ? String(data.rated_at) : undefined,
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at),
  };
}

export async function insertOrderItemsSupabase(
  supabase: SupabaseClient,
  order: Order
): Promise<void> {
  if (!order.items.length) return;
  const rows = order.items.map((it) => ({
    order_id: order.id,
    item_id: it.itemId,
    item_name: it.name,
    quantity: it.quantity,
    unit_price: it.unitPrice,
    line_total: it.lineTotal,
    selected_size_label: it.selectedSizeLabel ?? null,
    selected_extras: it.selectedExtras ?? [],
    item_notes: it.itemNotes ?? null,
  }));
  await supabase.from('order_items').insert(rows);
}

export async function incrementCouponUsageSupabase(
  supabase: SupabaseClient,
  restaurantId: string,
  couponCode: string
): Promise<void> {
  await supabase.rpc('increment_coupon_usage', {
    p_restaurant_id: restaurantId,
    p_code: couponCode.trim().toUpperCase(),
  });
}
