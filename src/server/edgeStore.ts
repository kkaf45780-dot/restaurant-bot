import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  COMPROMISED_DEFAULT_PASSWORDS,
  constantTimeEqual,
  hashPasswordBcrypt,
  verifyPasswordAgainstHash,
} from '../../worker/auth.ts';
import {
  findOrderByTokenSupabase,
  incrementCouponUsageSupabase,
  insertOrderItemsSupabase,
  isProductionSupabaseRequired,
} from '../../worker/db/supabase.ts';
import {
  DEFAULT_RESTAURANT_ID,
  INITIAL_ACTIVITY_LOGS,
  INITIAL_BRANCHES,
  INITIAL_CATEGORIES,
  INITIAL_COUPONS,
  INITIAL_DELIVERY_ZONES,
  INITIAL_EMPLOYEES,
  INITIAL_INVENTORY_MOVEMENTS,
  INITIAL_MENU_ITEMS,
  INITIAL_NOTIFICATIONS,
  INITIAL_ORDERS,
  INITIAL_RESTAURANT,
} from '../data/restaurant.ts';
import {
  isValidRestaurantIdOrSlug,
  resolveExactRestaurantBundle,
} from './publicSanitizer.ts';
import type {
  ActivityLog,
  AdminNotification,
  AILogEntry,
  Coupon,
  DeliveryZone,
  Employee,
  InventoryMovement,
  MenuCategory,
  MenuItem,
  Order,
  OrderStatus,
  Restaurant,
  RestaurantBranch,
  RestaurantBundle,
} from '../types/restaurant.ts';

