-- =====================================================================
-- موظف المطعم — مخطط قاعدة بيانات Supabase الكامل (الإصدار الإنتاجي)
-- =====================================================================

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

-- 8. جدول الطلبات
create table if not exists public.orders (
  id text primary key,
  order_number text not null,
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
create index if not exists idx_orders_rest_phone on public.orders (restaurant_id, customer_phone);
create index if not exists idx_orders_rest_created on public.orders (restaurant_id, created_at desc);

-- 9. جدول حركات المخزون
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

-- 10. جدول الموظفين والصلاحيات
create table if not exists public.employees (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null default '',
  role text not null default 'cashier',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 11. جدول سجل النشاط
create table if not exists public.activity_logs (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  actor_name text not null,
  action text not null,
  details text not null default '',
  created_at timestamptz not null default now()
);

-- 12. جدول الإشعارات
create table if not exists public.notifications (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  type text not null default 'system',
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- 13. جدول سجلات المساعد الذكي
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

-- تفعيل سياسات الحماية (RLS)
alter table public.restaurants enable row level security;
alter table public.restaurant_admins enable row level security;
alter table public.branches enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.employees enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.ai_logs enable row level security;

-- القراءة العامة للبيانات التشغيلية فقط
create policy "Public read restaurants" on public.restaurants for select using (true);
create policy "Public read branches" on public.branches for select using (true);
create policy "Public read categories" on public.menu_categories for select using (true);
create policy "Public read items" on public.menu_items for select using (true);
create policy "Public read delivery zones" on public.delivery_zones for select using (true);
create policy "Public read active coupons" on public.coupons for select using (is_active = true);

-- إنشاء الطلبات ومتابعتها عبر API
create policy "Public insert orders" on public.orders for insert with check (true);
create policy "Public read orders by order number" on public.orders for select using (true);

-- دالة التحقق من صلاحية المدير
create or replace function public.is_restaurant_admin(target_restaurant_id text)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.restaurant_admins
    where restaurant_id = target_restaurant_id
      and user_id = auth.uid()
  );
$$;

create policy "Admins manage restaurants" on public.restaurants
  for all using (public.is_restaurant_admin(id)) with check (public.is_restaurant_admin(id));
create policy "Admins manage branches" on public.branches
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage categories" on public.menu_categories
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage items" on public.menu_items
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage delivery zones" on public.delivery_zones
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage coupons" on public.coupons
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage orders" on public.orders
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage inventory" on public.inventory_movements
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage employees" on public.employees
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins read activity logs" on public.activity_logs
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins manage notifications" on public.notifications
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
create policy "Admins read ai logs" on public.ai_logs
  for select using (public.is_restaurant_admin(restaurant_id));

-- إنشاء حاوية تخزين الصور في Supabase Storage (restaurant-assets)
insert into storage.buckets (id, name, public)
values ('restaurant-assets', 'restaurant-assets', true)
on conflict (id) do nothing;

create policy "Public read restaurant assets" on storage.objects
  for select using (bucket_id = 'restaurant-assets');

create policy "Authenticated upload restaurant assets" on storage.objects
  for insert with check (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated');
