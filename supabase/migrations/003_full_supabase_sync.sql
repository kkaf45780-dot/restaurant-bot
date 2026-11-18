-- =====================================================================
-- 003: Full Supabase Production Sync (Schema fixes, Customers, Indexes,
--      Storage RLS policies & Supabase Realtime publication)
-- =====================================================================

-- 1. Fix orders.order_token column type to TEXT so both UUID and HMAC tokens work
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'order_token'
      and data_type <> 'text'
  ) then
    alter table public.orders
      alter column order_token drop default;
    alter table public.orders
      alter column order_token type text using order_token::text;
    alter table public.orders
      alter column order_token set default gen_random_uuid()::text;
  end if;
end $$;

-- 2. Customers table (synced automatically with each order)
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

alter table public.customers enable row level security;

drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers
  for all using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

-- 3. Optional metadata columns for future-proofing
alter table public.menu_categories
  add column if not exists image_url text not null default '';

-- 4. Performance indexes for customer menu, orders, inventory, logs & notifications
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

-- 5. Complete Storage RLS policies for restaurant-assets (SELECT, INSERT, UPDATE, DELETE)
drop policy if exists "Authenticated update restaurant assets" on storage.objects;
create policy "Authenticated update restaurant assets" on storage.objects
  for update using (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated')
  with check (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated');

drop policy if exists "Authenticated delete restaurant assets" on storage.objects;
create policy "Authenticated delete restaurant assets" on storage.objects
  for delete using (bucket_id = 'restaurant-assets' and auth.role() = 'authenticated');

-- 6. Enable Supabase Realtime publication for live Customer & Admin auto-sync
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