export interface KVNamespaceLike {
  get(key: string, type?: 'text' | 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AssetsBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface EdgeEnv {
  ASSETS?: AssetsBindingLike;
  RESTAURANT_DB?: KVNamespaceLike;
  RATE_LIMIT_KV?: KVNamespaceLike;
  GEMINI_API_KEY?: string;
  ADMIN_EMAIL?: string;
  ADMIN_INITIAL_PASSWORD?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  TURNSTILE_SECRET_KEY?: string;
  APP_VERSION?: string;
  REQUIRE_SUPABASE?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
}

interface EdgeDatabaseSchema {
  restaurants: Restaurant[];
  categories: MenuCategory[];
  items: MenuItem[];
  deliveryZones: DeliveryZone[];
  branches: RestaurantBranch[];
  coupons: Coupon[];
  orders: Order[];
  inventoryMovements: InventoryMovement[];
  employees: Employee[];
  activityLogs: ActivityLog[];
  notifications: AdminNotification[];
  aiLogs: AILogEntry[];
  adminPasswordOverride?: string;
}

const KV_DB_KEY = 'restaurant_db_v1';
let memoryFallbackDb: EdgeDatabaseSchema | null = null;

function getInitialDb(): EdgeDatabaseSchema {
  return {
    restaurants: [structuredClone(INITIAL_RESTAURANT)],
    categories: structuredClone(INITIAL_CATEGORIES),
    items: structuredClone(INITIAL_MENU_ITEMS),
    deliveryZones: structuredClone(INITIAL_DELIVERY_ZONES),
    branches: structuredClone(INITIAL_BRANCHES),
    coupons: structuredClone(INITIAL_COUPONS),
    orders: structuredClone(INITIAL_ORDERS),
    inventoryMovements: structuredClone(INITIAL_INVENTORY_MOVEMENTS),
    employees: structuredClone(INITIAL_EMPLOYEES),
    activityLogs: structuredClone(INITIAL_ACTIVITY_LOGS),
    notifications: structuredClone(INITIAL_NOTIFICATIONS),
    aiLogs: [],
  };
}

function normalizeLegacyOrderStatus(status: string): OrderStatus {
  if (status === 'new') return 'received';
  if (status === 'reviewed') return 'under_review';
  if (status === 'completed') return 'delivered';
  const valid: OrderStatus[] = [
    'received',
    'under_review',
    'accepted',
    'preparing',
    'out_for_delivery',
    'delivered',
    'cancelled',
  ];
  return valid.includes(status as OrderStatus) ? (status as OrderStatus) : 'received';
}

async function readEdgeDb(env: EdgeEnv): Promise<EdgeDatabaseSchema> {
  if (env.RESTAURANT_DB) {
    try {
      const stored = (await env.RESTAURANT_DB.get(KV_DB_KEY, 'json')) as Partial<EdgeDatabaseSchema> | null;
      if (stored && stored.restaurants?.length) {
        const seed = getInitialDb();
        const ordersWithTokens = (stored.orders ?? seed.orders).map((o) => ({
          ...o,
          orderToken: o.orderToken || crypto.randomUUID(),
        }));
        const cleanedEmployees = (stored.employees?.length ? stored.employees : seed.employees).filter(
          (e) => e.email.toLowerCase() !== 'admin@hara-grill.eg'
        );
        return {
          restaurants: stored.restaurants,
          categories: stored.categories?.length ? stored.categories : seed.categories,
          items: stored.items?.length ? stored.items : seed.items,
          deliveryZones: stored.deliveryZones?.length ? stored.deliveryZones : seed.deliveryZones,
          branches: stored.branches?.length ? stored.branches : seed.branches,
          coupons: stored.coupons ?? seed.coupons,
          orders: ordersWithTokens,
          inventoryMovements: stored.inventoryMovements ?? seed.inventoryMovements,
          employees: cleanedEmployees,
          activityLogs: stored.activityLogs ?? seed.activityLogs,
          notifications: stored.notifications ?? seed.notifications,
          aiLogs: stored.aiLogs ?? [],
          adminPasswordOverride: stored.adminPasswordOverride,
        };
      }
    } catch {
      // Fall through to memory seed
    }
  }
  if (!memoryFallbackDb) {
    memoryFallbackDb = getInitialDb();
  }
  return memoryFallbackDb;
}

async function writeEdgeDb(env: EdgeEnv, db: EdgeDatabaseSchema): Promise<void> {
  memoryFallbackDb = db;
  if (env.RESTAURANT_DB) {
    await env.RESTAURANT_DB.put(KV_DB_KEY, JSON.stringify(db)).catch(() => {});
  }
}

export function getSupabaseAdminClient(env: EdgeEnv): SupabaseClient | null {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isSupabaseBackendActive(env: EdgeEnv): boolean {
  return Boolean((env.VITE_SUPABASE_URL || env.SUPABASE_URL) && env.SUPABASE_SERVICE_ROLE_KEY);
}

function mapSupabaseRestaurant(row: Record<string, unknown>): Restaurant {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description ?? ''),
    address: String(row.address ?? ''),
    phone: String(row.phone ?? ''),
    whatsappNumber: String(row.whatsapp_number ?? ''),
    logoUrl: String(row.logo_url ?? ''),
    manualStatus: (row.manual_status as Restaurant['manualStatus']) ?? 'auto',
    weeklySchedule:
      (row.weekly_schedule as Restaurant['weeklySchedule']) ?? INITIAL_RESTAURANT.weeklySchedule,
    scheduleExceptions:
      (row.schedule_exceptions as Restaurant['scheduleExceptions']) ?? [],
    aiSettings: {
      ...INITIAL_RESTAURANT.aiSettings,
      ...((row.ai_settings as Partial<Restaurant['aiSettings']>) ?? {}),
      aiOrderIntake:
        (row.ai_settings as Restaurant['aiSettings'] | undefined)?.aiOrderIntake ??
        (row.ai_settings as Restaurant['aiSettings'] | undefined)?.allowedTopics?.orderIntake ??
        true,
    },
    systemSettings:
      (row.system_settings as Restaurant['systemSettings']) ?? INITIAL_RESTAURANT.systemSettings,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapSupabaseOrder(row: Record<string, unknown>): Order {
  const status = normalizeLegacyOrderStatus(String(row.status ?? 'received'));
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    orderToken: String(row.order_token || row.id),
    restaurantId: String(row.restaurant_id),
    customerName: String(row.customer_name),
    customerPhone: String(row.customer_phone),
    fulfillmentType: (row.fulfillment_type as Order['fulfillmentType']) ?? 'delivery',
    deliveryZoneId: String(row.delivery_zone_id ?? ''),
    deliveryZoneName: String(row.delivery_zone_name ?? ''),
    branchId: row.branch_id ? String(row.branch_id) : undefined,
    branchName: row.branch_name ? String(row.branch_name) : undefined,
    customerAddress: String(row.customer_address ?? ''),
    notes: String(row.notes ?? ''),
    items: (row.items as Order['items']) ?? [],
    subtotal: Number(row.subtotal ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    couponCode: row.coupon_code ? String(row.coupon_code) : undefined,
    deliveryFee: Number(row.delivery_fee ?? 0),
    total: Number(row.total ?? 0),
    paymentMethod: (row.payment_method as Order['paymentMethod']) ?? 'cash_on_delivery',
    paymentStatus: (row.payment_status as Order['paymentStatus']) ?? 'pending',
    estimatedDeliveryText: row.estimated_delivery_text
      ? String(row.estimated_delivery_text)
      : undefined,
    stockDeducted: Boolean(row.stock_deducted),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    status,
    statusHistory: Array.isArray(row.status_history)
      ? (row.status_history as Order['statusHistory'])
      : [{ status, timestamp: String(row.created_at ?? new Date().toISOString()) }],
    rating: row.rating ? Number(row.rating) : undefined,
    ratingComment: row.rating_comment ? String(row.rating_comment) : undefined,
    ratedAt: row.rated_at ? String(row.rated_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findRestaurantBundle(
  env: EdgeEnv,
  restaurantId: string = DEFAULT_RESTAURANT_ID
): Promise<RestaurantBundle | null> {
  if (!isValidRestaurantIdOrSlug(restaurantId)) {
    return null;
  }

  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    try {
      const { data: restRow, error: restErr } = await supabase
        .from('restaurants')
        .select('*')
        .or(`id.eq.${restaurantId},slug.eq.${restaurantId}`)
        .maybeSingle();

      if (!restErr && restRow) {
        const targetId = String(restRow.id);
        const [{ data: cats }, { data: items }, { data: zones }, { data: branches }, { data: coupons }] =
          await Promise.all([
            supabase
              .from('menu_categories')
              .select('*')
              .eq('restaurant_id', targetId)
              .order('sort_order', { ascending: true }),
            supabase
              .from('menu_items')
              .select('*')
              .eq('restaurant_id', targetId)
              .order('sort_order', { ascending: true }),
            supabase.from('delivery_zones').select('*').eq('restaurant_id', targetId),
            supabase.from('branches').select('*').eq('restaurant_id', targetId),
            supabase
              .from('coupons')
              .select('*')
              .eq('restaurant_id', targetId)
              .eq('is_active', true),
          ]);

        const bundle: RestaurantBundle = {
          restaurant: mapSupabaseRestaurant(restRow),
          categories: (cats ?? []).map((c) => ({
            id: c.id,
            restaurantId: c.restaurant_id,
            name: c.name,
            description: c.description ?? '',
            sortOrder: Number(c.sort_order ?? 0),
          })),
          items: (items ?? []).map((i) => ({
            id: i.id,
            restaurantId: i.restaurant_id,
            categoryId: i.category_id,
            name: i.name,
            description: i.description ?? '',
            price: Number(i.price ?? 0),
            imageUrl: i.image_url ?? '',
            isAvailable: Boolean(i.is_available),
            isPopular: Boolean(i.is_popular),
            stockQuantity: Number(i.stock_quantity ?? 50),
            lowStockThreshold: Number(i.low_stock_threshold ?? 8),
            sizes: Array.isArray(i.sizes) ? i.sizes : [],
            extras: Array.isArray(i.extras) ? i.extras : [],
            sortOrder: Number(i.sort_order ?? 0),
          })),
          deliveryZones: (zones ?? []).map((z) => ({
            id: z.id,
            restaurantId: z.restaurant_id,
            name: z.name,
            fee: Number(z.fee ?? 0),
            minOrderAmount: Number(z.min_order_amount ?? 0),
            estimatedMinutes: z.estimated_minutes ?? '٣٠ - ٤٥ دقيقة',
            isActive: Boolean(z.is_active),
          })),
          branches: (branches ?? []).map((b) => ({
            id: b.id,
            restaurantId: b.restaurant_id,
            name: b.name,
            address: b.address ?? '',
            phone: b.phone ?? '',
            hoursText: b.hours_text ?? '',
            isOpen: Boolean(b.is_open),
          })),
          activeCoupons: (coupons ?? []).map((cp) => ({
            id: cp.id,
            restaurantId: cp.restaurant_id,
            code: cp.code,
            description: cp.description ?? '',
            discountType: cp.discount_type,
            discountValue: Number(cp.discount_value ?? 0),
            minOrderAmount: Number(cp.min_order_amount ?? 0),
            maxDiscountAmount: cp.max_discount_amount ? Number(cp.max_discount_amount) : undefined,
            validFrom: cp.valid_from ?? '',
            validUntil: cp.valid_until ?? '',
            usageLimit: Number(cp.usage_limit ?? 0),
            usedCount: Number(cp.used_count ?? 0),
            isActive: Boolean(cp.is_active),
            applicableCategoryIds: cp.applicable_category_ids ?? [],
            applicableItemIds: cp.applicable_item_ids ?? [],
          })),
        };
        return resolveExactRestaurantBundle(bundle, restaurantId);
      }
      if (!restErr && !restRow && restaurantId !== DEFAULT_RESTAURANT_ID) {
        return null;
      }
    } catch (err) {
      console.error('Supabase read error, falling back to edge store:', err);
    }
  }

  const db = await readEdgeDb(env);
  const restaurant = db.restaurants.find(
    (r) => r.id === restaurantId || r.slug === restaurantId
  );
  if (!restaurant) return null;

  const targetId = restaurant.id;

  return {
    restaurant: {
      ...restaurant,
      aiSettings: {
        ...restaurant.aiSettings,
        aiOrderIntake:
          restaurant.aiSettings?.aiOrderIntake ??
          restaurant.aiSettings?.allowedTopics?.orderIntake ??
          true,
      },
    },
    categories: db.categories
      .filter((c) => c.restaurantId === targetId)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    items: db.items
      .filter((i) => i.restaurantId === targetId)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    deliveryZones: db.deliveryZones.filter((z) => z.restaurantId === targetId),
    branches: db.branches.filter((b) => b.restaurantId === targetId),
    activeCoupons: db.coupons.filter((c) => c.restaurantId === targetId && c.isActive),
  };
}

export async function getRestaurantBundle(
  env: EdgeEnv,
  restaurantId: string = DEFAULT_RESTAURANT_ID
): Promise<RestaurantBundle> {
  const found = await findRestaurantBundle(env, restaurantId);
  if (!found) {
    throw new Error('RESTAURANT_NOT_FOUND');
  }
  return found;
}

export async function updateRestaurant(
  env: EdgeEnv,
  restaurantId: string,
  patch: Partial<Restaurant>
): Promise<Restaurant> {
  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const current = await getRestaurantBundle(env, restaurantId);
    const merged: Restaurant = {
      ...current.restaurant,
      ...patch,
      id: restaurantId,
      updatedAt: nowIso,
    };
    const { error } = await supabase.from('restaurants').upsert({
      id: merged.id,
      slug: merged.slug,
      name: merged.name,
      description: merged.description,
      address: merged.address,
      phone: merged.phone,
      whatsapp_number: merged.whatsappNumber,
      logo_url: merged.logoUrl,
      manual_status: merged.manualStatus,
      weekly_schedule: merged.weeklySchedule,
      schedule_exceptions: merged.scheduleExceptions,
      ai_settings: merged.aiSettings,
      system_settings: merged.systemSettings,
      updated_at: merged.updatedAt,
    });
    if (!error) return merged;
  }

  const db = await readEdgeDb(env);
  const idx = db.restaurants.findIndex((r) => r.id === restaurantId);
  const existing = idx >= 0 ? db.restaurants[idx] : db.restaurants[0];
  const updated: Restaurant = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: nowIso,
  };
  if (idx >= 0) db.restaurants[idx] = updated;
  else db.restaurants.push(updated);
  await writeEdgeDb(env, db);
  return updated;
}

export async function upsertCategory(env: EdgeEnv, category: MenuCategory): Promise<MenuCategory> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase.from('menu_categories').upsert({
      id: category.id,
      restaurant_id: category.restaurantId,
      name: category.name,
      description: category.description ?? '',
      sort_order: category.sortOrder,
    });
    if (!error) return category;
  }

  const db = await readEdgeDb(env);
  const idx = db.categories.findIndex((c) => c.id === category.id);
  if (idx >= 0) db.categories[idx] = category;
  else db.categories.push(category);
  await writeEdgeDb(env, db);
  return category;
}

export async function deleteCategory(
  env: EdgeEnv,
  restaurantId: string,
  categoryId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase
      .from('menu_categories')
      .delete()
      .eq('id', categoryId)
      .eq('restaurant_id', restaurantId);
    if (!error) return;
  }

