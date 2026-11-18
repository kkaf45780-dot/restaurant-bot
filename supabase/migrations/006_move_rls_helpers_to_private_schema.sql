-- Keep SECURITY DEFINER authorization helpers outside the exposed API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_restaurant_admin(target_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.restaurant_admins
    where restaurant_id = target_restaurant_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from legacy_restaurant_backup.admins a
      where a.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.restaurant_admins ra
      where ra.user_id = (select auth.uid())
    )
  );
$$;

revoke all on function private.is_restaurant_admin(text) from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_restaurant_admin(text) to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

-- Repoint all admin RLS policies to non-exposed helpers.
drop policy if exists "Admins manage restaurants" on public.restaurants;
create policy "Admins manage restaurants" on public.restaurants
  for all to authenticated using (private.is_restaurant_admin(id))
  with check (private.is_restaurant_admin(id));

drop policy if exists "Admins manage branches" on public.branches;
create policy "Admins manage branches" on public.branches
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage categories" on public.menu_categories;
create policy "Admins manage categories" on public.menu_categories
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage items" on public.menu_items;
create policy "Admins manage items" on public.menu_items
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage delivery zones" on public.delivery_zones;
create policy "Admins manage delivery zones" on public.delivery_zones
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage coupons" on public.coupons;
create policy "Admins manage coupons" on public.coupons
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage orders" on public.orders;
create policy "Admins manage orders" on public.orders
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage order_items" on public.order_items;
create policy "Admins manage order_items" on public.order_items
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage inventory" on public.inventory_movements;
create policy "Admins manage inventory" on public.inventory_movements
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage employees" on public.employees;
create policy "Admins manage employees" on public.employees
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins read activity logs" on public.activity_logs;
create policy "Admins read activity logs" on public.activity_logs
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage notifications" on public.notifications;
create policy "Admins manage notifications" on public.notifications
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins read ai logs" on public.ai_logs;
create policy "Admins read ai logs" on public.ai_logs
  for select to authenticated using (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

drop policy if exists "Restaurant admins manage memberships" on public.restaurant_admins;
create policy "Restaurant admins manage memberships" on public.restaurant_admins
  for all to authenticated using (private.is_restaurant_admin(restaurant_id))
  with check (private.is_restaurant_admin(restaurant_id));

-- Storage administration remains authenticated-admin-only.
drop policy if exists restaurant_images_admin_delete on storage.objects;
create policy restaurant_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'restaurant-images' and private.is_admin());

drop policy if exists restaurant_images_admin_insert on storage.objects;
create policy restaurant_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'restaurant-images' and private.is_admin());

drop policy if exists restaurant_images_admin_update on storage.objects;
create policy restaurant_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'restaurant-images' and private.is_admin())
  with check (bucket_id = 'restaurant-images' and private.is_admin());

-- Remove public-schema helper access. Keep is_admin only for legacy backup policies.
revoke all on function public.is_admin() from public, anon, authenticated;
drop function public.is_restaurant_admin(text);
