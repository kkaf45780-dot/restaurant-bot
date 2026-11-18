-- =====================================================================
-- 008: Commercial Hardening, Employee Credentials, Storage Fix & Indexes
-- =====================================================================

-- 1. Ensure employee credential columns and order payment status exist cleanly
alter table public.employees
  add column if not exists password_hash text,
  add column if not exists must_change_password boolean not null default true;

alter table public.orders
  add column if not exists payment_status text not null default 'pending';

-- 2. Performance composite indexes for high-traffic admin & customer queries
create index if not exists idx_orders_rest_status_created
  on public.orders (restaurant_id, status, created_at desc);

create index if not exists idx_customers_rest_last_order
  on public.customers (restaurant_id, last_order_at desc);

-- 3. Fix storage bucket name mismatch from migration 006 ('restaurant-images' -> 'restaurant-assets')
insert into storage.buckets (id, name, public)
values ('restaurant-assets', 'restaurant-assets', true)
on conflict (id) do update set public = true;

drop policy if exists restaurant_images_admin_delete on storage.objects;
drop policy if exists restaurant_images_admin_insert on storage.objects;
drop policy if exists restaurant_images_admin_update on storage.objects;

drop policy if exists "Public read restaurant assets" on storage.objects;
create policy "Public read restaurant assets" on storage.objects
  for select using (bucket_id = 'restaurant-assets');

drop policy if exists "Authenticated upload restaurant assets" on storage.objects;
create policy "Authenticated upload restaurant assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'restaurant-assets' and private.is_admin());

drop policy if exists "Authenticated update restaurant assets" on storage.objects;
create policy "Authenticated update restaurant assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'restaurant-assets' and private.is_admin())
  with check (bucket_id = 'restaurant-assets' and private.is_admin());

drop policy if exists "Authenticated delete restaurant assets" on storage.objects;
create policy "Authenticated delete restaurant assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'restaurant-assets' and private.is_admin());

-- 4. Tighten direct anon/authenticated SELECT column grants on coupons
--    so internal usage counters (usage_limit, used_count) are never exposed directly
revoke select on public.coupons from anon, authenticated;
grant select (
  id,
  restaurant_id,
  code,
  description,
  discount_type,
  discount_value,
  min_order_amount,
  max_discount_amount,
  valid_from,
  valid_until,
  is_active,
  applicable_category_ids,
  applicable_item_ids
) on public.coupons to anon, authenticated;

grant all privileges on all tables in schema public to service_role;