  const db = await readEdgeDb(env);
  db.categories = db.categories.filter(
    (c) => !(c.id === categoryId && c.restaurantId === restaurantId)
  );
  db.items = db.items.filter(
    (i) => !(i.categoryId === categoryId && i.restaurantId === restaurantId)
  );
  await writeEdgeDb(env, db);
}

export async function upsertMenuItem(env: EdgeEnv, item: MenuItem): Promise<MenuItem> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase.from('menu_items').upsert({
      id: item.id,
      restaurant_id: item.restaurantId,
      category_id: item.categoryId,
      name: item.name,
      description: item.description,
      price: item.price,
      image_url: item.imageUrl,
      is_available: item.isAvailable,
      is_popular: Boolean(item.isPopular),
      stock_quantity: item.stockQuantity,
      low_stock_threshold: item.lowStockThreshold,
      sizes: item.sizes ?? [],
      extras: item.extras ?? [],
      sort_order: item.sortOrder,
    });
    if (!error) return item;
  }

  const db = await readEdgeDb(env);
  const idx = db.items.findIndex((i) => i.id === item.id);
  if (idx >= 0) db.items[idx] = item;
  else db.items.push(item);
  await writeEdgeDb(env, db);
  return item;
}

export async function reorderMenuItems(
  env: EdgeEnv,
  restaurantId: string,
  orderedIds: string[]
): Promise<void> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    await Promise.all(
      orderedIds.map((id, index) =>
        supabase
          .from('menu_items')
          .update({ sort_order: index + 1 })
          .eq('id', id)
          .eq('restaurant_id', restaurantId)
      )
    );
    return;
  }

  const db = await readEdgeDb(env);
  const orderMap = new Map(orderedIds.map((id, idx) => [id, idx + 1]));
  db.items = db.items.map((item) =>
    item.restaurantId === restaurantId && orderMap.has(item.id)
      ? { ...item, sortOrder: orderMap.get(item.id)! }
      : item
  );
  await writeEdgeDb(env, db);
}

