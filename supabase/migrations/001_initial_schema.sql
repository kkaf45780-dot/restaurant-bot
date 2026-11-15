-- Migration 001: Order ratings + production database indexes

alter table public.orders
  add column if not exists rating integer check (rating >= 1 and rating <= 5),
  add column if not exists rating_comment text,
  add column if not exists rated_at timestamptz;

create index if not exists idx_orders_rest_number
  on public.orders (restaurant_id, order_number);

create index if not exists idx_orders_rest_phone
  on public.orders (restaurant_id, customer_phone);

create index if not exists idx_orders_rest_created
  on public.orders (restaurant_id, created_at desc);

create index if not exists idx_menu_items_rest_cat
  on public.menu_items (restaurant_id, category_id, sort_order);

create index if not exists idx_inv_movements_rest_created
  on public.inventory_movements (restaurant_id, created_at desc);

create index if not exists idx_coupons_rest_code
  on public.coupons (restaurant_id, code);
