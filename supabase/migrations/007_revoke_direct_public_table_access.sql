-- Revoke inherited direct API privileges; re-grant only public read tables.
revoke all privileges on all tables in schema public from anon, authenticated, public;

alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated, public;

-- Anonymous and authenticated clients can read only public storefront data.
grant select on public.restaurants, public.branches, public.menu_categories,
  public.menu_items, public.delivery_zones, public.coupons to anon, authenticated;

-- All writes and sensitive reads go through the trusted Cloudflare Worker.
revoke all privileges on public.orders, public.order_items, public.customers,
  public.employees, public.activity_logs, public.notifications, public.ai_logs,
  public.inventory_movements, public.restaurant_admins from anon, authenticated;

grant all privileges on all tables in schema public to service_role;