export async function deleteMenuItem(
  env: EdgeEnv,
  restaurantId: string,
  itemId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase
      .from('menu_items')
      .delete()
      .eq('id', itemId)
      .eq('restaurant_id', restaurantId);
    if (!error) return;
  }

  const db = await readEdgeDb(env);
  db.items = db.items.filter((i) => !(i.id === itemId && i.restaurantId === restaurantId));
  await writeEdgeDb(env, db);
}

export async function upsertDeliveryZone(
  env: EdgeEnv,
  zone: DeliveryZone
): Promise<DeliveryZone> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase.from('delivery_zones').upsert({
      id: zone.id,
      restaurant_id: zone.restaurantId,
      name: zone.name,
      fee: zone.fee,
      min_order_amount: zone.minOrderAmount,
      estimated_minutes: zone.estimatedMinutes,
      is_active: zone.isActive,
    });
    if (!error) return zone;
  }

  const db = await readEdgeDb(env);
  const idx = db.deliveryZones.findIndex((z) => z.id === zone.id);
  if (idx >= 0) db.deliveryZones[idx] = zone;
  else db.deliveryZones.push(zone);
  await writeEdgeDb(env, db);
  return zone;
}

export async function deleteDeliveryZone(
  env: EdgeEnv,
  restaurantId: string,
  zoneId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase
      .from('delivery_zones')
      .delete()
      .eq('id', zoneId)
      .eq('restaurant_id', restaurantId);
    if (!error) return;
  }

  const db = await readEdgeDb(env);
  db.deliveryZones = db.deliveryZones.filter(
    (z) => !(z.id === zoneId && z.restaurantId === restaurantId)
  );
  await writeEdgeDb(env, db);
}

export async function upsertBranch(
  env: EdgeEnv,
  branch: RestaurantBranch
): Promise<RestaurantBranch> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase.from('branches').upsert({
      id: branch.id,
      restaurant_id: branch.restaurantId,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      hours_text: branch.hoursText,
      is_open: branch.isOpen,
    });
    if (!error) return branch;
  }

  const db = await readEdgeDb(env);
  const idx = db.branches.findIndex((b) => b.id === branch.id);
  if (idx >= 0) db.branches[idx] = branch;
  else db.branches.push(branch);
  await writeEdgeDb(env, db);
  return branch;
}

export async function deleteBranch(
  env: EdgeEnv,
  restaurantId: string,
  branchId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase
      .from('branches')
      .delete()
      .eq('id', branchId)
      .eq('restaurant_id', restaurantId);
    if (!error) return;
  }

  const db = await readEdgeDb(env);
  db.branches = db.branches.filter(
    (b) => !(b.id === branchId && b.restaurantId === restaurantId)
  );
  await writeEdgeDb(env, db);
}

