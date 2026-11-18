-- Restrict administrator policies and helper RPCs to signed-in roles.
revoke all on function public.is_restaurant_admin(text) from anon;
grant execute on function public.is_restaurant_admin(text) to authenticated, service_role;

drop policy if exists "Admins manage restaurants" on public.restaurants;
create policy "Admins manage restaurants" on public.restaurants
  for all to authenticated
  using (public.is_restaurant_admin(id))
  with check (public.is_restaurant_admin(id));

drop policy if exists "Admins manage branches" on public.branches;
create policy "Admins manage branches" on public.branches
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage categories" on public.menu_categories;
create policy "Admins manage categories" on public.menu_categories
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage items" on public.menu_items;
create policy "Admins manage items" on public.menu_items
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage delivery zones" on public.delivery_zones;
create policy "Admins manage delivery zones" on public.delivery_zones
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage coupons" on public.coupons;
create policy "Admins manage coupons" on public.coupons
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage orders" on public.orders;
create policy "Admins manage orders" on public.orders
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage order_items" on public.order_items;
create policy "Admins manage order_items" on public.order_items
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage inventory" on public.inventory_movements;
create policy "Admins manage inventory" on public.inventory_movements
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage employees" on public.employees;
create policy "Admins manage employees" on public.employees
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins read activity logs" on public.activity_logs;
create policy "Admins read activity logs" on public.activity_logs
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage notifications" on public.notifications;
create policy "Admins manage notifications" on public.notifications
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins read ai logs" on public.ai_logs;
create policy "Admins read ai logs" on public.ai_logs
  for select to authenticated
  using (public.is_restaurant_admin(restaurant_id));

drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));
