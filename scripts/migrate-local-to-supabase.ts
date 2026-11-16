import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

interface LocalDbFile {
  restaurants?: Array<Record<string, unknown>>;
  categories?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  deliveryZones?: Array<Record<string, unknown>>;
  branches?: Array<Record<string, unknown>>;
  coupons?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  inventoryMovements?: Array<Record<string, unknown>>;
  employees?: Array<Record<string, unknown>>;
  activityLogs?: Array<Record<string, unknown>>;
  notifications?: Array<Record<string, unknown>>;
  aiLogs?: Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const dbPath = path.resolve(process.cwd(), '.data/db.json');
  if (!fs.existsSync(dbPath)) {
    console.error(`Local database file not found at: ${dbPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8')) as LocalDbFile;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (raw.restaurants?.length) {
    const { error } = await supabase.from('restaurants').upsert(
      raw.restaurants.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description ?? '',
        address: r.address ?? '',
        phone: r.phone ?? '',
        whatsapp_number: r.whatsappNumber ?? '',
        logo_url: r.logoUrl ?? '',
        manual_status: r.manualStatus ?? 'auto',
        weekly_schedule: r.weeklySchedule ?? [],
        schedule_exceptions: r.scheduleExceptions ?? [],
        ai_settings: r.aiSettings ?? {},
        system_settings: r.systemSettings ?? {},
        updated_at: r.updatedAt ?? new Date().toISOString(),
      }))
    );
    if (error) throw new Error(`Restaurants upsert failed: ${error.message}`);
    console.log(`Migrated ${raw.restaurants.length} restaurants.`);
  }

  if (raw.categories?.length) {
    const { error } = await supabase.from('menu_categories').upsert(
      raw.categories.map((c) => ({
        id: c.id,
        restaurant_id: c.restaurantId,
        name: c.name,
        description: c.description ?? '',
        sort_order: Number(c.sortOrder ?? 0),
      }))
    );
    if (error) throw new Error(`Categories upsert failed: ${error.message}`);
    console.log(`Migrated ${raw.categories.length} categories.`);
  }

  if (raw.items?.length) {
    const { error } = await supabase.from('menu_items').upsert(
      raw.items.map((i) => ({
        id: i.id,
        restaurant_id: i.restaurantId,
        category_id: i.categoryId,
        name: i.name,
        description: i.description ?? '',
        price: Number(i.price ?? 0),
        image_url: i.imageUrl ?? '',
        is_available: i.isAvailable !== false,
        is_popular: Boolean(i.isPopular),
        stock_quantity: Number(i.stockQuantity ?? 40),
        low_stock_threshold: Number(i.lowStockThreshold ?? 8),
        sizes: i.sizes ?? [],
        extras: i.extras ?? [],
        sort_order: Number(i.sortOrder ?? 0),
      }))
    );
    if (error) throw new Error(`Menu items upsert failed: ${error.message}`);
    console.log(`Migrated ${raw.items.length} menu items.`);
  }

  if (raw.deliveryZones?.length) {
    const { error } = await supabase.from('delivery_zones').upsert(
      raw.deliveryZones.map((z) => ({
        id: z.id,
        restaurant_id: z.restaurantId,
        name: z.name,
        fee: Number(z.fee ?? 0),
        min_order_amount: Number(z.minOrderAmount ?? 0),
        estimated_minutes: z.estimatedMinutes ?? '٣٠ - ٤٥ دقيقة',
        is_active: z.isActive !== false,
      }))
    );
    if (error) throw new Error(`Delivery zones upsert failed: ${error.message}`);
    console.log(`Migrated ${raw.deliveryZones.length} delivery zones.`);
  }

  if (raw.branches?.length) {
    const { error } = await supabase.from('branches').upsert(
      raw.branches.map((b) => ({
        id: b.id,
        restaurant_id: b.restaurantId,
        name: b.name,
        address: b.address ?? '',
        phone: b.phone ?? '',
        hours_text: b.hoursText ?? '',
        is_open: b.isOpen !== false,
      }))
    );
    if (error) throw new Error(`Branches upsert failed: ${error.message}`);
    console.log(`Migrated ${raw.branches.length} branches.`);
  }

  if (raw.coupons?.length) {
    const { error } = await supabase.from('coupons').upsert(
      raw.coupons.map((c) => ({
        id: c.id,
        restaurant_id: c.restaurantId,
        code: String(c.code || '').toUpperCase(),
        description: c.description ?? '',
        discount_type: c.discountType ?? 'percentage',
        discount_value: Number(c.discountValue ?? 0),
        min_order_amount: Number(c.minOrderAmount ?? 0),
        max_discount_amount: c.maxDiscountAmount ?? null,
        valid_from: c.validFrom ?? '',
        valid_until: c.validUntil ?? '',
        usage_limit: Number(c.usageLimit ?? 0),
        used_count: Number(c.usedCount ?? 0),
        is_active: c.isActive !== false,
        applicable_category_ids: c.applicableCategoryIds ?? [],
        applicable_item_ids: c.applicableItemIds ?? [],
      }))
    );
    if (error) throw new Error(`Coupons upsert failed: ${error.message}`);
    console.log(`Migrated ${raw.coupons.length} coupons.`);
  }

  if (raw.orders?.length) {
    const orderRows = raw.orders.map((o) => ({
      id: o.id,
      order_number: String(o.orderNumber ?? ''),
      order_token: String(o.orderToken || crypto.randomUUID()),
      restaurant_id: o.restaurantId,
      customer_name: o.customerName ?? '',
      customer_phone: o.customerPhone ?? '',
      fulfillment_type: o.fulfillmentType ?? 'delivery',
      delivery_zone_id: o.deliveryZoneId ?? '',
      delivery_zone_name: o.deliveryZoneName ?? '',
      branch_id: o.branchId ?? null,
      branch_name: o.branchName ?? null,
      customer_address: o.customerAddress ?? '',
      notes: o.notes ?? '',
      items: o.items ?? [],
      subtotal: Number(o.subtotal ?? 0),
      discount_amount: Number(o.discountAmount ?? 0),
      coupon_code: o.couponCode ?? null,
      delivery_fee: Number(o.deliveryFee ?? 0),
      total: Number(o.total ?? 0),
      payment_method: o.paymentMethod ?? 'cash_on_delivery',
      payment_status: o.paymentStatus ?? 'pending',
      estimated_delivery_text: o.estimatedDeliveryText ?? null,
      stock_deducted: Boolean(o.stockDeducted),
      idempotency_key: o.idempotencyKey ?? null,
      status: o.status ?? 'received',
      status_history: o.statusHistory ?? [],
      rating: o.rating ?? null,
      rating_comment: o.ratingComment ?? null,
      rated_at: o.ratedAt ?? null,
      created_at: o.createdAt ?? new Date().toISOString(),
      updated_at: o.updatedAt ?? new Date().toISOString(),
    }));
    const { error } = await supabase.from('orders').upsert(orderRows);
    if (error) throw new Error(`Orders upsert failed: ${error.message}`);

    const itemRows: Array<Record<string, unknown>> = [];
    for (const o of raw.orders) {
      const items = Array.isArray(o.items) ? (o.items as Array<Record<string, unknown>>) : [];
      for (const it of items) {
        itemRows.push({
          order_id: o.id,
          item_id: it.itemId,
          item_name: it.name,
          quantity: Number(it.quantity ?? 1),
          unit_price: Number(it.unitPrice ?? 0),
          line_total: Number(it.lineTotal ?? 0),
          selected_size_label: it.selectedSizeLabel ?? null,
          selected_extras: it.selectedExtras ?? [],
          item_notes: it.itemNotes ?? null,
        });
      }
    }
    if (itemRows.length) {
      await supabase.from('order_items').insert(itemRows);
    }
    console.log(`Migrated ${raw.orders.length} orders and ${itemRows.length} order_items.`);
  }

  if (raw.inventoryMovements?.length) {
    const { error } = await supabase.from('inventory_movements').upsert(
      raw.inventoryMovements.map((m) => ({
        id: m.id,
        restaurant_id: m.restaurantId,
        item_id: m.itemId,
        item_name: m.itemName,
        change: Number(m.change ?? 0),
        previous_qty: Number(m.previousQty ?? 0),
        new_qty: Number(m.newQty ?? 0),
        reason: m.reason ?? '',
        reference_order_id: m.referenceOrderId ?? null,
        created_at: m.createdAt ?? new Date().toISOString(),
      }))
    );
    if (error) throw new Error(`Inventory movements upsert failed: ${error.message}`);
  }

  if (raw.employees?.length) {
    const safeEmployees = raw.employees.filter(
      (e) => String(e.email || '').toLowerCase() !== 'admin@hara-grill.eg'
    );
    if (safeEmployees.length) {
      const { error } = await supabase.from('employees').upsert(
        safeEmployees.map((e) => ({
          id: e.id,
          restaurant_id: e.restaurantId,
          name: e.name,
          email: String(e.email).toLowerCase(),
          phone: e.phone ?? '',
          role: e.role ?? 'cashier',
          is_active: e.isActive !== false,
          password_hash: e.passwordHash ?? null,
          must_change_password: Boolean(e.mustChangePassword ?? true),
          created_at: e.createdAt ?? new Date().toISOString(),
        }))
      );
      if (error) throw new Error(`Employees upsert failed: ${error.message}`);
    }
  }

  if (raw.activityLogs?.length) {
    await supabase.from('activity_logs').upsert(
      raw.activityLogs.map((a) => ({
        id: a.id,
        restaurant_id: a.restaurantId,
        actor_name: a.actorName,
        action: a.action,
        details: a.details ?? '',
        created_at: a.createdAt ?? new Date().toISOString(),
      }))
    );
  }

  if (raw.notifications?.length) {
    await supabase.from('notifications').upsert(
      raw.notifications.map((n) => ({
        id: n.id,
        restaurant_id: n.restaurantId,
        type: n.type ?? 'system',
        title: n.title,
        message: n.message ?? '',
        is_read: Boolean(n.isRead),
        created_at: n.createdAt ?? new Date().toISOString(),
      }))
    );
  }

  if (raw.aiLogs?.length) {
    await supabase.from('ai_logs').upsert(
      raw.aiLogs.map((l) => ({
        id: l.id,
        restaurant_id: l.restaurantId,
        timestamp: l.timestamp,
        model: l.model,
        status: l.status,
        latency_ms: Number(l.latencyMs ?? 0),
        user_message_preview: l.userMessagePreview ?? '',
        error_message: l.errorMessage ?? null,
      }))
    );
  }

  console.log('Migration to Supabase completed successfully.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