export async function listCoupons(env: EdgeEnv, restaurantId: string): Promise<Coupon[]> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { data, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('restaurant_id', restaurantId);
    if (!error && data) {
      return data.map((cp) => ({
        id: cp.id,
        restaurantId: cp.restaurant_id,
        code: cp.code,
        description: cp.description ?? '',
        discountType: cp.discount_type,
        discountValue: Number(cp.discount_value ?? 0),
        minOrderAmount: Number(cp.min_order_amount ?? 0),
        maxDiscountAmount: cp.max_discount_amount ? Number(cp.max_discount_amount) : undefined,
        validFrom: cp.valid_from ?? '',
        validUntil: cp.valid_until ?? '',
        usageLimit: Number(cp.usage_limit ?? 0),
        usedCount: Number(cp.used_count ?? 0),
        isActive: Boolean(cp.is_active),
        applicableCategoryIds: cp.applicable_category_ids ?? [],
        applicableItemIds: cp.applicable_item_ids ?? [],
      }));
    }
  }

  const db = await readEdgeDb(env);
  return db.coupons.filter((c) => c.restaurantId === restaurantId);
}

export async function upsertCoupon(env: EdgeEnv, coupon: Coupon): Promise<Coupon> {
  const normalized: Coupon = { ...coupon, code: coupon.code.trim().toUpperCase() };
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase.from('coupons').upsert({
      id: normalized.id,
      restaurant_id: normalized.restaurantId,
      code: normalized.code,
      description: normalized.description,
      discount_type: normalized.discountType,
      discount_value: normalized.discountValue,
      min_order_amount: normalized.minOrderAmount,
      max_discount_amount: normalized.maxDiscountAmount ?? null,
      valid_from: normalized.validFrom,
      valid_until: normalized.validUntil,
      usage_limit: normalized.usageLimit,
      used_count: normalized.usedCount,
      is_active: normalized.isActive,
      applicable_category_ids: normalized.applicableCategoryIds ?? [],
      applicable_item_ids: normalized.applicableItemIds ?? [],
    });
    if (!error) return normalized;
  }

  const db = await readEdgeDb(env);
  const idx = db.coupons.findIndex((c) => c.id === normalized.id);
  if (idx >= 0) db.coupons[idx] = normalized;
  else db.coupons.unshift(normalized);
  await writeEdgeDb(env, db);
  return normalized;
}

export async function deleteCoupon(
  env: EdgeEnv,
  restaurantId: string,
  couponId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase
      .from('coupons')
      .delete()
      .eq('id', couponId)
      .eq('restaurant_id', restaurantId);
    if (!error) return;
  }

  const db = await readEdgeDb(env);
  db.coupons = db.coupons.filter(
    (c) => !(c.id === couponId && c.restaurantId === restaurantId)
  );
  await writeEdgeDb(env, db);
}

export async function incrementCouponUsage(
  env: EdgeEnv,
  restaurantId: string,
  code: string
): Promise<void> {
  const upper = code.trim().toUpperCase();
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    await incrementCouponUsageSupabase(supabase, restaurantId, upper).catch(() => {});
  }
  const db = await readEdgeDb(env);
  const idx = db.coupons.findIndex(
    (c) => c.restaurantId === restaurantId && c.code.toUpperCase() === upper
  );
  if (idx >= 0) {
    db.coupons[idx] = { ...db.coupons[idx], usedCount: (db.coupons[idx].usedCount ?? 0) + 1 };
    await writeEdgeDb(env, db);
  }
}

export async function listOrders(env: EdgeEnv, restaurantId: string): Promise<Order[]> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });
    if (!error && data) {
      return data.map((row) => mapSupabaseOrder(row));
    }
  }
  if (isProductionSupabaseRequired(env)) {
    throw new Error('Supabase database is required in production mode.');
  }

  const db = await readEdgeDb(env);
  return db.orders
    .filter((o) => o.restaurantId === restaurantId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function findOrderByToken(
  env: EdgeEnv,
  restaurantId: string,
  orderToken: string
): Promise<Order | null> {
  const clean = orderToken.trim();
  if (!clean) return null;
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const remote = await findOrderByTokenSupabase(supabase, restaurantId, clean);
    if (remote) return remote;
  }
  if (isProductionSupabaseRequired(env) && !supabase) {
    throw new Error('Supabase database is required in production mode.');
  }
  const db = await readEdgeDb(env);
  return db.orders.find((o) => o.restaurantId === restaurantId && o.orderToken === clean) ?? null;
}

export async function findOrderByNumberOrId(
  env: EdgeEnv,
  restaurantId: string,
  query: string
): Promise<Order | null> {
  const clean = query.replace(/^#/, '').trim();
  if (!clean) return null;
  const orders = await listOrders(env, restaurantId);
  return orders.find((o) => o.orderNumber === clean || o.id === clean) ?? null;
}

export async function findOrdersByPhone(
  env: EdgeEnv,
  restaurantId: string,
  phone: string
): Promise<Order[]> {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 6) return [];
  const orders = await listOrders(env, restaurantId);
  return orders.filter((o) => o.customerPhone.replace(/[^\d]/g, '').includes(digits));
}

export async function findOrderByIdempotencyKey(
  env: EdgeEnv,
  restaurantId: string,
  idempotencyKey: string
): Promise<Order | null> {
  if (!idempotencyKey) return null;
  const orders = await listOrders(env, restaurantId);
  return orders.find((o) => o.idempotencyKey === idempotencyKey) ?? null;
}

