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
    restaurant_id: order.restaurantId,
    item_id: it.itemId,
    item_name: it.name,
    quantity: it.quantity,
    unit_price: it.unitPrice,
    line_total: it.lineTotal,
    selected_size_id: it.selectedSizeId ?? null,
    selected_size_label: it.selectedSizeLabel ?? null,
    selected_extras: it.selectedExtras ?? [],
    item_notes: it.itemNotes ?? null,
  }));
  const { error } = await supabase.from('order_items').insert(rows);
  if (error) {
    throw new Error(`Failed to persist order_items: ${error.message}`);
  }
}

export async function upsertCustomerForOrderSupabase(
  supabase: SupabaseClient,
  order: Order
): Promise<void> {
  const cleanPhone = order.customerPhone.trim();
  if (!cleanPhone) return;

  const { data: existing, error: fetchError } = await supabase
    .from('customers')
    .select('id, orders_count, total_spent')
    .eq('restaurant_id', order.restaurantId)
    .eq('phone', cleanPhone)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to query customer record: ${fetchError.message}`);
  }

  const nowIso = order.createdAt || new Date().toISOString();

  if (existing) {
    const { error: updateErr } = await supabase
      .from('customers')
      .update({
        name: order.customerName,
        default_address: order.customerAddress || '',
        last_zone_id: order.deliveryZoneId || null,
        orders_count: Number(existing.orders_count ?? 0) + 1,
        total_spent: Number(existing.total_spent ?? 0) + Number(order.total ?? 0),
        last_order_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', existing.id);
    if (updateErr) {
      throw new Error(`Failed to update customer record: ${updateErr.message}`);
    }
    return;
  }

  const normalizedDigits = cleanPhone.replace(/[^\d]/g, '') || cleanPhone;
  const { error: insertErr } = await supabase.from('customers').insert({
    id: `cust_${order.restaurantId}_${normalizedDigits}`,
    restaurant_id: order.restaurantId,
    name: order.customerName,
    phone: cleanPhone,
    default_address: order.customerAddress || '',
    last_zone_id: order.deliveryZoneId || null,
    orders_count: 1,
    total_spent: Number(order.total ?? 0),
    last_order_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (insertErr) {
    throw new Error(`Failed to insert customer record: ${insertErr.message}`);
  }
}

export async function insertOrderNotificationSupabase(
  supabase: SupabaseClient,
  order: Order
): Promise<void> {
  await supabase.from('notifications').insert({
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    restaurant_id: order.restaurantId,
    type: 'order',
    title: `طلب جديد #${order.orderNumber}`,
    message: `طلب من ${order.customerName} بقيمة ${order.total} ج.م.`,
    is_read: false,
    created_at: order.createdAt,
  });
}

export async function incrementCouponUsageSupabase(
  supabase: SupabaseClient,
  restaurantId: string,
  couponCode: string
): Promise<void> {
  const { error } = await supabase.rpc('increment_coupon_usage', {
    p_restaurant_id: restaurantId,
    p_code: couponCode.trim().toUpperCase(),
  });
  if (error) {
    throw new Error(`Failed to increment coupon usage: ${error.message}`);
  }
}
