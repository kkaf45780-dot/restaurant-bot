-- =====================================================================
-- موظف المطعم — مخطط قاعدة بيانات Supabase الكامل (الإصدار الإنتاجي الآمن)
-- =====================================================================

create extension if not exists pgcrypto;

-- 1. جدول المطاعم
create table if not exists public.restaurants (
  id text primary key,
  slug text unique not null,
  name text not null,
  description text not null default '',
  address text not null default '',
  phone text not null default '',
  whatsapp_number text not null default '',
  logo_url text not null default '',
  manual_status text not null default 'auto',
  weekly_schedule jsonb not null default '[]'::jsonb,
  schedule_exceptions jsonb not null default '[]'::jsonb,
  ai_settings jsonb not null default '{}'::jsonb,
  system_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. جدول ربط مديري المطاعم بحسابات Supabase Auth
create table if not exists public.restaurant_admins (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  unique(restaurant_id, user_id)
);

-- 3. جدول فروع المطعم
create table if not exists public.branches (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  address text not null default '',
  phone text not null default '',
  hours_text text not null default '',
  is_open boolean not null default true
);

-- 4. جدول أقسام المنيو
create table if not exists public.menu_categories (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text default '',
  image_url text not null default '',
  sort_order integer not null default 0
);

-- 5. جدول أصناف المنيو (يشمل الأحجام والإضافات والمخزون)
create table if not exists public.menu_items (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  category_id text not null references public.menu_categories(id) on delete cascade,
  name text not null,
  description text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  image_url text not null default '',
  is_available boolean not null default true,
  is_popular boolean not null default false,
  stock_quantity integer not null default 50,
  low_stock_threshold integer not null default 8,
  sizes jsonb not null default '[]'::jsonb,
  extras jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0
);

-- 6. جدول مناطق التوصيل
create table if not exists public.delivery_zones (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  fee numeric(10, 2) not null check (fee >= 0),
  min_order_amount numeric(10, 2) not null default 0,
  estimated_minutes text not null default '30 - 45 دقيقة',
  is_active boolean not null default true
);

-- 7. جدول كوبونات الخصم والعروض
create table if not exists public.coupons (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  code text not null,
  description text not null default '',
  discount_type text not null default 'percentage',
  discount_value numeric(10, 2) not null check (discount_value >= 0),
  min_order_amount numeric(10, 2) not null default 0,
  max_discount_amount numeric(10, 2),
  valid_from text not null default '',
  valid_until text not null default '',
  usage_limit integer not null default 0,
  used_count integer not null default 0,
  is_active boolean not null default true,
  applicable_category_ids jsonb default '[]'::jsonb,
  applicable_item_ids jsonb default '[]'::jsonb,
  unique(restaurant_id, code)
);

-- 8. جدول الطلبات (يتضمن order_token عشوائي غير قابل للتخمين لمنع IDOR)
create table if not exists public.orders (
  id text primary key,
  order_number text not null,
  order_token text unique not null default gen_random_uuid()::text,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  fulfillment_type text not null default 'delivery',
  delivery_zone_id text not null default '',
  delivery_zone_name text not null default '',
  branch_id text,
  branch_name text,
  customer_address text not null default '',
  notes text not null default '',
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10, 2) not null,
  discount_amount numeric(10, 2) not null default 0,
  coupon_code text,
  delivery_fee numeric(10, 2) not null default 0,
  total numeric(10, 2) not null,
  payment_method text not null default 'cash_on_delivery',
  payment_status text not null default 'pending',
  estimated_delivery_text text,
  stock_deducted boolean not null default false,
  idempotency_key text,
  status text not null default 'received',
  status_history jsonb not null default '[]'::jsonb,
  rating integer check (rating >= 1 and rating <= 5),
  rating_comment text,
  rated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_rest_number on public.orders (restaurant_id, order_number);
create index if not exists idx_orders_token on public.orders (order_token);
create index if not exists idx_orders_rest_idempotency on public.orders (restaurant_id, idempotency_key);
create index if not exists idx_orders_rest_created on public.orders (restaurant_id, created_at desc);

-- 9. جدول بنود الطلبات العلائقي (Order Items)
create table if not exists public.order_items (
  id text primary key default gen_random_uuid()::text,
  order_id text not null references public.orders(id) on delete cascade,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  item_id text not null,
  item_name text not null,
  unit_price numeric(10, 2) not null,
  quantity integer not null check (quantity > 0),
  line_total numeric(10, 2) not null,
  selected_size_id text,
  selected_size_label text,
  selected_extras jsonb not null default '[]'::jsonb,
  item_notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order_id on public.order_items (order_id);

-- 10. جدول حركات المخزون
create table if not exists public.inventory_movements (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  item_id text not null,
  item_name text not null,
  change integer not null,
  previous_qty integer not null,
  new_qty integer not null,
  reason text not null,
  reference_order_id text,
  created_at timestamptz not null default now()
);

-- 11. جدول الموظفين والصلاحيات + بيانات الاعتماد المشفرة
create table if not exists public.employees (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null default '',
  role text not null default 'cashier',
  password_hash text,
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(restaurant_id, email)
);

-- 12. جدول سجل النشاط
create table if not exists public.activity_logs (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  actor_name text not null,
  action text not null,
  details text not null default '',
  created_at timestamptz not null default now()
);

-- 13. جدول الإشعارات
create table if not exists public.notifications (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  type text not null default 'system',
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- 14. جدول سجلات المساعد الذكي (بدون PII)
create table if not exists public.ai_logs (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  timestamp timestamptz not null default now(),
  model text not null,
  status text not null,
  latency_ms integer not null default 0,
  user_message_preview text not null default '',
  error_message text
);

-- 15. جدول العملاء
create table if not exists public.customers (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  phone text not null,
  default_address text not null default '',
  last_zone_id text,
  orders_count integer not null default 0,
  total_spent numeric(10, 2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(restaurant_id, phone)
);

-- الفهارس التشغيلية
create index if not exists idx_categories_rest_sort on public.menu_categories (restaurant_id, sort_order);
create index if not exists idx_items_rest_cat_sort on public.menu_items (restaurant_id, category_id, sort_order);
create index if not exists idx_branches_rest on public.branches (restaurant_id);
create index if not exists idx_delivery_zones_rest on public.delivery_zones (restaurant_id);
create index if not exists idx_coupons_rest_active on public.coupons (restaurant_id, is_active);
create index if not exists idx_inventory_movements_rest_created on public.inventory_movements (restaurant_id, created_at desc);
create index if not exists idx_employees_rest_email on public.employees (restaurant_id, email);
create index if not exists idx_activity_logs_rest_created on public.activity_logs (restaurant_id, created_at desc);
create index if not exists idx_notifications_rest_created on public.notifications (restaurant_id, created_at desc);
create index if not exists idx_ai_logs_rest_ts on public.ai_logs (restaurant_id, timestamp desc);
create index if not exists idx_customers_rest_phone on public.customers (restaurant_id, phone);

-- 15. دالة ذرية لزيادة عداد الكوبون بأمان
create or replace function public.increment_coupon_usage(
  p_restaurant_id text,
  p_code text
) returns void language plpgsql security definer as $$
begin
  update public.coupons
  set used_count = used_count + 1
  where restaurant_id = p_restaurant_id
    and upper(code) = upper(p_code);
end;
$$;

-- =====================================================================
-- تفعيل سياسات الحماية (RLS)
-- =====================================================================
alter table public.restaurants enable row level security;
alter table public.restaurant_admins enable row level security;
alter table public.branches enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.employees enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.ai_logs enable row level security;
alter table public.customers enable row level security;

-- القراءة العامة للمنيو والبيانات التشغيلية فقط (ممنوع قراءة orders أو employees أو logs للعامة)
drop policy if exists "Public read restaurants" on public.restaurants;
create policy "Public read restaurants" on public.restaurants for select using (true);

drop policy if exists "Public read branches" on public.branches;
create policy "Public read branches" on public.branches for select using (true);

drop policy if exists "Public read categories" on public.menu_categories;
create policy "Public read categories" on public.menu_categories for select using (true);

drop policy if exists "Public read items" on public.menu_items;
create policy "Public read items" on public.menu_items for select using (true);

drop policy if exists "Public read delivery zones" on public.delivery_zones;
create policy "Public read delivery zones" on public.delivery_zones for select using (is_active = true);

drop policy if exists "Public read active coupons" on public.coupons;
create policy "Public read active coupons" on public.coupons for select using (is_active = true);

-- إزالة سياسات القراءة المفتوحة على الطلبات (تُدار عبر Worker / Service Role فقط مع التحقق من order_token)
drop policy if exists "Public read orders by order number" on public.orders;
drop policy if exists "Public insert orders" on public.orders;

-- دالة التحقق من صلاحية المدير
create or replace function public.is_restaurant_admin(target_restaurant_id text)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.restaurant_admins
    where restaurant_id = target_restaurant_id
      and user_id = auth.uid()
  );
$$;

drop policy if exists "Admins manage restaurants" on public.restaurants;
create policy "Admins manage restaurants" on public.restaurants
  for all using (public.is_restaurant_admin(id)) with check (public.is_restaurant_admin(id));

drop policy if exists "Admins manage branches" on public.branches;
create policy "Admins manage branches" on public.branches
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage categories" on public.menu_categories;
create policy "Admins manage categories" on public.menu_categories
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage items" on public.menu_items;
create policy "Admins manage items" on public.menu_items
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage delivery zones" on public.delivery_zones;
create policy "Admins manage delivery zones" on public.delivery_zones
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage coupons" on public.coupons;
create policy "Admins manage coupons" on public.coupons
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage orders" on public.orders;
create policy "Admins manage orders" on public.orders
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage order_items" on public.order_items;
create policy "Admins manage order_items" on public.order_items
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage inventory" on public.inventory_movements;
create policy "Admins manage inventory" on public.inventory_movements
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage employees" on public.employees;
create policy "Admins manage employees" on public.employees
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins read activity logs" on public.activity_logs;
create policy "Admins read activity logs" on public.activity_logs
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage notifications" on public.notifications;
create policy "Admins manage notifications" on public.notifications
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins read ai logs" on public.ai_logs;
create policy "Admins read ai logs" on public.ai_logs
  for select using (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));

-- حاوية تخزين الصور في Supabase Storage
insert into storage.buckets (id, name, public)
values ('restaurant-assets', 'restaurant-assets', true)
on conflict (id) do nothing;

drop policy if exists "Public read restaurant assets" on storage.objects;
create policy "Public read restaurant assets" on storage.objects
  for select using (bucket_id = 'restaurant-assets');

drop policy if exists "Authenticated upload restaurant assets" on storage.objects;
create policy "Authenticated upload restaurant assets" on storage.objects
  for insert with check (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated');

drop policy if exists "Authenticated update restaurant assets" on storage.objects;
create policy "Authenticated update restaurant assets" on storage.objects
  for update using (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated')
  with check (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated');

drop policy if exists "Authenticated delete restaurant assets" on storage.objects;
create policy "Authenticated delete restaurant assets" on storage.objects
  for delete using (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated');

-- تفعيل المزامنة اللحظية (Supabase Realtime)
do $$
declare
  tbl text;
  realtime_tables text[] := array[
    'restaurants',
    'branches',
    'menu_categories',
    'menu_items',
    'delivery_zones',
    'coupons',
    'orders',
    'inventory_movements',
    'activity_logs',
    'notifications',
    'employees',
    'customers'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array realtime_tables loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      exception
        when duplicate_object then
          null;
      end;
    end loop;
  end if;
end $$;