export async function createOrder(env: EdgeEnv, order: Order): Promise<Order> {
  const safeOrder: Order = {
    ...order,
    orderToken: order.orderToken || crypto.randomUUID(),
  };
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { error } = await supabase.from('orders').insert({
      id: safeOrder.id,
      order_number: safeOrder.orderNumber,
      order_token: safeOrder.orderToken,
      restaurant_id: safeOrder.restaurantId,
      customer_name: safeOrder.customerName,
      customer_phone: safeOrder.customerPhone,
      fulfillment_type: safeOrder.fulfillmentType,
      delivery_zone_id: safeOrder.deliveryZoneId,
      delivery_zone_name: safeOrder.deliveryZoneName,
      branch_id: safeOrder.branchId ?? null,
      branch_name: safeOrder.branchName ?? null,
      customer_address: safeOrder.customerAddress,
      notes: safeOrder.notes,
      items: safeOrder.items,
      subtotal: safeOrder.subtotal,
      discount_amount: safeOrder.discountAmount,
      coupon_code: safeOrder.couponCode ?? null,
      delivery_fee: safeOrder.deliveryFee,
      total: safeOrder.total,
      payment_method: safeOrder.paymentMethod,
      payment_status: safeOrder.paymentStatus,
      estimated_delivery_text: safeOrder.estimatedDeliveryText ?? null,
      stock_deducted: Boolean(safeOrder.stockDeducted),
      idempotency_key: safeOrder.idempotencyKey ?? null,
      status: safeOrder.status,
      status_history: safeOrder.statusHistory,
      created_at: safeOrder.createdAt,
      updated_at: safeOrder.updatedAt,
    });
    if (!error) {
      await insertOrderItemsSupabase(supabase, safeOrder).catch(() => {});
      return safeOrder;
    }
    if (isProductionSupabaseRequired(env)) {
      throw new Error('Failed to persist order to Supabase.');
    }
  } else if (isProductionSupabaseRequired(env)) {
    throw new Error('Supabase configuration is required in production mode.');
  }

  const db = await readEdgeDb(env);
  db.orders.unshift(safeOrder);
  db.notifications.unshift({
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    restaurantId: safeOrder.restaurantId,
    type: 'order',
    title: `طلب جديد #${safeOrder.orderNumber}`,
    message: `طلب من ${safeOrder.customerName} بقيمة ${safeOrder.total} ج.م.`,
    isRead: false,
    createdAt: safeOrder.createdAt,
  });
  db.notifications = db.notifications.slice(0, 40);
  await writeEdgeDb(env, db);
  return safeOrder;
}

export async function adjustItemStock(
  env: EdgeEnv,
  params: {
    restaurantId: string;
    itemId: string;
    delta: number;
    reason: string;
    referenceOrderId?: string;
  }
): Promise<MenuItem | null> {
  const { restaurantId, itemId, delta, reason, referenceOrderId } = params;
  const db = await readEdgeDb(env);
  const idx = db.items.findIndex((i) => i.id === itemId && i.restaurantId === restaurantId);
  if (idx < 0) return null;

  const item = db.items[idx];
  const prevQty = Number(item.stockQuantity ?? 0);
  const nextQty = Math.max(0, prevQty + delta);
  const updatedItem: MenuItem = {
    ...item,
    stockQuantity: nextQty,
    isAvailable: nextQty === 0 ? false : item.isAvailable,
  };
  db.items[idx] = updatedItem;

  const movement: InventoryMovement = {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    restaurantId,
    itemId: item.id,
    itemName: item.name,
    change: delta,
    previousQty: prevQty,
    newQty: nextQty,
    reason,
    referenceOrderId,
    createdAt: new Date().toISOString(),
  };
  db.inventoryMovements.unshift(movement);
  db.inventoryMovements = db.inventoryMovements.slice(0, 120);

  const lowStockThreshold = updatedItem.lowStockThreshold ?? 8;
  if (nextQty <= lowStockThreshold && prevQty > lowStockThreshold) {
    db.notifications.unshift({
      id: `notif_stock_${Date.now()}`,
      restaurantId,
      type: 'stock',
      title: 'تنبيه انخفاض المخزون',
      message: `صنف "${updatedItem.name}" وصل إلى ${nextQty} وحدات متبقية.`,
      isRead: false,
      createdAt: new Date().toISOString(),
    });
  }

  await writeEdgeDb(env, db);

  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    await Promise.all([
      supabase
        .from('menu_items')
        .update({ stock_quantity: nextQty, is_available: updatedItem.isAvailable })
        .eq('id', itemId)
        .eq('restaurant_id', restaurantId),
      supabase.from('inventory_movements').insert({
        id: movement.id,
        restaurant_id: movement.restaurantId,
        item_id: movement.itemId,
        item_name: movement.itemName,
        change: movement.change,
        previous_qty: movement.previousQty,
        new_qty: movement.newQty,
        reason: movement.reason,
        reference_order_id: movement.referenceOrderId ?? null,
        created_at: movement.createdAt,
      }),
    ]).catch(() => {});
  }

  return updatedItem;
}

export async function updateOrderStatus(
  env: EdgeEnv,
  restaurantId: string,
  orderId: string,
  status: OrderStatus,
  actorName = 'المدير'
): Promise<Order | null> {
  const nowIso = new Date().toISOString();
  const db = await readEdgeDb(env);
  const idx = db.orders.findIndex((o) => o.id === orderId && o.restaurantId === restaurantId);
  let targetOrder: Order | null = idx >= 0 ? db.orders[idx] : null;

  const supabase = getSupabaseAdminClient(env);
  if (!targetOrder && supabase) {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (data) targetOrder = mapSupabaseOrder(data);
  }

  if (!targetOrder) return null;

  const shouldDeduct =
    !targetOrder.stockDeducted &&
    (status === 'accepted' ||
      status === 'preparing' ||
      status === 'out_for_delivery' ||
      status === 'delivered');

  const shouldRestore = targetOrder.stockDeducted && status === 'cancelled';
  let nextStockDeducted = Boolean(targetOrder.stockDeducted);

  if (shouldDeduct) {
    for (const oi of targetOrder.items) {
      await adjustItemStock(env, {
        restaurantId,
        itemId: oi.itemId,
        delta: -oi.quantity,
        reason: `خصم تلقائي عند اعتماد الطلب #${targetOrder.orderNumber}`,
        referenceOrderId: targetOrder.id,
      });
    }
    nextStockDeducted = true;
  } else if (shouldRestore) {
    for (const oi of targetOrder.items) {
      await adjustItemStock(env, {
        restaurantId,
        itemId: oi.itemId,
        delta: oi.quantity,
        reason: `إرجاع مخزون تلقائي لإلغاء الطلب #${targetOrder.orderNumber}`,
        referenceOrderId: targetOrder.id,
      });
    }
    nextStockDeducted = false;
  }

  const freshDb = await readEdgeDb(env);
  const freshIdx = freshDb.orders.findIndex(
    (o) => o.id === orderId && o.restaurantId === restaurantId
  );

  const history = Array.isArray(targetOrder.statusHistory)
    ? [...targetOrder.statusHistory]
    : [];
  if (!history.some((h) => h.status === status) || history[history.length - 1]?.status !== status) {
    history.push({ status, timestamp: nowIso });
  }

  const updatedOrder: Order = {
    ...targetOrder,
    status,
    stockDeducted: nextStockDeducted,
    paymentStatus: status === 'delivered' ? 'paid' : targetOrder.paymentStatus,
    statusHistory: history,
    updatedAt: nowIso,
  };

  if (freshIdx >= 0) {
    freshDb.orders[freshIdx] = updatedOrder;
  }
  freshDb.activityLogs.unshift({
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    restaurantId,
    actorName,
    action: `تحديث حالة الطلب #${updatedOrder.orderNumber}`,
    details: `تم تغيير الحالة إلى ${status}`,
    createdAt: nowIso,
  });
  freshDb.activityLogs = freshDb.activityLogs.slice(0, 100);
  await writeEdgeDb(env, freshDb);

  if (supabase) {
    try {
      await supabase
        .from('orders')
        .update({
          status: updatedOrder.status,
          stock_deducted: updatedOrder.stockDeducted,
          payment_status: updatedOrder.paymentStatus,
          status_history: updatedOrder.statusHistory,
          updated_at: updatedOrder.updatedAt,
        })
        .eq('id', orderId)
        .eq('restaurant_id', restaurantId);
    } catch {
      // Ignore remote sync error when edge store succeeded
    }
  }

  return updatedOrder;
}

export async function rateOrderByToken(
  env: EdgeEnv,
  restaurantId: string,
  orderToken: string,
  rating: number,
  comment: string,
  orderNumber?: string
): Promise<Order | null> {
  const cleanToken = orderToken.trim();
  const cleanOrderNumber = (orderNumber || '').replace(/^#/, '').trim();
  if (!cleanToken && !cleanOrderNumber) return null;
  const db = await readEdgeDb(env);
  const idx = db.orders.findIndex(
    (o) =>
      o.restaurantId === restaurantId &&
      ((cleanToken && o.orderToken === cleanToken) ||
        (cleanOrderNumber && (o.orderNumber === cleanOrderNumber || o.id === cleanOrderNumber)))
  );

  const supabase = getSupabaseAdminClient(env);
  let target: Order | null = idx >= 0 ? db.orders[idx] : null;
  if (!target && supabase && cleanToken) {
    target = await findOrderByTokenSupabase(supabase, restaurantId, cleanToken);
  }
  if (!target && supabase && cleanOrderNumber) {
    const orders = await listOrders(env, restaurantId);
    target =
      orders.find(
        (o) => o.orderNumber === cleanOrderNumber || o.id === cleanOrderNumber
      ) ?? null;
  }
  if (!target) return null;

  if (target.status !== 'delivered') {
    throw new Error('يمكن تقييم الطلب فقط بعد تمام التوصيل.');
  }

  const nowIso = new Date().toISOString();
  const updated: Order = {
    ...target,
    rating,
    ratingComment: comment.trim() || undefined,
    ratedAt: nowIso,
    updatedAt: nowIso,
  };
  if (idx >= 0) {
    db.orders[idx] = updated;
    await writeEdgeDb(env, db);
  }

  if (supabase) {
    try {
      await supabase
        .from('orders')
        .update({
          rating,
          rating_comment: comment.trim() || null,
          rated_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', target.id)
        .eq('restaurant_id', restaurantId);
    } catch {
      // Ignore
    }
  }
  return updated;
}

export async function rateOrder(
  env: EdgeEnv,
  restaurantId: string,
  orderToken: string,
  rating: number,
  comment: string,
  orderNumber?: string
): Promise<Order | null> {
  return rateOrderByToken(env, restaurantId, orderToken, rating, comment, orderNumber);
}

export async function listInventoryMovements(
  env: EdgeEnv,
  restaurantId: string
): Promise<InventoryMovement[]> {
  const db = await readEdgeDb(env);
  return db.inventoryMovements.filter((m) => m.restaurantId === restaurantId);
}

export async function listEmployees(env: EdgeEnv, restaurantId: string): Promise<Employee[]> {
  const db = await readEdgeDb(env);
  return db.employees
    .filter((e) => e.restaurantId === restaurantId)
    .map(({ passwordHash: _omitted, ...safe }) => safe);
}

export async function findEmployeeByEmail(
  env: EdgeEnv,
  restaurantId: string,
  email: string
): Promise<Employee | null> {
  const clean = email.trim().toLowerCase();
  const db = await readEdgeDb(env);
  return (
    db.employees.find(
      (e) => e.restaurantId === restaurantId && e.email.toLowerCase() === clean && e.isActive
    ) ?? null
  );
}

export async function upsertEmployee(env: EdgeEnv, emp: Employee): Promise<Employee> {
  const db = await readEdgeDb(env);
  const idx = db.employees.findIndex((e) => e.id === emp.id);
  const existing = idx >= 0 ? db.employees[idx] : null;
  const toSave: Employee = {
    ...emp,
    passwordHash: emp.passwordHash ?? existing?.passwordHash,
    mustChangePassword: emp.mustChangePassword ?? existing?.mustChangePassword,
  };
  if (idx >= 0) db.employees[idx] = toSave;
  else db.employees.unshift(toSave);
  await writeEdgeDb(env, db);
  const { passwordHash: _omitted, ...safe } = toSave;
  return safe;
}

export async function deleteEmployee(
  env: EdgeEnv,
  restaurantId: string,
  employeeId: string
): Promise<void> {
  const db = await readEdgeDb(env);
  db.employees = db.employees.filter(
    (e) => !(e.id === employeeId && e.restaurantId === restaurantId)
  );
  await writeEdgeDb(env, db);
}

export async function appendActivityLog(env: EdgeEnv, entry: ActivityLog): Promise<void> {
  const db = await readEdgeDb(env);
  db.activityLogs.unshift(entry);
  db.activityLogs = db.activityLogs.slice(0, 120);
  await writeEdgeDb(env, db);
}

export async function listActivityLogs(
  env: EdgeEnv,
  restaurantId: string
): Promise<ActivityLog[]> {
  const db = await readEdgeDb(env);
  return db.activityLogs.filter((l) => l.restaurantId === restaurantId);
}

export async function listNotifications(
  env: EdgeEnv,
  restaurantId: string
): Promise<AdminNotification[]> {
  const db = await readEdgeDb(env);
  return db.notifications.filter((n) => n.restaurantId === restaurantId);
}

export async function markNotificationsRead(env: EdgeEnv, restaurantId: string): Promise<void> {
  const db = await readEdgeDb(env);
  db.notifications = db.notifications.map((n) =>
    n.restaurantId === restaurantId ? { ...n, isRead: true } : n
  );
  await writeEdgeDb(env, db);
}

export async function appendAiLog(env: EdgeEnv, entry: AILogEntry): Promise<void> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    try {
      await supabase.from('ai_logs').insert({
        id: entry.id,
        restaurant_id: entry.restaurantId,
        timestamp: entry.timestamp,
        model: entry.model,
        status: entry.status,
        latency_ms: entry.latencyMs,
        user_message_preview: entry.userMessagePreview,
        error_message: entry.errorMessage ?? null,
      });
      return;
    } catch {
      // Fall back to edge db
    }
  }

  const db = await readEdgeDb(env);
  db.aiLogs.unshift(entry);
  db.aiLogs = db.aiLogs.slice(0, 50);
  await writeEdgeDb(env, db);
}

export async function listAiLogs(env: EdgeEnv, restaurantId: string): Promise<AILogEntry[]> {
  const supabase = getSupabaseAdminClient(env);
  if (supabase) {
    const { data, error } = await supabase
      .from('ai_logs')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('timestamp', { ascending: false })
      .limit(40);
    if (!error && data) {
      return data.map((row) => ({
        id: row.id,
        restaurantId: row.restaurant_id,
        timestamp: row.timestamp,
        model: row.model,
        status: row.status,
        latencyMs: Number(row.latency_ms),
        userMessagePreview: row.user_message_preview,
        errorMessage: row.error_message ?? undefined,
      }));
    }
  }

  const db = await readEdgeDb(env);
  return db.aiLogs.filter((l) => l.restaurantId === restaurantId);
}

export async function isOwnerPasswordOverridden(env: EdgeEnv): Promise<boolean> {
  if (env.ADMIN_PASSWORD_HASH?.trim()) return true;
  const db = await readEdgeDb(env);
  return Boolean(db.adminPasswordOverride);
}

export async function verifyAdminPassword(env: EdgeEnv, candidate: string): Promise<boolean> {
  if (!candidate || COMPROMISED_DEFAULT_PASSWORDS.has(candidate)) {
    return false;
  }

  const db = await readEdgeDb(env);
  const stored = db.adminPasswordOverride;
  if (stored) {
    return verifyPasswordAgainstHash(candidate, stored);
  }

  const envHash = env.ADMIN_PASSWORD_HASH?.trim();
  if (envHash) {
    return verifyPasswordAgainstHash(candidate, envHash);
  }

  const initialPass = (env.ADMIN_INITIAL_PASSWORD || env.ADMIN_PASSWORD || '').trim();
  if (!initialPass || COMPROMISED_DEFAULT_PASSWORDS.has(initialPass)) {
    return false;
  }
  return constantTimeEqual(candidate, initialPass);
}

export async function setAdminPassword(env: EdgeEnv, newPassword: string): Promise<void> {
  const db = await readEdgeDb(env);
  db.adminPasswordOverride = await hashPasswordBcrypt(newPassword);
  await writeEdgeDb(env, db);
}

export async function uploadImageAsset(
  env: EdgeEnv,
  filename: string,
  mimeType: string,
  cleanBase64: string
): Promise<string> {
  const supabase = getSupabaseAdminClient(env);
  const safeExt = filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
  const uniqueName = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  if (supabase) {
    const binary = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage
      .from('restaurant-assets')
      .upload(uniqueName, binary, { contentType: mimeType, upsert: false });
    if (!error) {
      const { data } = supabase.storage.from('restaurant-assets').getPublicUrl(uniqueName);
      if (data?.publicUrl) return data.publicUrl;
    }
  }

  return `data:${mimeType};base64,${cleanBase64}`;
}
